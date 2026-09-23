// The decision-boundary vocabulary (Phase 1 reboot).
// Language-independent: nothing here knows about TypeScript. Analyzers for other languages
// produce the same DecisionCandidate shape, and the dataset/eval layers only see this shape.

export const LABELS = ["NOT_JEV", "POSSIBLE_JEV", "STRONG_JEV"] as const;
export type Label = (typeof LABELS)[number];

/** Jev question type that would express the decision. */
export const PRIMITIVES = ["noul", "choice", "score", "none"] as const;
export type Primitive = (typeof PRIMITIVES)[number];

/** What kind of judgment a decision makes. Grows only from real-project findings. */
export const DECISION_CATEGORIES = {
  classification: "Assigns an input to one of several classes or labels.",
  routing: "Sends work, a request or a message to one destination / handler / queue.",
  triage: "Sorts incoming items by what needs to happen to them first.",
  prioritization: "Orders or levels items by importance or urgency.",
  scoring: "Grades something on a scale (quality, fit, likelihood, severity).",
  ranking: "Orders candidates by how well they fit.",
  matching: "Decides whether two things are the same / related (dedup, entity match).",
  selection: "Picks one tool, model, provider, resource or strategy from several.",
  next_action: "Decides what the system or user should do next.",
  workflow_branching: "Chooses a path through a multi-step process.",
  escalation: "Decides between automatic handling and a human.",
  risk: "Judges risk, fraud or trustworthiness.",
  moderation: "Judges safety, abuse, spam or policy compliance of content.",
  security_judgment: "Judges whether an action or request is suspicious.",
  verification: "Judges whether an output / result / claim is correct or good enough.",
  code_review: "Judges code, PRs or changes (triage, risk, reviewer choice).",
  interpretation: "Interprets a document, policy, reply or instruction.",
  anomaly: "Decides whether an observation is abnormal and what it means.",
  recommendation: "Decides what to suggest to someone.",
  extraction_choice: "Decides which field / label / value a piece of data carries.",
  dependency: "Decides ordering or dependency between tasks.",
  ui_context: "Decides what to show a user given their context.",
  game_strategy: "Chooses a move or strategy in a game or simulation.",
  other: "A bounded judgment that fits none of the above."
} as const;
export type DecisionCategory = keyof typeof DECISION_CATEGORIES;

/** Why a decision is NOT a Jev opportunity — exact code is the right tool. */
export const HARD_NEGATIVE_REASONS = {
  arithmetic: "Pure calculation; the answer is a formula.",
  sorting_filtering: "Ordering or filtering by an exact key or comparator.",
  exact_lookup: "Exact lookup by key / id / database query.",
  parsing: "Parsing a syntax, protocol, format or character stream.",
  compiler_ast: "Compiler, AST, lexer or code-model logic.",
  cryptography: "Cryptography, hashing, signing.",
  schema_validation: "Validating shape / format / type of data.",
  exact_business_rule: "A business rule over exact values that must stay exact (limits, thresholds, legal rules).",
  protocol_status: "HTTP status, error codes, protocol states.",
  library_error_text: "Branches on machine-generated error text from a library or the app itself.",
  state_machine: "Deterministic state machine transitions.",
  feature_flag: "Feature flags / config switches / environment checks.",
  file_type: "File extension, MIME type, path handling.",
  performance: "Performance heuristics (batch sizes, retries, caching).",
  data_transformation: "Reshaping data; no judgment is made.",
  enum_dispatch: "Dispatch on a closed, typed set of values (enum, union, discriminant).",
  ui_plumbing: "UI event / rendering plumbing.",
  trivial_guard: "Null / empty / existence guard with no judgment.",
  other: "Exact code is correct for another reason (explain in reasoning)."
} as const;
export type HardNegativeReason = keyof typeof HARD_NEGATIVE_REASONS;

/** Independent, cheap, structural proposers of decision candidates. */
export const GENERATOR_IDS = ["outcome-set", "branch-map", "selector", "scorer", "gate", "text-match"] as const;
export type GeneratorId = (typeof GENERATOR_IDS)[number];

/** Where a value read by a decision comes from. */
export const PROVENANCE = [
  "parameter",
  "request_input",
  "awaited_call",
  "call_result",
  "caught_error",
  "ui_event",
  "env_config",
  "constant",
  "instance_state",
  "unknown"
] as const;
export type Provenance = (typeof PROVENANCE)[number];

export interface InputRef {
  name: string;
  provenance: Provenance;
  /** Declared / inferred type text, when known. */
  type?: string;
  /** Closed type (literal union, enum, boolean) — the language already bounds its values. */
  closedType?: boolean;
  textual?: boolean;
  numeric?: boolean;
}

export type OutcomeKind = "enumerated" | "boolean" | "numeric" | "action" | "object" | "mixed" | "unknown";

export interface OutcomeSet {
  kind: OutcomeKind;
  /** Distinct literal outcomes / called actions, as written in the code. */
  values: string[];
}

export interface DecisionUnit {
  kind: "function" | "method" | "arrow" | "block";
  /** Qualified name: `Class.method`, `name`, or `<anonymous@line>`. */
  name: string;
  start: number;
  end: number;
}

export interface GeneratorHit {
  generator: GeneratorId;
  evidence: string[];
  /** Lines of the boundary this generator points at. */
  region?: [number, number];
}

export type FeatureValue = number | boolean | string;

export interface Triage {
  verdict: "NOT_JEV";
  reason: HardNegativeReason;
  detail: string;
}

export interface SemanticAnswers {
  judgment: number;
  bounded: number;
  deterministicIsCorrect: number;
  primitive: Primitive;
  primitiveConfidence: number;
  category: DecisionCategory;
  categoryConfidence: number;
  model?: string;
  promptVersion: string;
  cached: boolean;
}

// ─── Gemini code-analyst evidence (M4) ───────────────────────────────────
// Model-generated EVIDENCE about what a candidate does. Never a label, never ground truth,
// never an input to the JevX policy. Candidate labels, where they exist, come only from humans.

export const UNCERTAINTY = ["low", "medium", "high"] as const;
export type Uncertainty = (typeof UNCERTAINTY)[number];

export interface GeminiAnalysis {
  /** What the function does, in one or two sentences. */
  summary: string;
  /** What is being decided. */
  decision: string;
  /** State → outcome, e.g. "task characteristics → model tier". */
  decision_boundary: string;
  inputs: { name: string; role: string }[];
  outcomes: string[];
  decision_type: DecisionCategory | "not_a_decision";
  /** The code as written applies an exact, fully specified rule. */
  deterministic_logic: boolean;
  /** The exact rule appears to stand in for a judgment (meaning, quality, risk, fit…). */
  approximates_judgment: boolean;
  judgment_kind: string | null;
  plausible_primitive: Primitive;
  stays_deterministic: string[];
  reasoning: string;
  uncertainty: Uncertainty;
  /** Gemini's own judgment: was the context it saw enough to explain this decision? */
  context_sufficient: boolean;
  /** What else it would need: a catalog id JevX offered, or a free-text description. */
  missing_context: { request: string; why: string }[];
  /** Which context items (ids) it actually relied on. */
  context_used: string[];
  /** How well it understood the code (not whether it's a Jev opportunity). */
  understanding_confidence: Uncertainty;
  /** Debugging aid only. NEVER a label, never used by the policy or the dataset labels. */
  model_hypothesis?: { label: Label; note: string } | null;
}

/** Why the adaptive context loop stopped. */
export type ContextStop = "sufficient" | "max_rounds" | "budget" | "nothing_more" | "local_mode";

/** Which code-analyst provider produced the evidence. Same prompt, schema and loop for both. */
export const CODE_ANALYSTS = ["gemini", "openrouter"] as const;
export type CodeAnalystProvider = (typeof CODE_ANALYSTS)[number];

export interface GeminiEvidence {
  kind: "model_generated_evidence";
  /** Absent on evidence written before OpenRouter existed = "gemini". */
  provider?: CodeAnalystProvider;
  model: string;
  promptVersion: string;
  analysis: GeminiAnalysis;
  /** What JevX showed Gemini, and how the loop ended. */
  context: {
    mode: ContextMode;
    rounds: number;
    items: { id: string; kind: ContextKind; chars: number }[];
    chars: number;
    stoppedBy: ContextStop;
  };
  /**
   * false = Gemini said the context was insufficient even after expansion: weak evidence,
   * shown with a warning and never counted as "understood".
   */
  usable: boolean;
  cached: boolean;
  at: string;
}

// ─── Repository context (for the Gemini analyst) ─────────────────────────
// JevX indexes the whole repository; per candidate it offers Gemini a CATALOG of related
// context (ids + titles, no code) and sends the actual text of an item only when needed.

export type ContextMode = "local" | "adaptive";

export type ContextKind =
  | "file" // the whole file (line-numbered)
  | "file_outline" // imports, exports, signatures of a file
  | "unit" // one function / method
  | "callee" // a function the candidate calls
  | "caller" // a function that calls the candidate
  | "type" // interface / type alias / enum / class used by the candidate
  | "constant" // module-level constant / config object the candidate reads
  | "importer" // a file that imports the candidate's file
  | "module" // outline of the candidate's folder
  | "repo"; // repository overview (package, README head, tree)

/** A catalog entry: what JevX can show, without the text. */
export interface ContextRef {
  id: string;
  kind: ContextKind;
  title: string;
  file?: string;
  lines?: [number, number];
  /** Size of the item's text, so budgets are predictable. */
  chars: number;
}

/** An item with its (secret-scrubbed) text. */
export interface ContextItem extends ContextRef {
  text: string;
  /** sha256 of the text — used to invalidate cached analyses when related code changes. */
  hash: string;
}

/** Implemented by the analyzer's RepoIndex; consumed by the Gemini package. */
/**
 * Where adaptive context starts: a file and a function in it. A DecisionCandidate is one;
 * so is an observed Jev site (M5b). Only these fields are read.
 */
export interface ContextAnchor {
  file: string;
  unit: { name: string; start: number };
}

export interface ContextProvider {
  /** Starting context for an anchor: its file (or outline + unit) and the related catalog. */
  initial(c: ContextAnchor): { items: ContextItem[]; catalog: ContextRef[] };
  /** Text for a catalog id (any id previously offered, or a known id format). */
  resolve(id: string): ContextItem | undefined;
  /** Catalog entries related to an item that was just added (graph expansion). */
  neighbors(id: string): ContextRef[];
  /** Best catalog matches for a free-text request (symbol or file names in it). */
  search(request: string, limit?: number): ContextRef[];
  /** Current hash of an item (undefined if it no longer exists) — for cache validation. */
  hashOf(id: string): string | undefined;
}

export interface Classification {
  label: Label;
  /** Who produced it: deterministic triage, the TypeSafe policy. Humans label in the dataset. */
  source: "triage" | "typesafe";
  reason: string;
  policyVersion: string;
}

export interface Explanation {
  /** One-line description of the decision, generated from structure. */
  decision: string;
  inputs: string;
  outcomes: string;
  suggestedPrimitive: Primitive;
  primitiveWhy: string;
  /** What must stay deterministic around the decision (guards, side effects, formatting). */
  staysDeterministic: string[];
}

export interface DecisionCandidate {
  /** Stable across edits: derived from file + qualified unit name (+ ordinal), not from the code. */
  id: string;
  language: string;
  file: string;
  unit: DecisionUnit;
  boundary: { start: number; end: number };
  generators: GeneratorHit[];
  inputs: InputRef[];
  outputs: OutcomeSet;
  features: Record<string, FeatureValue>;
  triage?: Triage;
  semantic?: SemanticAnswers;
  /** Why semantic validation failed for this candidate (it stays unclassified). */
  semanticError?: string;
  /** Gemini code-analyst evidence (optional, --gemini). Not a label. */
  gemini?: GeminiEvidence;
  geminiError?: string;
  /** OpenRouter code-analyst evidence (optional, --openrouter). Same format as gemini. Not a label. */
  openrouter?: GeminiEvidence;
  openrouterError?: string;
  classification?: Classification;
  explanation: Explanation;
  hashes: { code: string; file: string };
  /** Source of the unit. In memory only — the dataset layer decides whether it may be stored. */
  code: string;
}

export interface ProjectProfile {
  name: string;
  languages: string[];
  frameworks: string[];
  files: { analyzed: number; skipped: number; byRole: Record<string, number> };
}

/** Per-run totals of a code-analyst provider. */
export interface CodeAnalystSummary {
  attempted: number;
  apiCalls: number;
  cached: number;
  errors: number;
  inputTokens: number;
  outputTokens: number;
  model?: string;
  promptVersion?: string;
  skipped?: string;
  fatal?: string;
  /** Adaptive context: candidates that needed expansion / ended insufficient. */
  expanded?: number;
  insufficient?: number;
  rounds?: number;
}

export interface AnalysisResult {
  root: string;
  profile: ProjectProfile;
  /** Candidates that passed filtering (triage did not rule them out). */
  candidates: DecisionCandidate[];
  /** Candidates deterministic triage marked NOT_JEV, with the reason. Kept, never hidden. */
  filtered: DecisionCandidate[];
  stats: { units: number; generated: number; durationMs: number };
  versions: { analysis: string };
  gemini?: CodeAnalystSummary;
  /** Same shape as gemini, for the OpenRouter provider. */
  openrouter?: CodeAnalystSummary;
  semantic?: {
    attempted: number;
    apiCalls: number;
    cached: number;
    errors: number;
    inputTokens: number;
    model?: string;
    promptVersion?: string;
    policyVersion?: string;
    skipped?: string;
    fatal?: string;
  };
}
