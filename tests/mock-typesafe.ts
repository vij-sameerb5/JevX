import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * A stand-in for the TypeSafe API, used by unit tests (via the SDK's `fetch` option) and by
 * CLI end-to-end tests (via TYPESAFE_BASE_URL). Verdicts are driven by markers in the code:
 *   MOCK_REJECT → not semantic   MOCK_FAIL → HTTP 500   otherwise → semantic
 * An API key of "bad-key" gets HTTP 401.
 */

export interface RecordedCall {
  method: string;
  path: string;
  authorization: string | null;
  body: {
    state: {
      decision_code: string;
      enclosing_function: string | null;
      decision_lines: string;
      matched_terms: string[];
      file: string;
      function: string | null;
      language: string;
    };
    questions: Record<string, { type: string }>;
    model?: string;
  } | null;
}

export function answer(body: NonNullable<RecordedCall["body"]>): { status: number; json: unknown } {
  if ("judgment" in body.questions) return answerDecision(body as unknown as { state: { unit_code: string } });
  const code = `${body.state.decision_code}\n${body.state.enclosing_function ?? ""}`;
  if (code.includes("MOCK_FAIL")) return { status: 500, json: { error: "mock failure" } };
  const semantic = code.includes("MOCK_REJECT") ? 0.12 : 0.93;
  const humanText = code.includes("MOCK_REJECT") ? 0.2 : 0.95;
  const kind = code.includes("MOCK_REJECT") ? "not_semantic" : "intent_or_topic";
  return {
    status: 200,
    json: {
      model: "jev-1.13.0",
      answers: {
        semantic: { type: "noul", noul: semantic },
        humanText: { type: "noul", noul: humanText },
        kind: { type: "choice", choice: kind, confidence: 0.81, probabilities: { [kind]: 0.81 } }
      },
      usage: { input_tokens: 420, output_tokens: 3 }
    }
  };
}

/** Phase 1 decision questions (jevx analyze --validate). Same markers, in unit_code. */
function answerDecision(body: { state: { unit_code: string } }): { status: number; json: unknown } {
  const code = body.state.unit_code;
  if (code.includes("MOCK_FAIL")) return { status: 500, json: { error: "mock failure" } };
  const reject = code.includes("MOCK_REJECT");
  const c = (choice: string) => ({ type: "choice", choice, confidence: 0.8, probabilities: { [choice]: 0.8 } });
  return {
    status: 200,
    json: {
      model: "jev-1.13.0",
      answers: {
        judgment: { type: "noul", noul: reject ? 0.1 : 0.9 },
        bounded: { type: "noul", noul: 0.9 },
        deterministic_is_correct: { type: "noul", noul: reject ? 0.9 : 0.1 },
        primitive: c(reject ? "none" : "choice"),
        category: c(reject ? "other" : "routing")
      },
      usage: { input_tokens: 510, output_tokens: 5 }
    }
  };
}

function route(call: RecordedCall): { status: number; json: unknown } {
  if (call.authorization === "Bearer bad-key") return { status: 401, json: { error: "invalid api key" } };
  if (call.method === "GET" && call.path === "/v1/models") {
    return { status: 200, json: { models: [{ name: "jev-1.13.0", description: "mock", release_date: "2026-09-01" }] } };
  }
  if (call.method === "POST" && call.path === "/v1/systemone" && call.body) return answer(call.body);
  return { status: 404, json: { error: "not found" } };
}

/** A fetch implementation for `new TypeSafeClient({ fetch })`. */
export function mockFetch() {
  const calls: RecordedCall[] = [];
  const fetch = async (input: string, init?: RequestInit): Promise<Response> => {
    const url = new URL(input);
    const headers = new Headers(init?.headers);
    const call: RecordedCall = {
      method: init?.method ?? "GET",
      path: url.pathname,
      authorization: headers.get("authorization"),
      body: init?.body ? JSON.parse(String(init.body)) : null
    };
    calls.push(call);
    const { status, json } = route(call);
    return new Response(JSON.stringify(json), { status, headers: { "content-type": "application/json" } });
  };
  return { fetch, calls };
}

/** An HTTP server for CLI tests: point TYPESAFE_BASE_URL at `url`. */
export async function startMockServer(): Promise<{ url: string; calls: RecordedCall[]; close: () => Promise<void> }> {
  const calls: RecordedCall[] = [];
  const server: Server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const call: RecordedCall = {
        method: req.method ?? "GET",
        path: new URL(req.url ?? "/", "http://x").pathname,
        authorization: (req.headers.authorization as string | undefined) ?? null,
        body: raw ? JSON.parse(raw) : null
      };
      calls.push(call);
      const { status, json } = route(call);
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(json));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    calls,
    close: () => new Promise((resolve) => server.close(() => resolve()))
  };
}
