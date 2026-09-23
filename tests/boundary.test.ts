// M5b boundary pipeline: B (finder) → C "why Jev here?" → D "why deterministic there?" → E patterns.
// Through the real OpenRouter transport against a local mock — never the real API.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { execa } from "execa";
import { Project } from "ts-morph";
import { RepoIndex, analyzeProject, findJevUsage } from "@jevx/analyzer";
import { createOpenRouterTransport, type GeminiTransport } from "@jevx/gemini";
import {
  BOUNDARY_PROMPT_VERSION,
  BoundaryCache,
  BoundaryStore,
  derivePatterns,
  parseUsageAnalysis,
  pickAnchors,
  runBoundary,
  selectContrasts,
  importGraph,
  type BoundaryRunOptions
} from "@jevx/boundary";
import { Dataset, labelEntry, upsertAnalysis } from "@jevx/dataset";
import { GOOD_USAGE, startMockOpenRouter } from "./mock-openrouter.js";

const KEY = "sk-or-v1-test0123456789abcdef";

/** A small guard project: one Jev decision (via a raw-fetch wrapper) + deterministic neighbours. */
const REPO: Record<string, string> = {
  "package.json": `{"name":"mini-guard"}`,
  "src/jev.ts": `const TYPESAFE_URL = "https://api.typesafe.ai/v1/systemone";
export async function ask(state: unknown, questions: unknown) {
  const res = await fetch(TYPESAFE_URL, { method: "POST", headers: { Authorization: "Bearer " + process.env.JEV_API_KEY }, body: JSON.stringify({ state, questions }) });
  return (await res.json()).answers;
}
`,
  "src/guard.ts": `import { ask } from "./jev";
import { tierOf } from "./tiers";
const ACTION_QUESTIONS = {
  risk: { type: "score", instructions: "How destructive is this shell command?", legend: ["safe", "risky", "destructive"] },
  approval: { type: "noul", instructions: "Did the user explicitly approve this?" },
};
export async function assessAction(input: string) {
  const a = await ask({ input }, ACTION_QUESTIONS);
  if (a.risk.score > 0.7) return "deny";
  if (a.approval.noul > 0.5) return "allow";
  return "ask";
}
export function decide(score: number, limits: { deny: number; ask: number }) {
  if (score >= limits.deny) return "deny";
  if (score >= limits.ask) return "ask";
  return "allow";
}
export function routeFor(model: string) {
  const t = tierOf(model);
  if (t === "fast") return "cheap-pool";
  if (t === "smart") return "premium-pool";
  return "default-pool";
}
`,
  "src/tiers.ts": `export function tierOf(model: string) {
  if (/mini|nano|fast/.test(model)) return "fast";
  if (/pro|max|opus/.test(model)) return "smart";
  return "other";
}
`,
  "src/hook.ts": `import { assessAction } from "./guard";
export async function handleHook(event: { tool: string; input: string }) {
  if (event.tool !== "Bash") return null;
  return assessAction(event.input);
}
`
};

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), "jevx-bd-"));
  dirs.push(d);
  return d;
};
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

function writeRepo(files = REPO) {
  const root = tmp();
  for (const [f, c] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
    writeFileSync(path.join(root, f), c);
  }
  return root;
}

async function load(files = REPO) {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: true } });
  const root = "/virtual/guard";
  const sfs = Object.entries(files)
    .filter(([f]) => f.endsWith(".ts"))
    .map(([f, c]) => project.createSourceFile(path.join(root, f), c));
  const analysis = await analyzeProject({ root, files: sfs });
  const usage = findJevUsage({ root, files: sfs });
  return { root, sfs, analysis, usage, index: new RepoIndex(root, sfs) };
}

let or: Awaited<ReturnType<typeof startMockOpenRouter>>;
beforeAll(async () => {
  or = await startMockOpenRouter();
});
afterAll(async () => {
  await or.close();
});
const transport = (apiKey = KEY) => createOpenRouterTransport({ apiKey, baseURL: or.url, model: "x-ai/grok-4.6" }).transport!;
const posts = (since: number) => or.calls.slice(since).filter((c) => c.method === "POST");

async function run(extra: Partial<BoundaryRunOptions> = {}, files = REPO) {
  const l = await load(files);
  return runBoundary({
    project: "mini-guard",
    visibility: "public",
    root: l.root,
    files: l.sfs,
    analysis: l.analysis,
    usage: l.usage,
    context: l.index,
    transport: transport(),
    analyst: { provider: "openrouter", model: "x-ai/grok-4.6" },
    cache: new BoundaryCache(tmp()),
    now: () => "2026-09-20T00:00:00.000Z",
    ...extra
  });
}

describe("contrast selection (layer D, deterministic)", () => {
  it("nearest first, never the Jev site or its callers, never filtered noise, at most N", async () => {
    const l = await load();
    const [site] = pickAnchors(l.usage, 5);
    expect(site!.unit.name).toBe("assessAction");
    const picked = selectContrasts(site!, l.analysis.candidates, [...l.usage.sites, ...l.usage.uncertain], importGraph(l.root, l.sfs), { max: 3 });
    const names = picked.map((p) => `${p.selection}:${p.candidate.unit.name}`);
    // routeFor switches on a closed tierOf() result: triage filtered it (enum_dispatch) → never a contrast
    expect(l.analysis.filtered.map((c) => c.unit.name)).toContain("routeFor");
    expect(names).toEqual(["same_file:decide", "related_file:tierOf"]);
    expect(names.some((n) => n.endsWith("assessAction") || n.endsWith("handleHook"))).toBe(false);
    expect(picked.length).toBeLessThanOrEqual(3);
    expect(selectContrasts(site!, l.analysis.candidates, l.usage.sites, importGraph(l.root, l.sfs), { max: 1 })).toHaveLength(1);
  });

  it("bench / script code is never a contrast for a product-code Jev site (pilot dry-run regression)", async () => {
    const l = await load({ ...REPO, "src/bench.ts": `import { assessAction } from "./guard";\nexport function pick(n: number) { if (n > 10) return "large"; if (n > 3) return "medium"; return "small"; }\n` });
    const [site] = pickAnchors(l.usage, 5);
    const picked = selectContrasts(site!, l.analysis.candidates, l.usage.sites, importGraph(l.root, l.sfs), { max: 5 });
    expect(picked.map((p) => p.candidate.file)).not.toContain("src/bench.ts");
  });

  it("does not force contrasts: nothing nearby → none", async () => {
    const l = await load({ "src/jev.ts": REPO["src/jev.ts"]!, "src/only.ts": `import { ask } from "./jev";\nconst Q = { spam: { type: "noul", instructions: "Is it spam?" } };\nexport async function judge(t: string) { const a = await ask({ t }, Q); return a.spam.noul > 0.5; }\n` });
    const [site] = pickAnchors(l.usage, 5);
    expect(selectContrasts(site!, l.analysis.candidates, l.usage.sites, importGraph(l.root, l.sfs))).toEqual([]);
  });
});

describe("boundary run (B → C → D) through Grok-over-OpenRouter (mocked)", () => {
  it("analyzes the real Jev site, then its contrasts in ONE call; keeps observed / inferred / unknown apart", async () => {
    const before = or.calls.length;
    const r = await run();
    const ps = posts(before);
    expect(ps).toHaveLength(2); // one usage call + one contrast call
    expect(ps.every((p) => p.body!.model === "x-ai/grok-4.6")).toBe(true);
    expect(ps[0]!.promptText).toContain("OBSERVED JEV USAGE");
    expect(ps[0]!.promptText).toContain("How destructive is this shell command?");
    expect(ps[1]!.promptText).toContain("CONTRASTING DECISION-LIKE CODE WITHOUT JEV");
    expect(ps[1]!.promptText).toContain("PREVIOUS ANALYSIS OF THE JEV SITE (model inference, not fact)");

    expect(r.usages.find((u) => u.site.unit.name === "assessAction")).toMatchObject({ layer: "B_observed_usage", anchor: true });
    const [c] = r.analyses;
    expect(c).toMatchObject({ layer: "C_usage_analysis", kind: "model_generated_inference", analyst: { provider: "openrouter", model: "x-ai/grok-4.6", promptVersion: BOUNDARY_PROMPT_VERSION }, usable: true });
    expect(c!.analysis!.why_jev.observed[0]!.evidence[0]!.location).toBe("src/guard.ts:12");
    expect(c!.analysis!.why_jev.unknown).toEqual(["whether the developer tried regex rules first"]);
    expect(c!.facts).toMatchObject({ nature: "semantic_judgment", features: { semantic_ambiguity: "high", deterministic_expressibility: "low" }, why_jev_hypotheses: { risk_assessment: "supported" }, not_reasons: { many_branches: "contradicted" } });
    expect(r.contrasts.length).toBeGreaterThanOrEqual(2);
    expect(r.contrasts[0]).toMatchObject({ layer: "D_contrast", siteId: c!.siteId, facts: { nature: "exact_rule", shares_jev_site_traits: "no" } });
    expect(r.run.accounting).toMatchObject({ calls: 2, inputTokens: 1800, outputTokens: 320, reasoningTokens: 80 });
    expect(r.run.accounting.costUsd).toBeCloseTo(0.00552, 6);
    // no weights or scores anywhere in what is stored
    expect(JSON.stringify(r)).not.toMatch(/"weight"|"score_total"|"strong_candidate"/);
  });

  it("the prompt never carries secrets; the key only travels in the Authorization header", async () => {
    const before = or.calls.length;
    await run({}, { ...REPO, "src/tiers.ts": REPO["src/tiers.ts"]! + `export const token = "sk-live-abcdefghijklmnopqrstuvwx";\n` });
    for (const p of posts(before)) {
      expect(p.rawBody).not.toContain("sk-live-abcdefghijklmnopqrstuvwx");
      expect(p.rawBody).not.toContain(KEY);
      expect(p.auth).toBe(`Bearer ${KEY}`);
    }
  });

  it("cache: a second run makes no calls; offline replays; model or prompt change never reuses", async () => {
    const cacheDir = tmp();
    await run({ cache: new BoundaryCache(cacheDir) });
    const before = or.calls.length;
    const again = await run({ cache: new BoundaryCache(cacheDir) });
    expect(posts(before)).toHaveLength(0);
    expect(again.run.usages.cached).toBe(1);
    const offline = await run({ cache: new BoundaryCache(cacheDir), offline: true, transport: undefined });
    expect(offline.analyses).toHaveLength(1);
    const other = await run({ cache: new BoundaryCache(cacheDir), offline: true, transport: undefined, analyst: { provider: "openrouter", model: "other/model" } });
    expect(other.analyses).toHaveLength(0);
    expect(other.run.errors[0]).toMatch(/not in cache/);
  });

  it("token budget: stops BEFORE a call once spent; dry-run sends nothing", async () => {
    const before = or.calls.length;
    const dry = await run({ dryRun: true });
    expect(posts(before)).toHaveLength(0);
    expect(dry.plan.anchors.map((a) => a.unit.name)).toEqual(["assessAction"]);
    const r = await run({ budgetTokens: 500 });
    expect(r.run.usages.analyzed).toBe(1);
    expect(r.contrasts).toHaveLength(0); // the usage call spent 1,060 > 500: the contrast call is skipped
  });

  it("model unavailable (404) is fatal: the run stops instead of burning calls", async () => {
    const files = { ...REPO, "src/guard.ts": REPO["src/guard.ts"]!.replace("How destructive", "MOCK_OR_404 How destructive") };
    const before = or.calls.length;
    const r = await run({ retries: 2 }, files);
    expect(posts(before)).toHaveLength(1);
    expect(r.run.errors[0]).toMatch(/stopped: OpenRouter model unavailable \(HTTP 404\)/);
  });

  it("429 is retried with backoff, then succeeds or fails only that site", async () => {
    let n = 0;
    const flaky: GeminiTransport = {
      model: "m",
      async generate() {
        n++;
        if (n === 1) throw Object.assign(new Error("rate"), { status: 429 });
        return { text: JSON.stringify(GOOD_USAGE), inputTokens: 10, outputTokens: 5 };
      },
      async ping() {
        return { model: "m" };
      }
    };
    const { GeminiCallError } = await import("@jevx/gemini");
    const t: GeminiTransport = { ...flaky, generate: async (req) => flaky.generate(req).catch((e: Error & { status?: number }) => Promise.reject(new GeminiCallError("rate limited", e.status))) };
    const r = await run({ transport: t, maxContrasts: 0, retries: 2 });
    expect(r.run.usages.analyzed).toBe(1);
    expect(r.run.accounting.retries).toBe(1);
  });

  it("an interim 'need more context' answer expands context through the shared adaptive loop", async () => {
    let round = 0;
    const t: GeminiTransport = {
      model: "m",
      async generate(req) {
        round++;
        const ans = round === 1 ? { ...GOOD_USAGE, context_sufficient: false, understanding_confidence: "low", missing_context: [{ request: "ask", why: "what does ask() send?" }] } : GOOD_USAGE;
        if (round === 2) expect(req.prompt).toContain("TYPESAFE_URL");
        return { text: JSON.stringify(ans), inputTokens: 10, outputTokens: 5 };
      },
      async ping() {
        return { model: "m" };
      }
    };
    const r = await run({ transport: t, maxContrasts: 0 });
    expect(r.analyses[0]!.context.rounds).toBe(2);
    expect(r.analyses[0]!.usable).toBe(true);
  });

  it("rejects shallow or malformed answers (never cached)", () => {
    expect(parseUsageAnalysis("not json").ok).toBe(false);
    const empty = { ...GOOD_USAGE, why_jev: { observed: [], inferred: [], unknown: [] } };
    expect(parseUsageAnalysis(JSON.stringify(empty))).toMatchObject({ ok: false, error: expect.stringMatching(/no observed or inferred/) });
    const secret = { ...GOOD_USAGE, deterministic_alternative: { what_rules_would_need: "use key sk-live-abcdefghijklmnopqrstuvwx", adequacy: "x" } };
    const p = parseUsageAnalysis(JSON.stringify(secret));
    expect(p.ok && p.analysis.deterministic_alternative.what_rules_would_need).not.toContain("sk-live-abcdefghijklmnopqrstuvwx");
  });
});

describe("storage, privacy and patterns (layers kept apart)", () => {
  it("B/C/D go to separate files; private projects keep facts only; the P1 candidate dataset is untouched", async () => {
    const ds = tmp();
    const dataset = new Dataset(ds);
    const l = await load();
    upsertAnalysis(dataset, { slug: "mini-guard", visibility: "public" }, l.analysis);
    const id = dataset.entries("mini-guard").find((e) => e.unit.name === "decide")!.id;
    labelEntry(dataset, "mini-guard", id, { label: "NOT_JEV", reasoning: "exact thresholds", labeller: "sameer" });
    const before = readFileSync(path.join(ds, "projects", "mini-guard", "entries.jsonl"), "utf8");

    const store = new BoundaryStore(ds);
    store.saveRun("mini-guard", await run());
    store.saveRun("secret-app", await run({ project: "secret-app", visibility: "private" }));
    expect(readFileSync(path.join(ds, "projects", "mini-guard", "entries.jsonl"), "utf8")).toBe(before); // human label kept, file unchanged
    expect(store.analyses("mini-guard")[0]!.analysis).toBeDefined();
    const priv = readFileSync(path.join(ds, "boundary", "secret-app", "analyses.jsonl"), "utf8") + readFileSync(path.join(ds, "boundary", "secret-app", "contrasts.jsonl"), "utf8") + readFileSync(path.join(ds, "boundary", "secret-app", "usages.jsonl"), "utf8");
    expect(priv).not.toContain("How destructive");
    expect(priv).not.toContain(GOOD_USAGE.why_jev.inferred[0]!.claim);
    expect(priv).toContain('"semantic_ambiguity":"high"');
    expect(store.check()).toEqual([]);
    // a leak is caught
    const leaked = store.analyses("secret-app").map((a) => ({ ...a, analysis: GOOD_USAGE }));
    writeFileSync(path.join(ds, "boundary", "secret-app", "analyses.jsonl"), leaked.map((x) => JSON.stringify(x)).join("\n") + "\n");
    expect(store.check().join()).toMatch(/PRIVATE analysis holds model free text/);
    // re-running merges instead of duplicating; runs are appended
    store.saveRun("mini-guard", await run());
    expect(store.analyses("mini-guard")).toHaveLength(1);
    expect(store.runs("mini-guard")).toHaveLength(2);
  });

  // Layer E's own behaviour (batching, failure isolation, outputs) is covered in tests/patterns.test.ts.
  // Here: it runs on a real run's stored records, over a real provider transport, and sends no code.
  it("patterns (E) are derived from this run's records, cite them, and no code is sent", async () => {
    const r = await run();
    const before = or.calls.length;
    const p = await derivePatterns({
      analyses: r.analyses,
      contrasts: r.contrasts,
      transport: transport(),
      analyst: { provider: "openrouter", model: "x-ai/grok-4.6" },
      batchSize: 4,
      maxBatches: 1,
      runId: "t1"
    });
    const sent = posts(before)[0]!.promptText;
    expect(sent).not.toContain("function assessAction");
    expect(sent).toMatch(/"group_id": "feature:/);
    expect(p.record.layer).toBe("E_patterns");
    expect(p.record.analyst).toMatchObject({ provider: "openrouter", promptVersion: "e1" });
    const amb = p.record.result.patterns.find((x) => x.groupId === "feature:semantic_ambiguity")!;
    expect(amb.supporting).toEqual([`C:mini-guard:${r.analyses[0]!.siteId}`]);
    expect(amb.contrasting.length).toBeGreaterThan(0);
    expect(p.record.index[amb.supporting[0]!]!.where).toMatch(/src\/guard\.ts:\d+ assessAction/);
    expect(p.record.result.rejected_explanations.map((x) => x.statement).join(" ")).toMatch(/large function/);
  });
});

// ─── CLI ──────────────────────────────────────────────────────────────────

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(here, "../apps/cli/src/index.tsx");
const cli = (args: string[], env: Record<string, string> = {}) =>
  execa("npx", ["tsx", CLI, ...args], { reject: false, env: { NO_COLOR: "1", OPENROUTER_API_KEY: "", OPENROUTER_BASE_URL: "", OPENROUTER_MODEL: "", JEVX_DATASET: "", ...env } });

describe("jevx jev-usages / boundary (CLI)", () => {
  it("jev-usages lists the observed Jev site offline, as facts", async () => {
    const root = writeRepo();
    const r = await cli(["jev-usages", root]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/src\/guard\.ts:\d+ assessAction +wrapper · decision +2 question\(s\) score:risk, noul:approval/);
    expect(r.stdout).toMatch(/observed, not ground truth/);
  });

  // The default analyst is direct xAI now (tests/xai.test.ts); this covers the OpenRouter provider,
  // which stays selectable behind the same interface.
  it("boundary --code-analyst openrouter: dry-run sends nothing, a real run saves B/C/D with tokens and cost", async () => {
    const root = writeRepo();
    const ds = tmp();
    const dry = await cli(["boundary", root, "--dry-run", "--dataset", ds]);
    expect(dry.exitCode).toBe(0);
    expect(dry.stdout).toMatch(/◆ src\/guard\.ts:\d+ assessAction/);
    expect(dry.stdout).toMatch(/◇ contrast \(same_file\)/);
    const before = or.calls.length;
    const r = await cli(["boundary", root, "--public", "--project", "mini-guard", "--dataset", ds, "--code-analyst", "openrouter"], { OPENROUTER_API_KEY: KEY, OPENROUTER_BASE_URL: or.url });
    expect(r.exitCode).toBe(0);
    expect(posts(before).length).toBe(2);
    expect(r.stderr).toMatch(/OpenRouter \(x-ai\/grok-4\.6\)/);
    expect(r.stdout).toMatch(/Usage mini-guard: 1\/1 Jev site\(s\) analyzed/);
    expect(r.stdout).toMatch(/2 call\(s\).*1,800 in \+ 320 out tokens.*\$0\.0055/);
    expect(r.stdout).toMatch(/observed/);
    expect(r.stdout).toMatch(/unknown +whether the developer tried regex rules first/);
    expect(r.stdout + r.stderr).not.toContain(KEY);
    expect(new BoundaryStore(ds).analyses("mini-guard")).toHaveLength(1);
    const missing = await cli(["boundary", root, "--public", "--dataset", ds, "--code-analyst", "openrouter"]);
    expect(missing.exitCode).toBe(1);
    expect(missing.stderr).toMatch(/OPENROUTER_API_KEY is not set/);
  });
});

// ─── pnpm corpus (project-list parsing) ───────────────────────────────────

const CORPUS_SCRIPT = path.resolve(here, "../scripts/corpus.ts");
/** Runs `pnpm corpus …` against an empty corpus dir, so every project reports "not fetched". */
const corpus = (args: string[]) =>
  execa("npx", ["tsx", CORPUS_SCRIPT, ...args], {
    reject: false,
    env: { NO_COLOR: "1", JEVX_CORPUS: tmp(), JEVX_DATASET: tmp(), OPENROUTER_API_KEY: "", XAI_API_KEY: "" }
  });

describe("corpus boundary project list", () => {
  it("accepts one quoted whitespace-separated list as several projects, and ignores a stray shell comment", async () => {
    const r = await corpus(["boundary", "jev-guard jev-router jevlogs", "--max-usages", "2", "--dry-run", "#", "plan", "only,", "sends", "nothing"]);
    expect(r.exitCode).toBe(0);
    expect(r.stderr).not.toMatch(/unknown project/);
    for (const slug of ["jev-guard", "jev-router", "jevlogs"]) expect(r.stdout).toContain(`${slug}: not fetched (pnpm corpus fetch ${slug})`);
  });

  it("accepts the same list as separate arguments, and collapses duplicates", async () => {
    const r = await corpus(["boundary", "jev-guard", "jev-router", "jev-guard", "--dry-run"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.match(/jev-guard: not fetched/g)).toHaveLength(1);
    expect(r.stdout).toContain("jev-router: not fetched");
  });

  it("names the analyzable projects when a slug is unknown", async () => {
    const r = await corpus(["boundary", "jev-guard nope", "--dry-run"]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/unknown project "nope" — analyzable projects: .*jev-guard/);
  });
});

describe("pilot report (stored records only)", () => {
  it("writes a report before any run exists, instead of failing on the missing directory", async () => {
    const { writeReport } = await import("../scripts/boundary-report.js");
    const ds = tmp();
    const file = writeReport(ds);
    expect(file).toBe(path.join(ds, "boundary", "PILOT-REPORT.md"));
    expect(readFileSync(file, "utf8")).toMatch(/No stored records yet/);
  });

  it("counts exactly from runs and records; no API call", async () => {
    const { buildReport } = await import("../scripts/boundary-report.js");
    const ds = tmp();
    const store = new BoundaryStore(ds);
    store.saveRun("mini-guard", await run());
    const before = or.calls.length;
    const md = buildReport(ds);
    expect(or.calls.length).toBe(before);
    expect(md).toMatch(/\| Jev usages analyzed \| 1 \(0 failed\) \|/);
    expect(md).toMatch(/\| Input \/ output tokens \(reasoning\) \| 1,800 \/ 320 \(80\) \|/);
    expect(md).toMatch(/\| Cost \(provider-reported\) \| \$0\.0055 \|/);
    expect(md).toMatch(/openrouter · x-ai\/grok-4\.6/);
    expect(md).toMatch(/unknown: whether the developer tried regex rules first/);
    expect(md).toMatch(/◇ contrast `src\/guard\.ts:\d+` decide \(same_file\) · exact_rule/);
    expect(md).not.toMatch(/weight|score_total/);
  });
});
