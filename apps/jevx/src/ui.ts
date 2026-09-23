// Terminal look for `npx jevx`. Accent #c15f3c on every JevX frame; green/red only for code.
import chalk from "chalk";
import type { Opportunity } from "@jevx/engine";

export const accent = chalk.hex("#c15f3c");
export const accentBold = chalk.hex("#c15f3c").bold;
export const dim = chalk.gray;
// eslint-disable-next-line no-control-regex -- ANSI colour codes
const ANSI = /\x1b\[[0-9;]*m/g;
const visible = (s: string) => s.replace(ANSI, "").length;
export const width = () => Math.max(56, Math.min(process.stdout.columns ?? 80, 84) - 2);

const pad = (s: string, w: number) => s + " ".repeat(Math.max(0, w - visible(s)));

function wrap(text: string, w: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    if (visible(line) + visible(word) + 1 > w && line) {
      out.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) out.push(line);
  return out.length ? out : [""];
}

/** A rounded box in the accent colour. `title` sits in the top border. */
export function box(lines: string[], title = ""): string {
  const w = width();
  const inner = w - 4;
  const t = title ? ` ${title} ` : "";
  const top = accent("╭─") + accentBold(t) + accent("─".repeat(Math.max(0, w - 3 - visible(t))) + "╮");
  const body = lines.flatMap((l) => (visible(l) > inner ? wrap(l, inner) : [l])).map((l) => accent("│ ") + pad(l, inner) + accent(" │"));
  return [top, ...body, accent("╰" + "─".repeat(w - 2) + "╯")].join("\n");
}

export function banner(): string {
  return box([`${accentBold("JEVX")}  ${dim("·")}  find where Jev fits, and change it`]);
}

export const bar = (x?: number, n = 12) => (typeof x === "number" ? accent("█".repeat(Math.round(x * n))) + dim("░".repeat(n - Math.round(x * n))) : dim("·".repeat(n)));
export const pct = (x?: number) => (typeof x === "number" ? `${Math.round(x * 100)}%`.padStart(4) : "  — ");

export const ok = (s: string) => `  ${chalk.green("✓")} ${s}`;
export const step = (s: string) => `  ${accent("◆")} ${s}`;
export const warn = (s: string) => `  ${chalk.yellow("!")} ${s}`;
export const skip = (s: string) => `  ${dim("○")} ${dim(s)}`;

const VERDICT: Record<string, (s: string) => string> = {
  STRONG_FIT: (s) => chalk.green.bold(s),
  POSSIBLE_FIT: (s) => chalk.yellow.bold(s),
  REVIEW_DISAGREE: (s) => chalk.yellow.bold(s),
  WEAK_FIT: (s) => chalk.red(s)
};
const LABEL: Record<string, string> = { STRONG_FIT: "STRONG", POSSIBLE_FIT: "POSSIBLE", REVIEW_DISAGREE: "SOURCES DISAGREE", WEAK_FIT: "WEAK" };

/** The scorecard for one opportunity: why first, then the three signals, then the verdict. */
export function card(o: Opportunity, n: number, outcome: string): string {
  const r = o.record!;
  const c = r.scorecard;
  const p = r.proposal;
  const label = (k: string) => dim(k.padEnd(10));
  const lines = [
    `${label("Decides")}${p.decision}`,
    `${label("Why Jev")}${p.why}`,
    "",
    `${label("AI")}${bar(c.scores.ai)} ${pct(c.scores.ai)}`,
    `${label("TypeSafe")}${bar(c.scores.typesafe)} ${pct(c.scores.typesafe)}${r.jevError ? dim("  not set") : ""}`,
    `${label("Patterns")}${bar(c.scores.patterns)} ${pct(c.scores.patterns)}`,
    accent("─".repeat(30)),
    `${label("JEV FIT")}${accentBold(pct(c.average).trim())}  ${VERDICT[c.verdict]!(LABEL[c.verdict]!)}  ${outcome}`,
    `${label("Jev uses")}${chalk.bold(p.primitive)} · "${p.question}"`,
    `${label("Stays")}${p.deterministic_remainder}`
  ];
  if (c.verdict === "REVIEW_DISAGREE") lines.push(dim(c.why));
  return box(lines, `#${n}  ${o.unit.name}()  ${o.file}:${o.unit.start}${o.origin === "ai" ? "  · found by AI" : ""}`);
}

/** A unified diff, coloured: red removed, green added. Long diffs are trimmed. */
export function diff(patch: string, max = 40): string {
  const out: string[] = [];
  let shown = 0;
  let hidden = 0;
  for (const l of patch.split("\n")) {
    if (l.startsWith("===") || l.startsWith("Index:")) continue;
    if (l.startsWith("--- ")) continue;
    if (l.startsWith("+++ ")) {
      out.push("", `  ${chalk.bold(l.slice(4).replace(/^b\//, "").replace(/\t.*$/, ""))}`);
      continue;
    }
    if (shown >= max) {
      if (l.startsWith("+") || l.startsWith("-")) hidden++;
      continue;
    }
    shown++;
    if (l.startsWith("@@")) out.push(dim(`  ${l}`));
    else if (l.startsWith("+")) out.push(chalk.green(`  ${l}`));
    else if (l.startsWith("-")) out.push(chalk.red(`  ${l}`));
    else out.push(dim(`  ${l}`));
  }
  if (hidden) out.push(dim(`  … ${hidden} more changed line(s) — see .jevx/report.html or your editor`));
  return out.join("\n");
}
