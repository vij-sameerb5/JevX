export type SignalId =
  | "stringIncludes"
  | "regexOnText"
  | "keywordList"
  | "textBranches"
  | "switchOnText"
  | "normalizeThenMatch"
  | "fuzzyMatch"
  | "hardcodedLabels"
  | "codeContext";

export type SignalWeights = Record<SignalId, number>;

export interface Thresholds {
  minimum: number;
  strong: number;
  veryStrong: number;
}

export interface DetectorOptions {
  signals: SignalWeights;
  thresholds: Thresholds;
  /** Last-token names treated as human text: `userMessage`, `req.body.comment`, ... */
  humanTextNames: string[];
  /** Hardcoded intent/category labels. */
  labels: string[];
  /** Minimum number of word-like strings before a list counts as a keyword list. */
  keywordListMin: number;
  /** Minimum distinct terms matched inline (e.g. a || b || c) before that counts as a keyword list. */
  inlineTermsMin: number;
  /** Function/file name tokens that mark code-processing context (lexers, highlighters). */
  codeContextNames: string[];
}

export type Band = "ignore" | "possible" | "strong" | "veryStrong";
export type RootKind = "if-chain" | "if-group" | "switch" | "ternary" | "function" | "statement";

export interface FiredSignal {
  id: SignalId;
  weight: number;
  evidence: string[];
}

export interface Candidate {
  /** Stable hash of file + normalized source of the decision. Used as the cache key later. */
  id: string;
  file: string;
  line: number;
  column: number;
  endLine: number;
  kind: RootKind;
  /** Enclosing function or method name, if any. */
  context?: string;
  /** Display snippet (≤ 14 lines). */
  snippet: string;
  /** Source sent to TypeSafe: the whole decision, plus the enclosing function for context. */
  source?: {
    /** The decision's code (≤ 40 lines). */
    decision: string;
    /** Enclosing function, windowed around the decision (≤ 60 lines). Absent when the decision is the function. */
    enclosing?: string;
    enclosingStartLine?: number;
  };
  signals: FiredSignal[];
  /** sha256 of the whole file's text. Part of the validation cache key. */
  fileHash: string;
  /** Natural-language terms this decision matches against (for validation context). */
  terms: string[];
  /** Preliminary AST score, 0–100. Never changes after validation. */
  score: number;
  /** Final confidence 0–100, set only when TypeSafe validated the candidate. */
  confidence?: number;
  /** Band from `confidence` when validated, otherwise from the preliminary `score`. */
  band: Band;
  validation?: Validation;
}

export type SemanticKind =
  | "intent_or_topic"
  | "sentiment_or_tone"
  | "moderation_or_safety"
  | "urgency_or_priority"
  | "yes_no_or_agreement"
  | "other_semantic"
  | "not_semantic";

export interface Validation {
  /** confirmed: semantic decision. rejected: TypeSafe says it isn't. error: the call failed. */
  status: "confirmed" | "rejected" | "error";
  /** P(the code decides based on what a person means), 0–1. */
  semantic?: number;
  /** P(the matched text is human-written natural language), 0–1. */
  humanText?: number;
  kind?: SemanticKind;
  kindConfidence?: number;
  model?: string;
  promptVersion: string;
  /** Served from the local cache — no API call. */
  cached: boolean;
  /** Which rule decided the status, e.g. "semantic 0.62 ≥ 0.50". */
  reason?: string;
  /** Non-blocking notes, e.g. low human-text probability. */
  advisories?: string[];
  error?: string;
}

export interface ValidationSummary {
  /** Why validation did not run at all (no key, --no-validate). */
  skipped?: string;
  /** An error that stopped validation part-way (bad key, no access). */
  fatal?: string;
  attempted: number;
  confirmed: number;
  rejected: number;
  errors: number;
  cached: number;
  apiCalls: number;
  inputTokens: number;
  model?: string;
}

export interface DetectionResult {
  filesAnalyzed: number;
  /** Every decision with at least one signal, including the ignore band. */
  raw: Candidate[];
  /** Candidates at or above the minimum threshold, highest score first. */
  candidates: Candidate[];
  counts: Record<Band, number>;
  durationMs: number;
  /** Present once the validation step has run (or was skipped, with the reason). */
  validation?: ValidationSummary;
}
