// The "AI reads everything" step, the env-file loader and the anonymous dataset rows.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { DEFAULT_CALL_TIMEOUT_MS, findingRows, matchFile, parseRead, pathKind, planRead, rankStatic, readPriority, shareTarget, skippedForReading, type Opportunity } from "@jevx/engine";
import { loadEnvFile, parseEnv } from "../apps/jevx/src/env.js";

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), "jevx-read-"));
  dirs.push(d);
  return d;
};
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

describe("planRead", () => {
  it("reads logic first, skips tests / d.ts / ui kits / configs, numbers lines, splits into parts", () => {
    const d = tmp();
    const files: Record<string, string> = {
      "app/api/chat/route.ts": "export function a() {}\n".repeat(50),
      "lib/payments.ts": "export const x = 1;\n",
      "app/landing/sections/Hero.tsx": "export default function Hero() { return null }\n",
      "app/checkout/page.tsx": "export default function Page() { return null }\n",
      "src/a.test.ts": "test\n",
      "types/x.d.ts": "declare const x: 1;\n",
      "components/ui/button.tsx": "x\n",
      "next.config.ts": "x\n"
    };
    for (const [f, t] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(d, f)), { recursive: true });
      writeFileSync(path.join(d, f), t);
    }
    const p = planRead(d, Object.keys(files), 1_000_000, 600);
    expect(p.skipped.sort()).toEqual(["components/ui/button.tsx", "next.config.ts", "src/a.test.ts", "types/x.d.ts"]);
    expect(p.read[0]).toBe("app/api/chat/route.ts");
    expect(p.read.at(-1)).toBe("app/landing/sections/Hero.tsx");
    expect(p.parts.length).toBeGreaterThan(1); // 50-line route split at ~600 chars
    const first = p.parts[0]![0]!;
    expect(first.text.split("\n")[0]).toMatch(/^ {3}1\| export function a/);
    expect(p.coverage).toBe(1);
  });

  it("stops at the budget and reports coverage honestly", () => {
    const d = tmp();
    mkdirSync(path.join(d, "lib"), { recursive: true });
    writeFileSync(path.join(d, "lib/a.ts"), "x".repeat(1000));
    writeFileSync(path.join(d, "lib/b.ts"), "y".repeat(1000));
    const p = planRead(d, ["lib/a.ts", "lib/b.ts"], 1500);
    expect(p.read).toEqual(["lib/a.ts"]);
    expect(p.unread).toEqual(["lib/b.ts"]);
    expect(p.coverage).toBeCloseTo(0.5);
  });

  it("priorities and skips", () => {
    expect(readPriority("app/api/refund/route.ts")).toBe(0);
    expect(readPriority("app/components/CustomCursor.tsx")).toBe(3);
    expect(readPriority("app/checkout/page.tsx")).toBe(1);
    expect(skippedForReading("src/x.spec.tsx")).toBe(true);
    expect(skippedForReading("src/x.ts")).toBe(false);
  });
});

describe("parseRead", () => {
  const files = new Map([["app/checkout/page.tsx", 328]]);
  it("keeps valid spots, clamps lines, drops unknown files and out-of-range lines", () => {
    const r = parseRead(
      JSON.stringify({
        spots: [
          { file: "./app/checkout/page.tsx", start_line: 239, end_line: 999, function: "pay", decision: "classify wallet error", primitive: "choice", why: "regex", confidence: 0.9 },
          { file: "lib/elsewhere.ts", start_line: 1, end_line: 2, function: "x", decision: "", primitive: "noul", why: "", confidence: 1 },
          { file: "app/checkout/page.tsx", start_line: 5000, end_line: 5001, function: "y", decision: "", primitive: "score", why: "", confidence: 1 }
        ]
      }),
      files
    );
    expect(r.ok).toBe(true);
    const spots = r.ok ? r.analysis.spots : [];
    expect(spots).toHaveLength(1);
    expect(spots[0]).toMatchObject({ file: "app/checkout/page.tsx", start_line: 239, end_line: 328, primitive: "choice" });
  });
  it("accepts paths the AI wrote a little differently, and line numbers as strings", () => {
    const r = parseRead(JSON.stringify({ spots: [
      { file: "/app/checkout/page.tsx (lines 1-328)", start_line: "239", end_line: "247", function: "pay", decision: "d", primitive: "choice", why: "w", confidence: 0.7 },
      { file: "checkout/page.tsx", start_line: 240, end_line: 241, function: "pay", decision: "d", primitive: "choice", why: "w", confidence: 0.7 }
    ] }), files);
    expect(r.ok && r.analysis.spots.map((s) => [s.file, s.start_line])).toEqual([["app/checkout/page.tsx", 239], ["app/checkout/page.tsx", 240]]);
    expect(r.ok && r.analysis.named).toBe(2);
  });
  it("matchFile refuses ambiguous suffixes", () => {
    expect(matchFile("page.tsx", ["app/a/page.tsx", "app/b/page.tsx"])).toBeUndefined();
    expect(matchFile("`lib/x.ts:12`", ["lib/x.ts"])).toBe("lib/x.ts");
  });
  it("fails on non-JSON", () => {
    expect(parseRead("nope", files).ok).toBe(false);
  });
});

it("AI calls get minutes, not the generic 30 s", () => {
  expect(DEFAULT_CALL_TIMEOUT_MS).toBeGreaterThanOrEqual(180_000);
});

it("rankStatic puts text-match in lib/api before UI components", () => {
  const c = (file: string, g: string) => ({ file, generators: [{ generator: g }] });
  const ranked = rankStatic([c("app/components/CustomCursor.tsx", "branch-map"), c("app/api/x/route.ts", "outcome-set"), c("lib/a.ts", "text-match")]);
  expect(ranked.map((x) => x.file)).toEqual(["lib/a.ts", "app/api/x/route.ts", "app/components/CustomCursor.tsx"]);
});

describe("env file", () => {
  it("parses KEY=value, quotes, export and comments", () => {
    expect(parseEnv('# c\nA=1\nexport B="two words"\nC=\'x\'\nD=3 # note\nbad line\n')).toEqual({ A: "1", B: "two words", C: "x", D: "3" });
  });
  it("never overrides what the shell set, skips empty values", () => {
    const d = tmp();
    const f = path.join(d, ".env");
    writeFileSync(f, "JEVX_T_A=from-file\nJEVX_T_B=from-file\nJEVX_T_C=\n");
    const saved = { ...process.env };
    try {
      process.env.JEVX_ENV_FILE = f;
      process.env.JEVX_T_A = "from-shell";
      process.env.JEVX_T_EMPTY = "";
      expect(loadEnvFile()).toBe(f);
      expect(process.env.JEVX_T_A).toBe("from-shell");
      expect(process.env.JEVX_T_B).toBe("from-file");
      expect(process.env.JEVX_T_C).toBeUndefined();
    } finally {
      process.env = saved;
    }
  });
});

describe("dataset rows", () => {
  it("carry no code, paths or names", () => {
    const d = tmp();
    const o = {
      id: "p1",
      file: "app/checkout/page.tsx",
      unit: { name: "secretFunctionName", start: 239, end: 247 },
      origin: "ai",
      status: "strong",
      edits: [{ file: "app/checkout/page.tsx", find: "const x = 1", replace: "const x = 2" }],
      assessment: { is_opportunity: true, decision: "Classify a wallet error", primitive: "choice", question: "q", outcomes: ["a", "b"], state: [], deterministic_remainder: "", why: "w", features: { judgment_required: "high" }, ai_score: 0.8, context_sufficient: true, missing_context: [], understanding_confidence: "high" },
      record: { scorecard: { scores: { ai: 0.8, patterns: 0.7 }, average: 0.75, verdict: "STRONG_FIT", why: "", missing: [] }, patch: "--- a/app/checkout/page.tsx" }
    } as unknown as Opportunity;
    const rows = findingRows({ root: d, runId: "r1", version: "0.3.0", provider: "xai", model: "grok", dryRun: true, opportunities: [o] });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ path_kind: "page", file_ext: "tsx", primitive: "choice", result: "preview", verdict: "STRONG_FIT", average: 0.75 });
    const json = JSON.stringify(rows);
    for (const leak of ["checkout", "secretFunctionName", "const x", "a/app"]) expect(json).not.toContain(leak);
  });
  it("pathKind", () => {
    expect(pathKind("app/api/x/route.ts")).toBe("api");
    expect(pathKind("lib/a.ts")).toBe("lib");
  });
  it("refuses non-supabase or plain-http addresses", () => {
    const saved = { ...process.env };
    try {
      delete process.env.JEVX_ALLOW_CUSTOM_BASE_URL;
      process.env.JEVX_SUPABASE_ANON_KEY = "k";
      process.env.JEVX_SUPABASE_URL = "https://evil.example.com";
      expect(shareTarget()).toHaveProperty("error");
      process.env.JEVX_SUPABASE_URL = "http://abc.supabase.co";
      expect(shareTarget()).toHaveProperty("error");
      process.env.JEVX_SUPABASE_URL = "https://abc.supabase.co/";
      expect(shareTarget()).toEqual({ url: "https://abc.supabase.co", key: "k" });
    } finally {
      process.env = saved;
    }
  });
});
