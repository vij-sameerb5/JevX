import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { GOOD_ANALYSIS } from "./mock-gemini.js";
import { engineAnswerFor } from "./mock-engine.js";
import { GOOD_USAGE, contrastAnswerFor, synthesisAnswerFor } from "./mock-openrouter.js";

/**
 * A stand-in for the DIRECT xAI API (POST /v1/responses, GET /v1/models), reached through
 * XAI_BASE_URL / baseURL. Never the real API. Behaviour by markers in the input:
 *   MOCK_XAI_BAD_JSON → non-JSON answer      MOCK_XAI_429 → rate limited once, then fine
 *   MOCK_XAI_500 → HTTP 500                  MOCK_XAI_404 → model unavailable (fatal)
 *   MOCK_XAI_SLOW → 1.5 s delay              MOCK_XAI_PARTS → answer split across output items
 *   MOCK_XAI_SECRET → answer carries a secret-looking token (must be scrubbed)
 *   MOCK_GEMINI_NEEDS_CALLEE → "insufficient, need tierFor" until MOCK_CALLEE_BODY is in the input
 *   Authorization "Bearer bad-key" → HTTP 401
 */
export interface XaiCall {
  method: string;
  path: string;
  auth: string | undefined;
  rawBody: string;
  body: { model?: string; instructions?: string; input?: string; text?: { format?: { type?: string; name?: string; strict?: boolean; schema?: { properties?: Record<string, unknown> } } }; temperature?: number; max_output_tokens?: number } | null;
  promptText: string;
}

export const MOCK_XAI_MODELS = [{ id: "grok-4.6" }, { id: "grok-4.3" }];

export async function startMockXai(): Promise<{ url: string; calls: XaiCall[]; rateLimited: Set<string>; close: () => Promise<void> }> {
  const calls: XaiCall[] = [];
  const rateLimited = new Set<string>();
  const server = createServer((req, res) => {
    let data = "";
    req.on("data", (d) => (data += d));
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://mock");
      const auth = req.headers.authorization;
      const body = data ? (JSON.parse(data) as XaiCall["body"]) : null;
      const prompt = `${body?.instructions ?? ""}\n${body?.input ?? ""}`;
      calls.push({ method: req.method ?? "GET", path: url.pathname, auth, rawBody: data, body, promptText: prompt });
      const send = (status: number, json: unknown, delay = 0) => {
        const write = () => {
          res.writeHead(status, { "content-type": "application/json" });
          res.end(JSON.stringify(json));
        };
        if (delay) setTimeout(write, delay);
        else write();
      };
      if (auth === "Bearer bad-key") return send(401, { error: { message: "Incorrect API key provided" } });
      if (req.method === "GET" && url.pathname.endsWith("/models")) return send(200, { data: MOCK_XAI_MODELS });
      if (req.method !== "POST" || !url.pathname.endsWith("/responses")) return send(404, { error: { message: "not found" } });
      if (prompt.includes("MOCK_XAI_404")) return send(404, { error: { message: "The model grok-9 does not exist" } });
      if (prompt.includes("MOCK_XAI_500")) return send(500, { error: { message: "internal" } });
      if (prompt.includes("MOCK_XAI_429") && !rateLimited.has("hit")) {
        rateLimited.add("hit");
        return send(429, { error: { message: "rate limit exceeded" } });
      }
      const props = body?.text?.format?.schema?.properties ?? {};
      let text = JSON.stringify(GOOD_ANALYSIS);
      const engine = engineAnswerFor(props, prompt);
      if (engine) text = JSON.stringify(engine);
      else if ("why_jev" in props) text = JSON.stringify(GOOD_USAGE);
      else if ("contrasts" in props) text = JSON.stringify(contrastAnswerFor(prompt));
      else if ("groups" in props) text = JSON.stringify(synthesisAnswerFor(prompt));
      else if (!body?.text) text = "ready"; // the tiny smoke test asks for no schema
      if (prompt.includes("MOCK_XAI_BAD_JSON")) text = "Sure — the function picks a model.";
      if (prompt.includes("MOCK_XAI_SECRET")) text = JSON.stringify({ ...GOOD_USAGE, deterministic_alternative: { what_rules_would_need: "hardcode sk-live-abcdefghijklmnopqrstuvwx", adequacy: "no" } });
      if (prompt.includes("MOCK_GEMINI_NEEDS_CALLEE") && !prompt.includes("MOCK_CALLEE_BODY"))
        text = JSON.stringify({ ...GOOD_USAGE, context_sufficient: false, understanding_confidence: "low", missing_context: [{ request: "tierFor", why: "the outcome depends on tierFor" }] });
      const usage = { input_tokens: 1000, output_tokens: 200, total_tokens: 1200, cached_tokens: 128, reasoning_tokens: 64 };
      const json = prompt.includes("MOCK_XAI_PARTS")
        ? { id: "resp_mock", status: "completed", output: [{ type: "reasoning", content: [] }, { type: "message", content: [{ type: "output_text", text: text.slice(0, 15) }, { type: "output_text", text: text.slice(15) }] }], usage }
        : { id: "resp_mock", status: "completed", output_text: text, output: [{ type: "message", content: [{ type: "output_text", text }] }], usage };
      send(200, json, prompt.includes("MOCK_XAI_SLOW") ? 1500 : 0);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/v1`,
    calls,
    rateLimited,
    close: () =>
      new Promise((r) => {
        server.closeAllConnections();
        server.close(() => r());
      })
  };
}
