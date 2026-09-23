// Decision Opportunity Dataset — schema v1. Language-independent: entries describe decisions
// through the DecisionCandidate vocabulary (units, inputs, outcomes, features), not through
// any one language's AST.
import {
  DECISION_CATEGORIES,
  GENERATOR_IDS,
  HARD_NEGATIVE_REASONS,
  LABELS,
  PRIMITIVES,
  containsSecret,
  type DecisionCategory,
  type DecisionUnit,
  type FeatureValue,
  type CodeAnalystProvider,
  type GeminiAnalysis,
  type Uncertainty,
  type HardNegativeReason,
  type InputRef,
  type Label,
  type OutcomeSet,
  type Primitive,
  type SemanticAnswers
} from "@jevx/core";

export const SCHEMA_VERSION = 1;

/** public = source snippets may be stored; private = fingerprint-only, never any source code. */
export type Visibility = "public" | "private";
export const SPLITS = ["train", "dev", "test"] as const;
export type Split = (typeof SPLITS)[number];

export interface DatasetConfig {
  schema: number;
  /** Seed for the deterministic project → split hash. Changing it re-shuffles only new projects. */
  splitSeed: string;
  ratios: { train: number; dev: number; test: number };
}

export const DEFAULT_DATASET_CONFIG: DatasetConfig = {
  schema: SCHEMA_VERSION,
  splitSeed: "jevx-split-v1",
  ratios: { train: 0.6, dev: 0.2, test: 0.2 }
};

export interface ProjectRecord {
  schema: number;
  slug: string;
  /** Stable project identity: sha256 of the slug. Used for split assignment and dedup. */
  fingerprint: string;
  visibility: Visibility;
  /** Public projects only: where the code came from, at which commit, under which license. */
  source?: string;
  commit?: string;
  license?: string;
  languages: string[];
  frameworks: string[];
  domains: string[];
  split: Split;
  splitSource: "hash" | "manual";
  splitSeed: string;
  analysisVersion: string;
  added: string;
  updated: string;
  notes?: string;
}

export interface HumanLabel {
  label: Label;
  confidence: "high" | "medium" | "low";
  reasoning: string;
  category?: DecisionCategory;
  primitive?: Primitive;
  hardNegativeReason?: HardNegativeReason;
  labeller: string;
  at: string;
  /** Code hash when the label was given; if the code changes, the label needs a recheck. */
  codeHash: string;
}

export interface AutoLabel {
  label?: Label;
  source: "triage" | "typesafe" | "none";
  reason?: string;
  hardNegativeReason?: HardNegativeReason;
  answers?: Omit<SemanticAnswers, "cached">;
  promptVersion?: string;
  policyVersion?: string;
}

/**
 * Gemini code-analyst output, stored as MODEL-GENERATED EVIDENCE. Never a label: it cannot
 * populate `human`, it is not used by `auto`, and eval only reports it for information.
 * Private projects store `facts` only (enums, booleans, counts) — never free text, which
 * could paraphrase or reproduce private code.
 */
export interface DatasetGemini {
  kind: "model_generated_evidence";
  /** Which code analyst produced it (absent on older entries = gemini). Same format for both. */
  provider?: CodeAnalystProvider;
  model: string;
  promptVersion: string;
  at: string;
  facts: {
    decision_type: GeminiAnalysis["decision_type"];
    deterministic_logic: boolean;
    approximates_judgment: boolean;
    plausible_primitive: Primitive;
    uncertainty: Uncertainty;
    inputs: number;
    outcomes: number;
    /** Adaptive context: was the context enough (after expansion)? usable=false → weak evidence. */
    usable: boolean;
    understanding_confidence: Uncertainty;
    context_rounds: number;
    context_items: number;
    context_chars: number;
    /** Debug-only model hypothesis. NOT a label. */
    hypothesis?: Label;
  };
  /** PUBLIC projects only, secret-scrubbed. */
  analysis?: GeminiAnalysis;
  /** PUBLIC projects only: which context items (ids = file paths + symbol names) Gemini saw. */
  context?: { mode: string; stoppedBy: string; items: string[] };
}

export interface DatasetEntry {
  schema: number;
  id: string;
  project: string;
  visibility: Visibility;
  /** generated = proposed by JevX; missed = a decision a human found that no generator proposed. */
  origin: "generated" | "missed";
  /** stale = no longer found by the latest analysis of the project. */
  status: "active" | "stale";
  language: string;
  file: string;
  unit: DecisionUnit;
  boundary: { start: number; end: number };
  codeHash: string;
  fileHash: string;
  /** PUBLIC projects only, secret-scrubbed. Never present for private projects. */
  code?: string;
  decision: string;
  suggestedPrimitive: Primitive;
  inputs: InputRef[];
  outputs: OutcomeSet;
  generators: { generator: string; evidence: string[] }[];
  features: Record<string, FeatureValue>;
  auto: AutoLabel;
  /** Gemini evidence (optional). Never ground truth. */
  gemini?: DatasetGemini;
  /** OpenRouter evidence (optional, same format and privacy rules). Never ground truth. */
  openrouter?: DatasetGemini;
  human?: HumanLabel;
  /** Human label was given on different code; review again. */
  needsRecheck?: boolean;
  versions: { analysis: string; schema: number };
  createdAt: string;
  updatedAt: string;
}

const isOneOf = <T extends string>(xs: readonly T[], v: unknown): v is T => typeof v === "string" && (xs as readonly string[]).includes(v);

/** Schema + policy checks. Returns human-readable problems (empty = valid). */
export function validateEntry(e: DatasetEntry, project?: ProjectRecord): string[] {
  const errs: string[] = [];
  const where = `${e.project}/${e.id}`;
  if (e.schema !== SCHEMA_VERSION) errs.push(`${where}: schema ${e.schema} ≠ ${SCHEMA_VERSION}`);
  for (const k of ["id", "project", "file", "codeHash", "decision"] as const) if (!e[k]) errs.push(`${where}: missing ${k}`);
  if (!isOneOf(["public", "private"], e.visibility)) errs.push(`${where}: bad visibility`);
  if (!isOneOf(["generated", "missed"], e.origin)) errs.push(`${where}: bad origin`);
  if (!isOneOf(PRIMITIVES, e.suggestedPrimitive)) errs.push(`${where}: bad suggestedPrimitive`);
  for (const g of e.generators ?? []) if (!isOneOf(GENERATOR_IDS, g.generator)) errs.push(`${where}: unknown generator ${g.generator}`);
  if (e.auto?.label !== undefined && !isOneOf(LABELS, e.auto.label)) errs.push(`${where}: bad auto label`);

  // Privacy: private entries never carry code; public code must be secret-free.
  if (e.visibility === "private" && e.code !== undefined) errs.push(`${where}: PRIVATE entry contains source code`);
  if (e.visibility === "private" && (e.outputs?.values?.length || e.generators?.some((g) => g.evidence.length)))
    errs.push(`${where}: PRIVATE entry contains source literals (outcome values / generator evidence)`);
  if (project && project.visibility !== e.visibility) errs.push(`${where}: visibility ${e.visibility} ≠ project ${project.visibility}`);
  if (e.code && containsSecret(e.code)) errs.push(`${where}: code contains an unredacted secret`);
  for (const [name, g, shown] of [["gemini", e.gemini, "Gemini"], ["openrouter", e.openrouter, "OpenRouter"]] as const) {
    if (!g) continue;
    if (g.kind !== "model_generated_evidence") errs.push(`${where}: ${name} evidence must be marked model_generated_evidence`);
    if (g.provider !== undefined && g.provider !== name) errs.push(`${where}: ${name} slot holds ${g.provider} evidence`);
    if (e.visibility === "private" && g.analysis !== undefined) errs.push(`${where}: PRIVATE entry contains ${shown} free text`);
    if (e.visibility === "private" && g.context !== undefined) errs.push(`${where}: PRIVATE entry contains ${shown} context ids`);
    if (g.analysis && containsSecret(JSON.stringify(g.analysis))) errs.push(`${where}: ${shown} analysis contains an unredacted secret`);
    if (g.facts?.hypothesis !== undefined && !isOneOf(LABELS, g.facts.hypothesis)) errs.push(`${where}: bad ${name} hypothesis`);
  }


  const h = e.human;
  if (h) {
    if (!isOneOf(LABELS, h.label)) errs.push(`${where}: bad human label`);
    if (!h.reasoning?.trim()) errs.push(`${where}: human label without reasoning`);
    if (!isOneOf(["high", "medium", "low"], h.confidence)) errs.push(`${where}: bad confidence`);
    if (h.category !== undefined && !(h.category in DECISION_CATEGORIES)) errs.push(`${where}: unknown category ${h.category}`);
    if (h.hardNegativeReason !== undefined && !(h.hardNegativeReason in HARD_NEGATIVE_REASONS)) errs.push(`${where}: unknown hard-negative reason ${h.hardNegativeReason}`);
    if (h.primitive !== undefined && !isOneOf(PRIMITIVES, h.primitive)) errs.push(`${where}: bad primitive`);
  }
  if (e.origin === "missed" && !h) errs.push(`${where}: missed decision without a human label`);
  return errs;
}

export function validateProject(p: ProjectRecord): string[] {
  const errs: string[] = [];
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(p.slug)) errs.push(`${p.slug}: slug must be lowercase letters, digits, . _ -`);
  if (!isOneOf(SPLITS, p.split)) errs.push(`${p.slug}: bad split ${p.split}`);
  if (!isOneOf(["public", "private"], p.visibility)) errs.push(`${p.slug}: bad visibility`);
  if (p.visibility === "private" && (p.source || p.commit)) errs.push(`${p.slug}: private project must not record source/commit`);
  return errs;
}
