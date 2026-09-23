export const VERSION = "0.1.0";

export interface CommandInfo {
  name: string;
  usage: string;
  summary: string;
  /**
   * Milestone that ships it (current naming — docs/CURRENT-ARCHITECTURE.md). Commands whose milestone
   * is not in SHIPPED are stubs. Patch generation / apply were "M4"/"M5" in the v1 plan; they are M9+ now.
   */
  milestone: "M1" | "M3" | "P1" | "M4" | "M5b" | "M9+" | "later";
}

/** Milestones included in this build. */
export const SHIPPED = new Set<CommandInfo["milestone"]>(["M1", "M3", "P1", "M4", "M5b"]);
export const BUILD = "M5b pilot (Jev-usage finder + boundary analyst; P1 candidate analysis and legacy scan kept)";

export const COMMANDS: CommandInfo[] = [
  { name: "analyze", usage: "jevx analyze [path]", summary: "Find decision boundaries (Phase 1 engine)", milestone: "P1" },
  { name: "jev-usages", usage: "jevx jev-usages [path]", summary: "Where is Jev actually used? (finder, offline)", milestone: "M5b" },
  { name: "boundary", usage: "jevx boundary [path]", summary: "Why Jev here, why not there? (Grok 4.6 analyst)", milestone: "M5b" },
  { name: "boundary-patterns", usage: "jevx boundary-patterns", summary: "Patterns separating Jev from exact code", milestone: "M5b" },
  { name: "review", usage: "jevx review <project>", summary: "Optional human spot-check of candidates (TUI)", milestone: "P1" },
  { name: "label", usage: "jevx label <project> <id> <label>", summary: "Optional human spot-check (non-interactive)", milestone: "P1" },
  { name: "eval", usage: "jevx eval", summary: "Metrics vs human labels, where any exist", milestone: "P1" },
  { name: "dataset", usage: "jevx dataset list|check|missed", summary: "Inspect / validate the dataset", milestone: "P1" },
  { name: "scan", usage: "jevx scan [path]", summary: "Legacy text-matching detector (regression)", milestone: "M1" },
  { name: "inspect", usage: "jevx inspect [path]", summary: "Legacy interactive candidate explorer", milestone: "M1" },
  { name: "init", usage: "jevx init", summary: "Create jevx.config.ts", milestone: "M1" },
  { name: "explain", usage: "jevx explain <file:line>", summary: "Why this is a candidate (signals + TypeSafe verdict)", milestone: "M1" },
  { name: "suggest", usage: "jevx suggest <file:line>", summary: "Generate the TypeSafe implementation", milestone: "M9+" },
  { name: "diff", usage: "jevx diff <file:line>", summary: "Show the red/green patch", milestone: "M9+" },
  { name: "apply", usage: "jevx apply <file:line>", summary: "Checkpoint, validate, apply", milestone: "M9+" },
  { name: "revert", usage: "jevx revert", summary: "Undo the last applied change", milestone: "M9+" },
  { name: "status", usage: "jevx status", summary: "Config state, last scan, funnel counters", milestone: "M9+" },
  { name: "check", usage: "jevx check", summary: "Verify config, keys, SDK reachability", milestone: "M3" },
  { name: "watch", usage: "jevx watch", summary: "Re-detect on file save", milestone: "later" },
  { name: "test", usage: "jevx test", summary: "Run project tests against applied changes", milestone: "later" },
  { name: "benchmark", usage: "jevx benchmark", summary: "Compare original vs TypeSafe behaviour", milestone: "later" }
];

export const ABOUT = `JevX ${VERSION}

Learns WHERE and WHEN real developers choose a Jev decision (TypeSafe
Noul / Choice / Score) instead of ordinary deterministic code, from real
Jev usage in real projects, so it can later point at such decisions in
new code. Current architecture: docs/CURRENT-ARCHITECTURE.md

  jevx jev-usages  where is Jev actually used? (deterministic, offline)
  jevx boundary    why Jev here? why deterministic there? (Grok 4.6 analyst;
                   model inference, never ground truth)
  jevx analyze     P1 candidate discovery (structure → generators → filters)

A Jev call is evidence of a developer's choice, not proof it was right;
no Jev is not proof Jev would be wrong. The legacy text-matching detector
(jevx scan) is kept as a regression path.`;
