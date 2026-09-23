# jevx-mcp

Your AI finds where **Jev** (TypeSafe Noul / Choice / Score) would improve your codebase, scores each
spot, and shows the change as a red/green diff before touching anything.

- **Your AI does the thinking** — Claude Code, Cursor, VS Code Copilot, anything that speaks MCP. It uses
  your own subscription; JevX costs no tokens.
- **JevX runs locally** — it indexes the repo, finds candidate decisions, hands your AI exactly the code it
  asks for (functions, callers, types, files), and never uploads the repository.
- **Jev gives a second opinion** — with `TYPESAFE_API_KEY` set, each proposal is checked by Jev itself.

## The flow

```
your AI ──▶ jevx_guide        what a Jev opportunity is (and isn't)
        ──▶ jevx_scan         candidate decisions + where Jev is already used      (local, free)
        ──▶ jevx_read / jevx_related / jevx_search    read only what it needs      (local, free)
        ──▶ jevx_scorecard    patterns + AI + TypeSafe → average                  (TypeSafe: your key)
        ──▶ jevx_preview_change   red/green diff — changes NOTHING
        ──▶ you say yes ──▶ your AI applies it with its own edit tool ──▶ tests
        ──▶ jevx_report       .jevx/report.html: every scorecard + diff
```

## The scorecard

```
JevX scorecard — src/routing.ts:7 · choice
  patterns   █████████░ 88%   (vs 7 real Jev sites studied)
  AI         █████████░ 86%   (your AI, after reading the code)
  TypeSafe   █████████░ 90%   (Jev's own opinion)
  ─────────────────────────────
  average    █████████░ 88%   🟢 STRONG_FIT
```

- **patterns**: how the decision's traits (ambiguity, judgment, how well exact rules express it, …) compare
  with real Jev usages JevX studied in open-source projects. The profile comes from a small pilot, so treat it
  as a hint.
- **AI**: your AI's own confidence, after reading the code.
- **TypeSafe**: Jev's answer to three questions: does this need judgment, are the outcomes bounded, and
  would exact code still be right? Skipped (and said so) without `TYPESAFE_API_KEY`.
- **average**: the mean of the scores that are available. When the sources point different ways the verdict is
  `REVIEW_DISAGREE` instead of an average pretending they agree. The bands (strong ≥ 70%, possible ≥ 50%) are
  display bands, not calibrated thresholds.

## Setup

Build once (from the JevX repo):

```bash
pnpm install && pnpm build        # → apps/mcp/dist/index.js
```

Optional, for Jev's opinion in the scorecard:

```bash
export TYPESAFE_API_KEY=…         # never written anywhere by JevX
```

### Claude Code

```bash
claude mcp add jevx -e TYPESAFE_API_KEY=$TYPESAFE_API_KEY -- node /absolute/path/to/jevX/apps/mcp/dist/index.js
```

Then, inside the project you want analysed: *"Use jevx to find where Jev would help in this repo."*
Or run the prompt `/mcp__jevx__find-jev-opportunities`.

### Cursor — `.cursor/mcp.json` in your project (or `~/.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "jevx": {
      "command": "node",
      "args": ["/absolute/path/to/jevX/apps/mcp/dist/index.js"],
      "env": { "TYPESAFE_API_KEY": "${env:TYPESAFE_API_KEY}" }
    }
  }
}
```

### VS Code (Copilot agent mode) — `.vscode/mcp.json`

```json
{
  "servers": {
    "jevx": { "type": "stdio", "command": "node", "args": ["/absolute/path/to/jevX/apps/mcp/dist/index.js"] }
  }
}
```

The server analyses its working directory. Hosts start it in the open project; to point it elsewhere set
`JEVX_ROOT`, or pass `root` to any tool.

## Try it without a real key

```bash
pnpm tsx scripts/mcp-demo.ts --mock-typesafe
```

Runs the whole flow against `examples/jev-demo` (a small helpdesk) and prints where `report.html` landed.
The TypeSafe numbers in that demo come from the test mock.

## What it writes

Only under `<project>/.jevx/`: `proposals/*.json`, `proposals/*.patch`, `report.html`, `cache/mcp-jev.json`.
It never edits your source files. Your AI does that, after you agree, with its own edit tool, which is why
Cursor and Claude Code show the change as their usual reviewable diff.

## What leaves your machine

Nothing, except with `TYPESAFE_API_KEY`: `jevx_scorecard` sends TypeSafe the proposal and the decision's lines
(capped, secret-scrubbed). Never whole files, never the repository. Your AI sees the code it asks for, under
your AI provider's own terms.
