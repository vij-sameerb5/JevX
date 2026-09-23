# jevx

**Find where Jev fits in your codebase — and change it.**

Your code is full of hardcoded rules that are really judgment calls: regexes that guess what an
error means, keyword lists that guess what a customer wants, `slice(0, 3)` that guesses what's
best. jevx finds them and replaces them with a Jev decision
(TypeSafe **noul** yes/no · **choice** · **score**) — keeping the old rule as the fallback.

```bash
npm i -g jevx          # or: npx jevx
cd your-project
jevx --dry-run         # see what it would change
jevx                   # change the strong fits, run your tests, undo anytime
```

## 60-second start

1. **An AI key of your own** — jevx never ships one:
   ```bash
   export XAI_API_KEY=…            # xAI (Grok)   — or OPENROUTER_API_KEY=…
   export TYPESAFE_API_KEY=…       # optional: Jev's own opinion on every scorecard
   ```
   Or put them in a file and point to it once: `export JEVX_ENV_FILE=~/path/to/.env`.
2. `jevx --dry-run` in your project → scorecards + red/green previews, nothing written.
3. `jevx` → strong fits are written, your tests run before and after, anything that breaks them
   is undone automatically. Review in VS Code / Cursor → **Source Control**. `jevx undo` restores all.

## What happens

```
index your repo (local, free)
  → your AI reads the source, logic first, and names every spot that looks like a judgment
  → it re-checks each spot with the surrounding code and drops exact logic
  → scorecard: your AI + TypeSafe (Jev itself) + patterns learned from real Jev projects
  → writes fits ≥ 70% (keeps the old rule as fallback, updates callers, adds @typesafe-ai/sdk)
  → runs your tests / typecheck before and after; reverts what breaks
```

## Commands

| | |
| --- | --- |
| `jevx` | find, judge, change strong fits, test |
| `jevx --dry-run` | preview everything from 50% fit; write nothing |
| `jevx --min-fit 55` | also write fits from 55% (50–100; default 70). Under 70 warns, under 50 refused |
| `jevx --include-disagree` | also write fits the sources disagree on (if they reach `--min-fit`) |
| `jevx undo` | put back everything the last run changed |
| `jevx --fast` | less AI reasoning while reading (cheaper, may miss spots) |
| `jevx --share` | share anonymous outcomes to improve jevx (see Privacy) |
| `jevx --report-json out.json` | save the full result locally |
| `jevx mcp install` | use it from Claude Code, Claude Desktop, Cursor, … instead (their AI, no key needed) |

## Claude Code, Claude Desktop, Cursor & more

```bash
jevx mcp install        # jevx mcp uninstall removes it again
```

Adds JevX to every supported app on this machine: **Claude Code, Claude Desktop, Cursor, Windsurf,
VS Code (Copilot), Gemini CLI and Codex** (each config is backed up once; nothing else in it is
touched). Restart the app and say *"use jevx to find where Jev fits in this repo"*. The app's AI
reads your code with jevx's tools, scores each spot and makes the changes — or, where it can't edit
files (Claude Desktop), applies them with `jevx_apply`: backup, tests before/after, auto-revert.
Say *"use Jev where the fit is at least 55%"* to go lower.

**Claude Desktop, one click:** double-click `jevx.mcpb` (or Settings → Extensions → Advanced settings →
Install Extension), pick your project folder, and paste your TypeSafe key if you have one (Claude Desktop
stores it as a secret). In chat, name other folders: *"…in ~/code/my-app"*.

- The **"not verified by Anthropic"** warning is expected: JevX isn't in Anthropic's reviewed directory
  yet. The bundle is open source (this repo), MIT, contains no keys, and is built by `pnpm build-mcpb`
  with a content check — build it yourself if you prefer.
- **Approvals:** Claude Desktop asks per tool. Choose **Always allow** for the read-only tools
  (`jevx_guide`, `jevx_scan`, `jevx_read`, `jevx_search`, `jevx_related`) — they never write or send
  anything. Keep asking for `jevx_apply` / `jevx_undo`, which change files. `jevx_read` reads up to 20
  files per call, so a scan needs few approvals.

## Privacy

- **Sent to your AI** (xAI / OpenRouter, your key): your source files, secrets scrubbed. Never
  `.env` files, tests, builds or `node_modules`. You're asked once per provider.
- **Stored by jevx** (only with `--share`): one anonymous row per finding — the *kind* of code
  (e.g. "regex on an error message"), why Jev fits, the scores and what happened. **Never** code,
  file or function names, paths, string literals or your repo's name — scrubbed in code before
  sending. The dataset accepts inserts only; nobody can read it with the public key.
- `.jevx/` in your project holds backups, the report and debug output. It ignores itself in git.

## Cost

About 15–25 AI calls for a 50-file app (~$0.50–0.90 with Grok 4.6), on your key. The run stops at
`--budget` tokens (default 400,000). Changed code calls Jev at runtime: set `TYPESAFE_API_KEY` in
your app's environment.

## Requirements

Node ≥ 20.10 · a TypeScript or JavaScript project · macOS, Linux or Windows.

MIT · [changelog](./CHANGELOG.md)
