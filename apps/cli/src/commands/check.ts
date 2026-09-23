import path from "node:path";
import chalk from "chalk";
import { loadConfig } from "@jevx/core";
import { createClient, hasApiKey, maskKey, PROMPT_VERSION, ValidationCache } from "@jevx/typesafe";
import { GeminiCache, createGeminiTransport, createOpenRouterTransport, createXaiTransport, hasGeminiKey, hasOpenRouterKey, hasXaiKey, resolveGeminiModel, resolveOpenRouterModel, resolveXaiModel, resolveXaiTimeout, xaiSmokeTest } from "@jevx/gemini";
import { selfModule } from "../self.js";

/** `jevx check`: config, key, API reachability, cache. Exit 0 only if validation can run. */
export interface CheckOptions {
  /** Treat an unusable Gemini analyst as a failure (default: Gemini is optional). */
  requireGemini?: boolean;
  geminiModel?: string;
  /** Treat an unusable OpenRouter analyst as a failure (default: optional). */
  requireOpenRouter?: boolean;
  openrouterModel?: string;
  /** Treat an unusable direct-xAI (Grok) analyst as a failure. `--grok` sets this. */
  requireGrok?: boolean;
  grokModel?: string;
  /** With --grok: also send a tiny no-code request that proves the model answers. */
  grokSmokeTest?: boolean;
}

export async function runCheck(root: string, configFile?: string, opts: CheckOptions = {}): Promise<number> {
  const out = (s = "") => process.stdout.write(s + "\n");
  const ok = (s: string) => out(`${chalk.green("✓")} ${s}`);
  const bad = (s: string) => out(`${chalk.red("✗")} ${s}`);
  const info = (s: string) => out(`${chalk.gray("•")} ${s}`);
  let failed = false;

  let cfg;
  try {
    cfg = await loadConfig(root, { configFile, selfModule: selfModule() });
    if (cfg.configPath) ok(`Config: ${path.relative(root, cfg.configPath) || cfg.configPath}`);
    else info("Config: none found, using defaults (run jevx init to create one)");
  } catch (err) {
    bad(`Config failed to load: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  const ts = cfg.raw.typesafe ?? {};
  const key = ts.apiKey?.trim() || process.env.TYPESAFE_API_KEY?.trim();
  if (hasApiKey({ apiKey: ts.apiKey })) ok(`TypeSafe key: ${maskKey(key)} (${ts.apiKey ? "from config" : "from TYPESAFE_API_KEY"})`);
  else {
    bad("TypeSafe key: not set. export TYPESAFE_API_KEY=… (scans still work, with preliminary scores only)");
    failed = true;
  }

  const made = createClient({ apiKey: ts.apiKey, baseURL: ts.baseURL, model: ts.model, timeoutMs: ts.timeoutMs });
  if (made.client) {
    info(`API: ${made.client.baseURL} · model ${ts.model ?? made.client.defaultModel}`);
    try {
      const models = await made.client.models.list({ timeout: 10_000, retry: { maxRetries: 0 } });
      ok(`API reachable · ${models.length} model${models.length === 1 ? "" : "s"}: ${models.map((m) => m.name).join(", ")}`);
    } catch (err) {
      bad(`API not reachable: ${err instanceof Error ? err.message : String(err)}`);
      failed = true;
    }
  }

  // Gemini code analyst — optional. The key is never printed (not even masked).
  const g = cfg.raw.gemini ?? {};
  const gModel = resolveGeminiModel(opts.geminiModel, g.model);
  const gFail = (m: string) => {
    if (opts.requireGemini) {
      bad(m);
      failed = true;
    } else info(m);
  };
  if (!hasGeminiKey()) gFail("Gemini key: not set (optional — export GEMINI_API_KEY=… to use jevx analyze --gemini)");
  else {
    ok("Gemini key: set (from GEMINI_API_KEY; never printed, never stored)");
    const made = createGeminiTransport({ model: gModel, baseURL: g.baseURL, timeoutMs: Math.min(g.timeoutMs ?? 15_000, 15_000) });
    if (!made.transport) gFail(`Gemini: ${made.error}`);
    else {
      try {
        const m = await made.transport.ping();
        ok(`Gemini API reachable · model ${gModel}${m.displayName ? ` (${m.displayName})` : ""} · this check sent no code`);
      } catch (err) {
        gFail(`Gemini API not usable for model ${gModel}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  const gCache = new GeminiCache(root);
  info(`Gemini cache: ${gCache.size} analysed candidate${gCache.size === 1 ? "" : "s"} in ${path.relative(root, gCache.file)}`);

  // OpenRouter code analyst — optional second provider. Key never printed (not even masked).
  const o = cfg.raw.openrouter ?? {};
  const oModel = resolveOpenRouterModel(opts.openrouterModel, o.model);
  const oFail = (m: string) => {
    if (opts.requireOpenRouter) {
      bad(m);
      failed = true;
    } else info(m);
  };
  if (!hasOpenRouterKey()) oFail("OpenRouter key: not set (optional — export OPENROUTER_API_KEY=… to use jevx analyze --openrouter)");
  else {
    ok("OpenRouter key: set (from OPENROUTER_API_KEY; never printed, never stored)");
    const made = createOpenRouterTransport({ model: oModel, baseURL: o.baseURL, timeoutMs: 15_000 });
    if (!made.transport) oFail(`OpenRouter: ${made.error}`);
    else {
      try {
        const m = await made.transport.ping();
        ok(`OpenRouter API reachable · key valid · model ${oModel}${m.displayName ? ` (${m.displayName})` : ""} · this check sent no code`);
      } catch (err) {
        oFail(`OpenRouter not usable for model ${oModel}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  const oCache = new GeminiCache(root, true, "openrouter");
  info(`OpenRouter cache: ${oCache.size} analysed candidate${oCache.size === 1 ? "" : "s"} in ${path.relative(root, oCache.file)}`);

  // Direct xAI / Grok — the M5b boundary analyst. Key never printed (not even masked).
  const x = cfg.raw.xai ?? {};
  const xModel = resolveXaiModel(opts.grokModel, x.model);
  const xFail = (m: string) => {
    if (opts.requireGrok) {
      bad(m);
      failed = true;
    } else info(m);
  };
  if (!hasXaiKey()) xFail("Grok (xAI) key: XAI_API_KEY is not set. (export XAI_API_KEY=… — needed by jevx boundary)");
  else {
    ok("Grok (xAI) key: set (from XAI_API_KEY; never printed, never stored)");
    const made = createXaiTransport({ model: xModel, baseURL: x.baseURL, timeoutMs: Math.min(resolveXaiTimeout(undefined, x.timeoutMs), 30_000), pricePerMInput: x.pricePerMInput, pricePerMOutput: x.pricePerMOutput });
    if (!made.transport) xFail(`Grok (xAI): ${made.error}`);
    else {
      try {
        const m = await made.transport.ping();
        ok(`xAI API reachable · model ${m.model} available · this check sent no code`);
        if (opts.grokSmokeTest) {
          const t = await xaiSmokeTest(made.transport);
          ok(`Grok answered a ${t.inputTokens}-token test request ("${t.text}") · ${t.inputTokens}+${t.outputTokens} tokens${t.costUsd !== undefined ? ` ≈ $${t.costUsd.toFixed(6)} (calculated from configured prices)` : ""}`);
        }
      } catch (err) {
        xFail(`Grok (xAI) not usable for model ${xModel}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  const cache = new ValidationCache(root);
  info(`Cache: ${cache.size} validated candidate${cache.size === 1 ? "" : "s"} in ${path.relative(root, cache.file)} (prompt ${PROMPT_VERSION})`);
  info("Nothing leaves your machine unless you ask: analyze --gemini / --openrouter and boundary (xAI/Grok) send unit code and requested context (secret-scrubbed) to that code analyst, --validate sends unit code to TypeSafe.");
  return failed ? 1 : 0;
}
