// jevx analyze — the Phase 1 decision-boundary pipeline.
//   project → structural analysis → candidate generators → filtering → representation
//   → (optional) TypeSafe validation → (optional) save to the dataset
// Offline by default. Does not use the legacy scan detector.
import path from "node:path";
import chalk from "chalk";
import { loadConfig, type AnalysisResult, type CodeAnalystProvider, type DecisionCandidate, type GeminiEvidence } from "@jevx/core";
import { scanProject } from "@jevx/scanner";
import { RepoIndex, analyzeProject } from "@jevx/analyzer";
import { Dataset, upsertAnalysis, type Split, type UpsertReport, type Visibility } from "@jevx/dataset";
import { DecisionCache, createClient, validateDecisions } from "@jevx/typesafe";
import {
  DEFAULT_CONTEXT_BUDGET,
  DEFAULT_MAX_ROUNDS,
  DEFAULT_OPENROUTER_CONCURRENCY,
  GeminiCache,
  analyzeWithCodeAnalyst,
  createGeminiTransport,
  createOpenRouterTransport,
  resolveGeminiModel,
  resolveOpenRouterModel,
  resolveOpenRouterTimeout,
  type GeminiTransport
} from "@jevx/gemini";
import { selfModule } from "../self.js";
import { VERSION } from "../meta.js";

export interface AnalyzeFlags {
  root: string;
  config?: string;
  json: boolean;
  all: boolean;
  limit?: number;
  validate: boolean;
  /** Optional Gemini code analyst (evidence only). */
  gemini: boolean;
  geminiModel?: string;
  /** Optional OpenRouter code analyst (evidence only). Independent of --gemini; both may run. */
  openrouter?: boolean;
  openrouterModel?: string;
  /** Context settings below apply to every code analyst that runs. adaptive (default) | local */
  geminiContext?: "adaptive" | "local";
  geminiRounds?: number;
  /** characters per candidate; 0 = unlimited */
  geminiBudget?: number;
  offline: boolean;
  cache: boolean;
  save: boolean;
  project?: string;
  visibility?: Visibility;
  source?: string;
  commit?: string;
  license?: string;
  split?: Split;
  domains?: string[];
  dataset: string;
}

export function defaultDatasetDir(): string {
  return path.resolve(process.env.JEVX_DATASET?.trim() || path.join(process.cwd(), "dataset"));
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "project";
}

/** Data-sharing notices go to stderr in every mode (also with --json): they must never be silent. */
const notice = (m: string) => void process.stderr.write(chalk.gray(m) + "\n");

export async function runAnalyze(flags: AnalyzeFlags, log: (s: string) => void): Promise<{ result: AnalysisResult; saved?: UpsertReport }> {
  void log;
  // Fail before any network call, not after.
  if (flags.save && !flags.visibility) throw new Error("--save needs --public (snippets may be stored) or --private (fingerprint-only, no code stored)");
  const cfg = await loadConfig(flags.root, { configFile: flags.config, selfModule: selfModule() });
  const scanned = await scanProject({ root: cfg.root, include: cfg.include, exclude: cfg.exclude });
  let result = await analyzeProject({ root: cfg.root, files: scanned.files, project: scanned.project, skipped: scanned.skipped.length });

  // 1. Code analyst(s) — evidence only (what is decided, inputs, outcomes, exact vs judgment).
  //    Gemini and OpenRouter are independent providers of the same analyst: same context loop,
  //    prompt, schema, parser and cache rules. Either, both, or neither may run.
  const analysts: CodeAnalystProvider[] = [...(flags.gemini ? (["gemini"] as const) : []), ...(flags.openrouter ? (["openrouter"] as const) : [])];
  let index: RepoIndex | undefined;
  for (const provider of analysts) {
    const g = cfg.raw.gemini ?? {};
    const o = cfg.raw.openrouter ?? {};
    const name = provider === "gemini" ? "Gemini" : "OpenRouter";
    const host = provider === "gemini" ? "Google" : "OpenRouter → the model's provider";
    const model = provider === "gemini" ? resolveGeminiModel(flags.geminiModel, g.model) : resolveOpenRouterModel(flags.openrouterModel, o.model);
    const timeoutMs = provider === "gemini" ? g.timeoutMs : resolveOpenRouterTimeout(undefined, o.timeoutMs);
    const made: { transport?: GeminiTransport; error?: string } = flags.offline
      ? {}
      : provider === "gemini"
        ? createGeminiTransport({ model, baseURL: g.baseURL, timeoutMs })
        : createOpenRouterTransport({ model, baseURL: o.baseURL, timeoutMs });
    if (!flags.offline && !made.transport) {
      result = { ...result, [provider]: { attempted: 0, apiCalls: 0, cached: 0, errors: 0, inputTokens: 0, outputTokens: 0, model, skipped: made.error ?? `no ${name} client` } };
      continue;
    }
    if (result.candidates.length === 0) continue;
    const gc = g.context ?? {};
    const mode = flags.geminiContext ?? gc.mode ?? "adaptive";
    const maxRounds = flags.geminiRounds ?? gc.maxRounds ?? DEFAULT_MAX_ROUNDS;
    const rawBudget = flags.geminiBudget ?? gc.maxChars ?? DEFAULT_CONTEXT_BUDGET;
    const budget = rawBudget === 0 ? Infinity : rawBudget;
    index ??= new RepoIndex(cfg.root, scanned.files, { maxWholeFileChars: gc.maxWholeFileChars });
    if (flags.offline) notice(`${name}: offline replay from ${path.join(".jevx", "cache", `${provider}.json`)} — nothing is sent.`);
    else {
      notice(
        `${name} (${model}, ${host}): ${result.candidates.length} candidate(s). JevX indexed ${index.fileCount} file(s) locally. Round 1 sends each candidate's file (outline + function if it is very large) and JevX's structural evidence.` +
          (mode === "adaptive"
            ? ` If the analyst says it needs more, JevX adds only what it asks for — related functions, callers, types, constants, importing files, the folder outline, a repo overview — up to ${maxRounds} rounds and ${budget === Infinity ? "no size limit" : `${budget.toLocaleString("en-US")} characters`} per candidate.`
            : " Local mode: no expansion.") +
          " Everything is secret-scrubbed; credential-looking files are never sent; filtered candidates are never sent."
      );
      if (flags.visibility === "private") notice(`Private project: ${name}'s answers are cached locally in .jevx/ and stored in the dataset as facts only (no code, no text, no context ids).`);
    }
    result = await analyzeWithCodeAnalyst(result, {
      provider,
      model,
      transport: made.transport,
      cache: new GeminiCache(cfg.root, flags.cache, provider),
      context: index,
      mode,
      maxRounds,
      budget,
      offline: flags.offline,
      concurrency: provider === "gemini" ? g.concurrency : (o.concurrency ?? DEFAULT_OPENROUTER_CONCURRENCY),
      timeoutMs
    });
  }

  // 2. TypeSafe / Jev — independent semantic validation (it is NOT shown any code analyst's output).
  if (flags.validate) {
    const ts = cfg.raw.typesafe ?? {};
    const made = flags.offline
      ? createClient({ apiKey: "offline-replay", baseURL: "http://offline.invalid", model: ts.model })
      : createClient({ apiKey: ts.apiKey, baseURL: ts.baseURL, model: ts.model, timeoutMs: ts.timeoutMs });
    if (!made.client) {
      result = { ...result, semantic: { attempted: 0, apiCalls: 0, cached: 0, errors: 0, inputTokens: 0, skipped: made.error } };
    } else if (result.candidates.length > 0) {
      notice(
        flags.offline
          ? "TypeSafe: offline replay from .jevx/cache/decisions.json — nothing is sent."
          : `TypeSafe: sending ${result.candidates.length} candidate function(s) — each ≤ 60 lines, secrets scrubbed. Filtered candidates are never sent.`
      );
      result = await validateDecisions(result, {
        client: made.client,
        cache: new DecisionCache(cfg.root, flags.cache),
        model: ts.model,
        offline: flags.offline,
        concurrency: ts.concurrency
      });
    }
  }

  let saved: UpsertReport | undefined;
  if (flags.save && flags.visibility) {
    const ds = new Dataset(flags.dataset);
    saved = upsertAnalysis(ds, {
      slug: slugify(flags.project ?? result.profile.name),
      visibility: flags.visibility,
      source: flags.source,
      commit: flags.commit,
      license: flags.license,
      split: flags.split,
      domains: flags.domains
    }, result);
  }
  return { result, saved };
}

const primitiveColor = (p: string) => (p === "choice" ? chalk.cyan(p) : p === "noul" ? chalk.magenta(p) : p === "score" ? chalk.yellow(p) : chalk.gray(p));

function labelTag(c: DecisionCandidate): string {
  if (c.triage) return chalk.gray(`NOT_JEV · ${c.triage.reason}`);
  if (c.classification) {
    const l = c.classification.label;
    return (l === "STRONG_JEV" ? chalk.green : l === "POSSIBLE_JEV" ? chalk.yellow : chalk.gray)(l);
  }
  if (c.semanticError) return chalk.red("validation failed");
  return chalk.blue("unreviewed");
}

function printAnalyst(name: string, ev: GeminiEvidence | undefined, err: string | undefined, log: (s: string) => void) {
  if (!ev) {
    if (err) log(chalk.red(`  ┌ ${name}: ${err}`));
    return;
  }
  const a = ev.analysis;
  const cx = ev.context;
  log(chalk.bold.blue(`  ┌ ${name} code analyst`) + chalk.gray(` · ${ev.model} · ${ev.promptVersion}${ev.cached ? " · cached" : ""} · model evidence, not a label`));
  log(
    (ev.usable ? chalk.gray : chalk.yellow)(
      `  │ context   ${cx.rounds} round(s) · ${cx.items.length} item(s), ${cx.chars.toLocaleString("en-US")} chars · understood ${a.understanding_confidence} · ` +
        (ev.usable ? "sufficient" : `⚠ INSUFFICIENT (${cx.stoppedBy}) — weak evidence`)
    )
  );
  if (cx.items.length > 1) log(chalk.gray(`  │ saw       ${cx.items.map((i) => i.id).slice(0, 6).join(", ")}${cx.items.length > 6 ? `, +${cx.items.length - 6}` : ""}`));
  if (!ev.usable && a.missing_context.length) log(chalk.yellow(`  │ still needs ${a.missing_context.map((m) => m.request).slice(0, 3).join("; ")}`));
  log(`  │ ${a.summary}`);
  log(chalk.gray(`  │ boundary  ${a.decision_boundary}`));
  log(chalk.gray(`  │ inputs    ${a.inputs.map((i) => `${i.name} (${i.role})`).join(", ") || "–"}`));
  log(chalk.gray(`  │ outcomes  ${a.outcomes.join(" | ") || "–"}`));
  log(chalk.gray(`  │ exact rule ${a.deterministic_logic ? "yes" : "no"} · approximates judgment ${a.approximates_judgment ? `yes (${a.judgment_kind ?? "?"})` : "no"} · ${a.decision_type} · ${primitiveColor(a.plausible_primitive)} · uncertainty ${a.uncertainty}`));
  if (a.stays_deterministic.length) log(chalk.gray(`  │ stays exact: ${a.stays_deterministic.join("; ")}`));
  log(chalk.gray(`  │ why: ${a.reasoning}`));
  if (a.model_hypothesis) log(chalk.gray(`  │ (debug hypothesis, ignored by JevX: ${a.model_hypothesis.label})`));
}

export function printAnalysis(r: AnalysisResult, flags: AnalyzeFlags, saved: UpsertReport | undefined, log: (s: string) => void) {
  const p = r.profile;
  log(`${chalk.bold("JevX analyze")} ${chalk.gray(`${VERSION} · analysis ${r.versions.analysis}`)}`);
  log(
    `${p.name} · ${p.languages.join("/") || "no TS/JS"}${p.frameworks.length ? ` · ${p.frameworks.join(", ")}` : ""} · ${p.files.analyzed} source files (${Object.entries(p.files.byRole)
      .filter(([k]) => k !== "source")
      .map(([k, v]) => `${v} ${k}`)
      .join(", ") || "no others"} skipped by role)`
  );
  log(`${r.stats.units} functions → ${r.stats.generated} proposed by generators → ${chalk.bold(String(r.candidates.length))} candidates, ${r.filtered.length} filtered as NOT_JEV  ${chalk.gray(`${r.stats.durationMs} ms`)}`);
  if (r.semantic) {
    const s = r.semantic;
    log(
      s.skipped
        ? chalk.yellow(`TypeSafe validation skipped: ${s.skipped}`)
        : chalk.gray(`TypeSafe ${s.model ?? ""} · ${s.promptVersion} · policy ${s.policyVersion} · ${s.apiCalls} call(s), ${s.cached} cached, ${s.errors} error(s), ${s.inputTokens} input tokens`)
    );
    if (s.fatal) log(chalk.red(`  stopped: ${s.fatal}`));
  }
  for (const [name, g] of [["Gemini", r.gemini], ["OpenRouter", r.openrouter]] as const) {
    if (!g) continue;
    log(
      g.skipped
        ? chalk.yellow(`${name} skipped: ${g.skipped} (analysis continued without it)`)
        : chalk.gray(
            `${name} ${g.model ?? ""} · ${g.promptVersion} · ${g.apiCalls} call(s), ${g.cached} cached, ${g.errors} error(s), ${g.inputTokens}+${g.outputTokens} tokens · ${g.expanded ?? 0} needed more context, ${g.insufficient ?? 0} still insufficient`
          )
    );
    if (g.fatal) log(chalk.red(`  stopped: ${g.fatal}`));
  }
  if (!r.semantic && !r.gemini && !r.openrouter) log(chalk.gray("Offline: nothing was sent anywhere. --gemini / --openrouter add code-analyst evidence, --validate asks TypeSafe (unit code only, secret-scrubbed)."));
  log("");

  const shown = [...r.candidates, ...(flags.all ? r.filtered : [])];
  const limit = flags.limit ?? (flags.all ? shown.length : 40);
  for (const c of shown.slice(0, limit)) {
    log(`${chalk.bold(`${c.file}:${c.boundary.start}`)}  ${c.unit.name}  ${labelTag(c)}  ${chalk.gray(c.id.slice(0, 8))}`);
    log(`  ${c.explanation.decision}`);
    log(`  outcomes  ${c.explanation.outcomes}`);
    // 1. deterministic evidence
    log(chalk.bold.gray("  ┌ deterministic evidence (AST)"));
    log(chalk.gray(`  │ found by  ${c.generators.map((g) => `${g.generator}: ${g.evidence[0]}`).join("\n  │           ")}`));
    log(chalk.gray(`  │ primitive ${c.explanation.suggestedPrimitive} — ${c.explanation.primitiveWhy}`));
    if (c.explanation.staysDeterministic.length) log(chalk.gray(`  │ stays in code: ${c.explanation.staysDeterministic.join("; ")}`));
    if (c.triage) log(chalk.gray(`  │ filtered: ${c.triage.reason} — ${c.triage.detail}`));
    // 2. code-analyst evidence (Gemini and/or OpenRouter)
    printAnalyst("Gemini", c.gemini, c.geminiError, log);
    printAnalyst("OpenRouter", c.openrouter, c.openrouterError, log);
    // 3. TypeSafe / Jev
    if (c.semantic) {
      const s = c.semantic;
      log(chalk.bold.magenta("  ┌ TypeSafe / Jev") + chalk.gray(` · ${s.model ?? ""} · ${s.promptVersion}${s.cached ? " · cached" : ""}`));
      log(chalk.gray(`  │ judgment ${s.judgment.toFixed(2)} · bounded ${s.bounded.toFixed(2)} · exact-is-right ${s.deterministicIsCorrect.toFixed(2)} · ${s.primitive} (${s.primitiveConfidence.toFixed(2)}) · ${s.category} (${s.categoryConfidence.toFixed(2)})`));
    } else if (c.semanticError) log(chalk.red(`  ┌ TypeSafe: ${c.semanticError}`));
    // 4. JevX policy (deterministic; no code analyst ever feeds it)
    if (c.classification) log(`  └ JevX policy ${c.classification.policyVersion}: ${labelTag(c)} ${chalk.gray(`— ${c.classification.reason}`)}`);
    else if (c.triage) log(`  └ JevX: ${labelTag(c)} ${chalk.gray("(deterministic filter)")}`);
    else log(`  └ JevX: ${chalk.blue("unclassified")} ${chalk.gray("— run --validate for a TypeSafe signal (not ground truth)")}`);
    log("");
  }
  if (shown.length > limit) log(chalk.gray(`… ${shown.length - limit} more (--limit <n>, or --json for everything)`));
  if (!flags.all && r.filtered.length) {
    const reasons = new Map<string, number>();
    for (const c of r.filtered) reasons.set(c.triage!.reason, (reasons.get(c.triage!.reason) ?? 0) + 1);
    log(chalk.gray(`Filtered (NOT_JEV): ${[...reasons].map(([k, v]) => `${v} ${k}`).join(", ")}  — show them with --all`));
  }
  if (saved) {
    const pr = saved.project;
    log("");
    log(
      chalk.green(`✓ ${saved.created ? "Added" : "Updated"} ${pr.slug} in the dataset`) +
        chalk.gray(` (${pr.visibility}${pr.visibility === "private" ? ", no code stored" : ", scrubbed snippets"} · split ${pr.split.toUpperCase()} ${pr.splitSource === "hash" ? "(deterministic)" : "(manual)"})`)
    );
    log(chalk.gray(`  ${saved.added} new · ${saved.updated} updated · ${saved.stale} now stale · ${saved.recheck} label(s) need recheck · ${saved.total} entries`));
    log(chalk.gray(`  next: jevx review ${pr.slug}${pr.visibility === "private" ? ` --root ${flags.root}` : ""}`));
  }
}

/** JSON output: never includes code for anything not explicitly local (it is local output, but keep it lean). */
export function analysisJson(r: AnalysisResult, saved?: UpsertReport) {
  const strip = (c: DecisionCandidate) => {
    const { code: _code, ...rest } = c;
    void _code;
    return rest;
  };
  return {
    version: VERSION,
    analysis: r.versions.analysis,
    profile: r.profile,
    stats: r.stats,
    gemini: r.gemini ?? null,
    openrouter: r.openrouter ?? null,
    semantic: r.semantic ?? null,
    candidates: r.candidates.map(strip),
    filtered: r.filtered.map(strip),
    saved: saved ? { project: saved.project.slug, split: saved.project.split, visibility: saved.project.visibility, added: saved.added, updated: saved.updated, stale: saved.stale, total: saved.total } : null
  };
}
