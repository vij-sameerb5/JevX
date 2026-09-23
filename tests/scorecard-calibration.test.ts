// Scorecard calibration against REAL data (tests/fixtures/scorecard-calibration.json):
//   known    — 7 real Jev sites and 5 deterministic neighbours from the Layer E pilot (feature levels;
//              in-sample for the patterns profile, which was derived from them)
//   observed — 8 spots from a real Claude Code + TypeSafe run on a Next.js app: AI score + TypeSafe's
//              raw answers as recorded
// What must hold: real Jev-like decisions can reach STRONG; ambiguous ones stay POSSIBLE / REVIEW;
// exact logic is rejected; TypeSafe's "bounded" alone never makes a fit; missing sources are said.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { combine, patternScore, typesafeScore, type FeatureLevels } from "@jevx/engine";

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = JSON.parse(readFileSync(path.join(here, "fixtures/scorecard-calibration.json"), "utf8")) as {
  known: { kind: "real-jev-site" | "deterministic-neighbour"; features: FeatureLevels; analystConfidence: string }[];
  observed: { spot: string; expect: "ambiguous-or-possible" | "deterministic-control"; features: FeatureLevels; ai: number; typesafe: { judgment: number; bounded: number; deterministicIsCorrect: number } }[];
};
const ts = (t: { judgment: number; bounded: number; deterministicIsCorrect: number }) => typesafeScore({ ...t, primitive: "", primitiveConfidence: 0, category: "" });
const card = (o: (typeof fx.observed)[number]) => combine({ patterns: patternScore(o.features).score, ai: o.ai, typesafe: ts(o.typesafe) });

describe("scorecard calibration", () => {
  it("real Jev sites look like Jev to the patterns source, deterministic neighbours don't (in-sample)", () => {
    for (const k of fx.known) {
      const s = patternScore(k.features).score!;
      if (k.kind === "real-jev-site") expect(s).toBeGreaterThanOrEqual(0.85);
      else expect(s).toBeLessThanOrEqual(0.15);
    }
  });

  it("a genuine Jev decision CAN reach STRONG when the evidence supports it", () => {
    // the analysts rated every real site 'high'; 0.8 is the rubric's 'clear improvement' score
    for (const k of fx.known.filter((x) => x.kind === "real-jev-site")) {
      const c = combine({ patterns: patternScore(k.features).score, ai: 0.8 });
      expect(c.verdict).toBe("STRONG_FIT");
      expect(c.missing).toEqual(["typesafe"]); // and it says TypeSafe wasn't asked
    }
  });

  it("exact logic is rejected, even when TypeSafe calls the outcomes bounded", () => {
    for (const o of fx.observed.filter((x) => x.expect === "deterministic-control")) {
      const c = card(o);
      expect(c.verdict).toBe("WEAK_FIT");
      expect(c.average!).toBeLessThan(0.3);
      expect(ts(o.typesafe)).toBeLessThan(0.5); // the status→colour map used to score 53–62% here
    }
  });

  it("ambiguous real-world spots stay POSSIBLE / REVIEW / WEAK — none is promoted to STRONG", () => {
    const cards = fx.observed.filter((x) => x.expect === "ambiguous-or-possible").map((o) => ({ o, c: card(o) }));
    for (const { c } of cards) expect(c.verdict).not.toBe("STRONG_FIT");
    // the error-message classifier is the one TypeSafe, the AI and the patterns all lean towards
    const best = [...cards].sort((a, b) => b.c.average! - a.c.average!)[0]!;
    expect(best.o.spot).toMatch(/error-text-classifier/);
    expect(best.c.verdict).toBe("POSSIBLE_FIT");
    // disagreement stays visible rather than averaged away
    expect(cards.some(({ c }) => c.verdict === "REVIEW_DISAGREE" && /doesn't fit/.test(c.why))).toBe(true);
  });

  it("TypeSafe: bounded gates, judgment decides", () => {
    expect(ts({ judgment: 0, bounded: 1, deterministicIsCorrect: 0.5 })).toBeLessThan(0.3); // bounded alone ≠ fit
    expect(ts({ judgment: 0.9, bounded: 0.1, deterministicIsCorrect: 0.1 })).toBeLessThan(0.15); // unbounded ≠ Jev
    expect(ts({ judgment: 0.9, bounded: 0.95, deterministicIsCorrect: 0.1 })).toBeGreaterThan(0.8);
  });

  it("says when a source is missing instead of pretending three", () => {
    const c = combine({ patterns: 0.7, ai: 0.8 });
    expect(c.missing).toEqual(["typesafe"]);
    expect(c.why).toMatch(/typesafe unavailable/);
  });
});
