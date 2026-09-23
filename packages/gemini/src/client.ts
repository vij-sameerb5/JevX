// The only place that imports @google/genai. Everything else talks to the small
// GeminiTransport interface, so tests can run without the network. The SDK is loaded lazily
// (on the first call), so commands that never use Gemini never load it.
import type { GoogleGenAI } from "@google/genai";
import { DEFAULT_GEMINI_MODEL } from "./prompt.js";

export interface GeminiGenerateRequest {
  systemInstruction: string;
  prompt: string;
  /** JSON schema the answer must match. Omitted only by the tiny connectivity smoke test. */
  schema?: unknown;
  signal?: AbortSignal;
  /** How hard a reasoning model should think. Sent only when set; providers that reject it are retried without. */
  effort?: "low" | "medium" | "high";
}

export interface GeminiReply {
  text: string | undefined;
  inputTokens: number;
  outputTokens: number;
  /** Reasoning tokens (part of output, billed), when the provider reports them. */
  reasoningTokens?: number;
  /** Prompt tokens served from the provider's cache, when reported. */
  cachedTokens?: number;
  /**
   * Cost of this call in USD. `costSource` says where it came from: "provider" (the API reported it,
   * e.g. OpenRouter) or "calculated" (from configured prices, e.g. xAI, which reports no price).
   * A calculated cost is never presented as provider-reported.
   */
  costUsd?: number;
  costSource?: "provider" | "calculated";
}

export interface GeminiTransport {
  readonly model: string;
  generate(req: GeminiGenerateRequest): Promise<GeminiReply>;
  /** Reachability + model check. Sends no code. */
  ping(): Promise<{ model: string; displayName?: string }>;
}

/** fatal = retrying other candidates is pointless (bad key, no permission). */
export class GeminiCallError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly fatal = false
  ) {
    super(message);
    this.name = "GeminiCallError";
  }
}

export interface GeminiSettings {
  apiKey?: string;
  model?: string;
  baseURL?: string;
  timeoutMs?: number;
}

export const DEFAULT_GEMINI_TIMEOUT_MS = 30_000;

/** True when GEMINI_API_KEY is set (the key is never read from config). */
export function hasGeminiKey(): boolean {
  return Boolean(process.env.GEMINI_API_KEY?.trim());
}

export function resolveGeminiModel(explicit?: string, config?: string): string {
  return explicit?.trim() || process.env.GEMINI_MODEL?.trim() || config?.trim() || DEFAULT_GEMINI_MODEL;
}

/** Map any SDK / network error to a message that never contains the key. */
export function toGeminiError(err: unknown): GeminiCallError {
  if (err instanceof GeminiCallError) return err;
  const redact = (m: string) => m.replace(/key=[^&\s"]+/gi, "key=«redacted»").replace(/AIza[0-9A-Za-z_-]{20,}/g, "«redacted»");
  // @google/genai ApiError: an Error with a numeric HTTP status (checked structurally so the SDK stays lazy).
  const status = err instanceof Error ? (err as Error & { status?: unknown }).status : undefined;
  if (err instanceof Error && typeof status === "number") {
    const apiErr = { status, message: err.message };
    const msg = redact(apiErr.message);
    const badKey = status === 401 || status === 403 || (status === 400 && /api[ _]?key/i.test(msg));
    return new GeminiCallError(
      badKey ? `authentication failed (HTTP ${status}) — check GEMINI_API_KEY` : `Gemini API error (HTTP ${status}): ${msg.slice(0, 200)}`,
      status,
      badKey
    );
  }
  if (err instanceof Error && (err.name === "AbortError" || /abort|timed? ?out/i.test(err.message))) return new GeminiCallError("request timed out");
  return new GeminiCallError(redact(err instanceof Error ? err.message : String(err)).slice(0, 200));
}

export type GeminiClientResult = { transport: GeminiTransport; error?: undefined } | { transport?: undefined; error: string };

/** Build the real SDK transport, or say why not. Never throws, never prints the key. */
export function createGeminiTransport(s: GeminiSettings = {}): GeminiClientResult {
  const apiKey = s.apiKey?.trim() || process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return { error: "GEMINI_API_KEY is not set" };
  const model = resolveGeminiModel(s.model);
  const baseUrl = s.baseURL?.trim() || process.env.GEMINI_BASE_URL?.trim() || undefined;
  const timeout = s.timeoutMs ?? DEFAULT_GEMINI_TIMEOUT_MS;
  let client: Promise<GoogleGenAI> | undefined;
  const sdk = () =>
    (client ??= import("@google/genai").then(
      ({ GoogleGenAI }) => new GoogleGenAI({ apiKey, httpOptions: { ...(baseUrl ? { baseUrl } : {}), timeout, retryOptions: { attempts: 2 } } })
    ));
  const transport: GeminiTransport = {
    model,
    async generate(req) {
      try {
        const ai = await sdk();
        const res = await ai.models.generateContent({
          model,
          contents: req.prompt,
          config: {
            systemInstruction: req.systemInstruction,
            responseMimeType: "application/json",
            responseJsonSchema: req.schema,
            temperature: 0,
            maxOutputTokens: 2048,
            ...(req.signal ? { abortSignal: req.signal } : {})
          }
        });
        return {
          text: res.text,
          inputTokens: res.usageMetadata?.promptTokenCount ?? 0,
          outputTokens: res.usageMetadata?.candidatesTokenCount ?? 0
        };
      } catch (err) {
        throw toGeminiError(err);
      }
    },
    async ping() {
      try {
        const ai = await sdk();
        const m = await ai.models.get({ model });
        return { model: m.name ?? model, displayName: m.displayName };
      } catch (err) {
        throw toGeminiError(err);
      }
    }
  };
  return { transport };
}
