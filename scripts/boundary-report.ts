// M5b pilot evaluation report, built ONLY from stored records (dataset/boundary/**). No API calls.
// Counts and token/cost figures are exact sums of runs.jsonl / record accounting — never estimates.
// The qualitative review (did Grok understand? hallucinate? are contrasts comparable?) is done by
// reading the per-site section this writes, not by this script.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { BoundaryStore, type AnalysisRecord, type ContrastRecord, type RunRecord } from "@jevx/boundary";

export function buildReport(datasetDir: string, since?: string): string {
  const store = new BoundaryStore(datasetDir);
  const projects = store.projects();
  const inWindow = (at: string) => !since || at >= since;
  const runs: RunRecord[] = projects.flatMap((p) => store.runs(p)).filter((r) => inWindow(r.at));
  const analyses: AnalysisRecord[] = projects.flatMap((p) => store.analyses(p)).filter((a) => inWindow(a.at));
  const contrasts: ContrastRecord[] = projects.flatMap((p) => store.contrasts(p)).filter((c) => inWindow(c.at));
  const n = (x: number) => x.toLocaleString("en-US");

  const tok = runs.reduce(
    (t, r) => ({
      in: t.in + r.accounting.inputTokens,
      out: t.out + r.accounting.outputTokens,
      reason: t.reason + r.accounting.reasoningTokens,
      cached: t.cached + r.accounting.cachedTokens,
      calls: t.calls + r.accounting.calls,
      retries: t.retries + r.accounting.retries,
      cost: t.cost + (r.accounting.costUsd ?? 0),
      costKnown: t.costKnown && (r.accounting.calls === 0 || r.accounting.costUsd !== undefined),
      source: !r.accounting.costSource ? t.source : !t.source || t.source === r.accounting.costSource ? r.accounting.costSource : "mixed"
    }),
    { in: 0, out: 0, reason: 0, cached: 0, calls: 0, retries: 0, cost: 0, costKnown: true, source: undefined as "provider" | "calculated" | "mixed" | undefined }
  );
  const bySite = (a: AnalysisRecord) => contrasts.filter((c) => c.project === a.project && c.siteId === a.siteId);
  const meaningful = (c: ContrastRecord) => c.facts.is_a_real_decision && c.usable;
  const withMeaningful = analyses.filter((a) => bySite(a).some(meaningful)).length;
  const withAny = analyses.filter((a) => bySite(a).length > 0).length;
  const expanded = analyses.filter((a) => a.context.rounds > 1).length;
  const uncertain = analyses.filter((a) => !a.usable || a.facts.confidence === "low" || a.facts.understanding_confidence === "low").length;
  const failed = runs.reduce((k, r) => k + r.usages.failed, 0);
  const errors = runs.flatMap((r) => r.errors.map((e) => `${r.project}: ${e}`));

  // feature levels, Jev sites vs contrasts (descriptive only — no weights)
  const feats = analyses[0] ? Object.keys(analyses[0].facts.features) : [];
  const dist = (rows: { features: Record<string, string> }[], f: string) => {
    const m: Record<string, number> = {};
    for (const r of rows) m[r.features[f] ?? "?"] = (m[r.features[f] ?? "?"] ?? 0) + 1;
    return ["high", "medium", "low", "none", "unknown"].filter((k) => m[k]).map((k) => `${k} ${m[k]}`).join(", ") || "–";
  };
  const hyp: Record<string, Record<string, number>> = {};
  for (const a of analyses) for (const [k, v] of Object.entries(a.facts.why_jev_hypotheses ?? {})) (hyp[k] ??= {})[v] = ((hyp[k] ??= {})[v] ?? 0) + 1;
  const notr: Record<string, Record<string, number>> = {};
  for (const a of analyses) for (const [k, v] of Object.entries(a.facts.not_reasons ?? {})) (notr[k] ??= {})[v] = ((notr[k] ??= {})[v] ?? 0) + 1;
  const fmtA = (m: Record<string, number>) => ["supported", "contradicted", "not_determinable"].map((k) => m[k] ?? 0).join(" / ");

  const L: string[] = [];
  L.push("# M5b pilot report", "");
  L.push(`_Generated from stored records only (dataset/boundary). Everything under "Grok" is **model inference**, not fact. ${since ? `Window: records since ${since}.` : "All stored records."}_`, "");
  if (!runs.length && !analyses.length)
    L.push("> **No stored records yet.** Run `pnpm corpus boundary <slug…>` first, then regenerate this report.", "");
  L.push("## Numbers (exact)", "");
  L.push("| | |", "| --- | --- |");
  L.push(`| Projects with analyses | ${new Set(analyses.map((a) => a.project)).size} (${[...new Set(analyses.map((a) => a.project))].join(", ") || "–"}) |`);
  L.push(`| Jev usages analyzed | ${analyses.length} (${failed} failed) |`);
  L.push(`| With ≥1 contrast / ≥1 meaningful contrast | ${withAny} / ${withMeaningful} |`);
  L.push(`| No contrast selected | ${analyses.length - withAny} |`);
  L.push(`| Contrasts analyzed / judged a real decision / shares Jev-site traits (yes·partly) | ${contrasts.length} / ${contrasts.filter((c) => c.facts.is_a_real_decision).length} / ${contrasts.filter((c) => c.facts.shares_jev_site_traits === "yes" || c.facts.shares_jev_site_traits === "partly").length} |`);
  L.push(`| Sufficient context / needed expansion (>1 round) | ${analyses.filter((a) => a.usable).length} / ${expanded} |`);
  L.push(`| Uncertain (insufficient, or low confidence/understanding) | ${uncertain} |`);
  L.push(`| API calls / retries | ${n(tok.calls)} / ${tok.retries} |`);
  L.push(`| Input / output tokens (reasoning) | ${n(tok.in)} / ${n(tok.out)} (${n(tok.reason)}) |`);
  L.push(`| Cached tokens | ${n(tok.cached)} |`);
  const label = tok.source === "provider" ? "provider-reported" : tok.source === "calculated" ? "calculated from configured prices" : tok.source === "mixed" ? "mixed: provider-reported and calculated" : "no cost recorded";
  L.push(`| Cost (${label}) | $${tok.cost.toFixed(4)}${tok.costKnown ? "" : " (some calls recorded no cost)"} |`);
  const analysts = [...new Set([...analyses, ...contrasts].map((r) => `${r.analyst.provider} · ${r.analyst.model} · prompt ${r.analyst.promptVersion}`))];
  L.push(`| Analyst(s) | ${analysts.join(" / ") || "–"} |`);
  L.push("");
  if (errors.length) L.push("### Errors", "", ...errors.map((e) => `- ${e}`), "");

  L.push("## Features — Jev sites vs deterministic contrasts (levels, descriptive only)", "");
  L.push("| feature | Jev sites | contrasts |", "| --- | --- | --- |");
  for (const f of feats) L.push(`| ${f} | ${dist(analyses.map((a) => a.facts), f)} | ${dist(contrasts.map((c) => c.facts), f)} |`);
  L.push("");
  L.push("## Why-Jev hypotheses (supported / contradicted / not determinable)", "");
  for (const [k, m] of Object.entries(hyp).sort((a, b) => (b[1].supported ?? 0) - (a[1].supported ?? 0))) L.push(`- ${k}: ${fmtA(m)}`);
  L.push("", "## Not-reasons (supported / contradicted / not determinable)", "");
  for (const [k, m] of Object.entries(notr)) L.push(`- ${k}: ${fmtA(m)}`);
  L.push("");

  const pats = store.patterns().filter((p) => inWindow(p.at));
  if (pats.length) {
    const p = pats[pats.length - 1]!;
    L.push(`## Patterns (hypotheses, latest run ${p.runId}, ${p.projects.length} project(s))`, "");
    L.push(`_Full Layer E, with every record behind every number: \`dataset/boundary/PATTERNS.md\` and \`patterns.json\`._`, "");
    for (const side of ["separator", "jev", "deterministic"] as const)
      for (const x of p.result.patterns.filter((q) => q.side === side))
        L.push(`- **${side}** · ${x.statement} _(${x.strength}; ${x.confidence} confidence; supporting: ${x.supporting.join(", ")}${x.counter_examples.length ? `; counter: ${x.counter_examples.join(", ")}` : ""})_`);
    for (const r of p.result.rejected_explanations) L.push(`- ✗ not supported: ${r.statement} — ${r.why}`);
    for (const q of p.result.open_questions) L.push(`- ? ${q}`);
    L.push("");
  }

  L.push("## Per site (read these to judge quality)", "");
  for (const a of analyses) {
    L.push(`### ${a.project} · ${a.site.file}:${a.site.unit.start} ${a.site.unit.name}`, "");
    L.push(`nature **${a.facts.nature}** · confidence ${a.facts.confidence} · understanding ${a.facts.understanding_confidence} · ${a.context.rounds} round(s), ${n(a.context.chars)} chars, stopped: ${a.context.stoppedBy} · ${n(a.accounting.inputTokens)}+${n(a.accounting.outputTokens)} tokens`, "");
    const x = a.analysis;
    if (!x) L.push("_private project: facts only in the dataset_", "");
    else {
      L.push(`- **decides:** ${x.decision.what_is_decided}`);
      L.push(`- **inputs:** ${x.decision.inputs.map((i) => `${i.name} (${i.source})`).join("; ") || "–"}`);
      L.push(`- **outcomes → then:** ${x.decision.outcomes.join(" | ") || "–"} → ${x.decision.downstream_action}`);
      for (const c of x.why_jev.observed) L.push(`- observed: ${c.claim} ${c.evidence.map((e) => `\`${e.location}\``).join(" ")}`);
      for (const c of x.why_jev.inferred) L.push(`- inferred: ${c.claim}`);
      for (const u of x.why_jev.unknown) L.push(`- unknown: ${u}`);
      L.push(`- exact-rule alternative: ${x.deterministic_alternative.what_rules_would_need} — ${x.deterministic_alternative.adequacy}`);
      if (a.context.items && a.context.items.length > 1) L.push(`- context used: ${a.context.items.join(", ")}`);
    }
    for (const c of bySite(a)) {
      L.push(`- ◇ contrast \`${c.contrast.file}:${c.contrast.unit.start}\` ${c.contrast.unit.name} (${c.contrast.selection}) · ${c.facts.nature} · real decision: ${c.facts.is_a_real_decision ? "yes" : "NO"} · shares traits: ${c.facts.shares_jev_site_traits}`);
      const y = c.analysis;
      if (y) {
        for (const d of y.why_deterministic.inferred.slice(0, 2)) L.push(`  - why deterministic: ${d.claim}`);
        for (const d of y.differences_from_jev_site.slice(0, 2)) L.push(`  - ≠ ${d.claim}`);
        for (const u of y.why_deterministic.unknown.slice(0, 1)) L.push(`  - unknown: ${u}`);
      }
    }
    if (!bySite(a).length) L.push("- no contrast (none nearby, not forced)");
    L.push("");
  }
  return L.join("\n");
}

export function writeReport(datasetDir: string, since?: string): string {
  const file = path.join(datasetDir, "boundary", "PILOT-REPORT.md");
  mkdirSync(path.dirname(file), { recursive: true }); // dataset/boundary/ may not exist before the first run
  writeFileSync(file, buildReport(datasetDir, since));
  return file;
}
