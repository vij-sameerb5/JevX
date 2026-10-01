import { describe, expect, it } from "vitest";
import { applyEditsInMemory, looseFind } from "../packages/engine/src/pipeline.js";

describe("edits tolerate small whitespace differences", () => {
  const file = "function a() {\n    if (/timeout/.test(m)) {\n      return 1;\n    }\n}\n";
  it("matches when the AI got indentation wrong", () => {
    const r = applyEditsInMemory(() => file, [{ file: "x.ts", find: "if (/timeout/.test(m)) {\n  return 1;\n}", replace: "if (await isTimeout(m)) {\n      return 1;\n    }" }]);
    expect("files" in r && r.files.get("x.ts")!.after).toBe("function a() {\n    if (await isTimeout(m)) {\n      return 1;\n    }\n}\n");
  });
  it("still refuses a missing or ambiguous match", () => {
    expect(looseFind(file, "return 2;")).toEqual({ error: "the text to replace was not found" });
    expect(looseFind("x\n}\ny\n}\n", "}")).toEqual({ error: "the text to replace occurs more than once" });
  });
  it("exact matches behave as before", () => {
    const r = applyEditsInMemory(() => file, [{ file: "x.ts", find: "return 1;", replace: "return 2;" }]);
    expect("files" in r && r.files.get("x.ts")!.after).toContain("return 2;");
  });
});
