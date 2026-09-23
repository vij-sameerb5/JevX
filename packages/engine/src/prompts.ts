// What JevX asks the user's AI in the autonomous run:
//   read     the AI reads the source itself, part by part → every spot where Jev would help
//   survey   (fallback/legacy) repo overview + static candidates → which to inspect
//   assess   one location, adaptive repo context → is it a real Jev decision? proposal + features
//   edit     one approved proposal + its file + its callers → exact search/replace edits
// Every answer is strict JSON with a closed schema; every parser is lenient and never throws.
// Bump ENGINE_PROMPT_VERSION on any change here (it is part of the cache key).
import { scrubSecrets, type ContextItem, type ContextRef } from "@jevx/core";
import type { AdaptiveParse, AdaptiveTurn } from "@jevx/gemini";
import { FEATURES, LEVELS, type FeatureLevels } from "./scorecard.js";
import { GUIDE } from "./guide.js";

export const ENGINE_PROMPT_VERSION = "r5";

type S = Record<string, unknown>;
const str = (description?: string): S => ({ type: "string", ...(description ? { description } : {}) });
const num = (description?: string): S => ({ type: "number", ...(description ? { description } : {}) });
const bool = (description?: string): S => ({ type: "boolean", ...(description ? { description } : {}) });
const en = (values: readonly string[], description?: string): S => ({ type: "string", enum: [...values], ...(description ? { description } : {}) });
const arr = (items: S, description?: string): S => ({ type: "array", items, ...(description ? { description } : {}) });
const obj = (properties: Record<string, S>, description?: string): S => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false, ...(description ? { description } : {}) });

const RULES = [
  "Answer with ONE JSON object matching the response schema. No markdown, no prose outside the JSON.",
  "Do not reproduce credentials, URLs or secrets. Keep every text field under 300 characters."
].join("\n");

// ─── read ───

export const READ_SCHEMA = obj({
  spots: arr(
    obj({
      file: str("path exactly as in the FILE header"),
      start_line: num("first line of the decision code"),
      end_line: num("last line of the decision code"),
      function: str("the enclosing function / method / handler name"),
      decision: str("what is being decided, one sentence"),
      primitive: en(["noul", "choice", "score"]),
      why: str("which hardcoded rule approximates a judgment, and why it misses cases"),
      confidence: num("0 to 1")
    }),
    "Every plausible spot in THESE files, most confident first. At most 12."
  )
});

export const READ_SYSTEM = [
  "You are the first-pass code reader for JevX. You read real source files and point at every place where a hardcoded rule is standing in for a judgment that a Jev decision (TypeSafe) could make better.",
  "",
  "Jev answers bounded judgment questions about messy input:",
  "- noul: one yes/no judgment with a probability (\"is this message abusive?\")",
  "- choice: pick one option from a known list (\"which kind of error is this?\", \"which image fits this destination?\")",
  "- score: rate or rank on a scale (\"how well does this flight suit a patient travelling for surgery?\")",
  "",
  "THIS IS A FIRST PASS. A second step re-reads every spot you report with more context and throws out the wrong ones, so do NOT filter hard. Report every plausible spot with an honest confidence (0.3 = maybe, 0.8 = clearly). A part that contains any of the patterns below and returns nothing is a MISS.",
  "",
  "REPORT these (judgment written as rules):",
  "- regex / keyword / includes() / startsWith() checks that sort free text into categories: user messages, error messages from other systems, AI output, search queries, names, addresses",
  "- try/catch blocks that inspect error message text to decide what to tell the user",
  "- lookup tables keyed by free text (a name, a country, a label) with a default fallback when the text doesn't match exactly",
  "- `.sort()`, `.slice(0, n)`, `[0]`, `.find()` over results from an external API or database when the best pick depends on the user's situation (fit, relevance, suitability), not a fixed order",
  "- hardcoded thresholds, weights or magic numbers on fuzzy signals (scores, counts, lengths) that decide risk, quality, urgency, relevance",
  "- if/else or switch chains that guess intent, category, sentiment, urgency, priority, eligibility from loosely structured data",
  "",
  "DO NOT report (exact logic): money and balance arithmetic, payments, refunds, escrow, on-chain calls; status/state machines; auth and permissions; validating formats (email, hex address, dates); parsing structured data (JSON, SSE, markdown); UI layout, styling, animation; config/env handling; code that already calls an AI or Jev.",
  "",
  "Give the exact line numbers of the decision itself (from the numbered listing), not the whole component. Use the file path exactly as written in the FILE header.",
  RULES
].join("\n");

export interface ReadFile {
  file: string;
  start: number;
  end: number;
  text: string;
}

export function buildReadPrompt(tree: string[], files: ReadFile[], part: { n: number; of: number }, existingJev: string[]) {
  const raw = [
    `PART ${part.n} OF ${part.of}. REPOSITORY FILES (${tree.length}):`,
    tree.join("\n"),
    "",
    existingJev.length ? `ALREADY USING JEV (do not report these):\n${existingJev.join("\n")}\n` : "",
    "FILES TO READ NOW (line-numbered):",
    ...files.map((f) => `=== FILE ${f.file} (lines ${f.start}-${f.end}) ===\n${f.text}`)
  ].join("\n");
  return { systemInstruction: READ_SYSTEM, prompt: scrubSecrets(raw).text, schema: READ_SCHEMA };
}

// ─── survey ───

export const SURVEY_SCHEMA = obj({
  inspect: arr(obj({ id: str("a candidate id from the list"), why: str() }), "Candidates worth a closer look, most promising first."),
  missed: arr(obj({ file: str("path from the repository tree"), function: str("the function or method name"), why: str() }), "Judgment calls the static list does not contain. At most 5.")
});

export const SURVEY_SYSTEM = [
  "You are the code analyst for JevX, which finds where a Jev decision (TypeSafe Noul / Choice / Score) would improve a codebase.",
  GUIDE.split("## Workflow")[0]!.trim(),
  "",
  "Below: the repository overview, and the functions static analysis flagged because of their SHAPE (they choose between outcomes). Most will be ordinary exact logic.",
  "Pick the candidates worth inspecting — ones that look like a judgment written as rules — and name up to 5 judgment calls the list missed (a file and a function name that exist in the tree). Skip anything that is clearly exact logic. An empty answer is fine.",
  RULES
].join("\n");

export interface SurveyCandidate {
  id: string;
  where: string;
  generators: string[];
  outcomes: string[];
}

export function buildSurveyPrompt(overview: string, candidates: SurveyCandidate[], existingJev: string[], maxInspect: number) {
  const raw = [
    `REPOSITORY OVERVIEW:\n${overview}`,
    "",
    existingJev.length ? `ALREADY USING JEV (do not propose these):\n${existingJev.join("\n")}\n` : "",
    `STATIC CANDIDATES (${candidates.length}; choose at most ${maxInspect}):`,
    JSON.stringify(candidates, null, 1)
  ].join("\n");
  return { systemInstruction: SURVEY_SYSTEM, prompt: scrubSecrets(raw).text, schema: SURVEY_SCHEMA };
}

// ─── assess ───

export const INPUT_KINDS = ["user_text", "error_message", "ai_output", "external_api_results", "free_text_name", "structured_app_data", "other"] as const;
export const RULE_KINDS = ["regex", "keyword_list", "includes_or_startswith", "lookup_with_default", "sort_or_slice", "threshold", "if_else_chain", "switch", "other"] as const;

export const PATTERN_SCHEMA = obj(
  {
    label: str("short generic kebab-case slug, e.g. error-message-regex-classifier, free-text-lookup-with-default, api-results-top-n-slice, keyword-intent-router, magic-threshold-on-fuzzy-signal"),
    input_kind: en(INPUT_KINDS),
    rule_kind: en(RULE_KINDS),
    rule_shape: str("one generic sentence on the code shape, e.g. 'catch block → regex on error message → pick user-facing copy'"),
    why_generic: str("one generic sentence on why Jev would beat the rule (or why the rule is fine)"),
    failure_example: str("one INVENTED input the rule gets wrong, or empty")
  },
  "The spot as a reusable pattern. NO names from this repository: no file, function, variable, product or company names, no string literals copied from the code."
);

export const ASSESS_SCHEMA = obj({
  is_opportunity: bool("true only if replacing a hardcoded rule here with a Jev decision genuinely improves the software"),
  decision: str("what is decided, one sentence"),
  primitive: en(["noul", "choice", "score", "none"]),
  question: str("the question Jev would answer"),
  outcomes: arr(str()),
  state: arr(str("an input Jev would see")),
  deterministic_remainder: str("what stays exact code around the Jev call"),
  why: str("concretely why a judgment is needed — or why this is exact logic"),
  features: obj(Object.fromEntries(FEATURES.map((f) => [f, en([...LEVELS, "unknown"])]))),
  ai_score: num("0 to 1: your confidence that Jev genuinely improves this decision"),
  context_sufficient: bool(),
  missing_context: arr(obj({ request: str("a catalog id, or a symbol / file name"), why: str() })),
  context_used: arr(str()),
  understanding_confidence: en(["low", "medium", "high"]),
  pattern: PATTERN_SCHEMA
});

export const ASSESS_SYSTEM = [
  "You are the second-pass reviewer for JevX. A first reader flagged ONE location in a real repository as a possible place for a Jev decision and said why. You get that location, the code JevX has included so far, and a CATALOG of more context you can ask for.",
  "",
  "Jev (TypeSafe) answers bounded judgment questions about messy input:",
  "- noul: one yes/no judgment with a probability",
  "- choice: pick one option from a known list",
  "- score: rate or rank on a graded scale",
  "",
  "is_opportunity = true when the code maps messy or open-ended input (text written by people, error messages from other systems, AI output, results from an external API, free-text names) to a bounded outcome with a hardcoded rule that misses real cases: new wordings, paraphrases, spelling variants, or a best pick that depends on the user's situation.",
  "The existing rule stays in the code as the fallback when Jev fails. So an added network call, latency or cost is NOT a reason to reject; reflect it in ai_score instead.",
  "Small or cosmetic decisions can still be opportunities: give them a lower ai_score (0.4-0.6) instead of rejecting. Reserve 0.8+ for decisions where the hardcoded rule clearly lets users down.",
  "",
  "is_opportunity = false when the rule is exact and complete: arithmetic, money / balances / payments / escrow, status or state machines over the app's own values, auth and permissions, validating formats, parsing structured data, typed enum dispatch, UI layout and styling, or when every input is controlled by the app itself (fixed enums, database status values). Say which of these it is in `why`.",
  "",
  "Feature levels: semantic_ambiguity, context_dependence, deterministic_expressibility (high = exact rules are fine), judgment_required, rule_stability (low = keeps changing), risk_or_policy_component, natural_language_understanding, decision_complexity.",
  "If you need to see where an input comes from or how the result is used, set context_sufficient=false and list what you need in missing_context (prefer catalog ids). Do not guess.",
  "Always fill `pattern` (also when is_opportunity=false): it describes the KIND of code in generic words so JevX can learn across projects. Never put names, paths or literals from this repository in it.",
  RULES
].join("\n");

const sections = (items: ContextItem[]) => items.map((i) => `=== [${i.id}] ${i.title} ===\n${i.text}`);

export function buildAssessPrompt(where: string, t: AdaptiveTurn, hint?: string) {
  const raw = [
    `LOCATION TO ASSESS: ${where}`,
    ...(hint ? [`WHY IT WAS FLAGGED (a first reading — check it, don't trust it): ${hint}`] : []),
    "",
    "CONTEXT INDEX:",
    JSON.stringify(
      {
        round: `${t.round} of at most ${t.maxRounds}`,
        context_included: t.items.map((i) => i.id),
        context_available: t.catalog.map((r: ContextRef) => ({ id: r.id, kind: r.kind, what: r.title })),
        ...(t.unresolved.length ? { not_available: t.unresolved } : {})
      },
      null,
      1
    ),
    "",
    "CONTEXT SECTIONS (line-numbered code):",
    ...sections(t.items)
  ].join("\n");
  return { systemInstruction: ASSESS_SYSTEM, prompt: scrubSecrets(raw).text, schema: ASSESS_SCHEMA };
}

// ─── edit ───

export const EDIT_SCHEMA = obj({
  edits: arr(
    obj({
      file: str("repository-relative path of a file shown below"),
      find: str("an EXACT, UNIQUE substring of that file as shown (copy it character for character, including indentation)"),
      replace: str("the text that replaces it")
    })
  ),
  summary: str("one sentence: what changed")
});

export const EDIT_SYSTEM = [
  "You are the code editor for JevX. Implement ONE approved Jev decision in a real repository with the smallest correct change.",
  GUIDE.slice(GUIDE.indexOf("## Writing the change")),
  "",
  "EDIT RULES:",
  "- Express every change as search/replace edits. `find` must be copied EXACTLY from the file text shown and must occur exactly once in that file. Include enough surrounding lines to make it unique.",
  "- Keep the old logic as a named fallback function and call it when Jev fails (catch every error).",
  "- Keep exported names. If the function must become async, change its return type to a Promise and update EVERY caller shown (add await, and make those callers async too if needed — update their callers if they are shown).",
  "- Add `import { TypeSafeClient, choice, noul, score } from \"@typesafe-ai/sdk\";` (only the helpers you use) with the file's other imports, and create one client per module: `const jev = new TypeSafeClient();`.",
  "- Do not touch tests, configuration, or anything unrelated. Do not reformat.",
  RULES
].join("\n");

export interface EditInputFile {
  file: string;
  text: string;
  role: "decision" | "caller";
}

export function buildEditPrompt(p: { decision: string; primitive: string; question: string; outcomes: string[]; state: string[]; deterministic_remainder: string; why: string }, where: string, files: EditInputFile[]) {
  const raw = [
    `APPROVED JEV DECISION at ${where}:`,
    JSON.stringify(p, null, 1),
    "",
    "FILES (exact text; `find` must match these characters):",
    ...files.map((f) => `=== FILE ${f.file} (${f.role === "decision" ? "holds the decision" : "calls the decision"}) ===\n${f.text}`)
  ].join("\n");
  return { systemInstruction: EDIT_SYSTEM, prompt: scrubSecrets(raw).text, schema: EDIT_SCHEMA };
}

// ─── parsers ───

type O = Record<string, unknown>;
const isObj = (v: unknown): v is O => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const list = (v: unknown, max = 40): unknown[] => (Array.isArray(v) ? v.slice(0, max) : []);
const text = (v: unknown, max = 600) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export function jsonObject(raw: string | undefined): O | string {
  if (!raw?.trim()) return "empty response";
  let body = raw.trim();
  const fenced = body.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fenced) body = fenced[1]!;
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

const DONE = { context_sufficient: true as const, missing_context: [] as { request: string; why: string }[], understanding_confidence: "high" as const };

export interface SurveyAnswer {
  inspect: { id: string; why: string }[];
  missed: { file: string; function: string; why: string }[];
}

export function parseSurvey(raw: string | undefined, known: Set<string>): AdaptiveParse<SurveyAnswer & typeof DONE> {
  const o = jsonObject(raw);
  if (typeof o === "string") return { ok: false, error: o };
  return {
    ok: true,
    analysis: {
      inspect: list(o.inspect)
        .filter(isObj)
        .map((x) => ({ id: text(x.id, 300), why: text(x.why) }))
        .filter((x) => known.has(x.id)),
      missed: list(o.missed, 5)
        .filter(isObj)
        .map((x) => ({ file: text(x.file, 300), function: text(x.function, 200), why: text(x.why) }))
        .filter((x) => x.file && x.function),
      ...DONE
    }
  };
}

export interface ReadSpot {
  file: string;
  start_line: number;
  end_line: number;
  function: string;
  decision: string;
  primitive: "noul" | "choice" | "score";
  why: string;
  confidence: number;
}

/** Match an AI-written path to a known one: exact, then after cleanup, then a unique suffix match. */
export function matchFile(raw: string, known: Iterable<string>): string | undefined {
  const all = [...known];
  const clean = raw.trim().replace(/\s*\(lines?[^)]*\)\s*$/i, "").replace(/^[`'"]+|[`'"]+$/g, "").replace(/\\/g, "/").replace(/^(\.\/|\/)+/, "").replace(/:\d+(-\d+)?$/, "");
  if (all.includes(clean)) return clean;
  const hits = all.filter((f) => f.endsWith(`/${clean}`) || clean.endsWith(`/${f}`));
  return hits.length === 1 ? hits[0] : undefined;
}

const lineOf = (v: unknown) => (typeof v === "number" ? Math.round(v) : Number.parseInt(String(v ?? ""), 10));

export function parseRead(raw: string | undefined, files: Map<string, number>): AdaptiveParse<{ spots: ReadSpot[]; named: number } & typeof DONE> {
  const o = jsonObject(raw);
  if (typeof o === "string") return { ok: false, error: o };
  const spots: ReadSpot[] = [];
  const all = list(o.spots, 12).filter(isObj);
  for (const x of all) {
    const file = matchFile(text(x.file, 300), files.keys());
    if (!file) continue;
    const lines = files.get(file)!;
    const a = lineOf(x.start_line);
    const b = lineOf(x.end_line);
    if (!Number.isFinite(a) || a < 1 || a > lines) continue;
    const end = Number.isFinite(b) && b >= a ? Math.min(b, lines) : a;
    const c = Number(x.confidence);
    spots.push({
      file,
      start_line: a,
      end_line: end,
      function: text(x.function, 200) || "(anonymous)",
      decision: text(x.decision),
      primitive: ["noul", "choice", "score"].includes(String(x.primitive)) ? (x.primitive as ReadSpot["primitive"]) : "choice",
      why: text(x.why),
      confidence: Number.isFinite(c) ? Math.min(1, Math.max(0, c)) : 0.5
    });
  }
  return { ok: true, analysis: { spots, named: all.length, ...DONE } };
}

export interface Pattern {
  label: string;
  input_kind: (typeof INPUT_KINDS)[number];
  rule_kind: (typeof RULE_KINDS)[number];
  rule_shape: string;
  why_generic: string;
  failure_example: string;
}

const oneOf = <T extends readonly string[]>(v: unknown, all: T): T[number] => (all.includes(String(v)) ? (v as T[number]) : ("other" as T[number]));

export function parsePattern(v: unknown): Pattern | undefined {
  if (!isObj(v)) return undefined;
  const label = text(v.label, 60).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!label) return undefined;
  return { label, input_kind: oneOf(v.input_kind, INPUT_KINDS), rule_kind: oneOf(v.rule_kind, RULE_KINDS), rule_shape: text(v.rule_shape, 200), why_generic: text(v.why_generic, 200), failure_example: text(v.failure_example, 200) };
}

export interface Assessment {
  is_opportunity: boolean;
  decision: string;
  primitive: "noul" | "choice" | "score" | "none";
  question: string;
  outcomes: string[];
  state: string[];
  deterministic_remainder: string;
  why: string;
  features: FeatureLevels;
  ai_score: number;
  context_sufficient: boolean;
  missing_context: { request: string; why: string }[];
  understanding_confidence: "low" | "medium" | "high";
  pattern?: Pattern;
}

export function parseAssessment(raw: string | undefined): AdaptiveParse<Assessment> {
  const o = jsonObject(raw);
  if (typeof o === "string") return { ok: false, error: o };
  const f = isObj(o.features) ? o.features : {};
  const levels = [...LEVELS, "unknown"] as readonly string[];
  const score = typeof o.ai_score === "number" && Number.isFinite(o.ai_score) ? Math.min(1, Math.max(0, o.ai_score)) : 0;
  const primitive = ["noul", "choice", "score", "none"].includes(String(o.primitive)) ? (o.primitive as Assessment["primitive"]) : "none";
  return {
    ok: true,
    analysis: {
      is_opportunity: o.is_opportunity === true,
      decision: text(o.decision),
      primitive,
      question: text(o.question),
      outcomes: list(o.outcomes, 16).map((x) => text(x, 120)).filter(Boolean),
      state: list(o.state, 12).map((x) => text(x, 120)).filter(Boolean),
      deterministic_remainder: text(o.deterministic_remainder),
      why: text(o.why),
      features: Object.fromEntries(FEATURES.filter((k) => levels.includes(String(f[k]))).map((k) => [k, f[k]])) as FeatureLevels,
      ai_score: score,
      context_sufficient: o.context_sufficient !== false,
      missing_context: list(o.missing_context, 8)
        .map((m) => (isObj(m) ? { request: text(m.request, 300), why: text(m.why) } : { request: text(m, 300), why: "" }))
        .filter((m) => m.request),
      understanding_confidence: ["low", "medium", "high"].includes(String(o.understanding_confidence)) ? (o.understanding_confidence as Assessment["understanding_confidence"]) : "medium",
      ...(parsePattern(o.pattern) ? { pattern: parsePattern(o.pattern) } : {})
    }
  };
}

export interface Edit {
  file: string;
  find: string;
  replace: string;
}

export function parseEdits(raw: string | undefined): AdaptiveParse<{ edits: Edit[]; summary: string } & typeof DONE> {
  const o = jsonObject(raw);
  if (typeof o === "string") return { ok: false, error: o };
  const edits = list(o.edits, 30)
    .filter(isObj)
    .map((e) => ({ file: text(e.file, 300), find: typeof e.find === "string" ? e.find : "", replace: typeof e.replace === "string" ? e.replace : "" }))
    .filter((e) => e.file && e.find);
  if (!edits.length) return { ok: false, error: "no edits in the answer" };
  return { ok: true, analysis: { edits, summary: text(o.summary), ...DONE } };
}
