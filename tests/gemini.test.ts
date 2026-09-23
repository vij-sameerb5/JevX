import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { execa } from "execa";
import { Project } from "ts-morph";
import { analyzeProject } from "@jevx/analyzer";
import type { AnalysisResult } from "@jevx/core";
import {
  GEMINI_PROMPT_VERSION,
  GeminiCache,
  analyzeWithGemini,
  buildGeminiPrompt,
  createGeminiTransport,
  parseGeminiAnalysis,
  type GeminiTransport
} from "@jevx/gemini";
import { Dataset, checkDataset, evaluate, labelEntry, upsertAnalysis, validateEntry, type DatasetEntry } from "@jevx/dataset";
import { GOOD_ANALYSIS, startMockGemini } from "./mock-gemini.js";
import { startMockServer } from "./mock-typesafe.js";
import { FIXTURES } from "./analysis-fixtures.js";

const CHOOSE_MODEL = `
export function chooseModel(task: { type: string }, models: { fast: string; smart: string; code: string }) {
  if (task.type === "simple") return "fast";
  if (task.type === "complex") return "smart";
  if (task.type === "coding") return "code";
  return "fast";
}`;

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), "jevx-gm-"));
  dirs.push(d);
  return d;
};
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

async function analysis(files: Record<string, string>): Promise<AnalysisResult> {
  const project = new Project({ useInMemoryFileSystem: true });
  const root = "/virtual/app";
  return analyzeProject({ root, files: Object.entries(files).map(([f, c]) => project.createSourceFile(path.join(root, f), c)) });
}

/** In-process fake transport: answers per marker in the prompt, counts calls. */
function fake(behaviour: (prompt: string) => Promise<string | undefined> | string | undefined) {
  const prompts: string[] = [];
  const t: GeminiTransport = {
    model: "fake-model",
    async generate(req) {
      prompts.push(req.prompt);
      return { text: await behaviour(req.prompt), inputTokens: 10, outputTokens: 5 };
    },
    async ping() {
      return { model: "fake-model" };
    }
  };
  return { t, prompts };
}

describe("Gemini response validation", () => {
  it("accepts the schema, strips code fences, maps unknown categories to 'other', scrubs secrets", () => {
    const text = "```json\n" + JSON.stringify({ ...GOOD_ANALYSIS, decision_type: "vibes", reasoning: 'uses key "sk-proj-abcdefghijklmnop1234"' }) + "\n```";
    const r = parseGeminiAnalysis(text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.analysis.decision_type).toBe("other");
    expect(r.analysis.reasoning).not.toContain("sk-proj");
    expect(r.analysis.model_hypothesis?.label).toBe("STRONG_JEV");
  });

  it("rejects non-JSON, empty and wrongly-shaped answers without throwing", () => {
    expect(parseGeminiAnalysis("the function picks a model")).toEqual({ ok: false, error: "response is not valid JSON" });
    expect(parseGeminiAnalysis(undefined).ok).toBe(false);
    const bad = parseGeminiAnalysis(JSON.stringify({ summary: "x", uncertainty: "extreme" }));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/malformed analysis/);
  });
});

describe("Gemini prompt: adaptive context, scrubbed", () => {
  it("without a repo index: the candidate function only, secrets scrubbed", async () => {
    const r = await analysis({ "src/a.ts": CHOOSE_MODEL + "\n" + FIXTURES.secret, "src/b.ts": FIXTURES.scorer });
    const c = r.candidates.find((x) => x.unit.name === "client")!;
    const p = buildGeminiPrompt(c);
    expect(p.prompt).not.toContain("sk-live-abcdefghijklmnopqrstuvwx");
    expect(p.prompt).toContain("«redacted»");
    expect(p.prompt).not.toContain("chooseModel");
    expect(p.prompt).not.toContain("riskScore");
    expect(p.prompt).toContain("deterministic_evidence");
  });
});

describe("Gemini analyst run (evidence only)", () => {
  it("through the real SDK against a mock API: adds evidence, never a classification", async () => {
    const mock = await startMockGemini();
    try {
      const r = await analysis({ "src/m.ts": CHOOSE_MODEL });
      const transport = createGeminiTransport({ apiKey: "test-key", baseURL: mock.url, model: "gemini-test" }).transport!;
      const out = await analyzeWithGemini(r, { model: "gemini-test", transport, cache: new GeminiCache(tmp()) });
      const c = out.candidates.find((x) => x.unit.name === "chooseModel")!;
      expect(c.gemini).toMatchObject({ kind: "model_generated_evidence", model: "gemini-test", promptVersion: GEMINI_PROMPT_VERSION, cached: false });
      expect(c.gemini!.analysis.decision_boundary).toBe("task characteristics → model tier");
      expect(c.classification).toBeUndefined();
      expect(out.gemini).toMatchObject({ apiCalls: r.candidates.length, errors: 0 });
      const call = mock.calls.find((x) => x.path.endsWith(":generateContent"))!;
      expect(call.path).toBe("/v1beta/models/gemini-test:generateContent");
      expect(call.body?.generationConfig).toMatchObject({ responseMimeType: "application/json", temperature: 0 });
      expect(JSON.stringify(call.body)).not.toContain("test-key");
    } finally {
      await mock.close();
    }
  });

  it("malformed answers become per-candidate errors and are never cached", async () => {
    const r = await analysis({ "src/m.ts": CHOOSE_MODEL });
    const dir = tmp();
    const { t, prompts } = fake(() => "not json at all");
    const out = await analyzeWithGemini(r, { model: t.model, transport: t, cache: new GeminiCache(dir) });
    expect(out.candidates.every((c) => !c.gemini && c.geminiError === "response is not valid JSON")).toBe(true);
    const n = prompts.length;
    await analyzeWithGemini(r, { model: t.model, transport: t, cache: new GeminiCache(dir) });
    expect(prompts.length).toBe(2 * n); // nothing was cached
  });

  it("a hanging request times out and the run continues", async () => {
    const r = await analysis({ "src/m.ts": CHOOSE_MODEL });
    const { t } = fake(() => new Promise<string>(() => {}));
    const out = await analyzeWithGemini(r, { model: t.model, transport: t, cache: new GeminiCache(tmp()), timeoutMs: 50 });
    expect(out.candidates[0]!.geminiError).toBe("request timed out");
    expect(out.gemini!.errors).toBe(r.candidates.length);
  });

  it("HTTP 500 fails one candidate; a bad key stops all further calls", async () => {
    const mock = await startMockGemini();
    try {
      const r = await analysis({ "src/a.ts": CHOOSE_MODEL.replace("chooseModel(", "chooseModel /* MOCK_GEMINI_FAIL */ ("), "src/b.ts": FIXTURES.classify });
      const good = createGeminiTransport({ apiKey: "test-key", baseURL: mock.url }).transport!;
      const out = await analyzeWithGemini(r, { model: good.model, transport: good, cache: new GeminiCache(tmp()), concurrency: 1 });
      expect(out.candidates.find((c) => c.unit.name === "chooseModel")!.geminiError).toMatch(/HTTP 500/);
      expect(out.candidates.find((c) => c.unit.name === "classify")!.gemini).toBeDefined();
      expect(out.gemini!.fatal).toBeUndefined();

      const before = mock.calls.length;
      const bad = createGeminiTransport({ apiKey: "bad-key", baseURL: mock.url }).transport!;
      const out2 = await analyzeWithGemini(r, { model: bad.model, transport: bad, cache: new GeminiCache(tmp()), concurrency: 1 });
      expect(out2.gemini!.fatal).toMatch(/authentication failed/);
      expect(out2.candidates.every((c) => c.geminiError)).toBe(true);
      expect(mock.calls.length - before).toBe(1);
    } finally {
      await mock.close();
    }
  });

  it("cache: hit on unchanged code, miss on changed code, miss after a prompt-version change; offline replays", async () => {
    const dir = tmp();
    const { t, prompts } = fake(() => JSON.stringify(GOOD_ANALYSIS));
    const r1 = await analysis({ "src/m.ts": CHOOSE_MODEL });
    await analyzeWithGemini(r1, { model: t.model, transport: t, cache: new GeminiCache(dir) });
    const calls1 = prompts.length;

    const again = await analyzeWithGemini(r1, { model: t.model, transport: t, cache: new GeminiCache(dir) });
    expect(prompts.length).toBe(calls1);
    expect(again.candidates.every((c) => c.gemini?.cached)).toBe(true);

    const offline = await analyzeWithGemini(r1, { model: t.model, cache: new GeminiCache(dir), offline: true });
    expect(offline.gemini!.apiCalls).toBe(0);
    expect(offline.candidates.every((c) => c.gemini?.cached)).toBe(true);

    const r2 = await analysis({ "src/m.ts": CHOOSE_MODEL.replace('"smart"', '"large"') });
    await analyzeWithGemini(r2, { model: t.model, transport: t, cache: new GeminiCache(dir) });
    expect(prompts.length).toBe(calls1 + 1);

    const c = r1.candidates[0]!;
    expect(GeminiCache.key(c, t.model, "adaptive", "g0")).not.toBe(GeminiCache.key(c, t.model));
    const cached = JSON.parse(readFileSync(path.join(dir, ".jevx", "cache", "gemini.json"), "utf8"));
    // rewrite every entry as if written by an older prompt version → all must miss
    const old = Object.fromEntries(Object.values(cached.entries).map((e, i) => [`old-${i}`, e]));
    writeFileSync(path.join(dir, ".jevx", "cache", "gemini.json"), JSON.stringify({ version: 1, entries: old }));
    const before = prompts.length;
    await analyzeWithGemini(r1, { model: t.model, transport: t, cache: new GeminiCache(dir) });
    expect(prompts.length).toBe(before + r1.candidates.length);
    expect(readFileSync(path.join(dir, ".jevx", "cache", "gemini.json"), "utf8")).not.toMatch(/test-key|GEMINI_API_KEY/);
  });
});

describe("Gemini evidence in the dataset", () => {
  async function withGemini(files: Record<string, string>) {
    const { t } = fake(() => JSON.stringify(GOOD_ANALYSIS));
    return analyzeWithGemini(await analysis(files), { model: t.model, transport: t, cache: new GeminiCache(tmp()) });
  }

  it("public: full analysis stored as model_generated_evidence; private: facts only, no text", async () => {
    const r = await withGemini({ "src/m.ts": CHOOSE_MODEL });
    const ds = new Dataset(tmp());
    upsertAnalysis(ds, { slug: "pub", visibility: "public" }, r);
    upsertAnalysis(ds, { slug: "priv", visibility: "private" }, r);
    const pub = ds.entries("pub").find((e) => e.unit.name === "chooseModel")!;
    expect(pub.gemini).toMatchObject({ kind: "model_generated_evidence", facts: { decision_type: "selection", hypothesis: "STRONG_JEV" } });
    expect(pub.gemini!.analysis!.summary).toBe(GOOD_ANALYSIS.summary);

    const privText = readFileSync(path.join(ds.dir, "projects", "priv", "entries.jsonl"), "utf8");
    expect(privText).not.toContain(GOOD_ANALYSIS.summary);
    expect(privText).not.toContain("task characteristics");
    expect(privText).not.toContain('"analysis":{');
    const priv = ds.entries("priv").find((e) => e.unit.name === "chooseModel")!;
    expect(priv.gemini!.facts).toMatchObject({ plausible_primitive: "choice", outcomes: 3 });
    expect(checkDataset(ds).errors).toEqual([]);

    const leaked = { ...priv, gemini: { ...priv.gemini!, analysis: pub.gemini!.analysis } } as DatasetEntry;
    expect(validateEntry(leaked).join()).toMatch(/PRIVATE entry contains Gemini free text/);
  });

  it("Gemini can never set or change a human label (and is not a prediction in eval)", async () => {
    const ds = new Dataset(tmp());
    upsertAnalysis(ds, { slug: "app", visibility: "public", split: "dev" }, await analysis({ "src/m.ts": CHOOSE_MODEL }));
    const id = ds.entries("app").find((e) => e.unit.name === "chooseModel")!.id;
    labelEntry(ds, "app", id, { label: "NOT_JEV", reasoning: "task.type is a closed enum in this app", labeller: "sameer" });

    // Re-analysis with Gemini hypothesising STRONG_JEV.
    upsertAnalysis(ds, { slug: "app", visibility: "public" }, await withGemini({ "src/m.ts": CHOOSE_MODEL }));
    const e = ds.entries("app").find((x) => x.id === id)!;
    expect(e.human).toMatchObject({ label: "NOT_JEV", labeller: "sameer" });
    expect(e.gemini!.facts.hypothesis).toBe("STRONG_JEV");
    expect(e.auto.label).toBeUndefined(); // Gemini does not produce auto labels either

    const m = evaluate(ds).splits.dev.total;
    expect(m.predicted).toBe(0);
    expect(m.unclassified).toBe(1);
    expect(m.gemini).toMatchObject({ withEvidence: 1, hypotheses: 1, agreed: 0 });

    // An unlabelled entry with Gemini evidence is not ground truth.
    const unlabelled = ds.entries("app").filter((x) => !x.human && x.gemini);
    expect(unlabelled.every((x) => x.human === undefined)).toBe(true);
  });
});

// ─── CLI ──────────────────────────────────────────────────────────────────

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(here, "../apps/cli/src/index.tsx");
const run = (args: string[], env: Record<string, string> = {}) =>
  execa("npx", ["tsx", CLI, ...args], {
    reject: false,
    env: { NO_COLOR: "1", TYPESAFE_API_KEY: "", TYPESAFE_BASE_URL: "", GEMINI_API_KEY: "", GEMINI_BASE_URL: "", GEMINI_MODEL: "", JEVX_DATASET: "", ...env }
  });

describe("jevx analyze --gemini / jevx check (CLI)", () => {
  let work: string;
  let app: string;
  let gem: Awaited<ReturnType<typeof startMockGemini>>;
  beforeAll(async () => {
    work = mkdtempSync(path.join(tmpdir(), "jevx-gcli-"));
    app = path.join(work, "app");
    mkdirSync(path.join(app, "src"), { recursive: true });
    writeFileSync(path.join(app, "package.json"), '{"name":"model-router"}');
    writeFileSync(path.join(app, "src", "model.ts"), CHOOSE_MODEL);
    cpSync(path.resolve(here, "../regression/legacy-v1/support-bot/src"), path.join(app, "src", "bot"), { recursive: true });
    gem = await startMockGemini();
  });
  afterAll(async () => {
    await gem.close();
    rmSync(work, { recursive: true, force: true });
  });

  it("analyze without --gemini never touches Gemini", async () => {
    const r = await run(["analyze", app, "--json"], { GEMINI_API_KEY: "test-key", GEMINI_BASE_URL: gem.url });
    expect(r.exitCode).toBe(0);
    expect(JSON.parse(r.stdout).gemini).toBeNull();
    expect(gem.calls.length).toBe(0);
  });

  it("--gemini without a key: skipped with a clear note, analysis still completes", async () => {
    const r = await run(["analyze", app, "--gemini", "--json"]);
    expect(r.exitCode).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.gemini.skipped).toMatch(/GEMINI_API_KEY/);
    expect(out.candidates.length).toBeGreaterThan(0);
  });

  it("--gemini when the API fails (bad key): analysis still completes, one call only", async () => {
    const before = gem.calls.length;
    const r = await run(["analyze", app, "--gemini", "--json", "--no-cache"], { GEMINI_API_KEY: "bad-key", GEMINI_BASE_URL: gem.url });
    expect(r.exitCode).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.gemini.fatal).toMatch(/authentication failed/);
    expect(out.candidates.length).toBeGreaterThan(0);
    expect(r.stdout + r.stderr).not.toContain("bad-key");
    expect(gem.calls.length - before).toBeLessThanOrEqual(4); // concurrency 4, then stop
  });

  it("--gemini --validate: Gemini adds evidence, TypeSafe decides via the policy, and never sees Gemini's text", async () => {
    const ts = await startMockServer();
    try {
      const env = { GEMINI_API_KEY: "test-key", GEMINI_BASE_URL: gem.url, TYPESAFE_API_KEY: "ts-key", TYPESAFE_BASE_URL: ts.url };
      const r = await run(["analyze", app, "--gemini", "--validate", "--json", "--save", "--private", "--project", "model-router", "--dataset", path.join(work, "ds")], env);
      expect(r.exitCode).toBe(0);
      expect(r.stderr).toMatch(/Gemini \(gemini-3\.8-flash, Google\): \d+ candidate\(s\)\. JevX indexed \d+ file\(s\) locally/);
      expect(r.stderr).toMatch(/credential-looking files are never sent/);
      expect(r.stderr).toMatch(/Private project/);
      const out = JSON.parse(r.stdout);
      const c = out.candidates.find((x: { unit: { name: string } }) => x.unit.name === "chooseModel");
      expect(c.gemini.kind).toBe("model_generated_evidence");
      expect(c.classification.source).toBe("typesafe");
      expect(JSON.stringify(ts.calls.map((x) => x.body))).not.toContain(GOOD_ANALYSIS.summary);

      const plain = await run(["analyze", app, "--gemini", "--validate", "--offline", "--limit", "50"], env);
      expect(plain.stdout).toContain("Gemini code analyst");
      expect(plain.stdout).toContain("model evidence, not a label");
      expect(plain.stdout).toContain("TypeSafe / Jev");
      expect(plain.stdout).toMatch(/JevX policy p0-uncalibrated/);

      const entries = readFileSync(path.join(work, "ds", "projects", "model-router", "entries.jsonl"), "utf8");
      expect(entries).not.toContain(GOOD_ANALYSIS.summary);
      expect(entries).toContain('"kind":"model_generated_evidence"');
    } finally {
      await ts.close();
    }
  });

  it("check reports Gemini without printing the key and without sending code", async () => {
    const r = await run(["check", app, "--gemini"], { GEMINI_API_KEY: "test-key-123456789", GEMINI_BASE_URL: gem.url });
    expect(r.stdout).toMatch(/Gemini API reachable · model gemini-3\.8-flash/);
    expect(r.stdout).not.toMatch(/test-key|6789/);
    const gets = gem.calls.filter((c) => c.method === "GET");
    expect(gets.length).toBeGreaterThan(0);
    const missing = await run(["check", app, "--gemini"]);
    expect(missing.exitCode).toBe(1);
    expect(missing.stdout).toMatch(/Gemini key: not set/);
  });
});
