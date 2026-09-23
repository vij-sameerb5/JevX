// jevx eval · jevx label · jevx dataset list|check|missed
import chalk from "chalk";
import { DECISION_CATEGORIES, HARD_NEGATIVE_REASONS, LABELS, PRIMITIVES, type DecisionCategory, type HardNegativeReason, type Label, type Primitive } from "@jevx/core";
import { Dataset, SPLITS, checkDataset, type EvalReport, type Metrics } from "@jevx/dataset";

const pct = (x: number | undefined) => (x === undefined ? "   –" : `${(x * 100).toFixed(0).padStart(3)}%`);

function metricLine(name: string, m: Metrics): string {
  return [
    name.padEnd(28),
    String(m.labelled).padStart(5),
    String(m.predicted).padStart(6),
    String(m.unclassified).padStart(7),
    pct(m.precision).padStart(6),
    pct(m.recall).padStart(6),
    pct(m.fpr).padStart(6),
    pct(m.exactAgreement).padStart(6),
    `${m.triage.agreed}/${m.triage.filtered}`.padStart(8),
    pct(m.coverage.recall).padStart(7)
  ].join(" ");
}

export function printEval(r: EvalReport, log: (s: string) => void) {
  log(chalk.bold("JevX evaluation") + chalk.gray(` · vs human labels where they exist (optional spot-checks) · splits never mixed${r.rotateSeed ? ` · rotated with seed "${r.rotateSeed}"` : ""}`));
  const header = ["".padEnd(28), "label", "pred", "unclass", "prec", "recall", "fpr", "exact", "triage✓", "cover"].join(" ");
  for (const s of SPLITS) {
    const block = r.splits[s];
    log("");
    log(chalk.bold(`${s.toUpperCase()}`) + chalk.gray(` · ${block.total.projects} project(s) · ${block.total.entries} active entries`));
    if (block.total.projects === 0) {
      log(chalk.gray("  (no projects in this split yet)"));
      continue;
    }
    log(chalk.gray(header));
    for (const p of block.projects) log(metricLine(`  ${p.slug}${p.visibility === "private" ? " 🔒" : ""}`, p.metrics));
    log(chalk.bold(metricLine("  total", block.total)));
    const t = block.total;
    if (t.needsRecheck) log(chalk.yellow(`  ${t.needsRecheck} label(s) on changed code excluded until rechecked`));
    if (Object.keys(t.labels).length) log(chalk.gray(`  labels: ${Object.entries(t.labels).map(([k, v]) => `${k} ${v}`).join(", ")}`));
    if (Object.keys(t.categories).length) log(chalk.gray(`  categories: ${Object.entries(t.categories).map(([k, v]) => `${k} ${v}`).join(", ")}`));
    for (const [name, a] of [["gemini", t.gemini], ["openrouter", t.openrouter]] as const)
      if (a.withEvidence)
        log(
          chalk.gray(
            `  ${name} evidence on ${a.withEvidence} labelled entr${a.withEvidence === 1 ? "y" : "ies"}${a.insufficient ? ` (${a.insufficient} with insufficient context)` : ""}` +
              (a.hypotheses ? ` · debug hypothesis agreed with humans ${a.agreed}/${a.hypotheses} (${pct(a.agreement).trim()}) — informational, not a metric` : "")
          )
        );
    if (t.gemini.hypotheses || t.openrouter.hypotheses) {
      const c = t.comparison;
      log(
        chalk.gray(
          `  vs human (informational): TypeSafe ${c.typesafeAgreed}/${c.typesafePredicted} · Gemini ${t.gemini.agreed}/${t.gemini.hypotheses} · OpenRouter ${t.openrouter.agreed}/${t.openrouter.hypotheses}` +
            (c.bothAnalysts ? ` · Gemini & OpenRouter agreed with each other on ${c.analystsAgreed}/${c.bothAnalysts}` : "")
        )
      );
    }
    if (Object.keys(t.hardNegatives).length) log(chalk.gray(`  hard negatives: ${Object.entries(t.hardNegatives).map(([k, v]) => `${k} ${v}`).join(", ")}`));
  }
  log("");
  log(chalk.gray("pred = labelled entries JevX auto-labelled (triage or TypeSafe) · unclass = not auto-labelled yet"));
  log(chalk.gray("prec/recall/fpr: STRONG+POSSIBLE vs NOT_JEV · exact: same 3-way label · triage✓: filtered ones humans agreed were NOT_JEV"));
  log(chalk.gray("cover: human-positive decisions JevX proposed ÷ (proposed + human-added missed decisions)"));
}

export function printCheck(ds: Dataset, log: (s: string) => void, rotateSeed?: string): number {
  const r = checkDataset(ds, { rotateSeed });
  log(`${chalk.bold("Dataset check")} ${chalk.gray(ds.dir)} · ${r.projects} project(s) · ${r.entries} entries`);
  for (const e of r.errors) log(chalk.red(`✗ ${e}`));
  for (const w of r.warnings) log(chalk.yellow(`• ${w}`));
  if (!r.errors.length) log(chalk.green("✓ schema, privacy and split checks passed"));
  return r.errors.length ? 1 : 0;
}

export function printList(ds: Dataset, log: (s: string) => void) {
  const projects = ds.projects();
  if (!projects.length) {
    log(chalk.gray(`No projects in ${ds.dir} yet. Add one with: jevx analyze <path> --save --public|--private`));
    return;
  }
  log(chalk.gray(`${"project".padEnd(24)} ${"split".padEnd(6)} ${"vis".padEnd(8)} ${"entries".padStart(7)} ${"labelled".padStart(8)} ${"recheck".padStart(7)}  frameworks`));
  for (const p of projects) {
    const es = ds.entries(p.slug).filter((e) => e.status === "active");
    log(
      `${p.slug.padEnd(24)} ${p.split.padEnd(6)} ${p.visibility.padEnd(8)} ${String(es.length).padStart(7)} ${String(es.filter((e) => e.human).length).padStart(8)} ${String(
        es.filter((e) => e.needsRecheck).length
      ).padStart(7)}  ${p.frameworks.join(", ")}`
    );
  }
}

// ─── Option parsing shared by label / missed / review ────────────────────

export function parseLabel(v: string): Label {
  const u = v.toUpperCase().replace(/-/g, "_");
  const map: Record<string, Label> = { S: "STRONG_JEV", STRONG: "STRONG_JEV", P: "POSSIBLE_JEV", POSSIBLE: "POSSIBLE_JEV", N: "NOT_JEV", NOT: "NOT_JEV" };
  const l = map[u] ?? (LABELS as readonly string[]).find((x) => x === u);
  if (!l) throw new Error(`label must be one of ${LABELS.join(", ")} (or s/p/n)`);
  return l as Label;
}

export function parseCategory(v?: string): DecisionCategory | undefined {
  if (!v) return undefined;
  if (!(v in DECISION_CATEGORIES)) throw new Error(`category must be one of: ${Object.keys(DECISION_CATEGORIES).join(", ")}`);
  return v as DecisionCategory;
}

export function parseHardNegative(v?: string): HardNegativeReason | undefined {
  if (!v) return undefined;
  if (!(v in HARD_NEGATIVE_REASONS)) throw new Error(`hard-negative reason must be one of: ${Object.keys(HARD_NEGATIVE_REASONS).join(", ")}`);
  return v as HardNegativeReason;
}

export function parsePrimitive(v?: string): Primitive | undefined {
  if (!v) return undefined;
  if (!(PRIMITIVES as readonly string[]).includes(v)) throw new Error(`primitive must be one of: ${PRIMITIVES.join(", ")}`);
  return v as Primitive;
}

export function defaultLabeller(): string {
  return process.env.JEVX_LABELLER?.trim() || process.env.USER?.trim() || "human";
}
