// pnpm corpus — prepare and analyze the M5 real-project corpus listed in dataset/intake.json.
//
//   pnpm corpus list                              status of every project (intake + dataset)
//   pnpm corpus fetch [slug…|--all]               download each repo at its pinned commit (no git)
//   pnpm corpus analyze [slug…|--all] [flags]     jevx analyze … --save for each project
//        flags passed through: --gemini --openrouter --validate --offline --no-cache
//                              --gemini-model <id> --openrouter-model <id> --code-analyst <p>
//                              --gemini-context <mode> --gemini-rounds <n> --gemini-budget <n>
//        --dry-run   print the commands only
//   pnpm corpus usages [slug…|--all]              M5b layer B: where is Jev actually used? (offline, no AI)
//   pnpm corpus boundary [slug…|--all] [flags]    M5b pilot: jevx boundary … for each project
//        flags passed through: --max-usages <n> --max-contrasts <n> --budget-tokens <n> --model <id>
//                              --dry-run --offline --no-cache --context <mode> --rounds <n>
//        --total-budget <tokens>   stop starting new projects once this many tokens are spent (default 400000)
//   pnpm corpus report [--since <ISO date>]      M5b evaluation → dataset/boundary/PILOT-REPORT.md (stored records only, no API)
//
// A project list may be given as separate arguments (`boundary a b c`) or as one quoted
// argument (`boundary "$P"`); both are the same list. `--all` selects every analyzable project.
//
// Only projects with status "ready" or "partial" (TS/JS present) are analyzed. Visibility,
// source, commit and license come from intake.json: projects without an open-source license
// are saved as --private (fingerprint-only). Corpus location: $JEVX_CORPUS or ~/jevx-corpus.
// Downloads use GitHub's tarball endpoint — no git commands are run.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_DATASET_CONFIG, Dataset, assignSplit, fingerprintOf } from "@jevx/dataset";
import { writeReport } from "./boundary-report.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, "..");
const CLI = path.join(REPO, "apps/cli/src/index.tsx");
const INTAKE = path.join(REPO, "dataset/intake.json");
const CORPUS = path.resolve(process.env.JEVX_CORPUS?.trim() || path.join(homedir(), "jevx-corpus"));
const MARKER = ".jevx-corpus.json";
const DATASET = path.resolve(process.env.JEVX_DATASET?.trim() || path.join(REPO, "dataset"));

interface IntakeProject {
  n: number;
  name: string;
  url: string | null;
  slug: string;
  domain?: string;
  status: "ready" | "partial" | "needs_language" | "blocked" | "to_check";
  reason?: string;
  visibility?: "public" | "private";
  checked?: { commit: string; license: string; mainLanguage: string | null };
}

const intake = JSON.parse(readFileSync(INTAKE, "utf8")) as { projects: IntakeProject[] };
const analyzable = (p: IntakeProject) => p.status === "ready" || p.status === "partial";

/**
 * Anything from a bare `#` onwards is a shell comment the user's shell did not strip
 * (`pnpm corpus boundary $P --dry-run # plan only` passes the comment words as arguments).
 */
function stripComment(args: string[]): string[] {
  const i = args.findIndex((a) => a.startsWith("#"));
  return i >= 0 ? args.slice(0, i) : args;
}

/**
 * Project names may arrive as separate arguments (`boundary a b c`) or as one whitespace- or
 * comma-separated argument, which is what a quoted shell variable (`boundary "$P"`) becomes.
 * Both mean the same list. Duplicates are collapsed so a project is never analyzed twice.
 */
function slugsOf(args: string[]): string[] {
  const all = args
    .filter((a) => !a.startsWith("-"))
    .flatMap((a) => a.split(/[\s,]+/))
    .filter(Boolean);
  return [...new Set(all)];
}

function select(args: string[]): IntakeProject[] {
  const slugs = slugsOf(args);
  if (args.includes("--all") || slugs.length === 0) return intake.projects.filter(analyzable);
  return slugs.map((s) => {
    const p = intake.projects.find((x) => x.slug === s || String(x.n) === s);
    if (!p) throw new Error(`unknown project "${s}" — analyzable projects: ${intake.projects.filter(analyzable).map((x) => x.slug).join(", ")} (see pnpm corpus list)`);
    return p;
  });
}

const dirOf = (p: IntakeProject) => path.join(CORPUS, p.slug);

async function fetchOne(p: IntakeProject): Promise<string> {
  if (!p.url || !p.checked?.commit) return "skipped (no URL / commit)";
  const dir = dirOf(p);
  const marker = path.join(dir, MARKER);
  if (existsSync(marker) && JSON.parse(readFileSync(marker, "utf8")).commit === p.checked.commit) return "already downloaded";
  const [owner, repo] = p.url.replace(/\/blob\/.*$/, "").split("/").slice(3, 5);
  const url = `https://codeload.github.com/${owner}/${repo}/tar.gz/${p.checked.commit}`;
  const res = await fetch(url);
  if (!res.ok || !res.body) return `download failed: HTTP ${res.status}`;
  mkdirSync(dir, { recursive: true });
  const tar = spawn("tar", ["-xz", "--strip-components=1", "-C", dir], { stdio: ["pipe", "inherit", "inherit"] });
  const done = new Promise<number>((r) => tar.on("close", (code) => r(code ?? 1)));
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) tar.stdin.write(chunk);
  tar.stdin.end();
  if ((await done) !== 0) return "extract failed";
  writeFileSync(marker, JSON.stringify({ url: p.url, commit: p.checked.commit, at: new Date().toISOString() }, null, 2));
  return `downloaded @ ${p.checked.commit.slice(0, 8)}`;
}

const ownerOf = (p: IntakeProject) => (p.url ? p.url.split("/")[3]!.toLowerCase() : undefined);

/**
 * Projects by the same GitHub owner often share code (jkudish/jev-browser and jkudish/jev-mcp
 * share provider.ts), which would leak between splits. They are kept together: the split is
 * hashed from the owner instead of the project. Single-project owners use the normal hash.
 */
function groupSplit(p: IntakeProject): string | undefined {
  const owner = ownerOf(p);
  if (!owner) return undefined;
  const siblings = intake.projects.filter((x) => ownerOf(x) === owner && analyzable(x));
  if (siblings.length < 2) return undefined;
  return assignSplit(fingerprintOf(`owner:${owner}`), DEFAULT_DATASET_CONFIG);
}

function analyzeArgs(p: IntakeProject, passthrough: string[]): string[] {
  const split = groupSplit(p);
  const src = p.url!.replace(/\/blob\/.*$/, "");
  const license = p.checked?.license && p.checked.license !== "none found" ? p.checked.license : undefined;
  return [
    "tsx",
    CLI,
    "analyze",
    dirOf(p),
    "--save",
    p.visibility === "public" ? "--public" : "--private",
    "--project",
    p.slug,
    ...(p.visibility === "public" ? ["--source", src, "--commit", p.checked!.commit, ...(license ? ["--license", license] : [])] : []),
    ...(p.domain ? ["--domain", p.domain] : []),
    ...(split ? ["--split", split] : []),
    "--dataset",
    DATASET,
    "--limit",
    "3",
    ...passthrough
  ];
}

const BOUNDARY_FLAGS = new Set(["--dry-run", "--offline", "--no-cache"]);
const BOUNDARY_VALUES = new Set(["--max-usages", "--max-contrasts", "--budget-tokens", "--model", "--context", "--rounds", "--context-budget"]);
const PASS_FLAGS = new Set(["--gemini", "--openrouter", "--validate", "--offline", "--no-cache"]);
const PASS_VALUE = new Set(["--gemini-model", "--openrouter-model", "--code-analyst", "--gemini-context", "--gemini-rounds", "--gemini-budget"]);
function passthroughOf(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (PASS_FLAGS.has(args[i]!)) out.push(args[i]!);
    else if (PASS_VALUE.has(args[i]!) && args[i + 1]) out.push(args[i]!, args[++i]!);
  }
  return out;
}

async function main() {
  const [cmd = "list", ...args] = stripComment(process.argv.slice(2));
  if (cmd === "list") {
    const ds = new Dataset(DATASET);
    console.log(`corpus dir: ${CORPUS}\ndataset:    ${DATASET}\n`);
    console.log(`${"#".padStart(2)}  ${"project".padEnd(26)} ${"status".padEnd(15)} ${"vis".padEnd(8)} ${"lang".padEnd(7)} ${"fetched".padEnd(8)} dataset`);
    for (const p of intake.projects) {
      const fetched = existsSync(path.join(dirOf(p), MARKER)) ? "yes" : "-";
      const rec = ds.project(p.slug);
      const entries = rec ? ds.entries(p.slug).filter((e) => e.status === "active") : [];
      const inDs = rec ? `${rec.split} · ${entries.length} entries · ${entries.filter((e) => e.human).length} labelled` : "-";
      console.log(`${String(p.n).padStart(2)}  ${p.slug.padEnd(26)} ${p.status.padEnd(15)} ${(p.visibility ?? "-").padEnd(8)} ${(p.checked?.mainLanguage ?? "-").padEnd(7)} ${fetched.padEnd(8)} ${inDs}`);
    }
    return;
  }
  if (cmd === "fetch") {
    for (const p of select(args)) console.log(`${p.slug.padEnd(26)} ${await fetchOne(p)}`);
    return;
  }
  if (cmd === "analyze") {
    const pass = passthroughOf(args);
    const dry = args.includes("--dry-run");
    const results: string[] = [];
    for (const p of select(args.filter((a, i) => !PASS_VALUE.has(args[i - 1] ?? "")))) {
      if (!analyzable(p)) {
        results.push(`${p.slug}: skipped — ${p.reason ?? p.status}`);
        continue;
      }
      if (!existsSync(path.join(dirOf(p), MARKER))) {
        const f = await fetchOne(p);
        if (!existsSync(path.join(dirOf(p), MARKER))) {
          results.push(`${p.slug}: ${f}`);
          continue;
        }
      }
      const argv = analyzeArgs(p, pass);
      console.log(`\n━━ ${p.n}. ${p.name} (${p.slug}, ${p.visibility})\n$ npx ${argv.map((a) => (a.includes(" ") ? JSON.stringify(a) : a)).join(" ")}`);
      if (dry) continue;
      const r = spawnSync("npx", argv, { stdio: "inherit", cwd: REPO });
      results.push(`${p.slug}: ${r.status === 0 ? "ok" : `failed (exit ${r.status})`}`);
    }
    if (!dry) console.log(`\nSummary:\n  ${results.join("\n  ")}\n\nNext: pnpm dev review <project> · pnpm dev dataset check · pnpm dev eval`);
    return;
  }
  if (cmd === "usages") {
    for (const p of select(args)) {
      if (!analyzable(p) || !existsSync(path.join(dirOf(p), MARKER))) {
        console.log(`${p.slug.padEnd(26)} ${analyzable(p) ? "not fetched (pnpm corpus fetch)" : `skipped — ${p.reason ?? p.status}`}`);
        continue;
      }
      console.log(`\n━━ ${p.n}. ${p.name} (${p.slug})`);
      spawnSync("npx", ["tsx", CLI, "jev-usages", dirOf(p)], { stdio: "inherit", cwd: REPO });
    }
    return;
  }
  if (cmd === "boundary") {
    const values = new Set([...BOUNDARY_VALUES, "--total-budget"]);
    const pass: string[] = [];
    for (let i = 0; i < args.length; i++) {
      if (BOUNDARY_FLAGS.has(args[i]!)) pass.push(args[i]!);
      else if (BOUNDARY_VALUES.has(args[i]!) && args[i + 1]) pass.push(args[i]!, args[++i]!);
    }
    const ti = args.indexOf("--total-budget");
    const total = ti >= 0 ? Number(args[ti + 1]) : 400_000;
    const dry = args.includes("--dry-run");
    const results: string[] = [];
    let spent = 0;
    let cost = 0;
    for (const p of select(args.filter((a, i) => !values.has(args[i - 1] ?? "")))) {
      if (!analyzable(p)) {
        results.push(`${p.slug}: skipped — ${p.reason ?? p.status}`);
        continue;
      }
      if (!existsSync(path.join(dirOf(p), MARKER))) {
        results.push(`${p.slug}: not fetched (pnpm corpus fetch ${p.slug})`);
        continue;
      }
      if (!dry && spent >= total) {
        results.push(`${p.slug}: skipped — total budget reached (${spent.toLocaleString("en-US")} tokens)`);
        continue;
      }
      const argv = ["tsx", CLI, "boundary", dirOf(p), p.visibility === "public" ? "--public" : "--private", "--project", p.slug, "--dataset", DATASET, ...pass];
      console.log(`\n━━ ${p.n}. ${p.name} (${p.slug}, ${p.visibility})`);
      const r = spawnSync("npx", argv, { stdio: "inherit", cwd: REPO });
      if (!dry) {
        const runs = path.join(DATASET, "boundary", p.slug, "runs.jsonl");
        const last = existsSync(runs) ? readFileSync(runs, "utf8").trim().split("\n").pop() : undefined;
        const acc = last ? (JSON.parse(last) as { accounting: { inputTokens: number; outputTokens: number; costUsd?: number } }).accounting : undefined;
        if (acc) {
          spent += acc.inputTokens + acc.outputTokens;
          cost += acc.costUsd ?? 0;
        }
      }
      results.push(`${p.slug}: ${r.status === 0 ? "ok" : `failed (exit ${r.status})`}`);
    }
    console.log(`\nSummary:\n  ${results.join("\n  ")}`);
    if (!dry) console.log(`\nTokens this run: ${spent.toLocaleString("en-US")} (total budget ${total.toLocaleString("en-US")})${cost ? ` · cost $${cost.toFixed(4)}` : ""}\nNext: inspect dataset/boundary/<slug>/ · then pnpm dev boundary-patterns`);
    return;
  }
  if (cmd === "report") {
    const si = args.indexOf("--since");
    const file = writeReport(DATASET, si >= 0 ? args[si + 1] : undefined);
    console.log(`Wrote ${path.relative(process.cwd(), file)}`);
    return;
  }
  console.error(`unknown command "${cmd}". Use: list | fetch | analyze | usages | boundary | report`);
  process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
