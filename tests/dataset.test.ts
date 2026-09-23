import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Project } from "ts-morph";
import { analyzeProject } from "@jevx/analyzer";
import { REDACTED, containsSecret, scrubSecrets, type AnalysisResult } from "@jevx/core";
import {
  Dataset,
  addMissed,
  assignSplit,
  checkDataset,
  computeMetrics,
  evaluate,
  fingerprintOf,
  labelEntry,
  upsertAnalysis,
  validateEntry,
  DEFAULT_DATASET_CONFIG,
  type DatasetEntry
} from "@jevx/dataset";
import { FIXTURES } from "./analysis-fixtures.js";

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), "jevx-ds-"));
  dirs.push(d);
  return d;
};
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

async function analysisOf(files: Record<string, string>): Promise<AnalysisResult> {
  const root = "/virtual/app";
  const project = new Project({ useInMemoryFileSystem: true });
  const sfs = Object.entries(files).map(([f, code]) => project.createSourceFile(path.join(root, f), code));
  return analyzeProject({ root, files: sfs });
}

const BASE = { "src/classify.ts": FIXTURES.classify, "src/secret.ts": FIXTURES.secret, "src/env.ts": FIXTURES.env };

describe("secret scrubbing", () => {
  it("redacts provider keys, credential assignments, URL passwords and PEM blocks", () => {
    const text = [
      'const k = "sk-proj-abcdefghijklmnop1234";',
      'const password = "hunter2hunter2";',
      "const db = 'postgres://admin:s3cretpw@db.internal/app';",
      "-----BEGIN PRIVATE KEY-----\nMIIEvQ\n-----END PRIVATE KEY-----",
      'const aws = "AKIAABCDEFGHIJKLMNOP";'
    ].join("\n");
    const r = scrubSecrets(text);
    expect(r.redactions).toBeGreaterThanOrEqual(5);
    expect(r.text).not.toMatch(/sk-proj|hunter2|s3cretpw|MIIEvQ|AKIAABCD/);
    expect(r.text).toContain(REDACTED);
    expect(containsSecret('if (kind === "refund") return "billing";')).toBe(false);
  });
});

describe("dataset storage and privacy", () => {
  it("public projects store scrubbed code; private projects store no code and no literals", async () => {
    const ds = new Dataset(tmp());
    const r = await analysisOf(BASE);
    upsertAnalysis(ds, { slug: "pub", visibility: "public", source: "https://example.com/pub" }, r);
    upsertAnalysis(ds, { slug: "priv", visibility: "private" }, r);

    const pub = ds.entries("pub");
    const withCode = pub.filter((e) => e.code);
    expect(withCode.length).toBeGreaterThan(0);
    expect(pub.map((e) => e.code ?? "").join("\n")).not.toContain("sk-live-abcdefghijklmnopqrstuvwx");

    const privText = readFileSync(path.join(ds.dir, "projects", "priv", "entries.jsonl"), "utf8");
    expect(privText).not.toContain('"code"');
    expect(privText).not.toContain("refund");
    expect(privText).not.toContain("sk-live");
    for (const e of ds.entries("priv")) {
      expect(e.outputs.values).toEqual([]);
      expect(e.codeHash).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(ds.project("priv")!.source).toBeUndefined();
    expect(checkDataset(ds).errors).toEqual([]);
  });

  it("refuses to write a private entry that carries code", () => {
    const e = { schema: 1, id: "x", project: "p", visibility: "private", origin: "generated", status: "active", file: "a.ts", codeHash: "h", decision: "d", suggestedPrimitive: "none", generators: [], outputs: { kind: "unknown", values: [] }, auto: { source: "none" }, code: "return 1" } as unknown as DatasetEntry;
    expect(validateEntry(e).join()).toMatch(/PRIVATE entry contains source code/);
  });

  it("never flips visibility or moves a project between splits silently", async () => {
    const ds = new Dataset(tmp());
    const r = await analysisOf(BASE);
    const first = upsertAnalysis(ds, { slug: "app", visibility: "private" }, r);
    expect(() => upsertAnalysis(ds, { slug: "app", visibility: "public" }, r)).toThrow(/refusing/);
    const other = first.project.split === "test" ? "train" : "test";
    expect(() => upsertAnalysis(ds, { slug: "app", visibility: "private", split: other }, r)).toThrow(/never moves/);
    const manual = upsertAnalysis(ds, { slug: "app2", visibility: "private", split: "test" }, r);
    expect(manual.project).toMatchObject({ split: "test", splitSource: "manual" });
  });
});

describe("labels survive re-analysis", () => {
  it("keeps labels, flags changed code for recheck, marks vanished units stale", async () => {
    const ds = new Dataset(tmp());
    upsertAnalysis(ds, { slug: "app", visibility: "public" }, await analysisOf(BASE));
    const cls = ds.entries("app").find((e) => e.unit.name === "classify")!;
    const client = ds.entries("app").find((e) => e.unit.name === "client")!;
    labelEntry(ds, "app", cls.id, { label: "STRONG_JEV", reasoning: "routes by meaning", labeller: "t" });
    labelEntry(ds, "app", client.id.slice(0, 6), { label: "POSSIBLE_JEV", reasoning: "model tier choice", labeller: "t" });

    const changed = await analysisOf({ "src/classify.ts": FIXTURES.classify.replace('"billing"', '"invoices"'), "src/env.ts": FIXTURES.env });
    const rep = upsertAnalysis(ds, { slug: "app", visibility: "public" }, changed);
    expect(rep.stale).toBe(1);
    const after = ds.entries("app");
    const c2 = after.find((e) => e.id === cls.id)!;
    expect(c2.human?.label).toBe("STRONG_JEV");
    expect(c2.needsRecheck).toBe(true);
    expect(after.find((e) => e.id === client.id)!.status).toBe("stale");
    expect(evaluate(ds).splits[ds.project("app")!.split].total.needsRecheck).toBe(1);
  });

  it("requires reasoning and rejects unknown ids", async () => {
    const ds = new Dataset(tmp());
    upsertAnalysis(ds, { slug: "app", visibility: "public" }, await analysisOf(BASE));
    const id = ds.entries("app")[0]!.id;
    expect(() => labelEntry(ds, "app", id, { label: "NOT_JEV", reasoning: "  ", labeller: "t" })).toThrow(/reasoning/);
    expect(() => labelEntry(ds, "app", "nope", { label: "NOT_JEV", reasoning: "x", labeller: "t" })).toThrow(/no entry/);
  });
});

describe("project-level splits", () => {
  it("assignment is deterministic and close to 60/20/20", () => {
    expect(assignSplit(fingerprintOf("globalcare"), DEFAULT_DATASET_CONFIG)).toBe(assignSplit(fingerprintOf("globalcare"), DEFAULT_DATASET_CONFIG));
    const n = { train: 0, dev: 0, test: 0 };
    for (let i = 0; i < 2000; i++) n[assignSplit(fingerprintOf(`p${i}`), DEFAULT_DATASET_CONFIG)]++;
    expect(n.train / 2000).toBeGreaterThan(0.55);
    expect(n.train / 2000).toBeLessThan(0.65);
    expect(n.test / 2000).toBeGreaterThan(0.16);
  });

  it("flags identical code shared by projects in different splits (leakage)", async () => {
    const ds = new Dataset(tmp());
    const r = await analysisOf(BASE);
    upsertAnalysis(ds, { slug: "a", visibility: "public", split: "train" }, r);
    upsertAnalysis(ds, { slug: "fork-of-a", visibility: "public", split: "test" }, r);
    expect(checkDataset(ds).errors.join("\n")).toMatch(/leak: identical code in a \(train\) and fork-of-a \(test\)/);
  });
});

describe("evaluation metrics", () => {
  const entry = (auto: DatasetEntry["auto"], human?: NonNullable<DatasetEntry["human"]>["label"], origin: DatasetEntry["origin"] = "generated") =>
    ({
      status: "active",
      origin,
      auto,
      ...(human ? { human: { label: human, reasoning: "r", confidence: "high", labeller: "t", at: "", codeHash: "" } } : {})
    }) as DatasetEntry;

  it("computes precision / recall / triage agreement / coverage from human labels only", () => {
    const m = computeMetrics([
      entry({ source: "typesafe", label: "STRONG_JEV" }, "STRONG_JEV"), // tp
      entry({ source: "typesafe", label: "POSSIBLE_JEV" }, "NOT_JEV"), // fp
      entry({ source: "typesafe", label: "NOT_JEV" }, "POSSIBLE_JEV"), // fn
      entry({ source: "triage", label: "NOT_JEV" }, "NOT_JEV"), // tn, triage agreed
      entry({ source: "triage", label: "NOT_JEV" }, "STRONG_JEV"), // fn, triage overturned
      entry({ source: "none" }, "STRONG_JEV"), // unclassified
      entry({ source: "none" }), // unlabelled: ignored
      entry({ source: "none" }, "STRONG_JEV", "missed") // missed positive
    ]);
    expect(m).toMatchObject({ labelled: 7, predicted: 5, unclassified: 1, tp: 1, fp: 1, fn: 2, tn: 1 });
    expect(m.precision).toBe(0.5);
    expect(m.recall).toBeCloseTo(1 / 3);
    expect(m.triage).toEqual({ filtered: 2, agreed: 1, overturned: 1 });
    expect(m.coverage.proposedPositives).toBe(4);
    expect(m.coverage.missedPositives).toBe(1);
  });

  it("missed decisions are recorded with a label and counted per split", async () => {
    const ds = new Dataset(tmp());
    upsertAnalysis(ds, { slug: "app", visibility: "private", split: "dev" }, await analysisOf(BASE));
    addMissed(ds, "app", { file: "src/other.ts", line: 10, label: "STRONG_JEV", reasoning: "escalation hidden in a loop", labeller: "t", code: "secret code" });
    const missed = ds.entries("app").find((e) => e.origin === "missed")!;
    expect(missed.code).toBeUndefined(); // private: never stored
    const r = evaluate(ds);
    expect(r.splits.dev.total.coverage.missedPositives).toBe(1);
    expect(r.splits.train.total.projects).toBe(0);
  });
});
