// A scripted run of jevx-mcp against examples/jev-demo, playing the part of the user's AI:
// guide → scan → read → scorecard (two real opportunities + one to reject) → preview → report.
// Writes <copy>/.jevx/report.html and prints its path. No source file is changed.
//
//   pnpm tsx scripts/mcp-demo.ts                    TypeSafe via TYPESAFE_API_KEY (skipped if unset)
//   pnpm tsx scripts/mcp-demo.ts --mock-typesafe    TypeSafe answers from the test mock (offline demo)
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = mkdtempSync(path.join(tmpdir(), "jevx-demo-"));
cpSync(path.join(here, "..", "examples", "jev-demo"), repo, { recursive: true });

const env: Record<string, string> = { ...(process.env as Record<string, string>), JEVX_ROOT: repo };
let mock: { url: string; close: () => Promise<void> } | undefined;
if (process.argv.includes("--mock-typesafe")) {
  const { startMockServer } = await import("../tests/mock-typesafe.js");
  mock = await startMockServer();
  Object.assign(env, { TYPESAFE_API_KEY: "demo-key", TYPESAFE_BASE_URL: mock.url });
  // The mock says "fits" to everything unless the code carries this marker. Real Jev judges the
  // pricing code itself; the offline mock needs telling. Same line, so line numbers don't move.
  const billing = path.join(repo, "src", "billing.ts");
  writeFileSync(billing, readFileSync(billing, "utf8").replaceAll("must stay exact. */", "must stay exact. */ // MOCK_REJECT"));
}

const client = new Client({ name: "jevx-demo", version: "0" });
await client.connect(new StdioClientTransport({ command: "npx", args: ["tsx", path.join(here, "..", "apps", "jevx", "src", "mcp.ts")], env, stderr: "ignore" }));
const call = async (name: string, args: Record<string, unknown> = {}) => {
  const r = (await client.callTool({ name, arguments: args })) as { content: { text: string }[] };
  const t = r.content.map((c) => c.text).join("\n");
  console.log(`\n── ${name} ──\n${t}`);
  return t;
};

await call("jevx_scan");
await call("jevx_scorecard", {
  file: "src/routing.ts",
  start_line: 7,
  end_line: 14,
  decision: "Which team should handle a support ticket, from what the customer wrote.",
  primitive: "choice",
  question: "Which team should handle this support ticket?",
  outcomes: ["billing", "technical", "account", "general"],
  state: ["subject", "body"],
  deterministic_remainder: "Queueing the ticket for the chosen team; SLA hours from the plan.",
  why: "Keyword lists guess intent: 'charged twice and now the app crashes' routes to billing first, and paraphrases ('my card was debited') miss every list.",
  features: { semantic_ambiguity: "high", context_dependence: "high", deterministic_expressibility: "low", judgment_required: "high", rule_stability: "low", risk_or_policy_component: "low", natural_language_understanding: "high", decision_complexity: "medium" },
  ai_score: 0.86,
  ai_reasons: "A keyword router over free text; the outcome set is small and fixed."
});
await call("jevx_preview_change", {
  file: "src/routing.ts",
  start_line: 7,
  end_line: 14,
  imports: 'import { TypeSafeClient, choice } from "@typesafe-ai/sdk";',
  new_code: [
    "const jev = new TypeSafeClient();",
    "",
    "const TEAM = {",
    '  team: choice("Which team should handle this support ticket?", {',
    '    billing: "Payments, invoices, refunds, plans",',
    '    technical: "Bugs, errors, outages, integrations",',
    '    account: "Login, access, profile, security settings",',
    '    general: "Anything else"',
    "  })",
    "};",
    "",
    "/** Which team handles the ticket — Jev reads what the customer meant; the keyword rules stay as the fallback. */",
    "export async function routeTicket(t: Ticket): Promise<Team> {",
    "  try {",
    "    const { answers } = await jev.systemOne({ state: { subject: t.subject, body: t.body }, questions: TEAM });",
    "    return answers.team.choice;",
    "  } catch {",
    "    return legacyRouteTicket(t);",
    "  }",
    "}",
    "",
    "function legacyRouteTicket(t: Ticket): Team {",
    "  const text = `${t.subject} ${t.body}`.toLowerCase();",
    '  if (BILLING_WORDS.some((w) => text.includes(w))) return "billing";',
    '  if (TECH_WORDS.some((w) => text.includes(w))) return "technical";',
    '  if (ACCOUNT_WORDS.some((w) => text.includes(w))) return "account";',
    '  return "general";',
    "}"
  ].join("\n")
});
await call("jevx_scorecard", {
  file: "src/priority.ts",
  start_line: 3,
  end_line: 11,
  decision: "How urgently a ticket needs a human.",
  primitive: "choice",
  question: "How urgently does this customer need help?",
  outcomes: ["urgent", "normal", "low"],
  state: ["subject", "body"],
  deterministic_remainder: "Due time from the SLA; urgent tickets capped at 2 hours.",
  why: "Exclamation marks and an all-caps subject stand in for urgency; 'we lost all our data' has neither.",
  features: { semantic_ambiguity: "high", context_dependence: "medium", deterministic_expressibility: "low", judgment_required: "high", rule_stability: "low", risk_or_policy_component: "medium", natural_language_understanding: "high", decision_complexity: "medium" },
  ai_score: 0.78,
  ai_reasons: "Urgency is a reading of the message; the regex list is a proxy."
});
await call("jevx_scorecard", {
  file: "src/billing.ts",
  start_line: 15,
  end_line: 20,
  decision: "Seat price and volume discount for an add-on.",
  primitive: "choice",
  question: "Which discount tier applies?",
  outcomes: ["none", "10%", "20%"],
  state: ["plan", "seats"],
  deterministic_remainder: "Everything — this is money.",
  why: "Checked because static analysis flagged it; it is an exact price table.",
  features: { semantic_ambiguity: "none", context_dependence: "none", deterministic_expressibility: "high", judgment_required: "none", rule_stability: "high", risk_or_policy_component: "low", natural_language_understanding: "none", decision_complexity: "low" },
  ai_score: 0.05,
  ai_reasons: "Exact pricing rules; must stay deterministic."
});
await call("jevx_report");
await client.close();
await mock?.close();
console.log(`\nReport: ${path.join(repo, ".jevx", "report.html")}${mock ? "  (TypeSafe answers came from the offline test mock)" : ""}`);
