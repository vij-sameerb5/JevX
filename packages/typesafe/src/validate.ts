import {
  AuthenticationError,
  PermissionDeniedError,
  TypeSafeError,
  type SystemOneRequest,
  type SystemOneResult
} from "@typesafe-ai/sdk";
import {
  bandFor,
  summarize,
  type Candidate,
  type DetectionResult,
  type SemanticKind,
  type Thresholds,
  type Validation,
  type ValidationSummary
} from "@jevx/core";
import { ValidationCache } from "./cache.js";
import { PROMPT_VERSION, buildQuestions, buildState, type ValidationQuestions } from "./questions.js";

/** The slice of TypeSafeClient validation needs — lets tests pass a fake. */
export interface SystemOneClient {
  readonly defaultModel: string;
  systemOne(request: SystemOneRequest<ValidationQuestions>): PromiseLike<SystemOneResult<ValidationQuestions>>;
}

export interface ValidateOptions {
  client: SystemOneClient;
  cache: ValidationCache;
  thresholds: Thresholds;
  /** Model alias to request. Default: the client's default model. */
  model?: string;
  /** Validate every raw candidate, including below the minimum threshold. */
  all?: boolean;
  concurrency?: number;
  /** Decision policy (thresholds). Default: DEFAULT_POLICY. */
  policy?: Policy;
  /** Never call the API: answers come from the cache only; misses become "error: not cached". */
  offline?: boolean;
  onProgress?: (done: number, total: number) => void;
}

/**
 * Decision policy (in code — TypeSafe answers atomic questions, JevX combines them).
 * Calibrated against regression/legacy-v1/ with `pnpm eval --replay` (no API calls).
 *
 *   reject   if kind = not_semantic with confidence ≥ notSemanticRejectMin
 *   confirm  if semantic ≥ semanticMin
 *   confirm  if kind is a semantic kind with confidence ≥ kindAssistMin and semantic ≥ kindAssistSemanticMin
 *   reject   otherwise
 *
 * humanText is advisory only (a note, never a gate): caught-error / library text is removed
 * deterministically by the AST detector, which is more reliable than asking the model.
 */
export interface Policy {
  semanticMin: number;
  kindAssistMin: number;
  kindAssistSemanticMin: number;
  notSemanticRejectMin: number;
  /** Below this, humanText adds an advisory note. */
  humanTextAdvisory: number;
}

export const DEFAULT_POLICY: Policy = {
  semanticMin: 0.5,
  kindAssistMin: 0.8,
  kindAssistSemanticMin: 0.4,
  notSemanticRejectMin: 0.8,
  humanTextAdvisory: 0.3
};

export interface RawAnswers {
  semantic: number;
  humanText: number;
  kind: SemanticKind;
  kindConfidence: number;
}

const f2 = (x: number) => x.toFixed(2);

export function decide(a: RawAnswers, p: Policy = DEFAULT_POLICY): Pick<Validation, "status" | "reason" | "advisories"> {
  const advisories = a.humanText < p.humanTextAdvisory ? [`low human-text probability (${f2(a.humanText)})`] : undefined;
  if (a.kind === "not_semantic" && a.kindConfidence >= p.notSemanticRejectMin) {
    return { status: "rejected", reason: `kind not_semantic (${f2(a.kindConfidence)})`, advisories };
  }
  if (a.semantic >= p.semanticMin) {
    return { status: "confirmed", reason: `semantic ${f2(a.semantic)} ≥ ${f2(p.semanticMin)}`, advisories };
  }
  if (a.kind !== "not_semantic" && a.kindConfidence >= p.kindAssistMin && a.semantic >= p.kindAssistSemanticMin) {
    return {
      status: "confirmed",
      reason: `kind ${a.kind} (${f2(a.kindConfidence)}) + semantic ${f2(a.semantic)} ≥ ${f2(p.kindAssistSemanticMin)}`,
      advisories
    };
  }
  return { status: "rejected", reason: `semantic ${f2(a.semantic)} < ${f2(p.semanticMin)}`, advisories };
}

export function toValidation(result: SystemOneResult<ValidationQuestions>, cached: boolean, policy: Policy = DEFAULT_POLICY): Validation {
  const answers: RawAnswers = {
    semantic: result.answers.semantic.noul,
    humanText: result.answers.humanText.noul,
    kind: result.answers.kind.choice as SemanticKind,
    kindConfidence: result.answers.kind.confidence
  };
  return {
    ...answers,
    ...decide(answers, policy),
    model: result.model,
    promptVersion: PROMPT_VERSION,
    cached
  };
}

/**
 * Apply a validation to a candidate: final confidence and band come from TypeSafe.
 * Final confidence = round(100 × semantic); a candidate confirmed via the kind-assist rule
 * (semantic between 0.4 and 0.5) is floored at the minimum threshold so it is still shown.
 */
export function applyValidation(c: Candidate, v: Validation, t: Thresholds): Candidate {
  if (v.status === "error") return { ...c, validation: v };
  const raw = Math.round((v.semantic ?? 0) * 100);
  const confidence = v.status === "confirmed" ? Math.max(raw, t.minimum) : raw;
  const band = v.status === "confirmed" ? bandFor(confidence, t) : "ignore";
  return { ...c, validation: v, confidence, band };
}

function describeError(err: unknown): string {
  if (err instanceof AuthenticationError) return "authentication failed — check TYPESAFE_API_KEY";
  if (err instanceof PermissionDeniedError) return "access denied by TypeSafe for this key";
  if (err instanceof TypeSafeError) return err.message;
  return err instanceof Error ? err.message : String(err);
}

/**
 * Validate the candidates of a detection result with TypeSafe.
 * By default only the ≥ minimum band is sent; `all` sends everything with a signal.
 * One failing call never sinks the scan: that candidate keeps its preliminary score.
 * An auth/permission failure stops further calls (they would all fail the same way).
 */
export async function validateResult(result: DetectionResult, opts: ValidateOptions): Promise<DetectionResult> {
  const started = performance.now();
  const model = opts.model ?? opts.client.defaultModel;
  const targets = result.raw.filter((c) => opts.all || c.score >= opts.thresholds.minimum);
  const summary: ValidationSummary = {
    attempted: targets.length,
    confirmed: 0,
    rejected: 0,
    errors: 0,
    cached: 0,
    apiCalls: 0,
    inputTokens: 0,
    model
  };
  const validated = new Map<string, Candidate>();
  const questions = buildQuestions();
  let fatal: string | undefined;
  let done = 0;

  const validateOne = async (c: Candidate): Promise<void> => {
    const key = ValidationCache.key(c, PROMPT_VERSION, model);
    const hit = opts.cache.get(key);
    let v: Validation;
    if (hit) {
      // Cached raw answers are re-decided with the current policy, so tuning never costs API calls.
      const h = hit.validation;
      const redecided =
        h.semantic !== undefined && h.humanText !== undefined && h.kind !== undefined && h.kindConfidence !== undefined
          ? decide({ semantic: h.semantic, humanText: h.humanText, kind: h.kind, kindConfidence: h.kindConfidence }, opts.policy)
          : {};
      v = { ...h, ...redecided, cached: true };
      summary.cached++;
    } else if (opts.offline) {
      v = { status: "error", promptVersion: PROMPT_VERSION, cached: false, error: "not in cache (offline replay)" };
    } else if (fatal) {
      v = { status: "error", promptVersion: PROMPT_VERSION, cached: false, error: fatal };
    } else {
      try {
        summary.apiCalls++;
        const res = await opts.client.systemOne({ state: buildState(c), questions, model });
        v = toValidation(res, false, opts.policy);
        summary.inputTokens += res.usage?.input_tokens ?? 0;
        const { cached: _cached, ...stored } = v;
        void _cached;
        opts.cache.set(key, { validation: stored, inputTokens: res.usage?.input_tokens ?? 0, at: new Date().toISOString() });
      } catch (err) {
        const message = describeError(err);
        if (err instanceof AuthenticationError || err instanceof PermissionDeniedError) fatal = message;
        v = { status: "error", promptVersion: PROMPT_VERSION, cached: false, error: message };
      }
    }
    if (v.status === "confirmed") summary.confirmed++;
    else if (v.status === "rejected") summary.rejected++;
    else summary.errors++;
    validated.set(c.id + "@" + c.file, applyValidation(c, v, opts.thresholds));
    opts.onProgress?.(++done, targets.length);
  };

  // Small worker pool: bounded parallelism, results independent of completion order.
  const queue = [...targets];
  const workers = Array.from({ length: Math.max(1, Math.min(opts.concurrency ?? 4, queue.length)) }, async () => {
    for (let c = queue.shift(); c; c = queue.shift()) await validateOne(c);
  });
  await Promise.all(workers);
  opts.cache.save();
  if (fatal) summary.fatal = fatal;

  const raw = result.raw.map((c) => validated.get(c.id + "@" + c.file) ?? c);
  return summarize(raw, result.filesAnalyzed, result.durationMs + (performance.now() - started), summary);
}
