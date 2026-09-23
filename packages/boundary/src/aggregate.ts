// Layer E, step 1 — DETERMINISTIC aggregation of the stored C (why Jev here) and D (why
// deterministic there) records. No model, no API, no network.
//
// Everything in here is reproducible from dataset/boundary/** alone: counts of records, the
// levels and assessments those records already carry, and the record ids behind every number.
// There are NO weights, NO score and NO threshold that decides whether Jev fits — "strength" and
// "confidence" describe how much evidence exists (how many records, how many projects, whether
// anything contradicts it), never how good Jev would be anywhere.
//
// What the layers mean here (docs/CURRENT-ARCHITECTURE.md §8):
//   C = a real Jev call a developer wrote + an analyst's inference about it. Developer choice,
//       not proof that Jev was right.
//   D = decision-like code next to it that stayed deterministic + an analyst's inference.
//       A different implementation boundary, not proof that Jev would be wrong there.
// So a "pattern" below is: what the stored records happen to show, with everything that
// disagrees listed next to it.
import {
  BOUNDARY_FEATURES,
  FEATURE_LEVELS,
  NOT_REASONS,
  WHY_JEV_HYPOTHESES,
  type AnalysisRecord,
  type Assessment,
  type BoundaryFeature,
  type Confidence,
  type ContrastRecord,
  type FeatureLevel
} from "./schema.js";

/** The kinds of evidence Layer E groups by. The first eight are the analysed features. */
export const PATTERN_CATEGORIES = [
  ...BOUNDARY_FEATURES,
  "open_vs_closed_outcomes",
  "exact_rules_vs_semantic_interpretation",
  "cheap_semantic_triage",
  "not_a_reason"
] as const;
export type PatternCategory = (typeof PATTERN_CATEGORIES)[number];

/** Which category each why-Jev hypothesis is evidence for. */
const HYPOTHESIS_CATEGORY: Record<string, PatternCategory> = {
  semantic_interpretation: "semantic_ambiguity",
  ambiguous_natural_language_or_context: "natural_language_understanding",
  multiple_competing_outcomes: "open_vs_closed_outcomes",
  judgment_not_computation: "judgment_required",
  policy_interpretation: "risk_or_policy_component",
  risk_assessment: "risk_or_policy_component",
  classification_requiring_context: "context_dependence",
  hard_to_encode_as_rules: "deterministic_expressibility",
  soft_or_changing_rules: "rule_stability",
  uncertain_inputs: "context_dependence",
  context_dependent_behavior: "context_dependence",
  expensive_or_fragile_deterministic_rules: "cheap_semantic_triage"
};

export type PatternSide = "jev" | "deterministic" | "separator";
export type GroupDirection = "separates" | "contested" | "no_separation" | "jev_side_only";
export type Strength = "single_example" | "recurring_in_one_project" | "cross_project";

/** Where a record id points, so the write-up can name a file without re-reading the dataset. */
export interface EvidenceRef {
  id: string;
  layer: "C" | "D";
  project: string;
  where: string;
  visibility: "public" | "private";
}

export interface SideCounts {
  /** level or assessment → record ids carrying it. */
  byValue: Record<string, string[]>;
  ids: string[];
  projects: string[];
  /** The most frequent value, and how many records carry it. */
  top?: { value: string; count: number };
  /** True when every record on this side carries the same value (so it cannot discriminate). */
  uniform: boolean;
}

/** One block of counted evidence. The optional model synthesis may reword it, never change it. */
export interface EvidenceGroup {
  id: string;
  category: PatternCategory;
  side: PatternSide;
  /** Exactly what was counted, in one sentence. */
  basis: string;
  /** What the counts show, in one sentence, written from the numbers alone. */
  statement: string;
  jev: SideCounts;
  deterministic: SideCounts;
  /** The records that carry the value the statement is about — not simply every record counted. */
  supportingIds: string[];
  contrastingIds: string[];
  direction: GroupDirection;
  /** Records that disagree with the statement, each with why. */
  counterExamples: { id: string; why: string }[];
  projects: string[];
  strength: Strength;
  confidence: Confidence;
  contested: boolean;
  /** What the records say they could not establish (public projects only). */
  unknowns: string[];
  features: BoundaryFeature[];
  notes: string[];
}

export interface RejectedExplanation {
  statement: string;
  why: string;
  ids: string[];
}

export interface Aggregation {
  source: {
    projects: string[];
    analyses: number;
    contrasts: number;
    usableAnalyses: number;
    /** Contrasts the analyst judged to be real decisions — the only ones that can contrast. */
    realDecisionContrasts: number;
    privateProjects: string[];
  };
  index: Record<string, EvidenceRef>;
  groups: EvidenceGroup[];
  rejected: RejectedExplanation[];
  /** Facts about the evidence itself (gaps, uniformity, excluded records). Not patterns. */
  notes: string[];
  unknowns: string[];
}

// ─── ids and helpers ───

export const analysisId = (a: AnalysisRecord) => `C:${a.project}:${a.siteId}`;
export const contrastId = (c: ContrastRecord) => `D:${c.project}:${c.siteId}:${c.contrast.id.slice(0, 8)}`;

const uniq = (xs: string[]) => [...new Set(xs)].filter(Boolean);
const sortedProjects = (xs: string[]) => uniq(xs).sort();

function counts(rows: { id: string; project: string; value: string }[], skip: string[] = ["unknown"]): SideCounts {
  const kept = rows.filter((r) => r.value && !skip.includes(r.value));
  const byValue: Record<string, string[]> = {};
  for (const r of kept) (byValue[r.value] ??= []).push(r.id);
  const entries = Object.entries(byValue).sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  return {
    byValue,
    ids: kept.map((r) => r.id),
    projects: sortedProjects(kept.map((r) => r.project)),
    ...(entries[0] ? { top: { value: entries[0][0], count: entries[0][1].length } } : {}),
    uniform: entries.length === 1 && kept.length > 1
  };
}

const show = (c: SideCounts) =>
  Object.entries(c.byValue)
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([v, ids]) => `${v} ${ids.length}`)
    .join(", ") || "none";

/**
 * How much evidence there is — NOT how right the pattern is.
 *   cross_project        ≥ 2 projects
 *   recurring_in_one…    ≥ 2 records, 1 project
 *   single_example       1 record
 */
function strengthOf(records: number, projects: number): Strength {
  if (projects >= 2) return "cross_project";
  return records >= 2 ? "recurring_in_one_project" : "single_example";
}

/**
 * How far the evidence reaches — never how right the pattern is. A stated rule, not a formula:
 *   start   ≥ 3 projects → high, ≥ 2 → medium, else low
 *   then    one step down if any record contradicts it
 *   and     low whenever one of the two sides was never measured
 */
function confidenceOf(projects: number, contested: boolean, bothSides: boolean): Confidence {
  if (!bothSides) return "low";
  const base: Confidence = projects >= 3 ? "high" : projects >= 2 ? "medium" : "low";
  if (!contested) return base;
  return base === "high" ? "medium" : "low";
}

const unknownsOf = (rows: AnalysisRecord[], limit = 5) => uniq(rows.flatMap((a) => a.analysis?.why_jev.unknown ?? [])).slice(0, limit);

// ─── the aggregation ───

export function aggregate(analyses: AnalysisRecord[], contrasts: ContrastRecord[]): Aggregation {
  const index: Record<string, EvidenceRef> = {};
  for (const a of analyses)
    index[analysisId(a)] = { id: analysisId(a), layer: "C", project: a.project, where: `${a.site.file}:${a.site.unit.start} ${a.site.unit.name}`, visibility: a.visibility };
  for (const c of contrasts)
    index[contrastId(c)] = { id: contrastId(c), layer: "D", project: c.project, where: `${c.contrast.file}:${c.contrast.unit.start} ${c.contrast.unit.name}`, visibility: c.visibility };

  // Only usable analyses carry evidence; only contrasts the analyst judged to BE decisions can
  // contrast with a decision. "Not a decision" says the contrast finder picked plumbing.
  const jevRows = analyses.filter((a) => a.usable);
  const detRows = contrasts.filter((c) => c.usable && c.facts.is_a_real_decision);
  const notDecisions = contrasts.filter((c) => !c.facts.is_a_real_decision);

  const groups: EvidenceGroup[] = [];
  const notes: string[] = [];

  // 1. Features — the only evidence measured on BOTH sides, so the only evidence that can separate.
  for (const f of BOUNDARY_FEATURES) {
    const jev = counts(jevRows.map((a) => ({ id: analysisId(a), project: a.project, value: a.facts.features[f] })));
    const det = counts(detRows.map((c) => ({ id: contrastId(c), project: c.project, value: c.facts.features[f] })));
    if (!jev.ids.length) continue;
    const bothSides = det.ids.length > 0;
    const jevTop = jev.top?.value;
    const detTop = det.top?.value;
    const counterExamples: { id: string; why: string }[] = [];
    let direction: GroupDirection = "jev_side_only";
    if (bothSides && jevTop && detTop) {
      direction = jevTop === detTop ? "no_separation" : "separates";
      if (jevTop !== detTop) {
        for (const id of det.byValue[jevTop] ?? []) counterExamples.push({ id, why: `deterministic code with ${f} = ${jevTop}, the level the Jev sites show` });
        for (const id of jev.byValue[detTop] ?? []) counterExamples.push({ id, why: `Jev site with ${f} = ${detTop}, the level the deterministic code shows` });
        if (counterExamples.length) direction = "contested";
      }
    }
    const projects = sortedProjects([...jev.projects, ...det.projects]);
    const statement = !bothSides
      ? `Every analyzed Jev site shows ${f} = ${jevTop} (${jev.top?.count}/${jev.ids.length}); no deterministic decision was analyzed for this feature, so nothing is separated yet.`
      : direction === "no_separation"
        ? `${f} is ${jevTop} on both sides (Jev ${show(jev)}; deterministic ${show(det)}), so it does not separate them in this data.`
        : `Jev sites show ${f} = ${jevTop} (${show(jev)}) where the deterministic decisions beside them show ${detTop} (${show(det)}).`;
    const g: EvidenceGroup = {
      id: `feature:${f}`,
      category: f,
      side: !bothSides ? "jev" : direction === "no_separation" ? "jev" : "separator",
      basis: `Levels recorded for ${f} on ${jev.ids.length} Jev usage record(s) and ${det.ids.length} contrast record(s) the analyst judged to be real decisions.`,
      statement,
      jev,
      deterministic: det,
      supportingIds: jevTop ? (jev.byValue[jevTop] ?? []) : [],
      contrastingIds: detTop ? (det.byValue[detTop] ?? []) : [],
      direction,
      counterExamples,
      projects,
      strength: strengthOf(jev.ids.length + det.ids.length, projects.length),
      confidence: confidenceOf(projects.length, counterExamples.length > 0, bothSides),
      contested: counterExamples.length > 0,
      unknowns: unknownsOf(jevRows.filter((a) => jev.ids.includes(analysisId(a)))),
      features: [f],
      notes: [
        ...(jev.uniform ? [`Uniform on the Jev side: all ${jev.ids.length} records carry ${jevTop}, so this cannot tell Jev sites apart from each other.`] : []),
        ...(bothSides ? [] : ["Never measured on deterministic code, so it is a description of Jev sites, not a boundary."])
      ]
    };
    groups.push(g);
  }

  // 2. Why-Jev hypotheses — recorded on Jev sites ONLY. They describe; they cannot separate.
  for (const h of WHY_JEV_HYPOTHESES) {
    const rows = jevRows.filter((a) => a.facts.why_jev_hypotheses?.[h]);
    if (!rows.length) continue;
    const jev = counts(rows.map((a) => ({ id: analysisId(a), project: a.project, value: a.facts.why_jev_hypotheses![h]! })), []);
    const supported = jev.byValue.supported ?? [];
    const contradicted = jev.byValue.contradicted ?? [];
    if (!supported.length) continue;
    const projects = sortedProjects(rows.filter((a) => supported.includes(analysisId(a))).map((a) => a.project));
    groups.push({
      id: `why_jev:${h}`,
      category: HYPOTHESIS_CATEGORY[h] ?? "judgment_required",
      side: "jev",
      basis: `The analyst's assessment of the hypothesis "${h}" at ${rows.length} Jev usage record(s). Assessed on Jev sites only — never on the deterministic side.`,
      statement: `"${h}" is supported at ${supported.length} of ${rows.length} analyzed Jev sites${contradicted.length ? `, and contradicted at ${contradicted.length}` : ""}.`,
      jev,
      deterministic: counts([]),
      supportingIds: supported,
      contrastingIds: [],
      direction: "jev_side_only",
      counterExamples: contradicted.map((id) => ({ id, why: `the analyst found "${h}" contradicted at this Jev site` })),
      projects,
      strength: strengthOf(supported.length, projects.length),
      confidence: confidenceOf(projects.length, contradicted.length > 0, false),
      contested: contradicted.length > 0,
      unknowns: unknownsOf(rows.filter((a) => supported.includes(analysisId(a)))),
      features: [],
      notes: [
        "The same hypothesis was never assessed on the deterministic contrasts, so a high count does not show it separates Jev code from exact code.",
        ...(supported.length === rows.length && rows.length >= 5 ? [`Supported at every one of the ${rows.length} sites; a judgment that never varies may reflect the analyst's prior as much as the code.`] : [])
      ]
    });
  }

  // 3. Nature of the decision — semantic judgment vs exact rule, measured on both sides.
  {
    const jev = counts(jevRows.map((a) => ({ id: analysisId(a), project: a.project, value: a.facts.nature })), []);
    const det = counts(detRows.map((c) => ({ id: contrastId(c), project: c.project, value: c.facts.nature })), []);
    const sharesTraits = detRows.filter((c) => c.facts.shares_jev_site_traits === "yes" || c.facts.shares_jev_site_traits === "partly");
    if (jev.ids.length) {
      const counterExamples = [
        ...(det.byValue.semantic_judgment ?? []).map((id) => ({ id, why: "deterministic code the analyst still called a semantic judgment" })),
        ...(jev.byValue.exact_rule ?? []).map((id) => ({ id, why: "a Jev site the analyst called an exact rule" })),
        ...sharesTraits.map((c) => ({ id: contrastId(c), why: `deterministic code the analyst says shares the Jev site's traits (${c.facts.shares_jev_site_traits})` }))
      ];
      const projects = sortedProjects([...jev.projects, ...det.projects]);
      const unique = [...new Map(counterExamples.map((c) => [c.id, c])).values()];
      groups.push({
        id: "nature:jev_vs_deterministic",
        category: "exact_rules_vs_semantic_interpretation",
        side: "separator",
        basis: `The decision nature recorded for ${jev.ids.length} Jev usage record(s) and ${det.ids.length} real-decision contrast record(s), plus whether each contrast was said to share the Jev site's traits.`,
        statement: `Jev sites are recorded as ${show(jev)}; the deterministic decisions beside them as ${show(det)}.`,
        jev,
        deterministic: det,
        supportingIds: jev.byValue.semantic_judgment ?? jev.ids,
        contrastingIds: det.byValue.exact_rule ?? det.ids,
        direction: det.ids.length ? (unique.length ? "contested" : "separates") : "jev_side_only",
        counterExamples: unique,
        projects,
        strength: strengthOf(jev.ids.length + det.ids.length, projects.length),
        confidence: confidenceOf(projects.length, unique.length > 0, det.ids.length > 0),
        contested: unique.length > 0,
        unknowns: unknownsOf(jevRows),
        features: [],
        notes: sharesTraits.length ? [`${sharesTraits.length} contrast(s) were judged to share the Jev site's traits — deterministic code that looks like a Jev candidate.`] : []
      });
    }
  }

  // 4. Not-reasons → rejected explanations. Never patterns: these are what the data does NOT support.
  const rejected: RejectedExplanation[] = [];
  for (const n of NOT_REASONS) {
    const rows = jevRows.filter((a) => a.facts.not_reasons?.[n]);
    if (!rows.length) continue;
    const by = (v: Assessment) => rows.filter((a) => a.facts.not_reasons![n] === v).map(analysisId);
    const contra = by("contradicted");
    const supp = by("supported");
    if (contra.length <= supp.length) continue;
    rejected.push({
      statement: `Jev is used because the code is "${n.replace(/_/g, " ")}".`,
      why: `Contradicted at ${contra.length} of ${rows.length} analyzed Jev sites${supp.length ? `, supported at ${supp.length}` : " and supported at none"}.`,
      ids: contra
    });
  }

  // 5. Notes about the evidence itself.
  if (notDecisions.length)
    notes.push(
      `${notDecisions.length} of ${contrasts.length} contrast(s) were judged not to be decisions at all (plumbing, parsing, formatting). They are excluded from the deterministic side, so most Jev sites have fewer real comparisons than contrasts were selected.`
    );
  const priv = sortedProjects([...analyses, ...contrasts].filter((r) => r.visibility === "private").map((r) => r.project));
  if (priv.length) notes.push(`Private project(s) ${priv.join(", ")} contribute levels and assessments only — their free text stays in the local cache, so no wording from them appears here.`);
  const noContrast = jevRows.filter((a) => !detRows.some((c) => c.project === a.project && c.siteId === a.siteId));
  if (noContrast.length) notes.push(`${noContrast.length} of ${jevRows.length} analyzed Jev site(s) have no real-decision contrast at all, so for those the deterministic side is unmeasured.`);
  const unusable = analyses.length - jevRows.length;
  if (unusable) notes.push(`${unusable} analysis record(s) were marked unusable by the parser and are excluded.`);
  // One mis-selected contrast can contest half the groups at once, so name it rather than letting
  // it quietly lower every confidence.
  const repeats: Record<string, number> = {};
  for (const g of groups) for (const c of g.counterExamples) repeats[c.id] = (repeats[c.id] ?? 0) + 1;
  for (const [id, times] of Object.entries(repeats).filter(([, t]) => t >= 3).sort((a, b) => b[1] - a[1]))
    notes.push(
      `\`${id}\` (${index[id]?.where ?? "unknown location"}) contradicts ${times} of the ${groups.length} groups on its own: check whether it is a mis-selected contrast, a mislabelled level, or a real exception before trusting the lowered confidence.`
    );

  return {
    source: {
      projects: sortedProjects([...analyses, ...contrasts].map((r) => r.project)),
      analyses: analyses.length,
      contrasts: contrasts.length,
      usableAnalyses: jevRows.length,
      realDecisionContrasts: detRows.length,
      privateProjects: priv
    },
    index,
    groups,
    rejected,
    notes,
    unknowns: uniq(jevRows.flatMap((a) => a.analysis?.why_jev.unknown ?? [])).slice(0, 20)
  };
}

/** Feature levels in the order used for display only — never compared as numbers. */
export const LEVEL_ORDER: readonly FeatureLevel[] = FEATURE_LEVELS;
