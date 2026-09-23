// The Jev-call finder (M5b layer B): deterministic, offline. It only answers "where is Jev used?".
// Fixtures reproduce patterns seen in the real 30-project corpus.
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Project } from "ts-morph";
import { findJevUsage } from "@jevx/analyzer";

function report(files: Record<string, string>) {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { allowJs: true, strict: true } });
  const root = "/virtual/app";
  const sfs = Object.entries(files).map(([f, c]) => project.createSourceFile(path.join(root, f), c));
  return findJevUsage({ root, files: sfs });
}
const site = (r: ReturnType<typeof report>, name: string) => [...r.sites, ...r.uncertain].find((s) => s.unit.name === name);

describe("Jev finder — definite (SDK)", () => {
  it("finds systemOne + choice/noul with question text, keys and outcomes", () => {
    const r = report({
      "src/triage.ts": `import { TypeSafeClient, choice, noul } from "@typesafe-ai/sdk";
const client = new TypeSafeClient();
export async function triage(ticket: string) {
  const res = await client.systemOne({
    state: { ticket },
    questions: {
      category: choice("What is this ticket about?", { billing: null, technical: null, other: null }),
      urgent: noul("The customer needs an answer today"),
    },
  });
  return res.answers.category.choice;
}`
    });
    const s = site(r, "triage")!;
    expect(s).toMatchObject({ tier: "definite", role: "decision" });
    expect(s.questions).toEqual([
      expect.objectContaining({ key: "category", primitive: "choice", text: "What is this ticket about?", outcomes: ["billing", "technical", "other"], how: "sdk_builder" }),
      expect.objectContaining({ key: "urgent", primitive: "noul", text: "The customer needs an answer today" })
    ]);
    expect(s.calls[0]).toMatchObject({ kind: "sdk_system_one", tier: "definite" });
    expect(r.stats.decisionSites).toBe(1);
  });

  it("follows aliases, namespace imports and the @typesafeai/sdk spelling", () => {
    const r = report({
      "src/a.ts": `import { choice as pick, TypeSafeClient as TS } from "@typesafeai/sdk";
export async function a(c: TS) { return c.systemOne({ state: "x", questions: { q: pick("Which?", { x: null }) } }); }`,
      "src/b.ts": `import * as jev from "@typesafe-ai/sdk";
export async function b(c: jev.TypeSafeClient) { return c.systemOne({ state: "x", questions: { ok: jev.noul("Is it fine?") } }); }`
    });
    expect(site(r, "a")).toMatchObject({ tier: "definite", role: "decision" });
    expect(site(r, "a")!.questions[0]).toMatchObject({ primitive: "choice", text: "Which?" });
    expect(site(r, "b")!.questions[0]).toMatchObject({ primitive: "noul", text: "Is it fine?" });
  });

  it("the Vercel AI SDK provider (@ai-sdk/typesafe-ai + experimental_evaluate) is definite", () => {
    const r = report({
      "src/model.ts": `import { experimental_evaluate } from "ai";
import { typeSafeAi } from "@ai-sdk/typesafe-ai";
const QUESTIONS = { direction: { type: "choice", instructions: { question: "Up or down?" }, criteria: { buy: "up", sell: "down" } } } as const;
export class JevModel {
  private model = typeSafeAi.evaluationModel("jev-latest");
  async decide(state: object) { return experimental_evaluate({ model: this.model, state, questions: QUESTIONS }); }
}`
    });
    const s = site(r, "JevModel.decide")!;
    expect(s).toMatchObject({ tier: "definite", role: "decision", questionSets: ["QUESTIONS"] });
    expect(s.questions[0]).toMatchObject({ key: "direction", primitive: "choice", text: "Up or down?", outcomes: ["buy", "sell"] });
  });

  it("a shadowed local noul() without the SDK is not definite; test files are excluded (fakes)", () => {
    const r = report({
      "src/util.ts": `const noul = (v: number) => ({ type: "noul", noul: v });
export function answer() { return noul(1); }`,
      "src/router.test.ts": `import { noul } from "@typesafe-ai/sdk";
const fake = { systemOne: async () => ({ answers: {} }) };
export async function t() { return fake.systemOne({ questions: { x: noul("?") } }); }`
    });
    expect(r.sites).toEqual([]);
    expect(r.excluded).toEqual([expect.objectContaining({ file: "src/router.test.ts" })]);
  });
});

describe("Jev finder — likely (HTTP) and verified wrappers", () => {
  // jev-guard's shape: raw fetch to the Jev API inside ask(); decisions pass module-level question sets
  const GUARD = {
    "src/jev.js": `const TYPESAFE_URL = "https://api.typesafe.ai/v1/systemone";
export async function ask(state, questions) {
  const res = await fetch(TYPESAFE_URL, { method: "POST", body: JSON.stringify({ state, model: "jev-latest", questions }) });
  return (await res.json()).answers;
}`,
    "src/guard.js": `import { ask } from "./jev.js";
const ACTION_QUESTIONS = {
  risk: { type: "score", instructions: "How destructive is this action?", legend: ["safe", "risky", "destructive"] },
  approval: { type: "noul", instructions: "Did the user approve this?" },
};
export async function assessAction(input) {
  const a = await ask({ input }, ACTION_QUESTIONS);
  return a.risk.score > 0.7 ? "deny" : "allow";
}`,
    "src/hook.js": `import { assessAction } from "./guard.js";
export async function handleHook(event) { return assessAction(event.input); }`
  };

  it("fetch(api.typesafe.ai) is likely; its caller with a question set is the decision (wrapper tier)", () => {
    const r = report(GUARD);
    expect(site(r, "ask")).toMatchObject({ tier: "likely", role: "plumbing" });
    const d = site(r, "assessAction")!;
    expect(d).toMatchObject({ tier: "wrapper", role: "decision", questionSets: ["ACTION_QUESTIONS"] });
    expect(d.questions.map((q) => `${q.primitive}:${q.key}`)).toEqual(["score:risk", "noul:approval"]);
    expect(d.questions[0]).toMatchObject({ text: "How destructive is this action?", scale: 3 });
    expect(d.calls[0]).toMatchObject({ kind: "wrapper_call", via: { name: "ask", file: "src/jev.js" } });
    // the wrapper walk stops at the decision: its callers are callers, not sites
    expect(site(r, "handleHook")).toBeUndefined();
    expect(d.callers).toEqual([expect.objectContaining({ file: "src/hook.js", name: "handleHook" })]);
  });

  it("questions built by a factory and asked through a provider wrapper → the asking function is the decision", () => {
    const r = report({
      "src/provider.ts": `import { TypeSafeClient } from "@typesafe-ai/sdk";
const client = new TypeSafeClient();
export async function askJev(state: unknown, questions: any) { return client.systemOne({ state, questions } as any); }`,
      "src/questions.ts": `import { choice, noul } from "@typesafe-ai/sdk";
export function stepQuestions(actions: Record<string, string>) {
  return { action: choice("Which action advances the task?", actions), done: noul("The goal is reached") };
}`,
      "src/navigate.ts": `import { askJev } from "./provider";
import { stepQuestions } from "./questions";
export async function navigate(page: string) { return askJev({ page }, stepQuestions({ click: "click", type: "type" })); }`
    });
    expect(site(r, "askJev")).toMatchObject({ role: "plumbing", tier: "definite" });
    expect(site(r, "stepQuestions")).toBeUndefined(); // folded into the decision that asks it
    const n = site(r, "navigate")!;
    expect(n).toMatchObject({ role: "decision", questionSets: ["stepQuestions"] });
    expect(n.questions.map((q) => q.key)).toEqual(["action", "done"]);
  });

  it("the project's own noul() helper + an /api/jev route count only when a server-side proxy calls Jev", () => {
    const client = {
      "src/questions.ts": `const noul = (instructions: string) => ({ type: "noul", instructions });
export function buildQuestions() { return { cheap: noul("The shopper wants the cheapest option") }; }`,
      "src/client.ts": `import { buildQuestions } from "./questions";
export async function rerank(query: string) {
  return fetch("/api/jev", { method: "POST", body: JSON.stringify({ state: { query }, questions: buildQuestions() }) });
}`
    };
    const without = report(client);
    expect(without.sites.filter((s) => s.role === "decision")).toEqual([]);
    const withProxy = report({ ...client, "server.mjs": `export async function handleJev(body) { return fetch("https://api.typesafe.ai/v1/systemone", { method: "POST", body }); }` });
    const d = site(withProxy, "rerank")!;
    expect(d).toMatchObject({ role: "decision", tier: "wrapper" });
    expect(d.questions[0]).toMatchObject({ primitive: "noul", key: "cheap", text: "The shopper wants the cheapest option" });
  });

  it("question sets are linked by symbol, never by name (no cross-file mix-ups)", () => {
    const r = report({
      "a/jev.ts": `import { TypeSafeClient, noul } from "@typesafe-ai/sdk";
const questions = { spam: noul("Is this spam?") };
export async function judgeA(c: TypeSafeClient) { return c.systemOne({ state: "x", questions }); }`,
      "b/jev.ts": `import { TypeSafeClient, choice } from "@typesafe-ai/sdk";
export async function judgeB(c: TypeSafeClient) { const questions = { tone: choice("Which tone?", { calm: null }) }; return c.systemOne({ state: "y", questions }); }`
    });
    expect(site(r, "judgeA")!.questions.map((q) => q.key)).toEqual(["spam"]);
    expect(site(r, "judgeB")!.questions.map((q) => q.key)).toEqual(["tone"]);
  });

  it("reports facts only: no label, score or 'should use Jev' field anywhere", () => {
    const r = report(GUARD);
    const keys = JSON.stringify(r);
    expect(keys).not.toMatch(/"(label|score_value|should|recommend|STRONG_JEV|NOT_JEV)"/);
    expect(r.version).toBe("u1");
  });
});
