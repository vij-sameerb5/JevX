// Run the Gemini code analyst over a Phase 1 analysis result, with ADAPTIVE repository context.
//
//   whole-repo index (built by JevX, offline)
//     → round 1: candidate's file (or outline + function) + structural evidence + catalog of related context
//     → Gemini: context_sufficient? missing_context?
//     → NO: JevX adds what Gemini asked for (catalog id, or symbol/file it named); if nothing
//           specific, the next tier (callees/types/constants → callers/importers → folder → repo)
//     → again, until sufficient / max rounds / budget / nothing more to add.
//
// The result is EVIDENCE. It never sets a classification, never touches labels, and never
// changes what is a candidate. An analysis that stayed "insufficient" is marked usable=false.
import type { AnalysisResult, CodeAnalystProvider, CodeAnalystSummary, ContextMode, ContextProvider, DecisionCandidate, GeminiAnalysis, GeminiEvidence } from "@jevx/core";
import { runAdaptive } from "./adaptive.js";
import { GeminiCache } from "./cache.js";
import { DEFAULT_GEMINI_TIMEOUT_MS, toGeminiError, type GeminiTransport } from "./client.js";
import { parseGeminiAnalysis } from "./parse.js";
import { GEMINI_PROMPT_VERSION, RESPONSE_SCHEMA, buildGeminiPrompt, fallbackContext } from "./prompt.js";

export { DEFAULT_CONTEXT_BUDGET, DEFAULT_MAX_ROUNDS } from "./adaptive.js";

export interface GeminiRunOptions {
  /**
   * Which provider this run is for (default gemini). Decides the candidate slot
   * (candidate.gemini / candidate.openrouter), the result summary slot and the cache namespace.
   * Everything else — context loop, prompt, schema, parser — is shared.
   */
  provider?: CodeAnalystProvider;
  /** Model id (part of the cache key). */
  model: string;
  /** Omit with offline: true to replay from cache only. */
  transport?: GeminiTransport;
  cache: GeminiCache;
  /** Whole-repo index. Without it, Gemini only sees the candidate function (no expansion). */
  context?: ContextProvider;
  /** adaptive (default): expand on request; local: first round only. */
  mode?: ContextMode;
  maxRounds?: number;
  /** Max characters of context per candidate (Infinity = unlimited). */
  budget?: number;
  offline?: boolean;
  concurrency?: number;
  timeoutMs?: number;
  onProgress?: (done: number, total: number) => void;
  now?: () => string;
}

/** One candidate through the shared adaptive loop, with the candidate prompt (g2). */
function explainWithContext(c: DecisionCandidate, opts: GeminiRunOptions, transport: GeminiTransport) {
  return runAdaptive<GeminiAnalysis>({
    anchor: c,
    context: opts.context,
    fallback: fallbackContext(c),
    transport,
    build: (t) => ({ ...buildGeminiPrompt(c, t), schema: RESPONSE_SCHEMA }),
    parse: parseGeminiAnalysis,
    mode: opts.mode,
    maxRounds: opts.maxRounds,
    budget: opts.budget,
    timeoutMs: opts.timeoutMs ?? DEFAULT_GEMINI_TIMEOUT_MS
  });
}

/**
 * Only candidates that passed deterministic filtering are sent (filtered ones already have a
 * named hard-negative reason). One failure never sinks the run; an auth failure stops calls.
 */
export async function analyzeWithGemini(result: AnalysisResult, opts: GeminiRunOptions): Promise<AnalysisResult> {
  const now = opts.now ?? (() => new Date().toISOString());
  const mode = opts.mode ?? "adaptive";
  const provider: CodeAnalystProvider = opts.provider ?? "gemini";
  const label = provider === "gemini" ? "Gemini" : "OpenRouter";
  if (opts.cache.provider !== provider) throw new Error(`cache is for ${opts.cache.provider}, run is for ${provider}`);
  const targets = result.candidates;
  const summary: CodeAnalystSummary = {
    attempted: targets.length,
    apiCalls: 0,
    cached: 0,
    errors: 0,
    inputTokens: 0,
    outputTokens: 0,
    model: opts.model,
    promptVersion: GEMINI_PROMPT_VERSION,
    expanded: 0,
    insufficient: 0,
    rounds: 0
  };
  const out = new Map<string, DecisionCandidate>();
  let fatal: string | undefined;
  let done = 0;

  const one = async (c: DecisionCandidate) => {
    const key = GeminiCache.key(c, opts.model, mode, GEMINI_PROMPT_VERSION, provider);
    const hit = opts.cache.get(key);
    // A cached analysis is reused only if every piece of context it saw is unchanged.
    const fresh = hit && (!opts.context || hit.itemHashes.every((h) => !h.hash || opts.context!.hashOf(h.id) === h.hash));
    let evidence: GeminiEvidence | undefined;
    let error: string | undefined;
    if (hit && fresh) {
      evidence = { kind: "model_generated_evidence", provider, model: hit.model, promptVersion: hit.promptVersion, analysis: hit.analysis, context: hit.context, usable: hit.usable, cached: true, at: hit.at };
      summary.cached++;
    } else if (opts.offline || !opts.transport) error = hit ? `${label} cache is stale (related code changed; offline replay)` : `not in ${label} cache (offline replay)`;
    else if (fatal) error = fatal;
    else {
      try {
        const r = await explainWithContext(c, opts, opts.transport);
        if (r.callError) throw r.callError;
        summary.apiCalls += r.calls;
        summary.inputTokens += r.inputTokens;
        summary.outputTokens += r.outputTokens;
        if (r.error || !r.analysis) error = r.error ?? "no analysis";
        else {
          const at = now();
          const context: GeminiEvidence["context"] = {
            mode,
            rounds: r.rounds,
            items: r.items.map((i) => ({ id: i.id, kind: i.kind, chars: i.chars })),
            chars: r.items.reduce((n, i) => n + i.chars, 0),
            stoppedBy: r.stoppedBy
          };
          const usable = r.stoppedBy === "sufficient";
          evidence = { kind: "model_generated_evidence", provider, model: opts.model, promptVersion: GEMINI_PROMPT_VERSION, analysis: r.analysis, context, usable, cached: false, at };
          opts.cache.set(key, {
            analysis: r.analysis,
            model: opts.model,
            promptVersion: GEMINI_PROMPT_VERSION,
            context,
            usable,
            itemHashes: r.items.map((i) => ({ id: i.id, hash: i.hash })),
            inputTokens: r.inputTokens,
            outputTokens: r.outputTokens,
            at
          });
        }
      } catch (err) {
        const e = toGeminiError(err);
        error = e.message;
        if (e.fatal) fatal = e.message;
      }
    }
    if (evidence) {
      summary.rounds! += evidence.context.rounds;
      if (evidence.context.rounds > 1) summary.expanded!++;
      if (!evidence.usable) summary.insufficient!++;
      out.set(c.id + c.file, provider === "gemini" ? { ...c, gemini: evidence } : { ...c, openrouter: evidence });
    } else {
      summary.errors++;
      out.set(c.id + c.file, provider === "gemini" ? { ...c, geminiError: error } : { ...c, openrouterError: error });
    }
    opts.onProgress?.(++done, targets.length);
  };

  const queue = [...targets];
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(opts.concurrency ?? 4, queue.length)) }, async () => {
      for (let c = queue.shift(); c; c = queue.shift()) await one(c);
    })
  );
  opts.cache.save();
  if (fatal) summary.fatal = fatal;
  return { ...result, candidates: result.candidates.map((c) => out.get(c.id + c.file) ?? c), [provider]: summary };
}
