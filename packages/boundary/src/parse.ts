// Model output is untrusted: validate every field, clip sizes, scrub secrets, never throw.
import { scrubSecrets } from "@jevx/core";
import type { AdaptiveParse } from "@jevx/gemini";
import {
  ASSESSMENTS,
  BOUNDARY_FEATURES,
  CONFIDENCE,
  DECISION_NATURE,
  FEATURE_LEVELS,
  NOT_REASONS,
  WHY_JEV_HYPOTHESES,
  type Claim,
  type ContrastAnalysis,
  type ContrastItemAnalysis,
  type DecisionUnderstanding,
  type Explanation,
  type FeatureMap,
  type SynthesisAnswer,
  type UsageAnalysis
} from "./schema.js";

const MAX_TEXT = 600;
const MAX_ITEMS = 16;
type O = Record<string, unknown>;

const clean = (s: string) => scrubSecrets(s.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT)).text;
const isObj = (v: unknown): v is O => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v.slice(0, MAX_ITEMS) : []);
const text = (v: unknown, fallback = ""): string => (typeof v === "string" && v.trim() ? clean(v) : fallback);
const oneOf = <T extends string>(v: unknown, xs: readonly T[], fallback: T): T => (typeof v === "string" && (xs as readonly string[]).includes(v) ? (v as T) : fallback);

export function jsonOf(raw: string | undefined | null): O | string {
  if (!raw || !raw.trim()) return "empty response";
  const t = raw.trim();
  const fenced = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  let body = fenced ? fenced[1]! : t;
  // tolerate a sentence before / after the object
  if (!body.startsWith("{")) {
    const a = body.indexOf("{");
    const b = body.lastIndexOf("}");
    if (a >= 0 && b > a) body = body.slice(a, b + 1);
  }
  try {
    const v = JSON.parse(body);
    return isObj(v) ? v : "response is not a JSON object";
  } catch {
    return "response is not valid JSON";
  }
}

const claims = (v: unknown): Claim[] =>
  list(v)
    .filter(isObj)
    .map((c) => ({
      claim: text(c.claim),
      evidence: list(c.evidence)
        .filter(isObj)
        .map((e) => ({ location: text(e.location).slice(0, 200), observation: text(e.observation) }))
        .filter((e) => e.location || e.observation)
    }))
    .filter((c) => c.claim);

function explanation(v: unknown, problems: string[], name: string): Explanation {
  if (!isObj(v)) {
    problems.push(`${name} must be an object with observed / inferred / unknown`);
    return { observed: [], inferred: [], unknown: [] };
  }
  return { observed: claims(v.observed), inferred: claims(v.inferred), unknown: list(v.unknown).map((x) => text(x)).filter(Boolean) };
}

function decision(v: unknown, problems: string[]): DecisionUnderstanding {
  if (!isObj(v)) problems.push("decision must be an object");
  const d = isObj(v) ? v : {};
  const what = text(d.what_is_decided);
  if (!what) problems.push("decision.what_is_decided is required");
  return {
    what_is_decided: what,
    inputs: list(d.inputs)
      .filter(isObj)
      .map((i) => ({ name: text(i.name).slice(0, 120), source: text(i.source), role: text(i.role) }))
      .filter((i) => i.name),
    outcomes: list(d.outcomes).map((x) => text(x)).filter(Boolean),
    downstream_action: text(d.downstream_action),
    nature: oneOf(d.nature, DECISION_NATURE, "unclear")
  };
}

function features(v: unknown, problems: string[]): FeatureMap {
  if (!isObj(v)) problems.push("features must be an object");
  const f = isObj(v) ? v : {};
  return Object.fromEntries(
    BOUNDARY_FEATURES.map((k) => {
      const e = isObj(f[k]) ? (f[k] as O) : {};
      return [k, { level: oneOf(e.level, FEATURE_LEVELS, "unknown"), evidence: text(e.evidence) }];
    })
  ) as FeatureMap;
}

function adaptive(o: O) {
  const missing = list(o.missing_context)
    .map((m) => (isObj(m) ? { request: text(m.request).slice(0, 300), why: text(m.why) } : typeof m === "string" ? { request: m.trim().slice(0, 300), why: "" } : undefined))
    .filter((m): m is { request: string; why: string } => Boolean(m?.request));
  return {
    context_sufficient: o.context_sufficient === true,
    missing_context: missing,
    context_used: list(o.context_used)
      .filter((x): x is string => typeof x === "string")
      .map((x) => x.slice(0, 300)),
    understanding_confidence: oneOf(o.understanding_confidence, CONFIDENCE, "low")
  };
}

export function parseUsageAnalysis(raw: string | undefined): AdaptiveParse<UsageAnalysis> {
  const o = jsonOf(raw);
  if (typeof o === "string") return { ok: false, error: o };
  const problems: string[] = [];
  const hyp = list(o.why_jev_hypotheses)
    .filter(isObj)
    .filter((h) => (WHY_JEV_HYPOTHESES as readonly string[]).includes(String(h.id)))
    .map((h) => ({ id: h.id as UsageAnalysis["why_jev_hypotheses"][number]["id"], assessment: oneOf(h.assessment, ASSESSMENTS, "not_determinable"), evidence: text(h.evidence) }));
  const nr = list(o.not_reasons)
    .filter(isObj)
    .filter((h) => (NOT_REASONS as readonly string[]).includes(String(h.id)))
    .map((h) => ({ id: h.id as UsageAnalysis["not_reasons"][number]["id"], assessment: oneOf(h.assessment, ASSESSMENTS, "not_determinable"), note: text(h.note) }));
  const alt = isObj(o.deterministic_alternative) ? o.deterministic_alternative : {};
  const analysis: UsageAnalysis = {
    decision: decision(o.decision, problems),
    jev_questions: list(o.jev_questions)
      .filter(isObj)
      .map((q) => ({ key: text(q.key).slice(0, 120), primitive: text(q.primitive).slice(0, 20), what_it_asks: text(q.what_it_asks) })),
    features: features(o.features, problems),
    why_jev_hypotheses: hyp,
    not_reasons: nr,
    why_jev: explanation(o.why_jev, problems, "why_jev"),
    deterministic_alternative: { what_rules_would_need: text(alt.what_rules_would_need), adequacy: text(alt.adequacy) },
    confidence: oneOf(o.confidence, CONFIDENCE, "low"),
    ...adaptive(o)
  };
  // Only a sufficient answer must be complete; an interim "need more context" answer may be thin.
  if (analysis.context_sufficient && !analysis.why_jev.observed.length && !analysis.why_jev.inferred.length) problems.push("why_jev has no observed or inferred claims");
  if (problems.length) return { ok: false, error: `malformed analysis: ${problems.slice(0, 4).join("; ")}` };
  return { ok: true, analysis };
}

export function parseContrastAnalysis(raw: string | undefined, expectedIds: string[]): AdaptiveParse<ContrastAnalysis> {
  const o = jsonOf(raw);
  if (typeof o === "string") return { ok: false, error: o };
  const problems: string[] = [];
  const items: ContrastItemAnalysis[] = [];
  for (const c of list(o.contrasts).filter(isObj)) {
    const id = text(c.contrast_id);
    if (!expectedIds.includes(id)) continue;
    const p: string[] = [];
    items.push({
      contrast_id: id,
      is_a_real_decision: c.is_a_real_decision !== false,
      decision: decision(c.decision, p),
      features: features(c.features, p),
      why_deterministic: explanation(c.why_deterministic, p, "why_deterministic"),
      differences_from_jev_site: claims(c.differences_from_jev_site),
      shares_jev_site_traits: oneOf(c.shares_jev_site_traits, ["no", "partly", "yes", "unclear"] as const, "unclear"),
      confidence: oneOf(c.confidence, CONFIDENCE, "low")
    });
    if (p.length) problems.push(`${id}: ${p[0]}`);
  }
  const analysis: ContrastAnalysis = { contrasts: items, ...adaptive(o) };
  if (analysis.context_sufficient && items.length === 0 && expectedIds.length) problems.push("no answer for any contrast_id");
  if (problems.length && analysis.context_sufficient) return { ok: false, error: `malformed contrast analysis: ${problems.slice(0, 4).join("; ")}` };
  return { ok: true, analysis };
}

/**
 * Layer E synthesis: the model words groups JevX already counted. Anything it says about a group
 * it was not given is dropped, and it never supplies ids, projects, counts or counter-examples.
 */
export function parseSynthesis(
  raw: string | undefined,
  knownGroupIds: Set<string>
): AdaptiveParse<SynthesisAnswer & { context_sufficient: true; missing_context: []; understanding_confidence: "high" }> {
  const o = jsonOf(raw);
  if (typeof o === "string") return { ok: false, error: o };
  const seen = new Set<string>();
  const groups = list(o.groups)
    .filter(isObj)
    .map((g) => ({
      group_id: text(g.group_id),
      supported_by_the_counts: g.supported_by_the_counts !== false,
      statement: text(g.statement).slice(0, 300),
      side: oneOf(g.side, ["jev", "deterministic", "separator"] as const, "jev"),
      caveat: text(g.caveat).slice(0, 300)
    }))
    .filter((g) => knownGroupIds.has(g.group_id) && !seen.has(g.group_id) && (seen.add(g.group_id), true))
    // a group the model neither worded nor rejected carries nothing
    .filter((g) => g.statement || !g.supported_by_the_counts);
  if (!groups.length) return { ok: false, error: "no answer for any group_id" };
  return {
    ok: true,
    analysis: {
      groups,
      open_questions: list(o.open_questions)
        .map((x) => text(x).slice(0, 240))
        .filter(Boolean)
        .slice(0, 3),
      context_sufficient: true,
      missing_context: [],
      understanding_confidence: "high"
    }
  };
}
