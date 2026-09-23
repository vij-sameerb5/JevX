// Decision representation: turn facts + generator hits into a DecisionCandidate a human
// (or Jev) can judge — what is decided, from which inputs, into which outcomes, which Jev
// primitive would express it, and what must stay deterministic around it.
import type { Explanation, GeneratorHit, InputRef, OutcomeSet, Primitive } from "@jevx/core";
import { outcomeKind, type UnitFacts } from "./facts.js";

const MAX_OUTCOMES = 12;

export function outcomesOf(f: UnitFacts): OutcomeSet {
  const kind = outcomeKind(f);
  const literal = f.returns.filter((r) => ["string", "number", "boolean", "enum", "discriminant"].includes(r.kind)).map((r) => r.value);
  let values = [...new Set([...literal, ...f.assignedOutcomes])];
  if (kind === "action" || values.length === 0) {
    const effects = f.armSets.flatMap((a) => a.effects).filter((e) => e !== "∅" && e !== "if…");
    values = [...new Set(effects)];
  }
  return { kind, values: values.slice(0, MAX_OUTCOMES) };
}

/** Inputs the decision reads: decisive condition operands first, then parameters. */
export function inputsOf(f: UnitFacts): InputRef[] {
  const seen = new Map<string, InputRef>();
  for (const c of f.conditions) {
    if (c.shapes.every((s) => s === "trivial")) continue;
    for (const o of c.operands) if (!seen.has(o.name)) seen.set(o.name, o);
  }
  for (const a of f.armSets) if (a.discriminant && !seen.has(a.discriminant.name)) seen.set(a.discriminant.name, a.discriminant);
  for (const p of f.params) if (![...seen.keys()].some((k) => k === p.name || k.startsWith(p.name + ".") || k.startsWith(p.name + "["))) seen.set(p.name, p);
  return [...seen.values()].slice(0, 12);
}

export function suggestPrimitive(out: OutcomeSet, hits: GeneratorHit[]): { primitive: Primitive; why: string } {
  const ids = new Set(hits.map((h) => h.generator));
  if (ids.has("scorer") && (out.kind === "numeric" || out.kind === "unknown"))
    return { primitive: "score", why: "the code builds a graded number; Jev Score returns a calibrated level" };
  if (out.kind === "boolean") return { primitive: "noul", why: "a yes/no outcome; Jev Noul returns a calibrated probability" };
  if (out.values.length >= 2 && out.values.length <= 255 && (out.kind === "enumerated" || out.kind === "object" || out.kind === "action" || out.kind === "mixed"))
    return { primitive: "choice", why: `one of ${out.values.length} known outcomes; Jev Choice picks one with a confidence` };
  if (out.kind === "numeric" && out.values.length >= 2 && out.values.length <= 255 && !ids.has("scorer"))
    return { primitive: "choice", why: `one of ${out.values.length} discrete values; Jev Choice picks one with a confidence` };
  if (ids.has("scorer")) return { primitive: "score", why: "the decision is driven by an accumulated score" };
  if (ids.has("selector")) return { primitive: "choice", why: "selects one item; Jev Choice over the candidates (≤ 255)" };
  return { primitive: "none", why: "outcomes are not enumerable from the code" };
}

const fmtInput = (i: InputRef) => `${i.name} (${i.provenance}${i.type && i.type !== "any" ? `: ${i.type}` : ""})`;

export function explain(name: string, f: UnitFacts, hits: GeneratorHit[], inputs: InputRef[], out: OutcomeSet): Explanation {
  const { primitive, why } = suggestPrimitive(out, hits);
  const inText = inputs.length ? inputs.slice(0, 4).map(fmtInput).join(", ") + (inputs.length > 4 ? `, +${inputs.length - 4}` : "") : "no explicit inputs";
  const outText =
    out.values.length > 0 ? `${out.kind}: ${out.values.slice(0, 6).join(" | ")}${out.values.length > 6 ? ` | +${out.values.length - 6}` : ""}` : out.kind;
  const verb =
    out.kind === "boolean" ? "decides yes/no" : primitive === "score" ? "computes a level" : out.kind === "action" ? "chooses an action" : "chooses one outcome";
  const stays: string[] = [];
  const guards = f.conditions.filter((c) => c.shapes.every((s) => s === "trivial"));
  if (guards.length) stays.push(`${guards.length} input guard(s) (null / empty / type checks)`);
  if (f.throws) stays.push(`${f.throws} throw path(s) / error handling`);
  const exact = f.conditions.filter((c) => c.operands.some((o) => o.closedType));
  if (exact.length) stays.push(`${exact.length} check(s) on closed-type values (enum / union / boolean)`);
  const actions = [...new Set(f.armSets.flatMap((a) => a.effects).filter((e) => e.endsWith("()")))];
  if (actions.length) stays.push(`side effects after the decision: ${actions.slice(0, 4).join(", ")}`);
  if (f.awaits) stays.push(`${f.awaits} awaited call(s) (I/O stays in code)`);
  return {
    decision: `${name} ${verb} from ${inText}`,
    inputs: inText,
    outcomes: outText,
    suggestedPrimitive: primitive,
    primitiveWhy: why,
    staysDeterministic: stays
  };
}
