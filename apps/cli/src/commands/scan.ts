import path from "node:path";
import chalk from "chalk";
import { loadConfig, SIGNAL_LABELS, type Band, type Candidate, type DetectionResult, type ResolvedConfig } from "@jevx/core";
import { scanProject } from "@jevx/scanner";
import { detectAsync } from "@jevx/detector";
import { createClient, ValidationCache, validateResult } from "@jevx/typesafe";
import type { ScanProgress } from "@jevx/terminal-ui";
import { selfModule } from "../self.js";
import { VERSION } from "../meta.js";

export interface ScanFlags {
  root: string;
  config?: string;
  json: boolean;
  plain: boolean;
  validate: boolean;
  validateAll: boolean;
  /** Ignore the local validation cache (still writes fresh results). */
  cache?: boolean;
  failOn?: Band;
  min?: number;
}

export async function runScan(
  cfg: ResolvedConfig,
  flags: Pick<ScanFlags, "validate" | "validateAll" | "cache">,
  onProgress?: (p: ScanProgress) => void
): Promise<DetectionResult> {
  onProgress?.({ phase: "finding" });
  const scanned = await scanProject({ root: cfg.root, include: cfg.include, exclude: cfg.exclude });
  onProgress?.({ phase: "parsing", total: scanned.files.length });
  await new Promise((r) => setImmediate(r));
  const detected = await detectAsync(scanned.files, cfg.root, cfg.detector, (done, total) =>
    onProgress?.({ phase: "detecting", done, total })
  );
  if (!flags.validate) return detected;
  return validateDetected(detected, cfg, flags, onProgress);
}

/** M3: send the ≥ minimum band (or everything, with --validate-all) to TypeSafe. */
export async function validateDetected(
  detected: DetectionResult,
  cfg: ResolvedConfig,
  flags: Pick<ScanFlags, "validateAll" | "cache">,
  onProgress?: (p: ScanProgress) => void
): Promise<DetectionResult> {
  const ts = cfg.raw.typesafe ?? {};
  const made = createClient({ apiKey: ts.apiKey, baseURL: ts.baseURL, model: ts.model, timeoutMs: ts.timeoutMs });
  const empty = { attempted: 0, confirmed: 0, rejected: 0, errors: 0, cached: 0, apiCalls: 0, inputTokens: 0 };
  if (!made.client) return { ...detected, validation: { ...empty, skipped: made.error } };

  const targets = detected.raw.filter((c) => flags.validateAll || c.score >= cfg.detector.thresholds.minimum);
  if (targets.length === 0) return { ...detected, validation: { ...empty, model: made.client.defaultModel } };

  onProgress?.({ phase: "validating", done: 0, total: targets.length });
  return validateResult(detected, {
    client: made.client,
    cache: new ValidationCache(cfg.root, flags.cache !== false),
    thresholds: cfg.detector.thresholds,
    model: ts.model,
    all: flags.validateAll,
    concurrency: ts.concurrency,
    onProgress: (done, total) => onProgress?.({ phase: "validating", done, total })
  });
}

export async function prepareScan(flags: ScanFlags): Promise<ResolvedConfig> {
  const cfg = await loadConfig(flags.root, { configFile: flags.config, selfModule: selfModule() });
  if (flags.min !== undefined) cfg.detector.thresholds.minimum = flags.min;
  return cfg;
}

export function isValidated(result: DetectionResult): boolean {
  const v = result.validation;
  return Boolean(v && !v.skipped && v.attempted > 0 && v.errors < v.attempted);
}

/** One-line footer explaining what the numbers mean for this run. */
export function validationNotice(flags: Pick<ScanFlags, "validate">, result?: DetectionResult): string {
  if (!flags.validate) return "--no-validate: AST-only pass. Scores are preliminary; nothing was sent to TypeSafe.";
  const v = result?.validation;
  if (!v) return "Validating with TypeSafe…";
  if (v.skipped) return `TypeSafe validation skipped (${v.skipped}). Scores are preliminary AST scores. Use --no-validate to silence this.`;
  if (v.attempted === 0) return "Nothing reached the validation threshold, so no TypeSafe calls were made.";
  const parts = [
    `${v.confirmed} confirmed`,
    `${v.rejected} rejected`,
    v.errors ? `${v.errors} failed (kept preliminary)` : "",
    `${v.apiCalls} API call${v.apiCalls === 1 ? "" : "s"}`,
    v.cached ? `${v.cached} from cache` : "",
    v.inputTokens ? `${v.inputTokens.toLocaleString()} input tokens` : ""
  ].filter(Boolean);
  const fatal = v.fatal ? ` Stopped early: ${v.fatal}.` : "";
  return `TypeSafe (${v.model ?? "jev"}): ${parts.join(" · ")}. Scores are final confidence.${fatal}`;
}

function candidateJson(c: Candidate) {
  return {
    id: c.id,
    location: `${c.file}:${c.line}`,
    file: c.file,
    line: c.line,
    endLine: c.endLine,
    column: c.column,
    kind: c.kind,
    context: c.context ?? null,
    /** Final confidence when validated, else the preliminary AST score. */
    score: c.confidence ?? c.score,
    scoreKind: c.confidence !== undefined ? "final" : "preliminary",
    preliminaryScore: c.score,
    band: c.band,
    validation: c.validation ?? null,
    signals: c.signals.map((s) => ({ id: s.id, weight: s.weight, label: SIGNAL_LABELS[s.id], evidence: s.evidence })),
    terms: c.terms,
    snippet: c.snippet
  };
}

export function toJson(result: DetectionResult, cfg: ResolvedConfig, flags: ScanFlags) {
  const rejected = result.raw.filter((c) => c.validation?.status === "rejected");
  return {
    tool: "jevx",
    version: VERSION,
    root: cfg.root,
    config: cfg.configPath ? path.relative(cfg.root, cfg.configPath) : null,
    validated: isValidated(result),
    scoreKind: isValidated(result) ? "final" : "preliminary",
    notice: validationNotice(flags, result),
    validation: result.validation ?? null,
    thresholds: cfg.detector.thresholds,
    filesAnalyzed: result.filesAnalyzed,
    durationMs: Math.round(result.durationMs),
    counts: result.counts,
    candidates: result.candidates.map(candidateJson),
    rejected: rejected.map(candidateJson)
  };
}

export { candidateJson };

const bandStyle: Record<Band, (s: string) => string> = {
  veryStrong: chalk.magentaBright.bold,
  strong: chalk.greenBright,
  possible: chalk.yellow,
  ignore: chalk.gray
};

export function printPlain(result: DetectionResult, flags: ScanFlags): void {
  const out = (s = "") => process.stdout.write(s + "\n");
  const n = result.candidates.length;
  const validated = isValidated(result);
  out(`${chalk.green("✓")} ${result.filesAnalyzed.toLocaleString()} files analyzed`);
  out(`${chalk.green("✓")} ${n.toLocaleString()} semantic decision${n === 1 ? "" : "s"} detected`);
  if (validated && result.validation) {
    const v = result.validation;
    out(`${chalk.green("✓")} ${v.confirmed} confirmed by TypeSafe, ${v.rejected} rejected`);
  }
  const strong = result.counts.strong + result.counts.veryStrong;
  out();
  out(
    `${chalk.yellowBright.bold(`⚡ ${strong} strong Jev candidate${strong === 1 ? "" : "s"}`)}  ${chalk.gray(validated ? "(TypeSafe-validated)" : "(preliminary)")}`
  );
  out();
  const width = Math.min(50, Math.max(10, ...result.candidates.map((c) => `${c.file}:${c.line}`.length)) + 2);
  for (const c of result.candidates) {
    const loc = `${c.file}:${c.line}`.padEnd(width);
    const shown = c.confidence ?? c.score;
    const detail =
      c.validation?.status === "confirmed"
        ? `${c.validation.kind ?? ""}  AST ${c.score}${c.validation.cached ? " · cached" : ""}`
        : c.validation?.status === "error"
          ? `preliminary · validation failed: ${c.validation.error}`
          : c.signals.map((s) => s.id).join(", ");
    out(`  ${loc} ${bandStyle[c.band](`${String(shown).padStart(3)}%`)}  ${chalk.gray(detail)}`);
  }
  out();
  out(chalk.gray(validationNotice(flags, result)));
}

export function exitCodeFor(result: DetectionResult, failOn?: Band): number {
  if (!failOn) return 0;
  const order: Band[] = ["possible", "strong", "veryStrong"];
  const idx = order.indexOf(failOn);
  if (idx < 0) return 0;
  return result.candidates.some((c) => order.indexOf(c.band) >= idx) ? 1 : 0;
}
