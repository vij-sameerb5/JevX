// Project-level splits. A project lives in exactly one split (it's one field on the project
// record), assigned deterministically from its fingerprint so anyone re-running gets the same
// answer. Rotation re-hashes with another seed for cross-project generalization checks without
// touching the stored assignment.
import { createHash } from "node:crypto";
import type { DatasetConfig, DatasetEntry, ProjectRecord, Split } from "./schema.js";

export function fingerprintOf(slug: string): string {
  return createHash("sha256").update(`jevx-project:${slug}`).digest("hex").slice(0, 24);
}

/** Uniform number in [0, 1) from fingerprint + seed. */
export function unitHash(fingerprint: string, seed: string): number {
  const h = createHash("sha256").update(`${seed}\0${fingerprint}`).digest();
  return h.readUInt32BE(0) / 0x1_0000_0000;
}

export function assignSplit(fingerprint: string, cfg: Pick<DatasetConfig, "splitSeed" | "ratios">): Split {
  const x = unitHash(fingerprint, cfg.splitSeed);
  if (x < cfg.ratios.train) return "train";
  if (x < cfg.ratios.train + cfg.ratios.dev) return "dev";
  return "test";
}

/** The split a project is evaluated in: its stored split, or a rotated one for a given seed. */
export function effectiveSplit(p: ProjectRecord, cfg: DatasetConfig, rotateSeed?: string): Split {
  if (!rotateSeed || p.splitSource === "manual") return p.split;
  return assignSplit(p.fingerprint, { ...cfg, splitSeed: rotateSeed });
}

export interface SplitIssue {
  level: "error" | "warning";
  message: string;
}

/**
 * Leakage checks: the same code (by hash) appearing in projects of different splits (forks,
 * vendored copies) would let TEST see TRAIN examples.
 */
export function checkSplits(projects: ProjectRecord[], entries: Map<string, DatasetEntry[]>, cfg: DatasetConfig, rotateSeed?: string): SplitIssue[] {
  const issues: SplitIssue[] = [];
  const splitOf = new Map(projects.map((p) => [p.slug, effectiveSplit(p, cfg, rotateSeed)]));
  const seen = new Map<string, { project: string; split: Split }>();
  let leaks = 0;
  for (const [slug, list] of entries) {
    const split = splitOf.get(slug);
    if (!split) continue;
    for (const e of list) {
      if (e.status !== "active") continue;
      const prev = seen.get(e.codeHash);
      if (prev && prev.project !== slug && prev.split !== split) {
        leaks++;
        if (leaks <= 10) issues.push({ level: "error", message: `leak: identical code in ${prev.project} (${prev.split}) and ${slug} (${split}) — ${e.file} ${e.unit.name}` });
      } else if (!prev) seen.set(e.codeHash, { project: slug, split });
    }
  }
  if (leaks > 10) issues.push({ level: "error", message: `… ${leaks - 10} more cross-split duplicates` });
  const counts = { train: 0, dev: 0, test: 0 };
  for (const s of splitOf.values()) counts[s]++;
  if (projects.length >= 3 && counts.test === 0) issues.push({ level: "warning", message: "no TEST project yet — accuracy can't be claimed" });
  if (projects.length >= 3 && counts.train === 0) issues.push({ level: "warning", message: "no TRAIN project yet" });
  return issues;
}
