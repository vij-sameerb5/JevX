// OpenRouter as a second code-analyst provider. All calls go to a local mock — never the real API.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { execa } from "execa";
import { Project } from "ts-morph";
import { RepoIndex, analyzeProject } from "@jevx/analyzer";
import type { AnalysisResult } from "@jevx/core";
import {
  DEFAULT_OPENROUTER_MODEL,
  GEMINI_PROMPT_VERSION,
  GeminiCache,
  RESPONSE_SCHEMA,
  SYSTEM_INSTRUCTION,
  analyzeWithCodeAnalyst,
  analyzeWithGemini,
  createOpenRouterTransport,
  openRouterHttpError,
  redactOpenRouter,
  resolveOpenRouterModel,
  type GeminiTransport
} from "@jevx/gemini";
import { Dataset, checkDataset, evaluate, labelEntry, upsertAnalysis, validateEntry, type DatasetEntry } from "@jevx/dataset";
import { GOOD_ANALYSIS, startMockGemini } from "./mock-gemini.js";
import { startMockOpenRouter } from "./mock-openrouter.js";

const KEY = "sk-or-v1-test0123456789abcdef";

const CHOOSE_MODEL = (marker = "") => `
export function chooseModel(task: { type: string }) {
  // ${marker}
  if (task.type === "simple") return "fast";
  if (task.type === "complex") return "smart";
  if (task.type === "coding") return "code";
  return "fast";
}`;

const PICK_TONE = (marker = "") => `
export function pickTone(msg: { mood: string }) {
  // ${marker}
  if (msg.mood === "angry") return "calm";
  if (msg.mood === "happy") return "cheerful";
  return "neutral";
}`;

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), "jevx-or-"));
  dirs.push(d);
  return d;
};
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

async function analysis(files: Record<string, string>): Promise<AnalysisResult> {
  const project = new Project({ useInMemoryFileSystem: true });
  const root = "/virtual/app";
  return analyzeProject({ root, files: Object.entries(files).map(([f, c]) => project.createSourceFile(path.join(root, f), c)) });
}

/** Same repo as the Gemini context tests: route() needs tierFor() from another file. */
const REPO: Record<string, string> = {
  "src/router.ts": `import { tierFor } from "./tiers";
import type { Task } from "./types";

// MOCK_GEMINI_NEEDS_CALLEE
export function route(task: Task) {
  const t = tierFor(task);
  if (t === "low") return "fast";
  if (t === "high") return "smart";
  return "code";
}
`,
  "src/tiers.ts": `import type { Task } from "./types";
const apiKey = "sk-live-abcdefghijklmnopqrstuvwx";
export function tierFor(task: Task): string {
  // MOCK_CALLEE_BODY
  return task.priority > 5 ? "high" : task.text.length > 200 ? "long" : "low";
}
`,
  "src/types.ts": `export interface Task { priority: number; text: string }
`,
  "src/api.ts": `import { route } from "./router";
export function handle(req: { task: { priority: number; text: string } }) {
  return route(req.task);
}
`
};

async function repo(files: Record<string, string> = REPO) {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: true } });
  const root = "/virtual/repo";
  const sfs = Object.entries(files).map(([f, c]) => project.createSourceFile(path.join(root, f), c));
  const result = await analyzeProject({ root, files: sfs });
  const route = result.candidates.find((c) => c.unit.name === "route")!;
  return { result: { ...result, candidates: [route] }, index: new RepoIndex(root, sfs), route };
}

let or: Awaited<ReturnType<typeof startMockOpenRouter>>;
beforeAll(async () => {
  or = await startMockOpenRouter();
});
afterAll(async () => {
  await or.close();
});

const transport = (apiKey = KEY, model = DEFAULT_OPENROUTER_MODEL) => {
  const made = createOpenRouterTransport({ apiKey, baseURL: or.url, model });
  if (!made.transport) throw new Error(made.error);
  return made.transport;
};
const run = (r: AnalysisResult, extra: Partial<Parameters<typeof analyzeWithGemini>[1]> = {}) =>
  analyzeWithCodeAnalyst(r, { provider: "openrouter", model: DEFAULT_OPENROUTER_MODEL, transport: transport(), cache: new GeminiCache(tmp(), true, "openrouter"), ...extra });
const postsSince = (n: number) => or.calls.slice(n).filter((c) => c.method === "POST");

describe("OpenRouter transport", () => {
  it("success: structured-output request with the shared prompt + schema; evidence lands in the openrouter slot", async () => {
    const before = or.calls.length;
    const out = await run(await analysis({ "src/m.ts": CHOOSE_MODEL() }));
    const c = out.candidates.find((x) => x.unit.name === "chooseModel")!;
    expect(c.openrouter).toMatchObject({ kind: "model_generated_evidence", provider: "openrouter", model: DEFAULT_OPENROUTER_MODEL, promptVersion: GEMINI_PROMPT_VERSION, usable: true });
    expect(c.openrouter!.analysis.summary).toBe(GOOD_ANALYSIS.summary);
    expect(c.gemini).toBeUndefined();
    expect(c.classification).toBeUndefined(); // evidence only
    expect(out.openrouter).toMatchObject({ attempted: 1, apiCalls: 1, errors: 0, inputTokens: 900, outputTokens: 160 });
    expect(out.gemini).toBeUndefined();

    const [call] = postsSince(before);
    expect(call!.path).toBe("/api/v1/chat/completions");
    expect(call!.auth).toBe(`Bearer ${KEY}`);
    expect(call!.rawBody).not.toContain(KEY); // key only in the header
    expect(call!.body!.model).toBe(DEFAULT_OPENROUTER_MODEL);
    expect(call!.body!.messages!.map((m) => m.role)).toEqual(["system", "user"]);
    expect(call!.body!.messages![0]!.content).toBe(SYSTEM_INSTRUCTION);
    expect(call!.body!.response_format).toEqual({ type: "json_schema", json_schema: { name: "jevx_code_analysis", strict: true, schema: RESPONSE_SCHEMA } });
    expect(call!.body!.temperature).toBe(0);
  });

  it("valid JSON as content parts is accepted; a 200 body carrying an error is an error", async () => {
    const out = await run(await analysis({ "src/m.ts": CHOOSE_MODEL("MOCK_OR_PARTS"), "src/t.ts": PICK_TONE("MOCK_OR_ERROR_IN_BODY") }));
    expect(out.candidates.find((x) => x.unit.name === "chooseModel")!.openrouter!.analysis.decision_type).toBe("selection");
    expect(out.candidates.find((x) => x.unit.name === "pickTone")!.openrouterError).toMatch(/upstream provider error/);
  });

  it("malformed JSON becomes a per-candidate error and is never cached", async () => {
    const dir = tmp();
    const r = await analysis({ "src/m.ts": CHOOSE_MODEL("MOCK_OR_BAD_JSON") });
    const out = await analyzeWithCodeAnalyst(r, { provider: "openrouter", model: DEFAULT_OPENROUTER_MODEL, transport: transport(), cache: new GeminiCache(dir, true, "openrouter") });
    expect(out.candidates[0]!.openrouterError).toMatch(/not valid JSON/);
    expect(out.openrouter!.errors).toBe(1);
    expect(existsSync(path.join(dir, ".jevx", "cache", "openrouter.json"))).toBe(false);
  });

  it("HTTP 429 fails that candidate only (not fatal); the others still run", async () => {
    const before = or.calls.length;
    const out = await run(await analysis({ "src/m.ts": CHOOSE_MODEL("MOCK_OR_429"), "src/t.ts": PICK_TONE() }));
    expect(out.candidates.find((x) => x.unit.name === "chooseModel")!.openrouterError).toMatch(/rate limited \(HTTP 429\)/);
    expect(out.candidates.find((x) => x.unit.name === "pickTone")!.openrouter).toBeDefined();
    expect(out.openrouter!.fatal).toBeUndefined();
    expect(postsSince(before).length).toBe(2);
  });

  it("HTTP 500 fails that candidate only", async () => {
    const out = await run(await analysis({ "src/m.ts": CHOOSE_MODEL("MOCK_OR_500"), "src/t.ts": PICK_TONE() }));
    expect(out.candidates.find((x) => x.unit.name === "chooseModel")!.openrouterError).toMatch(/OpenRouter API error \(HTTP 500\)/);
    expect(out.candidates.find((x) => x.unit.name === "pickTone")!.openrouter).toBeDefined();
  });

  it("a bad key (401) is fatal: calls stop, and the key never appears in errors", async () => {
    const before = or.calls.length;
    const r = await analysis({ "src/m.ts": CHOOSE_MODEL(), "src/t.ts": PICK_TONE() });
    const out = await analyzeWithCodeAnalyst(r, {
      provider: "openrouter",
      model: DEFAULT_OPENROUTER_MODEL,
      transport: transport("bad-key"),
      cache: new GeminiCache(tmp(), true, "openrouter"),
      concurrency: 1
    });
    expect(out.openrouter!.fatal).toMatch(/authentication failed \(HTTP 401\) — check OPENROUTER_API_KEY/);
    expect(postsSince(before).length).toBe(1);
    expect(JSON.stringify(out)).not.toContain("bad-key");
    expect(redactOpenRouter(`boom Bearer ${KEY} ${KEY}`, KEY)).not.toContain("test0123");
    expect(openRouterHttpError(429, `{"error":{"message":"limit for ${KEY}"}}`, KEY).message).not.toContain(KEY);
  });

  it("a hanging request times out and the run continues", async () => {
    const out = await run(await analysis({ "src/m.ts": CHOOSE_MODEL("MOCK_OR_SLOW"), "src/t.ts": PICK_TONE() }), { timeoutMs: 200 });
    expect(out.candidates.find((x) => x.unit.name === "chooseModel")!.openrouterError).toMatch(/timed out/);
    expect(out.candidates.find((x) => x.unit.name === "pickTone")!.openrouter).toBeDefined();
  });

  it("missing key: no transport, a clear reason; model resolves flag → env → config → default", () => {
    const saved = { k: process.env.OPENROUTER_API_KEY, m: process.env.OPENROUTER_MODEL };
    try {
      delete process.env.OPENROUTER_API_KEY;
      delete process.env.OPENROUTER_MODEL;
      expect(createOpenRouterTransport({ baseURL: or.url })).toEqual({ error: "OPENROUTER_API_KEY is not set" });
      expect(resolveOpenRouterModel()).toBe("x-ai/grok-4.6");
      expect(resolveOpenRouterModel(undefined, "cfg/model")).toBe("cfg/model");
      process.env.OPENROUTER_MODEL = "env/model";
      expect(resolveOpenRouterModel(undefined, "cfg/model")).toBe("env/model");
      expect(resolveOpenRouterModel("flag/model", "cfg/model")).toBe("flag/model");
    } finally {
      if (saved.k === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = saved.k;
      if (saved.m === undefined) delete process.env.OPENROUTER_MODEL;
      else process.env.OPENROUTER_MODEL = saved.m;
    }
  });

  it("ping sends no code: checks the key and that the model exists", async () => {
    const before = or.calls.length;
    await expect(transport().ping()).resolves.toMatchObject({ model: DEFAULT_OPENROUTER_MODEL, displayName: "xAI: Grok 4.6" });
    const calls = or.calls.slice(before);
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(["GET /api/v1/key", "GET /api/v1/models"]);
    expect(calls.every((c) => c.rawBody === "")).toBe(true);
    await expect(transport(KEY, "nope/missing").ping()).rejects.toThrow(/not found on OpenRouter/);
  });
});

describe("OpenRouter: shared analyst logic", () => {
  it("adaptive expansion works: asks for tierFor, JevX adds it, second round is sufficient", async () => {
    const { result, index } = await repo();
    const before = or.calls.length;
    const out = await run(result, { context: index });
    const ev = out.candidates[0]!.openrouter!;
    expect(ev.context.rounds).toBe(2);
    expect(ev.context.stoppedBy).toBe("sufficient");
    expect(ev.context.items.some((i) => i.id.includes("tierFor"))).toBe(true);
    const posts = postsSince(before);
    expect(posts.length).toBe(2);
    expect(posts[0]!.promptText).toContain("MOCK_GEMINI_NEEDS_CALLEE"); // round 1: whole file
    expect(posts[1]!.promptText).toContain("MOCK_CALLEE_BODY");
    // secrets in context never leave: the callee's file holds an API key
    expect(posts.map((p) => p.rawBody).join("")).not.toContain("sk-live-abcdefghijklmnopqrstuvwx");
  });

  it("secret scrubbing: a secret in the model's answer is redacted before it is kept", async () => {
    const out = await run(await analysis({ "src/m.ts": CHOOSE_MODEL("MOCK_OR_SECRET") }));
    const reasoning = out.candidates[0]!.openrouter!.analysis.reasoning;
    expect(reasoning).not.toContain("sk-live-abcdefghijklmnopqrstuvwx");
    expect(reasoning).toMatch(/redacted|REDACTED|«/);
  });

  it("same schema as Gemini: identical analysis fields, prompt version and evidence shape", async () => {
    const r = await analysis({ "src/m.ts": CHOOSE_MODEL() });
    const fakeGemini: GeminiTransport = {
      model: "gemini-fake",
      async generate() {
        return { text: JSON.stringify(GOOD_ANALYSIS), inputTokens: 1, outputTokens: 1 };
      },
      async ping() {
        return { model: "gemini-fake" };
      }
    };
    const g = (await analyzeWithGemini(r, { model: "gemini-fake", transport: fakeGemini, cache: new GeminiCache(tmp()) })).candidates[0]!.gemini!;
    const o = (await run(r)).candidates[0]!.openrouter!;
    expect(Object.keys(o.analysis).sort()).toEqual(Object.keys(g.analysis).sort());
    expect(o.analysis).toEqual(g.analysis);
    expect(Object.keys(o).sort()).toEqual(Object.keys(g).sort());
    expect(o.promptVersion).toBe(g.promptVersion);
    expect(g.provider).toBe("gemini");
    expect(o.provider).toBe("openrouter");
  });

  it("cache: hit on unchanged context, re-run when a callee changes; provider- and model-specific", async () => {
    const dir = tmp();
    const a = await repo();
    const before = or.calls.length;
    const cache = () => new GeminiCache(dir, true, "openrouter");
    await run(a.result, { context: a.index, cache: cache() });
    expect(postsSince(before).length).toBe(2);
    const again = await run(a.result, { context: a.index, cache: cache() });
    expect(again.candidates[0]!.openrouter!.cached).toBe(true);
    expect(postsSince(before).length).toBe(2);

    // a changed callee invalidates, although the candidate itself is unchanged
    const b = await repo({ ...REPO, "src/tiers.ts": REPO["src/tiers.ts"]!.replace("> 5", "> 7") });
    expect(b.route.hashes.code).toBe(a.route.hashes.code);
    await run(b.result, { context: b.index, cache: cache() });
    expect(postsSince(before).length).toBe(4);

    // other model → miss (offline replay has nothing)
    const otherModel = await analyzeWithCodeAnalyst(b.result, { provider: "openrouter", model: "other/model", cache: cache(), context: b.index, offline: true });
    expect(otherModel.candidates[0]!.openrouterError).toMatch(/not in OpenRouter cache/);

    // separate files; the same model id under Gemini is a different key
    expect(existsSync(path.join(dir, ".jevx", "cache", "openrouter.json"))).toBe(true);
    expect(existsSync(path.join(dir, ".jevx", "cache", "gemini.json"))).toBe(false);
    const gem = await analyzeWithGemini(b.result, { model: DEFAULT_OPENROUTER_MODEL, cache: new GeminiCache(dir), context: b.index, offline: true });
    expect(gem.candidates[0]!.geminiError).toMatch(/not in Gemini cache/);
    expect(GeminiCache.key(b.route, "m", "adaptive", GEMINI_PROMPT_VERSION, "openrouter")).not.toBe(GeminiCache.key(b.route, "m", "adaptive", GEMINI_PROMPT_VERSION, "gemini"));
    // Gemini keys keep their pre-OpenRouter form (existing caches stay valid)
    expect(GeminiCache.key(b.route, "m")).toBe(GeminiCache.key(b.route, "m", "adaptive", GEMINI_PROMPT_VERSION, "gemini"));
    // a cache of the wrong provider is refused
    await expect(analyzeWithCodeAnalyst(b.result, { provider: "openrouter", model: "m", cache: new GeminiCache(dir), offline: true })).rejects.toThrow(/cache is for gemini/);
  });

  it("Gemini and OpenRouter are independent: either, both, or neither", async () => {
    const r = await analysis({ "src/m.ts": CHOOSE_MODEL() });
    const fakeGemini: GeminiTransport = {
      model: "g",
      async generate() {
        return { text: JSON.stringify({ ...GOOD_ANALYSIS, model_hypothesis: { label: "NOT_JEV", note: "" } }), inputTokens: 1, outputTokens: 1 };
      },
      async ping() {
        return { model: "g" };
      }
    };
    const onlyG = await analyzeWithGemini(r, { model: "g", transport: fakeGemini, cache: new GeminiCache(tmp()) });
    expect(onlyG.candidates[0]!.gemini).toBeDefined();
    expect(onlyG.candidates[0]!.openrouter).toBeUndefined();
    const onlyO = await run(r);
    expect(onlyO.candidates[0]!.openrouter).toBeDefined();
    expect(onlyO.candidates[0]!.gemini).toBeUndefined();
    const both = await run(onlyG);
    expect(both.candidates[0]!.gemini!.analysis.model_hypothesis!.label).toBe("NOT_JEV");
    expect(both.candidates[0]!.openrouter!.analysis.model_hypothesis!.label).toBe("STRONG_JEV");
    expect(both.gemini).toBeDefined();
    expect(both.openrouter).toBeDefined();
  });
});

describe("OpenRouter evidence in the dataset", () => {
  it("public: full analysis in the openrouter slot; private: facts only; validators catch leaks", async () => {
    const r = await run(await analysis({ "src/m.ts": CHOOSE_MODEL() }));
    const ds = new Dataset(tmp());
    upsertAnalysis(ds, { slug: "pub", visibility: "public" }, r);
    upsertAnalysis(ds, { slug: "priv", visibility: "private" }, r);
    const pub = ds.entries("pub")[0]!;
    expect(pub.openrouter).toMatchObject({ kind: "model_generated_evidence", provider: "openrouter", model: DEFAULT_OPENROUTER_MODEL, facts: { hypothesis: "STRONG_JEV" } });
    expect(pub.openrouter!.analysis!.summary).toBe(GOOD_ANALYSIS.summary);
    expect(pub.gemini).toBeUndefined();
    const privText = readFileSync(path.join(ds.dir, "projects", "priv", "entries.jsonl"), "utf8");
    expect(privText).not.toContain(GOOD_ANALYSIS.summary);
    expect(privText).not.toContain('"analysis":{');
    expect(ds.entries("priv")[0]!.openrouter!.facts).toMatchObject({ plausible_primitive: "choice", usable: true });
    expect(checkDataset(ds).errors).toEqual([]);
    const priv = ds.entries("priv")[0]!;
    const leaked = { ...priv, openrouter: { ...priv.openrouter!, analysis: pub.openrouter!.analysis } } as DatasetEntry;
    expect(validateEntry(leaked).join()).toMatch(/PRIVATE entry contains OpenRouter free text/);
    const swapped = { ...pub, gemini: { ...pub.openrouter! } } as DatasetEntry;
    expect(validateEntry(swapped).join()).toMatch(/gemini slot holds openrouter evidence/);
  });

  it("can never set or change a human label; eval compares it for information only", async () => {
    const ds = new Dataset(tmp());
    const base = await analysis({ "src/m.ts": CHOOSE_MODEL() });
    upsertAnalysis(ds, { slug: "app", visibility: "public", split: "dev" }, base);
    const id = ds.entries("app")[0]!.id;
    labelEntry(ds, "app", id, { label: "NOT_JEV", reasoning: "closed enum", labeller: "sameer" });

    const fakeGemini: GeminiTransport = {
      model: "g",
      async generate() {
        return { text: JSON.stringify({ ...GOOD_ANALYSIS, model_hypothesis: { label: "NOT_JEV", note: "" } }), inputTokens: 1, outputTokens: 1 };
      },
      async ping() {
        return { model: "g" };
      }
    };
    const withG = await analyzeWithGemini(base, { model: "g", transport: fakeGemini, cache: new GeminiCache(tmp()) });
    upsertAnalysis(ds, { slug: "app", visibility: "public" }, await run(withG)); // OpenRouter says STRONG_JEV
    const e = ds.entries("app")[0]!;
    expect(e.human).toMatchObject({ label: "NOT_JEV", labeller: "sameer" });
    expect(e.needsRecheck).toBe(false);
    expect(e.auto.label).toBeUndefined();
    expect(e.openrouter!.facts.hypothesis).toBe("STRONG_JEV");

    const m = evaluate(ds).splits.dev.total;
    expect(m.predicted).toBe(0); // neither analyst is a prediction
    expect(m.gemini).toMatchObject({ hypotheses: 1, agreed: 1 });
    expect(m.openrouter).toMatchObject({ withEvidence: 1, hypotheses: 1, agreed: 0 });
    expect(m.comparison).toMatchObject({ bothAnalysts: 1, analystsAgreed: 0 });

    // OpenRouter-only re-analysis keeps the earlier Gemini evidence for unchanged code
    upsertAnalysis(ds, { slug: "app", visibility: "public" }, await run(base));
    expect(ds.entries("app")[0]!.gemini).toBeDefined();
    expect(ds.entries("app")[0]!.human!.label).toBe("NOT_JEV");
  });
});

// ─── CLI ──────────────────────────────────────────────────────────────────

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(here, "../apps/cli/src/index.tsx");
const cli = (args: string[], env: Record<string, string> = {}) =>
  execa("npx", ["tsx", CLI, ...args], {
    reject: false,
    env: {
      NO_COLOR: "1",
      TYPESAFE_API_KEY: "",
      TYPESAFE_BASE_URL: "",
      GEMINI_API_KEY: "",
      GEMINI_BASE_URL: "",
      GEMINI_MODEL: "",
      OPENROUTER_API_KEY: "",
      OPENROUTER_BASE_URL: "",
      OPENROUTER_MODEL: "",
      JEVX_DATASET: "",
      ...env
    }
  });

describe("jevx analyze --openrouter / check --openrouter (CLI)", () => {
  let work: string;
  let app: string;
  beforeAll(() => {
    work = mkdtempSync(path.join(tmpdir(), "jevx-orcli-"));
    app = path.join(work, "app");
    mkdirSync(path.join(app, "src"), { recursive: true });
    writeFileSync(path.join(app, "package.json"), '{"name":"model-router"}');
    writeFileSync(path.join(app, "src", "model.ts"), CHOOSE_MODEL());
    cpSync(path.resolve(here, "../regression/legacy-v1/support-bot/src"), path.join(app, "src", "bot"), { recursive: true });
  });
  afterAll(() => rmSync(work, { recursive: true, force: true }));

  it("analyze with no provider sends nothing", async () => {
    const before = or.calls.length;
    const r = await cli(["analyze", app, "--json"], { OPENROUTER_API_KEY: KEY, OPENROUTER_BASE_URL: or.url });
    expect(r.exitCode).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.gemini).toBeNull();
    expect(out.openrouter).toBeNull();
    expect(or.calls.length).toBe(before);
  });

  it("--openrouter without a key: skipped with a clear note, analysis completes", async () => {
    const r = await cli(["analyze", app, "--openrouter", "--json"]);
    expect(r.exitCode).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.openrouter.skipped).toMatch(/OPENROUTER_API_KEY is not set/);
    expect(out.candidates.length).toBeGreaterThan(0);
  });

  it("--code-analyst openrouter adds evidence and the key never appears in output", async () => {
    const env = { OPENROUTER_API_KEY: KEY, OPENROUTER_BASE_URL: or.url };
    const r = await cli(["analyze", app, "--code-analyst", "openrouter", "--json"], env);
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toMatch(/OpenRouter \(x-ai\/grok-4\.6, OpenRouter → the model's provider\): \d+ candidate\(s\)/);
    const out = JSON.parse(r.stdout);
    expect(out.openrouter).toMatchObject({ model: DEFAULT_OPENROUTER_MODEL, errors: 0 });
    expect(out.gemini).toBeNull();
    const c = out.candidates.find((x: { unit: { name: string } }) => x.unit.name === "chooseModel");
    expect(c.openrouter.provider).toBe("openrouter");
    expect(r.stdout + r.stderr).not.toContain(KEY);
    expect(readFileSync(path.join(app, ".jevx", "cache", "openrouter.json"), "utf8")).not.toContain(KEY);

    const plain = await cli(["analyze", app, "--openrouter", "--openrouter-model", DEFAULT_OPENROUTER_MODEL, "--offline", "--limit", "50"], env);
    expect(plain.stdout).toContain("OpenRouter code analyst");
    expect(plain.stdout).toContain("model evidence, not a label");
  });

  it("--gemini and --openrouter together: both slots, independent summaries", async () => {
    const gem = await startMockGemini();
    try {
      const r = await cli(["analyze", app, "--gemini", "--openrouter", "--json", "--no-cache"], {
        OPENROUTER_API_KEY: KEY,
        OPENROUTER_BASE_URL: or.url,
        GEMINI_API_KEY: "g-key",
        GEMINI_BASE_URL: gem.url
      });
      expect(r.exitCode).toBe(0);
      const out = JSON.parse(r.stdout);
      expect(out.gemini.errors).toBe(0);
      expect(out.openrouter.errors).toBe(0);
      const c = out.candidates.find((x: { unit: { name: string } }) => x.unit.name === "chooseModel");
      expect(c.gemini.kind).toBe("model_generated_evidence");
      expect(c.openrouter.kind).toBe("model_generated_evidence");
    } finally {
      await gem.close();
    }
  });

  it("check --openrouter: key valid, model found, no code sent, key never printed", async () => {
    const before = or.calls.length;
    const r = await cli(["check", app, "--openrouter"], { OPENROUTER_API_KEY: KEY, OPENROUTER_BASE_URL: or.url });
    expect(r.stdout).toMatch(/OpenRouter key: set/);
    expect(r.stdout).toMatch(/OpenRouter API reachable · key valid · model x-ai\/grok-4\.6/);
    expect(r.stdout).not.toContain("test0123");
    expect(or.calls.slice(before).every((c) => c.method === "GET" && c.rawBody === "")).toBe(true);

    const missing = await cli(["check", app, "--openrouter"]);
    expect(missing.exitCode).toBe(1);
    expect(missing.stdout).toMatch(/OpenRouter key: not set/);
    const bad = await cli(["check", app, "--code-analyst", "openrouter"], { OPENROUTER_API_KEY: "bad-key", OPENROUTER_BASE_URL: or.url });
    expect(bad.exitCode).toBe(1);
    expect(bad.stdout).toMatch(/authentication failed \(HTTP 401\)/);
    expect(bad.stdout).not.toContain("bad-key");
  });
});
