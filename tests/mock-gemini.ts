import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * A stand-in for the Gemini REST API (generateContent + models.get), driven through the real
 * @google/genai SDK via GEMINI_BASE_URL / baseURL. Behaviour is chosen by markers in the code:
 *   MOCK_GEMINI_BAD_JSON → non-JSON text   MOCK_GEMINI_BAD_SHAPE → JSON missing fields
 *   MOCK_GEMINI_FAIL → HTTP 500            MOCK_GEMINI_SLOW → 3 s delay
 *   MOCK_GEMINI_NEEDS_CALLEE → "context insufficient, need tierFor" until MOCK_CALLEE_BODY is in the prompt
 *   API key "bad-key" → HTTP 400 API_KEY_INVALID (what Google returns for a wrong key)
 */
export interface GeminiCall {
  method: string;
  path: string;
  hasKey: boolean;
  body: { contents?: { parts?: { text?: string }[] }[]; systemInstruction?: unknown; generationConfig?: Record<string, unknown> } | null;
  promptText: string;
}

export const GOOD_ANALYSIS = {
  summary: "Maps a task description to one of several model tiers.",
  decision: "which model tier should handle the task",
  decision_boundary: "task characteristics → model tier",
  inputs: [{ name: "task", role: "the work to be done" }],
  outcomes: ["fast", "smart", "coding"],
  decision_type: "selection",
  deterministic_logic: true,
  approximates_judgment: true,
  judgment_kind: "task complexity / fit",
  plausible_primitive: "choice",
  stays_deterministic: ["the model lookup and return"],
  reasoning: "The rule compares a field with fixed values, but what it encodes is a judgment about task fit.",
  uncertainty: "low",
  context_sufficient: true,
  missing_context: [] as { request: string; why: string }[],
  context_used: [] as string[],
  understanding_confidence: "high",
  model_hypothesis: { label: "STRONG_JEV", note: "debug only" }
};

function reply(promptText: string, key: string | undefined): { status: number; json: unknown; delay?: number } {
  if (key === "bad-key") return { status: 400, json: { error: { code: 400, message: "API key not valid. Please pass a valid API key.", status: "INVALID_ARGUMENT" } } };
  if (promptText.includes("MOCK_GEMINI_FAIL")) return { status: 500, json: { error: { code: 500, message: "internal", status: "INTERNAL" } } };
  let text = JSON.stringify(GOOD_ANALYSIS);
  if (promptText.includes("MOCK_GEMINI_BAD_JSON")) text = "Sure! Here is my analysis: the function picks a model.";
  if (promptText.includes("MOCK_GEMINI_BAD_SHAPE")) text = JSON.stringify({ summary: "x", uncertainty: "extreme" });
  if (promptText.includes("MOCK_GEMINI_NEEDS_CALLEE") && !promptText.includes("MOCK_CALLEE_BODY"))
    text = JSON.stringify({
      ...GOOD_ANALYSIS,
      context_sufficient: false,
      understanding_confidence: "low",
      missing_context: [{ request: "tierFor", why: "the decision depends on what tierFor returns" }]
    });
  return {
    status: 200,
    delay: promptText.includes("MOCK_GEMINI_SLOW") ? 3000 : 0,
    json: {
      candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP", index: 0 }],
      usageMetadata: { promptTokenCount: 800, candidatesTokenCount: 150, totalTokenCount: 950 },
      modelVersion: "mock-gemini"
    }
  };
}

export async function startMockGemini(): Promise<{ url: string; calls: GeminiCall[]; close: () => Promise<void> }> {
  const calls: GeminiCall[] = [];
  const server = createServer((req, res) => {
    let data = "";
    req.on("data", (d) => (data += d));
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://mock");
      const key = (req.headers["x-goog-api-key"] as string | undefined) ?? url.searchParams.get("key") ?? undefined;
      const body = data ? (JSON.parse(data) as GeminiCall["body"]) : null;
      const promptText = (body?.contents ?? []).flatMap((c) => c.parts ?? []).map((p) => p.text ?? "").join("\n");
      calls.push({ method: req.method ?? "GET", path: url.pathname, hasKey: Boolean(key), body, promptText });
      const send = (status: number, json: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(json));
      };
      if (req.method === "GET" && /\/models\/[^/:]+$/.test(url.pathname)) {
        if (key === "bad-key") return send(400, { error: { code: 400, message: "API key not valid.", status: "INVALID_ARGUMENT" } });
        const name = url.pathname.split("/").pop();
        return send(200, { name: `models/${name}`, displayName: `Mock ${name}` });
      }
      if (req.method === "POST" && url.pathname.endsWith(":generateContent")) {
        const r = reply(promptText, key);
        if (r.delay) return void setTimeout(() => send(r.status, r.json), r.delay);
        return send(r.status, r.json);
      }
      send(404, { error: { code: 404, message: "not found" } });
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    calls,
    close: () => new Promise((r) => server.close(() => r()))
  };
}
