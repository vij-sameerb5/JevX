import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Node, SyntaxKind, type SourceFile } from "ts-morph";
import { mergeDetectorOptions, type Band, type Candidate, type DetectorOptions, type SignalId } from "@jevx/core";
import { scanProject } from "@jevx/scanner";
import { detect } from "@jevx/detector";
import { ValidationCache, validateResult, type Policy, type SystemOneClient } from "@jevx/typesafe";

/**
 * Detector + validation evaluation over the hand-labelled repos in regression/legacy-v1/.
 * Every regression/legacy-v1/<repo>/expected.json lists positives (must reach minBand, default "possible")
 * and negatives (must stay in "ignore"). Any flagged candidate that is not labelled positive
 * counts as a false positive — labels have to cover everything the detector reports.
 *
 * With `validate`, three views are reported:
 *   AST        — the detector alone (as without validate)
 *   pipeline   — production behaviour: AST ≥ minimum → TypeSafe decides
 *   TypeSafe   — the validator alone, on EVERY labelled case: AST candidates of any score, plus a
 *                "probe" (the whole labelled function) for cases the AST never flags. This is what
 *                measures TypeSafe precision: negatives rarely reach it in the pipeline.
 */

export const EXAMPLES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../regression/legacy-v1");
export const REPO_ROOT = path.resolve(EXAMPLES, "..");
export const BAND_ORDER: Band[] = ["ignore", "possible", "strong", "veryStrong"];

export interface Label {
  file: string;
  context: string;
  minBand?: Band;
  note?: string;
}

export interface CaseResult {
  repo: string;
  label: Label;
  kind: "positive" | "negative";
  /** The AST candidate (with validation applied when validating). */
  candidate?: Candidate;
  /** AST-only verdict. */
  pass: boolean;
  /** When validating: the validated item (AST candidate, or a probe if the AST found nothing). */
  validated?: Candidate;
  probe?: boolean;
  /** Production pipeline verdict (AST ≥ minimum → TypeSafe). */
  pipelinePass?: boolean;
  /** TypeSafe-alone verdict (confirmed ⇔ positive). */
  typesafePass?: boolean;
}

export interface Confusion {
  tp: number;
  fn: number;
  fp: number;
  tn: number;
  precision: number;
  recall: number;
  /** Cases with no usable validation (e.g. offline replay miss). */
  missing?: number;
}

export interface EvalReport extends Confusion {
  cases: CaseResult[];
  /** Flagged candidates (≥ minimum) that no positive label covers. */
  unlabelled: { repo: string; candidate: Candidate }[];
  perSignal: Record<SignalId, { onPositive: number; onNegative: number }>;
  pipeline?: Confusion;
  typesafe?: Confusion;
  validation?: { apiCalls: number; cached: number; inputTokens: number; errors: number };
}

const bandAtLeast = (b: Band, min: Band) => BAND_ORDER.indexOf(b) >= BAND_ORDER.indexOf(min);

export function listRepos(): string[] {
  return readdirSync(EXAMPLES)
    .filter((d) => existsSync(path.join(EXAMPLES, d, "expected.json")))
    .sort();
}

export interface EvalOptions {
  validate?: {
    client: SystemOneClient;
    cacheRoot?: string;
    /** Cache only, no API calls (for tuning the policy). */
    offline?: boolean;
    policy?: Policy;
  };
}

function confusion(results: { positive: boolean; pass?: boolean }[]): Confusion {
  const scored = results.filter((r) => r.pass !== undefined);
  const tp = scored.filter((r) => r.positive && r.pass).length;
  const fn = scored.filter((r) => r.positive && !r.pass).length;
  const tn = scored.filter((r) => !r.positive && r.pass).length;
  const fp = scored.filter((r) => !r.positive && !r.pass).length;
  return {
    tp,
    fn,
    fp,
    tn,
    precision: tp + fp === 0 ? 1 : tp / (tp + fp),
    recall: tp + fn === 0 ? 1 : tp / (tp + fn),
    missing: results.length - scored.length
  };
}

/** Find a labelled function/method/arrow by name. */
function findFunction(sf: SourceFile, name: string): Node | undefined {
  for (const n of sf.getDescendants()) {
    if ((Node.isFunctionDeclaration(n) || Node.isMethodDeclaration(n)) && n.getName() === name) return n;
    if (Node.isVariableDeclaration(n) && n.getName() === name) {
      const init = n.getInitializer();
      if (init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))) return n.getFirstAncestorByKind(SyntaxKind.VariableStatement) ?? n;
    }
  }
  return undefined;
}

/** A synthetic candidate for a labelled function the AST didn't flag — lets TypeSafe be measured on it. */
function probeFor(sf: SourceFile, root: string, label: Label): Candidate | undefined {
  const fn = findFunction(sf, label.context);
  if (!fn) return undefined;
  const text = fn.getText();
  const words = new Set<string>();
  for (const lit of fn.getDescendantsOfKind(SyntaxKind.StringLiteral)) {
    const v = lit.getLiteralValue();
    if (/^[A-Za-z][A-Za-z' -]{1,40}$/.test(v)) words.add(v);
  }
  const rel = path.relative(root, sf.getFilePath()).split(path.sep).join("/");
  return {
    id: createHash("sha1").update("probe\0" + rel + "\0" + label.context).digest("hex").slice(0, 12),
    file: rel,
    line: fn.getStartLineNumber(),
    column: 1,
    endLine: fn.getEndLineNumber(),
    kind: "function",
    context: label.context,
    snippet: text.split("\n").slice(0, 14).join("\n"),
    source: { decision: text.split("\n").slice(0, 40).join("\n") },
    signals: [],
    fileHash: createHash("sha256").update(sf.getFullText()).digest("hex"),
    terms: [...words].slice(0, 30),
    score: 0,
    band: "ignore"
  };
}

export async function evaluate(overrides: Partial<DetectorOptions> = {}, evalOpts: EvalOptions = {}): Promise<EvalReport> {
  const opts = mergeDetectorOptions(overrides);
  const min = opts.thresholds.minimum;
  const cases: CaseResult[] = [];
  const unlabelled: EvalReport["unlabelled"] = [];
  const perSignal = Object.fromEntries(
    Object.keys(opts.signals).map((k) => [k, { onPositive: 0, onNegative: 0 }])
  ) as EvalReport["perSignal"];
  const vstats = { apiCalls: 0, cached: 0, inputTokens: 0, errors: 0 };
  const cache = evalOpts.validate ? new ValidationCache(evalOpts.validate.cacheRoot ?? REPO_ROOT) : undefined;

  for (const repo of listRepos()) {
    const root = path.join(EXAMPLES, repo);
    const expected = JSON.parse(readFileSync(path.join(root, "expected.json"), "utf8")) as {
      positive: Label[];
      negative: Label[];
    };
    const scanned = await scanProject({ root, include: ["**/*.{ts,tsx,js,jsx}"], exclude: [] });
    const detected = detect(scanned.files, root, opts);
    const astBest = (l: Label) =>
      detected.raw.filter((c) => c.file === l.file && c.context === l.context).sort((a, b) => b.score - a.score)[0];

    // Validation: every AST candidate (any score) + probes for labelled functions the AST didn't flag.
    let validatedRaw: Candidate[] = detected.raw;
    const probes = new Map<string, Candidate>();
    if (evalOpts.validate) {
      for (const l of [...expected.positive, ...expected.negative]) {
        if (astBest(l)) continue;
        const sf = scanned.files.find((f) => path.relative(root, f.getFilePath()).split(path.sep).join("/") === l.file);
        const p = sf && probeFor(sf, root, l);
        if (p) probes.set(`${l.file}#${l.context}`, p);
      }
      const res = await validateResult(
        { ...detected, raw: [...detected.raw, ...probes.values()] },
        {
          client: evalOpts.validate.client,
          cache: cache!,
          thresholds: opts.thresholds,
          all: true,
          offline: evalOpts.validate.offline,
          policy: evalOpts.validate.policy
        }
      );
      validatedRaw = res.raw;
      const v = res.validation!;
      vstats.apiCalls += v.apiCalls;
      vstats.cached += v.cached;
      vstats.inputTokens += v.inputTokens;
      vstats.errors += v.errors;
    }
    const byId = new Map(validatedRaw.map((c) => [c.id + "@" + c.file, c]));
    const validatedOf = (c: Candidate | undefined) => (c ? byId.get(c.id + "@" + c.file) : undefined);

    const add = (label: Label, kind: "positive" | "negative") => {
      const c = astBest(label);
      const pass = kind === "positive" ? !!c && bandAtLeast(c.band, label.minBand ?? "possible") : !c || c.band === "ignore";
      c?.signals.forEach((s) => (kind === "positive" ? perSignal[s.id].onPositive++ : perSignal[s.id].onNegative++));
      const r: CaseResult = { repo, label, kind, candidate: c, pass };
      if (evalOpts.validate) {
        const probe = probes.get(`${label.file}#${label.context}`);
        const vc = validatedOf(c) ?? validatedOf(probe);
        r.validated = vc;
        r.probe = !c && !!probe;
        r.candidate = validatedOf(c) ?? c;
        const status = vc?.validation?.status;
        const usable = status === "confirmed" || status === "rejected";
        r.typesafePass = usable ? (kind === "positive") === (status === "confirmed") : undefined;
        // production: only AST ≥ minimum reaches TypeSafe
        const sent = !!c && c.score >= min;
        if (kind === "positive") {
          r.pipelinePass = !sent ? false : usable ? status === "confirmed" && bandAtLeast(r.candidate!.band, label.minBand ?? "possible") : undefined;
        } else {
          r.pipelinePass = !sent ? true : usable ? status !== "confirmed" : undefined;
        }
      }
      cases.push(r);
    };
    expected.positive.forEach((l) => add(l, "positive"));
    expected.negative.forEach((l) => add(l, "negative"));

    const covered = new Set(expected.positive.map((l) => `${l.file}#${l.context}`));
    const negLabelled = new Set(expected.negative.map((l) => `${l.file}#${l.context}`));
    for (const c of detected.raw) {
      const key = `${c.file}#${c.context}`;
      if (c.band !== "ignore" && !covered.has(key) && !negLabelled.has(key)) unlabelled.push({ repo, candidate: c });
    }
  }
  cache?.save();

  const ast = confusion(cases.map((c) => ({ positive: c.kind === "positive", pass: c.pass })));
  ast.fp += unlabelled.length;
  ast.precision = ast.tp + ast.fp === 0 ? 1 : ast.tp / (ast.tp + ast.fp);
  delete ast.missing;
  const report: EvalReport = { ...ast, cases, unlabelled, perSignal };
  if (evalOpts.validate) {
    report.pipeline = confusion(cases.map((c) => ({ positive: c.kind === "positive", pass: c.pipelinePass })));
    report.typesafe = confusion(cases.map((c) => ({ positive: c.kind === "positive", pass: c.typesafePass })));
    report.validation = vstats;
  }
  return report;
}

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
const line = (name: string, c: Confusion) =>
  `${name.padEnd(9)} precision ${pct(c.precision).padStart(4)}  recall ${pct(c.recall).padStart(4)}   TP ${c.tp}  FN ${c.fn}  FP ${c.fp}  TN ${c.tn}${c.missing ? `  (missing ${c.missing})` : ""}`;

export function formatReport(r: EvalReport): string {
  const lines: string[] = [];
  const validated = !!r.typesafe;
  if (!validated) {
    lines.push(`precision ${pct(r.precision)}  recall ${pct(r.recall)}   TP ${r.tp}  FN ${r.fn}  FP ${r.fp}  TN ${r.tn}`);
  } else {
    lines.push(line("AST", r));
    lines.push(line("pipeline", r.pipeline!));
    lines.push(line("TypeSafe", r.typesafe!));
    const v = r.validation!;
    lines.push(`          ${v.apiCalls} API calls · ${v.cached} cached · ${v.inputTokens.toLocaleString()} input tokens${v.errors ? ` · ${v.errors} errors` : ""}`);
  }
  lines.push("");
  for (const c of r.cases) {
    const name = `${c.repo}/${c.label.file} ${c.label.context}()`;
    const kind = c.kind === "positive" ? "POS" : "NEG";
    if (!validated) {
      const score = c.candidate ? `${String(c.candidate.score).padStart(3)} ${c.candidate.band}` : "  – none";
      const sig = c.candidate ? c.candidate.signals.map((s) => s.id).join(",") : "";
      lines.push(`${c.pass ? "✓" : "✗"} ${kind} ${name.padEnd(58)} ${score.padEnd(16)} ${sig}`);
    } else {
      const v = c.validated?.validation;
      const ast = c.candidate ? String(c.candidate.score).padStart(3) : (c.probe ? "prb" : "  –");
      const ts = v?.status === "confirmed" || v?.status === "rejected"
        ? `${v.status === "confirmed" ? "conf" : "rej "} sem ${v.semantic?.toFixed(2)} hum ${v.humanText?.toFixed(2)} ${v.kind} ${v.kindConfidence?.toFixed(2)}`
        : v ? `error: ${v.error}` : "– not validated";
      const mark = (b?: boolean) => (b === undefined ? "·" : b ? "✓" : "✗");
      lines.push(`${mark(c.pipelinePass)}${mark(c.typesafePass)} ${kind} ${name.padEnd(58)} AST ${ast}  ${ts}`);
    }
  }
  for (const u of r.unlabelled) {
    lines.push(`✗ UNL ${`${u.repo}/${u.candidate.file}:${u.candidate.line} ${u.candidate.context ?? ""}`.padEnd(58)} ${u.candidate.score}`);
  }
  if (validated) lines.push("", "columns: pipeline ✓/✗, TypeSafe-alone ✓/✗ · prb = probe (AST found nothing; whole function sent)");
  lines.push("");
  lines.push("signal               fires on POS   fires on NEG");
  for (const [id, s] of Object.entries(r.perSignal)) {
    lines.push(`${id.padEnd(20)} ${String(s.onPositive).padStart(12)}   ${String(s.onNegative).padStart(12)}`);
  }
  return lines.join("\n");
}
