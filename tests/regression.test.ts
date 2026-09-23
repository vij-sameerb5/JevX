import { beforeAll, describe, expect, it } from "vitest";
import { evaluate, formatReport, type EvalReport } from "./harness.js";

/**
 * The detector regression suite. Every labelled case in regression/legacy-v1/ is a test, and the
 * aggregate precision/recall is printed so rubric changes can be compared run to run.
 */
let report: EvalReport;

beforeAll(async () => {
  report = await evaluate();
  console.log("\n" + formatReport(report) + "\n");
});

describe("detector regression (regression/legacy-v1/)", () => {
  it("every labelled case passes", () => {
    const failures = report.cases.filter((c) => !c.pass).map((c) => `${c.kind} ${c.repo}/${c.label.file} ${c.label.context}() → ${c.candidate?.score ?? "none"}`);
    expect(failures).toEqual([]);
  });

  it("nothing unlabelled is flagged", () => {
    expect(report.unlabelled.map((u) => `${u.repo}/${u.candidate.file}:${u.candidate.line}`)).toEqual([]);
  });

  it("meets the M2 bar: precision and recall both ≥ 90%", () => {
    expect(report.precision).toBeGreaterThanOrEqual(0.9);
    expect(report.recall).toBeGreaterThanOrEqual(0.9);
  });
});
