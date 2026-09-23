// dataset/boundary/PATTERNS.md — the human-readable Layer E, rendered from a stored PatternRecord
// only. No API call, no source code, and nothing here that is not in the record.
import type { PatternRecord } from "./schema.js";

const n = (x: number) => x.toLocaleString("en-US");

/** `C:jev-guard:…` → `src/guard.js:149 scanContent (jev-guard)`, when the record knows it. */
const where = (rec: PatternRecord, id: string) => {
  const r = rec.index[id];
  return r ? `${r.where} _(${r.project})_` : id;
};

const list = (rec: PatternRecord, ids: string[], limit = 8) =>
  ids.length ? ids.slice(0, limit).map((id) => `    - \`${id}\` — ${where(rec, id)}`).join("\n") + (ids.length > limit ? `\n    - …and ${ids.length - limit} more` : "") : "    - none";

export function renderPatterns(rec: PatternRecord): string {
  const L: string[] = [];
  const s = rec.source;
  L.push("# JevX — Layer E: where and why Jev is used", "");
  L.push(
    "_Hypotheses, not rules._ Every number below is counted from the stored records in `dataset/boundary/**`; nothing here is a score, a weight or a threshold.",
    "A Jev call in the corpus shows that a developer **chose** Jev there — not that Jev was objectively right.",
    "Deterministic code beside it shows a different implementation boundary — not that Jev would be wrong there.",
    ""
  );
  L.push(
    `Run \`${rec.runId}\` · ${rec.at} · ${s.projects.length} project(s): ${s.projects.join(", ")}` +
      (s.excludedProjects.length ? ` · excluded (TEST split): ${s.excludedProjects.join(", ")}` : ""),
    ""
  );
  L.push("| | |", "| --- | --- |");
  L.push(`| Jev usage analyses (usable) | ${s.analyses} (${s.usableAnalyses}) |`);
  L.push(`| Contrasts analyzed / judged real decisions | ${s.contrasts} / ${s.realDecisionContrasts} |`);
  L.push(`| Evidence groups | ${rec.result.patterns.length} |`);
  L.push(
    `| Wording | ${rec.analyst ? `${rec.analyst.provider} · ${rec.analyst.model} · prompt ${rec.analyst.promptVersion} (${rec.result.patterns.filter((p) => p.statementSource === "model").length} of ${rec.result.patterns.length} groups)` : "aggregated only — no model was used"} |`
  );
  if (rec.synthesis) L.push(`| Synthesis batches | ${rec.synthesis.batches} (${rec.synthesis.failed.length} failed) |`);
  if (rec.accounting.calls)
    L.push(
      `| Cost of this step | ${n(rec.accounting.inputTokens)} in + ${n(rec.accounting.outputTokens)} out tokens in ${rec.accounting.calls} call(s)` +
        (rec.accounting.costUsd !== undefined ? ` · $${rec.accounting.costUsd.toFixed(4)} (${rec.accounting.costSource === "provider" ? "provider-reported" : "calculated from configured prices"})` : "") +
        " |"
    );
  L.push("");

  for (const side of ["separator", "jev", "deterministic"] as const) {
    const ps = rec.result.patterns.filter((p) => p.side === side);
    if (!ps.length) continue;
    L.push(
      side === "separator"
        ? "## What separates Jev decisions from the deterministic ones"
        : side === "jev"
          ? "## Recorded on the Jev side only (describes Jev sites; separates nothing yet)"
          : "## Recorded on the deterministic side",
      ""
    );
    for (const p of ps) {
      L.push(`### ${p.statement}`, "");
      L.push(`- **Category:** \`${p.category}\` · **strength:** ${p.strength} · **confidence:** ${p.confidence}${p.contested ? " · **contested**" : ""}`);
      L.push(`- **Wording:** ${p.statementSource === "model" ? "the analyst's, over JevX's counts" : "JevX's own, from the counts"}`);
      if (p.statementSource === "model") L.push(`- **What the counts show:** ${p.evidence}`);
      L.push(`- **Counted from:** ${p.basis}`);
      L.push(`- **Projects supporting it:** ${p.projects.length}${p.projects.length ? ` (${p.projects.join(", ")})` : ""}`);
      L.push(`- **Supporting Jev usages (${p.supporting.length}):**`);
      L.push(list(rec, p.supporting));
      L.push(`- **Contrasting deterministic examples (${p.contrasting.length}):**`);
      L.push(list(rec, p.contrasting));
      L.push(`- **Counter-examples / conflicting evidence (${p.counter_examples.length}):**`);
      L.push(p.counter_examples.length ? p.counter_examples.map((id) => `    - \`${id}\` — ${where(rec, id)}`).join("\n") : "    - none found in this data");
      L.push(`- **Unknowns:**`);
      L.push(p.unknowns.length ? p.unknowns.map((u) => `    - ${u}`).join("\n") : "    - none recorded");
      if (p.caveat) L.push(`- **Caveat (analyst):** ${p.caveat}`);
      for (const note of p.notes) L.push(`- ⚠︎ ${note}`);
      L.push("");
    }
  }

  if (rec.result.rejected_explanations.length) {
    L.push("## Explanations this evidence does NOT support", "");
    for (const r of rec.result.rejected_explanations) L.push(`- ✗ ${r.statement} — ${r.why}`);
    L.push("");
  }
  if (rec.notes.length) {
    L.push("## About the evidence itself", "");
    for (const x of rec.notes) L.push(`- ${x}`);
    L.push("");
  }
  if (rec.result.open_questions.length) {
    L.push("## Open questions", "");
    for (const q of rec.result.open_questions) L.push(`- ${q}`);
    L.push("");
  }
  if (rec.synthesis?.failed.length) {
    L.push("## Batches that did not answer", "");
    for (const f of rec.synthesis.failed) L.push(`- ${f.groups.join(", ")}: ${f.error} _(their patterns above are JevX's own wording)_`);
    L.push("");
  }
  if (rec.unknowns.length) {
    L.push("## What the repositories could not tell us", "");
    for (const u of rec.unknowns) L.push(`- ${u}`);
    L.push("");
  }
  return L.join("\n");
}
