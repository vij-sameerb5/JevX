// Jev's own opinion on ONE proposed decision, via the TypeSafe API (the user's TYPESAFE_API_KEY).
// Reuses the questions JevX already asks (@jevx/typesafe buildDecisionQuestions): does it need
// judgment, are the outcomes bounded, would exact code still be right, which primitive.
// Sends only the decision's lines and the proposal — never whole files. Secrets are scrubbed.
// Answers are cached in <root>/.jevx/cache/mcp-jev.json, keyed by the exact state sent.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { scrubSecrets } from "@jevx/core";
import { DECISION_PROMPT_VERSION, buildDecisionQuestions, createClient } from "@jevx/typesafe";
import type { JevAnswers } from "./scorecard.js";

export interface Proposal {
  decision: string;
  primitive: "noul" | "choice" | "score";
  question: string;
  outcomes: string[];
  state: string[];
  deterministic_remainder: string;
  why: string;
}

const MAX_LINES = 80;

export function jevState(file: string, code: string, p: Proposal) {
  const lines = code.split("\n");
  const capped = lines.length > MAX_LINES ? [...lines.slice(0, MAX_LINES), "// …"].join("\n") : code;
  return {
    language: /\.(ts|tsx|mts|cts)$/.test(file) ? "TypeScript" : "JavaScript",
    file,
    decision_summary: p.decision,
    proposed_primitive: p.primitive,
    proposed_question: p.question,
    outcomes: p.outcomes.slice(0, 12),
    inputs: p.state.slice(0, 10),
    stays_deterministic: p.deterministic_remainder,
    boundary_code: scrubSecrets(capped).text,
    unit_code: scrubSecrets(capped).text
  };
}

export type JevResult = { ok: true; answers: JevAnswers; cached: boolean; model: string } | { ok: false; error: string };

export async function askJev(root: string, file: string, code: string, p: Proposal): Promise<JevResult> {
  const made = createClient({ model: process.env.TYPESAFE_MODEL?.trim() || undefined });
  if (!made.client) return { ok: false, error: `${made.error} — TypeSafe score skipped (set TYPESAFE_API_KEY to include Jev's opinion)` };
  const state = jevState(file, code, p);
  const model = made.client.defaultModel;
  const key = createHash("sha256").update([JSON.stringify(state), model, DECISION_PROMPT_VERSION].join("\0")).digest("hex");
  const cacheFile = path.join(root, ".jevx", "cache", "mcp-jev.json");
  let cache: Record<string, JevAnswers> = {};
  try {
    if (existsSync(cacheFile)) cache = JSON.parse(readFileSync(cacheFile, "utf8")) as Record<string, JevAnswers>;
  } catch {
    cache = {};
  }
  if (cache[key]) return { ok: true, answers: cache[key], cached: true, model };
  try {
    const r = await made.client.systemOne({ state, questions: buildDecisionQuestions(), model });
    const answers: JevAnswers = {
      judgment: r.answers.judgment.noul,
      bounded: r.answers.bounded.noul,
      deterministicIsCorrect: r.answers.deterministic_is_correct.noul,
      primitive: String(r.answers.primitive.choice),
      primitiveConfidence: r.answers.primitive.confidence,
      category: String(r.answers.category.choice)
    };
    cache[key] = answers;
    mkdirSync(path.dirname(cacheFile), { recursive: true });
    writeFileSync(cacheFile, JSON.stringify(cache, null, 2));
    return { ok: true, answers, cached: false, model };
  } catch (err) {
    return { ok: false, error: `TypeSafe call failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}
