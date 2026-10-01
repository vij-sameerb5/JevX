// The Chrome extension's analysis (apps/jevx-extension/lib/analyze.js), with GitHub and Gemini mocked.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain JS module
import * as A from "../apps/jevx-extension/lib/analyze.js";
import { patternScore as enginePatternScore, typesafeScore as engineTypesafeScore } from "../packages/engine/src/scorecard.js";

const routing = `export function routeTicket(body: string) {\n  const b = body.toLowerCase();\n  if (/refund|money back|charge/.test(b)) return "billing";\n  if (["crash", "error", "bug", "broken"].some((k) => b.includes(k))) return "technical";\n  return "general";\n}\n`;
const billing = `export function total(items: { price: number }[]) {\n  return items.reduce((s, i) => s + i.price, 0);\n}\n`;
const key = "sk-live-" + "a".repeat(30);

function mockFetch(answer: unknown, calls: string[] = []) {
  return async (url: string, init?: { headers?: Record<string, string>; body?: string }) => {
    calls.push(url);
    const json = (b: unknown, status = 200) => ({ ok: status < 400, status, json: async () => b, text: async () => JSON.stringify(b) });
    const txt = (t: string) => ({ ok: true, status: 200, text: async () => t, json: async () => JSON.parse(t) });
    if (url === "https://api.github.com/repos/acme/helpdesk") return json({ default_branch: "main", stargazers_count: 5, language: "TypeScript", description: "demo" });
    if (url.startsWith("https://api.github.com/repos/acme/helpdesk/git/trees/main")) return json({ tree: [{ type: "blob", path: "src/routing.ts", size: routing.length }, { type: "blob", path: "src/billing.ts", size: billing.length }, { type: "blob", path: "src/routing.test.ts", size: 10 }, { type: "blob", path: "README.md", size: 10 }] });
    if (url.endsWith("/src/routing.ts")) return txt(routing + `const KEY = "${key}";\n`);
    if (url.endsWith("/src/billing.ts")) return txt(billing);
    if (url.startsWith("https://generativelanguage.googleapis.com/v1beta/models?")) {
      if (init?.headers?.["x-goog-api-key"] !== "gem-key") return json({ error: { message: "API key not valid" } }, 400);
      return json({ models: [{ name: "models/gemini-3.8-flash", supportedGenerationMethods: ["generateContent"] }, { name: "models/gemini-3.8-flash-lite", supportedGenerationMethods: ["generateContent"] }, { name: "models/text-embedding-005", supportedGenerationMethods: ["embedContent"] }] });
    }
    if (url === "https://api.x.ai/v1/chat/completions" || url === "https://openrouter.ai/api/v1/chat/completions") {
      if (init?.headers?.Authorization !== "Bearer chat-key") return json({ error: { message: "Incorrect API key" } }, 401);
      const body = JSON.parse(init!.body!);
      calls.push("MODEL:" + body.model);
      calls.push("PROMPT:" + body.messages[1].content);
      return json({ model: body.model, choices: [{ message: { content: "```json\n" + JSON.stringify(answer) + "\n```" } }], usage: { prompt_tokens: 900, completion_tokens: 100 } });
    }
    if (url.startsWith("https://generativelanguage.googleapis.com/")) {
      calls.push("GEMINI:" + url);
      if (init?.headers?.["x-goog-api-key"] !== "gem-key") return json({ error: { message: "API key not valid" } }, 400);
      const body = JSON.parse(init!.body!);
      calls.push("PROMPT:" + body.contents[0].parts[0].text);
      return json({ candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }], usageMetadata: { promptTokenCount: 1200, candidatesTokenCount: 200 } });
    }
    if (url === "https://api.typesafe.ai/v1/systemone") {
      if (init?.headers?.Authorization !== "Bearer ts-key") return json({ error: "unauthorized" }, 401);
      calls.push("TS:" + init!.body);
      return json({ answers: { judgment: { noul: 0.9 }, bounded: { noul: 0.95 }, deterministic_is_correct: { noul: 0.1 } } });
    }
    if (url.startsWith("https://api.github.com/repos/nope/")) return json({ message: "Not Found" }, 404);
    throw new Error("unexpected " + url);
  };
}

const spot = { file: "src/routing.ts", start_line: 3, end_line: 4, function: "routeTicket", decides: "Which team gets a ticket.", current_rule: "keyword_list", input_kind: "user_text", primitive: "choice", question: "Which team should handle this ticket?", outcomes: ["billing", "technical", "general"], why: "Customers word things many ways.", fallback: "the keyword rules", ai_score: 0.85, features: { semantic_ambiguity: "high", judgment_required: "high", natural_language_understanding: "high", deterministic_expressibility: "low" } };

describe("JevX for GitHub (extension)", () => {
  it("parses repo URLs and ignores non-repo pages", () => {
    expect(A.parseRepoUrl("https://github.com/acme/helpdesk")).toMatchObject({ full: "acme/helpdesk" });
    expect(A.parseRepoUrl("https://github.com/acme/helpdesk/tree/dev/src/api")).toMatchObject({ full: "acme/helpdesk", ref: "dev", path: "src/api" });
    expect(A.parseRepoUrl("https://github.com/settings/tokens")).toBeNull();
    expect(A.parseRepoUrl("https://gitlab.com/a/b")).toBeNull();
    expect(A.parseRepoUrl("https://github.com/acme")).toBeNull();
  });

  it("skips tests, builds and config; logic folders first", () => {
    const files = A.pickFiles([{ path: "src/components/Button.tsx", size: 100 }, { path: "src/api/route.ts", size: 100 }, { path: "dist/index.js", size: 100 }, { path: "src/a.test.ts", size: 100 }, { path: "vite.config.ts", size: 100 }]);
    expect(files.map((f: { path: string }) => f.path)).toEqual(["src/api/route.ts", "src/components/Button.tsx"]);
  });

  it("finds rule signals and scrubs secrets", () => {
    expect(A.signals(routing).score).toBeGreaterThan(0);
    expect(A.signals(billing).score).toBe(0);
    expect(A.scrub(`k = "${key}"`)).not.toContain(key);
  });

  it("uses the same pattern score as the CLI (profile.json in sync)", () => {
    expect(readFileSync("apps/jevx-extension/lib/profile.json", "utf8")).toBe(readFileSync("packages/engine/src/profile.json", "utf8"));
    expect(A.patternScore(spot.features)).toBe(enginePatternScore(spot.features as never).score);
  });

  it("analyzes a repo end to end: reads files, asks Gemini once, returns scorecards; secrets never sent", async () => {
    const calls: string[] = [];
    const steps: string[] = [];
    const res = await A.analyzeRepo({ fetch: mockFetch({ spots: [spot, { ...spot, file: "src/nowhere.ts" }] }, calls), url: "https://github.com/acme/helpdesk", geminiKey: "gem-key", progress: (s: string) => steps.push(s) });
    expect([...new Set(steps)]).toEqual(["tree", "fetch", "ai", "done"]);
    expect(res.spots).toHaveLength(1); // a spot in a file it wasn't shown is dropped
    expect(res.spots[0].card.verdict).toBe("STRONG_FIT");
    expect(res.spots[0].card.scores.ai).toBe(0.85);
    expect(res.stats).toMatchObject({ files: 4, fetched: 2 });
    const prompt = calls.find((c) => c.startsWith("PROMPT:"))!;
    expect(prompt).toContain("=== FILE src/routing.ts ===");
    expect(prompt).not.toContain(key);
    expect(calls.filter((c) => c.startsWith("https://") && c.includes(":generateContent")).length).toBe(1);
    expect(calls.some((c) => c.includes("routing.test.ts"))).toBe(false);
  });

  it("clear errors: no key, bad key, missing repo", async () => {
    await expect(A.analyzeRepo({ fetch: mockFetch({ spots: [] }), url: "https://github.com/acme/helpdesk", geminiKey: "" })).rejects.toThrow(/Gemini API key/);
    await expect(A.analyzeRepo({ fetch: mockFetch({ spots: [] }), url: "https://github.com/acme/helpdesk", geminiKey: "wrong", model: "gemini-3.8-flash-lite" })).rejects.toThrow(/rejected the API key/);
    await expect(A.analyzeRepo({ fetch: mockFetch({ spots: [] }), url: "https://github.com/acme/helpdesk", provider: "xai", apiKey: "nope" })).rejects.toThrow(/xAI \(Grok\) rejected the API key/);
    await expect(A.analyzeRepo({ fetch: mockFetch({ spots: [] }), url: "https://github.com/nope/x", geminiKey: "gem-key" })).rejects.toThrow(/not found/i);
  });

  it("a retired model (404) falls back to the closest model this key can use", async () => {
    expect(A.pickModel("gemini-2.5-flash-lite", ["gemini-3.1-flash-lite", "gemini-3.1-pro", "text-embedding-005"])).toBe("gemini-3.1-flash-lite");
    expect(A.pickModel("gemini-2.5-flash-lite", ["gemini-3-flash", "gemini-3-pro"])).toBe("gemini-3-flash");
    expect(A.pickModel("x", [])).toBeUndefined();
    const base = mockFetch({ spots: [spot] });
    const f = async (url: string, init?: { headers?: Record<string, string>; body?: string }) => {
      if (url.includes("gemini-2.5-flash-lite:generateContent")) return { ok: false, status: 404, json: async () => ({ error: { message: "models/gemini-2.5-flash-lite is not found" } }), text: async () => "" };
      if (url.includes("/v1beta/models?")) return { ok: true, status: 200, json: async () => ({ models: [{ name: "models/gemini-3.1-flash-lite", supportedGenerationMethods: ["generateContent"] }] }), text: async () => "" };
      return base(url, init);
    };
    const res = await A.analyzeRepo({ fetch: f, url: "https://github.com/acme/helpdesk", geminiKey: "gem-key", model: "gemini-2.5-flash-lite" });
    expect(res.model).toBe("gemini-3.1-flash-lite");
    expect(res.spots).toHaveLength(1);
  });

  it("Gemini 'auto' picks the newest Flash-Lite model the key can use", async () => {
    const calls: string[] = [];
    const res = await A.analyzeRepo({ fetch: mockFetch({ spots: [spot] }, calls), url: "https://github.com/acme/helpdesk", geminiKey: "gem-key" });
    expect(res.model).toBe("gemini-3.8-flash-lite");
    expect(calls.some((c) => c.includes("models/gemini-3.8-flash-lite:generateContent"))).toBe(true);
  });

  it("works with xAI and OpenRouter keys too (JSON in a code fence is fine)", async () => {
    for (const [provider, model] of [["xai", "grok-4.6"], ["openrouter", "x-ai/grok-4.6"]] as const) {
      const calls: string[] = [];
      const res = await A.analyzeRepo({ fetch: mockFetch({ spots: [spot] }, calls), url: "https://github.com/acme/helpdesk", provider, apiKey: "chat-key" });
      expect(res.provider).toBe(provider);
      expect(res.model).toBe(model);
      expect(res.spots[0].card.verdict).toBe("STRONG_FIT");
      expect(calls.find((c) => c.startsWith("PROMPT:"))).not.toContain(key);
      expect(calls.some((c) => c.startsWith("GEMINI:"))).toBe(false);
    }
    const custom = await A.analyzeRepo({ fetch: mockFetch({ spots: [] }), url: "https://github.com/acme/helpdesk", provider: "openrouter", apiKey: "chat-key", model: "anthropic/claude-sonnet-4.5" });
    expect(custom.model).toBe("anthropic/claude-sonnet-4.5");
  });

  it("TypeSafe adds Jev's own opinion as the third score (same formula as the CLI); only the spot's lines are sent", async () => {
    const a = { judgment: 0.9, bounded: 0.95, deterministicIsCorrect: 0.1 };
    expect(A.typesafeScore(a)).toBeCloseTo(engineTypesafeScore(a as never));
    const calls: string[] = [];
    const res = await A.analyzeRepo({ fetch: mockFetch({ spots: [spot] }, calls), url: "https://github.com/acme/helpdesk", geminiKey: "gem-key", typesafeKey: "ts-key" });
    expect(res.typesafe.status).toBe("on");
    expect(res.spots[0].card.scores.typesafe).toBeCloseTo(engineTypesafeScore(a as never));
    const sent = calls.find((c) => c.startsWith("TS:"))!;
    expect(sent).toContain("routeTicket");
    expect(sent).not.toContain(key);
    expect(sent).not.toContain("export function total"); // billing.ts is never sent to TypeSafe
    expect(res.spots[0].community).toMatchObject({ rule: "keyword_list", total: 82 });
    const bad = await A.analyzeRepo({ fetch: mockFetch({ spots: [spot] }), url: "https://github.com/acme/helpdesk", geminiKey: "gem-key", typesafeKey: "wrong" });
    expect(bad.typesafe).toMatchObject({ status: "error" });
    expect(bad.spots[0].card.scores.typesafe).toBeUndefined(); // still works, with two scores
  });

  it("reads big repos in parts, two at a time, retries a rate limit, and keeps going if one part fails", async () => {
    const big = (i: number) => `export function f${i}(m: string) {\n  if (/refund/.test(m)) return "billing";\n${"  // pad\n".repeat(1200)}}\n`;
    const paths = Array.from({ length: 6 }, (_, i) => `src/api/f${i}.ts`);
    let live = 0, peak = 0, calls = 0, limited = false;
    const f = async (url: string, init?: { body?: string }) => {
      const json = (b: unknown, status = 200) => ({ ok: status < 400, status, json: async () => b, text: async () => JSON.stringify(b) });
      if (url === "https://api.github.com/repos/acme/big") return json({ default_branch: "main", description: "" });
      if (url.includes("/git/trees/")) return json({ tree: paths.map((p) => ({ type: "blob", path: p, size: 40000 })) });
      if (url.startsWith("https://raw.githubusercontent.com/")) { const i = Number(url.match(/f(\d)\.ts$/)![1]); return { ok: true, status: 200, text: async () => big(i), json: async () => ({}) }; }
      if (url.startsWith("https://api.x.ai/")) {
        calls++; live++; peak = Math.max(peak, live);
        await new Promise((r) => setTimeout(r, 20));
        live--;
        const body = JSON.parse(init!.body!);
        const text = body.messages[1].content as string;
        if (!limited) { limited = true; return json({ error: { message: "slow down" } }, 429); }
        if (text.includes("=== FILE src/api/f5.ts")) return json({ error: { message: "boom" } }, 500);
        const file = text.match(/=== FILE (\S+) ===/)![1];
        return json({ model: "grok-4.6", choices: [{ message: { content: JSON.stringify({ spots: [{ ...spot, file, start_line: 2, end_line: 2 }] }) } }], usage: { prompt_tokens: 100, completion_tokens: 10 } });
      }
      throw new Error("unexpected " + url);
    };
    const seen: { parts: { status: string }[] }[] = [];
    const res = await A.analyzeRepo({ fetch: f, url: "https://github.com/acme/big", provider: "xai", apiKey: "k", progress: (_s: string, _d: string, x?: { parts: { status: string }[] }) => x && seen.push(x) });
    expect(res.parts.length).toBeGreaterThanOrEqual(2);
    expect(peak).toBe(2); // never more than two at once
    expect(seen.some((x) => x.parts.some((p) => p.status === "retrying"))).toBe(true);
    expect(res.spots.length).toBeGreaterThan(0); // other parts still give results
    expect(res.tokens.input).toBeGreaterThan(100); // tokens add up across parts
    expect(calls).toBeGreaterThan(res.parts.length);
  }, 30000);

  it("an empty answer is a valid result", async () => {
    const res = await A.analyzeRepo({ fetch: mockFetch({ spots: [] }), url: "https://github.com/acme/helpdesk", geminiKey: "gem-key" });
    expect(res.spots).toEqual([]);
  });
});
