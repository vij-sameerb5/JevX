// What the user's AI is told about finding Jev opportunities. This is JevX's Jev-specific
// knowledge: served as the `jevx_guide` tool and the `find-jev-opportunities` prompt.
export const GUIDE = `# JevX — find where Jev belongs in this codebase

Jev (TypeSafe) answers bounded judgment questions about messy input:
- noul   → one yes/no judgment with a probability ("is this message abusive?")
- choice → pick one option from a known list ("which team should handle this ticket?")
- score  → rate on a graded scale ("how urgent is this, 0–3?")

A Jev opportunity is a place where code APPROXIMATES a judgment with a hardcoded rule:
keyword lists, regexes over human text, long if/else chains guessing intent, magic thresholds
standing in for "is this good / risky / relevant / urgent", brittle heuristics that miss
paraphrases or new cases. The outcomes are bounded (a label, a route, yes/no, a level).

NOT a Jev opportunity — say so and move on:
arithmetic, parsing, protocol/status handling, exact lookups, validation of formats, typed enum
dispatch, money / security / legal rules that must stay exact, anything already using Jev.
Most decision-looking code is ordinary exact logic. Rejecting candidates is a correct answer.

## Workflow

1. \`jevx_scan\` — repository summary, the static candidates JevX found (free, local), and where
   Jev is already used. Candidates are only a starting list: static analysis finds SHAPES
   (functions choosing between outcomes), not meaning.
2. Read before judging. Use \`jevx_read\` (a function, file, outline, folder or the repo overview),
   \`jevx_related\` (callers, callees, types, constants of a function) and \`jevx_search\`.
   Understand where the input comes from, what the outcomes mean, and how the result is used.
3. Look for opportunities static analysis MISSED: read the repo overview and the modules that hold
   the product's core behaviour (routing, triage, moderation, ranking, review, recommendations,
   agents, game AI…). Any function works — it does not need to be on the candidate list.
4. For each real opportunity call \`jevx_scorecard\` with your proposal, the 8 feature levels and
   your own score. JevX adds the patterns score and Jev's own opinion and averages them.
5. Do NOT ask the user to pick or approve. For every STRONG_FIT, make the change directly with your
   own edit tool — including every caller that must change — so the editor shows it in red/green.
   Leave POSSIBLE_FIT, REVIEW_DISAGREE and WEAK_FIT untouched.
6. Run the project's tests (and typecheck). If a change breaks something that passed before,
   revert that change and keep the others.
7. Call \`jevx_report\`, then tell the user in a few lines: what changed (with scores), what was left
   alone and why, and that every change is visible in Source Control / the diff view.
   (\`jevx_preview_change\` is there if you want a diff before editing; it changes nothing.)

## Writing the change

- Replace only the judgment. Keep the deterministic remainder (what happens with the answer,
  validation, exact business rules) exactly as it was.
- Keep the function's signature and return type, so callers and tests keep working.
- Keep the old rule as the fallback when Jev is unavailable (no key, network error, timeout),
  so behaviour without Jev is unchanged and existing tests still pass.
- Make the question and criteria specific to this codebase's domain. Put only the fields Jev
  needs into \`state\` — small state gives better answers.
- Smallest diff that does the job. Reuse one TypeSafeClient per module.

\`\`\`ts
import { TypeSafeClient, choice, noul, score } from "@typesafe-ai/sdk";

const jev = new TypeSafeClient(); // reads TYPESAFE_API_KEY

const TRIAGE = {
  team: choice("Which team should handle this support ticket?", {
    billing: "Payments, invoices, refunds, plans",
    technical: "Bugs, errors, outages, integrations",
    account: "Login, access, profile, security settings"
  }),
  urgent: noul("Does the customer need help right now?", {
    true: "Service is down, money is at stake, or they are blocked",
    false: "A question, feedback, or a request that can wait"
  })
};

export async function routeTicket(t: Ticket): Promise<Team> {
  try {
    const { answers } = await jev.systemOne({ state: { subject: t.subject, body: t.body }, questions: TRIAGE });
    return answers.team.choice;            // noul → answers.urgent.noul (0–1), score → answers.x.score
  } catch {
    return legacyRouteTicket(t);           // the old rule, unchanged
  }
}
\`\`\`

## The scorecard inputs

\`features\` — your reading of the decision, one level each (none | low | medium | high | unknown):
- semantic_ambiguity: must the input's meaning be interpreted?
- context_dependence: does the right outcome depend on surrounding context?
- deterministic_expressibility: how well could exact rules express it? (high = rules are fine)
- judgment_required: would two reasonable people sometimes disagree?
- rule_stability: do the rules stay the same over time? (low = they keep changing)
- risk_or_policy_component: is it a risk, safety or policy judgment?
- natural_language_understanding: does it read human-written text?
- decision_complexity: how many things weigh on the outcome?

\`ai_score\` — 0 to 1: your own confidence that replacing this rule with Jev genuinely improves
the software. Be honest; low scores are useful. Say why in \`ai_reasons\`.
`;
