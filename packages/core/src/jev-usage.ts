// Layer B of the M5b decision-boundary dataset: OBSERVED Jev usage.
//
// Found deterministically (no AI). Answers exactly one factual question: "where in this
// repository is Jev actually used?". It never says whether Jev SHOULD be used anywhere.
// An observed usage is evidence of a developer's choice — NOT ground truth.

export const JEV_PRIMITIVE_KINDS = ["noul", "choice", "score"] as const;
export type JevPrimitiveKind = (typeof JEV_PRIMITIVE_KINDS)[number];

/**
 * How sure the FINDER is that this is real Jev usage (not whether Jev fits):
 *   definite  — symbols resolved to a Jev SDK import (@typesafe-ai/sdk, @typesafeai/sdk,
 *               @ai-sdk/typesafe-ai): systemOne, choice/noul/score, experimental_evaluate on a
 *               TypeSafe model.
 *   likely    — the known Jev HTTP API (api.typesafe.ai /v1/systemone), Jev via OpenRouter
 *               (typesafe/jev models, /api/alpha/decisions) or an AI gateway `typesafe-ai/jev` model.
 *   wrapper   — calls a local function that verifiably performs a definite/likely Jev call.
 *   uncertain — Jev-looking but unverified (unresolved `systemOne`, question-shaped objects with no
 *               Jev call in reach…). Recorded separately; NEVER an anchor.
 */
export const JEV_EVIDENCE_TIERS = ["definite", "likely", "wrapper", "uncertain"] as const;
export type JevEvidenceTier = (typeof JEV_EVIDENCE_TIERS)[number];

/**
 * decision  — Jev questions are defined here and (here or via a wrapper) asked. The anchor for
 *             "why Jev here?".
 * questions — Jev questions are defined here but asked elsewhere (a question factory / set).
 * plumbing  — executes or forwards Jev calls without defining a decision (clients, providers,
 *             proxies, bridges). Recorded, not an anchor.
 */
export type JevSiteRole = "decision" | "questions" | "plumbing";

export interface JevQuestionRef {
  /** Question id (the key in the questions object), when statically visible. */
  key?: string;
  primitive: JevPrimitiveKind | "unknown";
  /** Question text, secret-scrubbed and clipped (public projects only in the dataset). */
  text?: string;
  /** choice: criteria keys (outcomes); noul: none; score: legend size. */
  outcomes?: string[];
  scale?: number;
  line: number;
  how: "sdk_builder" | "raw_object";
  tier: JevEvidenceTier;
}

export type JevCallKind =
  | "sdk_system_one" // client.systemOne(...)
  | "sdk_system_one_ref" // client.systemOne passed / cast, not called here
  | "ai_sdk_evaluate" // experimental_evaluate({ model: typeSafeAi…, questions })
  | "http_typesafe" // fetch(api.typesafe.ai/v1/systemone)
  | "http_openrouter_jev" // OpenRouter decisions endpoint / typesafe/jev model
  | "http_gateway_jev" // AI gateway `typesafe-ai/jev`
  | "http_local_jev_proxy" // the app's own /api/jev route — counts only if the project has a proxy that calls Jev
  | "wrapper_call"; // a local function that performs one of the above

export interface JevCallRef {
  kind: JevCallKind;
  line: number;
  /** The call expression, clipped and scrubbed. */
  text: string;
  /** For wrapper_call: the wrapper's name and file. */
  via?: { name: string; file: string; line: number };
  tier: JevEvidenceTier;
}

export interface JevSite {
  /** Stable: sha(file + unit name + start line). */
  id: string;
  file: string;
  unit: { name: string; start: number; end: number };
  role: JevSiteRole;
  tier: JevEvidenceTier;
  questions: JevQuestionRef[];
  calls: JevCallRef[];
  /** Module-level question sets this function uses (e.g. ACTION_QUESTIONS). */
  questionSets: string[];
  /** Why the finder believes this (human-readable facts, no inference). */
  evidence: string[];
  /** Functions that call this one (≤ 10). */
  callers: { file: string; name: string; line: number }[];
  codeHash: string;
}

export interface JevUsageReport {
  /** Finder version — part of every downstream cache key. */
  version: string;
  root: string;
  /** Sites with tier definite / likely / wrapper. */
  sites: JevSite[];
  /** Tier uncertain: kept apart, never anchors. */
  uncertain: JevSite[];
  /** Matches in test files (fakes such as local `noul()` helpers or stub `systemOne`) — excluded. */
  excluded: { file: string; line: number; reason: string }[];
  stats: {
    files: number;
    sdkImports: number;
    decisionSites: number;
    questionSites: number;
    plumbingSites: number;
    uncertainSites: number;
    questions: number;
  };
}
