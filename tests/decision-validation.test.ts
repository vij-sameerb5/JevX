import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Project } from "ts-morph";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import { analyzeProject } from "@jevx/analyzer";
import { DecisionCache, classifyAnswers, validateDecisions, DEFAULT_DECISION_POLICY } from "@jevx/typesafe";
import { mockFetch } from "./mock-typesafe.js";
import { FIXTURES } from "./analysis-fixtures.js";

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), "jevx-dv-"));
  dirs.push(d);
  return d;
};
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

async function analysis(files: Record<string, string>) {
  const project = new Project({ useInMemoryFileSystem: true });
  const root = "/virtual/app";
  return analyzeProject({ root, files: Object.entries(files).map(([f, c]) => project.createSourceFile(path.join(root, f), c)) });
}

const FILES = {
  "src/classify.ts": FIXTURES.classify,
  "src/secret.ts": FIXTURES.secret,
  "src/reject.ts": FIXTURES.switchMap.replace("nextStep", "nextStep /* MOCK_REJECT */"),
  "src/env.ts": FIXTURES.env // filtered by triage → must never be sent
};

describe("TypeSafe decision validation (Phase 1, opt-in)", () => {
  it("sends only unfiltered candidates, with minimal secret-scrubbed context, and classifies via the policy", async () => {
    const r = await analysis(FILES);
    expect(r.filtered.some((c) => c.unit.name === "mode")).toBe(true);
    const { fetch, calls } = mockFetch();
    const client = new TypeSafeClient({ apiKey: "test-key", baseURL: "http://mock.local", fetch });
    const out = await validateDecisions(r, { client, cache: new DecisionCache(tmp()) });

    expect(calls.length).toBe(r.candidates.length);
    const sent = calls.map((c) => JSON.stringify(c.body));
    expect(sent.join()).not.toContain("process.env");
    expect(sent.join()).not.toContain("sk-live-abcdefghijklmnopqrstuvwx");
    const state = calls[0]!.body!.state as unknown as Record<string, unknown>;
    expect(Object.keys(state).sort()).toEqual(["boundary_code", "boundary_lines", "decision_summary", "file", "function", "inputs", "language", "outcomes", "unit_code"]);

    const byName = new Map(out.candidates.map((c) => [c.unit.name, c]));
    expect(byName.get("classify")!.classification).toMatchObject({ label: "STRONG_JEV", source: "typesafe", policyVersion: "p0-uncalibrated" });
    expect(byName.get("nextStep")!.classification!.label).toBe("NOT_JEV");
    expect(out.semantic).toMatchObject({ apiCalls: calls.length, errors: 0, promptVersion: "d1" });
  });

  it("second run and offline replay come from the cache (0 calls)", async () => {
    const r = await analysis(FILES);
    const dir = tmp();
    const { fetch, calls } = mockFetch();
    const client = new TypeSafeClient({ apiKey: "test-key", baseURL: "http://mock.local", fetch });
    await validateDecisions(r, { client, cache: new DecisionCache(dir) });
    const n = calls.length;
    const again = await validateDecisions(r, { client, cache: new DecisionCache(dir) });
    expect(calls.length).toBe(n);
    expect(again.semantic!.cached).toBe(r.candidates.length);
    const offline = await validateDecisions(r, { client, cache: new DecisionCache(dir), offline: true });
    expect(offline.semantic!.apiCalls).toBe(0);
    expect(offline.candidates.every((c) => c.semantic?.cached)).toBe(true);
  });

  it("an auth failure stops further calls and leaves candidates unclassified", async () => {
    const r = await analysis(FILES);
    const { fetch, calls } = mockFetch();
    const client = new TypeSafeClient({ apiKey: "bad-key", baseURL: "http://mock.local", fetch, maxRetries: 0 } as never);
    const out = await validateDecisions(r, { client, cache: new DecisionCache(tmp()), concurrency: 1 });
    expect(calls.length).toBe(1);
    expect(out.semantic!.fatal).toMatch(/authentication/);
    expect(out.candidates.every((c) => !c.classification && c.semanticError)).toBe(true);
  });

  it("policy p0: deterministic-is-correct beats weak judgment; strong needs judgment + bounded + a primitive", () => {
    const base = { primitive: "choice" as const, primitiveConfidence: 0.8, category: "routing" as const, categoryConfidence: 0.8, promptVersion: "d1", cached: false };
    expect(classifyAnswers({ ...base, judgment: 0.3, bounded: 0.9, deterministicIsCorrect: 0.9 }).label).toBe("NOT_JEV");
    expect(classifyAnswers({ ...base, judgment: 0.8, bounded: 0.8, deterministicIsCorrect: 0.2 }).label).toBe("STRONG_JEV");
    expect(classifyAnswers({ ...base, judgment: 0.8, bounded: 0.3, deterministicIsCorrect: 0.2 }).label).toBe("POSSIBLE_JEV");
    expect(classifyAnswers({ ...base, primitive: "none", judgment: 0.9, bounded: 0.9, deterministicIsCorrect: 0.1 }).label).toBe("POSSIBLE_JEV");
    expect(DEFAULT_DECISION_POLICY.version).toBe("p0-uncalibrated");
  });
});
