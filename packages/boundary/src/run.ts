// The M5b pilot runner for ONE project:
//   B  finder report → anchors (decision sites, deduped, product code first)
//   C  per anchor: "why Jev here?" through the shared adaptive-context loop
//   D  per anchor: up to N nearby contrasts, ONE call: "why did these stay deterministic?"
// Model-agnostic: any GeminiTransport (OpenRouter → Grok 4.6 by default) works.
// Stops before any call once the token budget is spent. Every call is accounted for.
import { createHash } from "node:crypto";
import path from "node:path";
import type { SourceFile } from "ts-morph";
import { scrubSecrets, type AnalysisResult, type ContextItem, type ContextMode, type ContextProvider, type JevSite, type JevUsageReport } from "@jevx/core";
import { runAdaptive, type AdaptiveResult, type GeminiTransport } from "@jevx/gemini";
import { BoundaryCache, cacheKey } from "./cache.js";
import { importGraph, selectContrasts, DEFAULT_MAX_CONTRASTS, type SelectedContrast } from "./contrasts.js";
import { parseContrastAnalysis, parseUsageAnalysis } from "./parse.js";
import { BOUNDARY_PROMPT_VERSION, buildContrastPrompt, buildUsagePrompt, type ContrastInput } from "./prompt.js";
import {
  BOUNDARY_FEATURES,
  BOUNDARY_SCHEMA_VERSION,
  type AnalysisFacts,
  type AnalysisRecord,
  type AnalystInfo,
  type CallAccounting,
  type ContrastAnalysis,
  type ContrastRecord,
  type RunRecord,
  type UsageAnalysis,
  type UsageRecord,
  type Visibility
} from "./schema.js";

export const DEFAULT_MAX_USAGES = 3;
/** Per-project token guard (input + output). Not a quality setting — raise it deliberately. */
export const DEFAULT_BUDGET_TOKENS = 150_000;

const NON_PRODUCT = /(^|\/)(bench|benchmarks?|experiments?|examples?|scripts?|demos?|fixtures?|measure)\//i;
const TIER_RANK = { definite: 0, likely: 1, wrapper: 2, uncertain: 3 } as const;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export interface BoundaryRunOptions {
  project: string;
  visibility: Visibility;
  root: string;
  files: SourceFile[];
  /** The P1 analysis of the same project (the contrast pool). */
  analysis: AnalysisResult;
  usage: JevUsageReport;
  /** Whole-repo index for adaptive context (RepoIndex). */
  context?: ContextProvider;
  transport?: GeminiTransport;
  analyst: Omit<AnalystInfo, "promptVersion">;
  cache: BoundaryCache;
  /** Plan only: pick anchors and contrasts, call nothing. */
  dryRun?: boolean;
  /** Replay from cache only. */
  offline?: boolean;
  maxUsages?: number;
  maxContrasts?: number;
  budgetTokens?: number;
  mode?: ContextMode;
  maxRounds?: number;
  contextBudget?: number;
  timeoutMs?: number;
  retries?: number;
  onEvent?: (e: RunEvent) => void;
  now?: () => string;
  runId?: string;
}

export type RunEvent =
  | { type: "plan"; anchors: JevSite[]; contrasts: Record<string, SelectedContrast[]> }
  | { type: "usage"; site: JevSite; ok: boolean; cached: boolean; error?: string; accounting: CallAccounting }
  | { type: "contrast"; site: JevSite; count: number; ok: boolean; cached: boolean; error?: string; accounting: CallAccounting }
  | { type: "budget"; spent: number; budget: number };

export interface BoundaryRunResult {
  usages: UsageRecord[];
  analyses: AnalysisRecord[];
  contrasts: ContrastRecord[];
  run: RunRecord;
  plan: { anchors: JevSite[]; contrasts: Record<string, SelectedContrast[]> };
  /** Free-text analyses of private projects stay here (local cache), never in the dataset. */
}

const zero = (): CallAccounting => ({ calls: 0, rounds: 0, retries: 0, inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cachedTokens: 0 });
function add(a: CallAccounting, b: CallAccounting) {
  a.calls += b.calls;
  a.rounds += b.rounds;
  a.retries += b.retries;
  a.inputTokens += b.inputTokens;
  a.outputTokens += b.outputTokens;
  a.reasoningTokens += b.reasoningTokens;
  a.cachedTokens += b.cachedTokens;
  if (b.costUsd !== undefined) {
    a.costUsd = (a.costUsd ?? 0) + b.costUsd;
    a.costSource = a.costSource && b.costSource && a.costSource !== b.costSource ? "calculated" : (b.costSource ?? a.costSource);
  }
}
const accountingOf = (r: AdaptiveResult<unknown>): CallAccounting => ({
  calls: r.calls,
  rounds: r.rounds,
  retries: r.retries,
  inputTokens: r.inputTokens,
  outputTokens: r.outputTokens,
  reasoningTokens: r.reasoningTokens,
  cachedTokens: r.cachedTokens,
  ...(r.costUsd !== undefined ? { costUsd: r.costUsd, ...(r.costSource ? { costSource: r.costSource } : {}) } : {})
});

/** Anchors: decision sites (not plumbing, not uncertain), product code first, near-duplicates once. */
export function pickAnchors(usage: JevUsageReport, max: number): JevSite[] {
  const decisions = usage.sites.filter((s) => s.role === "decision" && s.tier !== "uncertain");
  decisions.sort(
    (a, b) =>
      Number(NON_PRODUCT.test(a.file)) - Number(NON_PRODUCT.test(b.file)) || TIER_RANK[a.tier] - TIER_RANK[b.tier] || b.questions.length - a.questions.length || a.file.localeCompare(b.file) || a.unit.start - b.unit.start
  );
  const seen = new Set<string>();
  const out: JevSite[] = [];
  for (const s of decisions) {
    // the same questions asked from twin functions (copy-pasted variants) count once
    const sig = s.questions
      .map((q) => `${q.primitive}:${q.key ?? ""}:${q.text ?? ""}`)
      .sort()
      .join("|");
    if (sig && seen.has(sig)) continue;
    seen.add(sig);
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

/** Private projects: no question text, no call text in layer B. */
function privateSite(s: JevSite): JevSite {
  return {
    ...s,
    questions: s.questions.map((q) => {
      const copy = { ...q };
      delete copy.text;
      delete copy.outcomes;
      return copy;
    }),
    calls: s.calls.map((c) => ({ ...c, text: "" })),
    evidence: s.evidence.map((e) => e.replace(/\([^)]*\)/g, "").trim())
  };
}

function numbered(text: string, start: number) {
  return text
    .split("\n")
    .map((l, i) => `${String(start + i).padStart(5)} | ${l}`)
    .join("\n");
}

/** A context item for one function, straight from the source file (fallback / extra items). */
function unitItem(files: Map<string, SourceFile>, file: string, unit: { name: string; start: number; end: number }, kind: "unit" | "callee" = "unit"): ContextItem | undefined {
  const sf = files.get(file);
  if (!sf) return undefined;
  const lines = sf.getFullText().split("\n").slice(unit.start - 1, unit.end);
  const text = scrubSecrets(numbered(lines.join("\n"), unit.start)).text;
  return { id: `${kind}:${file}#${unit.name}@${unit.start}`, kind, title: `${unit.name} in ${file}`, file, lines: [unit.start, unit.end], text, chars: text.length, hash: sha(text) };
}

export function factsOf(a: UsageAnalysis): AnalysisFacts {
  return {
    nature: a.decision.nature,
    features: Object.fromEntries(BOUNDARY_FEATURES.map((f) => [f, a.features[f].level])) as AnalysisFacts["features"],
    why_jev_hypotheses: Object.fromEntries(a.why_jev_hypotheses.map((h) => [h.id, h.assessment])),
    not_reasons: Object.fromEntries(a.not_reasons.map((h) => [h.id, h.assessment])),
    confidence: a.confidence,
    understanding_confidence: a.understanding_confidence,
    observed_claims: a.why_jev.observed.length,
    inferred_claims: a.why_jev.inferred.length,
    unknowns: a.why_jev.unknown.length
  };
}

/** What the contrast call is told about the Jev site (inference, labelled as such). */
function siteSummary(a: UsageAnalysis) {
  return {
    what_is_decided: a.decision.what_is_decided,
    nature: a.decision.nature,
    outcomes: a.decision.outcomes,
    features: Object.fromEntries(BOUNDARY_FEATURES.map((f) => [f, a.features[f].level])),
    supported_why_jev: a.why_jev_hypotheses.filter((h) => h.assessment === "supported").map((h) => h.id),
    inferred: a.why_jev.inferred.map((c) => c.claim),
    deterministic_alternative: a.deterministic_alternative.adequacy
  };
}

export async function runBoundary(opts: BoundaryRunOptions): Promise<BoundaryRunResult> {
  const now = opts.now ?? (() => new Date().toISOString());
  const at = now();
  const runId = opts.runId ?? sha(`${opts.project}\0${at}`).slice(0, 12);
  const analyst: AnalystInfo = { ...opts.analyst, promptVersion: BOUNDARY_PROMPT_VERSION };
  const modelKey = `${analyst.provider}:${analyst.model}`;
  const budget = opts.budgetTokens ?? DEFAULT_BUDGET_TOKENS;
  const maxContrasts = opts.maxContrasts ?? DEFAULT_MAX_CONTRASTS;
  const mode = opts.mode ?? "adaptive";
  const files = new Map(opts.files.map((sf) => [path.relative(path.resolve(opts.root), sf.getFilePath()).split(path.sep).join("/"), sf]));
  const hashOf = opts.context ? (id: string) => opts.context!.hashOf(id) : undefined;
  const pub = opts.visibility === "public";

  // ── B + plan ──
  const anchors = pickAnchors(opts.usage, opts.maxUsages ?? DEFAULT_MAX_USAGES);
  const anchorIds = new Set(anchors.map((a) => a.id));
  const usages: UsageRecord[] = [...opts.usage.sites, ...opts.usage.uncertain].map((s) => ({
    schema: BOUNDARY_SCHEMA_VERSION,
    layer: "B_observed_usage",
    project: opts.project,
    visibility: opts.visibility,
    finder: opts.usage.version,
    site: pub ? s : privateSite(s),
    anchor: anchorIds.has(s.id),
    at
  }));
  const graph = importGraph(opts.root, opts.files);
  const used = new Set<string>();
  const allSites = [...opts.usage.sites, ...opts.usage.uncertain];
  const planned: Record<string, SelectedContrast[]> = {};
  for (const s of anchors) planned[s.id] = selectContrasts(s, opts.analysis.candidates, allSites, graph, { max: maxContrasts, used });
  opts.onEvent?.({ type: "plan", anchors, contrasts: planned });

  const total = zero();
  const run: RunRecord = {
    schema: BOUNDARY_SCHEMA_VERSION,
    runId,
    project: opts.project,
    analyst,
    finder: opts.usage.version,
    usages: { found: opts.usage.sites.length, anchors: anchors.length, analyzed: 0, cached: 0, failed: 0, skippedBudget: 0 },
    contrasts: { selected: Object.values(planned).reduce((n, x) => n + x.length, 0), analyzed: 0, failed: 0 },
    accounting: total,
    errors: [],
    at
  };
  const analyses: AnalysisRecord[] = [];
  const contrasts: ContrastRecord[] = [];
  if (opts.dryRun) return { usages, analyses, contrasts, run, plan: { anchors, contrasts: planned } };

  let fatal: string | undefined;
  const spent = () => total.inputTokens + total.outputTokens;
  const canCall = () => !fatal && !opts.offline && Boolean(opts.transport) && spent() < budget;
  const common = { context: opts.context, mode, maxRounds: opts.maxRounds, budget: opts.contextBudget, timeoutMs: opts.timeoutMs, retries: opts.retries ?? 2 };

  for (const site of anchors) {
    // ── C: why Jev here? ──
    const cKey = cacheKey("C", opts.project, site.id, site.codeHash, opts.usage.version, BOUNDARY_PROMPT_VERSION, modelKey, mode);
    let usage: { analysis: UsageAnalysis; context: AnalysisRecord["context"]; usable: boolean; accounting: CallAccounting; cached: boolean } | undefined;
    const hit = opts.cache.get<UsageAnalysis>(cKey, hashOf);
    if (hit) {
      usage = { analysis: hit.value, context: hit.context, usable: hit.usable, accounting: hit.accounting, cached: true };
      run.usages.cached++;
    } else if (!canCall()) {
      if (spent() >= budget) {
        run.usages.skippedBudget++;
        opts.onEvent?.({ type: "budget", spent: spent(), budget });
      } else if (fatal || opts.offline || !opts.transport) run.errors.push(`${site.file}:${site.unit.start}: ${fatal ?? "not in cache (offline)"}`);
      continue;
    } else {
      const fallback = unitItem(files, site.file, site.unit) ?? { id: `unit:${site.file}`, kind: "unit" as const, title: site.unit.name, text: "", chars: 0, hash: "" };
      const r = await runAdaptive<UsageAnalysis>({
        ...common,
        anchor: site,
        fallback,
        transport: opts.transport!,
        build: (t) => buildUsagePrompt(opts.project, pub ? site : privateSite(site), t),
        parse: parseUsageAnalysis
      });
      const acc = accountingOf(r);
      add(total, acc);
      if (r.callError?.fatal) fatal = r.callError.message;
      if (!r.analysis || r.error || r.callError) {
        run.usages.failed++;
        const err = r.callError?.message ?? r.error ?? "no analysis";
        run.errors.push(`${site.file}:${site.unit.start}: ${err}`);
        opts.onEvent?.({ type: "usage", site, ok: false, cached: false, error: err, accounting: acc });
        continue;
      }
      const context = { rounds: r.rounds, chars: r.items.reduce((n, i) => n + i.chars, 0), stoppedBy: r.stoppedBy, items: r.items.map((i) => i.id) };
      usage = { analysis: r.analysis, context, usable: r.stoppedBy === "sufficient", accounting: acc, cached: false };
      opts.cache.set(cKey, { value: r.analysis, context, itemHashes: r.items.map((i) => ({ id: i.id, hash: i.hash })), usable: usage.usable, accounting: acc, at: now() });
    }
    run.usages.analyzed++;
    opts.onEvent?.({ type: "usage", site, ok: true, cached: usage.cached, accounting: usage.accounting });
    analyses.push({
      schema: BOUNDARY_SCHEMA_VERSION,
      layer: "C_usage_analysis",
      kind: "model_generated_inference",
      project: opts.project,
      visibility: opts.visibility,
      siteId: site.id,
      site: { file: site.file, unit: site.unit, codeHash: site.codeHash },
      analyst,
      ...(pub ? { analysis: usage.analysis } : {}),
      facts: factsOf(usage.analysis),
      context: { rounds: usage.context.rounds, chars: usage.context.chars, stoppedBy: usage.context.stoppedBy, ...(pub ? { items: usage.context.items } : {}) },
      usable: usage.usable,
      accounting: usage.accounting,
      at: now()
    });

    // ── D: why did the nearby decisions stay deterministic? (one call for all contrasts) ──
    const chosen = planned[site.id] ?? [];
    if (!chosen.length) continue;
    const inputs: ContrastInput[] = chosen.map((c, i) => ({
      id: `c${i + 1}`,
      file: c.candidate.file,
      unit: { name: c.candidate.unit.name, start: c.candidate.unit.start, end: c.candidate.unit.end },
      generators: c.candidate.generators,
      selection: c.selection
    }));
    const summary = siteSummary(usage.analysis);
    const dKey = cacheKey("D", opts.project, site.id, site.codeHash, sha(JSON.stringify(summary)), ...chosen.map((c) => `${c.candidate.id}:${c.candidate.hashes.code}`), BOUNDARY_PROMPT_VERSION, modelKey, mode);
    let result: { analysis: ContrastAnalysis; usable: boolean; accounting: CallAccounting; cached: boolean } | undefined;
    const dHit = opts.cache.get<ContrastAnalysis>(dKey, hashOf);
    if (dHit) result = { analysis: dHit.value, usable: dHit.usable, accounting: dHit.accounting, cached: true };
    else if (!canCall()) {
      if (spent() >= budget) opts.onEvent?.({ type: "budget", spent: spent(), budget });
      continue;
    } else {
      const first = chosen[0]!.candidate;
      const extra = [
        site.file !== first.file ? unitItem(files, site.file, site.unit) : undefined,
        ...chosen.slice(1).filter((c) => c.candidate.file !== first.file).map((c) => unitItem(files, c.candidate.file, c.candidate.unit))
      ].filter((x): x is ContextItem => Boolean(x));
      const r = await runAdaptive<ContrastAnalysis>({
        ...common,
        anchor: first,
        fallback: unitItem(files, first.file, first.unit)!,
        extraItems: extra,
        transport: opts.transport!,
        build: (t) => buildContrastPrompt(opts.project, pub ? site : privateSite(site), summary, inputs, t),
        parse: (text) => parseContrastAnalysis(text, inputs.map((i) => i.id))
      });
      const acc = accountingOf(r);
      add(total, acc);
      if (r.callError?.fatal) fatal = r.callError.message;
      if (!r.analysis || r.error || r.callError) {
        run.contrasts.failed += chosen.length;
        const err = r.callError?.message ?? r.error ?? "no analysis";
        run.errors.push(`${site.file}:${site.unit.start} contrasts: ${err}`);
        opts.onEvent?.({ type: "contrast", site, count: chosen.length, ok: false, cached: false, error: err, accounting: acc });
        continue;
      }
      result = { analysis: r.analysis, usable: r.stoppedBy === "sufficient", accounting: acc, cached: false };
      opts.cache.set(dKey, { value: r.analysis, context: { rounds: r.rounds, chars: r.items.reduce((n, i) => n + i.chars, 0), stoppedBy: r.stoppedBy, items: r.items.map((i) => i.id) }, itemHashes: r.items.map((i) => ({ id: i.id, hash: i.hash })), usable: result.usable, accounting: acc, at: now() });
    }
    opts.onEvent?.({ type: "contrast", site, count: chosen.length, ok: true, cached: result.cached, accounting: result.accounting });
    for (const [i, c] of chosen.entries()) {
      const a = result.analysis.contrasts.find((x) => x.contrast_id === inputs[i]!.id);
      if (!a) {
        run.contrasts.failed++;
        continue;
      }
      run.contrasts.analyzed++;
      contrasts.push({
        schema: BOUNDARY_SCHEMA_VERSION,
        layer: "D_contrast",
        project: opts.project,
        visibility: opts.visibility,
        siteId: site.id,
        contrast: { id: c.candidate.id, file: c.candidate.file, unit: { name: c.candidate.unit.name, start: c.candidate.unit.start, end: c.candidate.unit.end }, codeHash: c.candidate.hashes.code, generators: c.candidate.generators.map((g) => g.generator), selection: c.selection },
        analyst,
        ...(pub ? { analysis: a } : {}),
        facts: {
          nature: a.decision.nature,
          features: Object.fromEntries(BOUNDARY_FEATURES.map((f) => [f, a.features[f].level])) as AnalysisFacts["features"],
          confidence: a.confidence,
          understanding_confidence: result.analysis.understanding_confidence,
          observed_claims: a.why_deterministic.observed.length,
          inferred_claims: a.why_deterministic.inferred.length,
          unknowns: a.why_deterministic.unknown.length,
          is_a_real_decision: a.is_a_real_decision,
          shares_jev_site_traits: a.shares_jev_site_traits
        },
        usable: result.usable,
        accounting: result.accounting,
        at: now()
      });
    }
  }
  opts.cache.save();
  if (fatal) run.errors.unshift(`stopped: ${fatal}`);
  return { usages, analyses, contrasts, run, plan: { anchors, contrasts: planned } };
}
