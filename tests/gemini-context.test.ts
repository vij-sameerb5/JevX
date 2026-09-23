import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Project } from "ts-morph";
import { RepoIndex, analyzeProject } from "@jevx/analyzer";
import { GeminiCache, analyzeWithGemini, type GeminiTransport } from "@jevx/gemini";
import { Dataset, checkDataset, upsertAnalysis } from "@jevx/dataset";
import { GOOD_ANALYSIS } from "./mock-gemini.js";

/**
 * A small repo where the candidate (route) cannot be understood alone: its outcome depends on
 * tierFor() in another file, a Task type, and it is called from api.ts.
 */
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
`,
  "src/secrets.ts": `export const TOKEN = "super-private-token-value-123";
`
};

async function repo(files: Record<string, string> = REPO) {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: true } });
  const root = "/virtual/repo";
  const sfs = Object.entries(files).map(([f, c]) => project.createSourceFile(path.join(root, f), c));
  const result = await analyzeProject({ root, files: sfs });
  return { result, index: new RepoIndex(root, sfs), route: result.candidates.find((c) => c.unit.name === "route")! };
}

/** Fake Gemini: decides per prompt; records prompts. */
function fake(answer: (prompt: string) => object) {
  const prompts: string[] = [];
  const t: GeminiTransport = {
    model: "fake",
    async generate(req) {
      prompts.push(req.prompt);
      return { text: JSON.stringify(answer(req.prompt)), inputTokens: req.prompt.length, outputTokens: 10 };
    },
    async ping() {
      return { model: "fake" };
    }
  };
  return { t, prompts };
}

const needsCallee = (p: string) =>
  p.includes("MOCK_CALLEE_BODY")
    ? GOOD_ANALYSIS
    : { ...GOOD_ANALYSIS, context_sufficient: false, understanding_confidence: "low", missing_context: [{ request: "tierFor", why: "outcome depends on what tierFor returns" }] };

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), "jevx-ctx-"));
  dirs.push(d);
  return d;
};
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

describe("RepoIndex (whole-repo, offline)", () => {
  it("starts with the candidate's whole file and offers related context as a catalog", async () => {
    const { index, route } = await repo();
    expect(route).toBeDefined();
    const init = index.initial(route);
    expect(init.items.map((i) => i.id)).toEqual(["file:src/router.ts"]);
    expect(init.items[0]!.text).toMatch(/^\s+1 \| import/);
    const ids = init.catalog.map((r) => r.id);
    expect(ids.some((i) => i.startsWith("callee:src/tiers.ts#tierFor@"))).toBe(true);
    expect(ids.some((i) => i.startsWith("type:src/types.ts#Task@"))).toBe(true);
    expect(ids.some((i) => i.startsWith("caller:src/api.ts#handle@"))).toBe(true);
    expect(ids).toContain("importer:src/api.ts");
    expect(ids).toContain("module:src");
    expect(ids).toContain("repo:overview");
  });

  it("never offers credential-looking files, and scrubs secrets from every item", async () => {
    const { index, route } = await repo();
    const init = index.initial(route);
    const all = [...init.items, ...init.catalog.map((r) => index.resolve(r.id)!)];
    const text = all.map((i) => i.id + "\n" + i.text).join("\n");
    expect(text).not.toContain("secrets.ts");
    expect(text).not.toContain("super-private-token");
    expect(text).not.toContain("sk-live-abcdefghijklmnopqrstuvwx");
    expect(index.search("TOKEN secrets.ts")).toEqual([]);
  });

  it("finds what Gemini names in free text", async () => {
    const { index } = await repo();
    expect(index.search("I need `tierFor`")[0]!.id).toMatch(/^unit:src\/tiers\.ts#tierFor@/);
    expect(index.search("what is in src/types.ts?")[0]!.id).toBe("file:src/types.ts");
  });
});

describe("Gemini adaptive context loop", () => {
  it("expands with exactly what Gemini asks for, then stops when it is sufficient", async () => {
    const { result, index } = await repo();
    const { t, prompts } = fake(needsCallee);
    const out = await analyzeWithGemini({ ...result, candidates: result.candidates.filter((c) => c.unit.name === "route") }, { model: t.model, transport: t, cache: new GeminiCache(tmp()), context: index });
    const g = out.candidates[0]!.gemini!;
    expect(prompts.length).toBe(2);
    expect(prompts[0]).not.toContain("MOCK_CALLEE_BODY");
    expect(prompts[1]).toContain("MOCK_CALLEE_BODY");
    expect(prompts[1]).not.toContain("sk-live-abcdefghijklmnopqrstuvwx");
    expect(g.context).toMatchObject({ mode: "adaptive", rounds: 2, stoppedBy: "sufficient" });
    expect(g.context.items.map((i) => i.id)[0]).toBe("file:src/router.ts");
    expect(g.context.items.some((i) => i.id.includes("tierFor"))).toBe(true);
    expect(g.usable).toBe(true);
    expect(out.gemini).toMatchObject({ expanded: 1, insufficient: 0 });
  });

  it("local mode never expands; the analysis is marked insufficient (weak evidence)", async () => {
    const { result, index } = await repo();
    const { t, prompts } = fake(needsCallee);
    const out = await analyzeWithGemini(result, { model: t.model, transport: t, cache: new GeminiCache(tmp()), context: index, mode: "local" });
    const g = out.candidates.find((c) => c.unit.name === "route")!.gemini!;
    expect(g.context).toMatchObject({ rounds: 1, stoppedBy: "local_mode" });
    expect(g.usable).toBe(false);
    expect(prompts.length).toBe(result.candidates.length);
  });

  it("a vague request escalates tier by tier (callees/types → callers → folder → repo) up to max rounds", async () => {
    const { result, index } = await repo();
    const { t, prompts } = fake(() => ({ ...GOOD_ANALYSIS, context_sufficient: false, missing_context: [{ request: "the rest of the system", why: "unclear purpose" }] }));
    const out = await analyzeWithGemini({ ...result, candidates: result.candidates.filter((c) => c.unit.name === "route") }, { model: t.model, transport: t, cache: new GeminiCache(tmp()), context: index, maxRounds: 4 });
    const g = out.candidates[0]!.gemini!;
    expect(g.context.stoppedBy).toBe("max_rounds");
    expect(g.usable).toBe(false);
    const kinds = g.context.items.map((i) => i.kind);
    expect(kinds, JSON.stringify(g.context.items)).toEqual(expect.arrayContaining(["file", "callee", "type", "caller", "importer", "module"]));
    expect(prompts.length).toBe(4);
    expect(prompts[3]!.length).toBeGreaterThan(prompts[0]!.length);
  });

  it("stops at the per-candidate budget and says so", async () => {
    const { result, index, route } = await repo();
    const first = index.initial(route).items.reduce((n, i) => n + i.chars, 0);
    const { t } = fake(needsCallee);
    const out = await analyzeWithGemini({ ...result, candidates: [route] }, { model: t.model, transport: t, cache: new GeminiCache(tmp()), context: index, budget: first + 5 });
    expect(out.candidates[0]!.gemini!.context.stoppedBy).toBe("budget");
    expect(out.candidates[0]!.gemini!.usable).toBe(false);
  });

  it("cache is reused only while every context item is unchanged (a changed callee re-runs)", async () => {
    const dir = tmp();
    const a = await repo();
    const { t, prompts } = fake(needsCallee);
    const only = (r: typeof a) => ({ ...r.result, candidates: [r.route] });
    await analyzeWithGemini(only(a), { model: t.model, transport: t, cache: new GeminiCache(dir), context: a.index });
    expect(prompts.length).toBe(2);

    const again = await analyzeWithGemini(only(a), { model: t.model, transport: t, cache: new GeminiCache(dir), context: a.index });
    expect(prompts.length).toBe(2);
    expect(again.candidates[0]!.gemini!.cached).toBe(true);

    const b = await repo({ ...REPO, "src/tiers.ts": REPO["src/tiers.ts"]!.replace("> 5", "> 7") });
    expect(b.route.hashes.code).toBe(a.route.hashes.code); // the candidate itself did not change
    await analyzeWithGemini(only(b), { model: t.model, transport: t, cache: new GeminiCache(dir), context: b.index });
    expect(prompts.length).toBe(4);
    const offline = await analyzeWithGemini(only(a), { model: t.model, cache: new GeminiCache(dir), context: a.index, offline: true });
    expect(offline.candidates[0]!.geminiError).toMatch(/stale/);
  });

  it("dataset: public keeps context ids; private keeps only counts and the sufficiency flag", async () => {
    const { result, index } = await repo();
    const { t } = fake(needsCallee);
    const out = await analyzeWithGemini(result, { model: t.model, transport: t, cache: new GeminiCache(tmp()), context: index });
    const ds = new Dataset(tmp());
    upsertAnalysis(ds, { slug: "pub", visibility: "public" }, out);
    upsertAnalysis(ds, { slug: "priv", visibility: "private" }, out);
    const pub = ds.entries("pub").find((e) => e.unit.name === "route")!;
    expect(pub.gemini!.context!.items.some((i) => i.includes("tierFor"))).toBe(true);
    expect(pub.gemini!.facts).toMatchObject({ usable: true, context_rounds: 2 });
    const privText = readFileSync(path.join(ds.dir, "projects", "priv", "entries.jsonl"), "utf8");
    const privRoute = privText.split("\n").find((l) => l.includes('"name":"route"'))!;
    expect(privRoute).not.toContain("tierFor");
    expect(privText).not.toContain('"context":{');
    expect(ds.entries("priv").find((e) => e.unit.name === "route")!.gemini!.facts).toMatchObject({ usable: true, context_rounds: 2 });
    expect(checkDataset(ds).errors).toEqual([]);
  });
});
