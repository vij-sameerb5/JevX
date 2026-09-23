// Gemini output is untrusted: validate every field, clip sizes, scrub secrets, never throw.
import {
  DECISION_CATEGORIES,
  LABELS,
  PRIMITIVES,
  UNCERTAINTY,
  scrubSecrets,
  type DecisionCategory,
  type GeminiAnalysis,
  type Label,
  type Primitive,
  type Uncertainty
} from "@jevx/core";

export type ParseResult = { ok: true; analysis: GeminiAnalysis } | { ok: false; error: string };

const MAX_TEXT = 500;
const MAX_ITEMS = 12;

const clean = (s: string) => scrubSecrets(s.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT)).text;

function stripFences(text: string): string {
  const t = text.trim();
  const m = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return m ? m[1]! : t;
}

export function parseGeminiAnalysis(text: string | undefined | null): ParseResult {
  if (!text || !text.trim()) return { ok: false, error: "empty response" };
  let raw: unknown;
  try {
    raw = JSON.parse(stripFences(text));
  } catch {
    return { ok: false, error: "response is not valid JSON" };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "response is not a JSON object" };
  const o = raw as Record<string, unknown>;
  const problems: string[] = [];

  const str = (k: string): string => {
    const v = o[k];
    if (typeof v !== "string" || !v.trim()) {
      problems.push(`${k} must be a non-empty string`);
      return "";
    }
    return clean(v);
  };
  const bool = (k: string): boolean => {
    const v = o[k];
    if (typeof v !== "boolean") problems.push(`${k} must be a boolean`);
    return v === true;
  };
  const strList = (k: string): string[] => {
    const v = o[k];
    if (!Array.isArray(v)) {
      problems.push(`${k} must be an array`);
      return [];
    }
    return v.filter((x): x is string => typeof x === "string" && x.trim() !== "").slice(0, MAX_ITEMS).map(clean);
  };
  const oneOf = <T extends string>(k: string, xs: readonly T[]): T => {
    const v = o[k];
    if (typeof v !== "string" || !(xs as readonly string[]).includes(v)) {
      problems.push(`${k} must be one of ${xs.join(" | ")}`);
      return xs[0]!;
    }
    return v as T;
  };

  const inputsRaw = o.inputs;
  const inputs: GeminiAnalysis["inputs"] = [];
  if (!Array.isArray(inputsRaw)) problems.push("inputs must be an array");
  else
    for (const i of inputsRaw.slice(0, MAX_ITEMS)) {
      if (i && typeof i === "object" && typeof (i as { name?: unknown }).name === "string") {
        const r = i as { name: string; role?: unknown };
        inputs.push({ name: clean(r.name), role: typeof r.role === "string" ? clean(r.role) : "" });
      }
    }

  // Unknown category names are kept visible as "other" rather than dropping the whole answer.
  const dt = o.decision_type;
  let decisionType: GeminiAnalysis["decision_type"];
  if (typeof dt !== "string") {
    problems.push("decision_type must be a string");
    decisionType = "other";
  } else decisionType = dt === "not_a_decision" || dt in DECISION_CATEGORIES ? (dt as DecisionCategory | "not_a_decision") : "other";

  const jk = o.judgment_kind;
  const judgmentKind = typeof jk === "string" && jk.trim() ? clean(jk) : null;

  let hypothesis: GeminiAnalysis["model_hypothesis"] = null;
  const h = o.model_hypothesis;
  if (h && typeof h === "object" && (LABELS as readonly string[]).includes((h as { label?: string }).label ?? "")) {
    const note = (h as { note?: unknown }).note;
    hypothesis = { label: (h as { label: Label }).label, note: typeof note === "string" ? clean(note) : "" };
  }

  const missing: GeminiAnalysis["missing_context"] = [];
  if (!Array.isArray(o.missing_context)) problems.push("missing_context must be an array");
  else
    for (const m of o.missing_context.slice(0, MAX_ITEMS)) {
      if (m && typeof m === "object" && typeof (m as { request?: unknown }).request === "string") {
        const r = m as { request: string; why?: unknown };
        if (r.request.trim()) missing.push({ request: r.request.trim().slice(0, 300), why: typeof r.why === "string" ? clean(r.why) : "" });
      } else if (typeof m === "string" && m.trim()) missing.push({ request: m.trim().slice(0, 300), why: "" });
    }
  const used = Array.isArray(o.context_used) ? o.context_used.filter((x): x is string => typeof x === "string").slice(0, 50).map((x) => x.slice(0, 300)) : [];
  if (!Array.isArray(o.context_used)) problems.push("context_used must be an array");

  const analysis: GeminiAnalysis = {
    summary: str("summary"),
    decision: str("decision"),
    decision_boundary: str("decision_boundary"),
    inputs,
    outcomes: strList("outcomes"),
    decision_type: decisionType,
    deterministic_logic: bool("deterministic_logic"),
    approximates_judgment: bool("approximates_judgment"),
    judgment_kind: judgmentKind,
    plausible_primitive: oneOf<Primitive>("plausible_primitive", PRIMITIVES),
    stays_deterministic: strList("stays_deterministic"),
    reasoning: str("reasoning"),
    uncertainty: oneOf<Uncertainty>("uncertainty", UNCERTAINTY),
    context_sufficient: bool("context_sufficient"),
    missing_context: missing,
    context_used: used,
    understanding_confidence: oneOf<Uncertainty>("understanding_confidence", UNCERTAINTY),
    model_hypothesis: hypothesis
  };
  if (problems.length) return { ok: false, error: `malformed analysis: ${problems.slice(0, 4).join("; ")}` };
  return { ok: true, analysis };
}
