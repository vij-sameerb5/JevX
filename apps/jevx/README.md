# jevx

Finds where **Jev** (TypeSafe Noul / Choice / Score) should replace hardcoded rules in your codebase, and makes
the change. One command, no questions.

```bash
cd your-project
export XAI_API_KEY=…          # your key (or OPENROUTER_API_KEY)
export TYPESAFE_API_KEY=…     # optional: adds Jev's own opinion to every scorecard
jevx
```

```
  ✓ Indexed 142 files · 12 possible spot(s)          (local, free)
  ◆ xAI is reading 118 file(s) in 6 part(s)  ~140,000 tokens
  ✓ xAI found 7 spot(s) worth checking
  ◆ Writing the change src/routing.ts:8 routeTicket
  ✓ Checks before: tests pass
  ! Reverted priorityOf(): tests failed

╭─ #1  routeTicket()  src/routing.ts:8 ─────────────────────╮
│ AI        ██████████░░  86%                               │
│ TypeSafe  ███████████░  90%                               │
│ Patterns  ███████████░  88%                               │
│ JEV FIT   88%  STRONG  → changed                          │
╰───────────────────────────────────────────────────────────╯
```

Then open VS Code or Cursor → **Source Control**: every change is there in red/green.

## What it does

1. **Indexes** the repo locally: functions, callers, types. Free.
2. **Your AI reads your source files**, part by part (logic folders first, UI last), and names every place
   where a hardcoded rule is really a judgment. Then it re-checks each spot with the surrounding code and
   throws out the ones that are exact logic.
3. **Scores** each real one three ways: your AI, TypeSafe/Jev itself, and patterns learned from real Jev
   projects.
4. **Changes only STRONG fits** (all sources agree). It keeps the old rule as a fallback, updates callers
   (e.g. `await` when a function becomes async), and adds `@typesafe-ai/sdk`.
5. **Runs your checks** (test script, TypeScript) before and after. A change that breaks something that passed
   before is reverted automatically; the rest stay.

## Commands

| | |
| --- | --- |
| `jevx` | do it |
| `jevx --dry-run` | show the red/green changes (STRONG and POSSIBLE), write nothing |
| `jevx --include-possible` | also write POSSIBLE fits (still tested, still undoable) |
| `jevx --fast` | less AI reasoning while reading (cheaper; may miss spots) |
| `jevx undo` | put back everything the last run changed |
| `jevx mcp install` | use it from Claude Code / Cursor instead (their AI, no key needed) |

## Safety

- **Your key, your AI.** JevX never ships a key. It uses `XAI_API_KEY` or `OPENROUTER_API_KEY` from your
  environment and never stores or prints it.
- **Asks once** per provider before sending code. The AI reads your source files with secrets scrubbed;
  `.env` files, tests, builds and `node_modules` are never sent. On a big repo it reads as much as
  `--budget` allows (logic first) and tells you the coverage.
- **Never mixes with your work.** Files with uncommitted changes of yours are skipped.
- **Undo** restores the originals from `.jevx/backup/`.
- Custom API addresses are refused unless `JEVX_ALLOW_CUSTOM_BASE_URL=1`.

## Keys in a file

```bash
export JEVX_ENV_FILE=~/path/to/.env     # or put the file at ~/.jevx/.env
```

`KEY=value` lines (see `.env.example`). Variables already set in your shell win.

## Sharing outcomes (optional)

`jevx --share` (or `JEVX_SHARE=1`) sends one anonymous row per finding to the JevX dataset: the kind of
decision, the scores, and what happened (changed / reverted by tests / undone). **No code, paths, file or
function names.** It's how JevX learns which suggestions hold up.

## Claude Code / Cursor

```bash
jevx mcp install
```

Restart the editor and say *"use jevx to find where Jev fits in this repo"*. The editor's AI does the work with
JevX's tools and makes the changes itself, so they appear as its usual inline red/green.

## Cost

A 50-file app takes about 15–25 AI calls on your key (~$0.50 with Grok 4.6). The run stops at
`--budget` tokens (default 400,000).
