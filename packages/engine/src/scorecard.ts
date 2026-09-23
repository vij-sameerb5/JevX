// JevX scorecard: three independent opinions on ONE proposed Jev decision, then their average.
//
//   patterns   how closely the decision's features match the Jev sites JevX studied (Layer E pilot)
//   ai         the user's own AI, after reading the code (supplied by the MCP client)
//   typesafe   Jev itself: judgment? bounded outcomes? would exact code still be right?
//
// The average is a summary for people, not a proof. The three scores are always shown next to it,
// and when they point different ways the card says REVIEW instead of pretending to agree. The
// bands (strong ≥ 0.70, possible ≥ 0.50) are display bands, not calibrated thresholds.
import profileJson from "./profile.json" with { type: "json" };

export const LEVELS = ["none", "low", "medium", "high"] as const;
export type Level = (typeof LEVELS)[number];
export const FEATURES = [
  "semantic_ambiguity",
  "context_dependence",
  "deterministic_expressibility",
  "judgment_required",
  "rule_stability",
  "risk_or_policy_component",
  "natural_language_understanding",
  "decision_complexity"
] as const;
export type Feature = (typeof FEATURES)[number];
export type FeatureLevels = Partial<Record<Feature, Level | "unknown">>;

interface ProfileFeature {
  jevTop: string;
  deterministicTop: string;
  jev: Record<string, number>;
  deterministic: Record<string, number>;
}
export const PROFILE = profileJson as { runId: string; from: { jevSites: number; deterministicDecisions: number; projects: number }; note: string; features: Record<string, ProfileFeature> };

const rank = (l: string) => LEVELS.indexOf(l as Level);

export interface FeatureMatch {
  feature: Feature;
  level: Level;
  looksLike: "jev" | "deterministic" | "between";
  jevSitesShowed: string;
  deterministicShowed: string;
}

/**
 * For each feature the candidate reports, is its level nearer the level the Jev sites showed or
 * the level the deterministic code showed? 1 = nearer Jev, 0.5 = halfway, 0 = nearer deterministic.
 * The score is the mean over the features that were reported (unknown ones are skipped).
 */
export function patternScore(levels: FeatureLevels): { score?: number; matches: FeatureMatch[] } {
  const matches: FeatureMatch[] = [];
  let sum = 0;
  for (const f of FEATURES) {
    const l = levels[f];
    const p = PROFILE.features[f];
    if (!l || l === "unknown" || !p || rank(l) < 0) continue;
    const dj = Math.abs(rank(l) - rank(p.jevTop));
    const dd = Math.abs(rank(l) - rank(p.deterministicTop));
    const looksLike = dj < dd ? "jev" : dj > dd ? "deterministic" : "between";
    sum += looksLike === "jev" ? 1 : looksLike === "between" ? 0.5 : 0;
    matches.push({ feature: f, level: l, looksLike, jevSitesShowed: p.jevTop, deterministicShowed: p.deterministicTop });
  }
  return { ...(matches.length ? { score: sum / matches.length } : {}), matches };
}

export interface JevAnswers {
  judgment: number;
  bounded: number;
  deterministicIsCorrect: number;
  primitive: string;
  primitiveConfidence: number;
  category: string;
}

/** Jev's fit: judgment needed, outcomes bounded, and exact code NOT the better tool — averaged. */
export function typesafeScore(a: JevAnswers): number {
  return (a.judgment + a.bounded + (1 - a.deterministicIsCorrect)) / 3;
}

export type Verdict = "STRONG_FIT" | "POSSIBLE_FIT" | "WEAK_FIT" | "REVIEW_DISAGREE";

export interface Scorecard {
  scores: { patterns?: number; ai?: number; typesafe?: number };
  average?: number;
  verdict: Verdict;
  why: string;
  missing: string[];
}

export function combine(scores: Scorecard["scores"]): Scorecard {
  const present = Object.entries(scores).filter((e): e is [string, number] => typeof e[1] === "number");
  const missing = (["patterns", "ai", "typesafe"] as const).filter((k) => typeof scores[k] !== "number");
  if (!present.length) return { scores, verdict: "WEAK_FIT", why: "no score available", missing };
  const average = present.reduce((s, [, v]) => s + v, 0) / present.length;
  const yes = present.filter(([, v]) => v >= 0.5).map(([k]) => k);
  const no = present.filter(([, v]) => v < 0.5).map(([k]) => k);
  if (yes.length && no.length)
    return { scores, average, verdict: "REVIEW_DISAGREE", why: `fits: ${yes.join(" + ")} · doesn't fit: ${no.join(" + ")} — look before changing code`, missing };
  const verdict: Verdict = average >= 0.7 ? "STRONG_FIT" : average >= 0.5 ? "POSSIBLE_FIT" : "WEAK_FIT";
  return { scores, average, verdict, why: `${present.length} of 3 sources agree${missing.length ? ` (${missing.join(", ")} unavailable)` : ""}`, missing };
}

const pct = (x?: number) => (typeof x === "number" ? `${Math.round(x * 100)}%` : "—");
const bar = (x?: number) => (typeof x === "number" ? "█".repeat(Math.round(x * 10)) + "░".repeat(10 - Math.round(x * 10)) : "··········");

export function renderCard(c: Scorecard, title: string): string {
  const icon = { STRONG_FIT: "🟢", POSSIBLE_FIT: "🟡", WEAK_FIT: "🔴", REVIEW_DISAGREE: "🟠" }[c.verdict];
  return [
    `JevX scorecard — ${title}`,
    `  patterns   ${bar(c.scores.patterns)} ${pct(c.scores.patterns)}   (vs ${PROFILE.from.jevSites} real Jev sites studied)`,
    `  AI         ${bar(c.scores.ai)} ${pct(c.scores.ai)}   (your AI, after reading the code)`,
    `  TypeSafe   ${bar(c.scores.typesafe)} ${pct(c.scores.typesafe)}   (Jev's own opinion)`,
    `  ─────────────────────────────`,
    `  average    ${bar(c.average)} ${pct(c.average)}   ${icon} ${c.verdict}`,
    `  ${c.why}`
  ].join("\n");
}
