// User-facing config shape. Re-exported by the `jevx` package: `import { defineConfig } from "jevx"`.
import type { SignalWeights, Thresholds } from "./types.js";

export interface JevxConfig {
  include?: string[];
  exclude?: string[];
  languages?: ("typescript" | "javascript")[];
  thresholds?: Partial<Thresholds>;
  signals?: Partial<SignalWeights>;
  detector?: {
    /** Extra last-token names treated as human text (added to the defaults). */
    humanTextNames?: string[];
    /** Extra intent/category labels (added to the defaults). */
    labels?: string[];
    /** Minimum terms before a list counts as a keyword list. Default 4. */
    keywordListMin?: number;
    /** Minimum distinct inline terms (a || b || c) that count as a keyword list. Default 3. */
    inlineTermsMin?: number;
    /** Extra name tokens that mark code-processing context (added to the defaults). */
    codeContextNames?: string[];
  };
  typesafe?: {
    /** Read from TYPESAFE_API_KEY when omitted. Never write the key into this file. */
    apiKey?: string;
    /** Model alias. Default: the SDK default (jev-latest). */
    model?: string;
    /** API root. Default: TYPESAFE_BASE_URL or https://api.typesafe.ai. */
    baseURL?: string;
    /** Parallel requests during validation. Default 4. */
    concurrency?: number;
    /** Per-attempt timeout in ms. Default: SDK default (10000). */
    timeoutMs?: number;
  };
  /**
   * Gemini code analyst (optional, `jevx analyze --gemini`). The key is read from
   * GEMINI_API_KEY only — it is never accepted from config.
   */
  gemini?: {
    /** Model id. Default: GEMINI_MODEL or gemini-3.8-flash. */
    model?: string;
    /** API root override (tests / proxies). Default: GEMINI_BASE_URL or Google's endpoint. */
    baseURL?: string;
    /** Per-request timeout in ms. Default 30000. */
    timeoutMs?: number;
    /** Parallel requests. Default 4. */
    concurrency?: number;
    /**
     * Adaptive repository context. JevX indexes the whole repo; Gemini starts with the
     * candidate's file and asks for more (callees, callers, types, constants, folder, repo
     * overview) until it can explain the decision.
     */
    context?: {
      /** adaptive (default) or local (first round only: the candidate's file). */
      mode?: "adaptive" | "local";
      /** Max Gemini rounds per candidate. Default 4. */
      maxRounds?: number;
      /** Per-candidate cost guard in characters (0 = unlimited). Default 250000. */
      maxChars?: number;
      /** Files up to this size are sent whole in round 1; larger ones as outline + function. Default 60000. */
      maxWholeFileChars?: number;
    };
  };
  /**
   * OpenRouter code analyst (optional, `jevx analyze --openrouter`). A second provider for the
   * same analyst: same prompt, schema, adaptive context and cache rules as gemini (it also uses
   * gemini.context and gemini.concurrency). The key is read from OPENROUTER_API_KEY only.
   */
  openrouter?: {
    /** Model id. Default: OPENROUTER_MODEL or x-ai/grok-4.6 (the M5b analyst). */
    model?: string;
    /** API root. Default: OPENROUTER_BASE_URL or https://openrouter.ai/api/v1. */
    baseURL?: string;
    /** Per-request timeout in ms. Default: OPENROUTER_TIMEOUT_MS or 120000. */
    timeoutMs?: number;
    /** Parallel requests for `analyze --openrouter`. Default 2. */
    concurrency?: number;
  };
  /**
   * Direct xAI (Grok) — the DEFAULT code analyst for M5b (`jevx boundary`, `jevx check --grok`).
   * The key is read from XAI_API_KEY only. xAI reports no price, so cost is calculated from the
   * prices below and labelled as calculated.
   */
  xai?: {
    /** Model id. Default: XAI_MODEL or grok-4.6. */
    model?: string;
    /** API root. Default: XAI_BASE_URL or https://api.x.ai/v1. */
    baseURL?: string;
    /** Per-request timeout in ms. Default: XAI_TIMEOUT_MS or 120000. */
    timeoutMs?: number;
    /** USD per million input tokens (listed price for grok-4.6: 2). */
    pricePerMInput?: number;
    /** USD per million output tokens (listed price for grok-4.6: 6). */
    pricePerMOutput?: number;
  };
  safety?: {
    gitCheckpoint?: boolean;
    checkpointMode?: "branch" | "stash";
    typecheckAfterApply?: boolean;
    testCommand?: string;
  };
}

export function defineConfig(config: JevxConfig): JevxConfig {
  return config;
}

export const DEFAULT_INCLUDE = ["**/*.{ts,tsx,js,jsx,mjs,cjs}"];
export const DEFAULT_EXCLUDE = ["**/*.test.*", "**/*.spec.*", "**/__tests__/**", "node_modules", "dist", "build", "coverage"];
