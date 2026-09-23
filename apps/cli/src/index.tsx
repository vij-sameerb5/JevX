#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import React from "react";
import { render } from "ink";
import chalk from "chalk";
import { Command, InvalidArgumentError, Option } from "commander";
import { CODE_ANALYSTS, type Band, type Candidate, type CodeAnalystProvider } from "@jevx/core";
import { CandidateDetail, ReviewScreen, ScanScreen, WelcomeScreen } from "@jevx/terminal-ui";
import { Dataset, SPLITS, addMissed, evaluate, labelEntry, type DatasetEntry, type Split } from "@jevx/dataset";
import { analysisJson, defaultDatasetDir, printAnalysis, runAnalyze, type AnalyzeFlags } from "./commands/analyze.js";
import {
  defaultLabeller,
  parseCategory,
  parseHardNegative,
  parseLabel,
  parsePrimitive,
  printCheck,
  printEval,
  printList
} from "./commands/dataset.js";
import { ABOUT, BUILD, COMMANDS, SHIPPED, VERSION } from "./meta.js";
import {
  candidateJson,
  validateDetected,
  exitCodeFor,
  prepareScan,
  printPlain,
  runScan,
  toJson,
  validationNotice,
  type ScanFlags
} from "./commands/scan.js";
import { runCheck } from "./commands/check.js";
import { runBoundaryCommand, runBoundaryPatterns, runJevUsages } from "./commands/boundary.js";
import { runInit } from "./commands/init.js";

interface ScanOpts {
  json?: boolean;
  plain?: boolean;
  validate: boolean;
  validateAll?: boolean;
  cache: boolean;
  min?: number;
  failOn?: Band;
  config?: string;
  cwd?: string;
}

const isInteractive = (o: { json?: boolean; plain?: boolean }) =>
  Boolean(process.stdout.isTTY && process.stdin.isTTY) && !o.json && !o.plain;

function parseMin(value: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100) throw new InvalidArgumentError("must be a number from 0 to 100");
  return n;
}

function toFlags(o: ScanOpts, rootArg?: string): ScanFlags {
  return {
    root: path.resolve(rootArg ?? o.cwd ?? process.cwd()),
    config: o.config,
    json: Boolean(o.json),
    plain: Boolean(o.plain) || !isInteractive(o),
    validate: o.validate,
    validateAll: Boolean(o.validateAll),
    cache: o.cache !== false,
    failOn: o.failOn,
    min: o.min
  };
}

/** Options shared by scan-like commands. */
function withScanOptions(cmd: Command): Command {
  return cmd
    .option("--json", "machine-readable output (for CI)")
    .option("--plain", "non-interactive text output")
    .option("--no-validate", "fast AST-only pass — nothing is sent to TypeSafe")
    .option("--validate-all", "send every candidate to TypeSafe, including below the minimum")
    .option("--no-cache", "ignore cached TypeSafe results (fresh results are still saved)")
    .option("--min <n>", "override the minimum threshold", parseMin)
    .addOption(
      new Option("--fail-on <band>", "exit 1 if any candidate is at/above this band").choices([
        "possible",
        "strong",
        "veryStrong"
      ])
    )
    .option("-c, --config <path>", "use a specific config file")
    .option("--cwd <dir>", "project root (default: current directory)");
}

async function scan(flags: ScanFlags, interactive: boolean): Promise<number> {
  const cfg = await prepareScan(flags);

  if (flags.json || flags.plain || !interactive) {
    const result = await runScan(cfg, flags);
    if (flags.json) print(JSON.stringify(toJson(result, cfg, flags), null, 2));
    else printPlain(result, flags);
    return exitCodeFor(result, flags.failOn);
  }

  let final: Awaited<ReturnType<typeof runScan>> | undefined;
  const app = render(
    <ScanScreen
      run={(p) => runScan(cfg, flags, p)}
      notice={(r) => validationNotice(flags, r)}
      onExit={(r) => (final = r)}
    />
  );
  await app.waitUntilExit();
  return final ? exitCodeFor(final, flags.failOn) : 0;
}

async function explain(target: string, flags: ScanFlags, interactive: boolean): Promise<number> {
  const match = target.match(/^(.+):(\d+)$/);
  if (!match) return fail("Usage: jevx explain <file:line>");
  const [, file, lineStr] = match;
  const line = Number(lineStr);
  const abs = path.resolve(file!);
  if (!existsSync(abs)) return fail(`File not found: ${abs}`);
  const cfg = await prepareScan(flags);
  const rel = path.relative(cfg.root, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return fail(`${abs} is outside the project root ${cfg.root}. Pass --cwd <project root>.`);
  }
  const wanted = rel.split(path.sep).join("/");
  // Analyse just this file (even if include/exclude would skip it). raw keeps the ignore band too.
  cfg.include = [wanted];
  cfg.exclude = [];
  const detected = await runScan(cfg, { ...flags, validate: false });
  const found: Candidate | undefined = detected.raw
    .filter((c) => c.file === wanted && c.line <= line && c.endLine >= line)
    .sort((a, b) => b.line - a.line)[0];
  if (!found) {
    const nearby = detected.raw.map((c) => `${c.line}–${c.endLine}`).join(", ");
    return fail(`No text-matching decision found at ${wanted}:${line}.${nearby ? ` Decisions in this file span lines: ${nearby}.` : ""}`);
  }
  // Validate only this decision (even below 50) — one API call at most.
  const result = flags.validate
    ? await validateDetected({ ...detected, raw: [found] }, cfg, { ...flags, validateAll: true })
    : detected;
  const hit = result.raw[0] && flags.validate ? result.raw[0] : found;

  if (flags.json) {
    return print(JSON.stringify(candidateJson(hit), null, 2));
  }
  if (interactive) {
    const app = render(<CandidateDetail candidate={hit} />);
    app.unmount();
    await app.waitUntilExit();
    return 0;
  }
  const v = hit.validation;
  if (hit.confidence !== undefined && v) {
    print(`${hit.file}:${hit.line}  ${hit.confidence}% final (${hit.band}) · AST ${hit.score}`);
    print(`  TypeSafe: ${v.status} · meaning-based ${Math.round((v.semantic ?? 0) * 100)}% · human text ${Math.round((v.humanText ?? 0) * 100)}% · kind ${v.kind}${v.cached ? " · cached" : ""}`);
    if (v.reason) print(chalk.gray(`  decided by: ${v.reason}`));
    for (const a of v.advisories ?? []) print(chalk.yellow(`  note: ${a}`));
  } else {
    print(`${hit.file}:${hit.line}  ${hit.score}% (${hit.band}, preliminary)`);
    if (v?.status === "rejected") print(chalk.yellow(`  TypeSafe: rejected — ${v.reason ?? ""} (meaning-based ${Math.round((v.semantic ?? 0) * 100)}%, kind ${v.kind})`));
    if (v?.status === "error") print(chalk.red(`  TypeSafe validation failed: ${v.error}`));
    else if (result.validation?.skipped) print(chalk.gray(`  TypeSafe validation skipped: ${result.validation.skipped}`));
  }
  for (const s of hit.signals) {
    print(`  ${s.weight > 0 ? "+" : ""}${s.weight} ${s.id}`);
    for (const e of s.evidence) print(chalk.gray(`      ${e}`));
  }
  return 0;
}

function welcome(): Promise<string | undefined> {
  return new Promise((resolve) => {
    let picked: string | undefined;
    const app = render(
      <WelcomeScreen
        version={VERSION}
        onSelect={(id) => (picked = id)}
        items={[
          { id: "analyze", label: "Analyze", hint: "find decision boundaries in this folder (offline)" },
          { id: "scan", label: "Scan", hint: "legacy text-matching detector" },
          { id: "init", label: "Init", hint: "create jevx.config.ts" },
          { id: "help", label: "Help", hint: "all commands and flags" },
          { id: "about", label: "About", hint: "what JevX is" },
          { id: "quit", label: "Quit", hint: "" }
        ]}
      />
    );
    app.waitUntilExit().then(() => resolve(picked === "quit" ? undefined : picked));
  });
}

function commandList(): string {
  const width = Math.max(...COMMANDS.map((c) => c.usage.length)) + 2;
  return COMMANDS.map((c) => {
    const tag = SHIPPED.has(c.milestone) ? chalk.green("ready") : chalk.gray(c.milestone);
    return `  ${c.usage.padEnd(width)} ${c.summary.padEnd(44)} ${tag}`;
  }).join("\n");
}

/** Nearest ancestor with jevx.config.*, package.json or .git; else the file's own folder. */
function findProjectRoot(file: string): string {
  const markers = ["jevx.config.ts", "jevx.config.mts", "jevx.config.js", "jevx.config.mjs", "package.json", ".git"];
  let dir = path.dirname(file);
  for (;;) {
    if (markers.some((m) => existsSync(path.join(dir, m)))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.dirname(file);
    dir = parent;
  }
}

function print(s: string): number {
  process.stdout.write(s.endsWith("\n") ? s : s + "\n");
  return 0;
}

function fail(msg: string): number {
  process.stderr.write(`${chalk.red("✗")} ${msg}\n`);
  return 1;
}

// `jevx scan --plain | head` closes the pipe early; that's not an error.
process.stdout.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EPIPE") process.exit(process.exitCode ?? 0);
  throw err;
});

// ─── Program ────────────────────────────────────────────────────────────

const program = new Command()
  .name("jevx")
  .description("Find semantic decision boundaries in TS/JS code and judge them with TypeSafe (Jev).")
  .version(VERSION, "-v, --version")
  .option("--commands", "list every command and when it ships")
  .option("--about", "what JevX is")
  .showHelpAfterError()
  .action(async (opts: { commands?: boolean; about?: boolean }) => {
    if (opts.about) return void (process.exitCode = print(ABOUT));
    if (opts.commands) return void (process.exitCode = print(commandList()));
    if (!isInteractive({})) return void program.help();
    const choice = await welcome();
    if (choice === "analyze") process.exitCode = await analyze(analyzeFlags({}, undefined));
    else if (choice === "scan") process.exitCode = await scan(toFlags({ validate: true, cache: true }), true);
    else if (choice === "init") process.exitCode = runInit(process.cwd(), false);
    else if (choice === "help") program.help();
    else if (choice === "about") print(ABOUT);
  });

for (const name of ["scan", "inspect"] as const) {
  withScanOptions(
    program
      .command(name)
      .description(name === "scan" ? "scan, score and list candidates" : "same as scan, straight into the explorer")
      .argument("[path]", "project root")
  ).action(async (rootArg: string | undefined, opts: ScanOpts) => {
    process.exitCode = await scan(toFlags(opts, rootArg), isInteractive(opts));
  });
}

withScanOptions(
  program.command("explain").description("signal breakdown for one candidate").argument("<file:line>")
).action(async (target: string, opts: ScanOpts) => {
  // Without --cwd, the project root is inferred from the file, not from where jevx was run.
  const file = target.replace(/:\d+$/, "");
  const root = opts.cwd ?? findProjectRoot(path.resolve(file));
  process.exitCode = await explain(target, toFlags({ ...opts, cwd: root }), isInteractive(opts));
});

program
  .command("init")
  .description("create jevx.config.ts")
  .argument("[path]", "project root")
  .option("--force", "overwrite an existing config")
  .action((rootArg: string | undefined, opts: { force?: boolean }) => {
    process.exitCode = runInit(path.resolve(rootArg ?? process.cwd()), Boolean(opts.force));
  });

program
  .command("check")
  .description("verify config, TypeSafe / Grok (xAI) / Gemini / OpenRouter keys and API reachability (sends no repository code)")
  .argument("[path]", "project root")
  .option("-c, --config <path>", "use a specific config file")
  .option("--gemini", "fail if the Gemini code analyst is not usable")
  .option("--gemini-model <id>", "Gemini model to check")
  .option("--openrouter", "fail if the OpenRouter code analyst is not usable")
  .option("--openrouter-model <id>", "OpenRouter model to check")
  .option("--grok", "fail if the direct xAI (Grok) analyst is not usable; sends one tiny no-code test request")
  .option("--grok-model <id>", "xAI model to check (default: $XAI_MODEL, config, or grok-4.6)")
  .option("--code-analyst <provider>", "gemini | openrouter (repeatable): fail if that analyst is not usable", collectAnalyst, [] as CodeAnalystProvider[])
  .action(
    async (rootArg: string | undefined, opts: { config?: string; gemini?: boolean; geminiModel?: string; openrouter?: boolean; openrouterModel?: string; grok?: boolean; grokModel?: string; codeAnalyst?: CodeAnalystProvider[] }) => {
      const want = new Set(opts.codeAnalyst ?? []);
      process.exitCode = await runCheck(path.resolve(rootArg ?? process.cwd()), opts.config, {
        requireGemini: Boolean(opts.gemini) || want.has("gemini"),
        geminiModel: opts.geminiModel,
        requireOpenRouter: Boolean(opts.openrouter) || want.has("openrouter"),
        openrouterModel: opts.openrouterModel,
        requireGrok: Boolean(opts.grok),
        grokModel: opts.grokModel,
        grokSmokeTest: Boolean(opts.grok)
      });
    }
  );

// ─── Phase 1: analyze · review · label · eval · dataset ──────────────────

interface AnalyzeOpts {
  json?: boolean;
  all?: boolean;
  limit?: number;
  validate?: boolean;
  gemini?: boolean;
  geminiModel?: string;
  openrouter?: boolean;
  openrouterModel?: string;
  codeAnalyst?: CodeAnalystProvider[];
  geminiContext?: "adaptive" | "local";
  geminiRounds?: number;
  geminiBudget?: number;
  offline?: boolean;
  cache?: boolean;
  save?: boolean;
  project?: string;
  public?: boolean;
  private?: boolean;
  source?: string;
  commit?: string;
  license?: string;
  split?: Split;
  domain?: string[];
  dataset?: string;
  config?: string;
  cwd?: string;
}

function analyzeFlags(o: AnalyzeOpts, rootArg?: string): AnalyzeFlags {
  if (o.public && o.private) throw new InvalidArgumentError("choose --public or --private, not both");
  return {
    root: path.resolve(rootArg ?? o.cwd ?? process.cwd()),
    config: o.config,
    json: Boolean(o.json),
    all: Boolean(o.all),
    limit: o.limit,
    validate: Boolean(o.validate),
    gemini: Boolean(o.gemini) || Boolean(o.codeAnalyst?.includes("gemini")),
    geminiModel: o.geminiModel,
    openrouter: Boolean(o.openrouter) || Boolean(o.codeAnalyst?.includes("openrouter")),
    openrouterModel: o.openrouterModel,
    geminiContext: o.geminiContext,
    geminiRounds: o.geminiRounds,
    geminiBudget: o.geminiBudget,
    offline: Boolean(o.offline),
    cache: o.cache !== false,
    save: Boolean(o.save),
    project: o.project,
    visibility: o.public ? "public" : o.private ? "private" : undefined,
    source: o.source,
    commit: o.commit,
    license: o.license,
    split: o.split,
    domains: o.domain,
    dataset: o.dataset ? path.resolve(o.dataset) : defaultDatasetDir()
  };
}

async function analyze(flags: AnalyzeFlags): Promise<number> {
  const log = (m: string) => void process.stdout.write(m + "\n");
  const { result, saved } = await runAnalyze(flags, flags.json ? () => {} : log);
  if (flags.json) print(JSON.stringify(analysisJson(result, saved), null, 2));
  else printAnalysis(result, flags, saved, log);
  return 0;
}

/** --code-analyst gemini|openrouter, repeatable (both may run). */
function collectAnalyst(v: string, prev: CodeAnalystProvider[]): CodeAnalystProvider[] {
  const p = v.trim().toLowerCase();
  if (!(CODE_ANALYSTS as readonly string[]).includes(p)) throw new InvalidArgumentError(`must be one of ${CODE_ANALYSTS.join(", ")}`);
  return prev.includes(p as CodeAnalystProvider) ? prev : [...prev, p as CodeAnalystProvider];
}

const parseInt10 = (v: string) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new InvalidArgumentError("must be a non-negative integer");
  return n;
};

program
  .command("analyze")
  .description("find semantic decision boundaries (offline unless --gemini / --openrouter / --validate)")
  .argument("[path]", "project root")
  .option("--json", "machine-readable output")
  .option("--all", "also list candidates filtered as NOT_JEV")
  .option("--limit <n>", "how many candidates to print", parseInt10)
  .option("--validate", "ask TypeSafe about each unfiltered candidate (sends unit code, secret-scrubbed)")
  .option("--gemini", "add Gemini code-analyst evidence (optional; needs GEMINI_API_KEY; sends unit code, secret-scrubbed)")
  .option("--gemini-model <id>", "Gemini model (default: $GEMINI_MODEL, config, or gemini-3.8-flash)")
  .option("--openrouter", "add OpenRouter code-analyst evidence (optional; needs OPENROUTER_API_KEY; same prompt, schema and context rules as --gemini)")
  .option("--openrouter-model <id>", "OpenRouter model (default: $OPENROUTER_MODEL, config, or x-ai/grok-4.6)")
  .option("--code-analyst <provider>", "gemini | openrouter (repeatable; same as --gemini / --openrouter)", collectAnalyst, [] as CodeAnalystProvider[])
  .addOption(new Option("--gemini-context <mode>", "code analysts: adaptive = may ask for more repo context; local = the candidate's file only").choices(["adaptive", "local"]))
  .option("--gemini-rounds <n>", "code analysts: max rounds per candidate (default 4)", (v) => Math.max(1, parseInt10(v)))
  .option("--gemini-budget <chars>", "code analysts: max context characters per candidate; 0 = unlimited (default 250000)", parseInt10)
  .option("--offline", "with --gemini / --openrouter / --validate: replay cached answers only, never call an API")
  .option("--no-cache", "ignore cached Gemini / OpenRouter / TypeSafe answers")
  .option("--save", "add / update this project in the dataset")
  .option("--project <slug>", "dataset project name (default: package.json name)")
  .option("--public", "open-source project: scrubbed code snippets may be stored")
  .option("--private", "private project: fingerprint-only, no code is stored")
  .option("--source <url>", "public projects: where the code came from")
  .option("--commit <sha>", "public projects: commit analyzed")
  .option("--license <id>", "public projects: license")
  .addOption(new Option("--split <split>", "assign a split manually (default: deterministic hash)").choices([...SPLITS]))
  .option("--domain <domain...>", "project domain tags (fintech, health, devtools…)")
  .option("--dataset <dir>", "dataset directory (default: $JEVX_DATASET or ./dataset)")
  .option("-c, --config <path>", "use a specific config file")
  .option("--cwd <dir>", "project root (default: current directory)")
  .action(async (rootArg: string | undefined, opts: AnalyzeOpts) => {
    process.exitCode = await analyze(analyzeFlags(opts, rootArg));
  });

function datasetOf(opts: { dataset?: string }): Dataset {
  return new Dataset(opts.dataset ? path.resolve(opts.dataset) : defaultDatasetDir());
}

/** Source for review: stored snippet (public), or the file on disk under --root (private). */
function codeReader(root?: string) {
  const cache = new Map<string, string[] | undefined>();
  return (e: DatasetEntry): string | undefined => {
    if (e.code) return e.code;
    if (!root) return undefined;
    if (!cache.has(e.file)) {
      const abs = path.join(root, e.file);
      cache.set(e.file, existsSync(abs) ? readFileSync(abs, "utf8").split("\n") : undefined);
    }
    return cache.get(e.file)?.slice(e.unit.start - 1, e.unit.end).join("\n");
  };
}

program
  .command("review")
  .description("label a project's decisions interactively (STRONG_JEV / POSSIBLE_JEV / NOT_JEV)")
  .argument("<project>", "dataset project slug")
  .option("--root <path>", "project source on disk (needed to show code for private projects)")
  .option("--unlabelled", "only entries without a current human label")
  .option("--labeller <name>", "who is labelling (default: $JEVX_LABELLER or $USER)")
  .option("--dataset <dir>", "dataset directory")
  .action(async (slug: string, opts: { root?: string; unlabelled?: boolean; labeller?: string; dataset?: string }) => {
    const ds = datasetOf(opts);
    const project = ds.project(slug);
    if (!project) return void (process.exitCode = fail(`No project "${slug}" in ${ds.dir}. Run: jevx analyze <path> --save --public|--private --project ${slug}`));
    if (!isInteractive({})) return void (process.exitCode = fail("review needs an interactive terminal. For scripts use: jevx label <project> <id> <label> --reason \"…\""));
    const rank = (e: DatasetEntry) => (e.human && !e.needsRecheck ? 2 : 0) + (e.auto.source === "triage" ? 1 : 0);
    const entries = ds
      .entries(slug)
      .filter((e) => e.status === "active" && (!opts.unlabelled || !e.human || e.needsRecheck))
      .sort((a, b) => rank(a) - rank(b) || a.file.localeCompare(b.file) || a.unit.start - b.unit.start);
    const labeller = opts.labeller ?? defaultLabeller();
    const app = render(
      <ReviewScreen
        project={slug}
        visibility={project.visibility}
        entries={entries}
        codeFor={codeReader(opts.root ? path.resolve(opts.root) : undefined)}
        onLabel={(e, input) => labelEntry(ds, slug, e.id, { ...input, labeller })}
      />
    );
    await app.waitUntilExit();
  });

program
  .command("label")
  .description("label one decision without the TUI")
  .argument("<project>", "dataset project slug")
  .argument("<id>", "entry id (or a unique prefix)")
  .argument("<label>", "STRONG_JEV | POSSIBLE_JEV | NOT_JEV (or s / p / n)")
  .requiredOption("--reason <text>", "why — required (an optional human spot-check, kept with its reasoning)")
  .addOption(new Option("--confidence <level>", "how sure").choices(["high", "medium", "low"]).default("medium"))
  .option("--category <category>", "decision category (taxonomy)")
  .option("--primitive <primitive>", "noul | choice | score | none")
  .option("--hard-negative <reason>", "for NOT_JEV: why exact code is right")
  .option("--labeller <name>", "who is labelling")
  .option("--dataset <dir>", "dataset directory")
  .action((slug: string, id: string, label: string, opts: { reason: string; confidence: "high" | "medium" | "low"; category?: string; primitive?: string; hardNegative?: string; labeller?: string; dataset?: string }) => {
    const e = labelEntry(datasetOf(opts), slug, id, {
      label: parseLabel(label),
      reasoning: opts.reason,
      confidence: opts.confidence,
      category: parseCategory(opts.category),
      primitive: parsePrimitive(opts.primitive),
      hardNegativeReason: parseHardNegative(opts.hardNegative),
      labeller: opts.labeller ?? defaultLabeller()
    });
    print(`${chalk.green("✓")} ${slug} ${e.id.slice(0, 8)} ${e.file}:${e.boundary.start} ${e.unit.name} → ${e.human!.label}`);
  });

program
  .command("eval")
  .description("per-split metrics against human labels, where any exist (optional spot-checks, not the M5b dataset)")
  .option("--json", "machine-readable output")
  .option("--rotate <seed>", "re-assign hash-split projects with another seed (cross-project check)")
  .option("--dataset <dir>", "dataset directory")
  .action((opts: { json?: boolean; rotate?: string; dataset?: string }) => {
    const r = evaluate(datasetOf(opts), { rotateSeed: opts.rotate });
    if (opts.json) print(JSON.stringify(r, null, 2));
    else printEval(r, (m) => void print(m));
  });

const datasetCmd = program.command("dataset").description("inspect and validate the Decision Opportunity Dataset");
datasetCmd
  .command("list")
  .description("projects, splits and label counts")
  .option("--dataset <dir>", "dataset directory")
  .action((opts: { dataset?: string }) => printList(datasetOf(opts), (m) => void print(m)));
datasetCmd
  .command("check")
  .description("schema, privacy (no private code, no secrets) and split-leakage checks")
  .option("--rotate <seed>", "check leakage under a rotated split")
  .option("--dataset <dir>", "dataset directory")
  .action((opts: { dataset?: string; rotate?: string }) => {
    process.exitCode = printCheck(datasetOf(opts), (m) => void print(m), opts.rotate);
  });
datasetCmd
  .command("missed")
  .description("record a decision JevX did not propose (needed to measure recall)")
  .argument("<project>", "dataset project slug")
  .argument("<file:line>", "where the decision is (project-relative)")
  .argument("<label>", "STRONG_JEV | POSSIBLE_JEV | NOT_JEV")
  .requiredOption("--reason <text>", "what the decision is and why it (doesn't) fit Jev")
  .option("--end <line>", "last line of the decision", parseInt10)
  .option("--name <name>", "function / block name")
  .option("--category <category>", "decision category")
  .option("--primitive <primitive>", "noul | choice | score | none")
  .option("--hard-negative <reason>", "for NOT_JEV: why exact code is right")
  .addOption(new Option("--confidence <level>", "how sure").choices(["high", "medium", "low"]).default("medium"))
  .option("--root <path>", "public projects: read the code from here to store a snippet")
  .option("--labeller <name>", "who is labelling")
  .option("--dataset <dir>", "dataset directory")
  .action((slug: string, where: string, label: string, opts: { reason: string; end?: number; name?: string; category?: string; primitive?: string; hardNegative?: string; confidence: "high" | "medium" | "low"; root?: string; labeller?: string; dataset?: string }) => {
    const m = where.match(/^(.+):(\d+)$/);
    if (!m) return void (process.exitCode = fail("expected <file:line>"));
    const [, file, lineStr] = m;
    const line = Number(lineStr);
    const end = opts.end ?? line;
    let code: string | undefined;
    if (opts.root && existsSync(path.join(opts.root, file!))) code = readFileSync(path.join(opts.root, file!), "utf8").split("\n").slice(line - 1, end).join("\n");
    const e = addMissed(datasetOf(opts), slug, {
      file: file!,
      line,
      endLine: end,
      name: opts.name,
      code,
      label: parseLabel(label),
      reasoning: opts.reason,
      confidence: opts.confidence,
      category: parseCategory(opts.category),
      primitive: parsePrimitive(opts.primitive),
      hardNegativeReason: parseHardNegative(opts.hardNegative),
      labeller: opts.labeller ?? defaultLabeller()
    });
    print(`${chalk.green("✓")} recorded missed decision ${e.id.slice(0, 8)} at ${e.file}:${e.boundary.start} → ${e.human!.label}`);
  });


// ─── M5b: learn where / when Jev is chosen, from real Jev usage (docs/CURRENT-ARCHITECTURE.md) ───

program
  .command("jev-usages")
  .description("where is Jev actually used? deterministic finder, offline, no AI (observed usage, not ground truth)")
  .argument("[path]", "project root")
  .option("-c, --config <path>", "use a specific config file")
  .option("--all", "also list plumbing and uncertain sites")
  .option("--json", "machine-readable output")
  .action(async (rootArg: string | undefined, o: { config?: string; all?: boolean; json?: boolean }) => {
    await runJevUsages({ root: path.resolve(rootArg ?? process.cwd()), config: o.config, all: Boolean(o.all), json: Boolean(o.json) }, print);
  });

program
  .command("boundary")
  .description("M5b pilot for one project: real Jev sites → why Jev here? → nearby deterministic contrasts → why not there? (Grok 4.6, direct xAI)")
  .argument("[path]", "project root")
  .option("-c, --config <path>", "use a specific config file")
  .option("--project <slug>", "project name in the dataset (default: folder name)")
  .option("--public", "open-source project: analyses may be stored as text")
  .option("--private", "private / unlicensed project: facts only in the dataset; free text stays in the local cache")
  .option("--dataset <dir>", "dataset directory")
  .option("--max-usages <n>", `Jev sites to analyze (default ${3})`, parseInt10)
  .option("--max-contrasts <n>", "nearby non-Jev decisions per site, never forced (default 3)", parseInt10)
  .option("--budget-tokens <n>", "stop before any call once this many tokens are spent (default 150000)", parseInt10)
  .addOption(new Option("--code-analyst <provider>", "analyst provider (default: direct xAI / Grok)").choices(["xai", "openrouter", "gemini"]).default("xai"))
  .option("--model <id>", "analyst model (default: $XAI_MODEL, config, or grok-4.6)")
  .option("--dry-run", "show which sites and contrasts would be analyzed; send and save nothing")
  .option("--offline", "replay cached analyses only, never call an API")
  .option("--no-cache", "ignore cached analyses")
  .addOption(new Option("--context <mode>", "adaptive: the analyst may ask for more repo context; local: first round only").choices(["adaptive", "local"]))
  .option("--rounds <n>", "max context rounds per analysis (default 4)", (v) => Math.max(1, parseInt10(v)))
  .option("--context-budget <chars>", "max context characters per analysis; 0 = unlimited (default 250000)", parseInt10)
  .option("--json", "machine-readable output")
  .action(async (rootArg: string | undefined, o: Record<string, unknown>) => {
    if (o.public && o.private) throw new InvalidArgumentError("choose --public or --private, not both");
    await runBoundaryCommand(
      {
        root: path.resolve(rootArg ?? process.cwd()),
        config: o.config as string | undefined,
        project: o.project as string | undefined,
        visibility: o.public ? "public" : o.private ? "private" : undefined,
        dataset: o.dataset ? path.resolve(o.dataset as string) : defaultDatasetDir(),
        maxUsages: o.maxUsages as number | undefined,
        maxContrasts: o.maxContrasts as number | undefined,
        budgetTokens: o.budgetTokens as number | undefined,
        codeAnalyst: o.codeAnalyst as "xai" | "openrouter" | "gemini",
        model: o.model as string | undefined,
        dryRun: Boolean(o.dryRun),
        offline: Boolean(o.offline),
        cache: o.cache !== false,
        context: o.context as "adaptive" | "local" | undefined,
        rounds: o.rounds as number | undefined,
        contextBudget: o.contextBudget as number | undefined,
        json: Boolean(o.json)
      },
      print
    );
  });

program
  .command("boundary-patterns")
  .description("M5b layer E: recurring patterns separating Jev from deterministic decisions, across stored projects (hypotheses; TEST projects excluded)")
  .option("-c, --config <path>", "use a specific config file")
  .option("--dataset <dir>", "dataset directory")
  .option("--model <id>", "analyst model (default: $XAI_MODEL, config, or grok-4.6)")
  .option("--include-test", "also use TEST-split projects (don't, before evaluation)")
  .option("--offline", "count the stored records only — derive the patterns with no model call")
  .option("--batch-size <n>", "evidence groups per synthesis call (default 4; small keeps each reply short)", Number)
  .option("--max-batches <n>", "hard cap on synthesis calls (default 8)", Number)
  .option("--timeout <ms>", "per-call timeout for the synthesis step", Number)
  .option("--json", "machine-readable output")
  .action(async (o: { config?: string; dataset?: string; model?: string; includeTest?: boolean; offline?: boolean; batchSize?: number; maxBatches?: number; timeout?: number; json?: boolean }) => {
    await runBoundaryPatterns(
      {
        dataset: o.dataset ? path.resolve(o.dataset) : defaultDatasetDir(),
        config: o.config,
        model: o.model,
        includeTest: Boolean(o.includeTest),
        offline: Boolean(o.offline),
        batchSize: o.batchSize,
        maxBatches: o.maxBatches,
        timeout: o.timeout,
        json: Boolean(o.json)
      },
      print
    );
  });

// Registered so --help tells the truth; each exits 2 and names its milestone.
for (const info of COMMANDS.filter((c) => !SHIPPED.has(c.milestone))) {
  program
    .command(info.name)
    .description(`${info.summary} ${chalk.gray(`(${info.milestone})`)}`)
    .argument("[args...]")
    .allowUnknownOption()
    .action(() => {
      process.stderr.write(
        `${chalk.yellow("•")} ${chalk.bold(`jevx ${info.name}`)} — ${info.summary}. Arrives in ${info.milestone}; this build is ${BUILD}.\n`
      );
      process.exitCode = 2;
    });
}

// exitCode (not process.exit) so piped stdout (`--json | jq`) is fully flushed.
program.parseAsync(process.argv).catch((err: unknown) => {
  process.stderr.write(`${chalk.red("✗")} ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
