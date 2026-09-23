import type { Band, Candidate, DetectionResult, DetectorOptions, SignalId, SignalWeights, Thresholds } from "./types.js";

export const SIGNAL_LABELS: Record<SignalId, string> = {
  stringIncludes: ".includes() / .startsWith() / .endsWith() on human text",
  regexOnText: "Regex matched against natural-language text",
  keywordList: "Large keyword list",
  textBranches: "Three or more branches keyed on text",
  switchOnText: "switch over freeform text",
  normalizeThenMatch: "Normalization (toLowerCase / trim) then keyword matching",
  fuzzyMatch: "Fuzzy / string-similarity logic",
  hardcodedLabels: "Hardcoded intent or category labels",
  codeContext: "Code-processing context (lexer, tokenizer, highlighter) — penalty"
};

export const DEFAULT_SIGNALS: SignalWeights = {
  stringIncludes: 25,
  regexOnText: 20,
  keywordList: 20,
  textBranches: 15,
  switchOnText: 15,
  normalizeThenMatch: 10,
  fuzzyMatch: 20,
  hardcodedLabels: 25,
  // Negative: matching source code or a DSL is deterministic parsing, not a judgement call.
  codeContext: -30
};

export const DEFAULT_THRESHOLDS: Thresholds = { minimum: 50, strong: 75, veryStrong: 90 };

export const DEFAULT_HUMAN_TEXT_NAMES = [
  "message", "msg", "text", "query", "body", "comment", "comments", "input", "prompt",
  "description", "desc", "content", "subject", "title", "reply", "feedback", "review",
  "note", "notes", "utterance", "sentence", "phrase", "question", "answer", "caption",
  "bio", "summary", "transcript", "tweet", "term", "search", "chat", "complaint",
  "reason", "remark", "headline", "statement", "sms", "transcription"
];

export const DEFAULT_LABELS = [
  "refund", "support", "spam", "billing", "complaint", "urgent", "cancel", "cancellation",
  "sales", "greeting", "positive", "negative", "neutral", "angry", "happy", "sad", "toxic",
  "abuse", "abusive", "question", "feedback", "bug", "feature", "praise", "escalate",
  "escalation", "technical", "account", "payment", "shipping", "delivery", "return",
  "returns", "order", "help", "unsubscribe", "offensive", "profanity", "sentiment",
  "intent", "priority", "high", "low", "medium", "fraud", "phishing", "legit", "other",
  "general", "inquiry", "enquiry", "order_status", "tech_support", "low_priority",
  "high_priority"
];

export const DEFAULT_CODE_CONTEXT_NAMES = [
  "tokenize", "tokenizer", "token", "tokens", "lex", "lexer", "lexeme", "highlight", "highlighter",
  "syntax", "grammar", "ast", "compile", "compiler", "transpile", "transpiler", "minify", "codegen"
];

export function defaultDetectorOptions(): DetectorOptions {
  return {
    signals: { ...DEFAULT_SIGNALS },
    thresholds: { ...DEFAULT_THRESHOLDS },
    humanTextNames: [...DEFAULT_HUMAN_TEXT_NAMES],
    labels: [...DEFAULT_LABELS],
    keywordListMin: 4,
    inlineTermsMin: 3,
    codeContextNames: [...DEFAULT_CODE_CONTEXT_NAMES]
  };
}

export function mergeDetectorOptions(partial: Partial<DetectorOptions> = {}): DetectorOptions {
  const base = defaultDetectorOptions();
  return {
    ...base,
    ...partial,
    signals: { ...base.signals, ...(partial.signals ?? {}) },
    thresholds: { ...base.thresholds, ...(partial.thresholds ?? {}) }
  };
}

export function bandFor(score: number, t: Thresholds): Band {
  if (score >= t.veryStrong) return "veryStrong";
  if (score >= t.strong) return "strong";
  if (score >= t.minimum) return "possible";
  return "ignore";
}

/** Rank by final confidence when validated, else by preliminary score. */
export function rankOf(c: Candidate): number {
  return c.confidence ?? c.score;
}

/** Build a DetectionResult from raw candidates: shown list (non-ignore, ranked) and band counts. */
export function summarize(
  raw: Candidate[],
  filesAnalyzed: number,
  durationMs: number,
  validation?: DetectionResult["validation"]
): DetectionResult {
  const candidates = raw
    .filter((c) => c.band !== "ignore")
    // Validated candidates first (final confidence), then unvalidated ones (preliminary) —
    // the two scales aren't comparable, so they aren't interleaved.
    .sort(
      (a, b) =>
        Number(b.confidence !== undefined) - Number(a.confidence !== undefined) ||
        rankOf(b) - rankOf(a) ||
        a.file.localeCompare(b.file) ||
        a.line - b.line
    );
  const counts: Record<Band, number> = { ignore: 0, possible: 0, strong: 0, veryStrong: 0 };
  for (const c of raw) counts[c.band]++;
  return { filesAnalyzed, raw, candidates, counts, durationMs, ...(validation ? { validation } : {}) };
}
