// M5b decision-boundary dataset: record types for layers B–E.
// See docs/CURRENT-ARCHITECTURE.md §8. The layers are stored apart and never mixed:
//
//   B  observed Jev usage        (fact about developer choice — NOT ground truth)   usages.jsonl
//   C  AI analysis of a usage    (model inference: "why Jev here?")                  analyses.jsonl
//   D  contrasting decisions     (selection = fact; explanation = model inference)   contrasts.jsonl
//   E  derived boundary patterns (hypotheses across B–D)                             patterns.jsonl
//
// Every model-written statement is split into OBSERVED (what the code does, with a location),
// INFERRED (the model's interpretation) and UNKNOWN (what the repository cannot tell us).
// Features are LEVELS ONLY. There are no weights and no score anywhere in this schema: which
// features separate Jev from deterministic code is what the dataset is for.
import type { JevSite, JevUsageReport } from "@jevx/core";

export const BOUNDARY_SCHEMA_VERSION = 1;

/** Candidate characteristics to INVESTIGATE (hypotheses, not rules). */
export const BOUNDARY_FEATURES = [
  "semantic_ambiguity",
  "context_dependence",
  "deterministic_expressibility",
  "judgment_required",
  "rule_stability",
  "risk_or_policy_component",
  "natural_language_understanding",
  "decision_complexity"
] as const;
export type BoundaryFeature = (typeof BOUNDARY_FEATURES)[number];
export const FEATURE_LEVELS = ["none", "low", "medium", "high", "unknown"] as const;
export type FeatureLevel = (typeof FEATURE_LEVELS)[number];

/** Possible reasons Jev was chosen — each is assessed against the code, never assumed. */
export const WHY_JEV_HYPOTHESES = [
  "semantic_interpretation",
  "ambiguous_natural_language_or_context",
  "multiple_competing_outcomes",
  "judgment_not_computation",
  "policy_interpretation",
  "risk_assessment",
  "classification_requiring_context",
  "hard_to_encode_as_rules",
  "soft_or_changing_rules",
  "uncertain_inputs",
  "context_dependent_behavior",
  "expensive_or_fragile_deterministic_rules"
] as const;
export type WhyJevHypothesis = (typeof WHY_JEV_HYPOTHESES)[number];

/** Things that may CORRELATE with Jev use but are NOT reasons by themselves. Checked explicitly. */
export const NOT_REASONS = ["critical_decision", "slow_or_expensive_to_run", "large_function", "many_branches", "important_feature", "complex_code"] as const;
export type NotReason = (typeof NOT_REASONS)[number];

export const ASSESSMENTS = ["supported", "contradicted", "not_determinable"] as const;
export type Assessment = (typeof ASSESSMENTS)[number];
export const CONFIDENCE = ["low", "medium", "high"] as const;
export type Confidence = (typeof CONFIDENCE)[number];
export const DECISION_NATURE = ["semantic_judgment", "exact_rule", "mixed", "not_a_decision", "unclear"] as const;
export type DecisionNature = (typeof DECISION_NATURE)[number];

export interface Evidence {
  /** file:line or file:start-end */
  location: string;
  observation: string;
}
export interface Claim {
  claim: string;
  evidence: Evidence[];
}
/** The fact/inference/unknown split every explanation must keep. */
export interface Explanation {
  observed: Claim[];
  inferred: Claim[];
  unknown: string[];
}

export interface DecisionUnderstanding {
  what_is_decided: string;
  inputs: { name: string; source: string; role: string }[];
  outcomes: string[];
  downstream_action: string;
  nature: DecisionNature;
}

export type FeatureMap = Record<BoundaryFeature, { level: FeatureLevel; evidence: string }>;

/** The adaptive-context fields every analysis carries (shared loop). */
interface AdaptiveFields {
  context_sufficient: boolean;
  missing_context: { request: string; why: string }[];
  context_used: string[];
  understanding_confidence: Confidence;
}

/** C — "why Jev here?" for one observed usage. MODEL INFERENCE. */
export interface UsageAnalysis extends AdaptiveFields {
  decision: DecisionUnderstanding;
  jev_questions: { key: string; primitive: string; what_it_asks: string }[];
  features: FeatureMap;
  why_jev_hypotheses: { id: WhyJevHypothesis; assessment: Assessment; evidence: string }[];
  not_reasons: { id: NotReason; assessment: Assessment; note: string }[];
  why_jev: Explanation;
  deterministic_alternative: { what_rules_would_need: string; adequacy: string };
  confidence: Confidence;
}

/** D — "why did this stay deterministic?", for one contrast next to one Jev site. MODEL INFERENCE. */
export interface ContrastItemAnalysis {
  contrast_id: string;
  is_a_real_decision: boolean;
  decision: DecisionUnderstanding;
  features: FeatureMap;
  why_deterministic: Explanation;
  differences_from_jev_site: Claim[];
  /** Hypothesis only — never a label: does it share the traits the Jev site showed? */
  shares_jev_site_traits: "no" | "partly" | "yes" | "unclear";
  confidence: Confidence;
}
export interface ContrastAnalysis extends AdaptiveFields {
  contrasts: ContrastItemAnalysis[];
}

/** E — patterns derived across C and D. HYPOTHESES, and never more than the records support. */
export interface BoundaryPattern {
  id: string;
  side: "jev" | "deterministic" | "separator";
  statement: string;
  supporting: string[];
  counter_examples: string[];
  projects: string[];
  strength: "single_example" | "recurring_in_one_project" | "cross_project";
  features_involved: BoundaryFeature[];
}

/**
 * A pattern as Layer E stores it. Every count, id and project here is computed from the stored
 * records (aggregate.ts); only `statement` and `caveat` may come from the model, and only when
 * `statementSource` says so.
 */
export interface DerivedPattern extends BoundaryPattern {
  category: string;
  groupId: string;
  /** What the counts show, always written from the numbers. */
  evidence: string;
  /** Exactly what was counted, so the number can be reproduced. */
  basis: string;
  /** Deterministic record ids this pattern contrasts against (empty = never measured). */
  contrasting: string[];
  confidence: Confidence;
  contested: boolean;
  unknowns: string[];
  statementSource: "aggregated" | "model";
  caveat?: string;
  notes: string[];
}

export interface PatternAnalysis {
  patterns: DerivedPattern[];
  rejected_explanations: { statement: string; why: string; ids?: string[] }[];
  open_questions: string[];
}

/** What the optional model synthesis is allowed to return: wording for groups, nothing else. */
export interface SynthesisAnswer {
  groups: { group_id: string; supported_by_the_counts: boolean; statement: string; side: "jev" | "deterministic" | "separator"; caveat: string }[];
  open_questions: string[];
}

// ─── stored records (one JSON object per line) ──────────────────────────

export type Visibility = "public" | "private";

export interface CallAccounting {
  calls: number;
  rounds: number;
  retries: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  /** Prompt tokens served from the provider's cache, when reported. */
  cachedTokens: number;
  /** Cost in USD. `costSource` says whether the provider reported it or JevX calculated it. */
  costUsd?: number;
  costSource?: "provider" | "calculated";
}

export interface AnalystInfo {
  provider: string;
  model: string;
  promptVersion: string;
}

/** B */
export interface UsageRecord {
  schema: number;
  layer: "B_observed_usage";
  project: string;
  visibility: Visibility;
  finder: string;
  /** Private projects: question texts and call texts removed. */
  site: JevSite;
  anchor: boolean;
  at: string;
}

/** C */
export interface AnalysisRecord {
  schema: number;
  layer: "C_usage_analysis";
  kind: "model_generated_inference";
  project: string;
  visibility: Visibility;
  siteId: string;
  site: { file: string; unit: JevSite["unit"]; codeHash: string };
  analyst: AnalystInfo;
  /** Public: the full analysis. Private: omitted (see facts). */
  analysis?: UsageAnalysis;
  facts: AnalysisFacts;
  context: { rounds: number; chars: number; stoppedBy: string; items?: string[] };
  usable: boolean;
  accounting: CallAccounting;
  at: string;
}

/** Enums and levels only: safe for private projects (no free text, no code). */
export interface AnalysisFacts {
  nature: DecisionNature;
  features: Record<BoundaryFeature, FeatureLevel>;
  why_jev_hypotheses?: Record<string, Assessment>;
  not_reasons?: Record<string, Assessment>;
  confidence: Confidence;
  understanding_confidence: Confidence;
  observed_claims: number;
  inferred_claims: number;
  unknowns: number;
}

/** D */
export interface ContrastRecord {
  schema: number;
  layer: "D_contrast";
  project: string;
  visibility: Visibility;
  /** The Jev site this contrast is paired with. */
  siteId: string;
  contrast: {
    id: string;
    file: string;
    unit: { name: string; start: number; end: number };
    codeHash: string;
    generators: string[];
    /** Why it was selected (deterministic, no AI). */
    selection: "same_function" | "same_file" | "related_file";
  };
  analyst: AnalystInfo;
  analysis?: ContrastItemAnalysis;
  facts: Omit<AnalysisFacts, "why_jev_hypotheses" | "not_reasons"> & { is_a_real_decision: boolean; shares_jev_site_traits: ContrastItemAnalysis["shares_jev_site_traits"] };
  usable: boolean;
  /** Shared by the contrasts analyzed in the same call. */
  accounting: CallAccounting;
  at: string;
}

/**
 * E. The deterministic part (source, groups, index, patterns' counts) is always present; the
 * `synthesis` block only appears when a model was asked to word the groups.
 */
export interface PatternRecord {
  schema: number;
  layer: "E_patterns";
  kind: "derived_hypothesis";
  runId: string;
  projects: string[];
  from: { analyses: number; contrasts: number };
  /** Absent when the run was deterministic-only (offline, or no key). */
  analyst?: AnalystInfo;
  result: PatternAnalysis;
  /** Where each cited record id points, so a reader never has to open the dataset. */
  index: Record<string, { id: string; layer: "C" | "D"; project: string; where: string; visibility: Visibility }>;
  source: { projects: string[]; analyses: number; contrasts: number; usableAnalyses: number; realDecisionContrasts: number; privateProjects: string[]; excludedProjects: string[] };
  /** Facts about the evidence itself — gaps, uniformity, excluded records. Not patterns. */
  notes: string[];
  unknowns: string[];
  synthesis?: { batches: number; answered: number; failed: { groups: string[]; error: string }[] };
  accounting: CallAccounting;
  at: string;
}

/** One line per project run: what was spent. */
export interface RunRecord {
  schema: number;
  runId: string;
  project: string;
  analyst: AnalystInfo;
  finder: string;
  usages: { found: number; anchors: number; analyzed: number; cached: number; failed: number; skippedBudget: number };
  contrasts: { selected: number; analyzed: number; failed: number };
  accounting: CallAccounting;
  errors: string[];
  at: string;
}

export type { JevSite, JevUsageReport };
