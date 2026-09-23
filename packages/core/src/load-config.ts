import { existsSync } from "node:fs";
import path from "node:path";
import { loadConfig as c12Load } from "c12";
import { DEFAULT_EXCLUDE, DEFAULT_INCLUDE, type JevxConfig } from "./config.js";
import { defaultDetectorOptions } from "./defaults.js";
import type { DetectorOptions } from "./types.js";

export const CONFIG_FILES = ["jevx.config.ts", "jevx.config.mts", "jevx.config.js", "jevx.config.mjs"];

export interface ResolvedConfig {
  root: string;
  configPath?: string;
  include: string[];
  exclude: string[];
  detector: DetectorOptions;
  raw: JevxConfig;
}

export interface LoadConfigOptions {
  /** Explicit config file (relative to root or absolute). */
  configFile?: string;
  /**
   * Module that `import ... from "jevx"` resolves to inside the user's config.
   * The CLI passes its own entry so configs work even when jevx is installed globally.
   */
  selfModule?: string;
}

export function findConfig(root: string): string | undefined {
  for (const name of CONFIG_FILES) {
    const p = path.join(root, name);
    if (existsSync(p)) return p;
  }
  return undefined;
}

export async function loadConfig(root: string, opts: LoadConfigOptions = {}): Promise<ResolvedConfig> {
  const explicit = opts.configFile ? path.resolve(root, opts.configFile) : undefined;
  if (explicit && !existsSync(explicit)) throw new Error(`Config not found: ${explicit}`);
  const configPath = explicit ?? findConfig(root);

  let raw: JevxConfig = {};
  if (configPath) {
    const { config } = await c12Load<JevxConfig>({
      cwd: root,
      name: "jevx",
      configFile: configPath,
      rcFile: false,
      globalRc: false,
      dotenv: false,
      packageJson: false,
      jitiOptions: opts.selfModule ? { alias: { jevx: opts.selfModule }, moduleCache: false } : { moduleCache: false }
    });
    raw = (config ?? {}) as JevxConfig;
  }

  const base = defaultDetectorOptions();
  const detector: DetectorOptions = {
    signals: { ...base.signals, ...(raw.signals ?? {}) },
    thresholds: { ...base.thresholds, ...(raw.thresholds ?? {}) },
    humanTextNames: [...base.humanTextNames, ...(raw.detector?.humanTextNames ?? [])],
    labels: [...base.labels, ...(raw.detector?.labels ?? [])],
    keywordListMin: raw.detector?.keywordListMin ?? base.keywordListMin,
    inlineTermsMin: raw.detector?.inlineTermsMin ?? base.inlineTermsMin,
    codeContextNames: [...base.codeContextNames, ...(raw.detector?.codeContextNames ?? [])]
  };

  let include = raw.include ?? DEFAULT_INCLUDE;
  if (!raw.include && raw.languages && raw.languages.length === 1) {
    include = [raw.languages[0] === "typescript" ? "**/*.{ts,tsx,mts,cts}" : "**/*.{js,jsx,mjs,cjs}"];
  }

  return { root, configPath, include, exclude: raw.exclude ?? DEFAULT_EXCLUDE, detector, raw };
}
