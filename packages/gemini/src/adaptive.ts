// The adaptive-context loop, independent of WHAT is being asked. Used by the candidate analyst
// (analyze.ts, prompt g2) and by the M5b boundary analyst (@jevx/boundary: "why Jev here?",
// "why deterministic there?"). Only the prompt builder and the parser differ.
//
//   round 1: the anchor's file (or outline + function) + a catalog of related context
//   → model: context_sufficient? missing_context?
//   → NO: add exactly what was asked for (catalog id / named symbol / file); if nothing specific,
//         the next tier (callees/types/constants → callers/importers → folder → repo)
//   → again, until sufficient / max rounds / budget / nothing more to add.
import type { ContextAnchor, ContextItem, ContextKind, ContextMode, ContextProvider, ContextRef, ContextStop, Uncertainty } from "@jevx/core";
import { DEFAULT_GEMINI_TIMEOUT_MS, GeminiCallError, toGeminiError, type GeminiTransport } from "./client.js";

export const DEFAULT_MAX_ROUNDS = 4;
/** Per-anchor cost guard (characters of context). Not an understanding limit: raise it or pass Infinity. */
export const DEFAULT_CONTEXT_BUDGET = 250_000;

/** Default expansion order when the model asks for "more" without naming anything JevX can find. */
const TIERS: ContextKind[][] = [["callee", "type", "constant"], ["caller", "importer", "file", "file_outline", "unit"], ["module"], ["repo"]];

/** The fields every adaptive answer must carry, whatever else it contains. */
export interface AdaptiveAnswer {
  context_sufficient: boolean;
  missing_context: { request: string; why: string }[];
  understanding_confidence: Uncertainty;
}

export interface AdaptiveTurn {
  items: ContextItem[];
  /** Catalog entries not yet included. */
  catalog: ContextRef[];
  round: number;
  maxRounds: number;
  /** Requests from the previous round JevX could not resolve (so the model doesn't repeat them). */
  unresolved: string[];
}

export type AdaptiveParse<A> = { ok: true; analysis: A } | { ok: false; error: string };

export interface AdaptiveOptions<A extends AdaptiveAnswer> {
  anchor: ContextAnchor;
  /** Whole-repo index. Without it only `fallback` is shown and nothing expands. */
  context?: ContextProvider;
  fallback: ContextItem;
  /** Extra items always shown in round 1 (e.g. a related Jev site). Never counted twice. */
  extraItems?: ContextItem[];
  transport: GeminiTransport;
  build(turn: AdaptiveTurn): { systemInstruction: string; prompt: string; schema: unknown };
  parse(text: string | undefined): AdaptiveParse<A>;
  mode?: ContextMode;
  maxRounds?: number;
  budget?: number;
  timeoutMs?: number;
  /** Retries per call for rate limits (429), server errors (5xx) and timeouts. Default 0. */
  retries?: number;
  /** Base delay before a retry (doubles each time). Default 1500 ms. */
  retryDelayMs?: number;
  /** Test hook. */
  sleep?: (ms: number) => Promise<void>;
  /** Reasoning effort for every call of this loop (unset = the model's default). */
  effort?: "low" | "medium" | "high";
}

export interface AdaptiveResult<A> {
  analysis?: A;
  items: ContextItem[];
  rounds: number;
  stoppedBy: ContextStop;
  /** Malformed answer (never cached). */
  error?: string;
  /** A call that failed after retries. Partial counts below still reflect what was spent. */
  callError?: GeminiCallError;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  /** Prompt tokens served from the provider's cache, when reported. */
  cachedTokens: number;
  /** Summed cost in USD; `costSource` says whether the provider reported it or we calculated it. */
  costUsd?: number;
  costSource?: "provider" | "calculated";
  calls: number;
  retries: number;
}

export async function withTimeout<T>(ms: number, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ctl = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ctl.abort();
      reject(new GeminiCallError("request timed out"));
    }, ms);
  });
  try {
    return await Promise.race([fn(ctl.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

const retryable = (e: GeminiCallError) => !e.fatal && (e.status === 429 || (e.status !== undefined && e.status >= 500) || /timed out/.test(e.message));

/** Map one missing_context request to catalog refs (exact id, resolvable id, or search). */
function resolveRequest(req: { request: string; why: string }, catalog: Map<string, ContextRef>, ctx: ContextProvider): ContextRef[] {
  const r = req.request.trim().replace(/^\[|\]$/g, "");
  const exact = catalog.get(r);
  if (exact) return [exact];
  const direct = ctx.resolve(r);
  if (direct) return [direct];
  // ids embedded in a sentence
  const embedded = [...catalog.keys()].filter((id) => r.includes(id));
  if (embedded.length) return embedded.map((id) => catalog.get(id)!);
  const text = `${r} ${req.why}`;
  // "callers" / "who calls" / "where is it used" → caller & importer entries already in the catalog
  if (/\b(caller|called from|who calls|call site|usage|used (?:by|in|from)|where .* used)\b/i.test(text)) {
    const callers = [...catalog.values()].filter((x) => x.kind === "caller" || x.kind === "importer");
    if (callers.length) return callers;
  }
  if (/\b(repo(?:sitory)?|project|overview|architecture|readme)\b/i.test(text)) {
    const repo = [...catalog.values()].find((x) => x.kind === "repo");
    if (repo) return [repo];
  }
  return ctx.search(text, 3);
}

export async function runAdaptive<A extends AdaptiveAnswer>(opts: AdaptiveOptions<A>): Promise<AdaptiveResult<A>> {
  const mode = opts.mode ?? "adaptive";
  const maxRounds = mode === "local" ? 1 : Math.max(1, opts.maxRounds ?? DEFAULT_MAX_ROUNDS);
  const budget = opts.budget ?? DEFAULT_CONTEXT_BUDGET;
  const ctx = opts.context;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const start = ctx ? ctx.initial(opts.anchor) : { items: [opts.fallback], catalog: [] };
  const items: ContextItem[] = start.items.length ? [...start.items] : [opts.fallback];
  for (const x of opts.extraItems ?? []) if (!items.some((i) => i.id === x.id)) items.push(x);
  const included = new Set(items.map((i) => i.id));
  // Files already shown whole: anything located inside them is already visible.
  const wholeFiles = new Set(items.filter((i) => i.kind === "file" && i.file).map((i) => i.file!));
  const redundant = (r: ContextRef) => included.has(r.id) || (r.file !== undefined && wholeFiles.has(r.file) && r.kind !== "module" && r.kind !== "repo");
  const catalog = new Map(start.catalog.filter((r) => !redundant(r)).map((r) => [r.id, r]));
  let chars = items.reduce((n, i) => n + i.chars, 0);
  const out: AdaptiveResult<A> = { items, rounds: 0, stoppedBy: "sufficient", inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cachedTokens: 0, calls: 0, retries: 0 };
  let unresolved: string[] = [];

  for (;;) {
    out.rounds++;
    const p = opts.build({ items, catalog: [...catalog.values()], round: out.rounds, maxRounds, unresolved });
    let reply;
    for (let attempt = 0; ; attempt++) {
      out.calls++;
      try {
        reply = await withTimeout(opts.timeoutMs ?? DEFAULT_GEMINI_TIMEOUT_MS, (signal) =>
          opts.transport.generate({ systemInstruction: p.systemInstruction, prompt: p.prompt, schema: p.schema, signal, ...(opts.effort ? { effort: opts.effort } : {}) })
        );
        break;
      } catch (err) {
        const e = toGeminiError(err);
        if (attempt < (opts.retries ?? 0) && retryable(e)) {
          out.retries++;
          await sleep((opts.retryDelayMs ?? 1500) * 2 ** attempt);
          continue;
        }
        return { ...out, callError: e };
      }
    }
    out.inputTokens += reply.inputTokens;
    out.outputTokens += reply.outputTokens;
    out.reasoningTokens += reply.reasoningTokens ?? 0;
    out.cachedTokens += reply.cachedTokens ?? 0;
    if (reply.costUsd !== undefined) {
      out.costUsd = (out.costUsd ?? 0) + reply.costUsd;
      out.costSource = reply.costSource ?? out.costSource;
    }
    const parsed = opts.parse(reply.text);
    if (!parsed.ok) return { ...out, error: parsed.error };
    const a = parsed.analysis;
    out.analysis = a;
    if (a.context_sufficient && a.understanding_confidence !== "low") return { ...out, stoppedBy: "sufficient" };
    if (mode === "local" || !ctx) return { ...out, stoppedBy: "local_mode" };
    if (out.rounds >= maxRounds) return { ...out, stoppedBy: "max_rounds" };

    // Expand: what the model asked for first, then the next default tier.
    let wanted: ContextRef[] = [];
    unresolved = [];
    for (const req of a.missing_context) {
      const refs = resolveRequest(req, catalog, ctx).filter((r) => !redundant(r));
      if (refs.length) wanted.push(...refs);
      else unresolved.push(req.request);
    }
    if (!wanted.length) {
      for (const tier of TIERS) {
        const next = [...catalog.values()].filter((r) => tier.includes(r.kind) && !included.has(r.id));
        if (next.length) {
          wanted = next;
          break;
        }
      }
    }
    let added = 0;
    let budgetHit = false;
    for (const ref of wanted) {
      if (included.has(ref.id)) continue;
      const item = ctx.resolve(ref.id);
      if (!item) continue;
      if (chars + item.chars > budget) {
        budgetHit = true;
        continue;
      }
      items.push(item);
      included.add(item.id);
      catalog.delete(item.id);
      if (item.kind === "file" && item.file) {
        wholeFiles.add(item.file);
        for (const r of [...catalog.values()]) if (redundant(r)) catalog.delete(r.id);
      }
      chars += item.chars;
      added++;
      for (const n of ctx.neighbors(item.id)) if (!redundant(n) && !catalog.has(n.id)) catalog.set(n.id, n);
    }
    if (!added) return { ...out, stoppedBy: budgetHit ? "budget" : "nothing_more" };
  }
}
