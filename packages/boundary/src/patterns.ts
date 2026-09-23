// Layer E — boundary patterns across the stored C (why Jev here) and D (why deterministic there)
// records. Two steps, in this order:
//
//   1. aggregate()  deterministic, offline, no API. Counts, record ids, projects, contradictions.
//                   This is the dataset. It is complete on its own and runs with no key.
//   2. synthesis    OPTIONAL. Small bounded batches ask the model to WORD the groups step 1 already
//                   counted — one statement per group, a few groups per call. The model never
//                   supplies a count, an id, a project or a counter-example, and a batch that fails
//                   loses only its own wording: the deterministic patterns still stand.
//
// The old one-shot call (every record in a single request, unbounded pattern list) is gone. It was
// not too large to send — 19 records were ~4.8k tokens — it was unbounded to ANSWER, so the reply
// ran past the request timeout and the whole run was lost. Small batches with one statement each
// keep every reply short.
import { runAdaptive, type GeminiTransport } from "@jevx/gemini";
import { aggregate, type Aggregation, type EvidenceGroup } from "./aggregate.js";
import { parseSynthesis } from "./parse.js";
import { PATTERN_PROMPT_VERSION, buildSynthesisPrompt, type SynthesisGroupInput } from "./prompt.js";
import { BOUNDARY_SCHEMA_VERSION, type AnalysisRecord, type AnalystInfo, type BoundaryFeature, type CallAccounting, type ContrastRecord, type DerivedPattern, type PatternRecord } from "./schema.js";

export const DEFAULT_BATCH_SIZE = 4;
export const DEFAULT_MAX_BATCHES = 8;
/** Per call. Grok 4.6 reasons for a long time even on a small prompt; this is the reply window. */
export const DEFAULT_SYNTHESIS_TIMEOUT_MS = 180_000;

export interface PatternRunOptions {
  analyses: AnalysisRecord[];
  contrasts: ContrastRecord[];
  /** Omit for a deterministic-only run (offline, or no API key). */
  transport?: GeminiTransport;
  analyst?: Omit<AnalystInfo, "promptVersion">;
  /** Groups per call. Small on purpose: the reply must stay short. */
  batchSize?: number;
  /** Hard cap on calls, so the cost of this step is known before it runs. */
  maxBatches?: number;
  timeoutMs?: number;
  retries?: number;
  excludedProjects?: string[];
  runId: string;
  now?: () => string;
  onEvent?: (e: PatternEvent) => void;
}

export type PatternEvent =
  | { type: "aggregated"; groups: number; analyses: number; contrasts: number }
  | { type: "batch"; index: number; of: number; groups: string[] }
  | { type: "batch_done"; index: number; answered: number; accounting: CallAccounting }
  | { type: "batch_failed"; index: number; error: string };

const EMPTY: CallAccounting = { calls: 0, rounds: 0, retries: 0, inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cachedTokens: 0 };

function addAccounting(a: CallAccounting, b: CallAccounting): CallAccounting {
  const cost = (a.costUsd ?? 0) + (b.costUsd ?? 0);
  const source = !b.costSource ? a.costSource : !a.costSource || a.costSource === b.costSource ? b.costSource : a.costSource;
  return {
    calls: a.calls + b.calls,
    rounds: a.rounds + b.rounds,
    retries: a.retries + b.retries,
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    reasoningTokens: a.reasoningTokens + b.reasoningTokens,
    cachedTokens: a.cachedTokens + b.cachedTokens,
    ...(a.costUsd !== undefined || b.costUsd !== undefined ? { costUsd: cost, ...(source ? { costSource: source } : {}) } : {})
  };
}

/** Separating evidence first, then the widest — so a small --max-batches still asks what matters. */
function order(groups: EvidenceGroup[]): EvidenceGroup[] {
  const rank = (g: EvidenceGroup) => (g.direction === "separates" ? 0 : g.direction === "contested" ? 1 : g.direction === "jev_side_only" ? 2 : 3);
  return [...groups].sort((a, b) => rank(a) - rank(b) || b.projects.length - a.projects.length || a.id.localeCompare(b.id));
}

const sizes = (v: Record<string, string[]>) => Object.fromEntries(Object.entries(v).map(([k, ids]) => [k, ids.length]));

/** What one group looks like on the wire: counts and ids, never code and never record free text. */
export function synthesisInput(g: EvidenceGroup): SynthesisGroupInput {
  return {
    group_id: g.id,
    what_was_counted: g.basis,
    counts_so_far: g.statement,
    jev_side: sizes(g.jev.byValue),
    deterministic_side: sizes(g.deterministic.byValue),
    projects: g.projects.length,
    records_that_disagree: g.counterExamples.slice(0, 6),
    caveats: g.notes
  };
}

/** The deterministic pattern for a group — what Layer E stores when no model is used at all. */
function patternOf(g: EvidenceGroup): DerivedPattern {
  return {
    id: g.id,
    groupId: g.id,
    category: g.category,
    side: g.side,
    statement: g.statement,
    statementSource: "aggregated",
    evidence: g.statement,
    basis: g.basis,
    supporting: g.supportingIds,
    contrasting: g.contrastingIds,
    counter_examples: g.counterExamples.map((c) => c.id),
    projects: g.projects,
    strength: g.strength,
    confidence: g.confidence,
    contested: g.contested,
    unknowns: g.unknowns,
    features_involved: g.features as BoundaryFeature[],
    notes: g.notes
  };
}

/** Questions the data itself raises, so an offline run still says what is missing. */
function openQuestions(agg: Aggregation): string[] {
  const qs: string[] = [];
  const untested = agg.groups.filter((g) => g.direction === "jev_side_only" && g.id.startsWith("feature:"));
  if (untested.length) qs.push(`Do deterministic decisions also show ${untested.map((g) => g.category).join(", ")}? Never measured — no real-decision contrast carried these.`);
  const contested = agg.groups.filter((g) => g.contested);
  const first = contested[0]?.counterExamples[0]?.id;
  if (first)
    qs.push(
      `Why does ${agg.index[first]?.where ?? first} (\`${first}\`) disagree with ${contested[0]!.category}? One counter-example can mean a mis-selected contrast, a mislabelled level, or a real exception.`
    );
  if (agg.source.realDecisionContrasts < agg.source.usableAnalyses)
    qs.push(`Only ${agg.source.realDecisionContrasts} real-decision contrast(s) for ${agg.source.usableAnalyses} Jev site(s): is deterministic decision-making genuinely rare next to Jev calls, or is the contrast finder picking plumbing?`);
  return qs;
}

export async function derivePatterns(opts: PatternRunOptions): Promise<{ record: PatternRecord; accounting: CallAccounting; errors: string[] }> {
  const now = opts.now ?? (() => new Date().toISOString());
  const agg = aggregate(opts.analyses, opts.contrasts);
  opts.onEvent?.({ type: "aggregated", groups: agg.groups.length, analyses: agg.source.usableAnalyses, contrasts: agg.source.realDecisionContrasts });

  const patterns = new Map(agg.groups.map((g) => [g.id, patternOf(g)]));
  const errors: string[] = [];
  const questions = openQuestions(agg);
  let accounting = EMPTY;
  let synthesis: PatternRecord["synthesis"];

  if (opts.transport && agg.groups.length) {
    const size = Math.max(1, opts.batchSize ?? DEFAULT_BATCH_SIZE);
    const max = Math.max(1, opts.maxBatches ?? DEFAULT_MAX_BATCHES);
    const ordered = order(agg.groups).slice(0, size * max);
    const batches: EvidenceGroup[][] = [];
    for (let i = 0; i < ordered.length; i += size) batches.push(ordered.slice(i, i + size));
    const failed: { groups: string[]; error: string }[] = [];
    let answered = 0;

    for (const [i, batch] of batches.entries()) {
      const ids = new Set(batch.map((g) => g.id));
      opts.onEvent?.({ type: "batch", index: i + 1, of: batches.length, groups: [...ids] });
      const prompt = buildSynthesisPrompt(batch.map(synthesisInput));
      const r = await runAdaptive({
        anchor: { file: "", unit: { name: `patterns batch ${i + 1}`, start: 0 } },
        fallback: { id: "groups", kind: "repo", title: "groups", text: "", chars: 0, hash: "" },
        transport: opts.transport,
        mode: "local",
        timeoutMs: opts.timeoutMs ?? DEFAULT_SYNTHESIS_TIMEOUT_MS,
        retries: opts.retries ?? 2,
        build: () => prompt,
        parse: (t) => parseSynthesis(t, ids)
      });
      const acc: CallAccounting = {
        calls: r.calls,
        rounds: r.rounds,
        retries: r.retries,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        reasoningTokens: r.reasoningTokens,
        cachedTokens: r.cachedTokens,
        ...(r.costUsd !== undefined ? { costUsd: r.costUsd, ...(r.costSource ? { costSource: r.costSource } : {}) } : {})
      };
      accounting = addAccounting(accounting, acc);
      if (!r.analysis) {
        const error = r.callError?.message ?? r.error ?? "no answer";
        failed.push({ groups: [...ids], error });
        errors.push(`batch ${i + 1} (${[...ids].join(", ")}): ${error}`);
        opts.onEvent?.({ type: "batch_failed", index: i + 1, error });
        continue; // the deterministic patterns for these groups stay exactly as they were
      }
      for (const g of r.analysis.groups) {
        const p = patterns.get(g.group_id);
        if (!p) continue;
        answered++;
        if (!g.supported_by_the_counts) {
          // The model may reject a grouping; it may not replace the counts with its own story.
          p.notes = [...p.notes, `The analyst does not think these counts support a general statement${g.caveat ? `: ${g.caveat}` : "."}`];
          continue;
        }
        if (g.statement) {
          p.statement = g.statement;
          p.statementSource = "model";
          // Evidence recorded on Jev sites alone cannot separate, whatever the model calls it.
          p.side = p.contrasting.length ? g.side : "jev";
        }
        if (g.caveat) p.caveat = g.caveat;
      }
      questions.push(...r.analysis.open_questions);
      opts.onEvent?.({ type: "batch_done", index: i + 1, answered: r.analysis.groups.length, accounting: acc });
    }
    synthesis = { batches: batches.length, answered, failed };
  }

  const record: PatternRecord = {
    schema: BOUNDARY_SCHEMA_VERSION,
    layer: "E_patterns",
    kind: "derived_hypothesis",
    runId: opts.runId,
    projects: agg.source.projects,
    from: { analyses: opts.analyses.length, contrasts: opts.contrasts.length },
    ...(opts.analyst && opts.transport ? { analyst: { ...opts.analyst, promptVersion: PATTERN_PROMPT_VERSION } } : {}),
    result: {
      patterns: [...patterns.values()],
      rejected_explanations: agg.rejected,
      open_questions: [...new Set(questions)].slice(0, 12)
    },
    index: agg.index,
    source: { ...agg.source, excludedProjects: opts.excludedProjects ?? [] },
    notes: agg.notes,
    unknowns: agg.unknowns,
    ...(synthesis ? { synthesis } : {}),
    accounting,
    at: now()
  };
  return { record, accounting, errors };
}

export { PATTERN_PROMPT_VERSION };
