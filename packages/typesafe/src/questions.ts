import { choice, noul } from "@typesafe-ai/sdk";
import type { Candidate, SemanticKind } from "@jevx/core";

/**
 * Bump whenever the state shape or question wording changes: it is part of the cache key,
 * so old answers are never reused for a different question.
 */
export const PROMPT_VERSION = "v3";
// v1: decision lines only.
// v2: + enclosing function; semantic + humanText questions point at decision_code; humanText
//     "false" criteria named library/app error messages → humanText collapsed (mean 0.69 → 0.30).
// v3: keep v2 state + semantic question; humanText question/criteria reverted to v1 wording.

/** Keep state small — Jev's accuracy drops as unrelated context grows. */
const MAX_SNIPPET_LINES = 40;
const MAX_TERMS = 30;

export const KIND_CRITERIA = {
  intent_or_topic: "Infers what the person wants or what the text is about (refund request, billing question, support topic).",
  sentiment_or_tone: "Infers feeling or tone (positive, negative, angry, happy, praise, complaint).",
  moderation_or_safety: "Decides whether text is abusive, toxic, spam, threatening or otherwise unsafe.",
  urgency_or_priority: "Infers how urgent or important the text is (urgent, asap, outage, blocked).",
  yes_no_or_agreement: "Interprets a person's answer as yes/no, agreement, confirmation or refusal.",
  other_semantic: "Some other judgement about the meaning of human-written text.",
  not_semantic:
    "Not a judgement about meaning: exact matching over a fixed vocabulary set by a system (file extensions, URLs, MIME types, HTTP methods, enum or status values, command names, flags, code keywords, IDs)."
} satisfies Record<SemanticKind, string>;

export function buildQuestions() {
  return {
    semantic: noul(
      "Does the code in decision_code make a decision based on what a person means in free-form text they wrote, so that a paraphrase using different words should lead to the same outcome? Use enclosing_function to see where the matched text comes from.",
      {
        true: "It interprets natural language written by people (messages, comments, reviews, tickets, chat replies) to infer intent, topic, sentiment, urgency, safety or agreement. Keyword, regex or equality matching is standing in for understanding.",
        false:
          "It matches a closed, exact vocabulary whose wording is fixed by a system or specification: file extensions, MIME types, URLs or paths, HTTP methods, enum or status values, command names, config flags, programming-language keywords, or identifiers."
      }
    ),
    // v1 wording (advisory only — see DEFAULT_POLICY)
    humanText: noul("Is the text being matched in this code written by a person in natural language?", {
      true: "User messages, comments, reviews, support tickets, chat input, email subjects or bodies.",
      false: "File names, URLs, headers, user agents, machine-generated codes, source code, configuration values, enum values."
    }),
    kind: choice("What kind of decision does this code make?", KIND_CRITERIA)
  };
}

export type ValidationQuestions = ReturnType<typeof buildQuestions>;

const MAX_ENCLOSING_LINES = 60;

const cap = (text: string, max: number) => {
  const lines = text.split("\n");
  return lines.length > max ? [...lines.slice(0, max), "// …"].join("\n") : text;
};

/**
 * The state sent to TypeSafe: the decision, the function around it (so the model can see
 * where the matched text comes from), and the matched terms. Never the whole file.
 */
export function buildState(c: Candidate) {
  const decision = c.source?.decision ?? c.snippet;
  return {
    language: /\.(ts|tsx|mts|cts)$/.test(c.file) ? "TypeScript" : "JavaScript",
    file: c.file,
    function: c.context ?? null,
    decision_lines: `${c.line}-${c.endLine}`,
    decision_code: cap(decision, MAX_SNIPPET_LINES),
    enclosing_function: c.source?.enclosing ? cap(c.source.enclosing, MAX_ENCLOSING_LINES) : null,
    matched_terms: c.terms.slice(0, MAX_TERMS)
  };
}
