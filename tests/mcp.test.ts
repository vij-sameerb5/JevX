// jevx-mcp end to end: a real MCP client talks to the real server over stdio, the way Claude Code
// or Cursor would, against the helpdesk demo repo and a mock TypeSafe API. The "AI" here is the
// test itself calling tools in the order the guide describes.
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { startMockServer } from "./mock-typesafe.js";
import { combine, patternScore, typesafeScore } from "@jevx/engine";

const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(here, "../apps/jevx/src/mcp.ts");
const DEMO = path.resolve(here, "../examples/jev-demo");

let repo: string;
let ts: Awaited<ReturnType<typeof startMockServer>>;
let client: Client;

const call = async (name: string, args: Record<string, unknown> = {}) => {
  const r = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
  return { text: r.content.map((c) => c.text).join("\n"), isError: Boolean(r.isError) };
};

const ROUTING_PROPOSAL = {
  file: "src/routing.ts",
  start_line: 7,
  end_line: 14,
  decision: "Which team should handle a support ticket, from what the customer wrote.",
  primitive: "choice",
  question: "Which team should handle this support ticket?",
  outcomes: ["billing", "technical", "account", "general"],
  state: ["subject", "body", "channel"],
  deterministic_remainder: "Queueing the ticket for the chosen team, and the SLA from the plan.",
  why: "Keyword lists guess intent: 'I was charged but the app crashes' matches billing first; paraphrases miss every list.",
  features: {
    semantic_ambiguity: "high",
    context_dependence: "high",
    deterministic_expressibility: "low",
    judgment_required: "high",
    rule_stability: "low",
    risk_or_policy_component: "low",
    natural_language_understanding: "high",
    decision_complexity: "medium"
  },
  ai_score: 0.85,
  ai_reasons: "Classic keyword router over free text."
};

beforeAll(async () => {
  repo = mkdtempSync(path.join(tmpdir(), "jevx-mcp-"));
  cpSync(DEMO, repo, { recursive: true });
  // the mock TypeSafe API rejects code carrying this marker: money logic must look deterministic to Jev
  const billing = path.join(repo, "src/billing.ts");
  writeFileSync(billing, readFileSync(billing, "utf8").replace("/** Price of an add-on in cents", "// MOCK_REJECT\n/** Price of an add-on in cents"));
  ts = await startMockServer();
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", SERVER],
    env: { ...(process.env as Record<string, string>), JEVX_ROOT: repo, TYPESAFE_API_KEY: "test-key", TYPESAFE_BASE_URL: ts.url, JEVX_SHARE: "0" },
    stderr: "pipe"
  });
  client = new Client({ name: "jevx-test", version: "0" });
  await client.connect(transport);
}, 60_000);

afterAll(async () => {
  await client?.close();
  await ts?.close();
  rmSync(repo, { recursive: true, force: true });
});

describe("jevx-mcp over stdio", () => {
  it("exposes the tools and the prompt an AI needs", async () => {
    const tools = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(tools).toEqual(["jevx_apply", "jevx_guide", "jevx_preview_change", "jevx_read", "jevx_related", "jevx_report", "jevx_scan", "jevx_scorecard", "jevx_search", "jevx_share", "jevx_undo"]);
    const prompts = (await client.listPrompts()).prompts.map((p) => p.name);
    expect(prompts).toContain("find-jev-opportunities");
    const g = await call("jevx_guide");
    expect(g.text).toMatch(/NOT a Jev opportunity/);
    expect(g.text).toMatch(/Keep the old rule as the fallback/);
    expect(g.text).toMatch(/try\/catch blocks that read an error message/); // balanced, concrete guide
    expect(g.text).toMatch(/NEVER below 50%/);
    expect(g.text).not.toMatch(/Rejecting candidates is a correct answer/);
    const p = await client.getPrompt({ name: "find-jev-opportunities", arguments: {} });
    expect(JSON.stringify(p.messages)).toMatch(/minimum fit/);
  });

  it("scan lists static candidates with ids, and read / related / search navigate the repo", async () => {
    const s = await call("jevx_scan");
    expect(s.isError).toBe(false);
    expect(s.text).toMatch(/src\/routing\.ts:\d+-\d+ routeTicket \[.*outcome-set/);
    expect(s.text).toMatch(/id: unit:src\/routing\.ts#routeTicket@\d+/);
    expect(s.text).toMatch(/Static analysis misses things/);
    expect(s.text).toMatch(/READING ORDER[\s\S]*src\/routing\.ts \(\d+ lines\)/); // the editor's AI reads the files itself
    const overview = await call("jevx_read", { id: "repo:overview" });
    expect(overview.text).toMatch(/helpdesk-demo/);
    expect(overview.text).toMatch(/Tickets arrive from email and chat/);
    const unit = await call("jevx_read", { id: "unit:src/routing.ts#routeTicket@8" });
    expect(unit.text).toMatch(/BILLING_WORDS\.some/);
    const rel = await call("jevx_related", { file: "src/routing.ts", line: 8 });
    expect(rel.text).toMatch(/intake in src\/inbox\.ts \(calls the candidate\)/);
    const found = await call("jevx_search", { query: "priorityOf" });
    expect(found.text).toMatch(/priorityOf in src\/priority\.ts/);
    const missing = await call("jevx_read", { id: "file:nope.ts" });
    expect(missing.isError).toBe(true);
  });

  it("scorecard combines patterns + AI + TypeSafe and saves the proposal without touching code", async () => {
    const before = readFileSync(path.join(repo, "src/routing.ts"), "utf8");
    const r = await call("jevx_scorecard", ROUTING_PROPOSAL);
    expect(r.isError).toBe(false);
    expect(r.text).toMatch(/patterns +█+░* 88%/);
    expect(r.text).toMatch(/AI +█+░* 85%/);
    expect(r.text).toMatch(/TypeSafe +█+░* 81%/);
    expect(r.text).toMatch(/average .* 85%.*STRONG_FIT/);
    expect(r.text).toMatch(/TypeSafe: judgment 0\.90, bounded 0\.90, exact code still right 0\.10, suggests choice \(routing\)/);
    expect(ts.calls.filter((c) => c.path === "/v1/systemone")).toHaveLength(1);
    const sent = ts.calls.at(-1)!.body!.state as unknown as Record<string, unknown>;
    expect(sent.proposed_question).toBe("Which team should handle this support ticket?");
    expect(String(sent.unit_code)).toMatch(/BILLING_WORDS/);
    expect(readFileSync(path.join(repo, "src/routing.ts"), "utf8")).toBe(before);
    expect(existsSync(path.join(repo, ".jevx/proposals/src_routing.ts_L7.json"))).toBe(true);
    // same proposal again → Jev answer comes from the cache
    await call("jevx_scorecard", ROUTING_PROPOSAL);
    expect(ts.calls.filter((c) => c.path === "/v1/systemone")).toHaveLength(1);
  });

  it("the AI and Jev disagreeing on money logic produces REVIEW, not a fake average verdict", async () => {
    const r = await call("jevx_scorecard", {
      ...ROUTING_PROPOSAL,
      file: "src/billing.ts",
      start_line: 15,
      end_line: 21,
      decision: "Discount tier for add-on seats.",
      features: { semantic_ambiguity: "none", deterministic_expressibility: "high", judgment_required: "none", natural_language_understanding: "none" },
      ai_score: 0.7
    });
    expect(r.text).toMatch(/REVIEW_DISAGREE/);
    expect(r.text).toMatch(/fits: ai · doesn't fit: patterns \+ typesafe/);
  });

  it("preview_change shows a red/green diff, changes nothing, and lands in the report", async () => {
    const before = readFileSync(path.join(repo, "src/routing.ts"), "utf8");
    const r = await call("jevx_preview_change", {
      file: "src/routing.ts",
      start_line: 7,
      end_line: 14,
      imports: 'import { TypeSafeClient, choice } from "@typesafe-ai/sdk";',
      new_code: [
        "const jev = new TypeSafeClient();",
        'const TEAM = { team: choice("Which team should handle this support ticket?", { billing: "Payments and refunds", technical: "Bugs and outages", account: "Login and access", general: "Anything else" }) };',
        "",
        "/** Which team handles the ticket — judged by Jev, keyword rules as the fallback. */",
        "export async function routeTicket(t: Ticket): Promise<Team> {",
        "  try {",
        "    const { answers } = await jev.systemOne({ state: { subject: t.subject, body: t.body }, questions: TEAM });",
        "    return answers.team.choice;",
        "  } catch {",
        "    return legacyRouteTicket(t);",
        "  }",
        "}"
      ].join("\n")
    });
    expect(r.isError).toBe(false);
    expect(r.text).toMatch(/NOT applied/);
    expect(r.text).toMatch(/```diff\n@@/);
    expect(r.text).toMatch(/^-export function routeTicket\(t: Ticket\): Team \{$/m);
    expect(r.text).toMatch(/^\+export async function routeTicket\(t: Ticket\): Promise<Team> \{$/m);
    expect(r.text).toMatch(/^\+import \{ TypeSafeClient, choice \} from "@typesafe-ai\/sdk";$/m);
    expect(r.text).toMatch(/Scorecard: STRONG_FIT · average 85%/);
    expect(readFileSync(path.join(repo, "src/routing.ts"), "utf8")).toBe(before);
    expect(readFileSync(path.join(repo, ".jevx/proposals/src_routing.ts_L7.patch"), "utf8")).toMatch(/\+\s+return answers\.team\.choice;/);
    const html = readFileSync(path.join(repo, ".jevx/report.html"), "utf8");
    expect(html).toMatch(/class="ln add">\+export async function routeTicket/);
    expect(html).toMatch(/class="ln del">-export function routeTicket/);
    expect(html).toMatch(/Strong fit · 85%/);
    expect(html).toMatch(/Sources disagree/);
  });

  it("scorecard accepts the generic pattern; jevx_share is off unless the user opted in", async () => {
    const r = await call("jevx_scorecard", {
      file: "src/priority.ts", start_line: 4, end_line: 12, decision: "How urgent a ticket is.", primitive: "choice", question: "How urgently does this customer need help?",
      outcomes: ["urgent", "normal", "low"], state: ["subject", "body"], deterministic_remainder: "Due time.", why: "Punctuation stands in for urgency.",
      features: { judgment_required: "high", semantic_ambiguity: "high" }, ai_score: 0.8, ai_reasons: "tone ≠ urgency",
      pattern: { label: "Punctuation Urgency Heuristic", input_kind: "user_text", rule_kind: "includes_or_startswith", rule_shape: "exclamation marks decide urgency", why_generic: "tone is not urgency" }
    });
    expect(r.isError).toBe(false);
    const saved = JSON.parse(readFileSync(path.join(repo, ".jevx/proposals/src_priority.ts_L4.json"), "utf8"));
    expect(saved.pattern).toMatchObject({ label: "punctuation-urgency-heuristic", rule_kind: "includes_or_startswith" });
    const sh = await call("jevx_share", { changed: [] });
    expect(sh.text).toMatch(/Sharing is off/);
  });

  it("jevx_apply writes a previewed change (tests before/after), refuses stale previews, and jevx_undo restores", async () => {
    const before = readFileSync(path.join(repo, "src/routing.ts"), "utf8");
    await call("jevx_scorecard", {
      file: "src/routing.ts", start_line: 8, end_line: 14, decision: "Which team.", primitive: "choice", question: "Which team?", outcomes: ["billing", "technical"], state: ["body"],
      deterministic_remainder: "", why: "keywords", features: { judgment_required: "high", semantic_ambiguity: "high", natural_language_understanding: "high" }, ai_score: 0.9, ai_reasons: "x"
    });
    const lines = before.split("\n");
    await call("jevx_preview_change", { file: "src/routing.ts", start_line: 8, end_line: 8, new_code: `${lines[7]} // applied by jevx_apply` });
    const a = await call("jevx_apply", { id: "src_routing.ts_L8" });
    expect(a.isError).toBe(false);
    expect(a.text).toMatch(/Applied src_routing\.ts_L8/);
    expect(readFileSync(path.join(repo, "src/routing.ts"), "utf8")).toMatch(/applied by jevx_apply/);
    const again = await call("jevx_apply", { id: "src_routing.ts_L8" });
    expect(again.text).toMatch(/changed since the preview/);
    const u = await call("jevx_undo");
    expect(u.text).toMatch(/Restored \d file\(s\): src\/routing\.ts/);
    expect(readFileSync(path.join(repo, "src/routing.ts"), "utf8")).toBe(before);
  });

  it("refuses to index / or the home folder", async () => {
    const r = await call("jevx_scan", { root: "/" });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/is not a project folder/);
  });

  it("report summarises every proposal with its three scores", async () => {
    const r = await call("jevx_report");
    expect(r.text).toMatch(/\| src\/routing\.ts:7 \| choice \| 88% \| 85% \| 81% \| \*\*85%\*\* \| STRONG_FIT \| yes \|/);
    expect(r.text).toMatch(/\| src\/billing\.ts:15 \| choice \| 0% \| 70% \| 9% \| \*\*26%\*\* \| REVIEW_DISAGREE \| — \|/);
  });

  it("rejects line ranges outside the file instead of guessing", async () => {
    const r = await call("jevx_preview_change", { file: "src/routing.ts", start_line: 5, end_line: 999, new_code: "x" });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/outside src\/routing\.ts/);
  });
});

describe("scorecard maths", () => {
  it("patterns compare each level with the Jev side and the deterministic side", () => {
    expect(patternScore({ semantic_ambiguity: "high", judgment_required: "high" }).score).toBe(1);
    expect(patternScore({ semantic_ambiguity: "none", judgment_required: "none" }).score).toBe(0);
    expect(patternScore({ semantic_ambiguity: "unknown" }).score).toBeUndefined();
    const mid = patternScore({ decision_complexity: "medium", semantic_ambiguity: "none" });
    expect(mid.matches.map((m) => m.looksLike)).toEqual(["deterministic", "jev"]);
  });

  it("TypeSafe score rewards judgment and bounded outcomes, penalises 'exact code is right'", () => {
    expect(typesafeScore({ judgment: 0.9, bounded: 0.9, deterministicIsCorrect: 0.1, primitive: "choice", primitiveConfidence: 0.8, category: "routing" })).toBeCloseTo(0.81);
    expect(typesafeScore({ judgment: 0.1, bounded: 0.9, deterministicIsCorrect: 0.9, primitive: "none", primitiveConfidence: 0.8, category: "other" })).toBeCloseTo(0.09, 3);
    // the GlobalCare status→colour map: bounded but no judgment — must not read as a fit any more (was 62%)
    expect(typesafeScore({ judgment: 0.07, bounded: 0.98, deterministicIsCorrect: 0.19, primitive: "choice", primitiveConfidence: 0.5, category: "ui" })).toBeLessThan(0.5);
  });

  it("averages what is available, says what is missing, and flags disagreement", () => {
    expect(combine({ patterns: 0.8, ai: 0.9 })).toMatchObject({ verdict: "STRONG_FIT", missing: ["typesafe"] });
    expect(combine({ patterns: 0.6, ai: 0.55, typesafe: 0.5 }).verdict).toBe("POSSIBLE_FIT");
    expect(combine({ patterns: 0.2, ai: 0.3, typesafe: 0.1 }).verdict).toBe("WEAK_FIT");
    expect(combine({ patterns: 0.9, ai: 0.9, typesafe: 0.2 }).verdict).toBe("REVIEW_DISAGREE");
    expect(combine({}).verdict).toBe("WEAK_FIT");
  });
});
