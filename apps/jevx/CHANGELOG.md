# Changelog

All notable changes to `jevx`. Versions follow [semver](https://semver.org); before 1.0, minor versions may change behaviour.

## 0.4.0 — 2026-09-23 · first public release candidate

- **Learns where and why Jev fits.** Every finding now carries a generic *pattern* (e.g. `error-message-regex-classifier`: input kind, rule kind, code shape, why Jev beats the rule). With `--share`, these go to the JevX dataset — scrubbed in code of every file, function, identifier and string literal. Learned outcomes feed back into the patterns score in later releases.
- **`--min-fit <percent>`**: write fits from 50–100% (default 70 = strong fits only). Anything under 70 prints a warning; under 50 is refused. `--include-disagree` also writes fits the sources disagree on. `--include-possible` = `--min-fit 50`.
- **Claude Code / Cursor (MCP)** now works like the terminal: balanced guide, a reading order so the editor's AI reads the files itself, the generic pattern on every scorecard, the minimum-fit rule, and an opt-in `jevx_share` tool.
- **First-run welcome**: a JEVX logo the first time you run it (`jevx --welcome` shows it again).
- **`--report-json <file>`**: the full result as JSON, for comparing runs (stays on your machine).
- Packaging for npm: MIT license, Node ≥ 20.10, release check script.

## 0.3.0 — 2026-09-23 · the AI reads your code

- **The AI reads the source itself**, part by part (logic folders first, UI last), instead of only the spots static analysis picked. Static analysis now only sets the reading order, and is the fallback if reading fails.
- Balanced second check: an added network call is not a reason to reject; small spots get low scores instead of a "no".
- Fixed: AI calls were cut off after 30 seconds (now 4 minutes).
- `--dry-run` previews POSSIBLE fits too; `--include-possible` writes them.
- `--fast`: less reasoning while reading (cheaper).
- Keys from an env file (`JEVX_ENV_FILE` or `~/.jevx/.env`); your shell always wins.
- Opt-in anonymous outcomes (`--share`) to the JevX dataset (Supabase, insert-only, no code).
- `.jevx/debug/` explains every run; `.jevx/` ignores itself in git.

## 0.2.0 — 2026-09-22 · one command

- `jevx` finds, judges and changes strong fits with no picking or accepting.
- Safety in the tool: the old rule stays as the fallback, callers are updated, files with your uncommitted changes are skipped, your tests run before and after (a change that breaks them is reverted automatically), backups + `jevx undo`.
- `jevx --dry-run`, `jevx mcp install` (Claude Code + Cursor), scorecards and red/green diffs in the terminal (#c15f3c).

## 0.1.0 — 2026-09-22 · MCP server

- `jevx-mcp`: JevX as tools for Claude Code / Cursor — scan, read, related, search, a three-source scorecard (AI + TypeSafe + patterns), red/green preview and an HTML report.

## Before 0.1 — research (not released)

Sessions 1–26 (2026-09-19 → 09-21): a static decision detector, TypeSafe validation and calibration, Gemini / OpenRouter / xAI code analysts, and a study of 30 real Jev projects that produced the first pattern profile (Layer E). That research is frozen; its profile is one of the three scorecard inputs.
