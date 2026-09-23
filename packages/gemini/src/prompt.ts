// What Gemini sees and what it must answer. Bump GEMINI_PROMPT_VERSION on ANY change here:
// it is part of the cache key, so old answers are never reused for a different question.
//
// g1: candidate function only (≤ 60 lines).
// g2: adaptive repository context — whole file first, then related code on request
//     (callees, callers, types, constants, importers, folder, repo overview). Gemini reports
//     context_sufficient / missing_context / context_used / understanding_confidence.
import { DECISION_CATEGORIES, LABELS, PRIMITIVES, UNCERTAINTY, scrubSecrets, type ContextItem, type ContextRef, type DecisionCandidate } from "@jevx/core";

export const GEMINI_PROMPT_VERSION = "g2";
export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";

export const SYSTEM_INSTRUCTION = [
  "You are a senior code analyst helping a research tool understand decision logic in unfamiliar TypeScript/JavaScript repositories.",
  "Static analysis flagged ONE function as a possible decision boundary (state → bounded outcome). You get that candidate, the code context JevX has included so far, and a CATALOG of further context JevX can provide (related functions, callers, types, constants, importing files, the folder, a repository overview).",
  "Your job is to EXPLAIN the code, not to grade it: what is decided, from which inputs, into which outcomes, whether the rule as written is exact, and whether it appears to approximate a judgment (meaning, quality, risk, fit, intent, priority…).",
  "Be objective. Many flagged functions are ordinary exact logic (parsing, lookups, validation, protocol handling, formatting); say so when that is the case. Do not assume a judgment exists.",
  "CONTEXT PROTOCOL: If you cannot explain the decision confidently from what you were given — e.g. you need to know what a called function returns, where an input comes from, what a type or constant contains, or what the module is for — set context_sufficient to false and list what you need in missing_context. Prefer exact catalog ids in `request`; otherwise name the symbol or file. Do not guess to avoid asking. If you can explain it, set context_sufficient to true. List the context ids you relied on in context_used.",
  "understanding_confidence is how well you understood the CODE, not whether it is a Jev opportunity.",
  "Describe in plain words. Do not quote or reproduce code, string literals, credentials, URLs or secrets. Keep every text field under 300 characters.",
  "Answer with a single JSON object matching the response schema. No markdown, no prose outside the JSON.",
  "model_hypothesis is optional and only a debugging aid; it is never used as a label."
].join("\n");

/** JSON Schema for the answer (sent as responseJsonSchema; JevX validates the answer itself too). */
export const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", description: "What the function does, 1–2 sentences." },
    decision: { type: "string", description: "What is being decided. 'none' if nothing is decided." },
    decision_boundary: { type: "string", description: "State → outcome, e.g. 'task characteristics → model tier'." },
    inputs: {
      type: "array",
      items: { type: "object", properties: { name: { type: "string" }, role: { type: "string" } }, required: ["name", "role"] }
    },
    outcomes: { type: "array", items: { type: "string" }, description: "Possible outcomes / actions, described in words." },
    decision_type: { type: "string", enum: [...Object.keys(DECISION_CATEGORIES), "not_a_decision"] },
    deterministic_logic: { type: "boolean", description: "The rule as written is exact and fully specified." },
    approximates_judgment: { type: "boolean", description: "The exact rule appears to stand in for a judgment." },
    judgment_kind: { type: "string", description: "If approximates_judgment: what kind of judgment; otherwise an empty string." },
    plausible_primitive: { type: "string", enum: [...PRIMITIVES], description: "noul = yes/no probability, choice = one of a list, score = graded level, none." },
    stays_deterministic: { type: "array", items: { type: "string" }, description: "Parts that must remain exact code." },
    reasoning: { type: "string" },
    uncertainty: { type: "string", enum: [...UNCERTAINTY], description: "Uncertainty about whether a judgment is being approximated." },
    context_sufficient: { type: "boolean", description: "Was the context given enough to explain this decision confidently?" },
    missing_context: {
      type: "array",
      description: "What else is needed. Use catalog ids when possible.",
      items: { type: "object", properties: { request: { type: "string" }, why: { type: "string" } }, required: ["request", "why"] }
    },
    context_used: { type: "array", items: { type: "string" }, description: "Ids of the context sections relied on." },
    understanding_confidence: { type: "string", enum: [...UNCERTAINTY], description: "How well the code itself was understood." },
    model_hypothesis: {
      type: "object",
      description: "Optional debugging aid, never a label.",
      properties: { label: { type: "string", enum: [...LABELS] }, note: { type: "string" } },
      required: ["label", "note"]
    }
  },
  required: [
    "summary",
    "decision",
    "decision_boundary",
    "inputs",
    "outcomes",
    "decision_type",
    "deterministic_logic",
    "approximates_judgment",
    "plausible_primitive",
    "stays_deterministic",
    "reasoning",
    "uncertainty",
    "context_sufficient",
    "missing_context",
    "context_used",
    "understanding_confidence"
  ]
} as const;

/** Structured header about the candidate (the code itself travels in the context sections). */
export function buildGeminiInput(c: DecisionCandidate) {
  return {
    language: c.language,
    file: c.file,
    function: c.unit.name,
    function_lines: `${c.unit.start}-${c.unit.end}`,
    decision_block_lines: `${c.boundary.start}-${c.boundary.end}`,
    deterministic_evidence: c.generators.map((g) => ({ generator: g.generator, evidence: g.evidence.slice(0, 3) })),
    detected_inputs: c.inputs.slice(0, 10).map((i) => ({ name: i.name, provenance: i.provenance, type: i.type ?? null })),
    detected_outcomes: { kind: c.outputs.kind, values: c.outputs.values.slice(0, 12) },
    filtered_as: c.triage ? { reason: c.triage.reason } : null
  };
}

/** Context when no repository index is available: just the candidate's own code. */
export function fallbackContext(c: DecisionCandidate): ContextItem {
  const text = scrubSecrets(
    c.code
      .split("\n")
      .map((l, i) => `${String(c.unit.start + i).padStart(5)} | ${l}`)
      .join("\n")
  ).text;
  return { id: `unit:${c.file}#${c.unit.name}@${c.unit.start}`, kind: "unit", title: `${c.unit.name} in ${c.file}`, file: c.file, lines: [c.unit.start, c.unit.end], text, chars: text.length, hash: "" };
}

export interface GeminiPrompt {
  systemInstruction: string;
  /** Secret-scrubbed. This exact string is what leaves the machine. */
  prompt: string;
  redactions: number;
}

export interface PromptContext {
  items: ContextItem[];
  /** Catalog entries not yet included. */
  catalog: ContextRef[];
  round: number;
  maxRounds: number;
  /** Requests from the previous round that JevX could not resolve (so Gemini doesn't repeat them). */
  unresolved?: string[];
}

export function buildGeminiPrompt(c: DecisionCandidate, ctx?: PromptContext): GeminiPrompt {
  const context = ctx ?? { items: [fallbackContext(c)], catalog: [], round: 1, maxRounds: 1 };
  const header = {
    candidate: buildGeminiInput(c),
    round: `${context.round} of at most ${context.maxRounds}`,
    context_included: context.items.map((i) => i.id),
    context_available: context.catalog.map((r) => ({ id: r.id, kind: r.kind, what: r.title })),
    ...(context.unresolved?.length ? { not_available: context.unresolved } : {})
  };
  const sections = context.items.map((i) => `=== [${i.id}] ${i.title} ===\n${i.text}`);
  const raw = [
    "Explain the decision in the candidate function and answer with the JSON object.",
    "",
    "CANDIDATE AND CONTEXT INDEX:",
    JSON.stringify(header, null, 2),
    "",
    "CONTEXT SECTIONS (line-numbered code):",
    ...sections
  ].join("\n");
  const { text, redactions } = scrubSecrets(raw);
  return { systemInstruction: SYSTEM_INSTRUCTION, prompt: text, redactions };
}
