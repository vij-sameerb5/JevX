# JevX 2.0 plan

This plan comes from three things: the honest problems list (2026-09-28), the community study (`docs/COMMUNITY-PATTERNS.md`, 82 real Jev decisions in 22 projects), and the first Chrome extension (`apps/jevx-extension`).

## Done in 0.4.x (no breaking changes)

| Change | Why |
|---|---|
| **No passing tests or typecheck → nothing is written.** `--allow-untested` (CLI) and `allow_untested` (MCP) opt out. | "Your tests decide" is now true in every repo. |
| **Edits tolerate whitespace.** If the exact text isn't found, JevX matches line by line, ignoring indentation, trailing spaces and line endings. It still refuses a missing or ambiguous match. | Fewer "couldn't write a safe change" results. |
| **`--only <paths…>`** limits a run to some folders or files. | Faster and cheaper on big repos, and it lets the extension hand off one file at a time. |
| **Community study:** `scripts/study-jev-repos.mjs` and the dataset labels. | We now know where real Jev use lives. |
| **Chrome extension preview:** `apps/jevx-extension`. | Lets people check any GitHub repo in one click. |

## 2.0: the big change

**Find LLM calls that only pick a label.** In 43 of the 82 real Jev decisions, Jev replaces an LLM call that picks from a list or answers yes/no. JevX 0.4 only looks for regexes, keyword lists and thresholds, which is a big reason real apps score under 70%.

| # | Task | Difficulty | Time |
|---|---|---|---|
| 1 | Read prompt: add "LLM call whose answer is parsed into a label / yes-no" as a top pattern, with its fallback template (keep the LLM call as the fallback). | Medium | 2–3 days |
| 2 | Edit template for LLM→Jev: options as a constant, one batched `systemOne` call, act only above a confidence threshold, LLM fallback below it. | Medium | 3 days |
| 3 | Patterns score: add the 82 community decisions to `profile.json` (feature levels for each), re-measure controls, keep the 70% bar. | Medium | 3–4 days |
| 4 | Batch questions: one Jev call per item list instead of a loop. | Easy | 1 day |
| 5 | Benchmark: JevX vs "Claude + a good prompt" on 5 repos (3 AI-heavy, 2 plain web apps). Publish the results. | Medium | 1 week |
| 6 | Scoring consistency: temperature 0, read twice and keep the overlap, cache. | Medium | 2–3 days |
| 7 | Python support in the CLI (reader, prompts, pytest detection). Many Jev projects are Python. | Hard | 3–4 weeks |
| 8 | Monorepo workspaces and a custom test command in `.jevx/config.json`. | Medium | 2–3 days |
| 9 | Cost estimate before running, and resume after a timeout. | Easy–Medium | 2 days |
| 10 | Show exactly what `--share` will send before sending it. | Easy | 1 day |
| 11 | npm org `@jevx` → `@jevx/cli`, keeping the old name as an alias. | Easy | 2 hours |
| 12 | Anthropic directory submission for the `.mcpb`. | Easy work, long wait | 1 day + review |

## Chrome extension roadmap

| Version | What | Time |
|---|---|---|
| 0.1 (now) | Read-only scan of any public repo with your Gemini key; confidence cards; copy prompt / CLI command. Unpacked install. | Done |
| 0.2 | Same LLM-call pattern as 2.0 #1; Python file picking; "scan this folder" on tree pages; dark/light theme. | 1 week |
| 0.3 | Optional TypeSafe score through a tiny JevX proxy (so the key isn't in the browser), or a "send to my local JevX" button that talks to `jevx mcp` on localhost. | 1–2 weeks |
| 0.4 | "Open a PR with this change" via the user's GitHub token: fork → branch → commit the Jev change with the fallback → open a draft PR. Only on explicit click; never on a protected branch. | 2 weeks |
| 1.0 | Chrome Web Store listing (privacy policy, screenshots, review). Firefox port. | 1–2 weeks + review |

**About changing code from the browser:** in 0.1 the extension can't change code, and on purpose. It has no tests to run, no undo, and nobody's local checkout. The safe path to "change it" is a **draft pull request** (0.4). There, the repo's own CI runs the tests and a person approves the merge.
