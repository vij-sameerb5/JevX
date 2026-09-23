// @jevx/typesafe — the only package allowed to talk to @typesafe-ai/sdk (M3).
// Decides whether an AST candidate is semantically real; never decides what is a candidate.
import { TypeSafeClient, TypeSafeError, type Fetch } from "@typesafe-ai/sdk";

export {
  DECISION_PROMPT_VERSION,
  DEFAULT_DECISION_POLICY,
  DecisionCache,
  buildDecisionQuestions,
  buildDecisionState,
  classifyAnswers,
  toAnswers,
  validateDecisions,
  type DecisionClient,
  type DecisionPolicy,
  type DecisionQuestions,
  type ValidateDecisionsOptions
} from "./decision.js";
export { ValidationCache, type CacheEntry } from "./cache.js";
export { PROMPT_VERSION, KIND_CRITERIA, buildQuestions, buildState, type ValidationQuestions } from "./questions.js";
export {
  DEFAULT_POLICY,
  decide,
  applyValidation,
  toValidation,
  validateResult,
  type Policy,
  type RawAnswers,
  type SystemOneClient,
  type ValidateOptions
} from "./validate.js";

export interface ClientSettings {
  apiKey?: string;
  baseURL?: string;
  model?: string;
  timeoutMs?: number;
  /** Test hook: custom transport. */
  fetch?: Fetch;
}

export type ClientResult = { client: TypeSafeClient; error?: undefined } | { client?: undefined; error: string };

/** True when a key is available from config or TYPESAFE_API_KEY (empty values don't count). */
export function hasApiKey(settings: ClientSettings = {}): boolean {
  return Boolean(settings.apiKey?.trim() || process.env.TYPESAFE_API_KEY?.trim());
}

/** Build a client, or explain why one can't be built — never throws. */
export function createClient(settings: ClientSettings = {}): ClientResult {
  if (!hasApiKey(settings)) {
    return { error: "TYPESAFE_API_KEY is not set" };
  }
  try {
    const client = new TypeSafeClient({
      apiKey: settings.apiKey?.trim() || undefined,
      baseURL: settings.baseURL,
      defaultModel: settings.model,
      timeout: settings.timeoutMs,
      fetch: settings.fetch
    });
    return { client };
  } catch (err) {
    return { error: err instanceof TypeSafeError || err instanceof Error ? err.message : String(err) };
  }
}

/** Mask a key for display: tsk_…a1b2. */
export function maskKey(key: string | undefined): string {
  const k = key?.trim();
  if (!k) return "(not set)";
  return k.length <= 8 ? "••••" : `${k.slice(0, 4)}…${k.slice(-4)}`;
}
