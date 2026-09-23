import { createHash } from "node:crypto";
import path from "node:path";
import { Node, type Project, type SourceFile } from "ts-morph";
import { applyProjectResolution } from "./tsconfig.js";
import type { AnalysisResult, DecisionCandidate, DecisionUnit, FeatureValue, InputRef } from "@jevx/core";
import { collectFacts, isFunctionLike, type FunctionLike, type UnitFacts } from "./facts.js";
import { runGenerators } from "./generators.js";
import { triage } from "./triage.js";
import { explain, inputsOf, outcomesOf } from "./represent.js";
import { fileRole, languageOf, readPackageInfo, type FileRole } from "./project.js";

/** Bump when generators / triage / representation change (recorded in every dataset entry). */
export const ANALYSIS_VERSION = "a1";

/** Units shorter than this many statements can't hold a decision worth reviewing. */
const MIN_STATEMENTS = 1;

const sha = (s: string, n = 64) => createHash("sha256").update(s).digest("hex").slice(0, n);

export function unitName(fn: FunctionLike): { kind: DecisionUnit["kind"]; name: string } {
  const line = fn.getStartLineNumber();
  if (Node.isFunctionDeclaration(fn)) return { kind: "function", name: fn.getName() ?? `<default@${line}>` };
  if (Node.isMethodDeclaration(fn) || Node.isGetAccessorDeclaration(fn)) {
    const cls = fn.getFirstAncestor((a) => Node.isClassDeclaration(a) || Node.isClassExpression(a) || Node.isObjectLiteralExpression(a));
    const owner = cls && (Node.isClassDeclaration(cls) || Node.isClassExpression(cls)) ? cls.getName() : undefined;
    return { kind: "method", name: owner ? `${owner}.${fn.getName()}` : fn.getName() };
  }
  // arrow / function expression: take the name of whatever holds it
  const parent = fn.getParent();
  if (parent && Node.isVariableDeclaration(parent)) return { kind: "arrow", name: parent.getName() };
  if (parent && (Node.isPropertyAssignment(parent) || Node.isPropertyDeclaration(parent))) {
    const obj = parent.getFirstAncestor((a) => Node.isVariableDeclaration(a) || Node.isClassDeclaration(a));
    const ownerName = obj && (Node.isVariableDeclaration(obj) || Node.isClassDeclaration(obj)) ? obj.getName() : undefined;
    return { kind: "arrow", name: ownerName ? `${ownerName}.${parent.getName()}` : parent.getName() };
  }
  if (parent && Node.isCallExpression(parent)) {
    const callee = parent.getExpression().getText().replace(/\s+/g, "").slice(0, 30);
    return { kind: "arrow", name: `<${callee} callback@${line}>` };
  }
  return { kind: "arrow", name: `<anonymous@${line}>` };
}

function features(f: UnitFacts, inputs: InputRef[]): Record<string, FeatureValue> {
  const shapes = f.conditions.flatMap((c) => c.shapes);
  const count = (s: string) => shapes.filter((x) => x === s).length;
  const prov: Record<string, FeatureValue> = {};
  for (const i of inputs) prov[`input_${i.provenance}`] = ((prov[`input_${i.provenance}`] as number) ?? 0) + 1;
  return {
    lines: f.lines,
    statements: f.statements,
    params: f.params.length,
    conditions: f.conditions.length,
    decisive_conditions: f.conditions.filter((c) => c.shapes.some((s) => s !== "trivial")).length,
    atoms: f.conditions.reduce((n, c) => n + c.atoms, 0),
    cond_trivial: count("trivial"),
    cond_exact_literal: count("exact_literal"),
    cond_relational: count("relational"),
    cond_text_method: count("text_method"),
    cond_regex: count("regex"),
    cond_membership: count("membership"),
    cond_call: count("call"),
    string_literals: new Set(f.conditions.flatMap((c) => c.stringLiterals)).size,
    numeric_literals: new Set(f.conditions.flatMap((c) => c.numericLiterals)).size,
    char_compares: f.conditions.filter((c) => c.charCompare).length,
    arm_sets: f.armSets.length,
    max_arms: f.armSets.reduce((m, a) => Math.max(m, a.arms), 0),
    max_distinct_effects: f.armSets.reduce((m, a) => Math.max(m, a.effects.length), 0),
    ternaries: f.ternaries,
    returns: f.returns.length,
    literal_outcomes: new Set([...f.returns.filter((r) => ["string", "number", "enum", "discriminant"].includes(r.kind)).map((r) => r.value), ...f.assignedOutcomes]).size,
    jsx_returns: f.returns.filter((r) => r.kind === "jsx").length,
    calls: f.calls.length,
    awaits: f.awaits,
    throws: f.throws,
    loops: f.loops,
    arithmetic: f.arithmetic,
    conditional_accumulations: f.conditionalAccumulations,
    weighted_terms: f.weightedTerms,
    selector_ops: f.selectorOps.length,
    text_ops: f.textOps.length,
    max_depth: f.maxDepth,
    closed_type_inputs: inputs.filter((i) => i.closedType).length,
    textual_inputs: inputs.filter((i) => i.textual).length,
    numeric_inputs: inputs.filter((i) => i.numeric).length,
    ...prov
  };
}

export interface AnalyzeFileResult {
  units: number;
  candidates: DecisionCandidate[];
}

/** Analyze one source file. `rel` is the project-relative path with forward slashes. */
export function analyzeFile(sf: SourceFile, rel: string): AnalyzeFileResult {
  const text = sf.getFullText();
  const fileHash = sha(text);
  const language = languageOf(rel);
  const candidates: DecisionCandidate[] = [];
  const nameCount = new Map<string, number>();
  let units = 0;

  sf.forEachDescendant((n) => {
    if (!isFunctionLike(n)) return;
    const fn = n as FunctionLike;
    if (!fn.getBody()) return;
    units++;
    const { kind, name } = unitName(fn);
    const ordinal = nameCount.get(name) ?? 0;
    nameCount.set(name, ordinal + 1);

    const facts = collectFacts(fn);
    if (facts.statements < MIN_STATEMENTS && facts.ternaries === 0) return;
    const unit: DecisionUnit = { kind, name, start: fn.getStartLineNumber(), end: fn.getEndLineNumber() };
    const hits = runGenerators(facts, unit);
    if (hits.length === 0) return;

    const inputs = inputsOf(facts);
    const outputs = outcomesOf(facts);
    const regions = hits.flatMap((h) => (h.region ? [h.region] : []));
    const boundary = regions.length
      ? { start: Math.max(unit.start, Math.min(...regions.map((r) => r[0]))), end: Math.min(unit.end, Math.max(...regions.map((r) => r[1]))) }
      : { start: unit.start, end: unit.end };
    const code = fn.getText();
    candidates.push({
      id: sha(`${rel}#${name}#${ordinal}`, 16),
      language,
      file: rel,
      unit,
      boundary,
      generators: hits,
      inputs,
      outputs,
      features: features(facts, inputs),
      triage: triage(facts, hits),
      explanation: explain(name, facts, hits, inputs, outputs),
      hashes: { code: sha(code.replace(/\s+/g, " ").trim()), file: fileHash },
      code
    });
  });
  return { units, candidates };
}

export interface AnalyzeOptions {
  root: string;
  files: SourceFile[];
  /** The ts-morph project the files belong to (enables tsconfig path resolution). */
  project?: Project;
  skipped?: number;
  onProgress?: (done: number, total: number) => void;
}

/** Analyze a scanned project. Pure and offline: nothing leaves the machine here. */
export async function analyzeProject(opts: AnalyzeOptions): Promise<AnalysisResult> {
  const started = performance.now();
  const root = path.resolve(opts.root);
  const pkg = readPackageInfo(root);
  if (opts.project) applyProjectResolution(opts.project, root);
  const byRole: Record<string, number> = {};
  const languages = new Set<string>();
  const all: DecisionCandidate[] = [];
  let units = 0;
  let analyzed = 0;
  let done = 0;

  for (const sf of opts.files) {
    const rel = path.relative(root, sf.getFilePath()).split(path.sep).join("/");
    const role: FileRole = fileRole(rel);
    byRole[role] = (byRole[role] ?? 0) + 1;
    if (role === "source") {
      analyzed++;
      languages.add(languageOf(rel));
      const r = analyzeFile(sf, rel);
      units += r.units;
      all.push(...r.candidates);
    }
    opts.onProgress?.(++done, opts.files.length);
    if (done % 25 === 0) await new Promise((r) => setImmediate(r));
  }

  // Order by generator agreement (how many independent generators fired), then location.
  // This is an ordering for review, not a confidence score.
  all.sort((a, b) => b.generators.length - a.generators.length || a.file.localeCompare(b.file) || a.unit.start - b.unit.start);

  return {
    root,
    profile: {
      name: pkg.name,
      languages: [...languages].sort(),
      frameworks: pkg.frameworks,
      files: { analyzed, skipped: opts.skipped ?? 0, byRole }
    },
    candidates: all.filter((c) => !c.triage),
    filtered: all.filter((c) => c.triage),
    stats: { units, generated: all.length, durationMs: Math.round(performance.now() - started) },
    versions: { analysis: ANALYSIS_VERSION }
  };
}
