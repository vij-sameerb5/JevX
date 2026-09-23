// `jevx dataset check`: schema validity, privacy (no code in private projects, no secrets in
// public code), duplicate ids, and cross-split leakage.
import { validateEntry, validateProject, type DatasetEntry } from "./schema.js";
import { checkSplits, fingerprintOf, type SplitIssue } from "./splits.js";
import type { Dataset } from "./store.js";

export interface CheckReport {
  projects: number;
  entries: number;
  errors: string[];
  warnings: string[];
}

export function checkDataset(ds: Dataset, opts: { rotateSeed?: string } = {}): CheckReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const projects = ds.projects();
  const all = new Map<string, DatasetEntry[]>();
  let count = 0;
  for (const p of projects) {
    errors.push(...validateProject(p));
    if (p.fingerprint !== fingerprintOf(p.slug)) errors.push(`${p.slug}: fingerprint does not match slug`);
    let entries: DatasetEntry[];
    try {
      entries = ds.entries(p.slug);
    } catch (err) {
      errors.push(`${p.slug}: entries.jsonl is not valid JSONL (${err instanceof Error ? err.message : String(err)})`);
      continue;
    }
    count += entries.length;
    const ids = new Set<string>();
    for (const e of entries) {
      if (ids.has(e.id)) errors.push(`${p.slug}: duplicate id ${e.id}`);
      ids.add(e.id);
      errors.push(...validateEntry(e, p));
    }
    const recheck = entries.filter((e) => e.needsRecheck).length;
    if (recheck) warnings.push(`${p.slug}: ${recheck} label(s) were given on older code and need a recheck`);
    all.set(p.slug, entries);
  }
  for (const i of checkSplits(projects, all, ds.config(), opts.rotateSeed) as SplitIssue[]) (i.level === "error" ? errors : warnings).push(i.message);
  return { projects: projects.length, entries: count, errors, warnings };
}
