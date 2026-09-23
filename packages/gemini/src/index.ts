// @jevx/gemini — optional CODE ANALYST (M4), with two providers: Gemini (@google/genai, the only
// importer of it) and OpenRouter (plain fetch). Both share the context loop, prompt, schema,
// parser and cache rules; only the transport differs.
// Produces model-generated EVIDENCE (what a candidate decides, inputs, outcomes, whether the rule
// is exact). It is never ground truth, never a label, and never an input to the JevX policy.
export { GEMINI_PROMPT_VERSION, DEFAULT_GEMINI_MODEL, SYSTEM_INSTRUCTION, RESPONSE_SCHEMA, buildGeminiInput, buildGeminiPrompt, fallbackContext, type GeminiPrompt, type PromptContext } from "./prompt.js";
export { parseGeminiAnalysis, type ParseResult } from "./parse.js";
export { GeminiCache, type GeminiCacheEntry } from "./cache.js";
export {
  DEFAULT_GEMINI_TIMEOUT_MS,
  GeminiCallError,
  createGeminiTransport,
  hasGeminiKey,
  resolveGeminiModel,
  toGeminiError,
  type GeminiClientResult,
  type GeminiGenerateRequest,
  type GeminiReply,
  type GeminiSettings,
  type GeminiTransport
} from "./client.js";
export {
  DEFAULT_XAI_BASE_URL,
  DEFAULT_XAI_MODEL,
  DEFAULT_XAI_PRICE_IN,
  DEFAULT_XAI_PRICE_OUT,
  DEFAULT_XAI_TIMEOUT_MS,
  createXaiTransport,
  hasXaiKey,
  redactXai,
  resolveXaiModel,
  resolveXaiTimeout,
  xaiHttpError,
  xaiSmokeTest,
  type XaiClientResult,
  type XaiSettings
} from "./xai.js";
export { analyzeWithGemini, type GeminiRunOptions } from "./analyze.js";
export { DEFAULT_CONTEXT_BUDGET, DEFAULT_MAX_ROUNDS, runAdaptive, withTimeout, type AdaptiveAnswer, type AdaptiveOptions, type AdaptiveParse, type AdaptiveResult, type AdaptiveTurn } from "./adaptive.js";
export {
  DEFAULT_OPENROUTER_BASE_URL,
  DEFAULT_OPENROUTER_CONCURRENCY,
  DEFAULT_OPENROUTER_MODEL,
  DEFAULT_OPENROUTER_TIMEOUT_MS,
  createOpenRouterTransport,
  hasOpenRouterKey,
  openRouterHttpError,
  redactOpenRouter,
  resolveOpenRouterModel,
  resolveOpenRouterTimeout,
  type OpenRouterClientResult,
  type OpenRouterSettings
} from "./openrouter.js";
export { analyzeWithGemini as analyzeWithCodeAnalyst } from "./analyze.js";
