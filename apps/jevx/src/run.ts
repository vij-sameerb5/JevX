// `jevx` — the whole thing in one command: index → AI finds and judges → Jev checks → write the
// strong fits → run the project's checks → report. No picking, no accept prompts.
import path from "node:path";
import chalk from "chalk";
import { applyOpportunities, runPipeline, shareEnabled, shareRun, writeReport, type Opportunity } from "@jevx/engine";
import { hasApiKey } from "@jevx/typesafe";
import { askYesNo, chooseAi, hasConsent, saveConsent } from "./ai.js";
import { VERSION } from "./server.js";
import { accent, accentBold, banner, box, card, diff, dim, ok, step, warn } from "./ui.js";

export interface RunFlags {
  root: string;
  provider?: string;
  model?: string;
  max?: number;
  budget?: number;
  dryRun: boolean;
  verify: boolean;
  install: boolean;
  yes: boolean;
  share?: boolean;
  envFile?: string;
  /** Write POSSIBLE fits too (still checked by your tests, still undoable). */
  includePossible?: boolean;
  /** Lower reasoning effort for the read step. */
  fast?: boolean;
}

const log = (s = "") => void process.stdout.write(s + "\n");
const n = (x: number) => x.toLocaleString("en-US");

export async function run(f: RunFlags): Promise<number> {
  const root = path.resolve(f.root);
  log(banner());
  const ai = chooseAi(f.provider, f.model);
  if ("error" in ai) {
    log(chalk.red(`\n  ${ai.error.split("\n").join("\n  ")}\n`));
    return 1;
  }
  const typesafe = hasApiKey();
  log(`  ${dim("Repo".padEnd(10))}${path.basename(root)}`);
  log(`  ${dim("AI".padEnd(10))}${ai.label} · ${ai.model} ${dim("(your key)")}`);
  log(`  ${dim("TypeSafe".padEnd(10))}${typesafe ? chalk.green("✓ connected") : dim("not set — scores use AI + patterns")}`);
  log(`  ${dim("Keys".padEnd(10))}${dim(f.envFile ? `from ${f.envFile.replace(process.env.HOME ?? "\u0000", "~")} + your shell` : "from your shell only (no env file — set JEVX_ENV_FILE to use one)")}`);
  log(`  ${dim("Mode".padEnd(10))}${f.dryRun ? "preview only — nothing is written" : "changes strong fits, runs your checks, undo anytime"}`);
  log("");

  if (!hasConsent(ai.provider) && !f.yes) {
    log(dim(`  JevX sends ${ai.label} your source files to read (not .env files, tests, builds or node_modules), with secrets removed.`));
    if (!process.stdin.isTTY) {
      log(chalk.red(`  First run with ${ai.label}: re-run with --yes to agree.`));
      return 1;
    }
    if (!(await askYesNo(`  Send code to ${ai.label} for this and future runs? [Y/n] `))) return 1;
    saveConsent(ai.provider);
    log("");
  } else if (f.yes && !hasConsent(ai.provider)) saveConsent(ai.provider);

  const started = Date.now();
  let lastProgress = "";
  const result = await runPipeline({
    root,
    transport: ai.transport,
    analyst: { provider: ai.provider, model: ai.model },
    maxInspect: f.max,
    budgetTokens: f.budget,
    editPossible: f.dryRun || f.includePossible,
    ...(f.fast ? { readEffort: "low" as const } : {}),
    onEvent: (e) => {
      if (e.type === "indexed") log(ok(`Indexed ${n(e.files)} files · ${e.candidates} possible spot(s)${e.existingJev ? ` · Jev already used in ${e.existingJev}` : ""} ${dim("(local, free)")}`));
      if (e.type === "reading") log(step(`${ai.label} is reading ${n(e.files)} file(s) in ${e.parts} part(s) ${dim(`~${n(e.estTokens)} tokens${e.unread ? ` · ${Math.round(e.coverage * 100)}% of the code fits the budget` : ""}`)}`));
      if (e.type === "read") log(e.error ? warn(`part ${e.done}/${e.total} failed: ${e.error}`) : dim(`    part ${e.done}/${e.total} read · ${e.kept} spot(s)${e.named > e.kept ? ` (${e.named - e.kept} unusable)` : ""} · ${e.spots} so far`));
      if (e.type === "surveyed") log(e.fallback ? warn(`Checking ${e.inspect} static candidate(s) instead`) : ok(`${ai.label} found ${e.inspect} spot(s) worth checking`));
      if (e.type === "assessing") {
        const line = step(`Reading ${e.done + 1}/${e.total} ${dim(e.where)}`);
        if (line !== lastProgress) log((lastProgress = line));
      }
      if (e.type === "editing") log(step(`Writing the change ${dim(e.where)}`));
      if (e.type === "budget") log(warn(`Token budget reached (${n(e.spent)}) — remaining spots skipped`));
    }
  });
  for (const e of result.errors) log(warn(e));

  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const found = result.opportunities.filter((o) => o.record);
  const strong = found.filter((o) => o.status === "strong" && o.edits?.length);
  const possible = found.filter((o) => o.status === "possible" && o.edits?.length);
  const toApply = f.includePossible ? [...strong, ...possible] : strong;
  const previewed = (o: Opportunity) => f.dryRun && Boolean(o.edits?.length) && (o.status === "strong" || o.status === "possible");
  log("");
  if (!found.length) {
    const why = result.opportunities.slice(0, 8).map((o) => `${dim("·")} ${o.unit.name}() ${dim(`${o.file}:${o.unit.start}`)}  ${dim((o.note ?? o.status).replace(/\s+/g, " ").slice(0, 90))}`);
    log(box([`No Jev opportunities found in ${result.opportunities.length} place(s) inspected.`, ...(why.length ? ["", "Why each was left alone:", ...why] : []), "", dim("Full answers: .jevx/debug/")], "JEVX RESULT"));
    logCost(result.spend, started);
    await share(f, runId, ai, result.opportunities);
    return 0;
  }

  // apply
  let applied: ReturnType<typeof applyOpportunities> | undefined;
  if (!f.dryRun && toApply.length) {
    log(step(`Applying ${toApply.length} change(s)${f.verify ? " and running your checks" : ""}…`));
    applied = applyOpportunities({
      root,
      runId,
      opportunities: toApply,
      verify: f.verify,
      install: f.install,
      onEvent: (e) => {
        if (e.type === "baseline" && e.results.length) log(ok(`Checks before: ${e.results.map((r) => `${r.name} ${r.ok ? chalk.green("pass") : chalk.yellow("already failing")}`).join(" · ")}`));
        if (e.type === "baseline" && !e.results.length) log(warn("No test script or TypeScript config found — changes are not verified"));
        if (e.type === "installing") log(step(`Installing @typesafe-ai/sdk with ${e.pm}…`));
        if (e.type === "isolating") log(warn(`A check failed — trying the ${e.count} change(s) one at a time`));
        if (e.type === "reverted") log(warn(`Reverted ${e.opportunity.unit.name}(): ${e.reason}`));
      }
    });
  }
  const kept = new Set(applied?.changed.map((o) => o.id) ?? []);
  const outcome = (o: Opportunity) => {
    if (previewed(o)) return accent(o.status === "strong" ? "→ preview below" : "→ preview · needs --include-possible");
    if (o.status === "possible" && !f.includePossible) return dim("→ left as is · --include-possible writes it");
    if (kept.has(o.id)) return chalk.green("→ changed");
    const r = applied?.reverted.find((x) => x.opportunity.id === o.id) ?? applied?.skipped.find((x) => x.opportunity.id === o.id);
    if (r) return chalk.yellow(`→ not changed: ${r.reason}`);
    if (o.status === "edit_failed") return chalk.yellow("→ couldn't write a safe change");
    return dim("→ left as is");
  };

  log("");
  found.forEach((o, i) => {
    log(card(o, i + 1, outcome(o)));
    if ((kept.has(o.id) || previewed(o)) && o.record?.patch) log(diff(o.record.patch));
    log("");
  });

  // summary
  const report = writeReport(root);
  const lines: string[] = [];
  if (f.dryRun) {
    lines.push(`${accentBold(String(strong.length))} strong fit(s) · ${accentBold(String(possible.length))} possible · nothing written (preview mode)`);
    if (!strong.length) {
      const best = [...found].sort((a, b) => (b.record?.scorecard.average ?? 0) - (a.record?.scorecard.average ?? 0))[0];
      if (best?.record?.scorecard.average !== undefined) lines.push(dim(`Nothing reached STRONG (70%+, all sources agree). Closest: ${best.unit.name}() at ${Math.round(best.record.scorecard.average * 100)}%.`));
    }
    if (possible.length) lines.push(dim("POSSIBLE changes are previewed above; `jevx --include-possible` writes them (tests + undo still apply)."));
  }
  else {
    lines.push(`${chalk.green.bold(String(kept.size))} changed  ${dim("(AI + Jev + patterns agree)")}`);
    const notChanged = found.length - kept.size;
    if (notChanged) lines.push(`${chalk.yellow.bold(String(notChanged))} left as is  ${dim("(weak, unsure, or not safe to change)")}`);
    if (applied?.checks.after.length) lines.push(`Checks after: ${applied.checks.after.map((r) => `${r.name} ${r.ok ? chalk.green("pass") : chalk.red("fail")}`).join(" · ")}`);
    if (applied?.dependency?.added) lines.push(applied.dependency.installed === false ? chalk.yellow(`Added @typesafe-ai/sdk to package.json — ${applied.dependency.error}`) : `Added @typesafe-ai/sdk to package.json`);
  }
  lines.push("");
  if (kept.size) lines.push(`See every change in red/green: open VS Code / Cursor → ${chalk.bold("Source Control")}`);
  const rel = path.relative(process.cwd(), report);
  lines.push(`Scorecards + diffs: ${dim(rel && !rel.startsWith("..") ? rel : report)}`);
  if (kept.size) lines.push(`Undo everything: ${accentBold("npx jevx undo")}`);
  if (kept.size && !typesafe) lines.push(dim("The changed code calls Jev at runtime: set TYPESAFE_API_KEY in the app's environment."));
  log(box(lines, "JEVX RESULT"));
  logCost(result.spend, started);
  await share(f, runId, ai, result.opportunities, applied);
  return 0;
}

async function share(f: RunFlags, runId: string, ai: { provider: string; model: string }, opportunities: Opportunity[], applied?: ReturnType<typeof applyOpportunities>) {
  if (!shareEnabled(f.share)) return;
  const r = await shareRun({ root: path.resolve(f.root), runId, version: VERSION, provider: ai.provider, model: ai.model, dryRun: f.dryRun, opportunities, applied });
  log("error" in r ? warn(`Stats not shared: ${r.error}`) : dim(`  Shared ${r.sent} anonymous finding(s) with the JevX dataset (no code).`));
  log("");
}

function logCost(s: { calls: number; inputTokens: number; outputTokens: number; costUsd?: number; costSource?: string }, started: number) {
  const cost = s.costUsd !== undefined ? ` · ≈ $${s.costUsd.toFixed(3)}${s.costSource === "calculated" ? " (calculated)" : ""}` : "";
  log(dim(`  ${s.calls} AI call(s) · ${n(s.inputTokens)} in + ${n(s.outputTokens)} out tokens${cost} · ${Math.round((Date.now() - started) / 1000)}s`));
  log("");
}
