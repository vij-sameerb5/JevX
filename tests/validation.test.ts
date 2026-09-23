import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import { mergeDetectorOptions, type DetectionResult } from "@jevx/core";
import { scanProject } from "@jevx/scanner";
import { detect } from "@jevx/detector";
import { DEFAULT_POLICY, PROMPT_VERSION, ValidationCache, applyValidation, decide, validateResult } from "@jevx/typesafe";
import { mockFetch } from "./mock-typesafe.js";

const ROUTER = (name: string, marker = "") => `
export function ${name}(message: string) {
  const text = message.toLowerCase().trim();
  if (text.includes("refund") || text.includes("money back")) {
    ${marker}
    return "refund";
  } else if (text.includes("invoice") || text.includes("charged twice")) {
    return "billing";
  } else if (text.includes("help") || text.includes("not working")) {
    return "support";
  }
  return "other";
}
`;

const FILES: Record<string, string> = {
  "semantic.ts": ROUTER("routeMessage"),
  "rejected.ts": ROUTER("looksSemanticButIsNot", "// MOCK_REJECT"),
  "failing.ts": ROUTER("routeFlaky", "// MOCK_FAIL"),
  // below the minimum: one includes on human text, no label → AST 25
  "weak.ts": `export function greet(message: string) { if (message.includes("hello")) return 1; return 0; }\n`
};

const opts = mergeDetectorOptions();
let root: string;

async function detectAll(): Promise<DetectionResult> {
  const scanned = await scanProject({ root, include: ["**/*.ts"], exclude: [] });
  return detect(scanned.files, root, opts);
}

function client(apiKey = "test-key") {
  const mock = mockFetch();
  const c = new TypeSafeClient({ apiKey, baseURL: "https://api.typesafe.test", fetch: mock.fetch, retry: { maxRetries: 0 } });
  return { client: c, calls: mock.calls };
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "jevx-m3-"));
  for (const [f, src] of Object.entries(FILES)) writeFileSync(path.join(root, f), src);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("TypeSafe validation (mocked)", () => {
  it("turns confirmed candidates into final confidence and keeps the AST score", async () => {
    const { client: c } = client();
    const res = await validateResult(await detectAll(), { client: c, cache: new ValidationCache(root), thresholds: opts.thresholds, concurrency: 1 });
    const hit = res.raw.find((x) => x.context === "routeMessage")!;
    expect(hit.validation?.status).toBe("confirmed");
    expect(hit.confidence).toBe(93);
    expect(hit.band).toBe("veryStrong");
    expect(hit.score).toBeGreaterThanOrEqual(50); // preliminary preserved
    expect(hit.validation?.kind).toBe("intent_or_topic");
    expect(res.candidates[0]?.context).toBe("routeMessage"); // ranked by final confidence
  });

  it("hides candidates TypeSafe rejects", async () => {
    const { client: c } = client();
    const res = await validateResult(await detectAll(), { client: c, cache: new ValidationCache(root), thresholds: opts.thresholds });
    const rej = res.raw.find((x) => x.context === "looksSemanticButIsNot")!;
    expect(rej.validation?.status).toBe("rejected");
    expect(rej.band).toBe("ignore");
    expect(res.candidates.map((x) => x.context)).not.toContain("looksSemanticButIsNot");
    expect(res.validation?.rejected).toBe(1);
  });

  it("only sends the ≥ minimum band, unless all is set", async () => {
    const a = client();
    await validateResult(await detectAll(), { client: a.client, cache: new ValidationCache(root, false), thresholds: opts.thresholds });
    expect(a.calls.map((x) => x.body?.state.function)).not.toContain("greet");
    expect(a.calls).toHaveLength(3);

    const b = client();
    await validateResult(await detectAll(), { client: b.client, cache: new ValidationCache(root, false), thresholds: opts.thresholds, all: true });
    expect(b.calls.map((x) => x.body?.state.function)).toContain("greet");
  });

  it("sends a small, well-formed request and never the key in the body", async () => {
    const { client: c, calls } = client();
    await validateResult(await detectAll(), { client: c, cache: new ValidationCache(root, false), thresholds: opts.thresholds, concurrency: 1 });
    const call = calls.find((x) => x.body?.state.function === "routeMessage")!;
    expect(call.method).toBe("POST");
    expect(call.path).toBe("/v1/systemone");
    expect(call.authorization).toBe("Bearer test-key");
    expect(Object.fromEntries(Object.entries(call.body!.questions).map(([k, q]) => [k, q.type]))).toEqual({
      semantic: "noul",
      humanText: "noul",
      kind: "choice"
    });
    expect(call.body!.state.file).toBe("semantic.ts");
    expect(call.body!.state.decision_code).toContain('text.includes("refund")');
    // v2: the enclosing function travels with the decision, so the model sees where `text` comes from
    expect(call.body!.state.enclosing_function).toContain("export function routeMessage(message: string)");
    expect(call.body!.state.enclosing_function).toContain("const text = message.toLowerCase().trim();");
    expect(call.body!.state.decision_lines).toMatch(/^\d+-\d+$/);
    expect(call.body!.state.matched_terms).toEqual(expect.arrayContaining(["refund", "money back"]));
    expect(JSON.stringify(call.body)).not.toContain("test-key");
  });

  it("caches by file hash + candidate hash: unchanged code costs no second call", async () => {
    const first = client();
    await validateResult(await detectAll(), { client: first.client, cache: new ValidationCache(root), thresholds: opts.thresholds });
    expect(first.calls.length).toBe(3);
    expect(existsSync(path.join(root, ".jevx", "cache", "typesafe.json"))).toBe(true);

    const second = client();
    const res = await validateResult(await detectAll(), { client: second.client, cache: new ValidationCache(root), thresholds: opts.thresholds });
    // the failing candidate is never cached, so it is retried; the other two come from cache
    expect(second.calls.length).toBe(1);
    expect(res.validation?.cached).toBe(2);
    expect(res.raw.find((x) => x.context === "routeMessage")?.validation?.cached).toBe(true);

    // editing the file changes its hash → revalidated
    writeFileSync(path.join(root, "semantic.ts"), FILES["semantic.ts"] + "\n// edited\n");
    const third = client();
    await validateResult(await detectAll(), { client: third.client, cache: new ValidationCache(root), thresholds: opts.thresholds });
    expect(third.calls.map((x) => x.body?.state.function).sort()).toEqual(["routeFlaky", "routeMessage"]);

    // a disabled cache ignores stored results
    const fourth = client();
    await validateResult(await detectAll(), { client: fourth.client, cache: new ValidationCache(root, false), thresholds: opts.thresholds });
    expect(fourth.calls.length).toBe(3);
  });

  it("isolates a failing call: that candidate keeps its preliminary score", async () => {
    const { client: c } = client();
    const res = await validateResult(await detectAll(), { client: c, cache: new ValidationCache(root), thresholds: opts.thresholds });
    const flaky = res.raw.find((x) => x.context === "routeFlaky")!;
    expect(flaky.validation?.status).toBe("error");
    expect(flaky.confidence).toBeUndefined();
    expect(flaky.band).not.toBe("ignore");
    expect(res.validation?.errors).toBe(1);
    expect(res.validation?.confirmed).toBe(1);
  });

  it("stops calling after an authentication failure", async () => {
    const { client: c, calls } = client("bad-key");
    const res = await validateResult(await detectAll(), { client: c, cache: new ValidationCache(root), thresholds: opts.thresholds, concurrency: 1 });
    expect(calls).toHaveLength(1);
    expect(res.validation?.fatal).toMatch(/authentication failed/);
    expect(res.validation?.errors).toBe(3);
    expect(res.raw.every((x) => x.confidence === undefined)).toBe(true);
  });

  it("puts the prompt version and model into the cache key", () => {
    const c = { fileHash: "f", id: "c" } as Parameters<typeof ValidationCache.key>[0];
    expect(ValidationCache.key(c, PROMPT_VERSION, "jev-latest")).not.toBe(ValidationCache.key(c, "v999", "jev-latest"));
    expect(ValidationCache.key(c, PROMPT_VERSION, "jev-latest")).not.toBe(ValidationCache.key(c, PROMPT_VERSION, "jev-preview"));
  });

  describe("decision policy (humanText advisory, semantic + kind decide)", () => {
    const base = { semantic: 0.8, humanText: 0.9, kind: "intent_or_topic" as const, kindConfidence: 0.95 };

    it("confirms on semantic ≥ 0.5 even when humanText is low (advisory only)", () => {
      const d = decide({ ...base, humanText: 0.05 });
      expect(d.status).toBe("confirmed");
      expect(d.advisories?.[0]).toMatch(/low human-text/);
    });

    it("confirms a borderline semantic when a semantic kind is confident", () => {
      expect(decide({ ...base, semantic: 0.43, kindConfidence: 0.84 }).status).toBe("confirmed");
      expect(decide({ ...base, semantic: 0.43, kindConfidence: 0.6 }).status).toBe("rejected");
      expect(decide({ ...base, semantic: 0.35, kindConfidence: 0.99 }).status).toBe("rejected");
    });

    it("rejects when TypeSafe is confident it is not semantic, even with a high semantic score", () => {
      expect(decide({ ...base, kind: "not_semantic", kindConfidence: 0.9 }).status).toBe("rejected");
      expect(decide({ ...base, kind: "not_semantic", kindConfidence: 0.5 }).status).toBe("confirmed");
    });

    it("floors kind-assisted confirmations at the minimum so they are shown", () => {
      const c = { band: "possible", score: 55 } as Parameters<typeof applyValidation>[0];
      const v = { ...base, semantic: 0.43, kindConfidence: 0.84, ...decide({ ...base, semantic: 0.43, kindConfidence: 0.84 }), promptVersion: PROMPT_VERSION, cached: false };
      const out = applyValidation(c, v, opts.thresholds);
      expect(out.confidence).toBe(opts.thresholds.minimum);
      expect(out.band).toBe("possible");
    });

    it("re-decides cached answers with the current policy (tuning costs no API calls)", async () => {
      const first = client();
      await validateResult(await detectAll(), { client: first.client, cache: new ValidationCache(root), thresholds: opts.thresholds });
      const strict = client();
      const res = await validateResult(await detectAll(), {
        client: strict.client,
        cache: new ValidationCache(root),
        thresholds: opts.thresholds,
        policy: { ...DEFAULT_POLICY, semanticMin: 0.95, kindAssistMin: 2 },
        offline: true
      });
      expect(strict.calls).toHaveLength(0);
      expect(res.raw.find((x) => x.context === "routeMessage")?.validation?.status).toBe("rejected");
      expect(res.raw.find((x) => x.context === "routeFlaky")?.validation?.error).toMatch(/offline/);
    });
  });
});
