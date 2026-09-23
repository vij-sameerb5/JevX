// Proposals live in <root>/.jevx/proposals/<id>.json (+ <id>.patch once a change is previewed),
// and every write regenerates <root>/.jevx/report.html: each scorecard with its red/green diff.
// Nothing here edits the user's source files — previewing a change only produces the diff.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createTwoFilesPatch } from "diff";
import type { Proposal } from "./jev.js";
import type { FeatureLevels, FeatureMatch, JevAnswers, Scorecard } from "./scorecard.js";
import type { Pattern } from "./prompts.js";

export interface ProposalRecord {
  id: string;
  file: string;
  startLine: number;
  endLine: number;
  proposal: Proposal;
  features: FeatureLevels;
  ai: { score: number; reasons: string };
  patterns: FeatureMatch[];
  jev?: JevAnswers;
  jevError?: string;
  scorecard: Scorecard;
  /** Generic kind of code (no names) — what JevX learns from when outcomes are shared. */
  pattern?: Pattern;
  patch?: string;
  at: string;
}

export const proposalId = (file: string, line: number) => `${file.replace(/[^\w.-]+/g, "_")}_L${line}`;
const dir = (root: string) => path.join(root, ".jevx", "proposals");

export function saveProposal(root: string, r: ProposalRecord) {
  mkdirSync(dir(root), { recursive: true });
  writeFileSync(path.join(dir(root), `${r.id}.json`), JSON.stringify(r, null, 2));
  if (r.patch) writeFileSync(path.join(dir(root), `${r.id}.patch`), r.patch);
  writeReport(root);
}

export function loadProposal(root: string, id: string): ProposalRecord | undefined {
  const f = path.join(dir(root), `${id}.json`);
  return existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as ProposalRecord) : undefined;
}

export function allProposals(root: string): ProposalRecord[] {
  if (!existsSync(dir(root))) return [];
  return readdirSync(dir(root))
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(path.join(dir(root), f), "utf8")) as ProposalRecord)
    .sort((a, b) => (b.scorecard.average ?? 0) - (a.scorecard.average ?? 0));
}

/** Lines [start, end] (1-based, inclusive) of `file` replaced with `newCode`, as a unified diff. */
export function previewDiff(root: string, file: string, start: number, end: number, newCode: string): { patch: string; added: number; removed: number } {
  const abs = path.join(root, file);
  const before = readFileSync(abs, "utf8");
  const lines = before.split("\n");
  if (start < 1 || end < start || end > lines.length) throw new Error(`lines ${start}-${end} are outside ${file} (${lines.length} lines)`);
  const after = [...lines.slice(0, start - 1), ...newCode.replace(/\n$/, "").split("\n"), ...lines.slice(end)].join("\n");
  const patch = createTwoFilesPatch(`a/${file}`, `b/${file}`, before, after, "current", "with Jev", { context: 3 });
  const body = patch.split("\n");
  return { patch, added: body.filter((l) => l.startsWith("+") && !l.startsWith("+++")).length, removed: body.filter((l) => l.startsWith("-") && !l.startsWith("---")).length };
}

// ─── report.html ───

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const pct = (x?: number) => (typeof x === "number" ? `${Math.round(x * 100)}%` : "—");
const VERDICT = { STRONG_FIT: ["Strong fit", "good"], POSSIBLE_FIT: ["Possible fit", "maybe"], WEAK_FIT: ["Weak fit", "bad"], REVIEW_DISAGREE: ["Sources disagree", "warn"] } as const;

function diffHtml(patch: string): string {
  return hunksOf(patch)
    .split("\n")
    .map((l) => {
      const cls = l.startsWith("+") ? "add" : l.startsWith("-") ? "del" : l.startsWith("@@") ? "hunk" : "ctx";
      return `<div class="ln ${cls}">${esc(l) || "&nbsp;"}</div>`;
    })
    .join("");
}

function meter(label: string, v: number | undefined, note: string) {
  return `<div class="m"><span class="ml">${label}</span><span class="bar"><i style="width:${typeof v === "number" ? Math.round(v * 100) : 0}%"></i></span><b>${pct(v)}</b><span class="mn">${esc(note)}</span></div>`;
}

export function renderReport(root: string, rs: ProposalRecord[]): string {
  const cards = rs
    .map((r) => {
      const [vl, vc] = VERDICT[r.scorecard.verdict];
      const p = r.proposal;
      return `<section class="card">
  <header><div><code>${esc(r.file)}:${r.startLine}</code><h2>${esc(p.decision)}</h2></div><span class="pill ${vc}">${vl} · ${pct(r.scorecard.average)}</span></header>
  <div class="meters">
    ${meter("Patterns", r.scorecard.scores.patterns, "vs real Jev sites studied")}
    ${meter("AI", r.scorecard.scores.ai, "your AI, after reading the code")}
    ${meter("TypeSafe", r.scorecard.scores.typesafe, r.jevError ? "not available" : "Jev's own opinion")}
  </div>
  <p class="why">${esc(r.scorecard.why)}</p>
  <dl>
    <dt>Primitive</dt><dd><code>${esc(p.primitive)}</code>${r.jev ? ` <span class="dim">(Jev suggests <code>${esc(r.jev.primitive)}</code>)</span>` : ""}</dd>
    <dt>Question</dt><dd>${esc(p.question)}</dd>
    <dt>Outcomes</dt><dd>${p.outcomes.map((o) => `<code>${esc(o)}</code>`).join(" ")}</dd>
    <dt>State</dt><dd>${p.state.map((o) => `<code>${esc(o)}</code>`).join(" ")}</dd>
    <dt>Why Jev</dt><dd>${esc(p.why)}</dd>
    <dt>Stays exact</dt><dd>${esc(p.deterministic_remainder)}</dd>
  </dl>
  ${r.patch ? `<div class="diff">${diffHtml(r.patch)}</div>` : `<p class="dim">No change previewed yet.</p>`}
</section>`;
    })
    .join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>JevX report</title>
<style>
:root{--bg:#fafaf9;--fg:#1c1917;--dim:#78716c;--card:#fff;--line:#e7e5e4;--add:#dcfce7;--addf:#166534;--del:#fee2e2;--delf:#991b1b;--hunk:#eef2ff;--bar:#4f46e5}
@media (prefers-color-scheme:dark){:root{--bg:#0c0a09;--fg:#f5f5f4;--dim:#a8a29e;--card:#1c1917;--line:#292524;--add:#052e16;--addf:#86efac;--del:#450a0a;--delf:#fca5a5;--hunk:#1e1b4b;--bar:#818cf8}}
*{box-sizing:border-box}body{margin:0;padding:24px 16px;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif}
main{max-width:980px;margin:auto}h1{margin:0 0 4px}.dim{color:var(--dim)}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:20px;margin:20px 0}
header{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap}h2{margin:4px 0 0;font-size:18px}
.pill{padding:4px 10px;border-radius:999px;font-weight:600;font-size:13px;white-space:nowrap}
.good{background:var(--add);color:var(--addf)}.bad{background:var(--del);color:var(--delf)}.maybe,.warn{background:#fef3c7;color:#92400e}
.meters{margin:14px 0 4px}.m{display:grid;grid-template-columns:80px 1fr 44px;gap:10px;align-items:center;margin:4px 0}.mn{grid-column:2/4;font-size:12px;color:var(--dim);margin-top:-4px}
.bar{height:8px;background:var(--line);border-radius:4px;overflow:hidden}.bar i{display:block;height:100%;background:var(--bar)}
.why{font-size:14px;color:var(--dim)}dl{display:grid;grid-template-columns:110px 1fr;gap:6px 12px;font-size:14px}dt{color:var(--dim)}dd{margin:0}
code{font:13px ui-monospace,monospace}.diff{margin-top:14px;border:1px solid var(--line);border-radius:8px;overflow-x:auto;font:13px/1.45 ui-monospace,monospace}
.ln{white-space:pre;padding:0 12px}.add{background:var(--add);color:var(--addf)}.del{background:var(--del);color:var(--delf)}.hunk{background:var(--hunk);color:var(--dim)}
</style></head><body><main>
<h1>JevX report</h1>
<p class="dim">${esc(path.basename(root))} · ${rs.length} proposal(s) · scores are opinions to help you decide, not proof. Nothing has been changed yet.</p>
${cards || `<p class="dim">No proposals yet.</p>`}
</main></body></html>`;
}

export function writeReport(root: string): string {
  const f = path.join(root, ".jevx", "report.html");
  mkdirSync(path.dirname(f), { recursive: true });
  writeFileSync(f, renderReport(root, allProposals(root)));
  return f;
}

/** The hunks of a unified diff, without the file header lines. */
export function hunksOf(patch: string): string {
  const lines = patch.split("\n");
  const first = lines.findIndex((l) => l.startsWith("@@"));
  return (first < 0 ? "" : lines.slice(first).join("\n")).trimEnd();
}
