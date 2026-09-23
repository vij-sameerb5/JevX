// Candidate generators. Each one is an independent, structural proposer: it looks at the
// shape of a unit (outcomes, branches, selection, accumulation, gating, text handling) and
// says "this might be a decision boundary, here's why". None of them uses vocabulary lists.
// A unit becomes a candidate when at least one generator fires.
import type { GeneratorHit, GeneratorId } from "@jevx/core";
import type { ArmSet, ConditionFact, UnitFacts } from "./facts.js";

export type Generator = (f: UnitFacts, unit: { start: number; end: number }) => GeneratorHit | null;

const nonTrivial = (c: ConditionFact) => c.shapes.some((s) => s !== "trivial");
const list = (xs: string[], max = 6) => (xs.length > max ? [...xs.slice(0, max), `… +${xs.length - max}`] : xs).map((x) => JSON.stringify(x)).join(", ");
const span = (sets: { start: number; end: number }[]): [number, number] | undefined =>
  sets.length ? [Math.min(...sets.map((s) => s.start)), Math.max(...sets.map((s) => s.end))] : undefined;

/** The function returns one of a finite set of literal outcomes, chosen by conditions. */
export const outcomeSet: Generator = (f) => {
  const literals = [...new Set(f.returns.filter((r) => ["string", "number", "enum", "discriminant"].includes(r.kind)).map((r) => r.value))];
  const all = [...new Set([...literals, ...f.assignedOutcomes])];
  const decisive = f.conditions.filter(nonTrivial);
  if (all.length >= 2 && decisive.length >= 1) {
    const lines = f.returns.filter((r) => all.includes(r.value)).map((r) => r.line);
    return {
      generator: "outcome-set",
      evidence: [`returns one of ${all.length} outcomes: ${list(all)}`, `chosen by ${decisive.length} condition(s)`],
      region: lines.length ? [Math.min(...lines, ...decisive.map((c) => c.line)), Math.max(...lines)] : undefined
    };
  }
  // A predicate: returns a boolean decided by several independent checks.
  const bools = f.returns.filter((r) => r.kind === "boolean");
  const atoms = decisive.reduce((n, c) => n + c.atoms, 0);
  const onlyBooleanOut = f.returns.length > 0 && f.returns.every((r) => r.kind === "boolean" || r.kind === "call" || r.kind === "identifier" || r.kind === "other");
  if (bools.length >= 1 && onlyBooleanOut && atoms >= 2 && decisive.length >= 1) {
    return {
      generator: "outcome-set",
      evidence: [`boolean decision from ${atoms} checks`],
      region: [Math.min(...decisive.map((c) => c.line)), Math.max(...bools.map((b) => b.line))]
    };
  }
  return null;
};

/** A branch structure (if-chain, guard chain, switch, nested ternary) mapping state to ≥3 different effects. */
export const branchMap: Generator = (f) => {
  const maps = f.armSets.filter((a: ArmSet) => a.arms >= 3 && a.effects.length >= 3);
  if (maps.length === 0) return null;
  const best = maps.reduce((a, b) => (b.arms > a.arms ? b : a));
  return {
    generator: "branch-map",
    evidence: maps.slice(0, 3).map((m) => `${m.kind} with ${m.arms} arms (lines ${m.start}–${m.end}) → ${m.effects.length} distinct effects: ${list(m.effects, 4)}`),
    region: [best.start, best.end]
  };
};

/**
 * Picks the best item from a collection by comparing items (sort-then-take, reduce-best-of,
 * Math.max over candidates). Exact lookups (find by id, map[key]) are not selection judgments.
 */
export const selector: Generator = (f, unit) => {
  const judged = f.selectorOps.filter((op) => op.includes("reduce") || op.includes("sort") || op.includes("Math."));
  if (judged.length === 0) return null;
  return {
    generator: "selector",
    evidence: [`selects the best item via ${[...new Set(judged)].slice(0, 4).join(", ")}`],
    region: [unit.start, unit.end]
  };
};

/** Accumulates a numeric score from several conditions / weighted terms, often against a threshold. */
export const scorer: Generator = (f, unit) => {
  const thresholds = f.conditions.filter((c) => c.shapes.includes("relational") && c.numericLiterals.length > 0);
  if (f.conditionalAccumulations >= 2 || (f.weightedTerms >= 2 && (thresholds.length >= 1 || f.returns.some((r) => r.kind === "string" || r.kind === "boolean")))) {
    const ev = [];
    if (f.conditionalAccumulations >= 2) ev.push(`${f.conditionalAccumulations} conditional score updates (+= / -=)`);
    if (f.weightedTerms >= 2) ev.push(`${f.weightedTerms} weighted terms`);
    if (thresholds.length) ev.push(`compared to threshold(s): ${[...new Set(thresholds.flatMap((t) => t.numericLiterals))].slice(0, 5).join(", ")}`);
    return { generator: "scorer", evidence: ev, region: [unit.start, unit.end] };
  }
  return null;
};

/**
 * Gates an action: a compound or thresholded condition deciding between exiting / calling
 * different actions (approve vs reject, retry vs give up, escalate vs handle).
 */
export const gate: Generator = (f) => {
  const actionSets = f.armSets.filter((a) => a.effects.filter((e) => e.endsWith("()") || e === "throw" || e.startsWith("→")).length >= 2);
  const compound = f.conditions.filter((c) => nonTrivial(c) && (c.atoms >= 2 || c.shapes.includes("relational") || c.shapes.includes("call")));
  const hits = actionSets.filter((a) => compound.some((c) => c.line >= a.start && c.line <= a.end));
  if (hits.length === 0) return null;
  return {
    generator: "gate",
    evidence: hits.slice(0, 3).map((h) => `lines ${h.start}–${h.end}: ${h.effects.slice(0, 4).join(" | ")}`),
    region: span(hits)
  };
};

const openText = (o: { textual?: boolean; closedType?: boolean; type?: string }) =>
  o.textual === true || (!o.closedType && (o.type === undefined || o.type === "any" || o.type === "unknown"));

/** Branches on the content of an open text value (string methods, regex, equality with string literals). */
export const textMatch: Generator = (f) => {
  const textual = f.conditions.filter(
    (c) =>
      (c.shapes.includes("text_method") || c.shapes.includes("regex") || (c.shapes.includes("exact_literal") && c.stringLiterals.length > 0)) &&
      c.operands.some(openText)
  );
  const terms = [...new Set(textual.flatMap((c) => c.stringLiterals))];
  if (textual.length === 0 || (terms.length < 2 && !textual.some((c) => c.shapes.includes("regex")))) return null;
  return {
    generator: "text-match",
    evidence: [`${textual.length} condition(s) test open text against ${terms.length} literal(s)/pattern(s): ${list(terms, 5)}`],
    region: [Math.min(...textual.map((c) => c.line)), Math.max(...textual.map((c) => c.line))]
  };
};

export const GENERATORS: Record<GeneratorId, Generator> = {
  "outcome-set": outcomeSet,
  "branch-map": branchMap,
  selector,
  scorer,
  gate,
  "text-match": textMatch
};

export function runGenerators(f: UnitFacts, unit: { start: number; end: number }): GeneratorHit[] {
  const hits: GeneratorHit[] = [];
  for (const g of Object.values(GENERATORS)) {
    const h = g(f, unit);
    if (h) hits.push(h);
  }
  return hits;
}
