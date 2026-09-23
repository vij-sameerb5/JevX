// Exports the learned feature profile (from Layer E, dataset/boundary/patterns.json) that the
// jevx-mcp scorecard compares proposals against. Re-run after re-deriving Layer E:
//   pnpm tsx scripts/export-profile.ts
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PatternRecord } from "@jevx/boundary";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, "..", "dataset", "boundary", "patterns.json");
const out = path.join(here, "..", "packages", "engine", "src", "profile.json");

const rec = JSON.parse(readFileSync(src, "utf8")) as PatternRecord;
const features: Record<string, { jev: Record<string, number>; deterministic: Record<string, number>; jevTop: string; deterministicTop: string }> = {};
for (const p of rec.result.patterns) {
  if (!p.groupId.startsWith("feature:")) continue;
  const f = p.groupId.slice("feature:".length);
  // the counted levels live in the pattern's evidence line (always JevX's own wording)
  const m = p.evidence.match(/show \w+ = (\w+) \(([^)]*)\) where the deterministic decisions beside them show (\w+) \(([^)]*)\)/);
  if (!m) continue;
  const parse = (s: string) => Object.fromEntries(s.split(", ").map((x) => x.split(" ")).map(([k, v]) => [k!, Number(v)]));
  features[f] = { jevTop: m[1]!, jev: parse(m[2]!), deterministicTop: m[3]!, deterministic: parse(m[4]!) };
}
const profile = {
  source: "dataset/boundary/patterns.json",
  runId: rec.runId,
  from: { jevSites: rec.source.usableAnalyses, deterministicDecisions: rec.source.realDecisionContrasts, projects: rec.source.projects.length },
  note: "Learned from a small pilot. A match means 'looks like the Jev sites we studied', not 'Jev is right here'.",
  features
};
writeFileSync(out, JSON.stringify(profile, null, 2) + "\n");
console.log(`wrote ${path.relative(process.cwd(), out)}: ${Object.keys(features).length} features from ${profile.from.jevSites} Jev sites / ${profile.from.deterministicDecisions} deterministic decisions`);
