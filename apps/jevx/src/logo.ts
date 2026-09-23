// The big JEVX mark, shown once: the first time someone runs `jevx` on a machine (and on
// `jevx --welcome`). Original block lettering in the JevX orange #c15f3c with a darker shadow,
// then the one-line promise. Every later run gets the small one-line banner instead.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import chalk from "chalk";

const ORANGE = chalk.hex("#c15f3c");
const SHADOW = chalk.hex("#6e3522");
const DIM = chalk.gray;

// 5-row letters, drawn on a grid: █ = face, ▓ = drop shadow (down-right; printed as a solid dark █)
const J = ["   ███", "    ██", "    ██", "██  ██", " ████ "];
const E = ["█████", "██   ", "████ ", "██   ", "█████"];
const V = ["██   ██", "██   ██", " ██ ██ ", " ██ ██ ", "  ███  "];
const X = ["██   ██", " ██ ██ ", "  ███  ", " ██ ██ ", "██   ██"];

/** The lettering with a one-cell drop shadow, as plain rows ('█' face, '▓' shadow, ' '). */
export function logoRows(): string[] {
  const face = J.map((_, r) => [J[r], E[r], V[r], X[r]].join("  "));
  const w = Math.max(...face.map((l) => l.length)) + 1;
  const grid = Array.from({ length: face.length + 1 }, () => Array<string>(w).fill(" "));
  face.forEach((row, r) => [...row].forEach((ch, c) => ch === "█" && grid[r + 1]![c + 1] === " " && (grid[r + 1]![c + 1] = "▓")));
  face.forEach((row, r) => [...row].forEach((ch, c) => ch === "█" && (grid[r]![c] = "█")));
  return grid.map((r) => r.join("").replace(/\s+$/, ""));
}

export function bigLogo(version: string): string {
  const rows = logoRows().map((r) => "   " + [...r].map((ch) => (ch === "█" ? ORANGE(ch) : ch === "▓" ? SHADOW("█") : ch)).join(""));
  return [
    "",
    ...rows,
    "",
    `   ${ORANGE.bold("JEVX")} ${DIM("·")} Find where Jev fits in your codebase.`,
    DIM(`   v${version} · preview first: jevx --dry-run · all commands: jevx --help`),
    ""
  ].join("\n");
}

const marker = () => path.join(process.env.JEVX_HOME?.trim() || path.join(homedir(), ".jevx"), "welcomed");

/** True once per machine (per JEVX_HOME): the first run shows the big logo. */
export function firstRun(): boolean {
  try {
    if (existsSync(marker())) return false;
    mkdirSync(path.dirname(marker()), { recursive: true });
    writeFileSync(marker(), new Date().toISOString() + "\n");
    return true;
  } catch {
    return false; // read-only home: just skip the welcome
  }
}
