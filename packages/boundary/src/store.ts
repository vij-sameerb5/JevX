// Storage for the M5b boundary dataset, under <dataset>/boundary/ — separate from the P1 candidate
// entries (<dataset>/projects/). One file per layer per project; never mixed.
//
//   boundary/<slug>/usages.jsonl     B  observed Jev usage (replaced on each run: deterministic)
//   boundary/<slug>/analyses.jsonl   C  "why Jev here?"   (merged by site + code + analyst + prompt)
//   boundary/<slug>/contrasts.jsonl  D  "why deterministic?" (merged by site + contrast + analyst + prompt)
//   boundary/<slug>/runs.jsonl       accounting per run (appended)
//   boundary/patterns.jsonl          E  cross-project hypotheses (appended per pattern run)
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync, appendFileSync } from "node:fs";
import path from "node:path";
import { containsSecret } from "@jevx/core";
import { renderPatterns } from "./markdown.js";
import type { AnalysisRecord, ContrastRecord, PatternRecord, RunRecord, UsageRecord } from "./schema.js";

const readJsonl = <T>(file: string): T[] =>
  existsSync(file)
    ? readFileSync(file, "utf8")
        .split("\n")
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l) as T)
    : [];

function writeJsonl(file: string, rows: unknown[]) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(`${file}.tmp`, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""));
  renameSync(`${file}.tmp`, file);
}

const cKey = (a: AnalysisRecord) => `${a.siteId}\0${a.site.codeHash}\0${a.analyst.provider}:${a.analyst.model}\0${a.analyst.promptVersion}`;
const dKey = (c: ContrastRecord) => `${c.siteId}\0${c.contrast.id}\0${c.contrast.codeHash}\0${c.analyst.provider}:${c.analyst.model}\0${c.analyst.promptVersion}`;

export class BoundaryStore {
  readonly dir: string;
  constructor(datasetDir: string) {
    this.dir = path.join(datasetDir, "boundary");
  }
  private p(slug: string, name: string) {
    return path.join(this.dir, slug, name);
  }

  projects(): string[] {
    return existsSync(this.dir)
      ? readdirSync(this.dir, { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .map((d) => d.name)
          .sort()
      : [];
  }

  usages(slug: string) {
    return readJsonl<UsageRecord>(this.p(slug, "usages.jsonl"));
  }
  analyses(slug: string) {
    return readJsonl<AnalysisRecord>(this.p(slug, "analyses.jsonl"));
  }
  contrasts(slug: string) {
    return readJsonl<ContrastRecord>(this.p(slug, "contrasts.jsonl"));
  }
  runs(slug: string) {
    return readJsonl<RunRecord>(this.p(slug, "runs.jsonl"));
  }
  patterns() {
    return readJsonl<PatternRecord>(path.join(this.dir, "patterns.jsonl"));
  }

  /** Save one project run. B is replaced; C and D are merged (a re-run with the same key replaces). */
  saveRun(slug: string, r: { usages: UsageRecord[]; analyses: AnalysisRecord[]; contrasts: ContrastRecord[]; run: RunRecord }) {
    writeJsonl(this.p(slug, "usages.jsonl"), r.usages);
    const a = new Map(this.analyses(slug).map((x) => [cKey(x), x]));
    for (const x of r.analyses) a.set(cKey(x), x);
    writeJsonl(this.p(slug, "analyses.jsonl"), [...a.values()]);
    const c = new Map(this.contrasts(slug).map((x) => [dKey(x), x]));
    for (const x of r.contrasts) c.set(dKey(x), x);
    writeJsonl(this.p(slug, "contrasts.jsonl"), [...c.values()]);
    mkdirSync(path.join(this.dir, slug), { recursive: true });
    appendFileSync(this.p(slug, "runs.jsonl"), JSON.stringify(r.run) + "\n");
  }

  appendPatterns(p: PatternRecord) {
    mkdirSync(this.dir, { recursive: true });
    appendFileSync(path.join(this.dir, "patterns.jsonl"), JSON.stringify(p) + "\n");
  }

  /**
   * Layer E outputs: the run is appended to patterns.jsonl (history), and the latest run is written
   * to patterns.json (the dataset) and PATTERNS.md (the write-up). Returns the files written.
   */
  saveLayerE(p: PatternRecord): { jsonl: string; json: string; md: string } {
    this.appendPatterns(p);
    const json = path.join(this.dir, "patterns.json");
    const md = path.join(this.dir, "PATTERNS.md");
    writeFileSync(json, JSON.stringify(p, null, 2) + "\n");
    writeFileSync(md, renderPatterns(p));
    return { jsonl: path.join(this.dir, "patterns.jsonl"), json, md };
  }

  /** Privacy + layer checks. Returns problems (empty = ok). */
  check(): string[] {
    const errs: string[] = [];
    for (const slug of this.projects()) {
      for (const u of this.usages(slug)) {
        if (u.layer !== "B_observed_usage") errs.push(`${slug}: usages.jsonl holds a ${u.layer} record`);
        if (u.visibility === "private" && (u.site.questions.some((q) => q.text || q.outcomes) || u.site.calls.some((c) => c.text))) errs.push(`${slug}/${u.site.id}: PRIVATE usage holds question or call text`);
      }
      for (const a of this.analyses(slug)) {
        if (a.layer !== "C_usage_analysis" || a.kind !== "model_generated_inference") errs.push(`${slug}: analyses.jsonl holds a non-C record`);
        if (a.visibility === "private" && (a.analysis || a.context.items)) errs.push(`${slug}/${a.siteId}: PRIVATE analysis holds model free text or context ids`);
        if (a.analysis && containsSecret(JSON.stringify(a.analysis))) errs.push(`${slug}/${a.siteId}: analysis contains an unredacted secret`);
      }
      for (const c of this.contrasts(slug)) {
        if (c.layer !== "D_contrast") errs.push(`${slug}: contrasts.jsonl holds a non-D record`);
        if (c.visibility === "private" && c.analysis) errs.push(`${slug}/${c.siteId}: PRIVATE contrast holds model free text`);
        if (c.analysis && containsSecret(JSON.stringify(c.analysis))) errs.push(`${slug}/${c.siteId}: contrast contains an unredacted secret`);
      }
    }
    for (const p of this.patterns()) {
      if (p.layer !== "E_patterns" || p.kind !== "derived_hypothesis") errs.push(`patterns.jsonl: holds a non-E record`);
      if (containsSecret(JSON.stringify(p.result))) errs.push(`patterns.jsonl/${p.runId}: a pattern contains an unredacted secret`);
    }
    return errs;
  }
}
