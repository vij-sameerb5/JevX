// Direct xAI (Grok) transport — the default M5b analyst. Every call goes to a local mock of the
// xAI Responses API; the real api.x.ai is never contacted.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { execa } from "execa";
import { Project } from "ts-morph";
import { RepoIndex, analyzeProject, findJevUsage } from "@jevx/analyzer";
import { DEFAULT_XAI_MODEL, createXaiTransport, resolveXaiModel, resolveXaiTimeout, xaiHttpError, xaiSmokeTest, redactXai } from "@jevx/gemini";
import { BoundaryCache, BoundaryStore, runBoundary } from "@jevx/boundary";
import { GOOD_USAGE } from "./mock-openrouter.js";
import { startMockXai } from "./mock-xai.js";

const KEY = "xai-TESTkey0123456789abcdefghij";

const REPO: Record<string, string> = {
  "package.json": `{"name":"mini-guard"}`,
  "src/jev.ts": `const TYPESAFE_URL = "https://api.typesafe.ai/v1/systemone";
export async function ask(state: unknown, questions: unknown) {
  const res = await fetch(TYPESAFE_URL, { method: "POST", body: JSON.stringify({ state, questions }) });
  return (await res.json()).answers;
}
`,
  "src/guard.ts": `import { ask } from "./jev";
const ACTION_QUESTIONS = { risk: { type: "score", instructions: "How destructive is this shell command?", legend: ["safe", "risky", "destructive"] } };
export async function assessAction(input: string) {
  const a = await ask({ input }, ACTION_QUESTIONS);
  return a.risk.score > 0.7 ? "deny" : "allow";
}
export function decide(score: number, limits: { deny: number; ask: number }) {
  if (score >= limits.deny) return "deny";
  if (score >= limits.ask) return "ask";
  return "allow";
}
`
};

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), "jevx-xai-"));
  dirs.push(d);
  return d;
};
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

let xai: Awaited<ReturnType<typeof startMockXai>>;
beforeAll(async () => {
  xai = await startMockXai();
});
afterAll(async () => {
  await xai.close();
});
const transport = (apiKey = KEY, model = DEFAULT_XAI_MODEL, extra: Record<string, unknown> = {}) => createXaiTransport({ apiKey, baseURL: xai.url, model, ...extra }).transport!;
const posts = (since: number) => xai.calls.slice(since).filter((c) => c.method === "POST");

async function boundaryRun(files = REPO, extra: Record<string, unknown> = {}) {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: true } });
  const root = "/virtual/guard";
  const sfs = Object.entries(files)
    .filter(([f]) => f.endsWith(".ts"))
    .map(([f, c]) => project.createSourceFile(path.join(root, f), c));
  const analysis = await analyzeProject({ root, files: sfs });
  return runBoundary({
    project: "mini-guard",
    visibility: "public",
    root,
    files: sfs,
    analysis,
    usage: findJevUsage({ root, files: sfs }),
    context: new RepoIndex(root, sfs),
    transport: transport(),
    analyst: { provider: "xai", model: DEFAULT_XAI_MODEL },
    cache: new BoundaryCache(tmp()),
    now: () => "2026-09-20T12:00:00.000Z",
    ...extra
  });
}

describe("direct xAI transport", () => {
  it("posts /v1/responses with instructions + input + json_schema; reads usage, cached and reasoning tokens", async () => {
    const before = xai.calls.length;
    const r = await transport().generate({ systemInstruction: "be exact", prompt: "explain this", schema: { type: "object", properties: { why_jev: {} } } });
    const [c] = posts(before);
    expect(c!.path).toBe("/v1/responses");
    expect(c!.auth).toBe(`Bearer ${KEY}`);
    expect(c!.rawBody).not.toContain(KEY);
    expect(c!.body).toMatchObject({ model: "grok-4.6", instructions: "be exact", input: "explain this", temperature: 0, text: { format: { type: "json_schema", strict: true } } });
    expect(JSON.parse(r.text!)).toMatchObject({ decision: { nature: "semantic_judgment" } });
    expect(r).toMatchObject({ inputTokens: 1000, outputTokens: 200, cachedTokens: 128, reasoningTokens: 64 });
  });

  it("cost is CALCULATED from configured prices and labelled as such (xAI reports no price)", async () => {
    const r = await transport(KEY, DEFAULT_XAI_MODEL, { pricePerMInput: 2, pricePerMOutput: 6 }).generate({ systemInstruction: "s", prompt: "p", schema: {} });
    expect(r.costSource).toBe("calculated");
    expect(r.costUsd).toBeCloseTo((1000 / 1e6) * 2 + (200 / 1e6) * 6, 10);
    const dearer = await transport(KEY, DEFAULT_XAI_MODEL, { pricePerMInput: 4, pricePerMOutput: 12 }).generate({ systemInstruction: "s", prompt: "p", schema: {} });
    expect(dearer.costUsd).toBeCloseTo(2 * r.costUsd!, 10);
  });

  it("an answer split across output items is reassembled; reasoning items are skipped", async () => {
    const r = await transport().generate({ systemInstruction: "s", prompt: "MOCK_XAI_PARTS explain", schema: { type: "object", properties: { why_jev: {} } } });
    expect(JSON.parse(r.text!)).toMatchObject({ confidence: "high" });
  });

  it("missing key fails clearly and never falls back to another provider", () => {
    const saved = process.env.XAI_API_KEY;
    try {
      delete process.env.XAI_API_KEY;
      expect(createXaiTransport({ baseURL: xai.url })).toEqual({ error: "XAI_API_KEY is not set." });
      expect(resolveXaiModel()).toBe("grok-4.6");
      expect(resolveXaiModel(undefined, "cfg-model")).toBe("cfg-model");
      expect(resolveXaiTimeout(undefined, 5000)).toBe(5000);
    } finally {
      if (saved === undefined) delete process.env.XAI_API_KEY;
      else process.env.XAI_API_KEY = saved;
    }
  });

  it("errors: 401 and 404 fatal, 429 and 5xx retryable; the key never appears in a message", async () => {
    expect(xaiHttpError(401, "{}", KEY)).toMatchObject({ fatal: true, message: expect.stringContaining("XAI_API_KEY") });
    expect(xaiHttpError(404, '{"error":{"message":"no such model"}}', KEY)).toMatchObject({ fatal: true });
    expect(xaiHttpError(429, "{}", KEY).fatal).toBe(false);
    expect(xaiHttpError(500, "{}", KEY).fatal).toBe(false);
    expect(xaiHttpError(400, `{"error":{"message":"bad key ${KEY}"}}`, KEY).message).not.toContain("TESTkey");
    expect(redactXai(`boom ${KEY}`)).not.toContain("TESTkey");
    await expect(transport("bad-key").generate({ systemInstruction: "s", prompt: "p", schema: {} })).rejects.toMatchObject({ fatal: true, status: 401 });
  });

  it("ping checks the model list and sends no code; an unavailable model is fatal", async () => {
    const before = xai.calls.length;
    await expect(transport().ping()).resolves.toMatchObject({ model: "grok-4.6" });
    expect(xai.calls.slice(before).every((c) => c.method === "GET" && c.rawBody === "")).toBe(true);
    await expect(transport(KEY, "grok-9").ping()).rejects.toMatchObject({ fatal: true });
  });

  it("the smoke test sends no repository code and returns the answer plus its cost", async () => {
    const before = xai.calls.length;
    const t = await xaiSmokeTest(transport());
    expect(t.text).toBe("ready");
    expect(t.costUsd).toBeGreaterThan(0);
    const [c] = posts(before);
    expect(c!.body!.text).toBeUndefined(); // no schema on the smoke test
    expect(c!.rawBody.length).toBeLessThan(400);
  });
});

describe("boundary pilot over direct xAI", () => {
  it("runs B → C → D and records provider xai with calculated cost", async () => {
    const before = xai.calls.length;
    const r = await boundaryRun();
    expect(posts(before)).toHaveLength(2);
    expect(r.analyses[0]).toMatchObject({ analyst: { provider: "xai", model: "grok-4.6" }, usable: true });
    expect(r.analyses[0]!.analysis!.why_jev.unknown).toEqual(GOOD_USAGE.why_jev.unknown);
    expect(r.run.accounting).toMatchObject({ calls: 2, inputTokens: 2000, outputTokens: 400, cachedTokens: 256, reasoningTokens: 128, costSource: "calculated" });
    expect(r.run.accounting.costUsd).toBeCloseTo(2 * ((1000 / 1e6) * 2 + (200 / 1e6) * 6), 10);
  });

  it("retries a 429 and keeps going; adaptive expansion still works", async () => {
    xai.rateLimited.clear();
    const files = { ...REPO, "src/guard.ts": REPO["src/guard.ts"]!.replace("How destructive", "MOCK_XAI_429 How destructive") };
    const r = await boundaryRun(files, { retries: 2, retryDelayMs: 1, maxContrasts: 0 });
    expect(r.run.usages.analyzed).toBe(1);
    expect(r.run.accounting.retries).toBe(1);
  });

  it("a cached OpenRouter answer is never reused for xAI (provider is part of cache identity)", async () => {
    const dir = tmp();
    await boundaryRun(REPO, { cache: new BoundaryCache(dir) });
    const asOpenRouter = await boundaryRun(REPO, { cache: new BoundaryCache(dir), offline: true, transport: undefined, analyst: { provider: "openrouter", model: "x-ai/grok-4.6" } });
    expect(asOpenRouter.analyses).toHaveLength(0);
    const asXai = await boundaryRun(REPO, { cache: new BoundaryCache(dir), offline: true, transport: undefined });
    expect(asXai.analyses).toHaveLength(1);
  });

  it("secrets in the model's answer are scrubbed before storage", async () => {
    const files = { ...REPO, "src/guard.ts": REPO["src/guard.ts"]!.replace("How destructive", "MOCK_XAI_SECRET How destructive") };
    const r = await boundaryRun(files, { maxContrasts: 0 });
    expect(JSON.stringify(r.analyses)).not.toContain("sk-live-abcdefghijklmnopqrstuvwx");
  });

  it("the report labels a calculated cost as calculated and shows cached tokens", async () => {
    const { buildReport } = await import("../scripts/boundary-report.js");
    const ds = tmp();
    new BoundaryStore(ds).saveRun("mini-guard", await boundaryRun());
    const md = buildReport(ds);
    expect(md).toMatch(/\| Cached tokens \| 256 \|/);
    expect(md).toMatch(/Cost \(calculated from configured prices\)/);
    expect(md).toMatch(/xai · grok-4\.6/);
  });
});

// ─── CLI ──────────────────────────────────────────────────────────────────

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(here, "../apps/cli/src/index.tsx");
const cli = (args: string[], env: Record<string, string> = {}) =>
  execa("npx", ["tsx", CLI, ...args], {
    reject: false,
    env: { NO_COLOR: "1", XAI_API_KEY: "", XAI_BASE_URL: "", XAI_MODEL: "", OPENROUTER_API_KEY: "", TYPESAFE_API_KEY: "", GEMINI_API_KEY: "", JEVX_DATASET: "", ...env }
  });

function writeRepo() {
  const root = tmp();
  for (const [f, c] of Object.entries(REPO)) {
    mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
    writeFileSync(path.join(root, f), c);
  }
  return root;
}

describe("CLI: check --grok and boundary over direct xAI", () => {
  it("check --grok verifies key, model and one tiny request, and never prints the key", async () => {
    const root = writeRepo();
    const r = await cli(["check", root, "--grok"], { XAI_API_KEY: KEY, XAI_BASE_URL: xai.url });
    expect(r.stdout).toMatch(/Grok \(xAI\) key: set/);
    expect(r.stdout).toMatch(/xAI API reachable · model grok-4\.6 available · this check sent no code/);
    expect(r.stdout).toMatch(/Grok answered a \d+-token test request \("ready"\)/);
    expect(r.stdout).toMatch(/calculated from configured prices/);
    expect(r.stdout + r.stderr).not.toContain("TESTkey");
    const missing = await cli(["check", root, "--grok"]);
    expect(missing.exitCode).toBe(1);
    expect(missing.stdout).toMatch(/XAI_API_KEY is not set\./);
  });

  it("boundary defaults to direct xAI and fails clearly without a key (no fallback)", async () => {
    const root = writeRepo();
    const ds = tmp();
    const noKey = await cli(["boundary", root, "--public", "--dataset", ds], { OPENROUTER_API_KEY: "sk-or-v1-should-not-be-used" });
    expect(noKey.exitCode).toBe(1);
    expect(noKey.stderr).toMatch(/XAI_API_KEY is not set\./);
    const before = xai.calls.length;
    const ok = await cli(["boundary", root, "--public", "--project", "mini-guard", "--dataset", ds], { XAI_API_KEY: KEY, XAI_BASE_URL: xai.url });
    expect(ok.exitCode).toBe(0);
    expect(posts(before).length).toBeGreaterThan(0);
    expect(ok.stderr).toMatch(/xAI \(Grok, direct\) \(grok-4\.6\)/);
    expect(ok.stdout).toMatch(/\(calculated from configured prices\)/);
    expect(new BoundaryStore(ds).analyses("mini-guard")[0]!.analyst.provider).toBe("xai");
    expect(ok.stdout + ok.stderr).not.toContain("TESTkey");
  });
});
