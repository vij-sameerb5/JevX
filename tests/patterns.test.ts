// M5b Layer E — boundary patterns.
//   step 1 aggregate()      deterministic, offline: counts, record ids, contradictions. No API.
//   step 2 synthesis        optional, SMALL bounded batches that only reword what step 1 counted.
// The old design sent every record in one request and asked for an open-ended pattern list; the
// reply outran the timeout and the whole run was lost. These tests pin the replacement: batching,
// per-batch failure isolation, the model never supplying a number, and privacy.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { execa } from "execa";
import { GeminiCallError, createXaiTransport, type GeminiTransport } from "@jevx/gemini";
import {
  BoundaryStore,
  aggregate,
  derivePatterns,
  renderPatterns,
  type AnalysisRecord,
  type CallAccounting,
  type ContrastRecord,
  type FeatureLevel,
  type PatternRecord
} from "@jevx/boundary";
import { startMockXai } from "./mock-xai.js";

const KEY = "xai-test0123456789abcdef";
const ACC: CallAccounting = { calls: 1, rounds: 1, retries: 0, inputTokens: 100, outputTokens: 50, reasoningTokens: 10, cachedTokens: 0 };

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), "jevx-e-"));
  dirs.push(d);
  return d;
};
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

// ─── record builders (only the fields Layer E reads) ───

const FEATURES = [
  "semantic_ambiguity",
  "context_dependence",
  "deterministic_expressibility",
  "judgment_required",
  "rule_stability",
  "risk_or_policy_component",
  "natural_language_understanding",
  "decision_complexity"
] as const;

const levels = (v: FeatureLevel, over: Partial<Record<(typeof FEATURES)[number], FeatureLevel>> = {}) =>
  ({ ...Object.fromEntries(FEATURES.map((f) => [f, v])), ...over }) as Record<(typeof FEATURES)[number], FeatureLevel>;

function jev(project: string, site: string, over: Partial<AnalysisRecord["facts"]> = {}, opts: { private?: boolean; unknown?: string } = {}): AnalysisRecord {
  const facts: AnalysisRecord["facts"] = {
    nature: "semantic_judgment",
    features: levels("high", { deterministic_expressibility: "low", rule_stability: "low" }),
    why_jev_hypotheses: { semantic_interpretation: "supported", risk_assessment: "supported" },
    not_reasons: { large_function: "contradicted", many_branches: "contradicted" },
    confidence: "high",
    understanding_confidence: "high",
    observed_claims: 2,
    inferred_claims: 1,
    unknowns: 1,
    ...over
  };
  return {
    schema: 1,
    layer: "C_usage_analysis",
    kind: "model_generated_inference",
    project,
    visibility: opts.private ? "private" : "public",
    siteId: site,
    site: { file: `src/${site}.ts`, unit: { name: site, start: 10, end: 40 }, codeHash: "h" },
    analyst: { provider: "xai", model: "grok-4.6", promptVersion: "b1" },
    ...(opts.private
      ? {}
      : {
          analysis: {
            decision: { what_is_decided: "what the text means", inputs: [], outcomes: ["a", "b"], downstream_action: "acts", nature: "semantic_judgment" },
            jev_questions: [],
            features: Object.fromEntries(FEATURES.map((f) => [f, { level: "high", evidence: "" }])) as never,
            why_jev_hypotheses: [],
            not_reasons: [],
            why_jev: { observed: [], inferred: [], unknown: [opts.unknown ?? "whether the developer tried rules first"] },
            deterministic_alternative: { what_rules_would_need: "a keyword list", adequacy: "fragile" },
            confidence: "high",
            context_sufficient: true,
            missing_context: [],
            context_used: [],
            understanding_confidence: "high"
          }
        }),
    facts,
    context: { rounds: 1, chars: 100, stoppedBy: "sufficient" },
    usable: true,
    accounting: ACC,
    at: "2026-09-21T00:00:00.000Z"
  };
}

function det(project: string, site: string, id: string, over: Partial<ContrastRecord["facts"]> = {}): ContrastRecord {
  return {
    schema: 1,
    layer: "D_contrast",
    project,
    visibility: "public",
    siteId: site,
    contrast: { id, file: `src/${id}.ts`, unit: { name: id, start: 5, end: 20 }, codeHash: "h", generators: [], selection: "same_file" },
    analyst: { provider: "xai", model: "grok-4.6", promptVersion: "b1" },
    facts: {
      nature: "exact_rule",
      features: levels("none", { deterministic_expressibility: "high", rule_stability: "high", decision_complexity: "low" }),
      confidence: "high",
      understanding_confidence: "high",
      observed_claims: 1,
      inferred_claims: 1,
      unknowns: 0,
      is_a_real_decision: true,
      shares_jev_site_traits: "no",
      ...over
    },
    usable: true,
    accounting: ACC,
    at: "2026-09-21T00:00:00.000Z"
  };
}

/** Three projects, a clean separation, plus the records each test bends. */
const CLEAN = {
  analyses: [jev("app", "guard"), jev("router", "route"), jev("logs", "triage")],
  contrasts: [det("app", "guard", "aaaaaaaa1"), det("router", "route", "bbbbbbbb2"), det("logs", "triage", "cccccccc3")]
};

// ─── step 1: deterministic aggregation ───

describe("Layer E step 1 — aggregation (no API, no weights)", () => {
  it("counts both sides, names the records, and derives strength from spread alone", () => {
    const a = aggregate(CLEAN.analyses, CLEAN.contrasts);
    expect(a.source).toMatchObject({ analyses: 3, contrasts: 3, usableAnalyses: 3, realDecisionContrasts: 3 });
    const amb = a.groups.find((g) => g.id === "feature:semantic_ambiguity")!;
    expect(amb.side).toBe("separator");
    expect(amb.direction).toBe("separates");
    expect(amb.jev.top).toEqual({ value: "high", count: 3 });
    expect(amb.deterministic.top).toEqual({ value: "none", count: 3 });
    expect(amb.supportingIds).toEqual(["C:app:guard", "C:router:route", "C:logs:triage"]);
    expect(amb.contrastingIds).toHaveLength(3);
    expect(amb.projects).toEqual(["app", "logs", "router"]);
    expect(amb.strength).toBe("cross_project");
    expect(amb.confidence).toBe("high"); // 3 projects, both sides measured, nothing contradicting
    expect(amb.counterExamples).toEqual([]);
    // every id resolves to a file, so a reader never has to open the dataset
    expect(a.index["C:app:guard"]).toMatchObject({ layer: "C", project: "app", where: "src/guard.ts:10 guard" });
    // nothing that looks like a score
    expect(JSON.stringify(a)).not.toMatch(/weight|"score"|threshold/i);
  });

  it("evidence recorded on Jev sites only is marked as separating nothing", () => {
    const a = aggregate(CLEAN.analyses, []);
    const amb = a.groups.find((g) => g.id === "feature:semantic_ambiguity")!;
    expect(amb.direction).toBe("jev_side_only");
    expect(amb.side).toBe("jev");
    expect(amb.confidence).toBe("low"); // one side never measured, whatever the project count
    expect(amb.notes.join(" ")).toMatch(/Never measured on deterministic code/);
    const hyp = a.groups.find((g) => g.id === "why_jev:semantic_interpretation")!;
    expect(hyp.side).toBe("jev");
    expect(hyp.contrastingIds).toEqual([]);
    expect(hyp.notes.join(" ")).toMatch(/never assessed on the deterministic contrasts/);
  });

  it("a feature that is the same on both sides separates nothing", () => {
    const a = aggregate(CLEAN.analyses, [det("app", "guard", "same", { features: levels("high", { deterministic_expressibility: "low", rule_stability: "low" }) })]);
    const amb = a.groups.find((g) => g.id === "feature:semantic_ambiguity")!;
    expect(amb.direction).toBe("no_separation");
    expect(amb.side).toBe("jev");
    expect(amb.statement).toMatch(/does not separate them in this data/);
  });

  it("contradictory evidence lowers confidence, is named per record, and is flagged when one record contests many groups", () => {
    const rebel = det("odd", "x", "dddddddd4", {
      features: levels("high", { deterministic_expressibility: "low", rule_stability: "low", decision_complexity: "medium" }),
      nature: "semantic_judgment",
      shares_jev_site_traits: "yes"
    });
    const a = aggregate(CLEAN.analyses, [...CLEAN.contrasts, rebel]);
    const amb = a.groups.find((g) => g.id === "feature:semantic_ambiguity")!;
    expect(amb.direction).toBe("contested");
    expect(amb.contested).toBe(true);
    expect(amb.confidence).toBe("medium"); // one step down from high, not floored
    expect(amb.counterExamples[0]!.id).toBe("D:odd:x:dddddddd");
    expect(amb.counterExamples[0]!.why).toMatch(/deterministic code with semantic_ambiguity = high/);
    const nature = a.groups.find((g) => g.id === "nature:jev_vs_deterministic")!;
    expect(nature.counterExamples.map((c) => c.id)).toContain("D:odd:x:dddddddd");
    expect(nature.notes.join(" ")).toMatch(/share the Jev site's traits/);
    expect(a.notes.join("\n")).toMatch(/D:odd:x:dddddddd.*contradicts \d+ of the \d+ groups on its own/s);
  });

  it("a Jev site that disagrees with its own side is a counter-example too", () => {
    const odd = jev("plain", "lookup", { features: levels("none", { deterministic_expressibility: "high", rule_stability: "high", decision_complexity: "low" }), nature: "exact_rule" });
    const a = aggregate([...CLEAN.analyses, odd], CLEAN.contrasts);
    const amb = a.groups.find((g) => g.id === "feature:semantic_ambiguity")!;
    expect(amb.counterExamples.map((c) => c.id)).toEqual(["C:plain:lookup"]);
    expect(amb.counterExamples[0]!.why).toMatch(/Jev site with semantic_ambiguity = none/);
    expect(amb.supportingIds).not.toContain("C:plain:lookup");
  });

  it("not-reasons become rejected explanations, never patterns", () => {
    const a = aggregate(CLEAN.analyses, CLEAN.contrasts);
    expect(a.groups.map((g) => g.id)).not.toContain("not_reason:large_function");
    const r = a.rejected.find((x) => x.statement.includes("large function"))!;
    expect(r.why).toMatch(/Contradicted at 3 of 3 analyzed Jev sites/);
    expect(r.ids).toEqual(["C:app:guard", "C:router:route", "C:logs:triage"]);
    // supported more often than contradicted → not claimed as rejected
    const b = aggregate([jev("app", "guard", { not_reasons: { large_function: "supported" } })], []);
    expect(b.rejected).toEqual([]);
  });

  it("contrasts that are not decisions are excluded from the deterministic side and said so", () => {
    const a = aggregate(CLEAN.analyses, [...CLEAN.contrasts, det("app", "guard", "plumbing1", { is_a_real_decision: false, nature: "not_a_decision" })]);
    expect(a.source.contrasts).toBe(4);
    expect(a.source.realDecisionContrasts).toBe(3);
    expect(a.groups.find((g) => g.id === "feature:semantic_ambiguity")!.deterministic.ids).not.toContain("D:app:guard:plumbing");
    expect(a.notes.join("\n")).toMatch(/1 of 4 contrast\(s\) were judged not to be decisions/);
  });

  it("uniform levels and unusable records are reported rather than counted as findings", () => {
    const a = aggregate([jev("a", "1"), jev("b", "2"), jev("c", "3"), jev("d", "4"), jev("e", "5")], []);
    expect(a.groups.find((g) => g.id === "feature:semantic_ambiguity")!.notes.join(" ")).toMatch(/Uniform on the Jev side: all 5 records/);
    expect(a.groups.find((g) => g.id === "why_jev:semantic_interpretation")!.notes.join(" ")).toMatch(/may reflect the analyst's prior/);
    const b = aggregate([{ ...jev("a", "1"), usable: false }, jev("b", "2")], []);
    expect(b.source.usableAnalyses).toBe(1);
    expect(b.notes.join("\n")).toMatch(/1 analysis record\(s\) were marked unusable/);
  });

  it("private projects contribute levels only — no free text reaches Layer E", () => {
    const a = aggregate([jev("secret", "s1", {}, { private: true }), jev("open", "o1", {}, { unknown: "whether rules were tried" })], []);
    expect(a.notes.join("\n")).toMatch(/Private project\(s\) secret contribute levels and assessments only/);
    expect(a.unknowns).toEqual(["whether rules were tried"]);
    expect(a.groups.find((g) => g.id === "feature:semantic_ambiguity")!.jev.ids).toContain("C:secret:s1");
  });

  it("no records at all yields no groups and no invented findings", () => {
    const a = aggregate([], []);
    expect(a.groups).toEqual([]);
    expect(a.rejected).toEqual([]);
    expect(a.source).toMatchObject({ analyses: 0, contrasts: 0, usableAnalyses: 0, realDecisionContrasts: 0 });
  });
});

// ─── step 2: bounded synthesis ───

/** A transport whose replies (or failures) are scripted per call. Never touches the network. */
function fakeTransport(script: (call: number, prompt: string) => { text?: string; throws?: Error }): GeminiTransport & { calls: string[] } {
  const calls: string[] = [];
  return {
    model: "grok-4.6",
    calls,
    ping: async () => ({ model: "grok-4.6" }),
    generate: async (req: { prompt: string }) => {
      calls.push(req.prompt);
      const r = script(calls.length, req.prompt);
      if (r.throws) throw r.throws;
      return { text: r.text, inputTokens: 500, outputTokens: 200, reasoningTokens: 120, cachedTokens: 0, costUsd: 0.002, costSource: "calculated" as const };
    }
  } as GeminiTransport & { calls: string[] };
}

const answerFor = (prompt: string, over: (id: string, i: number) => Record<string, unknown> = () => ({})) =>
  JSON.stringify({
    groups: [...prompt.matchAll(/"group_id": "([^"]+)"/g)].map((m, i) => ({
      group_id: m[1]!,
      supported_by_the_counts: true,
      statement: `worded: ${m[1]}`,
      side: "separator",
      caveat: "small sample",
      ...over(m[1]!, i)
    })),
    open_questions: ["asked once"]
  });

describe("Layer E step 2 — bounded synthesis batches", () => {
  it("splits the groups into small batches and never sends more than maxBatches calls", async () => {
    const t = fakeTransport((_, p) => ({ text: answerFor(p) }));
    const r = await derivePatterns({ ...CLEAN, transport: t, analyst: { provider: "xai", model: "grok-4.6" }, batchSize: 3, maxBatches: 2, runId: "r1" });
    expect(t.calls).toHaveLength(2);
    expect(r.record.synthesis).toMatchObject({ batches: 2, failed: [] });
    // one statement per group, so a reply is bounded no matter how many groups exist
    for (const p of t.calls) expect([...p.matchAll(/"group_id"/g)]).toHaveLength(3);
    expect(r.record.accounting.calls).toBe(2);
    expect(r.record.accounting.costUsd).toBeCloseTo(0.004, 6);
    expect(r.record.accounting.costSource).toBe("calculated");
  });

  it("sends counts and ids, never source code or record free text", async () => {
    const t = fakeTransport((_, p) => ({ text: answerFor(p) }));
    await derivePatterns({ ...CLEAN, transport: t, analyst: { provider: "xai", model: "grok-4.6" }, maxBatches: 1, runId: "r1" });
    const p = t.calls[0]!;
    expect(p).toMatch(/"group_id": "feature:/);
    expect(p).toMatch(/"jev_side"/);
    expect(p).toMatch(/"deterministic_side"/);
    expect(p).not.toMatch(/whether the developer tried rules first/); // record free text
    expect(p).not.toMatch(/a keyword list/); // deterministic_alternative text
    expect(p).not.toMatch(/function |=> |const /); // no code
  });

  it("the model may reword a group but never supplies a count, an id, a project or a counter-example", async () => {
    const rebel = det("odd", "x", "dddddddd4", { features: levels("high", { deterministic_expressibility: "low" }), nature: "semantic_judgment" });
    const t = fakeTransport((_, p) =>
      // the model answers with its own ids, projects and a group that was never sent
      ({
        text: JSON.stringify({
          groups: [
            ...[...p.matchAll(/"group_id": "([^"]+)"/g)].map((m) => ({ group_id: m[1]!, supported_by_the_counts: true, statement: `worded: ${m[1]}`, side: "separator", caveat: "" })),
            { group_id: "feature:invented", supported_by_the_counts: true, statement: "never counted", side: "separator", caveat: "" }
          ],
          supporting: ["C:made:up"],
          projects: ["imaginary"],
          open_questions: []
        })
      })
    );
    const r = await derivePatterns({ analyses: CLEAN.analyses, contrasts: [...CLEAN.contrasts, rebel], transport: t, analyst: { provider: "xai", model: "grok-4.6" }, runId: "r1" });
    const amb = r.record.result.patterns.find((x) => x.groupId === "feature:semantic_ambiguity")!;
    expect(amb.statement).toBe("worded: feature:semantic_ambiguity");
    expect(amb.statementSource).toBe("model");
    expect(amb.evidence).toMatch(/Jev sites show semantic_ambiguity = high/); // the counts survive untouched
    expect(amb.supporting).toEqual(["C:app:guard", "C:router:route", "C:logs:triage"]);
    expect(amb.counter_examples).toEqual(["D:odd:x:dddddddd"]);
    expect(amb.projects).not.toContain("imaginary");
    expect(r.record.result.patterns.map((x) => x.groupId)).not.toContain("feature:invented");
    expect(JSON.stringify(r.record)).not.toContain("C:made:up");
  });

  it("evidence measured on one side only stays 'jev' even when the model calls it a separator", async () => {
    const t = fakeTransport((_, p) => ({ text: answerFor(p) })); // every side answered "separator"
    const r = await derivePatterns({ analyses: CLEAN.analyses, contrasts: [], transport: t, analyst: { provider: "xai", model: "grok-4.6" }, runId: "r1" });
    for (const p of r.record.result.patterns) expect(p.side).toBe("jev");
  });

  it("a group the model rejects keeps JevX's own wording, with the reason recorded", async () => {
    const t = fakeTransport((_, p) => ({ text: answerFor(p, (id, i) => (i === 0 ? { supported_by_the_counts: false, caveat: "one project dominates" } : {})) }));
    const r = await derivePatterns({ ...CLEAN, transport: t, analyst: { provider: "xai", model: "grok-4.6" }, batchSize: 2, maxBatches: 1, runId: "r1" });
    const rejected = r.record.result.patterns.find((p) => p.notes.some((n) => n.includes("does not think these counts")))!;
    expect(rejected.statementSource).toBe("aggregated");
    expect(rejected.statement).toMatch(/Jev sites show/);
    expect(rejected.notes.join(" ")).toMatch(/does not think these counts support a general statement: one project dominates/);
    // the other group in the same batch was still reworded
    expect(r.record.result.patterns.filter((p) => p.statementSource === "model")).toHaveLength(1);
  });

  it("a failed batch loses only its own wording; the counted patterns survive", async () => {
    const t = fakeTransport((n, p) => (n <= 3 ? { throws: new GeminiCallError("request timed out", 408) } : { text: answerFor(p) }));
    const r = await derivePatterns({ ...CLEAN, transport: t, analyst: { provider: "xai", model: "grok-4.6" }, batchSize: 4, maxBatches: 2, retries: 2, runId: "r1" });
    expect(r.errors[0]).toMatch(/batch 1 .*request timed out/);
    expect(r.record.synthesis!.failed).toHaveLength(1);
    expect(r.record.synthesis!.failed[0]!.groups.length).toBe(4);
    expect(r.record.accounting.retries).toBeGreaterThan(0);
    // batch 1's groups keep the counted wording, batch 2's are reworded
    const failed = r.record.result.patterns.filter((p) => r.record.synthesis!.failed[0]!.groups.includes(p.groupId));
    expect(failed.every((p) => p.statementSource === "aggregated")).toBe(true);
    expect(failed.every((p) => p.supporting.length > 0)).toBe(true);
    expect(r.record.result.patterns.some((p) => p.statementSource === "model")).toBe(true);
  });

  it("every batch failing still produces the full deterministic dataset", async () => {
    const t = fakeTransport(() => ({ throws: new GeminiCallError("request timed out", 408) }));
    const r = await derivePatterns({ ...CLEAN, transport: t, analyst: { provider: "xai", model: "grok-4.6" }, batchSize: 4, maxBatches: 2, retries: 0, runId: "r1" });
    expect(r.record.result.patterns.length).toBeGreaterThan(5);
    expect(r.record.result.patterns.every((p) => p.statementSource === "aggregated")).toBe(true);
    expect(r.record.result.rejected_explanations.length).toBeGreaterThan(0);
    expect(r.record.synthesis!.answered).toBe(0);
  });

  it("without a transport nothing is sent and the record carries no analyst", async () => {
    const r = await derivePatterns({ ...CLEAN, runId: "r1" });
    expect(r.record.analyst).toBeUndefined();
    expect(r.record.synthesis).toBeUndefined();
    expect(r.record.accounting.calls).toBe(0);
    expect(r.record.result.patterns.every((p) => p.statementSource === "aggregated")).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("separating evidence is asked about first, so a small --max-batches still covers what matters", async () => {
    const t = fakeTransport((_, p) => ({ text: answerFor(p) }));
    await derivePatterns({ ...CLEAN, transport: t, analyst: { provider: "xai", model: "grok-4.6" }, batchSize: 2, maxBatches: 1, runId: "r1" });
    const ids = [...t.calls[0]!.matchAll(/"group_id": "([^"]+)"/g)].map((m) => m[1]!);
    expect(ids.every((id) => id.startsWith("feature:") || id.startsWith("nature:"))).toBe(true);
    expect(ids.some((id) => id.startsWith("why_jev:"))).toBe(false);
  });
});

// ─── through the real xAI transport, against the mock API ───

describe("Layer E over the direct xAI transport (mocked API)", () => {
  let xai: Awaited<ReturnType<typeof startMockXai>>;
  beforeAll(async () => {
    xai = await startMockXai();
  });
  afterAll(async () => {
    await xai.close();
  });

  it("uses the e1 schema, records provider xai and a calculated cost, and never leaks the key", async () => {
    const t = createXaiTransport({ apiKey: KEY, baseURL: xai.url, model: "grok-4.6" }).transport!;
    const before = xai.calls.length;
    const r = await derivePatterns({ ...CLEAN, transport: t, analyst: { provider: "xai", model: "grok-4.6" }, batchSize: 4, maxBatches: 1, runId: "r1" });
    const posts = xai.calls.slice(before).filter((c) => c.method === "POST");
    expect(posts).toHaveLength(1);
    expect(posts[0]!.body?.text?.format?.name).toBeTruthy();
    expect(Object.keys(posts[0]!.body?.text?.format?.schema?.properties ?? {})).toEqual(["groups", "open_questions"]);
    expect(posts[0]!.rawBody).not.toContain(KEY);
    expect(r.record.analyst).toMatchObject({ provider: "xai", model: "grok-4.6", promptVersion: "e1" });
    expect(r.record.accounting.costSource).toBe("calculated");
    expect(r.record.result.patterns.some((p) => p.statementSource === "model")).toBe(true);
    expect(JSON.stringify(r.record)).not.toContain(KEY);
  });
});

// ─── outputs and CLI ───

describe("Layer E outputs", () => {
  it("patterns.json, PATTERNS.md and patterns.jsonl are written, and the md traces every claim", async () => {
    const ds = tmp();
    const store = new BoundaryStore(ds);
    const r = await derivePatterns({ ...CLEAN, excludedProjects: ["held-out"], runId: "r1", now: () => "2026-09-21T00:00:00.000Z" });
    const files = store.saveLayerE(r.record);
    const json = JSON.parse(readFileSync(files.json, "utf8")) as PatternRecord;
    expect(json.layer).toBe("E_patterns");
    expect(json.result.patterns.length).toBe(r.record.result.patterns.length);
    expect(store.patterns()).toHaveLength(1); // history line appended too
    const md = readFileSync(files.md, "utf8");
    expect(md).toMatch(/# JevX — Layer E/);
    expect(md).toMatch(/chose\*\* Jev there — not that Jev was objectively right/);
    expect(md).toMatch(/excluded \(TEST split\): held-out/);
    expect(md).toMatch(/aggregated only — no model was used/);
    // the eight things every pattern must carry
    expect(md).toMatch(/\*\*Category:\*\*/);
    expect(md).toMatch(/\*\*Counted from:\*\*/);
    expect(md).toMatch(/\*\*Projects supporting it:\*\* 3 \(app, logs, router\)/);
    expect(md).toMatch(/\*\*Supporting Jev usages \(3\):\*\*/);
    expect(md).toMatch(/\*\*Contrasting deterministic examples \(3\):\*\*/);
    expect(md).toMatch(/\*\*Counter-examples \/ conflicting evidence \(0\):\*\*\n {4}- none found in this data/);
    expect(md).toMatch(/\*\*Unknowns:\*\*/);
    expect(md).toMatch(/`C:app:guard` — src\/guard\.ts:10 guard _\(app\)_/); // ids resolve to files
    expect(md).toMatch(/Explanations this evidence does NOT support/);
    // it says there is no score or weight, and nowhere applies one
    expect(md).toMatch(/nothing here is a score, a weight or a threshold/);
    expect(md).not.toMatch(/"weight"|score_total|points|% likely/);
  });

  it("the store's privacy check covers Layer E, and private records contribute no free text", async () => {
    const ds = tmp();
    const store = new BoundaryStore(ds);
    const r = await derivePatterns({ analyses: [jev("secret", "s1", {}, { private: true }), jev("open", "o1")], contrasts: [det("open", "o1", "eeeeeeee5")], runId: "r1" });
    store.saveLayerE(r.record);
    expect(store.check()).toEqual([]);
    const md = readFileSync(path.join(ds, "boundary", "PATTERNS.md"), "utf8");
    expect(md).toMatch(/Private project\(s\) secret contribute levels and assessments only/);
    // a planted secret in a pattern is caught rather than shipped
    const bad = { ...r.record, result: { ...r.record.result, open_questions: ["use sk-live-abcdefghijklmnopqrstuvwx"] } };
    store.appendPatterns(bad);
    expect(store.check().join(" ")).toMatch(/contains an unredacted secret/);
  });

  it("renders a record with no groups without inventing anything", async () => {
    const r = await derivePatterns({ analyses: [], contrasts: [], runId: "r1" });
    const md = renderPatterns(r.record);
    expect(md).toMatch(/Evidence groups \| 0/);
    expect(md).not.toMatch(/What separates/);
  });
});

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(here, "../apps/cli/src/index.tsx");

describe("jevx boundary-patterns (CLI)", () => {
  it("--offline derives the patterns from the stored records with no key and no call", async () => {
    const ds = tmp();
    const store = new BoundaryStore(ds);
    store.saveRun("app", { usages: [], analyses: [jev("app", "guard")], contrasts: [det("app", "guard", "aaaaaaaa1")], run: { schema: 1, runId: "r0", project: "app", analyst: { provider: "xai", model: "grok-4.6", promptVersion: "b1" }, finder: "u1", usages: { found: 1, anchors: 1, analyzed: 1, cached: 0, failed: 0, skippedBudget: 0 }, contrasts: { selected: 1, analyzed: 1, failed: 0 }, accounting: ACC, errors: [], at: "2026-09-21T00:00:00.000Z" } });
    const r = await execa("npx", ["tsx", CLI, "boundary-patterns", "--offline", "--dataset", ds], { reject: false, env: { NO_COLOR: "1", XAI_API_KEY: "", JEVX_DATASET: "" } });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/Boundary patterns.*no model used/);
    expect(r.stdout).toMatch(/What separates them/);
    expect(r.stdout).toMatch(/Wrote .*patterns\.json and .*PATTERNS\.md/);
    expect(readFileSync(path.join(ds, "boundary", "PATTERNS.md"), "utf8")).toMatch(/Layer E/);
  });

  it("without --offline and without a key it fails clearly instead of falling back", async () => {
    const ds = tmp();
    new BoundaryStore(ds).saveLayerE((await derivePatterns({ ...CLEAN, runId: "seed" })).record);
    new BoundaryStore(ds).saveRun("app", { usages: [], analyses: [jev("app", "guard")], contrasts: [], run: { schema: 1, runId: "r0", project: "app", analyst: { provider: "xai", model: "grok-4.6", promptVersion: "b1" }, finder: "u1", usages: { found: 1, anchors: 1, analyzed: 1, cached: 0, failed: 0, skippedBudget: 0 }, contrasts: { selected: 0, analyzed: 0, failed: 0 }, accounting: ACC, errors: [], at: "2026-09-21T00:00:00.000Z" } });
    const r = await execa("npx", ["tsx", CLI, "boundary-patterns", "--dataset", ds], { reject: false, env: { NO_COLOR: "1", XAI_API_KEY: "", JEVX_DATASET: "" } });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/XAI_API_KEY is not set/);
  });

  it("with no stored analyses it says so instead of writing an empty finding", async () => {
    const r = await execa("npx", ["tsx", CLI, "boundary-patterns", "--offline", "--dataset", tmp()], { reject: false, env: { NO_COLOR: "1", XAI_API_KEY: "", JEVX_DATASET: "" } });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/no stored usage analyses yet/);
  });
});
