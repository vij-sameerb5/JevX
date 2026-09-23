// Project-level evaluation against HUMAN LABELS, where any exist (optional spot-checks since M5b;
// the M5b boundary dataset lives in <dataset>/boundary and has no ground truth). Predictions = what JevX said
// automatically (deterministic triage, or the TypeSafe policy). Splits are never mixed:
// every number is reported per split (and per project inside it).
import type { Label } from "@jevx/core";
import type { DatasetEntry, ProjectRecord, Split } from "./schema.js";
import { SPLITS } from "./schema.js";
import { effectiveSplit } from "./splits.js";
import type { Dataset } from "./store.js";

const POS = (l: Label | undefined) => l === "STRONG_JEV" || l === "POSSIBLE_JEV";

export interface Metrics {
  projects: number;
  entries: number;
  labelled: number;
  /** Labelled entries JevX produced an automatic label for. */
  predicted: number;
  /** Labelled entries still unclassified (no triage verdict, not validated). */
  unclassified: number;
  tp: number;
  fp: number;
  tn: number;
  fn: number;
  precision?: number;
  recall?: number;
  fpr?: number;
  /** Exact 3-way label agreement among predicted. */
  exactAgreement?: number;
  /** Of candidates triage filtered out, how many humans agreed were NOT_JEV. */
  triage: { filtered: number; agreed: number; overturned: number };
  /** Candidate coverage: human-positive decisions JevX proposed vs ones humans had to add. */
  coverage: { proposedPositives: number; missedPositives: number; recall?: number };
  labels: Record<string, number>;
  categories: Record<string, number>;
  hardNegatives: Record<string, number>;
  needsRecheck: number;
  /**
   * INFORMATIONAL ONLY: how often Gemini's debug hypothesis matched the human label (binary
   * STRONG+POSSIBLE vs NOT). Never part of precision/recall; used to judge whether --gemini helps.
   */
  gemini: AnalystMetrics;
  /** Same as gemini, for OpenRouter evidence. INFORMATIONAL ONLY. */
  openrouter: AnalystMetrics;
  /**
   * INFORMATIONAL side-by-side on labelled entries: Human vs TypeSafe (policy auto label) vs
   * Gemini hypothesis vs OpenRouter hypothesis. Nothing here is a metric or a tuning target.
   */
  comparison: {
    /** Entries where both analysts gave a usable hypothesis. */
    bothAnalysts: number;
    /** …and the two hypotheses agreed (binary). */
    analystsAgreed: number;
    /** TypeSafe/policy label (binary) agreed with the human — shown next to the analysts. */
    typesafeAgreed: number;
    typesafePredicted: number;
  };
}

export interface AnalystMetrics {
  withEvidence: number;
  insufficient: number;
  hypotheses: number;
  agreed: number;
  agreement?: number;
}

const emptyAnalyst = (): AnalystMetrics => ({ withEvidence: 0, insufficient: 0, hypotheses: 0, agreed: 0 });

const ratio = (a: number, b: number) => (b > 0 ? a / b : undefined);

export function computeMetrics(entries: DatasetEntry[], projects = 1): Metrics {
  const m: Metrics = {
    projects,
    entries: 0,
    labelled: 0,
    predicted: 0,
    unclassified: 0,
    tp: 0,
    fp: 0,
    tn: 0,
    fn: 0,
    triage: { filtered: 0, agreed: 0, overturned: 0 },
    coverage: { proposedPositives: 0, missedPositives: 0 },
    labels: {},
    categories: {},
    hardNegatives: {},
    needsRecheck: 0,
    gemini: emptyAnalyst(),
    openrouter: emptyAnalyst(),
    comparison: { bothAnalysts: 0, analystsAgreed: 0, typesafeAgreed: 0, typesafePredicted: 0 }
  };
  let exact = 0;
  for (const e of entries) {
    if (e.status !== "active") continue;
    m.entries++;
    const h = e.human;
    if (!h) continue;
    if (e.needsRecheck) {
      m.needsRecheck++;
      continue; // a label on old code is not ground truth for the current code
    }
    m.labelled++;
    m.labels[h.label] = (m.labels[h.label] ?? 0) + 1;
    if (h.category) m.categories[h.category] = (m.categories[h.category] ?? 0) + 1;
    if (h.hardNegativeReason) m.hardNegatives[h.hardNegativeReason] = (m.hardNegatives[h.hardNegativeReason] ?? 0) + 1;

    // Code analysts: only analyses the model itself called sufficient count toward (informational) agreement.
    const hyps: Partial<Record<"gemini" | "openrouter", boolean>> = {};
    for (const slot of ["gemini", "openrouter"] as const) {
      const ev = e[slot];
      if (!ev) continue;
      const am = m[slot];
      am.withEvidence++;
      const usable = ev.facts.usable !== false;
      if (!usable) am.insufficient++;
      const hyp = ev.facts.hypothesis;
      if (hyp && usable) {
        am.hypotheses++;
        hyps[slot] = POS(hyp);
        if (POS(hyp) === POS(h.label)) am.agreed++;
      }
    }
    if (hyps.gemini !== undefined && hyps.openrouter !== undefined) {
      m.comparison.bothAnalysts++;
      if (hyps.gemini === hyps.openrouter) m.comparison.analystsAgreed++;
    }
    if (e.auto.source === "typesafe" && e.auto.label) {
      m.comparison.typesafePredicted++;
      if (POS(e.auto.label) === POS(h.label)) m.comparison.typesafeAgreed++;
    }

    if (e.origin === "missed") {
      if (POS(h.label)) m.coverage.missedPositives++;
      continue;
    }
    if (POS(h.label)) m.coverage.proposedPositives++;

    const p = e.auto.label;
    if (e.auto.source === "triage") {
      m.triage.filtered++;
      if (h.label === "NOT_JEV") m.triage.agreed++;
      else m.triage.overturned++;
    }
    if (!p) {
      m.unclassified++;
      continue;
    }
    m.predicted++;
    if (p === h.label) exact++;
    if (POS(p) && POS(h.label)) m.tp++;
    else if (POS(p)) m.fp++;
    else if (POS(h.label)) m.fn++;
    else m.tn++;
  }
  m.precision = ratio(m.tp, m.tp + m.fp);
  m.recall = ratio(m.tp, m.tp + m.fn);
  m.fpr = ratio(m.fp, m.fp + m.tn);
  m.exactAgreement = ratio(exact, m.predicted);
  m.gemini.agreement = ratio(m.gemini.agreed, m.gemini.hypotheses);
  m.openrouter.agreement = ratio(m.openrouter.agreed, m.openrouter.hypotheses);
  m.coverage.recall = ratio(m.coverage.proposedPositives, m.coverage.proposedPositives + m.coverage.missedPositives);
  return m;
}

export interface EvalReport {
  rotateSeed?: string;
  splits: Record<Split, { total: Metrics; projects: { slug: string; visibility: string; metrics: Metrics }[] }>;
}

export function evaluate(ds: Dataset, opts: { rotateSeed?: string } = {}): EvalReport {
  const cfg = ds.config();
  const bySplit = new Map<Split, { p: ProjectRecord; entries: DatasetEntry[] }[]>();
  for (const p of ds.projects()) {
    const s = effectiveSplit(p, cfg, opts.rotateSeed);
    bySplit.set(s, [...(bySplit.get(s) ?? []), { p, entries: ds.entries(p.slug) }]);
  }
  const splits = {} as EvalReport["splits"];
  for (const s of SPLITS) {
    const list = bySplit.get(s) ?? [];
    splits[s] = {
      total: computeMetrics(
        list.flatMap((x) => x.entries),
        list.length
      ),
      projects: list.map((x) => ({ slug: x.p.slug, visibility: x.p.visibility, metrics: computeMetrics(x.entries) }))
    };
  }
  return { rotateSeed: opts.rotateSeed, splits };
}
