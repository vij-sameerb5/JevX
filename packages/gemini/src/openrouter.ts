// OpenRouter as a second CODE-ANALYST provider. Only the transport differs from Gemini: the
// adaptive context loop, prompt, JSON schema, parser (validation + secret scrubbing), cache and
// dataset rules are shared. Plain fetch, no SDK. The key comes from OPENROUTER_API_KEY only; it
// is sent in the Authorization header and nowhere else, and never appears in errors or caches.
import { GeminiCallError, type GeminiTransport } from "./client.js";

/** Primary code analyst for M5b (paid credits). Override: --openrouter-model / OPENROUTER_MODEL / openrouter.model. */
export const DEFAULT_OPENROUTER_MODEL = "x-ai/grok-4.6";
export const DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
/** Large-context analyses can take a while; override with OPENROUTER_TIMEOUT_MS or openrouter.timeoutMs. */
export const DEFAULT_OPENROUTER_TIMEOUT_MS = 120_000;
export const DEFAULT_OPENROUTER_CONCURRENCY = 2;

export interface OpenRouterSettings {
  apiKey?: string;
  model?: string;
  baseURL?: string;
  timeoutMs?: number;
  /** Injected in tests. Default: global fetch. */
  fetch?: typeof fetch;
}

export function hasOpenRouterKey(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY?.trim());
}

/** Timeout: explicit → OPENROUTER_TIMEOUT_MS → config → default. */
export function resolveOpenRouterTimeout(explicit?: number, config?: number): number {
  const env = Number(process.env.OPENROUTER_TIMEOUT_MS);
  return explicit ?? (Number.isFinite(env) && env > 0 ? env : undefined) ?? config ?? DEFAULT_OPENROUTER_TIMEOUT_MS;
}

export function resolveOpenRouterModel(explicit?: string, config?: string): string {
  return explicit?.trim() || process.env.OPENROUTER_MODEL?.trim() || config?.trim() || DEFAULT_OPENROUTER_MODEL;
}

/** Remove anything key-shaped from a message before it can be shown or stored. */
export function redactOpenRouter(message: string, apiKey?: string): string {
  let m = message.replace(/sk-or-[A-Za-z0-9_-]{8,}/g, "«redacted»").replace(/Bearer\s+[^\s"']+/gi, "Bearer «redacted»");
  if (apiKey && apiKey.length >= 8) m = m.split(apiKey).join("«redacted»");
  return m;
}

/** HTTP status → error. 401/403 (and 402 no credits) are fatal: every further call would fail the same way. */
export function openRouterHttpError(status: number, body: string, apiKey?: string): GeminiCallError {
  let detail = body;
  try {
    const j = JSON.parse(body) as { error?: { message?: unknown } };
    if (typeof j.error?.message === "string") detail = j.error.message;
  } catch {
    /* not JSON */
  }
  detail = redactOpenRouter(detail.replace(/\s+/g, " ").trim(), apiKey).slice(0, 200);
  if (status === 401 || status === 403) return new GeminiCallError(`authentication failed (HTTP ${status}) — check OPENROUTER_API_KEY`, status, true);
  if (status === 402) return new GeminiCallError(`OpenRouter: insufficient credits (HTTP 402): ${detail}`, status, true);
  // The model id doesn't exist or isn't available to this account: every further call fails the same way.
  if (status === 404) return new GeminiCallError(`OpenRouter model unavailable (HTTP 404): ${detail}`, status, true);
  if (status === 429) return new GeminiCallError(`OpenRouter rate limited (HTTP 429): ${detail}`, status);
  return new GeminiCallError(`OpenRouter API error (HTTP ${status}): ${detail}`, status);
}

function toOpenRouterError(err: unknown, apiKey?: string): GeminiCallError {
  if (err instanceof GeminiCallError) return err;
  if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError" || /abort|timed? ?out/i.test(err.message))) return new GeminiCallError("request timed out");
  return new GeminiCallError(redactOpenRouter(`OpenRouter request failed: ${err instanceof Error ? err.message : String(err)}`, apiKey).slice(0, 200));
}

interface ChatCompletion {
  choices?: { message?: { content?: unknown; refusal?: unknown }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number; completion_tokens_details?: { reasoning_tokens?: number }; prompt_tokens_details?: { cached_tokens?: number } };
  error?: { message?: string; code?: number };
}

/** Message content may be a string or an array of text parts. */
function contentText(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((p) => (p && typeof p === "object" && typeof (p as { text?: unknown }).text === "string" ? (p as { text: string }).text : "")).join("");
  return undefined;
}

export type OpenRouterClientResult = { transport: GeminiTransport; error?: undefined } | { transport?: undefined; error: string };

/** Build the OpenRouter transport, or say why not. Never throws, never prints the key. */
export function createOpenRouterTransport(s: OpenRouterSettings = {}): OpenRouterClientResult {
  const apiKey = s.apiKey?.trim() || process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) return { error: "OPENROUTER_API_KEY is not set" };
  const model = resolveOpenRouterModel(s.model);
  const base = (s.baseURL?.trim() || process.env.OPENROUTER_BASE_URL?.trim() || DEFAULT_OPENROUTER_BASE_URL).replace(/\/+$/, "");
  const timeout = resolveOpenRouterTimeout(s.timeoutMs);
  const doFetch = s.fetch ?? fetch;
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    // Optional attribution headers (no user data).
    "HTTP-Referer": "https://github.com/jevx",
    "X-Title": "JevX"
  };

  const call = async (url: string, init: RequestInit, signal?: AbortSignal): Promise<unknown> => {
    const signals = [AbortSignal.timeout(timeout), ...(signal ? [signal] : [])];
    const res = await doFetch(url, { ...init, headers, signal: AbortSignal.any(signals) });
    const body = await res.text();
    if (!res.ok) throw openRouterHttpError(res.status, body, apiKey);
    try {
      return JSON.parse(body);
    } catch {
      throw new GeminiCallError("OpenRouter returned a non-JSON HTTP body");
    }
  };

  const transport: GeminiTransport = {
    model,
    async generate(req) {
      try {
        const json = (await call(
          `${base}/chat/completions`,
          {
            method: "POST",
            body: JSON.stringify({
              model,
              messages: [
                { role: "system", content: req.systemInstruction },
                { role: "user", content: req.prompt }
              ],
              response_format: { type: "json_schema", json_schema: { name: "jevx_code_analysis", strict: true, schema: req.schema } },
              ...(req.effort ? { reasoning: { effort: req.effort } } : {}),
              temperature: 0,
              max_tokens: 8192,
              // exact token + cost accounting in the response (no user data)
              usage: { include: true }
            })
          },
          req.signal
        )) as ChatCompletion;
        // OpenRouter can report a provider error inside a 200 body.
        if (json.error) throw openRouterHttpError(typeof json.error.code === "number" ? json.error.code : 502, JSON.stringify(json), apiKey);
        const msg = json.choices?.[0]?.message;
        return {
          text: contentText(msg?.content),
          inputTokens: json.usage?.prompt_tokens ?? 0,
          outputTokens: json.usage?.completion_tokens ?? 0,
          reasoningTokens: json.usage?.completion_tokens_details?.reasoning_tokens,
          cachedTokens: json.usage?.prompt_tokens_details?.cached_tokens,
          ...(typeof json.usage?.cost === "number" ? { costUsd: json.usage.cost, costSource: "provider" as const } : {})
        };
      } catch (err) {
        throw toOpenRouterError(err, apiKey);
      }
    },
    async ping() {
      // Sends no code: validates the key, then checks the model id exists.
      try {
        await call(`${base}/key`, { method: "GET" });
        const models = (await call(`${base}/models`, { method: "GET" })) as { data?: { id?: string; name?: string }[] };
        const found = models.data?.find((m) => m.id === model);
        if (models.data && !found) throw new GeminiCallError(`model "${model}" not found on OpenRouter (set OPENROUTER_MODEL or --openrouter-model)`, 404, true);
        return { model, displayName: found?.name };
      } catch (err) {
        throw toOpenRouterError(err, apiKey);
      }
    }
  };
  return { transport };
}
