// Direct xAI (Grok) transport — the DEFAULT code analyst for the M5b pilot.
// https://api.x.ai/v1/responses (Responses API), model grok-4.6, key from XAI_API_KEY only.
//
// Only the transport differs from the other providers: the adaptive context loop, prompts, schemas,
// parsers, caching and dataset rules are shared. Plain fetch, no SDK.
//
// Accounting: xAI reports token counts but not a price, so cost here is CALCULATED from the
// configured price per million tokens and labelled `costSource: "calculated"` — never presented as
// provider-reported. OpenRouter's reported cost stays labelled "provider".
import { GeminiCallError, type GeminiTransport } from "./client.js";

export const DEFAULT_XAI_MODEL = "grok-4.6";
export const DEFAULT_XAI_BASE_URL = "https://api.x.ai/v1";
/**
 * grok-4.6 spends thousands of reasoning tokens before it writes anything, so the reply window has
 * to be generous: at 120 s the M5b pilot lost 5 of 15 sites to timeouts on prompts of only a few
 * thousand tokens. Override with XAI_TIMEOUT_MS or config.xai.timeoutMs.
 */
export const DEFAULT_XAI_TIMEOUT_MS = 300_000;
/** Listed xAI price for grok-4.6 (USD per million tokens). Configurable: xai.pricePerMInput / …Output. */
export const DEFAULT_XAI_PRICE_IN = 2;
export const DEFAULT_XAI_PRICE_OUT = 6;

export interface XaiSettings {
  apiKey?: string;
  model?: string;
  baseURL?: string;
  timeoutMs?: number;
  /** USD per million tokens, for the calculated cost. */
  pricePerMInput?: number;
  pricePerMOutput?: number;
  /** Injected in tests. Default: global fetch. */
  fetch?: typeof fetch;
}

export function hasXaiKey(): boolean {
  return Boolean(process.env.XAI_API_KEY?.trim());
}

export function resolveXaiModel(explicit?: string, config?: string): string {
  return explicit?.trim() || process.env.XAI_MODEL?.trim() || config?.trim() || DEFAULT_XAI_MODEL;
}

export function resolveXaiTimeout(explicit?: number, config?: number): number {
  const env = Number(process.env.XAI_TIMEOUT_MS);
  return explicit ?? (Number.isFinite(env) && env > 0 ? env : undefined) ?? config ?? DEFAULT_XAI_TIMEOUT_MS;
}

/** Remove anything key-shaped before a message can be shown, logged or stored. */
export function redactXai(message: string, apiKey?: string): string {
  let m = message.replace(/xai-[A-Za-z0-9_-]{8,}/g, "«redacted»").replace(/Bearer\s+[^\s"']+/gi, "Bearer «redacted»");
  if (apiKey && apiKey.length >= 8) m = m.split(apiKey).join("«redacted»");
  return m;
}

/** HTTP status → error. 401/403 (bad key) and 404 (model/endpoint unavailable) are fatal. */
export function xaiHttpError(status: number, body: string, apiKey?: string): GeminiCallError {
  let detail = body;
  try {
    const j = JSON.parse(body) as { error?: { message?: unknown } | string; msg?: unknown };
    if (typeof j.error === "string") detail = j.error;
    else if (j.error && typeof j.error === "object" && typeof j.error.message === "string") detail = j.error.message;
    else if (typeof j.msg === "string") detail = j.msg;
  } catch {
    /* not JSON */
  }
  detail = redactXai(detail.replace(/\s+/g, " ").trim(), apiKey).slice(0, 200);
  if (status === 401 || status === 403) return new GeminiCallError(`authentication failed (HTTP ${status}) — check XAI_API_KEY`, status, true);
  if (status === 404) return new GeminiCallError(`xAI: model or endpoint unavailable (HTTP 404): ${detail}`, status, true);
  if (status === 429) return new GeminiCallError(`xAI rate limited (HTTP 429): ${detail}`, status);
  return new GeminiCallError(`xAI API error (HTTP ${status}): ${detail}`, status);
}

function toXaiError(err: unknown, apiKey?: string): GeminiCallError {
  if (err instanceof GeminiCallError) return err;
  if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError" || /abort|timed? ?out/i.test(err.message))) return new GeminiCallError("request timed out");
  return new GeminiCallError(redactXai(`xAI request failed: ${err instanceof Error ? err.message : String(err)}`, apiKey).slice(0, 200));
}

interface ResponsesReply {
  output_text?: unknown;
  output?: { type?: string; content?: { type?: string; text?: unknown }[]; text?: unknown }[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    cached_tokens?: number;
    reasoning_tokens?: number;
    input_tokens_details?: { cached_tokens?: number };
    output_tokens_details?: { reasoning_tokens?: number };
  };
  error?: { message?: string; code?: number } | string;
  incomplete_details?: { reason?: string };
  status?: string;
}

/** The structured answer: `output_text`, or the text parts of the message items. */
function answerText(r: ResponsesReply): string | undefined {
  if (typeof r.output_text === "string" && r.output_text.trim()) return r.output_text;
  const parts: string[] = [];
  for (const item of r.output ?? []) {
    if (item.type && item.type !== "message") continue; // reasoning / tool items carry no answer
    for (const c of item.content ?? []) if ((!c.type || c.type === "output_text" || c.type === "text") && typeof c.text === "string") parts.push(c.text);
    if (!item.content && typeof item.text === "string") parts.push(item.text);
  }
  return parts.length ? parts.join("") : undefined;
}

export type XaiClientResult = { transport: GeminiTransport; error?: undefined } | { transport?: undefined; error: string };

/** Build the direct xAI transport, or say why not. Never throws, never prints the key. */
export function createXaiTransport(s: XaiSettings = {}): XaiClientResult {
  const apiKey = s.apiKey?.trim() || process.env.XAI_API_KEY?.trim();
  if (!apiKey) return { error: "XAI_API_KEY is not set." };
  const model = resolveXaiModel(s.model);
  const base = (s.baseURL?.trim() || process.env.XAI_BASE_URL?.trim() || DEFAULT_XAI_BASE_URL).replace(/\/+$/, "");
  const timeout = resolveXaiTimeout(s.timeoutMs);
  const priceIn = s.pricePerMInput ?? DEFAULT_XAI_PRICE_IN;
  const priceOut = s.pricePerMOutput ?? DEFAULT_XAI_PRICE_OUT;
  const doFetch = s.fetch ?? fetch;
  const headers = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };

  const call = async (url: string, init: RequestInit, signal?: AbortSignal): Promise<unknown> => {
    const res = await doFetch(url, { ...init, headers, signal: AbortSignal.any([AbortSignal.timeout(timeout), ...(signal ? [signal] : [])]) });
    const body = await res.text();
    if (!res.ok) throw xaiHttpError(res.status, body, apiKey);
    try {
      return JSON.parse(body);
    } catch {
      throw new GeminiCallError("xAI returned a non-JSON HTTP body");
    }
  };

  // Some models reject a reasoning effort; remember that and stop sending it.
  let effortSupported = true;
  const transport: GeminiTransport = {
    model,
    async generate(req) {
      try {
        const send = (withEffort: boolean) =>
          call(
            `${base}/responses`,
            {
              method: "POST",
              body: JSON.stringify({
                model,
                instructions: req.systemInstruction,
                input: req.prompt,
                ...(req.schema ? { text: { format: { type: "json_schema", name: "jevx_analysis", strict: true, schema: req.schema } } } : {}),
                ...(withEffort && req.effort ? { reasoning: { effort: req.effort } } : {}),
                temperature: 0,
                max_output_tokens: 16384,
                store: false
              })
            },
            req.signal
          );
        let raw: unknown;
        try {
          raw = await send(effortSupported);
        } catch (e) {
          if (!(req.effort && effortSupported && e instanceof GeminiCallError && e.status === 400 && /reason|effort/i.test(e.message))) throw e;
          effortSupported = false;
          raw = await send(false);
        }
        const json = raw as ResponsesReply;
        if (json.error) {
          const e = json.error;
          throw xaiHttpError(typeof e === "object" && typeof e.code === "number" ? e.code : 502, JSON.stringify(json), apiKey);
        }
        const u = json.usage ?? {};
        const inputTokens = u.input_tokens ?? 0;
        const outputTokens = u.output_tokens ?? 0;
        const text = answerText(json);
        if (!text && json.incomplete_details?.reason) throw new GeminiCallError(`xAI returned no answer (${json.incomplete_details.reason})`);
        return {
          text,
          inputTokens,
          outputTokens,
          reasoningTokens: u.reasoning_tokens ?? u.output_tokens_details?.reasoning_tokens,
          cachedTokens: u.cached_tokens ?? u.input_tokens_details?.cached_tokens,
          // xAI reports no price: this is CALCULATED from the configured price per million tokens.
          costUsd: (inputTokens / 1e6) * priceIn + (outputTokens / 1e6) * priceOut,
          costSource: "calculated"
        };
      } catch (err) {
        throw toXaiError(err, apiKey);
      }
    },
    async ping() {
      // Sends no code: key check, then the model list.
      try {
        const models = (await call(`${base}/models`, { method: "GET" })) as { data?: { id?: string }[] };
        const found = models.data?.find((m) => m.id === model);
        if (models.data?.length && !found) throw new GeminiCallError(`model "${model}" is not available to this key (set XAI_MODEL or --model)`, 404, true);
        return { model, displayName: found?.id };
      } catch (err) {
        throw toXaiError(err, apiKey);
      }
    }
  };
  return { transport };
}

/**
 * A tiny end-to-end request used by `jevx check --grok`: no repository code, a few tokens, and it
 * proves the model actually answers. Returns the text and what it cost.
 */
export async function xaiSmokeTest(t: GeminiTransport): Promise<{ text: string; inputTokens: number; outputTokens: number; costUsd?: number }> {
  const r = await t.generate({ systemInstruction: "Reply with the single word: ready", prompt: "ready?" });
  return { text: (r.text ?? "").trim().slice(0, 40), inputTokens: r.inputTokens, outputTokens: r.outputTokens, costUsd: r.costUsd };
}
