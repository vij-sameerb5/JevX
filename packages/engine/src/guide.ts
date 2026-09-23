// What the user's AI is told about finding Jev opportunities. This is JevX's Jev-specific
// knowledge: served as the `jevx_guide` tool and the `find-jev-opportunities` prompt.
export const GUIDE = `# JevX — find where Jev belongs in this codebase

Jev (TypeSafe) answers bounded judgment questions about messy input:
- noul   → one yes/no judgment with a probability ("is this message abusive?")
- choice → pick one option from a known list ("which team should handle this ticket?")
- score  → rate on a graded scale ("how urgent is this, 0–3?")

A Jev opportunity is a place where code APPROXIMATES a judgment with a hardcoded rule over messy
or open-ended input (text people write, error messages from other systems, AI output, results
from an external API, free-text names), with bounded outcomes (a label, a route, yes/no, a level).
The old rule stays as the fallback when Jev fails, so an added network call is not a reason to
say no — reflect it in your score instead.

Look for these:
- regex / keyword / includes() / startsWith() checks that sort free text into categories
- try/catch blocks that read an error message's text to decide what to tell the user
- lookup tables keyed by free text with a default when the text doesn't match exactly
- \`.sort()\` / \`.slice(0, n)\` / \`.find()\` over external results when the best pick depends on
  the user's situation, not a fixed order
- magic thresholds or weights on fuzzy signals deciding risk, quality, urgency, relevance
- if/else or switch chains guessing intent, category, sentiment, urgency or eligibility

NOT a Jev opportunity (exact logic — say so): arithmetic; money, balances, payments, refunds,
escrow; status / state machines over the app's own values; auth and permissions; validating
formats; parsing structured data; typed enum dispatch; UI layout and styling; anything already
using Jev. Small or cosmetic decisions can still be opportunities — score them low instead of
rejecting them (see the ai_score scale below).

## Workflow

1. \`jevx_scan\` — repository summary, where Jev is already used, the static candidates, and the
   READING ORDER of the source files (logic folders first, UI last). The candidates are only a
   starting list: static analysis finds shapes, not meaning.
2. Read the source yourself, in that order, with \`jevx_read\` ("file:<path>"). Use
   \`jevx_related\` (callers, callees, types) and \`jevx_search\` to understand where an input comes
   from and how the result is used. Any line can be a spot — it does not need to be a candidate.
3. For each real opportunity call \`jevx_scorecard\` with your proposal, the 8 feature levels, your
   own score and the generic \`pattern\` (what KIND of code it is, with no names from this repo).
   JevX adds the patterns score and Jev's own opinion and averages them.
4. Do NOT ask the user to pick or approve. Change every STRONG_FIT (70%+, all sources agree)
   directly with your own edit tool — including every caller that must change — so the editor
   shows it in red/green. If the user stated a minimum fit (e.g. "use Jev where the fit is at
   least 55%"), change every fit at or above it instead — but NEVER below 50%, and a
   REVIEW_DISAGREE fit only if the user explicitly allowed disagreeing fits. Leave the rest.
   No edit tool (e.g. Claude Desktop)? Call \`jevx_preview_change\` and then \`jevx_apply\` with the
   proposal id: it backs up, runs the tests and reverts on failure; \`jevx_undo\` restores.
   No project open? Ask the user which folder and pass it as \`root\` on every call.
5. Run the project's tests (and typecheck). If a change breaks something that passed before,
   revert that change and keep the others.
6. Call \`jevx_report\`. If the user opted in to sharing (JEVX_SHARE=1), call \`jevx_share\` with
   the ids you changed. Then tell the user in a few lines: what changed (with scores), what was
   left alone and why, and that every change is visible in Source Control / the diff view.
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
the software. Use the whole scale (the bands are 70%+ strong, 50–69% possible):
0.9 = like real Jev uses — people's free text (or other messy input) is judged, the rule visibly
fails on real inputs, outcomes are bounded · 0.7 = a clear improvement, the rule misses cases users
actually hit · 0.5 = plausible but small, or the rule mostly works · 0.3 = exact rules would do with
a little work · 0.1 = exact logic. Say why in \`ai_reasons\`.
`;
