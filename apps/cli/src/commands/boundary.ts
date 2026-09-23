// M5b commands:
//   jevx jev-usages [path]         layer B only: where is Jev actually used? (offline, no AI)
//   jevx boundary [path]           pilot for one project: B → C "why Jev here?" → D "why deterministic there?"
//   jevx boundary-patterns         layer E across the stored projects (TEST projects excluded)
// The code analyst is Grok 4.6 through the DIRECT xAI API by default (any provider behind the same interface).
// Nothing produced here is ground truth; see docs/CURRENT-ARCHITECTURE.md.
import path from "node:path";
import chalk from "chalk";
import { loadConfig, type JevSite, type JevUsageReport } from "@jevx/core";
import { scanProject } from "@jevx/scanner";
import { RepoIndex, analyzeProject, findJevUsage } from "@jevx/analyzer";
import { Dataset } from "@jevx/dataset";
import {
  createGeminiTransport,
  createOpenRouterTransport,
  createXaiTransport,
  resolveGeminiModel,
  resolveOpenRouterModel,
  resolveOpenRouterTimeout,
  resolveXaiModel,
  resolveXaiTimeout,
  type GeminiTransport
} from "@jevx/gemini";
import {
  BoundaryCache,
  BoundaryStore,
  DEFAULT_BUDGET_TOKENS,
  DEFAULT_MAX_CONTRASTS,
  DEFAULT_MAX_USAGES,
  derivePatterns,
  runBoundary,
  type CallAccounting,
  type RunEvent,
  type Visibility
} from "@jevx/boundary";
import { selfModule } from "../self.js";
import { slugify } from "./analyze.js";

const err = (m: string) => void process.stderr.write(m + "\n");

async function load(root: string, config?: string) {
  const cfg = await loadConfig(root, { configFile: config, selfModule: selfModule() });
  const scanned = await scanProject({ root: cfg.root, include: cfg.include, exclude: cfg.exclude });
  return { cfg, scanned };
}

const siteLine = (s: JevSite) =>
  `${chalk.bold(`${s.file}:${s.unit.start}`)} ${s.unit.name}  ${chalk.gray(`${s.tier} · ${s.role}`)}  ${s.questions.length} question(s) ${chalk.gray(
    s.questions
      .slice(0, 4)
      .map((q) => `${q.primitive}${q.key ? `:${q.key}` : ""}`)
      .join(", ")
  )}${s.calls.length ? chalk.gray(` · via ${[...new Set(s.calls.map((c) => (c.via ? c.via.name : c.kind)))].slice(0, 3).join(", ")}`) : ""}`;

// ─── jevx jev-usages ───

export interface UsagesFlags {
  root: string;
  config?: string;
  json: boolean;
  all: boolean;
}

export async function runJevUsages(f: UsagesFlags, log: (s: string) => void): Promise<JevUsageReport> {
  const { cfg, scanned } = await load(f.root, f.config);
  const r = findJevUsage({ root: cfg.root, files: scanned.files });
  if (f.json) {
    log(JSON.stringify(r, null, 2));
    return r;
  }
  log(`${chalk.bold("JevX jev-usages")} ${chalk.gray(`finder ${r.version} · offline, no AI · where is Jev actually used? (observed, not ground truth)`)}`);
  log(
    `${r.stats.files} files · ${r.stats.sdkImports} Jev SDK import(s) · ${chalk.bold(String(r.stats.decisionSites))} decision site(s), ${r.stats.questionSites} question set(s), ${r.stats.plumbingSites} plumbing, ${r.stats.uncertainSites} uncertain`
  );
  log("");
  for (const s of r.sites.filter((x) => f.all || x.role !== "plumbing")) log(`  ${siteLine(s)}`);
  if (f.all && r.uncertain.length) {
    log(chalk.yellow(`\n  uncertain (recorded apart, never anchors):`));
    for (const s of r.uncertain) log(`  ${chalk.yellow(siteLine(s))}`);
  }
  if (!f.all && (r.stats.plumbingSites || r.uncertain.length)) log(chalk.gray(`\n  ${r.stats.plumbingSites} plumbing + ${r.uncertain.length} uncertain site(s) hidden — show them with --all`));
  return r;
}

// ─── jevx boundary ───

export interface BoundaryFlags {
  root: string;
  config?: string;
  project?: string;
  visibility?: Visibility;
  dataset: string;
  maxUsages?: number;
  maxContrasts?: number;
  budgetTokens?: number;
  codeAnalyst: "xai" | "openrouter" | "gemini";
  model?: string;
  dryRun: boolean;
  offline: boolean;
  cache: boolean;
  context?: "adaptive" | "local";
  rounds?: number;
  contextBudget?: number;
  json: boolean;
}

const fmtAcc = (a: CallAccounting) =>
  `${a.calls} call(s), ${a.rounds} round(s), ${a.inputTokens.toLocaleString("en-US")} in + ${a.outputTokens.toLocaleString("en-US")} out tokens${a.reasoningTokens ? ` (${a.reasoningTokens.toLocaleString("en-US")} reasoning)` : ""}${a.cachedTokens ? `, ${a.cachedTokens.toLocaleString("en-US")} cached` : ""}${a.retries ? `, ${a.retries} retr${a.retries === 1 ? "y" : "ies"}` : ""}${a.costUsd !== undefined ? `, $${a.costUsd.toFixed(4)} ${a.costSource === "provider" ? "(provider-reported)" : "(calculated from configured prices)"}` : ""}`;

function transportFor(f: BoundaryFlags, cfgRaw: Awaited<ReturnType<typeof loadConfig>>["raw"]): { transport?: GeminiTransport; model: string; error?: string; timeoutMs?: number } {
  if (f.codeAnalyst === "xai") {
    const x = cfgRaw.xai ?? {};
    const model = resolveXaiModel(f.model, x.model);
    const timeoutMs = resolveXaiTimeout(undefined, x.timeoutMs);
    const made = f.offline || f.dryRun ? {} : createXaiTransport({ model, baseURL: x.baseURL, timeoutMs, pricePerMInput: x.pricePerMInput, pricePerMOutput: x.pricePerMOutput });
    return { ...made, model, timeoutMs };
  }
  if (f.codeAnalyst === "gemini") {
    const g = cfgRaw.gemini ?? {};
    const model = resolveGeminiModel(f.model, g.model);
    const made = f.offline || f.dryRun ? {} : createGeminiTransport({ model, baseURL: g.baseURL, timeoutMs: g.timeoutMs });
    return { ...made, model, timeoutMs: g.timeoutMs };
  }
  const o = cfgRaw.openrouter ?? {};
  const model = resolveOpenRouterModel(f.model, o.model);
  const timeoutMs = resolveOpenRouterTimeout(undefined, o.timeoutMs);
  const made = f.offline || f.dryRun ? {} : createOpenRouterTransport({ model, baseURL: o.baseURL, timeoutMs });
  return { ...made, model, timeoutMs };
}

export async function runBoundaryCommand(f: BoundaryFlags, log: (s: string) => void) {
  if (!f.dryRun && !f.visibility) throw new Error("boundary needs --public (texts may be stored) or --private (facts only; free text stays in the local cache)");
  const { cfg, scanned } = await load(f.root, f.config);
  const project = slugify(f.project ?? path.basename(cfg.root));
  const usage = findJevUsage({ root: cfg.root, files: scanned.files });
  const analysis = await analyzeProject({ root: cfg.root, files: scanned.files, project: scanned.project, skipped: scanned.skipped.length });
  const gc = cfg.raw.gemini?.context ?? {};
  const index = new RepoIndex(cfg.root, scanned.files, { maxWholeFileChars: gc.maxWholeFileChars });
  const t = transportFor(f, cfg.raw);
  if (!f.dryRun && !f.offline && !t.transport) throw new Error(`${f.codeAnalyst}: ${t.error ?? "no client"}`);
  const budget = f.budgetTokens ?? DEFAULT_BUDGET_TOKENS;
  const name = f.codeAnalyst === "gemini" ? "Gemini" : f.codeAnalyst === "xai" ? "xAI (Grok, direct)" : "OpenRouter";

  const onEvent = (e: RunEvent) => {
    if (e.type === "plan") {
      log(`${chalk.bold("JevX boundary")} ${chalk.gray(`${project} · ${usage.stats.decisionSites} decision site(s) found · analyzing ${e.anchors.length}`)}`);
      for (const s of e.anchors) {
        log(`  ${chalk.green("◆")} ${siteLine(s)}`);
        const cs = e.contrasts[s.id] ?? [];
        if (!cs.length) log(chalk.gray(`      no meaningful nearby non-Jev decision (not forced)`));
        for (const c of cs) log(chalk.gray(`      ◇ contrast (${c.selection}) ${c.candidate.file}:${c.candidate.unit.start} ${c.candidate.unit.name}`));
      }
      if (!f.dryRun && !f.offline)
        err(
          chalk.gray(
            `${name} (${t.model}): each Jev site goes with its file (outline + function if very large) and the finder's facts; the analyst may ask for more (callees, callers, types, constants, folder, repo overview). Contrasts go in one call per site. Secret-scrubbed; credential-looking files never sent. Token budget for this project: ${budget.toLocaleString("en-US")}.`
          )
        );
    } else if (e.type === "usage") err(`  ${e.ok ? chalk.green("✓") : chalk.red("✗")} why Jev here? ${e.site.file}:${e.site.unit.start}${e.cached ? chalk.gray(" (cached)") : ""} ${chalk.gray(e.error ?? fmtAcc(e.accounting))}`);
    else if (e.type === "contrast") err(`  ${e.ok ? chalk.green("✓") : chalk.red("✗")} why deterministic there? ${e.count} contrast(s) for ${e.site.unit.name}${e.cached ? chalk.gray(" (cached)") : ""} ${chalk.gray(e.error ?? fmtAcc(e.accounting))}`);
    else if (e.type === "budget") err(chalk.yellow(`  token budget reached (${e.spent.toLocaleString("en-US")} ≥ ${e.budget.toLocaleString("en-US")}): remaining analyses skipped`));
  };

  const result = await runBoundary({
    project,
    visibility: f.visibility ?? "public",
    root: cfg.root,
    files: scanned.files,
    analysis,
    usage,
    context: index,
    transport: t.transport,
    analyst: { provider: f.codeAnalyst, model: t.model },
    cache: new BoundaryCache(cfg.root, f.cache),
    dryRun: f.dryRun,
    offline: f.offline,
    maxUsages: f.maxUsages ?? DEFAULT_MAX_USAGES,
    maxContrasts: f.maxContrasts ?? DEFAULT_MAX_CONTRASTS,
    budgetTokens: budget,
    mode: f.context,
    maxRounds: f.rounds,
    contextBudget: f.contextBudget === 0 ? Infinity : f.contextBudget,
    timeoutMs: t.timeoutMs,
    onEvent: f.json ? undefined : onEvent
  });
  if (!f.dryRun) new BoundaryStore(f.dataset).saveRun(project, result);
  if (f.json) {
    log(JSON.stringify({ run: result.run, analyses: result.analyses, contrasts: result.contrasts }, null, 2));
    return result;
  }
  const r = result.run;
  log("");
  if (f.dryRun) {
    log(chalk.gray("Dry run: nothing was sent and nothing was saved."));
    return result;
  }
  log(
    `${chalk.bold("Usage")} ${project}: ${r.usages.analyzed}/${r.usages.anchors} Jev site(s) analyzed (${r.usages.cached} cached, ${r.usages.failed} failed${r.usages.skippedBudget ? `, ${r.usages.skippedBudget} skipped by budget` : ""}) · ${r.contrasts.analyzed}/${r.contrasts.selected} contrast(s)`
  );
  log(`       ${fmtAcc(r.accounting)} · model ${t.model}`);
  for (const e of r.errors) log(chalk.red(`  ${e}`));
  for (const a of result.analyses) {
    const x = a.analysis;
    log("");
    log(`${chalk.green("◆")} ${chalk.bold(`${a.site.file}:${a.site.unit.start} ${a.site.unit.name}`)} ${chalk.gray(`· ${a.facts.nature} · confidence ${a.facts.confidence}${a.usable ? "" : " · ⚠ context insufficient"} · model inference`)}`);
    if (!x) {
      log(chalk.gray("  private project: facts only in the dataset (free text stays in the local cache)"));
      continue;
    }
    log(`  decides   ${x.decision.what_is_decided}`);
    for (const c of x.why_jev.observed.slice(0, 3)) log(chalk.gray(`  observed  ${c.claim}${c.evidence[0] ? ` [${c.evidence[0].location}]` : ""}`));
    for (const c of x.why_jev.inferred.slice(0, 3)) log(`  inferred  ${c.claim}`);
    for (const u of x.why_jev.unknown.slice(0, 2)) log(chalk.yellow(`  unknown   ${u}`));
    log(chalk.gray(`  features  ${Object.entries(a.facts.features).map(([k, v]) => `${k.replace(/_/g, " ")}=${v}`).join(" · ")}`));
    for (const c of result.contrasts.filter((d) => d.siteId === a.siteId)) {
      const y = c.analysis;
      log(`  ${chalk.blue("◇")} ${c.contrast.file}:${c.contrast.unit.start} ${c.contrast.unit.name} ${chalk.gray(`(${c.contrast.selection}) · ${c.facts.nature} · shares Jev-site traits: ${c.facts.shares_jev_site_traits}`)}`);
      if (y) for (const d of y.differences_from_jev_site.slice(0, 2)) log(chalk.gray(`      ≠ ${d.claim}`));
    }
  }
  log("");
  log(chalk.gray(`Saved to ${path.join(f.dataset, "boundary", project)} (B usages · C analyses · D contrasts · runs). Next: more projects, then jevx boundary-patterns.`));
  return result;
}

// ─── jevx boundary-patterns ───

export interface PatternFlags {
  dataset: string;
  config?: string;
  model?: string;
  includeTest: boolean;
  json: boolean;
  /** Count only: derive the patterns from the stored records without calling any model. */
  offline: boolean;
  /** Groups per synthesis call. Small keeps each reply short. */
  batchSize?: number;
  /** Hard cap on synthesis calls. */
  maxBatches?: number;
  timeout?: number;
}

export async function runBoundaryPatterns(f: PatternFlags, log: (s: string) => void) {
  const store = new BoundaryStore(f.dataset);
  const ds = new Dataset(f.dataset);
  const test = new Set(ds.projects().filter((p) => p.split === "test").map((p) => p.slug));
  const projects = store.projects().filter((p) => f.includeTest || !test.has(p));
  const skipped = store.projects().filter((p) => !projects.includes(p));
  const analyses = projects.flatMap((p) => store.analyses(p));
  const contrasts = projects.flatMap((p) => store.contrasts(p));
  if (!analyses.length) throw new Error("no stored usage analyses yet — run jevx boundary on some projects first");

  // Step 1 (counting) never needs a key. Step 2 only rewords what step 1 counted.
  let transport: GeminiTransport | undefined;
  let analyst: { provider: string; model: string } | undefined;
  let timeoutMs: number | undefined;
  if (!f.offline) {
    const cfg = await loadConfig(process.cwd(), { configFile: f.config, selfModule: selfModule() });
    const x = cfg.raw.xai ?? {};
    const model = resolveXaiModel(f.model, x.model);
    timeoutMs = f.timeout ?? resolveXaiTimeout(undefined, x.timeoutMs);
    const made = createXaiTransport({ model, baseURL: x.baseURL, timeoutMs, pricePerMInput: x.pricePerMInput, pricePerMOutput: x.pricePerMOutput });
    if (!made.transport) throw new Error(made.error);
    transport = made.transport;
    analyst = { provider: "xai", model };
  }

  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const r = await derivePatterns({
    analyses,
    contrasts,
    transport,
    analyst,
    batchSize: f.batchSize,
    maxBatches: f.maxBatches,
    timeoutMs,
    excludedProjects: skipped,
    runId,
    onEvent: (e) => {
      if (e.type === "aggregated")
        err(
          chalk.gray(
            `Counted ${e.groups} evidence group(s) from ${e.analyses} Jev usage analysis/es and ${e.contrasts} real-decision contrast(s) in ${projects.length} project(s).${skipped.length ? ` TEST projects excluded: ${skipped.join(", ")}.` : ""}`
          )
        );
      if (e.type === "batch") err(chalk.gray(`  batch ${e.index}/${e.of}: wording ${e.groups.length} group(s) — counts and ids are not sent to be changed, only described`));
      if (e.type === "batch_done") err(chalk.gray(`    ✓ ${e.answered} group(s) · ${fmtAcc(e.accounting)}`));
      if (e.type === "batch_failed") err(chalk.yellow(`    ✗ ${e.error} — these groups keep JevX's own wording`));
    }
  });
  const files = store.saveLayerE(r.record);
  if (f.json) return void log(JSON.stringify(r.record, null, 2));

  const ps = r.record.result.patterns;
  log(`${chalk.bold("Boundary patterns")} ${chalk.gray(`(hypotheses from ${r.record.source.usableAnalyses} Jev usages + ${r.record.source.realDecisionContrasts} real-decision contrasts in ${projects.length} project(s)${r.record.accounting.calls ? ` · ${fmtAcc(r.record.accounting)}` : " · no model used"})`)}`);
  for (const side of ["separator", "jev", "deterministic"] as const) {
    const rows = ps.filter((p) => p.side === side);
    if (!rows.length) continue;
    log("");
    log(chalk.bold(side === "separator" ? "What separates them" : side === "jev" ? "Jev side only (separates nothing yet)" : "Deterministic side"));
    for (const p of rows)
      log(
        `  • ${p.statement} ${chalk.gray(`[${p.strength} · ${p.confidence} · ${p.supporting.length}↔${p.contrasting.length} records · ${p.projects.length} project(s)${p.contested ? ` · ${p.counter_examples.length} counter` : ""}]`)}`
      );
  }
  if (r.record.result.rejected_explanations.length) {
    log("");
    log(chalk.bold("Not supported by the evidence"));
    for (const x of r.record.result.rejected_explanations) log(chalk.gray(`  ✗ ${x.statement} — ${x.why}`));
  }
  if (r.record.notes.length) {
    log("");
    log(chalk.bold("About the evidence itself"));
    for (const x of r.record.notes) log(chalk.gray(`  · ${x}`));
  }
  if (r.record.result.open_questions.length) {
    log("");
    log(chalk.bold("Open questions"));
    for (const q of r.record.result.open_questions) log(chalk.gray(`  ? ${q}`));
  }
  if (r.errors.length) {
    log("");
    log(chalk.yellow(`${r.errors.length} synthesis batch(es) failed; their groups kept JevX's own wording:`));
    for (const e of r.errors) log(chalk.gray(`  ✗ ${e}`));
  }
  log("");
  log(chalk.gray(`Wrote ${path.relative(process.cwd(), files.json)} and ${path.relative(process.cwd(), files.md)} (run appended to patterns.jsonl).`));
}
