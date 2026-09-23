// Which AI reads the code in the terminal version — always the USER's own key.
//
// Safety rules (the dangerous part of "bring your own AI"):
//   - Keys come only from environment variables. JevX never stores, prints or logs them.
//   - Only known providers, at their official addresses. A custom address needs an explicit
//     JEVX_ALLOW_CUSTOM_BASE_URL=1, so a stray variable can't quietly redirect your code.
//   - Before the first run with a provider, the user is told exactly where code goes and asked
//     once. Non-interactive runs need --yes.
//   - JevX never ships a key of its own: anything inside an npm package can be extracted.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { createOpenRouterTransport, createXaiTransport, resolveOpenRouterModel, resolveXaiModel, type GeminiTransport } from "@jevx/gemini";

export type Provider = "xai" | "openrouter";

export interface AiChoice {
  provider: Provider;
  label: string;
  model: string;
  transport: GeminiTransport;
}

const CUSTOM = (name: string) => process.env[name]?.trim() && process.env.JEVX_ALLOW_CUSTOM_BASE_URL !== "1";

export function chooseAi(flag?: string, model?: string): AiChoice | { error: string } {
  const wanted = flag?.trim().toLowerCase();
  if (wanted && wanted !== "xai" && wanted !== "openrouter") return { error: `unknown provider "${flag}" — use xai or openrouter` };
  const useXai = wanted === "xai" || (!wanted && process.env.XAI_API_KEY?.trim());
  const useOr = wanted === "openrouter" || (!wanted && !useXai && process.env.OPENROUTER_API_KEY?.trim());
  if (useXai) {
    if (CUSTOM("XAI_BASE_URL")) return { error: "XAI_BASE_URL is set to a custom address. JevX only sends code there with JEVX_ALLOW_CUSTOM_BASE_URL=1." };
    const m = resolveXaiModel(model);
    const t = createXaiTransport({ model: m });
    return t.transport ? { provider: "xai", label: "xAI", model: m, transport: t.transport } : { error: t.error };
  }
  if (useOr) {
    if (CUSTOM("OPENROUTER_BASE_URL")) return { error: "OPENROUTER_BASE_URL is set to a custom address. JevX only sends code there with JEVX_ALLOW_CUSTOM_BASE_URL=1." };
    const m = resolveOpenRouterModel(model);
    const t = createOpenRouterTransport({ model: m });
    return t.transport ? { provider: "openrouter", label: "OpenRouter", model: m, transport: t.transport } : { error: t.error };
  }
  return {
    error: [
      "No AI key found. JevX uses your own AI key — it never ships one.",
      "  export XAI_API_KEY=…          (xAI, Grok)   or",
      "  export OPENROUTER_API_KEY=…   (OpenRouter)",
      "Or skip the terminal version: `jevx mcp install` lets Claude Code / Cursor do it with the AI you already use."
    ].join("\n")
  };
}

// Bumped when what JevX sends changes (v2: the AI reads whole source files), so earlier consent
// doesn't silently cover more than the user agreed to.
const CONSENT_SCOPE = "read-source-v2";
const consentFile = () => path.join(process.env.JEVX_HOME?.trim() || path.join(homedir(), ".jevx"), "consent.json");

export function hasConsent(provider: Provider): boolean {
  try {
    return Boolean((JSON.parse(readFileSync(consentFile(), "utf8")) as Record<string, string>)[`${provider}:${CONSENT_SCOPE}`]);
  } catch {
    return false;
  }
}

export function saveConsent(provider: Provider) {
  const f = consentFile();
  mkdirSync(path.dirname(f), { recursive: true });
  let cur: Record<string, string> = {};
  try {
    if (existsSync(f)) cur = JSON.parse(readFileSync(f, "utf8")) as Record<string, string>;
  } catch {
    cur = {};
  }
  cur[`${provider}:${CONSENT_SCOPE}`] = new Date().toISOString();
  writeFileSync(f, JSON.stringify(cur, null, 2));
}

export async function askYesNo(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const a = (await rl.question(question)).trim().toLowerCase();
    return a === "" || a === "y" || a === "yes";
  } finally {
    rl.close();
  }
}
