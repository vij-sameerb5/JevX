// The autonomous run behind `npx jevx`: no picking, no prompts. The AI is the brain.
//
//   1. index    local, free                                   (workspace.ts)
//   2. read     AI reads the source itself, part by part, and names every spot    (1 call per part)
//               (if every part fails: the static candidates, ranked, as a fallback)
//   3. assess   AI per spot, pulling repo context on demand                        (1–3 calls each)
//   4. score    patterns + AI + TypeSafe → scorecard                              (TypeSafe optional)
//   5. edit     AI writes exact search/replace edits for STRONG fits, callers included (1–2 calls)
//
// Only STRONG fits (every available source says yes, average ≥ 70%) get edits. Anything the
// sources disagree about, or that is weak, is reported and left alone. Budget is checked before
// every AI call, so a run never spends more than it was allowed.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createTwoFilesPatch } from "diff";
import type { ContextItem } from "@jevx/core";
import { runAdaptive, type AdaptiveResult, type GeminiTransport } from "@jevx/gemini";
import { askJev, type Proposal } from "./jev.js";
import { proposalId, saveProposal, type ProposalRecord } from "./proposals.js";
import { buildAssessPrompt, buildEditPrompt, buildReadPrompt, parseAssessment, parseEdits, parseRead, type Assessment, type Edit, type EditInputFile, type ReadSpot } from "./prompts.js";
import { CHARS_PER_TOKEN, planRead, readPriority } from "./read.js";
import { blendPatterns, combine, learnedScore, patternScore, typesafeScore } from "./scorecard.js";
import { workspace, type Workspace } from "./workspace.js";

export const DEFAULT_MAX_INSPECT = 12;
/** Spots the reader itself rates below this are not worth a second call. */
export const MIN_SPOT_CONFIDENCE = 0.5;
export const DEFAULT_RUN_BUDGET = 400_000;
/** Default and floor for writing a change. JevX never writes a fit under 50%. */
export const DEFAULT_MIN_FIT = 0.7;
export const MIN_FIT_FLOOR = 0.5;

/** Would this fit be written at `minFit`? The AI must call it an opportunity and the average must reach it. */
export function eligible(o: { status: OpportunityStatus; assessment?: { is_opportunity: boolean }; record?: { scorecard: { average?: number; verdict: string } } }, minFit = DEFAULT_MIN_FIT, includeDisagree = false): boolean {
  const avg = o.record?.scorecard.average;
  if (!o.assessment?.is_opportunity || avg === undefined || avg + 1e-9 < Math.max(MIN_FIT_FLOOR, minFit)) return false;
  if (o.record!.scorecard.verdict === "REVIEW_DISAGREE") return includeDisagree;
  return o.record!.scorecard.verdict !== "WEAK_FIT";
}
/** Per AI call. Reading ~23k tokens with a reasoning model can take minutes; the generic 30 s default is far too short. */
export const DEFAULT_CALL_TIMEOUT_MS = 240_000;

export type OpportunityStatus = "strong" | "possible" | "review" | "weak" | "not_opportunity" | "edit_failed" | "failed";

export interface Opportunity {
  id: string;
  file: string;
  unit: { name: string; start: number; end: number };
  origin: "static" | "ai";
  /** What the reader saw here (AI-found spots). */
  hint?: string;
  status: OpportunityStatus;
  assessment?: Assessment;
  record?: ProposalRecord;
  edits?: Edit[];
  summary?: string;
  note?: string;
}

export interface Spend {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd?: number;
  costSource?: "provider" | "calculated";
}

export type PipelineEvent =
  | { type: "indexed"; files: number; candidates: number; existingJev: number }
  | { type: "reading"; files: number; unread: number; parts: number; estTokens: number; coverage: number }
  | { type: "read"; done: number; total: number; named: number; kept: number; spots: number; error?: string }
  | { type: "surveyed"; inspect: number; missed: number; fallback?: boolean }
  | { type: "assessing"; done: number; total: number; where: string }
  | { type: "assessed"; opportunity: Opportunity }
  | { type: "editing"; where: string }
  | { type: "budget"; spent: number };

export interface PipelineOptions {
  root: string;
  transport: GeminiTransport;
  analyst: { provider: string; model: string };
  maxInspect?: number;
  budgetTokens?: number;
  concurrency?: number;
  timeoutMs?: number;
  /** Share of the token budget the read step may use (default 0.5). */
  readShare?: number;
  /** Reasoning effort for the read step only (`jevx --fast` = "low"). Assess and edit keep the model's default. */
  readEffort?: "low" | "medium" | "high";
  /** Write changes for fits whose average reaches this (0.5–1, default 0.7 = STRONG only). */
  minFit?: number;
  /** Also write fits where the sources disagree (REVIEW_DISAGREE), if they reach `minFit`. */
  includeDisagree?: boolean;
  onEvent?: (e: PipelineEvent) => void;
}

export interface PipelineResult {
  ws: Workspace;
  opportunities: Opportunity[];
  spend: Spend;
  budgetHit: boolean;
  errors: string[];
}

const where = (o: { file: string; unit: { name: string; start: number } }) => `${o.file}:${o.unit.start} ${o.unit.name}`;
const unitId = (file: string, name: string, line: number) => `unit:${file}#${name}@${line}`;
const readLines = (root: string, file: string) => readFileSync(path.join(root, file), "utf8").split("\n");

function addSpend(s: Spend, r: AdaptiveResult<unknown>) {
  s.calls += r.calls;
  s.inputTokens += r.inputTokens;
  s.outputTokens += r.outputTokens;
  if (r.costUsd !== undefined) {
    s.costUsd = (s.costUsd ?? 0) + r.costUsd;
    s.costSource = r.costSource ?? s.costSource;
  }
}

const fallbackItem = (id: string, text: string): ContextItem => ({ id, kind: "unit", title: id, text, chars: text.length, hash: id });
/** .jevx/ holds backups, cache and debug output: never something the user should commit. */
export function selfIgnore(root: string) {
  try {
    const f = path.join(root, ".jevx", ".gitignore");
    mkdirSync(path.dirname(f), { recursive: true });
    if (!existsSync(f)) writeFileSync(f, "# created by jevx\n*\n");
  } catch {
    /* read-only checkout */
  }
}

/** What the AI answered for each read part, kept locally in .jevx/debug/ so a run can be explained. */
function debugRead(root: string, n: number, data: unknown) {
  debugWrite(root, `read-part-${n}.json`, data);
}
function debugWrite(root: string, name: string, data: unknown) {
  try {
    const dir = path.join(root, ".jevx", "debug");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, name), JSON.stringify(data, null, 2));
  } catch {
    /* debugging only */
  }
}
const numberedSlice = (lines: string[], a: number, b: number) => lines.slice(a - 1, b).map((l, i) => `${String(a + i).padStart(4)}| ${l}`).join("\n");

// Generators that write judgments as rules rank first; pure UI files last.
const GEN_RANK: Record<string, number> = { "text-match": 0, selector: 1, scorer: 1, "branch-map": 2, gate: 3, "outcome-set": 4 };
export function rankStatic<T extends { file: string; generators: { generator: string }[] }>(cands: T[]): T[] {
  const g = (c: T) => Math.min(9, ...c.generators.map((x) => GEN_RANK[x.generator] ?? 5));
  return [...cands].sort((a, b) => readPriority(a.file) - readPriority(b.file) || g(a) - g(b));
}

async function pool<T>(items: T[], n: number, fn: (x: T, i: number) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(n, items.length)) }, async () => {
      for (let i = next++; i < items.length; i = next++) await fn(items[i]!, i);
    })
  );
}

/** Apply search/replace edits to in-memory copies; every `find` must occur exactly once. */
export function applyEditsInMemory(read: (file: string) => string | undefined, edits: Edit[]): { files: Map<string, { before: string; after: string }> } | { error: string } {
  const files = new Map<string, { before: string; after: string }>();
  for (const e of edits) {
    const cur = files.get(e.file) ?? (() => {
      const t = read(e.file);
      return t === undefined ? undefined : { before: t, after: t };
    })();
    if (!cur) return { error: `${e.file} does not exist` };
    const at = cur.after.indexOf(e.find);
    if (at < 0) return { error: `in ${e.file}: the text to replace was not found` };
    if (cur.after.indexOf(e.find, at + 1) >= 0) return { error: `in ${e.file}: the text to replace occurs more than once` };
    cur.after = cur.after.slice(0, at) + e.replace + cur.after.slice(at + e.find.length);
    files.set(e.file, cur);
  }
  return { files };
}

export function patchOf(files: Map<string, { before: string; after: string }>): string {
  return [...files].map(([f, v]) => createTwoFilesPatch(`a/${f}`, `b/${f}`, v.before, v.after, "current", "with Jev", { context: 3 })).join("\n");
}

const SAFE_EDIT_PATH = (root: string, f: string) => {
  const abs = path.resolve(root, f);
  const rel = path.relative(root, abs);
  return !rel.startsWith("..") && !path.isAbsolute(rel) && !/(^|\/)(node_modules|\.jevx|\.git)\//.test(rel);
};

export async function runPipeline(opts: PipelineOptions): Promise<PipelineResult> {
  const ws = await workspace(opts.root, true);
  const root = ws.root;
  selfIgnore(root);
  try {
    rmSync(path.join(root, ".jevx", "debug"), { recursive: true, force: true });
  } catch {
    /* fine */
  }
  const budget = opts.budgetTokens ?? DEFAULT_RUN_BUDGET;
  const spend: Spend = { calls: 0, inputTokens: 0, outputTokens: 0 };
  const errors: string[] = [];
  let budgetHit = false;
  const overBudget = () => {
    if (spend.inputTokens + spend.outputTokens < budget) return false;
    if (!budgetHit) opts.onEvent?.({ type: "budget", spent: spend.inputTokens + spend.outputTokens });
    budgetHit = true;
    return true;
  };
  const common = { transport: opts.transport, timeoutMs: opts.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS, retries: 2 };
  opts.onEvent?.({ type: "indexed", files: ws.files.length, candidates: ws.analysis.candidates.length, existingJev: ws.jev.stats.decisionSites });

  // 2. read — the AI reads the source itself
  const maxInspect = opts.maxInspect ?? DEFAULT_MAX_INSPECT;
  const existing = ws.jev.sites.filter((s) => s.role === "decision").map((s) => `${s.file}:${s.unit.start} ${s.unit.name}`);
  const plan = planRead(root, ws.files, Math.round(budget * (opts.readShare ?? 0.5) * CHARS_PER_TOKEN));
  opts.onEvent?.({ type: "reading", files: plan.read.length, unread: plan.unread.length, parts: plan.parts.length, estTokens: plan.estTokens, coverage: plan.coverage });
  const tree = [...plan.read, ...plan.unread];
  const spots: ReadSpot[] = [];
  let partsOk = 0;
  let partsDone = 0;
  const partErrors: string[] = [];
  await pool(plan.parts, opts.concurrency ?? 3, async (part, i) => {
    if (overBudget()) return;
    const inPart = new Map(part.map((p) => [p.file, plan.lines.get(p.file) ?? p.end]));
    let raw: string | undefined;
    const r = await runAdaptive({
      anchor: { file: "", unit: { name: `read-${i + 1}`, start: 0 } },
      fallback: fallbackItem(`read-${i + 1}`, ""),
      mode: "local",
      ...common,
      ...(opts.readEffort ? { effort: opts.readEffort } : {}),
      build: () => buildReadPrompt(tree, part, { n: i + 1, of: plan.parts.length }, existing),
      parse: (t) => {
        raw = t;
        return parseRead(t, inPart);
      }
    });
    addSpend(spend, r);
    partsDone++;
    let named = 0;
    let kept: ReadSpot[] = [];
    if (r.analysis) {
      partsOk++;
      named = r.analysis.named;
      // a spot must lie inside the lines this part actually showed
      kept = r.analysis.spots.filter((sp) => part.some((p) => p.file === sp.file && sp.start_line >= p.start && sp.start_line <= p.end));
      spots.push(...kept);
    } else partErrors.push(r.callError?.message ?? r.error ?? "no answer");
    debugRead(root, i + 1, { files: part.map((p) => `${p.file}:${p.start}-${p.end}`), error: r.callError?.message ?? r.error, raw, kept });
    opts.onEvent?.({ type: "read", done: partsDone, total: plan.parts.length, named, kept: kept.length, spots: spots.length, ...(r.analysis ? {} : { error: r.callError?.message ?? r.error ?? "no answer" }) });
  });
  if (plan.unread.length) errors.push(`token budget: read ${plan.read.length} of ${plan.read.length + plan.unread.length} files (${Math.round(plan.coverage * 100)}% of the code) — raise --budget to read the rest`);
  if (partErrors.length && partsOk) errors.push(`${partErrors.length} of ${plan.parts.length} part(s) could not be read (${partErrors[0]})`);

  const targets: Omit<Opportunity, "status">[] = [];
  const seen: { file: string; start: number; end: number }[] = [];
  const push = (t: Omit<Opportunity, "status">) => {
    if (seen.some((x) => x.file === t.file && t.unit.start <= x.end && t.unit.end >= x.start)) return;
    if (ws.jev.sites.some((j) => j.file === t.file && j.unit.start <= t.unit.start && j.unit.end >= t.unit.start)) return;
    seen.push({ file: t.file, start: t.unit.start, end: t.unit.end });
    targets.push(t);
  };
  if (partsOk) {
    spots.sort((a, b) => b.confidence - a.confidence);
    for (const sp of spots) {
      if (targets.length >= maxInspect) break;
      if (sp.confidence < MIN_SPOT_CONFIDENCE) continue;
      const max = plan.lines.get(sp.file) ?? sp.end_line;
      const start = sp.start_line;
      const end = Math.min(max, sp.end_line, start + 80);
      push({ id: proposalId(sp.file, start), file: sp.file, unit: { name: sp.function, start, end }, origin: "ai", hint: `${sp.decision} — ${sp.why}`.slice(0, 500), note: sp.why });
    }
    opts.onEvent?.({ type: "surveyed", inspect: targets.length, missed: 0 });
  } else {
    errors.push(`the AI could not read the code (${partErrors[0] ?? "budget"}); checking the static candidates instead`);
    for (const c of rankStatic(ws.analysis.candidates).slice(0, maxInspect)) push({ id: proposalId(c.file, c.unit.start), file: c.file, unit: { name: c.unit.name, start: c.unit.start, end: c.unit.end }, origin: "static" });
    opts.onEvent?.({ type: "surveyed", inspect: targets.length, missed: 0, fallback: true });
  }

  // 3–5. assess → score → edit
  const out: Opportunity[] = [];
  let started = 0;
  await pool(targets, opts.concurrency ?? 3, async (t) => {
    opts.onEvent?.({ type: "assessing", done: started++, total: targets.length, where: where(t) });
    if (overBudget()) {
      out.push({ ...t, status: "failed", note: "skipped: token budget reached" });
      return;
    }
    const uid = unitId(t.file, t.unit.name, t.unit.start);
    const a = await runAdaptive({
      anchor: { file: t.file, unit: { name: t.unit.name, start: t.unit.start } },
      context: ws.index,
      fallback: (t.origin === "static" ? ws.index.resolve(uid) : undefined) ?? fallbackItem(`${t.file}:${t.unit.start}-${t.unit.end}`, numberedSlice(readLines(root, t.file), Math.max(1, t.unit.start - 3), t.unit.end + 3)),
      mode: "adaptive",
      maxRounds: 3,
      ...common,
      build: (turn) => buildAssessPrompt(`${t.file}:${t.unit.start}-${t.unit.end} ${t.unit.name}`, turn, t.hint),
      parse: parseAssessment
    });
    addSpend(spend, a);
    debugWrite(root, `assess-${t.file.replace(/[^\w.-]+/g, "_")}-${t.unit.start}.json`, { where: where(t), hint: t.hint, rounds: a.rounds, context: a.items.map((i) => i.id), error: a.callError?.message ?? a.error, assessment: a.analysis });
    if (!a.analysis) {
      const o: Opportunity = { ...t, status: "failed", note: a.callError?.message ?? a.error ?? "no answer" };
      out.push(o);
      opts.onEvent?.({ type: "assessed", opportunity: o });
      return;
    }
    const as = a.analysis;
    if (!as.is_opportunity || as.primitive === "none") {
      const o: Opportunity = { ...t, status: "not_opportunity", assessment: as, note: as.why };
      out.push(o);
      opts.onEvent?.({ type: "assessed", opportunity: o });
      return;
    }
    const lines = readLines(root, t.file);
    const code = lines.slice(t.unit.start - 1, t.unit.end).join("\n");
    const proposal: Proposal = { decision: as.decision, primitive: as.primitive, question: as.question, outcomes: as.outcomes, state: as.state, deterministic_remainder: as.deterministic_remainder, why: as.why };
    const pat = patternScore(as.features);
    const learned = learnedScore(as.pattern);
    const jev = await askJev(root, t.file, code, proposal);
    const card = combine({ patterns: blendPatterns(pat.score, learned.score), ai: as.ai_score, typesafe: jev.ok ? typesafeScore(jev.answers) : undefined });
    const record: ProposalRecord = {
      id: t.id,
      file: t.file,
      startLine: t.unit.start,
      endLine: t.unit.end,
      proposal,
      features: as.features,
      ai: { score: as.ai_score, reasons: as.why },
      patterns: pat.matches,
      ...(jev.ok ? { jev: jev.answers } : { jevError: jev.error }),
      scorecard: card,
      at: new Date().toISOString()
    };
    const status: OpportunityStatus = card.verdict === "STRONG_FIT" ? "strong" : card.verdict === "POSSIBLE_FIT" ? "possible" : card.verdict === "REVIEW_DISAGREE" ? "review" : "weak";
    const o: Opportunity = { ...t, status, assessment: as, record };

    if (eligible({ status, assessment: as, record }, opts.minFit, opts.includeDisagree) && !overBudget()) {
      opts.onEvent?.({ type: "editing", where: where(t) });
      const files: EditInputFile[] = [{ file: t.file, role: "decision", text: lines.join("\n") }];
      const callers = ws.index.initial({ file: t.file, unit: { name: t.unit.name, start: t.unit.start } }).catalog.filter((r) => r.kind === "caller" && r.file && r.file !== t.file).slice(0, 6);
      for (const f of [...new Set(callers.map((c) => c.file!))]) files.push({ file: f, role: "caller", text: readFileSync(path.join(root, f), "utf8") });
      let feedback = "";
      for (let attempt = 0; attempt < 2; attempt++) {
        const e = await runAdaptive({
          anchor: { file: t.file, unit: { name: t.unit.name, start: t.unit.start } },
          fallback: fallbackItem("edit", ""),
          mode: "local",
          ...common,
          build: () => {
            const p = buildEditPrompt(proposal, where(t), files);
            return feedback ? { ...p, prompt: `${p.prompt}\n\nYOUR PREVIOUS EDITS COULD NOT BE APPLIED: ${feedback}\nCopy \`find\` exactly from the file text above.` } : p;
          },
          parse: parseEdits
        });
        addSpend(spend, e);
        if (!e.analysis) {
          o.status = "edit_failed";
          o.note = e.callError?.message ?? e.error ?? "no edits";
          break;
        }
        const bad = e.analysis.edits.find((x) => !SAFE_EDIT_PATH(root, x.file));
        const applied = bad ? { error: `${bad.file} is outside the project` } : applyEditsInMemory((f) => { try { return readFileSync(path.join(root, f), "utf8"); } catch { return undefined; } }, e.analysis.edits);
        if ("error" in applied) {
          feedback = applied.error;
          o.status = "edit_failed";
          o.note = applied.error;
          continue;
        }
        o.status = status;
        o.note = undefined;
        o.edits = e.analysis.edits;
        o.summary = e.analysis.summary;
        record.patch = patchOf(applied.files);
        break;
      }
    }
    saveProposal(root, record);
    out.push(o);
    opts.onEvent?.({ type: "assessed", opportunity: o });
  });

  const order: OpportunityStatus[] = ["strong", "possible", "review", "edit_failed", "weak", "not_opportunity", "failed"];
  out.sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status) || (b.record?.scorecard.average ?? 0) - (a.record?.scorecard.average ?? 0));
  return { ws, opportunities: out, spend, budgetHit, errors };
}
