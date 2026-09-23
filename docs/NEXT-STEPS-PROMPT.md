# Prompt for Claude: JevX next steps (patterns dataset, `--min-fit`, MCP parity, npm release)

Paste everything below into Claude (Claude Code or Cowork) with the `~/Desktop/jevX` folder open.

---

You are working on **JevX**, my TypeScript pnpm monorepo at `~/Desktop/jevX`. Read `CLAUDE.md` and `docs/CURRENT-ARCHITECTURE.md` first. They are the source of truth. Then read `JOURNAL.md` (the Session 29 entries at the top) and `apps/jevx/README.md`.

## What JevX is (short)

`jevx` is one command. The user's own AI (xAI or OpenRouter key) reads their TypeScript/JavaScript repo and finds places where a hardcoded rule is really a judgment call. It scores each place three ways (AI, TypeSafe/Jev, learned patterns) and rewrites the STRONG fits to use Jev (TypeSafe Noul / Choice / Score). The old rule is kept as the fallback. The user's tests run before and after. `jevx undo` restores everything. It also runs as an MCP server (`jevx mcp`) for Claude Code and Cursor.

The pipeline lives in `packages/engine`:
`read.ts` → `pipeline.ts` (read → assess → scorecard → edit) → `apply.ts` → `share.ts` (opt-in Supabase).

The CLI is `apps/jevx`. The prompts are in `packages/engine/src/prompts.ts`.

## Hard rules (never break these)

1. **No git commands at all.** No commit, push, branch or history changes. I do all git myself.
2. **API keys come from the environment or the env file only** (`JEVX_ENV_FILE` or `~/.jevx/.env`). Never print, log, hardcode, cache or commit a key. Never ask me to paste a key into the repo.
3. **Never upload user code to Supabase.** Anything stored there must be generic: no file paths, file names, function or variable names, repo names, string literals or code.
4. Only STRONG fits (70%+) change code by default. Anything lower needs an explicit user flag, and **never below 50%**.
5. After each step: keep `pnpm typecheck`, `pnpm lint` and `pnpm test` green, and update `JOURNAL.md`, `PLAN.md`, and `docs/CURRENT-ARCHITECTURE.md` if the direction changes.
6. Use simple English in all user-facing output.

## Task A: store *where and why* Jev fits as generic patterns (so JevX can learn)

**Problem today:** `jevx_findings` stores the primitive, a one-line decision, 8 feature levels, scores, verdict and outcome. It does **not** store *what kind of code* the spot was or *why* Jev fits in a reusable way. That is what we need to learn patterns across projects.

**Build:**

1. Extend the assess step (`ASSESS_SCHEMA`, `ASSESS_SYSTEM`, `parseAssessment` in `prompts.ts`; bump `ENGINE_PROMPT_VERSION`) with a `pattern` object the AI fills **without any names from this repo**:
   - `pattern_label`: a short generic slug, e.g. `error-message-regex-classifier`, `free-text-lookup-with-default`, `api-results-top-n-slice`, `keyword-intent-router`, `magic-threshold-on-fuzzy-signal`.
   - `input_kind`: one of `user_text | error_message | ai_output | external_api_results | free_text_name | structured_app_data | other`.
   - `rule_kind`: one of `regex | keyword_list | includes_or_startswith | lookup_with_default | sort_or_slice | threshold | if_else_chain | switch | other`.
   - `rule_shape`: one generic sentence describing the code shape, e.g. "catch block → regex on error message → pick user-facing copy". No identifiers.
   - `why_generic`: one generic sentence on why Jev beats the rule, e.g. "wording varies by provider; regexes miss new phrasings".
   - `failure_example`: one generic example of an input the rule gets wrong, e.g. "'Request rejected by user' is not matched by /User rejected/". Use invented text, never real data from the repo.
2. Before sending to Supabase, **scrub again in code**. Remove any token that matches a file name, function name, identifier or string literal from the assessed code, then run `scrubSecrets`. Truncate each field (label 60, others 200 chars).
3. Add these as columns to `jevx_findings`. Write **`supabase/jevx-dataset-v2.sql`**, an idempotent migration using `alter table … add column if not exists …`, with `check` constraints on the enums and lengths. Then create or replace:
   - a view **`jevx_patterns`**: group by `pattern_label, input_kind, rule_kind, primitive`, with counts of findings and of good / bad / rejected labels, avg ai/typesafe/pattern score, and the most common `rule_shape` and `why_generic`.
   - the existing `jevx_training` view, updated to include the new columns.

   Both views get no anon access (keep `security_invoker`, revoke anon/authenticated).
4. **Close the loop (read-only for clients):** add `scripts/export-patterns.ts`. I run it with my own `SUPABASE_SERVICE_ROLE_KEY` from the environment, never committed. It reads `jevx_patterns` and writes `packages/engine/src/patterns-learned.json`, which ships inside the next release.
   - The scorecard's **patterns** score uses it: if a finding's `pattern_label` / `rule_kind` / `input_kind` has a strong good-vs-bad history (at least 5 labelled findings), blend that in next to the existing `profile.json` score.
   - Clients never read Supabase.
5. Tests:
   - A row built from a fake finding whose code contains `secretFunctionName` and `app/checkout/page.tsx` must not contain either string.
   - The parser clamps unknown enums to `other`.
   - The CLI `--share` test sees the new fields.
   - `export-patterns` runs against a mock Supabase.

## Task B: `--min-fit <percent>` (let users accept lower fits on purpose)

Some users want Jev even at 50–69%. Build:

1. The `--min-fit <n>` flag, default `70`, allowed range `50–100`. Refuse anything under 50 with a clear message.
2. A change is written when **all** of these hold:
   - the AI said `is_opportunity = true`
   - the scorecard average ≥ n
   - edits were generated

   `REVIEW_DISAGREE` (the sources straddle 50%) is included only with an extra `--include-disagree`, and still only when the average ≥ n.
3. `--include-possible` stays as an alias for `--min-fit 50`.
4. When n < 70, print one clear warning line before applying: "Writing fits from N% (below the recommended 70%). Your tests still run and `jevx undo` restores everything."
5. Edits must be generated for everything that could pass the threshold. Currently only STRONG, or STRONG+POSSIBLE with `editPossible`. Generalise `editPossible` to a `minFit` number in `PipelineOptions`.
6. `--dry-run --min-fit 55` previews exactly what would be written.
7. Each card shows its outcome against the threshold ("→ changed (fit 62% ≥ your 55%)"). Supabase rows record the `min_fit` used, so a new column goes in the v2 SQL.
8. Tests in `tests/jevx-cli.test.ts`:
   - 49 is refused.
   - 50 writes the POSSIBLE demo fit.
   - The default 70 doesn't write it.
   - `--include-disagree` behaves as described.

## Task C: make the MCP path (Claude Code / Cursor) match the CLI

1. The `GUIDE` in `packages/engine/src/guide.ts` still says "Most decision-looking code is ordinary exact logic. Rejecting candidates is a correct answer." That over-strictness already caused 0 results in the CLI.
   - Rewrite its first section in the same balanced way as `READ_SYSTEM` / `ASSESS_SYSTEM`.
   - Add the concrete patterns: catch-block error text, free-text lookups with a default, top-N of external results, keyword intent routers.
   - Keep the exact-logic list: money, payments, state machines, auth, format validation, parsing, UI.
2. Add to the guide and the `find-jev-opportunities` prompt: "If the user states a minimum fit (e.g. 'use Jev where fit ≥ 55%'), change every fit at or above it, never below 50%. Otherwise change STRONG fits only."
3. The `jevx_scan` tool should tell the editor's AI to read the source files itself (logic folders first), not only the static candidates.
4. Add a `jevx_share` MCP tool (opt-in, same privacy rules as `share.ts`) so MCP runs can feed the dataset too.
5. Update `tests/mcp.test.ts`.

## Task D: make it ready for `npx jevx` (npm release 0.4.0)

`jevx` is **free on npm** (checked: 404). Prepare, but **do not publish**. I run `npm publish` myself.

1. `apps/jevx/package.json` needs:
   - `name: "jevx"`, `version: "0.4.0"`
   - `description`, `keywords`, `license` (ask me: MIT?)
   - `repository`, `homepage`, `bugs` (ask me for the URL)
   - `engines: { node: ">=20" }`
   - `bin: { jevx: "dist/index.js" }`
   - `files: ["dist", "README.md", "LICENSE"]`
   - Keep `@jevx/*` bundled (devDependencies + tsup `noExternal`), and runtime deps only for what stays external.
2. Add `LICENSE` and a `CHANGELOG.md` entry.
3. Add `scripts/release-check.sh`, which:
   - builds and packs
   - installs the tarball into a clean temp prefix
   - runs `jevx --version`, `jevx --help`, and `jevx --dry-run` on `examples/jev-demo` against the mock xAI and mock TypeSafe
   - runs `jevx mcp` (MCP handshake)
   - greps the bundle for key-like strings: it must find none except the scrubber regexes
   - confirms the tarball has no `.env`, `.jevx`, tests or source maps with absolute paths
4. Make the README user-first: install (`npm i -g jevx` or `npx jevx`), 60-second quickstart, what gets sent to the AI, what is stored (and what is never stored), cost, `--min-fit`, `--share`, `jevx undo`, and the MCP setup.
5. Write `docs/RELEASE.md` with the exact commands I run to publish, and how to publish a fix (`0.4.1`).

## Task E: verify on real repos (I run these; you prepare them)

- Write `docs/BENCHMARK.md` with the GlobalCare expectations:
  - checkout wallet-error classifier found, ≥ 60% fit
  - countryImage and the airport-code fallback found as low/disagree
  - flights/hotels, refund, escrow, payments and journey-status never changed

  Add a template for 2 more repos.
- Add `jevx --report-json <file>`, which writes the full result (spots, scorecards, outcomes; local only) so runs can be compared.

## Order and reporting

Do A → B → C → D → E. After each task, show me:

1. what changed, in plain English
2. files touched
3. test count
4. anything I must run myself (SQL in Supabase, commands)

Ask me only when blocked on a real decision: the license, the repository URL, and whether `why_generic` can be shared.
