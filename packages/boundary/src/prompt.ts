// Prompts for the M5b boundary analyst. Bump BOUNDARY_PROMPT_VERSION on ANY change: it is part
// of every cache key. Model-agnostic: nothing here is specific to Grok.
//
// b1: usage ("why Jev here?"), contrast ("why deterministic there?"), patterns (across both).
import { scrubSecrets, type ContextItem, type ContextRef, type JevSite } from "@jevx/core";
import type { AdaptiveTurn } from "@jevx/gemini";
import { ASSESSMENTS, BOUNDARY_FEATURES, CONFIDENCE, DECISION_NATURE, FEATURE_LEVELS, NOT_REASONS, WHY_JEV_HYPOTHESES } from "./schema.js";

export const BOUNDARY_PROMPT_VERSION = "b1";
/**
 * Layer E has its own version: the pattern step changed (one huge call → counted groups worded in
 * small batches) but the usage and contrast prompts did not, so cached C and D answers stay valid.
 */
export const PATTERN_PROMPT_VERSION = "e1";

// ─── strict JSON-schema helpers (every object closed, every property required) ───
type S = Record<string, unknown>;
const str = (description?: string): S => ({ type: "string", ...(description ? { description } : {}) });
const bool = (description?: string): S => ({ type: "boolean", ...(description ? { description } : {}) });
const en = (values: readonly string[], description?: string): S => ({ type: "string", enum: [...values], ...(description ? { description } : {}) });
const arr = (items: S, description?: string): S => ({ type: "array", items, ...(description ? { description } : {}) });
const obj = (properties: Record<string, S>, description?: string): S => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
  ...(description ? { description } : {})
});

const EVIDENCE = obj({ location: str("file:line or file:start-end"), observation: str("what the code there shows, in words") });
const CLAIM = obj({ claim: str(), evidence: arr(EVIDENCE) });
const EXPLANATION = obj(
  {
    observed: arr(CLAIM, "What the code demonstrably does. Every claim needs at least one location."),
    inferred: arr(CLAIM, "Your interpretation. Say what in the code points to it."),
    unknown: arr(str(), "What this repository cannot tell (e.g. the developer's actual motive).")
  },
  "Keep facts, inferences and unknowns strictly apart."
);
const DECISION = obj({
  what_is_decided: str(),
  inputs: arr(obj({ name: str(), source: str("where the value comes from"), role: str("what it contributes to the decision") })),
  outcomes: arr(str()),
  downstream_action: str("what the program does with the result"),
  nature: en(DECISION_NATURE)
});
const FEATURES = obj(
  Object.fromEntries(BOUNDARY_FEATURES.map((f) => [f, obj({ level: en(FEATURE_LEVELS), evidence: str("why this level; 'unknown' if the code doesn't show it") })])),
  "Levels only. deterministic_expressibility = how well exact rules could express this decision."
);
const ADAPTIVE = {
  context_sufficient: bool("Was the context given enough to answer confidently?"),
  missing_context: arr(obj({ request: str("a catalog id, or a symbol / file name"), why: str() })),
  context_used: arr(str()),
  understanding_confidence: en(CONFIDENCE, "How well you understood the code itself.")
};

export const USAGE_SCHEMA = obj({
  decision: DECISION,
  jev_questions: arr(obj({ key: str(), primitive: str(), what_it_asks: str() })),
  features: FEATURES,
  why_jev_hypotheses: arr(obj({ id: en(WHY_JEV_HYPOTHESES), assessment: en(ASSESSMENTS), evidence: str() }), "Assess EVERY listed hypothesis."),
  not_reasons: arr(obj({ id: en(NOT_REASONS), assessment: en(ASSESSMENTS), note: str() }), "Assess EVERY listed not-reason: is it actually why Jev fits here?"),
  why_jev: EXPLANATION,
  deterministic_alternative: obj({ what_rules_would_need: str(), adequacy: str("would exact rules be adequate, fragile, or impossible here — and why") }),
  confidence: en(CONFIDENCE),
  ...ADAPTIVE
});

export const CONTRAST_SCHEMA = obj({
  contrasts: arr(
    obj({
      contrast_id: str(),
      is_a_real_decision: bool("false if this is plumbing / parsing / formatting rather than a decision"),
      decision: DECISION,
      features: FEATURES,
      why_deterministic: EXPLANATION,
      differences_from_jev_site: arr(CLAIM),
      shares_jev_site_traits: en(["no", "partly", "yes", "unclear"], "A hypothesis, not a label.")
    })
  ),
  ...ADAPTIVE
});

/**
 * Layer E is derived deterministically from the stored records (aggregate.ts). The model is asked
 * only to word one already-counted group at a time, in SMALL batches: the counts, the record ids,
 * the projects and the counter-examples are never the model's to decide, and a batch's answer is
 * bounded (one statement per group) so no call has to produce an open-ended list.
 */
export const SYNTHESIS_SCHEMA = obj({
  groups: arr(
    obj({
      group_id: str("exactly one of the group ids given to you"),
      supported_by_the_counts: bool("false if the counts below do NOT support any general statement — then say why in caveat and JevX keeps its own wording"),
      statement: str("one sentence, under 240 characters, naming what in the decision itself differs — not how many records there are"),
      side: en(["jev", "deterministic", "separator"], "jev = describes Jev sites only; deterministic = describes the exact-rule code; separator = tells the two apart"),
      caveat: str("what these counts do NOT establish, in one sentence")
    })
  ),
  open_questions: arr(str("at most two, each under 200 characters"))
});

// ─── system instructions ───

const DISCIPLINE = [
  "EPISTEMIC RULES (most important):",
  "- OBSERVED = what the code demonstrably does. Every observed claim cites a location (file:line).",
  "- INFERRED = your interpretation. State what in the code supports it.",
  "- UNKNOWN = what the repository cannot establish. Developer intent is usually UNKNOWN; never present it as fact. A Jev call shows the developer CHOSE Jev, not that Jev was objectively right. The absence of Jev does not show Jev would be wrong — the developer may never have considered it.",
  "- Never write shallow reasons like 'Jev is used because the decision is complex'. Say WHAT makes it semantic or contextual: which input needs interpretation, which outcomes compete, what an exact rule would have to encode and why that would be fragile or impossible.",
  "- Size, branch count, criticality, importance, latency or 'complex code' are NOT reasons by themselves. A large deterministic parser is still deterministic; a tiny function holding one hard semantic judgment can be a strong Jev use.",
  "",
  "CONTEXT PROTOCOL: you get the code JevX has included so far and a CATALOG of more context it can add (related functions, callers, types, constants, importing files, folder, repository overview). If you cannot answer confidently, set context_sufficient=false and list what you need in missing_context (prefer catalog ids). Do not guess to avoid asking. List the context ids you relied on in context_used.",
  "Describe in plain words. Do not reproduce code, string literals, credentials, URLs or secrets. Short identifiers are fine. Keep each text field under 400 characters.",
  "Answer with ONE JSON object matching the response schema. No markdown, no prose outside the JSON."
].join("\n");

export const USAGE_SYSTEM = [
  "You are a senior code analyst for a research project that studies WHERE and WHEN real developers choose a Jev decision (TypeSafe's Noul / Choice / Score semantic decision primitive) instead of ordinary deterministic code.",
  "Static analysis has found an ACTUAL Jev call in a real repository (a fact). Your job: understand the decision it makes and investigate why Jev appears to be used HERE. You are not grading the developer and not deciding whether Jev is 'correct'.",
  "Investigate: what is decided; from which inputs/state; which outcomes; what happens next; whether the decision is exact or semantic/judgment-based; what ambiguity or uncertainty exists; which characteristics appear to justify Jev; what an exact-rule alternative would need.",
  "Assess every listed why-Jev hypothesis and every listed not-reason as supported / contradicted / not_determinable, each with the code evidence.",
  "",
  DISCIPLINE
].join("\n");

export const CONTRAST_SYSTEM = [
  "You are a senior code analyst for a research project that studies WHERE and WHEN real developers choose a Jev decision (TypeSafe's Noul / Choice / Score semantic decision primitive) instead of ordinary deterministic code.",
  "You get: (1) a Jev site in this repository — the developer DID use Jev there — with a previous analysis of it (that analysis is INFERENCE, not fact); (2) one or more decision-like functions from the same code that do NOT use Jev (found by static analysis).",
  "For EACH contrast: say whether it is a real decision at all, what it decides, and why it plausibly remained deterministic, and name concretely what separates it from the Jev site. If it looks like the same kind of semantic judgment as the Jev site, say so ('shares_jev_site_traits') — that is a hypothesis, never a verdict. 'The developer did not think of it' is a legitimate UNKNOWN.",
  "",
  DISCIPLINE
].join("\n");

export const SYNTHESIS_SYSTEM = [
  "You are a research analyst studying WHERE and WHEN real developers choose a Jev decision (TypeSafe's Noul / Choice / Score semantic decision primitive) instead of ordinary deterministic code.",
  "JevX has already counted the evidence. Below are a few GROUPS. Each group states exactly what was counted, the levels or assessments recorded on the Jev side and on the deterministic side, the record ids behind every number, and any records that disagree.",
  "Your only job is to word each group as one general statement about the DECISIONS — what has to be judged, which inputs need interpreting, which outcomes compete, what an exact rule would have to encode. Do not restate the counts; JevX prints those itself.",
  "",
  "RULES:",
  "- Answer for each group id exactly once. Do not invent groups, ids, projects or numbers.",
  "- A Jev call shows a developer CHOSE Jev, never that Jev was objectively right. Deterministic code beside it shows a different implementation boundary, never that Jev would be wrong there. Word every statement so it survives that.",
  "- If the counts do not support any general statement — one example, both sides the same, or one side never measured — set supported_by_the_counts=false and explain in caveat. That is a useful answer, not a failure.",
  "- Evidence recorded only on Jev sites describes Jev sites. It cannot separate them from deterministic code, so its side is 'jev', never 'separator'.",
  "- Never propose weights, scores, thresholds or a rule for deciding where Jev belongs.",
  "- Size, branch count, criticality, importance, latency and 'complex code' are not reasons by themselves.",
  "- Do not reproduce code, string literals, URLs or secrets. Keep every field under 240 characters.",
  "Answer with ONE JSON object matching the response schema. No markdown, no prose outside the JSON."
].join("\n");

// ─── prompt builders ───

const sections = (items: ContextItem[]) => items.map((i) => `=== [${i.id}] ${i.title} ===\n${i.text}`);
const catalogView = (catalog: ContextRef[]) => catalog.map((r) => ({ id: r.id, kind: r.kind, what: r.title }));

/** Observed facts about a Jev site (from the finder). Private projects: texts removed upstream. */
export function siteFacts(project: string, s: JevSite) {
  return {
    project,
    file: s.file,
    function: s.unit.name,
    function_lines: `${s.unit.start}-${s.unit.end}`,
    finder_tier: s.tier,
    finder_evidence: s.evidence,
    jev_questions: s.questions.map((q) => ({ key: q.key ?? null, primitive: q.primitive, line: q.line, text: q.text ?? null, outcomes: q.outcomes ?? null, scale: q.scale ?? null })),
    jev_calls: s.calls.map((c) => ({ kind: c.kind, line: c.line, via: c.via ? `${c.via.name} (${c.via.file}:${c.via.line})` : null })),
    question_sets: s.questionSets,
    callers: s.callers.map((c) => `${c.name} (${c.file}:${c.line})`)
  };
}

export function buildUsagePrompt(project: string, site: JevSite, t: AdaptiveTurn) {
  const raw = [
    "OBSERVED JEV USAGE (found by static analysis; that Jev is called here is a fact):",
    JSON.stringify(siteFacts(project, site), null, 2),
    "",
    "Assess these why-Jev hypotheses: " + WHY_JEV_HYPOTHESES.join(", "),
    "Assess these not-reasons: " + NOT_REASONS.join(", "),
    "",
    "CONTEXT INDEX:",
    JSON.stringify({ round: `${t.round} of at most ${t.maxRounds}`, context_included: t.items.map((i) => i.id), context_available: catalogView(t.catalog), ...(t.unresolved.length ? { not_available: t.unresolved } : {}) }, null, 2),
    "",
    "CONTEXT SECTIONS (line-numbered code):",
    ...sections(t.items)
  ].join("\n");
  return { systemInstruction: USAGE_SYSTEM, prompt: scrubSecrets(raw).text, schema: USAGE_SCHEMA };
}

export interface ContrastInput {
  id: string;
  file: string;
  unit: { name: string; start: number; end: number };
  generators: { generator: string; evidence: string[] }[];
  selection: string;
}

export function buildContrastPrompt(project: string, site: JevSite, siteSummary: unknown, contrasts: ContrastInput[], t: AdaptiveTurn) {
  const raw = [
    "THE JEV SITE (observed: the developer calls Jev here):",
    JSON.stringify(siteFacts(project, site), null, 2),
    "",
    "PREVIOUS ANALYSIS OF THE JEV SITE (model inference, not fact):",
    JSON.stringify(siteSummary, null, 2),
    "",
    "CONTRASTING DECISION-LIKE CODE WITHOUT JEV (found by static analysis; answer once per contrast_id):",
    JSON.stringify(
      contrasts.map((c) => ({ contrast_id: c.id, file: c.file, function: c.unit.name, lines: `${c.unit.start}-${c.unit.end}`, selected_because: c.selection, static_evidence: c.generators.map((g) => `${g.generator}: ${g.evidence[0] ?? ""}`) })),
      null,
      2
    ),
    "",
    "CONTEXT INDEX:",
    JSON.stringify({ round: `${t.round} of at most ${t.maxRounds}`, context_included: t.items.map((i) => i.id), context_available: catalogView(t.catalog), ...(t.unresolved.length ? { not_available: t.unresolved } : {}) }, null, 2),
    "",
    "CONTEXT SECTIONS (line-numbered code):",
    ...sections(t.items)
  ].join("\n");
  return { systemInstruction: CONTRAST_SYSTEM, prompt: scrubSecrets(raw).text, schema: CONTRAST_SCHEMA };
}

/** One bounded batch: a few already-counted groups. No source code and no record free text. */
export function buildSynthesisPrompt(groups: SynthesisGroupInput[]) {
  const raw = [
    `EVIDENCE GROUPS (${groups.length}; answer once per group_id):`,
    JSON.stringify(groups, null, 2),
    "",
    "Word each group as one general statement about the decisions themselves. Keep it to one sentence."
  ].join("\n");
  return { systemInstruction: SYNTHESIS_SYSTEM, prompt: scrubSecrets(raw).text, schema: SYNTHESIS_SCHEMA };
}

export interface SynthesisGroupInput {
  group_id: string;
  what_was_counted: string;
  counts_so_far: string;
  jev_side: Record<string, number>;
  deterministic_side: Record<string, number>;
  projects: number;
  records_that_disagree: { id: string; why: string }[];
  caveats: string[];
}
