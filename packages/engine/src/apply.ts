// Writing changes safely, with nobody asked anything.
//
//   - Files with uncommitted edits of the user's own are never touched (git status), so JevX's
//     changes never mix with theirs.
//   - Originals are backed up to .jevx/backup/<run>/ before anything is written; `jevx undo`
//     restores them.
//   - Changes land in the working tree, uncommitted: VS Code / Cursor show them in red/green in
//     Source Control and in the gutter, with their usual per-change revert.
//   - The project's own checks (test script, TypeScript) run before and after. Checks that passed
//     before must still pass after; if they don't, JevX re-applies the changes one at a time and
//     keeps only the ones that pass. A check that was already failing is reported, not used.
import { spawnSync, execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { applyEditsInMemory, type Opportunity } from "./pipeline.js";

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

export interface Check {
  name: string;
  cmd: string;
  args: string[];
}

export interface CheckResult {
  name: string;
  ok: boolean;
  tail: string;
}

export interface ApplyOptions {
  root: string;
  runId: string;
  opportunities: Opportunity[];
  /** Install @typesafe-ai/sdk when a change needs it and the project lacks it (default true). */
  install?: boolean;
  /** Run the project's checks before and after (default true). */
  verify?: boolean;
  timeoutMs?: number;
  onEvent?: (e: ApplyEvent) => void;
}

export type ApplyEvent =
  | { type: "baseline"; results: CheckResult[] }
  | { type: "written"; opportunity: Opportunity }
  | { type: "installing"; pm: PackageManager }
  | { type: "verifying" }
  | { type: "isolating"; count: number }
  | { type: "reverted"; opportunity: Opportunity; reason: string };

export interface ApplyResult {
  changed: Opportunity[];
  reverted: { opportunity: Opportunity; reason: string }[];
  skipped: { opportunity: Opportunity; reason: string }[];
  checks: { baseline: CheckResult[]; after: CheckResult[]; gate: string[] };
  dependency?: { added: boolean; installed?: boolean; error?: string };
  backupDir: string;
  files: string[];
}

const SDK = "@typesafe-ai/sdk";
const SDK_RANGE = "^0.6.0";

export function packageManager(root: string): PackageManager {
  if (existsSync(path.join(root, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(path.join(root, "yarn.lock"))) return "yarn";
  if (existsSync(path.join(root, "bun.lockb")) || existsSync(path.join(root, "bun.lock"))) return "bun";
  return "npm";
}

const readJson = (f: string): Record<string, unknown> | undefined => {
  try {
    return JSON.parse(readFileSync(f, "utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
};

/** The project's own checks: its test script and, for TypeScript projects, the compiler. */
export function checksFor(root: string): Check[] {
  const out: Check[] = [];
  const pkg = readJson(path.join(root, "package.json"));
  const test = (pkg?.scripts as Record<string, string> | undefined)?.test;
  if (test && !/no test specified/.test(test)) out.push({ name: "tests", cmd: packageManager(root), args: packageManager(root) === "npm" ? ["test", "--silent"] : ["test"] });
  const tsc = path.join(root, "node_modules", ".bin", "tsc");
  if (existsSync(path.join(root, "tsconfig.json")) && existsSync(tsc)) out.push({ name: "typecheck", cmd: tsc, args: ["--noEmit", "-p", "."] });
  return out;
}

export function runChecks(root: string, checks: Check[], timeoutMs = 300_000): CheckResult[] {
  return checks.map((c) => {
    const r = spawnSync(c.cmd, c.args, { cwd: root, encoding: "utf8", timeout: timeoutMs, env: { ...process.env, CI: "1", FORCE_COLOR: "0" }, shell: process.platform === "win32" });
    const tail = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim().split("\n").slice(-12).join("\n");
    return { name: c.name, ok: r.status === 0, tail };
  });
}

/** Files git sees as modified or untracked — the user's own work in progress. Empty outside git. */
export function dirtyFiles(root: string, files: string[]): Set<string> {
  try {
    const out = execFileSync("git", ["-C", root, "status", "--porcelain", "--", ...files], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return new Set(out.split("\n").filter(Boolean).map((l) => l.slice(3).trim()));
  } catch {
    return new Set();
  }
}

const backupRoot = (root: string) => path.join(root, ".jevx", "backup");

function backup(root: string, runId: string, files: string[]): string {
  const dir = path.join(backupRoot(root), runId);
  for (const f of files) {
    const dst = path.join(dir, "files", f);
    mkdirSync(path.dirname(dst), { recursive: true });
    if (existsSync(path.join(root, f))) copyFileSync(path.join(root, f), dst);
  }
  writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ runId, at: new Date().toISOString(), files }, null, 2));
  writeFileSync(path.join(backupRoot(root), "LAST"), runId);
  return dir;
}

function restore(root: string, runId: string, files: string[]) {
  for (const f of files) {
    const src = path.join(backupRoot(root), runId, "files", f);
    if (existsSync(src)) copyFileSync(src, path.join(root, f));
  }
}

function write(root: string, o: Opportunity): { ok: true; files: string[] } | { ok: false; reason: string } {
  const r = applyEditsInMemory((f) => (existsSync(path.join(root, f)) ? readFileSync(path.join(root, f), "utf8") : undefined), o.edits ?? []);
  if ("error" in r) return { ok: false, reason: `could not apply: ${r.error}` };
  for (const [f, v] of r.files) writeFileSync(path.join(root, f), v.after);
  return { ok: true, files: [...r.files.keys()] };
}

function needsSdk(root: string, changed: Opportunity[]): boolean {
  const pkg = readJson(path.join(root, "package.json"));
  if (!pkg) return false;
  const has = [pkg.dependencies, pkg.devDependencies, pkg.peerDependencies].some((d) => d && SDK in (d as Record<string, string>));
  return !has && changed.some((o) => (o.edits ?? []).some((e) => e.replace.includes(SDK)));
}

export function applyOpportunities(opts: ApplyOptions): ApplyResult {
  const root = path.resolve(opts.root);
  // the caller decides what to apply (STRONG by default, POSSIBLE with --include-possible)
  const candidates = opts.opportunities.filter((o) => (o.status === "strong" || o.status === "possible") && o.edits?.length);
  const touched = [...new Set(candidates.flatMap((o) => o.edits!.map((e) => e.file)))];
  const dirty = dirtyFiles(root, touched);
  const skipped: ApplyResult["skipped"] = [];
  const ready = candidates.filter((o) => {
    const mine = o.edits!.map((e) => e.file).filter((f) => dirty.has(f));
    if (mine.length) skipped.push({ opportunity: o, reason: `you have uncommitted changes in ${mine.join(", ")}` });
    return !mine.length;
  });
  const files = [...new Set([...ready.flatMap((o) => o.edits!.map((e) => e.file)), ...(existsSync(path.join(root, "package.json")) ? ["package.json"] : [])])];
  const backupDir = backup(root, opts.runId, files);

  const verify = opts.verify !== false;
  const checks = verify ? checksFor(root) : [];
  const baseline = verify ? runChecks(root, checks, opts.timeoutMs) : [];
  opts.onEvent?.({ type: "baseline", results: baseline });
  const gate = baseline.filter((r) => r.ok).map((r) => r.name);
  const gated = checks.filter((c) => gate.includes(c.name));

  // write every change
  let changed: Opportunity[] = [];
  for (const o of ready) {
    const w = write(root, o);
    if (w.ok) {
      changed.push(o);
      opts.onEvent?.({ type: "written", opportunity: o });
    } else skipped.push({ opportunity: o, reason: w.reason });
  }

  // the SDK the new code imports
  let dependency: ApplyResult["dependency"];
  if (changed.length && needsSdk(root, changed)) {
    const pj = path.join(root, "package.json");
    const pkg = readJson(pj)!;
    pkg.dependencies = { ...((pkg.dependencies as Record<string, string>) ?? {}), [SDK]: SDK_RANGE };
    writeFileSync(pj, JSON.stringify(pkg, null, 2) + "\n");
    dependency = { added: true };
    if (opts.install !== false) {
      const pm = packageManager(root);
      opts.onEvent?.({ type: "installing", pm });
      const r = spawnSync(pm, ["install"], { cwd: root, encoding: "utf8", timeout: opts.timeoutMs ?? 300_000, shell: process.platform === "win32" });
      dependency.installed = r.status === 0;
      if (r.status !== 0) dependency.error = `${pm} install failed: ${`${r.stderr ?? ""}`.trim().split("\n").slice(-3).join(" ")}`;
    }
  }

  // verify; isolate the changes that break a check that used to pass
  const reverted: ApplyResult["reverted"] = [];
  let after: CheckResult[] = [];
  if (changed.length && gated.length) {
    opts.onEvent?.({ type: "verifying" });
    after = runChecks(root, gated, opts.timeoutMs);
    if (after.some((r) => !r.ok)) {
      opts.onEvent?.({ type: "isolating", count: changed.length });
      const all = changed;
      restore(root, opts.runId, [...new Set(all.flatMap((o) => o.edits!.map((e) => e.file)))]);
      changed = [];
      for (const o of all) {
        const w = write(root, o);
        if (!w.ok) {
          reverted.push({ opportunity: o, reason: w.reason });
          continue;
        }
        const res = runChecks(root, gated, opts.timeoutMs);
        const failed = res.find((r) => !r.ok);
        if (failed) {
          // undo just this change: rebuild its files from the backup plus the changes kept so far
          restore(root, opts.runId, w.files);
          for (const k of changed) if (k.edits!.some((e) => w.files.includes(e.file))) write(root, k);
          reverted.push({ opportunity: o, reason: `${failed.name} failed after this change` });
          opts.onEvent?.({ type: "reverted", opportunity: o, reason: `${failed.name} failed` });
        } else changed.push(o);
      }
      after = changed.length ? runChecks(root, gated, opts.timeoutMs) : baseline.filter((r) => gate.includes(r.name));
    }
  }
  if (!changed.length && dependency?.added) {
    restore(root, opts.runId, ["package.json"]);
    dependency = undefined;
  }
  return { changed, reverted, skipped, checks: { baseline, after, gate }, ...(dependency ? { dependency } : {}), backupDir, files };
}

/** Restore every file the last run changed. */
export function undoLast(rootArg: string): { runId?: string; files: string[] } {
  const root = path.resolve(rootArg);
  const last = path.join(backupRoot(root), "LAST");
  if (!existsSync(last)) return { files: [] };
  const runId = readFileSync(last, "utf8").trim();
  const manifest = readJson(path.join(backupRoot(root), runId, "manifest.json")) as { files?: string[] } | undefined;
  const files = manifest?.files ?? [];
  restore(root, runId, files);
  rmSync(last, { force: true });
  return { runId, files };
}
