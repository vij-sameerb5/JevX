// File storage: dataset/dataset.json, dataset/projects/<slug>/{project.json, entries.jsonl}.
// One JSON object per line keeps diffs reviewable in git. Writes are atomic (tmp + rename).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { scrubSecrets, type AnalysisResult, type CodeAnalystProvider, type DecisionCandidate, type DecisionCategory, type HardNegativeReason, type Label, type Primitive } from "@jevx/core";
import {
  DEFAULT_DATASET_CONFIG,
  SCHEMA_VERSION,
  validateEntry,
  validateProject,
  type DatasetConfig,
  type DatasetEntry,
  type DatasetGemini,
  type HumanLabel,
  type ProjectRecord,
  type Split,
  type Visibility
} from "./schema.js";
import { assignSplit, fingerprintOf } from "./splits.js";

const MAX_STORED_CODE_LINES = 200;

function writeAtomic(file: string, text: string) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(`${file}.tmp`, text);
  renameSync(`${file}.tmp`, file);
}

export class Dataset {
  constructor(readonly dir: string) {}

  private projectDir(slug: string) {
    return path.join(this.dir, "projects", slug);
  }

  config(): DatasetConfig {
    const f = path.join(this.dir, "dataset.json");
    if (!existsSync(f)) return DEFAULT_DATASET_CONFIG;
    return { ...DEFAULT_DATASET_CONFIG, ...(JSON.parse(readFileSync(f, "utf8")) as Partial<DatasetConfig>) };
  }

  ensureConfig(): DatasetConfig {
    const f = path.join(this.dir, "dataset.json");
    if (!existsSync(f)) writeAtomic(f, JSON.stringify(DEFAULT_DATASET_CONFIG, null, 2) + "\n");
    return this.config();
  }

  slugs(): string[] {
    const d = path.join(this.dir, "projects");
    if (!existsSync(d)) return [];
    return readdirSync(d, { withFileTypes: true })
      .filter((e) => e.isDirectory() && existsSync(path.join(d, e.name, "project.json")))
      .map((e) => e.name)
      .sort();
  }

  project(slug: string): ProjectRecord | undefined {
    const f = path.join(this.projectDir(slug), "project.json");
    return existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as ProjectRecord) : undefined;
  }

  projects(): ProjectRecord[] {
    return this.slugs().flatMap((s) => this.project(s) ?? []);
  }

  entries(slug: string): DatasetEntry[] {
    const f = path.join(this.projectDir(slug), "entries.jsonl");
    if (!existsSync(f)) return [];
    return readFileSync(f, "utf8")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as DatasetEntry);
  }

  saveProject(p: ProjectRecord) {
    const errs = validateProject(p);
    if (errs.length) throw new Error(errs.join("\n"));
    writeAtomic(path.join(this.projectDir(p.slug), "project.json"), JSON.stringify(p, null, 2) + "\n");
  }

  /** Validates every entry first; refuses to write anything that breaks the privacy rules. */
  saveEntries(p: ProjectRecord, entries: DatasetEntry[]) {
    const errs = entries.flatMap((e) => validateEntry(e, p));
    if (errs.length) throw new Error(`refusing to write ${p.slug}:\n${errs.slice(0, 10).join("\n")}`);
    const sorted = [...entries].sort((a, b) => a.file.localeCompare(b.file) || a.unit.start - b.unit.start || a.id.localeCompare(b.id));
    writeAtomic(path.join(this.projectDir(p.slug), "entries.jsonl"), sorted.map((e) => JSON.stringify(e)).join("\n") + (sorted.length ? "\n" : ""));
  }
}

// ─── Analysis → dataset ─────────────────────────────────────────────────

export interface ProjectMeta {
  slug: string;
  visibility: Visibility;
  source?: string;
  commit?: string;
  license?: string;
  domains?: string[];
  /** Manual split. Omit for the deterministic hash assignment. */
  split?: Split;
  notes?: string;
}

export interface UpsertReport {
  project: ProjectRecord;
  created: boolean;
  added: number;
  updated: number;
  stale: number;
  recheck: number;
  total: number;
}

const SIMPLE_NAME = /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/;

/**
 * Private projects store structure, not source: no code, no string literals (outcome values,
 * matched terms, generator evidence), and input names only when they are plain identifiers.
 */
function privateView(c: DecisionCandidate): Pick<DatasetEntry, "decision" | "inputs" | "outputs" | "generators"> {
  const inputs = c.inputs.map((i) => ({ ...i, name: SIMPLE_NAME.test(i.name) ? i.name : "<expression>" }));
  const provs = [...new Set(inputs.map((i) => i.provenance))].join(", ") || "no inputs";
  return {
    decision: `${c.unit.name}: ${c.outputs.kind} decision over ${c.outputs.values.length} outcome(s) from ${inputs.length} input(s) (${provs})`,
    inputs,
    outputs: { kind: c.outputs.kind, values: [] },
    generators: c.generators.map((g) => ({ generator: g.generator, evidence: [] }))
  };
}

/**
 * Code-analyst evidence for one provider slot (gemini / openrouter). Same format and the same
 * privacy rules for both: public = scrubbed analysis + context ids, private = facts only.
 */
function analystOf(slot: CodeAnalystProvider, c: DecisionCandidate, p: ProjectRecord, prev?: DatasetEntry): DatasetGemini | undefined {
  const ev = c[slot];
  if (!ev) return prev?.[slot] && prev.codeHash === c.hashes.code ? prev[slot] : undefined; // keep evidence for unchanged code
  const a = ev.analysis;
  return {
    kind: "model_generated_evidence",
    ...(slot === "gemini" ? {} : { provider: slot }),
    model: ev.model,
    promptVersion: ev.promptVersion,
    at: ev.at,
    facts: {
      decision_type: a.decision_type,
      deterministic_logic: a.deterministic_logic,
      approximates_judgment: a.approximates_judgment,
      plausible_primitive: a.plausible_primitive,
      uncertainty: a.uncertainty,
      inputs: a.inputs.length,
      outcomes: a.outcomes.length,
      usable: ev.usable,
      understanding_confidence: a.understanding_confidence,
      context_rounds: ev.context.rounds,
      context_items: ev.context.items.length,
      context_chars: ev.context.chars,
      ...(a.model_hypothesis ? { hypothesis: a.model_hypothesis.label } : {})
    },
    ...(p.visibility === "public"
      ? {
          analysis: JSON.parse(scrubSecrets(JSON.stringify(a)).text) as typeof a,
          context: { mode: ev.context.mode, stoppedBy: ev.context.stoppedBy, items: ev.context.items.map((i) => i.id) }
        }
      : {})
  };
}

function withoutCached<T extends { cached: boolean }>(x: T): Omit<T, "cached"> {
  const copy: Partial<T> = { ...x };
  delete copy.cached;
  return copy as Omit<T, "cached">;
}

function toEntry(c: DecisionCandidate, p: ProjectRecord, now: string, prev?: DatasetEntry): DatasetEntry {
  const auto: DatasetEntry["auto"] = c.triage
    ? {
        label: "NOT_JEV",
        source: "triage",
        // triage details can quote literals from the code; private projects keep only the reason key
        reason: p.visibility === "public" ? c.triage.detail : c.triage.reason,
        hardNegativeReason: c.triage.reason
      }
    : c.classification
      ? {
          label: c.classification.label,
          source: "typesafe",
          reason: c.classification.reason,
          answers: c.semantic ? withoutCached(c.semantic) : undefined,
          promptVersion: c.semantic?.promptVersion,
          policyVersion: c.classification.policyVersion
        }
      : prev && prev.auto.source === "typesafe" && prev.codeHash === c.hashes.code
        ? prev.auto // keep an earlier semantic verdict when this run didn't validate
        : { source: "none" };
  const code =
    p.visibility === "public" ? scrubSecrets(c.code.split("\n").slice(0, MAX_STORED_CODE_LINES).join("\n")).text : undefined;
  const entry: DatasetEntry = {
    schema: SCHEMA_VERSION,
    id: c.id,
    project: p.slug,
    visibility: p.visibility,
    origin: "generated",
    status: "active",
    language: c.language,
    file: c.file,
    unit: c.unit,
    boundary: c.boundary,
    codeHash: c.hashes.code,
    fileHash: c.hashes.file,
    ...(code !== undefined ? { code } : {}),
    ...(p.visibility === "public"
      ? {
          decision: c.explanation.decision,
          inputs: c.inputs,
          outputs: c.outputs,
          generators: c.generators.map((g) => ({ generator: g.generator, evidence: g.evidence }))
        }
      : privateView(c)),
    suggestedPrimitive: c.explanation.suggestedPrimitive,
    features: c.features,
    auto,
    ...(() => {
      const g = analystOf("gemini", c, p, prev);
      const o = analystOf("openrouter", c, p, prev);
      return { ...(g ? { gemini: g } : {}), ...(o ? { openrouter: o } : {}) };
    })(),
    versions: { analysis: p.analysisVersion, schema: SCHEMA_VERSION },
    createdAt: prev?.createdAt ?? now,
    updatedAt: now
  };
  if (prev?.human) {
    entry.human = prev.human;
    entry.needsRecheck = prev.human.codeHash !== c.hashes.code;
  }
  return entry;
}

/**
 * Merge one analysis run into the dataset. Human labels are never lost: an entry whose code
 * changed keeps its label and is flagged needsRecheck; an entry no longer found becomes stale.
 */
export function upsertAnalysis(ds: Dataset, meta: ProjectMeta, result: AnalysisResult, now = new Date().toISOString()): UpsertReport {
  const cfg = ds.ensureConfig();
  const existing = ds.project(meta.slug);
  if (existing && existing.visibility !== meta.visibility) {
    throw new Error(
      `${meta.slug} is stored as ${existing.visibility}; refusing to re-save it as ${meta.visibility}. Change it deliberately by editing project.json.`
    );
  }
  if (existing && meta.split && existing.split !== meta.split) {
    throw new Error(`${meta.slug} is already in ${existing.split}; a project never moves between splits silently.`);
  }
  const fingerprint = fingerprintOf(meta.slug);
  const project: ProjectRecord = {
    schema: SCHEMA_VERSION,
    slug: meta.slug,
    fingerprint,
    visibility: meta.visibility,
    ...(meta.visibility === "public"
      ? { source: meta.source ?? existing?.source, commit: meta.commit ?? existing?.commit, license: meta.license ?? existing?.license }
      : {}),
    languages: result.profile.languages,
    frameworks: result.profile.frameworks,
    domains: meta.domains ?? existing?.domains ?? [],
    split: existing?.split ?? meta.split ?? assignSplit(fingerprint, cfg),
    splitSource: existing?.splitSource ?? (meta.split ? "manual" : "hash"),
    splitSeed: existing?.splitSeed ?? cfg.splitSeed,
    analysisVersion: result.versions.analysis,
    added: existing?.added ?? now,
    updated: now,
    ...(meta.notes ?? existing?.notes ? { notes: meta.notes ?? existing?.notes } : {})
  };

  const prev = new Map(ds.entries(meta.slug).map((e) => [e.id, e]));
  const next: DatasetEntry[] = [];
  const seen = new Set<string>();
  let added = 0;
  let updated = 0;
  for (const c of [...result.candidates, ...result.filtered]) {
    const old = prev.get(c.id);
    seen.add(c.id);
    const e = toEntry(c, project, now, old);
    if (old) updated++;
    else added++;
    next.push(e);
  }
  let stale = 0;
  for (const [id, e] of prev) {
    if (seen.has(id)) continue;
    if (e.origin === "missed") next.push(e);
    else {
      if (e.status !== "stale") stale++;
      next.push({ ...e, status: "stale", updatedAt: e.status === "stale" ? e.updatedAt : now });
    }
  }
  ds.saveProject(project);
  ds.saveEntries(project, next);
  return { project, created: !existing, added, updated, stale, recheck: next.filter((e) => e.needsRecheck).length, total: next.length };
}

// ─── Labels ─────────────────────────────────────────────────────────────

export interface LabelInput {
  label: Label;
  reasoning: string;
  confidence?: HumanLabel["confidence"];
  category?: DecisionCategory;
  primitive?: Primitive;
  hardNegativeReason?: HardNegativeReason;
  labeller: string;
}

export function labelEntry(ds: Dataset, slug: string, id: string, input: LabelInput, now = new Date().toISOString()): DatasetEntry {
  const project = ds.project(slug);
  if (!project) throw new Error(`no project ${slug} in ${ds.dir}`);
  const entries = ds.entries(slug);
  const matches = entries.filter((e) => e.id === id || e.id.startsWith(id));
  if (matches.length !== 1) throw new Error(matches.length ? `id prefix ${id} is ambiguous` : `no entry ${id} in ${slug}`);
  const e = matches[0]!;
  e.human = {
    label: input.label,
    confidence: input.confidence ?? "medium",
    reasoning: input.reasoning.trim(),
    ...(input.category ? { category: input.category } : {}),
    ...(input.primitive ? { primitive: input.primitive } : {}),
    ...(input.hardNegativeReason ? { hardNegativeReason: input.hardNegativeReason } : {}),
    labeller: input.labeller,
    at: now,
    codeHash: e.codeHash
  };
  e.needsRecheck = false;
  e.updatedAt = now;
  ds.saveEntries(project, entries);
  return e;
}

export interface MissedInput extends LabelInput {
  file: string;
  line: number;
  endLine?: number;
  name?: string;
  language?: string;
  decision?: string;
  /** Unit source (stored only for public projects). */
  code?: string;
}

/** Record a decision a human found that no generator proposed — the recall denominator. */
export function addMissed(ds: Dataset, slug: string, m: MissedInput, now = new Date().toISOString()): DatasetEntry {
  const project = ds.project(slug);
  if (!project) throw new Error(`no project ${slug} in ${ds.dir}`);
  const entries = ds.entries(slug);
  const id = createHash("sha256").update(`missed#${m.file}#${m.line}`).digest("hex").slice(0, 16);
  if (entries.some((e) => e.id === id)) throw new Error(`a missed decision is already recorded at ${m.file}:${m.line}`);
  const codeHash = createHash("sha256").update((m.code ?? `${m.file}:${m.line}`).replace(/\s+/g, " ").trim()).digest("hex");
  const entry: DatasetEntry = {
    schema: SCHEMA_VERSION,
    id,
    project: slug,
    visibility: project.visibility,
    origin: "missed",
    status: "active",
    language: m.language ?? (/\.[cm]?tsx?$/.test(m.file) ? "typescript" : "javascript"),
    file: m.file,
    unit: { kind: "block", name: m.name ?? `<missed@${m.line}>`, start: m.line, end: m.endLine ?? m.line },
    boundary: { start: m.line, end: m.endLine ?? m.line },
    codeHash,
    fileHash: "",
    ...(project.visibility === "public" && m.code ? { code: scrubSecrets(m.code).text } : {}),
    decision: m.decision ?? m.reasoning,
    suggestedPrimitive: m.primitive ?? "none",
    inputs: [],
    outputs: { kind: "unknown", values: [] },
    generators: [],
    features: {},
    auto: { source: "none" },
    human: {
      label: m.label,
      confidence: m.confidence ?? "medium",
      reasoning: m.reasoning.trim(),
      ...(m.category ? { category: m.category } : {}),
      ...(m.primitive ? { primitive: m.primitive } : {}),
      ...(m.hardNegativeReason ? { hardNegativeReason: m.hardNegativeReason } : {}),
      labeller: m.labeller,
      at: now,
      codeHash
    },
    versions: { analysis: project.analysisVersion, schema: SCHEMA_VERSION },
    createdAt: now,
    updatedAt: now
  };
  entries.push(entry);
  ds.saveEntries(project, entries);
  return entry;
}
