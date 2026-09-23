// One loaded repository per root, kept in memory while the MCP server runs. Everything here is
// local and free: the ts-morph project, the static candidates, the Jev finder and the RepoIndex
// the AI navigates through. Reloaded when any tracked file changes on disk (the user's AI edits
// files between calls), so nothing the AI reads is stale.
import { statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { RepoIndex, analyzeProject, findJevUsage } from "@jevx/analyzer";
import { DEFAULT_EXCLUDE, DEFAULT_INCLUDE, type AnalysisResult, type JevUsageReport } from "@jevx/core";
import { scanProject } from "@jevx/scanner";

export interface Workspace {
  root: string;
  index: RepoIndex;
  analysis: AnalysisResult;
  jev: JevUsageReport;
  files: string[];
  fingerprint: string;
  loadedAt: string;
}

const cache = new Map<string, Workspace>();

function fingerprintOf(root: string, files: string[]): string {
  let max = 0;
  for (const f of files) {
    try {
      max = Math.max(max, statSync(path.join(root, f)).mtimeMs);
    } catch {
      max = Number.MAX_SAFE_INTEGER; // a file disappeared → reload
    }
  }
  return `${files.length}:${max}`;
}

export function resolveRoot(root?: string): string {
  return path.resolve(root?.trim() || process.env.JEVX_ROOT?.trim() || process.cwd());
}

/** Refuse to index a disk root or the home folder (Claude Desktop starts servers in "/"). */
export function assertProjectRoot(root: string): string {
  const r = path.resolve(root);
  if (r === path.parse(r).root || r === path.resolve(homedir())) throw new Error(`"${r}" is not a project folder. Pass the project's path as root, e.g. "${path.join(homedir(), "code", "my-app")}".`);
  return r;
}

export async function workspace(rootArg?: string, force = false): Promise<Workspace> {
  const root = assertProjectRoot(resolveRoot(rootArg));
  const hit = cache.get(root);
  if (hit && !force && fingerprintOf(root, hit.files) === hit.fingerprint) return hit;
  const scanned = await scanProject({ root, include: DEFAULT_INCLUDE, exclude: DEFAULT_EXCLUDE });
  const analysis = await analyzeProject({ root, files: scanned.files, project: scanned.project, skipped: scanned.skipped.length });
  const jev = findJevUsage({ root, files: scanned.files });
  const files = scanned.files.map((sf) => path.relative(root, sf.getFilePath()).split(path.sep).join("/"));
  const ws: Workspace = { root, index: new RepoIndex(root, scanned.files), analysis, jev, files, fingerprint: fingerprintOf(root, files), loadedAt: new Date().toISOString() };
  cache.set(root, ws);
  return ws;
}

/** The function that starts at (or contains) `line` in `file`, as a context id the index resolves. */
export function unitAt(ws: Workspace, file: string, line: number) {
  const all = [...ws.analysis.candidates, ...ws.analysis.filtered];
  const exact = all.find((c) => c.file === file && c.unit.start === line);
  if (exact) return exact;
  return all.filter((c) => c.file === file && c.unit.start <= line && c.unit.end >= line).sort((a, b) => b.unit.start - a.unit.start)[0];
}
