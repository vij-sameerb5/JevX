// @jevx/boundary — M5b: learn WHERE and WHEN real developers choose Jev, from real Jev usage.
//   B observed usage (from @jevx/analyzer's findJevUsage) → C "why Jev here?" → D "why deterministic
//   there?" → E cross-project patterns. Model-agnostic (any code-analyst transport); Grok 4.6 via
//   OpenRouter is the primary analyst for this phase. Nothing here is ground truth.
export * from "./schema.js";
export {
  BOUNDARY_PROMPT_VERSION,
  PATTERN_PROMPT_VERSION,
  USAGE_SCHEMA,
  CONTRAST_SCHEMA,
  SYNTHESIS_SCHEMA,
  buildUsagePrompt,
  buildContrastPrompt,
  buildSynthesisPrompt,
  siteFacts,
  type ContrastInput,
  type SynthesisGroupInput
} from "./prompt.js";
export { parseUsageAnalysis, parseContrastAnalysis, parseSynthesis, jsonOf } from "./parse.js";
export {
  aggregate,
  analysisId,
  contrastId,
  PATTERN_CATEGORIES,
  type Aggregation,
  type EvidenceGroup,
  type EvidenceRef,
  type PatternCategory,
  type RejectedExplanation
} from "./aggregate.js";
export { renderPatterns } from "./markdown.js";
export { selectContrasts, importGraph, DEFAULT_MAX_CONTRASTS, type SelectedContrast, type ContrastSelection } from "./contrasts.js";
export { BoundaryCache, cacheKey, type BoundaryCacheEntry } from "./cache.js";
export { runBoundary, pickAnchors, factsOf, DEFAULT_MAX_USAGES, DEFAULT_BUDGET_TOKENS, type BoundaryRunOptions, type BoundaryRunResult, type RunEvent } from "./run.js";
export { derivePatterns, synthesisInput, DEFAULT_BATCH_SIZE, DEFAULT_MAX_BATCHES, DEFAULT_SYNTHESIS_TIMEOUT_MS, type PatternRunOptions, type PatternEvent } from "./patterns.js";
export { BoundaryStore } from "./store.js";
