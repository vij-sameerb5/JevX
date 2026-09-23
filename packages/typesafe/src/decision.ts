// Phase 1: optional semantic validation of decision candidates (jevx analyze --validate).
// TypeSafe answers bounded questions about ONE candidate; the label policy lives in code.
// Privacy: only the unit's code (secret-scrubbed, capped), its structural summary and its
// relative path leave the machine — never whole files or repositories.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  AuthenticationError,
  PermissionDeniedError,
  TypeSafeError,
  choice,
  noul,
  type SystemOneRequest,
  type SystemOneResult
} from "@typesafe-ai/sdk";
import {
  DECISION_CATEGORIES,
  scrubSecrets,
  type AnalysisResult,
  type Classification,
  type DecisionCandidate,
  type DecisionCategory,
  type Label,
  type Primitive,
  type SemanticAnswers
} from "@jevx/core";

/** Part of the cache key: bump on any change to the state shape or question wording. */
export const DECISION_PROMPT_VERSION = "d1";

const MAX_UNIT_LINES = 60;
const MAX_BOUNDARY_LINES = 40;

export function buildDecisionQuestions() {
  return {
    judgment: noul(
      "Does the decision in boundary_code require interpreting meaning or context (what something is about, how good, how risky, what should happen next), rather than applying an exact rule to exact values?",
      {
        true: "Choosing the outcome needs judgment: two people could reasonably disagree, paraphrases or new situations should lead to the same outcome, and the code is approximating that judgment.",
        false: "The outcome follows exactly from the inputs: arithmetic, exact lookups, parsing, protocol or status handling, typed enum dispatch, validation, formatting, or a business rule that must stay exact."
      }
    ),
    bounded: noul("Are the possible outcomes of this decision a small, known set of options or a graded level?", {
      true: "The outcomes can be listed (labels, routes, actions, yes/no) or are a level on a scale.",
      false: "The outcome is open-ended: generated text, arbitrary data, a computed value with no fixed set of options."
    }),
    deterministic_is_correct: noul("Would exact, deterministic code still be the right way to make this decision even if a reliable semantic model were available?", {
      true: "Exactness is required or the rule is fully specified: money, security, protocols, legal limits, parsing, data plumbing.",
      false: "The hardcoded rule is a brittle stand-in for a judgment a model could make better."
    }),
    primitive: choice("Which question type best expresses this decision?", {
      noul: "A single yes/no judgment with a probability.",
      choice: "Pick exactly one option from a known list.",
      score: "Rate something on a graded scale.",
      none: "None: this is not a judgment call."
    }),
    category: choice("What kind of decision is this?", DECISION_CATEGORIES)
  };
}

export type DecisionQuestions = ReturnType<typeof buildDecisionQuestions>;

const cap = (text: string, max: number) => {
  const lines = text.split("\n");
  return lines.length > max ? [...lines.slice(0, max), "// …"].join("\n") : text;
};

/** The minimum context for one candidate. Code is secret-scrubbed before it is sent. */
export function buildDecisionState(c: DecisionCandidate) {
  const lines = c.code.split("\n");
  const from = Math.max(0, c.boundary.start - c.unit.start);
  const to = Math.min(lines.length, c.boundary.end - c.unit.start + 1);
  const boundary = lines.slice(from, to).join("\n");
  return {
    language: c.language,
    file: c.file,
    function: c.unit.name,
    decision_summary: c.explanation.decision,
    inputs: c.inputs.slice(0, 8).map((i) => `${i.name} (${i.provenance}${i.type ? `: ${i.type}` : ""})`),
    outcomes: c.outputs.values.slice(0, 12),
    boundary_lines: `${c.boundary.start}-${c.boundary.end}`,
    boundary_code: scrubSecrets(cap(boundary, MAX_BOUNDARY_LINES)).text,
    unit_code: scrubSecrets(cap(c.code, MAX_UNIT_LINES)).text
  };
}

// ─── Policy (in code, replayable) ─────────────────────────────────────────

/**
 * p0 is UNCALIBRATED: a starting point, to be replaced by thresholds fitted on human labels
 * from TRAIN projects (never on TEST projects, never on Jev's own answers).
 */
export interface DecisionPolicy {
  version: string;
  strongJudgment: number;
  strongBounded: number;
  possibleJudgment: number;
  rejectDeterministic: number;
}

export const DEFAULT_DECISION_POLICY: DecisionPolicy = {
  version: "p0-uncalibrated",
  strongJudgment: 0.7,
  strongBounded: 0.6,
  possibleJudgment: 0.4,
  rejectDeterministic: 0.7
};

const f2 = (x: number) => x.toFixed(2);

export function classifyAnswers(a: SemanticAnswers, p: DecisionPolicy = DEFAULT_DECISION_POLICY): Classification {
  const mk = (label: Label, reason: string): Classification => ({ label, source: "typesafe", reason, policyVersion: p.version });
  if (a.deterministicIsCorrect >= p.rejectDeterministic && a.judgment < 0.5)
    return mk("NOT_JEV", `deterministic_is_correct ${f2(a.deterministicIsCorrect)}, judgment ${f2(a.judgment)}`);
  if (a.judgment >= p.strongJudgment && a.bounded >= p.strongBounded && a.primitive !== "none")
    return mk("STRONG_JEV", `judgment ${f2(a.judgment)} + bounded ${f2(a.bounded)} + ${a.primitive}`);
  if (a.judgment >= p.possibleJudgment) return mk("POSSIBLE_JEV", `judgment ${f2(a.judgment)} ≥ ${f2(p.possibleJudgment)}`);
  return mk("NOT_JEV", `judgment ${f2(a.judgment)} < ${f2(p.possibleJudgment)}`);
}

export function toAnswers(r: SystemOneResult<DecisionQuestions>, cached: boolean): SemanticAnswers {
  return {
    judgment: r.answers.judgment.noul,
    bounded: r.answers.bounded.noul,
    deterministicIsCorrect: r.answers.deterministic_is_correct.noul,
    primitive: r.answers.primitive.choice as Primitive,
    primitiveConfidence: r.answers.primitive.confidence,
    category: r.answers.category.choice as DecisionCategory,
    categoryConfidence: r.answers.category.confidence,
    model: r.model,
    promptVersion: DECISION_PROMPT_VERSION,
    cached
  };
}

// ─── Cache ────────────────────────────────────────────────────────────────

interface DecisionCacheEntry {
  answers: Omit<SemanticAnswers, "cached">;
  inputTokens: number;
  at: string;
}

/** Raw answers keyed by code hash + candidate id + prompt version + model. Errors are never cached. */
export class DecisionCache {
  private entries: Record<string, DecisionCacheEntry> = {};
  private dirty = false;
  readonly file: string;

  constructor(root: string, private readonly enabled = true) {
    this.file = path.join(root, ".jevx", "cache", "decisions.json");
    if (enabled && existsSync(this.file)) {
      try {
        this.entries = (JSON.parse(readFileSync(this.file, "utf8")) as { entries?: Record<string, DecisionCacheEntry> }).entries ?? {};
      } catch {
        this.entries = {};
      }
    }
  }

  static key(c: DecisionCandidate, model: string): string {
    return createHash("sha256").update([c.hashes.code, c.id, DECISION_PROMPT_VERSION, model].join("\0")).digest("hex");
  }

  get(key: string) {
    return this.enabled ? this.entries[key] : undefined;
  }

  set(key: string, e: DecisionCacheEntry) {
    if (!this.enabled) return;
    this.entries[key] = e;
    this.dirty = true;
  }

  save() {
    if (!this.enabled || !this.dirty) return;
    mkdirSync(path.dirname(this.file), { recursive: true });
    writeFileSync(`${this.file}.tmp`, JSON.stringify({ version: 1, entries: this.entries }, null, 2));
    renameSync(`${this.file}.tmp`, this.file);
    this.dirty = false;
  }
}

// ─── Validation run ───────────────────────────────────────────────────────

export interface DecisionClient {
  readonly defaultModel: string;
  systemOne(request: SystemOneRequest<DecisionQuestions>): PromiseLike<SystemOneResult<DecisionQuestions>>;
}

export interface ValidateDecisionsOptions {
  client: DecisionClient;
  cache: DecisionCache;
  model?: string;
  policy?: DecisionPolicy;
  offline?: boolean;
  concurrency?: number;
  onProgress?: (done: number, total: number) => void;
}

function describeError(err: unknown): string {
  if (err instanceof AuthenticationError) return "authentication failed — check TYPESAFE_API_KEY";
  if (err instanceof PermissionDeniedError) return "access denied by TypeSafe for this key";
  if (err instanceof TypeSafeError) return err.message;
  return err instanceof Error ? err.message : String(err);
}

/**
 * Ask TypeSafe about every candidate that passed deterministic filtering. Filtered candidates
 * are never sent. A failure on one candidate leaves it unclassified; an auth failure stops calls.
 */
export async function validateDecisions(result: AnalysisResult, opts: ValidateDecisionsOptions): Promise<AnalysisResult> {
  const model = opts.model ?? opts.client.defaultModel;
  const policy = opts.policy ?? DEFAULT_DECISION_POLICY;
  const questions = buildDecisionQuestions();
  const summary = { attempted: result.candidates.length, apiCalls: 0, cached: 0, errors: 0, inputTokens: 0, model, promptVersion: DECISION_PROMPT_VERSION, policyVersion: policy.version } as NonNullable<AnalysisResult["semantic"]>;
  let fatal: string | undefined;
  let done = 0;
  const out = new Map<string, DecisionCandidate>();

  const one = async (c: DecisionCandidate) => {
    const key = DecisionCache.key(c, model);
    const hit = opts.cache.get(key);
    let answers: SemanticAnswers | undefined;
    let error: string | undefined;
    if (hit) {
      answers = { ...hit.answers, cached: true };
      summary.cached++;
    } else if (opts.offline) error = "not in cache (offline replay)";
    else if (fatal) error = fatal;
    else {
      try {
        summary.apiCalls++;
        const res = await opts.client.systemOne({ state: buildDecisionState(c), questions, model });
        answers = toAnswers(res, false);
        summary.inputTokens += res.usage?.input_tokens ?? 0;
        const { cached: _c, ...stored } = answers;
        void _c;
        opts.cache.set(key, { answers: stored, inputTokens: res.usage?.input_tokens ?? 0, at: new Date().toISOString() });
      } catch (err) {
        error = describeError(err);
        if (err instanceof AuthenticationError || err instanceof PermissionDeniedError) fatal = error;
      }
    }
    if (answers) out.set(c.id + c.file, { ...c, semantic: answers, classification: classifyAnswers(answers, policy) });
    else {
      summary.errors++;
      out.set(c.id + c.file, { ...c, semanticError: error });
    }
    opts.onProgress?.(++done, result.candidates.length);
  };

  const queue = [...result.candidates];
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(opts.concurrency ?? 4, queue.length)) }, async () => {
      for (let c = queue.shift(); c; c = queue.shift()) await one(c);
    })
  );
  opts.cache.save();
  if (fatal) summary.fatal = fatal;
  return { ...result, candidates: result.candidates.map((c) => out.get(c.id + c.file) ?? c), semantic: summary };
}
