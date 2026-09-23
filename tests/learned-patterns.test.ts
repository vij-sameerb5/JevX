// Task A: the generic pattern of each finding, scrubbed in code, learned back into the scorecard.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { blendPatterns, genericize, learnedScore, namesIn, parseAssessment, parsePattern } from "@jevx/engine";
import { exportPatterns } from "../scripts/export-patterns.js";

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

const CHECKOUT = `} catch (e: unknown) {
  // decide what to tell the user
  const msg = e instanceof Error ? e.message : "Payment failed.";
  if (/User rejected|denied/i.test(msg)) setError("You cancelled — nothing was charged.");
  else if (/insufficient|balance/i.test(msg)) setError(ARC ? "Not enough USDC in your GlobalCare wallet." : "Not enough test ETH.");
}`;

describe("scrubbing names out of generic text (in code, not trusting the AI)", () => {
  const names = namesIn("app/checkout/page.tsx", "secretFunctionName", CHECKOUT);
  it("finds identifiers, file names and specific literals — not plain words", () => {
    expect(names).toEqual(expect.arrayContaining(["secretFunctionName", "checkout", "page.tsx", "setError", "ARC", "Payment failed.", "GlobalCare"]));
    expect(names).not.toContain("error");
    expect(names).not.toContain("decide"); // comments are ignored
  });
  it("removes them, and any path, while keeping the generic sentence readable", () => {
    const t = genericize("secretFunctionName in app/checkout/page.tsx: catch block → regex on error message → setError with GlobalCare wallet copy", names, 200)!;
    for (const leak of ["secretFunctionName", "app/checkout", "page.tsx", "setError", "GlobalCare"]) expect(t).not.toContain(leak);
    expect(t).toMatch(/catch block → regex on error message/);
  });
});

describe("pattern parsing", () => {
  it("clamps unknown kinds to other and slugifies the label", () => {
    expect(parsePattern({ label: "Error Message / Regex Classifier!", input_kind: "emails", rule_kind: "regex", rule_shape: "x", why_generic: "y", failure_example: "" })).toEqual({ label: "error-message-regex-classifier", input_kind: "other", rule_kind: "regex", rule_shape: "x", why_generic: "y", failure_example: "" });
    expect(parsePattern({ label: "" })).toBeUndefined();
  });
  it("assessments carry it", () => {
    const r = parseAssessment(JSON.stringify({ is_opportunity: true, primitive: "choice", ai_score: 0.7, features: {}, pattern: { label: "free-text-lookup-with-default", input_kind: "ai_output", rule_kind: "lookup_with_default", rule_shape: "s", why_generic: "w", failure_example: "f" } }));
    expect(r.ok && r.analysis.pattern?.rule_kind).toBe("lookup_with_default");
  });
});

describe("learned patterns", () => {
  const rows = [
    { pattern_label: "error-message-regex-classifier", input_kind: "error_message", rule_kind: "regex", primitive: "choice", findings: 9, good: 6, bad: 2, rejected: 1 },
    { pattern_label: "api-results-top-n-slice", input_kind: "external_api_results", rule_kind: "sort_or_slice", primitive: "score", findings: 3, good: 1, bad: 1, rejected: 1 }
  ];
  it("uses the exact label with ≥ 5 labelled outcomes, else input+rule kind, else nothing", () => {
    expect(learnedScore({ label: "error-message-regex-classifier", input_kind: "error_message", rule_kind: "regex" }, rows).score).toBeCloseTo(0.75);
    expect(learnedScore({ label: "new-one", input_kind: "error_message", rule_kind: "regex" }, rows).score).toBeCloseTo(0.75);
    expect(learnedScore({ label: "api-results-top-n-slice", input_kind: "external_api_results", rule_kind: "sort_or_slice" }, rows).score).toBeUndefined();
    expect(learnedScore(undefined, rows).score).toBeUndefined();
  });
  it("blends 50/50 with the feature profile", () => {
    expect(blendPatterns(0.5, 0.9)).toBeCloseTo(0.7);
    expect(blendPatterns(0.5, undefined)).toBe(0.5);
  });
  it("export-patterns reads the view with the service key and writes the shipped file", async () => {
    const d = mkdtempSync(path.join(tmpdir(), "jevx-pat-"));
    dirs.push(d);
    let auth = "";
    const fetch = (async (_u: string, init?: RequestInit) => {
      auth = String((init?.headers as Record<string, string>).apikey);
      return new Response(JSON.stringify(rows), { status: 200 });
    }) as typeof globalThis.fetch;
    const out = path.join(d, "learned.json");
    const r = await exportPatterns({ url: "https://abc.supabase.co", key: "service-test", out, fetch });
    expect(r).toMatchObject({ patterns: 2, labelled: 10 });
    expect(auth).toBe("service-test");
    const file = JSON.parse(readFileSync(out, "utf8"));
    expect(file.patterns[0].pattern_label).toBe("error-message-regex-classifier");
    expect(JSON.stringify(file)).not.toContain("service-test");
  });
});
