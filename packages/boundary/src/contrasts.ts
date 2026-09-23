// Layer D selection — deterministic, no AI. For each Jev site, pick up to N decision-like
// functions WITHOUT Jev from the same neighbourhood, nearest first:
//   same_function (a nested helper inside the Jev site's function that makes its own decision)
//   → same_file → related_file (imports it / imported by it / a caller's file).
// Never forced: if nothing meaningful is near, fewer (or zero) contrasts are chosen. Nothing is
// taken from elsewhere in the project just to fill the quota.
import path from "node:path";
import type { SourceFile } from "ts-morph";
import type { DecisionCandidate, JevSite } from "@jevx/core";

export type ContrastSelection = "same_function" | "same_file" | "related_file";

export interface SelectedContrast {
  candidate: DecisionCandidate;
  selection: ContrastSelection;
}

export const DEFAULT_MAX_CONTRASTS = 3;
const NON_PRODUCT = /(^|\/)(bench|benchmarks?|experiments?|examples?|scripts?|demos?|fixtures?|measure)\/|(^|\/)bench\.[cm]?[jt]sx?$/i;

/** Lines that touch Jev (questions, calls) per file, from every finder site incl. plumbing / uncertain. */
function jevLines(sites: JevSite[]): Map<string, { lines: Set<number>; units: [number, number][] }> {
  const m = new Map<string, { lines: Set<number>; units: [number, number][] }>();
  const at = (file: string) => m.get(file) ?? m.set(file, { lines: new Set<number>(), units: [] }).get(file)!;
  for (const s of sites) {
    const e = at(s.file);
    for (const q of s.questions) e.lines.add(q.line);
    for (const c of s.calls) e.lines.add(c.line);
    e.units.push([s.unit.start, s.unit.end]);
    // functions that CALL a Jev site consume its answer: wiring, not an independent decision
    for (const c of s.callers) at(c.file).lines.add(c.line);
  }
  return m;
}

/** Import relations between project files (both directions), by relative path. */
export function importGraph(root: string, files: SourceFile[]): Map<string, Set<string>> {
  const rel = (sf: SourceFile) => path.relative(root, sf.getFilePath()).split(path.sep).join("/");
  const g = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (a === b) return;
    (g.get(a) ?? g.set(a, new Set()).get(a)!).add(b);
    (g.get(b) ?? g.set(b, new Set()).get(b)!).add(a);
  };
  for (const sf of files) {
    for (const imp of sf.getImportDeclarations()) {
      try {
        const t = imp.getModuleSpecifierSourceFile();
        if (t) link(rel(sf), rel(t));
      } catch {
        /* unresolved import */
      }
    }
  }
  return g;
}

export function selectContrasts(
  site: JevSite,
  candidates: DecisionCandidate[],
  allSites: JevSite[],
  graph: Map<string, Set<string>>,
  opts: { max?: number; used?: Set<string> } = {}
): SelectedContrast[] {
  const max = opts.max ?? DEFAULT_MAX_CONTRASTS;
  if (max <= 0) return [];
  const touched = jevLines(allSites);
  const related = new Set([...(graph.get(site.file) ?? []), ...site.callers.map((c) => c.file)]);
  related.delete(site.file);

  const touchesJev = (c: DecisionCandidate) => {
    const t = touched.get(c.file);
    if (!t) return false;
    for (const l of t.lines) if (l >= c.unit.start && l <= c.unit.end) return true;
    // the candidate IS a Jev site's function (same unit)
    return t.units.some(([s, e]) => s === c.unit.start && e === c.unit.end);
  };

  const scored: { c: DecisionCandidate; selection: ContrastSelection; rank: number }[] = [];
  for (const c of candidates) {
    if (c.triage) continue; // filtered as a trivial / named hard negative — not a meaningful decision
    if (touchesJev(c)) continue;
    // Dry run on the corpus: a product-code Jev site got a bench script as its "contrast"
    // (turbo-rerank/bench.ts). Test / bench / script code only contrasts with a site of the same kind.
    if (NON_PRODUCT.test(c.file) && !NON_PRODUCT.test(site.file)) continue;
    let selection: ContrastSelection | undefined;
    if (c.file === site.file && c.unit.start >= site.unit.start && c.unit.end <= site.unit.end) selection = "same_function";
    else if (c.file === site.file) selection = "same_file";
    else if (related.has(c.file)) selection = "related_file";
    if (!selection) continue;
    const tier = selection === "same_function" ? 0 : selection === "same_file" ? 1 : 2;
    const distance = c.file === site.file ? Math.abs(c.unit.start - site.unit.start) : 100_000;
    // nearer tier first, then more independent generators, then proximity
    scored.push({ c, selection, rank: tier * 1e9 - c.generators.length * 1e6 + distance });
  }
  scored.sort((a, b) => a.rank - b.rank || a.c.file.localeCompare(b.c.file) || a.c.unit.start - b.c.unit.start);
  const out: SelectedContrast[] = [];
  for (const s of scored) {
    if (out.length >= max) break;
    if (opts.used?.has(s.c.id + s.c.file)) continue; // already paired with another Jev site in this run
    out.push({ candidate: s.c, selection: s.selection });
    opts.used?.add(s.c.id + s.c.file);
  }
  return out;
}
