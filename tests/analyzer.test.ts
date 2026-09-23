import { describe, expect, it } from "vitest";
import { Project, ts } from "ts-morph";
import { analyzeFile, fileRole } from "@jevx/analyzer";
import type { DecisionCandidate } from "@jevx/core";
import { FIXTURES } from "./analysis-fixtures.js";

function analyze(code: string, file = "src/x.ts") {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: true, target: ts.ScriptTarget.ES2022, lib: ["lib.es2022.d.ts", "lib.dom.d.ts"] } });
  const sf = project.createSourceFile(file, code);
  return analyzeFile(sf, file).candidates;
}
const one = (code: string, name?: string): DecisionCandidate => {
  const cs = analyze(code);
  const c = name ? cs.find((x) => x.unit.name === name) : cs[0];
  if (!c) throw new Error(`no candidate${name ? ` ${name}` : ""}; got ${cs.map((x) => x.unit.name).join(", ")}`);
  return c;
};
const gens = (c: DecisionCandidate) => c.generators.map((g) => g.generator).sort();

describe("analyzer: generators (structural)", () => {
  it("outcome-set + branch-map + text-match on a text classifier", () => {
    const c = one(FIXTURES.classify);
    expect(gens(c)).toEqual(expect.arrayContaining(["outcome-set", "text-match"]));
    expect(c.triage).toBeUndefined();
    expect(c.outputs).toEqual({ kind: "enumerated", values: ["refund", "billing", "other"] });
    expect(c.explanation.suggestedPrimitive).toBe("choice");
    expect(c.inputs[0]).toMatchObject({ provenance: "parameter", textual: true });
  });

  it("is vocabulary-independent: same structure with other words → same generators and features", () => {
    const a = one(FIXTURES.classify);
    const b = one(FIXTURES.classifyRenamed);
    expect(gens(b)).toEqual(gens(a));
    expect({ ...b.features, lines: 0 }).toEqual({ ...a.features, lines: 0 });
  });

  it("branch-map on a switch mapping state to ≥3 outcomes", () => {
    const c = one(FIXTURES.switchMap);
    expect(gens(c)).toContain("branch-map");
    expect(c.outputs.values).toEqual(["triage", "escalate", "remind", "close"]);
  });

  it("scorer on conditional accumulation → Score primitive", () => {
    const c = one(FIXTURES.scorer);
    expect(gens(c)).toContain("scorer");
    expect(c.explanation.suggestedPrimitive).toBe("score");
  });

  it("selector on sort()[0]", () => {
    expect(gens(one(FIXTURES.selector))).toContain("selector");
  });

  it("gate on a compound condition choosing between actions", () => {
    const c = one(FIXTURES.gate);
    expect(gens(c)).toContain("gate");
    expect(c.explanation.staysDeterministic.join(" ")).toContain("reject()");
  });

  it("nested functions are separate units (no double counting)", () => {
    const cs = analyze(FIXTURES.nested);
    expect(cs.map((c) => c.unit.name)).toEqual(["inner"]);
  });

  it("request provenance is traced through locals", () => {
    const c = one(FIXTURES.request);
    expect(c.inputs.some((i) => i.provenance === "request_input")).toBe(true);
  });
});

describe("analyzer: deterministic filtering (hard negatives with a reason)", () => {
  const reasonOf = (code: string) => one(code).triage?.reason;
  it("dispatch over a closed union type → enum_dispatch", () => expect(reasonOf(FIXTURES.enumDispatch)).toBe("enum_dispatch"));
  it("caught error text → library_error_text", () => expect(reasonOf(FIXTURES.caughtError)).toBe("library_error_text"));
  it("single-character comparisons → parsing", () => expect(reasonOf(FIXTURES.lexer)).toBe("parsing"));
  it("environment switches → feature_flag", () => expect(reasonOf(FIXTURES.env)).toBe("feature_flag"));
  it("keyboard event fields → ui_plumbing", () => expect(reasonOf(FIXTURES.keyEvent)).toBe("ui_plumbing"));
  it("comparators → sorting_filtering", () => expect(reasonOf(FIXTURES.comparator)).toBe("sorting_filtering"));
  it("guards only → not a candidate at all", () => expect(analyze(FIXTURES.guardsOnly).filter((c) => !c.triage)).toEqual([]));
});

describe("analyzer: identity and hashes", () => {
  it("id is stable across code edits; code hash changes", () => {
    const a = one(FIXTURES.classify);
    const b = one(FIXTURES.classify.replace('"billing"', '"invoices"'));
    expect(b.id).toBe(a.id);
    expect(b.hashes.code).not.toBe(a.hashes.code);
  });

  it("file roles: tests / stories / configs / generated are not source", () => {
    expect(fileRole("src/a.test.ts")).toBe("test");
    expect(fileRole("src/__tests__/a.ts")).toBe("test");
    expect(fileRole("src/a.stories.tsx")).toBe("story");
    expect(fileRole("vite.config.ts")).toBe("config");
    expect(fileRole("src/types.d.ts")).toBe("types");
    expect(fileRole("src/lib/route.ts")).toBe("source");
  });
});
