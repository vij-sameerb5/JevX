import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { GOOD_ANALYSIS } from "./mock-gemini.js";

/**
 * A stand-in for the OpenRouter REST API (POST /chat/completions, GET /key, GET /models),
 * reached through OPENROUTER_BASE_URL / baseURL. Never the real API. Behaviour by markers in
 * the user message:
 *   MOCK_OR_BAD_JSON → non-JSON content     MOCK_OR_429 → HTTP 429 rate limit
 *   MOCK_OR_500 → HTTP 500                  MOCK_OR_SLOW → 1.5 s delay
 *   MOCK_OR_ERROR_IN_BODY → 200 with an error object (provider failure)
 *   MOCK_OR_PARTS → content as an array of text parts
 *   MOCK_OR_SECRET → the answer contains a secret-looking token (must be scrubbed)
 *   MOCK_GEMINI_NEEDS_CALLEE → "insufficient, need tierFor" until MOCK_CALLEE_BODY is in the prompt
 *   Authorization "Bearer bad-key" → HTTP 401
 */
export interface OpenRouterCall {
  method: string;
  path: string;
  auth: string | undefined;
  rawBody: string;
  body: {
    model?: string;
    messages?: { role: string; content: string }[];
    response_format?: { type: string; json_schema?: { name: string; strict: boolean; schema: unknown } };
    temperature?: number;
  } | null;
  promptText: string;
}

export const MOCK_OR_MODELS = [
  { id: "x-ai/grok-4.6", name: "xAI: Grok 4.6" },
  { id: "deepseek/deepseek-v4-flash-0731:free", name: "DeepSeek V4 Flash (free)" },
  { id: "other/model", name: "Other" }
];

const feat = (level: string) =>
  Object.fromEntries(
    ["semantic_ambiguity", "context_dependence", "deterministic_expressibility", "judgment_required", "rule_stability", "risk_or_policy_component", "natural_language_understanding", "decision_complexity"].map((k) => [
      k,
      { level: k === "deterministic_expressibility" ? (level === "high" ? "low" : "high") : level, evidence: `${k} looks ${level}` }
    ])
  );

/** M5b "why Jev here?" answer (schema b1). */
export const GOOD_USAGE = {
  decision: {
    what_is_decided: "whether an agent tool call should be allowed, asked about, or denied",
    inputs: [{ name: "input", source: "the agent's tool call", role: "the command whose intent must be judged" }],
    outcomes: ["allow", "ask", "deny"],
    downstream_action: "the host blocks or prompts before running the tool",
    nature: "semantic_judgment"
  },
  jev_questions: [{ key: "risk", primitive: "score", what_it_asks: "how destructive the action is" }],
  features: feat("high"),
  why_jev_hypotheses: [
    { id: "semantic_interpretation", assessment: "supported", evidence: "the command text must be interpreted" },
    { id: "risk_assessment", assessment: "supported", evidence: "the score is a risk level" }
  ],
  not_reasons: [
    { id: "large_function", assessment: "contradicted", note: "the function is short" },
    { id: "many_branches", assessment: "contradicted", note: "two branches" }
  ],
  why_jev: {
    observed: [{ claim: "the question asks how destructive a shell command is", evidence: [{ location: "src/guard.ts:12", observation: "score question over the tool input" }] }],
    inferred: [{ claim: "destructiveness depends on meaning, not on exact tokens", evidence: [{ location: "src/guard.ts:12", observation: "free-form command text" }] }],
    unknown: ["whether the developer tried regex rules first"]
  },
  deterministic_alternative: { what_rules_would_need: "an allow/deny list of command patterns", adequacy: "fragile: novel commands slip through" },
  confidence: "high",
  context_sufficient: true,
  missing_context: [] as { request: string; why: string }[],
  context_used: ["file:src/guard.ts"],
  understanding_confidence: "high"
};

export function contrastAnswerFor(promptText: string) {
  const ids = [...promptText.matchAll(/"contrast_id": "(c\d+)"/g)].map((m) => m[1]!);
  return {
    contrasts: ids.map((id) => ({
      contrast_id: id,
      is_a_real_decision: true,
      decision: { what_is_decided: "which tier a model name maps to", inputs: [{ name: "model", source: "config", role: "a name" }], outcomes: ["fast", "smart"], downstream_action: "routes the request", nature: "exact_rule" },
      features: feat("low"),
      why_deterministic: {
        observed: [{ claim: "the tier comes from a fixed regex over the model name", evidence: [{ location: "src/tiers.ts:3", observation: "regex test" }] }],
        inferred: [{ claim: "model names follow a naming convention, so exact matching suffices", evidence: [] }],
        unknown: ["whether the developer considered Jev here"]
      },
      differences_from_jev_site: [{ claim: "the input is an identifier, not free text", evidence: [] }],
      shares_jev_site_traits: "no",
      confidence: "high"
    })),
    context_sufficient: true,
    missing_context: [],
    context_used: [],
    understanding_confidence: "high"
  };
}

/**
 * Layer E synthesis (schema e1): the model words the groups JevX counted, one answer per group_id.
 * Markers in the prompt: MOCK_E_REJECT → the first group is answered supported_by_the_counts=false;
 * the answer also contains one group_id JevX never sent, which must be dropped.
 */
export function synthesisAnswerFor(promptText: string) {
  const ids = [...promptText.matchAll(/"group_id": "([^"]+)"/g)].map((m) => m[1]!);
  const reject = promptText.includes("MOCK_E_REJECT");
  return {
    groups: [
      ...ids.map((id, i) => ({
        group_id: id,
        supported_by_the_counts: !(reject && i === 0),
        statement: `${id}: the Jev decision turns on meaning the exact code beside it never reads`,
        side: id.startsWith("why_jev:") ? "jev" : "separator",
        caveat: "one project could dominate this"
      })),
      { group_id: "feature:invented_by_the_model", supported_by_the_counts: true, statement: "a group JevX never counted", side: "separator", caveat: "" }
    ],
    open_questions: ["does this hold outside security tools?"]
  };
}

function reply(promptText: string, schema?: { properties?: Record<string, unknown> }): { status: number; json: unknown; delay?: number } {
  if (promptText.includes("MOCK_OR_404")) return { status: 404, json: { error: { code: 404, message: "This model is unavailable" } } };
  if (promptText.includes("MOCK_OR_429")) return { status: 429, json: { error: { code: 429, message: "Rate limit exceeded: free-models-per-min" } } };
  if (promptText.includes("MOCK_OR_500")) return { status: 500, json: { error: { code: 500, message: "internal" } } };
  if (promptText.includes("MOCK_OR_ERROR_IN_BODY")) return { status: 200, json: { error: { code: 502, message: "upstream provider error" } } };
  let text = JSON.stringify(GOOD_ANALYSIS);
  const props = schema?.properties ?? {};
  if ("why_jev" in props) text = JSON.stringify(GOOD_USAGE);
  else if ("contrasts" in props) text = JSON.stringify(contrastAnswerFor(promptText));
  else if ("groups" in props) text = JSON.stringify(synthesisAnswerFor(promptText));
  if (promptText.includes("MOCK_OR_BAD_JSON")) text = "Sure! The function picks a model.";
  if (promptText.includes("MOCK_OR_SECRET")) text = JSON.stringify({ ...GOOD_ANALYSIS, reasoning: "It uses the key sk-live-abcdefghijklmnopqrstuvwx to decide." });
  if (promptText.includes("MOCK_GEMINI_NEEDS_CALLEE") && !promptText.includes("MOCK_CALLEE_BODY"))
    text = JSON.stringify({
      ...GOOD_ANALYSIS,
      context_sufficient: false,
      understanding_confidence: "low",
      missing_context: [{ request: "tierFor", why: "the decision depends on what tierFor returns" }]
    });
  const content: unknown = promptText.includes("MOCK_OR_PARTS") ? [{ type: "text", text: text.slice(0, 20) }, { type: "text", text: text.slice(20) }] : text;
  return {
    status: 200,
    delay: promptText.includes("MOCK_OR_SLOW") ? 1500 : 0,
    json: {
      id: "gen-mock",
      model: "x-ai/grok-4.6",
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }],
      usage: { prompt_tokens: 900, completion_tokens: 160, total_tokens: 1060, cost: 0.00276, completion_tokens_details: { reasoning_tokens: 40 } }
    }
  };
}

export async function startMockOpenRouter(): Promise<{ url: string; calls: OpenRouterCall[]; close: () => Promise<void> }> {
  const calls: OpenRouterCall[] = [];
  const server = createServer((req, res) => {
    let data = "";
    req.on("data", (d) => (data += d));
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://mock");
      const auth = req.headers.authorization;
      const body = data ? (JSON.parse(data) as OpenRouterCall["body"]) : null;
      const promptText = (body?.messages ?? []).filter((m) => m.role === "user").map((m) => m.content).join("\n");
      calls.push({ method: req.method ?? "GET", path: url.pathname, auth, rawBody: data, body, promptText });
      const send = (status: number, json: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(json));
      };
      if (auth === "Bearer bad-key") return send(401, { error: { code: 401, message: "No auth credentials found" } });
      if (req.method === "GET" && url.pathname.endsWith("/key")) return send(200, { data: { label: "sk-or-v1-abc…", limit: null, usage: 0, is_free_tier: true } });
      if (req.method === "GET" && url.pathname.endsWith("/models")) return send(200, { data: MOCK_OR_MODELS });
      if (req.method === "POST" && url.pathname.endsWith("/chat/completions")) {
        const r = reply(promptText, body?.response_format?.json_schema?.schema as { properties?: Record<string, unknown> } | undefined);
        if (r.delay) return void setTimeout(() => send(r.status, r.json), r.delay);
        return send(r.status, r.json);
      }
      send(404, { error: { code: 404, message: "not found" } });
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/api/v1`,
    calls,
    close: () =>
      new Promise((r) => {
        server.closeAllConnections();
        server.close(() => r());
      })
  };
}
