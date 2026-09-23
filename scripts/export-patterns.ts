// Pull the learned patterns out of Supabase and ship them inside the next jevx release.
//
//   JEVX_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npx tsx scripts/export-patterns.ts
//
// Reads the jevx_patterns view (service role only — clients can never read the dataset) and writes
// packages/engine/src/patterns-learned.json, which the scorecard blends into its patterns score
// once a pattern has ≥ 5 kept-or-undone outcomes. The key comes from the environment only and is
// never printed or written.
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../packages/engine/src/patterns-learned.json");

export interface Row {
  pattern_label: string;
  input_kind: string | null;
  rule_kind: string | null;
  primitive: string | null;
  findings: number;
  good: number;
  bad: number;
  rejected: number;
}

export async function exportPatterns(opts: { url: string; key: string; out?: string; fetch?: typeof fetch }): Promise<{ patterns: number; labelled: number; file: string }> {
  const f = opts.fetch ?? fetch;
  const url = `${opts.url.replace(/\/+$/, "")}/rest/v1/jevx_patterns?select=pattern_label,input_kind,rule_kind,primitive,findings,good,bad,rejected&order=findings.desc&limit=5000`;
  const res = await f(url, { headers: { apikey: opts.key, Authorization: `Bearer ${opts.key}` } });
  if (!res.ok) throw new Error(`Supabase answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const rows = (await res.json()) as Row[];
  const patterns = rows
    .filter((r) => r.pattern_label)
    .map((r) => ({ pattern_label: r.pattern_label, input_kind: r.input_kind ?? "other", rule_kind: r.rule_kind ?? "other", primitive: r.primitive ?? "none", findings: Number(r.findings) || 0, good: Number(r.good) || 0, bad: Number(r.bad) || 0, rejected: Number(r.rejected) || 0 }));
  const file = opts.out ?? OUT;
  writeFileSync(file, JSON.stringify({ exportedAt: new Date().toISOString(), note: "Written by scripts/export-patterns.ts from the jevx_patterns view (outcomes shared with --share).", patterns }, null, 2) + "\n");
  return { patterns: patterns.length, labelled: patterns.reduce((s, p) => s + p.good + p.bad, 0), file };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const url = process.env.JEVX_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    console.error("Set JEVX_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your shell (never in a committed file).");
    process.exit(1);
  }
  exportPatterns({ url, key })
    .then((r) => console.log(`Wrote ${r.patterns} pattern(s), ${r.labelled} labelled outcome(s) → ${path.relative(process.cwd(), r.file)}. Rebuild jevx to ship them.`))
    .catch((e: unknown) => {
      console.error(e instanceof Error ? e.message : String(e));
      process.exit(1);
    });
}
