// Stand-in answers for the autonomous run (`jevx`) on examples/jev-demo, served by the mock xAI
// API. Picked by the response schema: read (spots), survey (inspect/missed), assess (is_opportunity),
// edit (edits). The read answer only names spots in files the prompt actually showed.
//   routeTicket  → strong fit; the edit also updates its caller in src/inbox.ts
//   priorityOf   → strong fit; its edit contains BROKEN (the demo's test script fails on it)
//   addonPrice   → not an opportunity (exact pricing)
//   intake       → "missed" by static analysis, assessed as not an opportunity
const feats = (level: "high" | "mid" | "none") =>
  level === "mid"
    ? { semantic_ambiguity: "medium", context_dependence: "medium", deterministic_expressibility: "medium", judgment_required: "medium", rule_stability: "medium", risk_or_policy_component: "low", natural_language_understanding: "low", decision_complexity: "medium" }
    : level === "high"
    ? { semantic_ambiguity: "high", context_dependence: "high", deterministic_expressibility: "low", judgment_required: "high", rule_stability: "low", risk_or_policy_component: "low", natural_language_understanding: "high", decision_complexity: "medium" }
    : { semantic_ambiguity: "none", context_dependence: "none", deterministic_expressibility: "high", judgment_required: "none", rule_stability: "high", risk_or_policy_component: "low", natural_language_understanding: "none", decision_complexity: "low" };

const done = { context_sufficient: true, missing_context: [], context_used: [], understanding_confidence: "high" };

const SPOTS = [
  { file: "src/routing.ts", start_line: 8, end_line: 20, function: "routeTicket", decision: "Which team handles a ticket", primitive: "choice", why: "keyword lists guess intent", confidence: 0.9 },
  { file: "src/priority.ts", start_line: 4, end_line: 12, function: "priorityOf", decision: "How urgent a ticket is", primitive: "choice", why: "exclamation marks stand in for urgency", confidence: 0.85 },
  { file: "src/inbox.ts", start_line: 6, end_line: 12, function: "intake", decision: "Routing and priority together", primitive: "choice", why: "combines two guesses", confidence: 0.5 },
  { file: "src/billing.ts", start_line: 16, end_line: 20, function: "addonPrice", decision: "Add-on price", primitive: "score", why: "tiers", confidence: 0.3 }
];

export function engineAnswerFor(props: Record<string, unknown>, prompt: string): unknown | undefined {
  if ("spots" in props) {
    if (prompt.includes("MOCK_READ_FAILS")) return "not an object";
    return { spots: SPOTS.filter((s) => prompt.includes(`=== FILE ${s.file} `)) };
  }
  if ("inspect" in props) {
    const ids = [...prompt.matchAll(/"id": "(unit:[^"]+)"/g)].map((m) => m[1]!);
    return {
      inspect: ids.filter((id) => /routeTicket|priorityOf|addonPrice/.test(id)).map((id) => ({ id, why: "chooses between outcomes" })),
      missed: [{ file: "src/inbox.ts", function: "intake", why: "combines routing and priority" }]
    };
  }
  if ("is_opportunity" in props) {
    const loc = prompt.match(/LOCATION TO ASSESS: (\S+)/)?.[1] ?? "";
    if (loc.startsWith("src/routing.ts"))
      return { is_opportunity: true, decision: "Which team handles a ticket.", primitive: "choice", question: "Which team should handle this support ticket?", outcomes: ["billing", "technical", "account", "general"], state: ["subject", "body"], deterministic_remainder: "Queueing and SLA.", why: "Keyword lists guess intent and miss paraphrases.", features: feats("high"), ai_score: 0.86, ...done };
    if (loc.startsWith("src/priority.ts"))
      return { is_opportunity: true, decision: "How urgent a ticket is.", primitive: "choice", question: "How urgently does this customer need help?", outcomes: ["urgent", "normal", "low"], state: ["subject", "body"], deterministic_remainder: "Due time from the SLA.", why: "Exclamation marks stand in for urgency.", features: feats("high"), ai_score: 0.8, ...done };
    if (loc.startsWith("src/inbox.ts"))
      return { is_opportunity: true, decision: "How soon an urgent ticket is due.", primitive: "score", question: "How soon should this ticket be answered?", outcomes: ["2h", "4h", "SLA"], state: ["priority", "plan"], deterministic_remainder: "The SLA cap.", why: "A fixed 2-hour rule for every urgent ticket.", features: feats("mid"), ai_score: 0.6, ...done };
    return { is_opportunity: false, decision: "Exact logic.", primitive: "none", question: "", outcomes: [], state: [], deterministic_remainder: "All of it.", why: "Exact rules over typed values.", features: feats("none"), ai_score: 0.05, ...done };
  }
  if ("edits" in props) {
    if (/APPROVED JEV DECISION at src\/routing\.ts/.test(prompt))
      return {
        edits: [
          { file: "src/routing.ts", find: 'import type { Team, Ticket } from "./types.js";', replace: 'import { TypeSafeClient, choice } from "@typesafe-ai/sdk";\nimport type { Team, Ticket } from "./types.js";\n\nconst jev = new TypeSafeClient();\nconst TEAM = { team: choice("Which team should handle this support ticket?", { billing: "Payments and refunds", technical: "Bugs and outages", account: "Login and access", general: "Anything else" }) };' },
          {
            file: "src/routing.ts",
            find: "export function routeTicket(t: Ticket): Team {",
            replace:
              "export async function routeTicket(t: Ticket): Promise<Team> {\n  try {\n    const { answers } = await jev.systemOne({ state: { subject: t.subject, body: t.body }, questions: TEAM });\n    return answers.team.choice;\n  } catch {\n    return legacyRouteTicket(t);\n  }\n}\n\nfunction legacyRouteTicket(t: Ticket): Team {"
          },
          { file: "src/inbox.ts", find: "export function intake(t: Ticket) {", replace: "export async function intake(t: Ticket) {" },
          { file: "src/inbox.ts", find: "const team = routeTicket(t);", replace: "const team = await routeTicket(t);" }
        ],
        summary: "routeTicket asks Jev which team; keyword rules stay as the fallback; intake awaits it."
      };
    if (/APPROVED JEV DECISION at src\/inbox\.ts/.test(prompt))
      return { edits: [{ file: "src/inbox.ts", find: "  const dueInHours = ", replace: "  // POSSIBLE_EDIT\n  const dueInHours = " }], summary: "due time from Jev" };
    if (/APPROVED JEV DECISION at src\/priority\.ts/.test(prompt))
      return { edits: [{ file: "src/priority.ts", find: "export function priorityOf(t: Ticket): Priority {", replace: "// BROKEN\nexport function priorityOf(t: Ticket): Priority {" }], summary: "urgency from Jev" };
    return { edits: [{ file: "src/nope.ts", find: "x", replace: "y" }], summary: "" };
  }
  return undefined;
}
