// Deterministic filtering. Rules out only what is structurally certain to be exact logic,
// always with a named hard-negative reason. Filtered candidates stay in the report and the
// dataset (humans can overturn them); they are just not sent for semantic validation.
import type { GeneratorHit, InputRef, Triage } from "@jevx/core";
import type { ConditionFact, UnitFacts } from "./facts.js";

const decisive = (f: UnitFacts) => f.conditions.filter((c) => c.shapes.some((s) => s !== "trivial"));
const operandsOf = (cs: ConditionFact[]): InputRef[] => cs.flatMap((c) => c.operands);

const FILE_LITERAL = /^(\.[a-z0-9]{1,6}|[a-z]+\/[a-z0-9.+*-]+)$/i; // ".png", "image/png", "application/*"

export function triage(f: UnitFacts, hits: GeneratorHit[]): Triage | undefined {
  const d = decisive(f);
  const ids = new Set(hits.map((h) => h.generator));

  if (f.comparatorShape) {
    return { verdict: "NOT_JEV", reason: "sorting_filtering", detail: "comparator: returns a numeric ordering of two items" };
  }

  if (d.length === 0 && !ids.has("scorer") && !ids.has("selector")) {
    return { verdict: "NOT_JEV", reason: "trivial_guard", detail: "every condition is a null / empty / type / existence guard" };
  }

  const ops = operandsOf(d);
  if (ops.length > 0 && ops.every((o) => o.provenance === "caught_error")) {
    return { verdict: "NOT_JEV", reason: "library_error_text", detail: "every decisive condition reads a caught error (machine-generated text)" };
  }
  if (ops.length > 0 && ops.every((o) => o.provenance === "env_config")) {
    return { verdict: "NOT_JEV", reason: "feature_flag", detail: "every decisive condition reads environment / config" };
  }

  // Dispatch over a closed type: the language already enumerates every value.
  const exactOnly = d.length > 0 && d.every((c) => c.shapes.every((s) => s === "exact_literal" || s === "trivial"));
  const discriminants = [...f.armSets.flatMap((a) => (a.discriminant ? [a.discriminant] : [])), ...ops];
  if (exactOnly && discriminants.length > 0 && discriminants.every((o) => o.closedType)) {
    return { verdict: "NOT_JEV", reason: "enum_dispatch", detail: "exact dispatch over a closed type (literal union / enum / boolean)" };
  }

  const charConds = d.filter((c) => c.charCompare);
  if (charConds.length >= 2 && charConds.length >= d.length / 2) {
    return { verdict: "NOT_JEV", reason: "parsing", detail: `${charConds.length} comparisons against single characters / char codes` };
  }

  // File types / MIME types: every literal compared is an extension or media type.
  const lits = d.flatMap((c) => c.stringLiterals);
  if (lits.length >= 2 && lits.every((l) => FILE_LITERAL.test(l))) {
    return { verdict: "NOT_JEV", reason: "file_type", detail: `compares against extensions / media types: ${lits.slice(0, 4).join(", ")}` };
  }

  // HTTP / protocol status codes: exact or range comparisons with integers 100–599 on `.status`-like members.
  const nums = d.flatMap((c) => c.numericLiterals);
  const statusOperand = ops.some((o) => /\.(status|statusCode)$/.test(o.name));
  if (nums.length >= 2 && statusOperand && nums.every((n) => Number.isInteger(n) && n >= 100 && n <= 599)) {
    return { verdict: "NOT_JEV", reason: "protocol_status", detail: `branches on status codes ${nums.slice(0, 5).join(", ")}` };
  }

  if (ops.length > 0 && ops.every((o) => o.provenance === "ui_event")) {
    return { verdict: "NOT_JEV", reason: "ui_plumbing", detail: "branches on keyboard / mouse / pointer event fields" };
  }

  // Pure calculation: numeric output, no decisive branching, just arithmetic.
  if (f.returns.length > 0 && f.returns.every((r) => r.kind === "number" || r.kind === "identifier" || r.kind === "other" || r.kind === "call") && d.length === 0 && f.arithmetic >= 2) {
    return { verdict: "NOT_JEV", reason: "arithmetic", detail: `${f.arithmetic} arithmetic operations, no decisive branching` };
  }

  // UI plumbing: renders JSX and branches only on flags / guards.
  const jsx = f.returns.filter((r) => r.kind === "jsx").length;
  if (jsx > 0 && d.every((c) => c.shapes.every((s) => s === "trivial" || s === "call")) && !ids.has("scorer") && !ids.has("text-match")) {
    return { verdict: "NOT_JEV", reason: "ui_plumbing", detail: "renders JSX, branching only on flags / guards / predicate calls" };
  }

  // Only guards and predicate calls: the judgment, if any, lives in the called function
  // (which is analyzed as its own unit).
  const literalOutcomes = new Set([...f.returns.filter((r) => ["string", "number", "enum", "discriminant"].includes(r.kind)).map((r) => r.value), ...f.assignedOutcomes]).size;
  if (d.every((c) => c.shapes.every((s) => s === "trivial" || s === "call")) && !ids.has("scorer") && !ids.has("selector") && !ids.has("text-match") && literalOutcomes < 2) {
    return { verdict: "NOT_JEV", reason: "trivial_guard", detail: "only guards and delegated predicate calls; any judgment lives in the called function" };
  }

  return undefined;
}
