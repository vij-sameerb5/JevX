// The "AI reads everything" plan: which source files go to the AI, in what order, in how many
// parts. Static analysis no longer decides WHAT the AI sees — only the reading order.
//
//   - Every source file the scanner found is read, except tests, type declarations, generated
//     code, vendored UI kits and config files.
//   - Logic-heavy folders first (api, lib, services, server, utils…), pure UI last, so when a
//     budget cuts the read short, what's left unread is the least likely to hold decisions.
//   - Files are line-numbered and split into parts of ~80k characters (~23k tokens) — small
//     enough that the model reads every line with attention and one slow part can be retried.
//   - Secrets are scrubbed when the prompt is built (prompts.ts), and credential files are never
//     in the scanner's file list to begin with.
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ReadFile } from "./prompts.js";

export const PART_CHARS = 80_000;
export const CHARS_PER_TOKEN = 3.5;

const SKIP = [
  /\.(test|spec|stories)\.[cm]?[jt]sx?$/,
  /\.d\.ts$/,
  /(^|\/)(__tests__|__mocks__|__snapshots__|tests?|e2e|migrations|generated|__generated__|vendor)\//,
  /(^|\/)components\/ui\//,
  /(^|\/)[^/]*\.config\.[cm]?[jt]s$/,
  /(^|\/)next-env\.d\.ts$/
];

export function readPriority(file: string): number {
  const f = file.toLowerCase();
  if (/(^|\/)(api|server|services?|lib|utils?|helpers?|core|domain|actions?|handlers?|routes?|workers?|jobs?|models?)\//.test(f) || /(route|handler|service|controller)\.[cm]?[jt]sx?$/.test(f)) return 0;
  if (/(^|\/)(landing|sections|marketing|icons|animations?)\//.test(f) || /(cursor|globe|hero|footer|header|navbar|avatar|logo|icon|button)\w*\.[jt]sx$/.test(f)) return 3;
  if (/(^|\/)components\//.test(f)) return 2;
  if (/\.[jt]sx$/.test(f)) return 1;
  return 0;
}

export const skippedForReading = (file: string) => SKIP.some((r) => r.test(file));

export interface ReadPlan {
  parts: ReadFile[][];
  read: string[];
  unread: string[];
  skipped: string[];
  chars: number;
  estTokens: number;
  coverage: number;
  lines: Map<string, number>;
}

const numbered = (lines: string[], from: number) => lines.map((l, i) => `${String(from + i).padStart(4)}| ${l}`).join("\n");

/** Order, number and split the repo's source files. `maxChars` caps the whole read (budget). */
export function planRead(root: string, files: string[], maxChars: number, partChars = PART_CHARS): ReadPlan {
  const skipped = files.filter(skippedForReading);
  const ordered = files.filter((f) => !skippedForReading(f)).sort((a, b) => readPriority(a) - readPriority(b) || a.localeCompare(b));
  const pieces: ReadFile[] = [];
  const lines = new Map<string, number>();
  const read: string[] = [];
  const unread: string[] = [];
  let chars = 0;
  let totalChars = 0;
  for (const f of ordered) {
    let src: string;
    try {
      src = readFileSync(path.join(root, f), "utf8");
    } catch {
      continue;
    }
    if (/^\s*\/\/.*@generated/.test(src.slice(0, 300))) {
      skipped.push(f);
      continue;
    }
    const ls = src.split("\n");
    lines.set(f, ls.length);
    totalChars += src.length;
    if (chars + src.length > maxChars) {
      unread.push(f);
      continue;
    }
    chars += src.length;
    read.push(f);
    // split big files on line boundaries
    let start = 0;
    while (start < ls.length) {
      let size = 0;
      let end = start;
      while (end < ls.length && (end === start || size + ls[end]!.length + 8 <= partChars * 0.9)) size += ls[end++]!.length + 8;
      pieces.push({ file: f, start: start + 1, end, text: numbered(ls.slice(start, end), start + 1) });
      start = end;
    }
  }
  // pack pieces into parts
  const parts: ReadFile[][] = [];
  let cur: ReadFile[] = [];
  let size = 0;
  for (const p of pieces) {
    if (cur.length && size + p.text.length > partChars) {
      parts.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(p);
    size += p.text.length;
  }
  if (cur.length) parts.push(cur);
  const sent = parts.flat().reduce((s, p) => s + p.text.length, 0);
  return { parts, read, unread, skipped, chars, estTokens: Math.round(sent / CHARS_PER_TOKEN), coverage: totalChars ? chars / totalChars : 1, lines };
}
