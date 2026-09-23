# JevX — Journal

> History log, newest first. Entries describe what was true **at the time**. For the current direction see [docs/CURRENT-ARCHITECTURE.md](docs/CURRENT-ARCHITECTURE.md).

> Everything done, added, changed, or removed — newest first. Updated after every change.
> The forward-looking plan lives in [PLAN.md](./PLAN.md).

---

## 2026-09-23 — Session 29: the AI reads the code itself; Supabase dataset

- **Why:** `jevx --dry-run` on GlobalCare found 0. The survey call (24k overview + 60 candidates) timed out and
  the fallback took the first 12 static candidates in file order, mostly UI. Reading the repo by hand found 4
  real spots jevx never looked at: `app/checkout/page.tsx:239` (wallet errors classified by regex → Choice),
  `app/api/flights/route.ts:81` and `app/api/hotels/route.ts:88` (`.slice(0, n)` of search results → Score),
  `lib/countryImages.ts:35` (exact-key lookup of AI text with a default → Choice). Refund/escrow maths, the journey
  status ranking and payments were rightly left alone.
- **Decision (Sameer):** xAI is the brain for now. It reads everything, finds the spots, TypeSafe gives the
  final opinion, the code changes. Outcomes go to Supabase so jevx can be trained later.
- **Built:**
  - `packages/engine/src/read.ts` plans the read: skips tests/d.ts/ui kits/configs; api/lib first, UI last;
    line-numbered; ~80k-char parts; budget share 50% with honest coverage.
  - `READ_SCHEMA`/`buildReadPrompt`/`parseRead` (prompt version r2). Spots must lie inside the lines the part
    showed.
  - The pipeline assesses the exact lines, not the whole component, with the reader's note as a hint.
  - `rankStatic` is the fallback: text-match/selector/scorer and api/lib first.
  - `share.ts`: opt-in `--share`/`JEVX_SHARE=1`. Rows carry no code, paths or names; the repo is a random id;
    `jevx undo` posts "undone". https + *.supabase.co only.
  - `supabase/jevx-dataset.sql`: tables, insert-only RLS for anon, the `jevx_training` view with labels.
  - `apps/jevx/src/env.ts`: `JEVX_ENV_FILE` or `~/.jevx/.env`; the shell always wins. `.env` is git-ignored;
    `.env.example` is added.
  - Consent scope bumped. Version 0.3.0.
- **Tests:** 214 passing (+13: the read planner, parseRead, rankStatic, the env loader, share privacy/target,
  CLI fallback, CLI `--share` against a mock Supabase including undo).

- **First real run of 0.3 on GlobalCare: still 0 spots.** Two causes, both ours:
  1. `runAdaptive` used its generic 30 s default because the pipeline never passed a timeout, which beat
     xAI's 300 s. It also caused the Session 28 "survey timed out". Now `DEFAULT_CALL_TIMEOUT_MS = 240_000`.
  2. The read prompt reused the guide's "rejecting is a correct answer" plus "precision over recall", so Grok
     reasoned its way to empty lists (~1k output tokens per part, all reasoning). The read is now explicitly
     recall-oriented (the second step filters) with concrete patterns (catch-block error text, `.slice(0, n)`
     of API results, free-text lookups with a default). Prompt version r3.
  - Also: `matchFile` accepts paths written slightly differently; line numbers can be strings; each part's raw
    answer goes to `.jevx/debug/read-part-N.json`; progress shows kept/unusable; `.jevx/.gitignore` = `*`.
    217 tests.

- **Second real run (r3):** the read worked. The reader's top 4 were exactly the hand-found spots (countryImage
  0.85, checkout errors 0.85, flights 0.80, hotels 0.72). The assess step rejected all 12, because its system
  prompt still carried the guide's "exact lookups are NOT", "most flagged code is exact logic" and "rejecting is
  correct". Assess (r4) is now balanced: an added network call is not a reason to reject; cosmetic spots get a
  low score instead of a no; exact categories are listed explicitly. Spots under reader confidence 0.5 are
  skipped (saves ~4 calls). Every assessment goes to `.jevx/debug/assess-*.json`. The no-result box lists why
  each spot was left alone. The header always says where the keys came from (the env file wasn't loaded
  because JEVX_ENV_FILE wasn't set in that shell).

- **Third real run (r4) on GlobalCare:** every piece worked (xAI read, TypeSafe connected, patterns, 8 rows
  shared). Checkout wallet errors scored 68% POSSIBLE (AI 61 / TypeSafe 76 / patterns 69), just under STRONG.
  countryImage 49% and the airport-code fallback 45% were flagged as sources disagreeing. Flights and hotels
  were rejected fairly: "no patient fields; truncating Google's already-ranked list". $0.86, 390 s; 62k of the
  tokens were output, mostly reasoning.
- **Built after it:**
  - `--dry-run` now also writes and previews changes for POSSIBLE fits.
  - `--include-possible` applies them. Fixed a real bug: `applyOpportunities` silently dropped anything that
    wasn't STRONG.
  - The summary names the closest fit when nothing is STRONG.
  - `--fast` sends `reasoning.effort=low` for the read step only. The xAI transport retries without it and
    stops sending it if the model rejects it with a 400. OpenRouter passes `reasoning.effort`.
  - 221 tests.

## 2026-09-22 — Session 28: `jevx` — one command, no human in the loop

- **Sameer's call:** no picking and no accepting. Vibe coders don't know where Jev belongs, so asking them is pointless; JevX should just make the changes and let VS Code / Cursor show them in red/green. Minimal commands.
- **`packages/engine`** (new, shared by both interfaces): the MCP modules moved here (workspace, scorecard + profile, TypeSafe check, proposals/report, guide) plus:
  - `prompts.ts`: three bounded AI steps with strict schemas and lenient parsers: **survey** (which static candidates matter + up to 5 the static list missed), **assess** (adaptive repo context via `RepoIndex`: is it a real Jev decision? proposal + 8 feature levels + AI score), **edit** (exact search/replace edits, callers included, old rule kept as fallback).
  - `pipeline.ts`: index → survey → assess (3 in parallel) → scorecard → edit for STRONG fits only; token budget checked before every call; one retry of the edit with the reason it didn't apply.
  - `apply.ts`: skips files with the user's uncommitted edits (git status), backs up originals to `.jevx/backup/<run>/`, writes, adds `@typesafe-ai/sdk` (+ install with the project's package manager), runs the project's checks (test script, `tsc --noEmit`) before and after; if a check that passed before now fails, re-applies the changes one at a time and keeps only those that pass. `undoLast()`.
- **`apps/jevx`** (was `apps/mcp`; package `jevx`, bin `jevx`): `jevx` (run), `--dry-run`, `undo`, `mcp` (serve), `mcp install` (Claude Code user scope + `~/.cursor/mcp.json`). Terminal UI in #c15f3c: boxed scorecards (why → AI / TypeSafe / Patterns bars → JEV FIT → outcome), red/green diffs, result box.
- **AI safety (the "bring your own AI" risk):** user's own key only (xAI or OpenRouter), never a key in the package; one-time consent per provider saved in `~/.jevx/consent.json` (`--yes` for scripts); a custom `XAI_BASE_URL` / `OPENROUTER_BASE_URL` is refused unless `JEVX_ALLOW_CUSTOM_BASE_URL=1`.
- **MCP path matches:** the guide now tells the editor's AI to change STRONG fits directly (callers included), run the tests, revert what breaks, and summarise, without asking the user to pick.
- **Research CLI renamed `jevx-lab`** (apps/cli, bin `jevx-lab`); unchanged otherwise, all its tests pass.
- **Verified:** `tests/jevx-cli.test.ts` (6) runs the real CLI on the demo repo against mock xAI (`tests/mock-engine.ts`) + mock TypeSafe: routeTicket changed with its caller in inbox.ts now awaiting it; priorityOf written, broke the project's test, reverted automatically; pricing never touched; undo restores everything; dry-run writes nothing; no key → clear message; custom base URL refused; consent required. Also packed `jevx-0.2.0.tgz` (62 KB), installed it globally into a clean prefix, and ran it on a fresh demo copy, including a real `npm install` of the SDK. **201 tests**; typecheck, lint, build clean.

---

## 2026-09-22 — Session 27: pivot to an MCP server — `jevx-mcp` built (day 1 of 3)

- **Why:** Jev is used in too many different ways (games, gateways, agents, review, moderation…) for learned patterns to decide where it belongs in an unfamiliar repo. The user's own AI has to read the code. And Sameer has no token budget to give users, so the AI has to be *theirs*: an MCP server does exactly that.
- **New `apps/mcp` (`jevx-mcp`, stdio, bundles to one 136 KB file):**
  - `jevx_guide`: Jev-specific instructions: what is and isn't an opportunity, the workflow, how to write the change (keep the old rule as the fallback, keep the signature, small state), SDK example, the scorecard inputs. Also served as the prompt `find-jev-opportunities`.
  - `jevx_scan`: static candidates with ids + existing Jev usage (analyzer + finder, local).
  - `jevx_read` / `jevx_related` / `jevx_search`: on-demand code over the existing `RepoIndex` (repo overview, files, outlines, folders, functions, callers, callees, types, constants). Secrets scrubbed; credential files never offered.
  - `jevx_scorecard`: **patterns** (the proposal's 8 feature levels vs the Layer-E learned profile: nearer the Jev side or the exact-code side, per feature) + **AI** (the host AI's 0–1) + **TypeSafe** (Jev's judgment / bounded / "exact code still right" via the existing `buildDecisionQuestions`, the user's key, cached) → average. When the sources split across 50% the verdict is `REVIEW_DISAGREE`, not an average. Missing sources are named.
  - `jevx_preview_change`: red/green unified diff of the proposed replacement (+ optional imports). **Writes nothing to source.**
  - `jevx_report`: `.jevx/report.html`, every scorecard with its colored diff, light/dark.
  - The server reloads the index when any file changes, so the AI never reads stale code.
- **`apps/mcp/src/profile.json`**: exported by `scripts/export-profile.ts` from `dataset/boundary/patterns.json` (7 Jev sites, 4 deterministic decisions, 6 projects). The first time Layer E feeds the product, as one of three inputs.
- **`examples/jev-demo`**: a BEFORE helpdesk (keyword ticket router, regex urgency, exact pricing/SLA). Static analysis alone flags the pricing function too, so it doubles as a "must say no" case.
- **`scripts/mcp-demo.ts [--mock-typesafe]`**: the whole flow scripted. Result: routing 88% STRONG, priority 85% STRONG, pricing 14% WEAK.
- **Bug caught in my own demo:** the mock marker first landed on the SLA function instead of pricing (`.replace` hit the first "must stay exact"), which made pricing look like a TypeSafe "fit". Fixed with `replaceAll`; worth remembering that the offline mock says yes to everything unmarked.
- **Tests:** `tests/mcp.test.ts` (10): a real MCP client over stdio against the demo and the mock TypeSafe API: tools and prompt listed, navigation, scorecard maths and caching, disagreement → REVIEW, preview changes nothing, report rows, bad line ranges rejected. **195 passing**; typecheck, lint, build clean.
- **Docs:** CURRENT-ARCHITECTURE §0 (the pivot, supersedes §1–14 where they conflict), CLAUDE.md, `apps/mcp/README.md` (setup for Claude Code, Cursor, VS Code).

---

## 2026-09-21 — Session 26: layer E rebuilt — count first, ask a model second

- **The pilot ran** (Session 25, Sameer's terminal): 10 Jev sites analyzed across 8 projects, 21 contrasts, 5 sites lost to timeouts, 482k tokens, **$1.68** calculated. Then `boundary-patterns` timed out and produced nothing.
- **Why it timed out, measured not guessed:** the request was *small* — 19 records, ~4,800 prompt tokens. It was the **answer** that was unbounded (a whole pattern list, plus rejected explanations and open questions, with thousands of reasoning tokens) inside a 120-second window. Same cause as the 5 site timeouts.
- **New `packages/boundary/src/aggregate.ts` — step 1, deterministic, no API:** 21 evidence groups from the stored C and D records.
  - per feature: the level distribution on the Jev side and on the real-decision contrasts, the most frequent level on each, and every record that carries the other side's level as a named counter-example
  - per why-Jev hypothesis: supported / contradicted counts — and a standing note that these were **never assessed on the deterministic side**, so they describe Jev sites and separate nothing
  - decision nature on both sides, plus contrasts said to *share* the Jev site's traits
  - not-reasons → **rejected explanations** (large function, many branches, complex code, slow: contradicted 7/7)
  - `strength` from spread (records, projects), `confidence` from projects with one step down for any contradiction and `low` whenever a side was never measured. Still no weight, score or threshold anywhere.
- **Step 2 — optional synthesis in bounded batches:** default 4 groups per call, ≤8 calls, **one statement per group**, own prompt version `e1` (so cached C and D answers stay valid). The model gets counts and ids and may only *word* a group or reject it; it never supplies a count, an id, a project or a counter-example, and a group it invents is dropped. A failed batch loses only its own wording. `--offline` skips step 2 and still writes everything.
- **Outputs:** `dataset/boundary/patterns.json` (dataset), `dataset/boundary/PATTERNS.md` (605 lines; every claim carries its records, projects, counter-examples, confidence and unknowns), one line per run appended to `patterns.jsonl`. `BoundaryStore.check()` now covers layer E.
- **What the real records show** (offline run over the pilot, TEST projects excluded — 7 usages, 4 real-decision contrasts, 6 projects): all 7 Jev sites are `semantic_ambiguity=high`, `judgment_required=high`, `deterministic_expressibility=low/medium`, against `none` / `high` on the deterministic side. One contrast, `jev-firehose/src/jev.ts:123 heuristicJudgment`, contradicts **8 of the 21 groups by itself** — flagged by name rather than quietly lowering every confidence.
- **Honest gaps the aggregation surfaced:** 8 of 12 contrasts were judged *not decisions at all*, 4 of 7 Jev sites ended with no real comparison, and 8 of the 12 why-Jev hypotheses were "supported" at every single site — a judgment that never varies may be the analyst's prior rather than the code.
- **xAI default timeout 120s → 300s**, with the pilot's evidence in the comment. Still overridable by `XAI_TIMEOUT_MS` / config.
- **Tests:** new `tests/patterns.test.ts` (26) covering aggregation, one-sided evidence, no-separation, contradictions, rejected explanations, non-decision contrasts, uniformity, privacy, the no-data case, batching, batch-failure isolation, the model-supplies-nothing rule, outputs and the CLI; the old one-shot pattern test rewritten. **185 passing**; typecheck, lint, build clean.

---

## 2026-09-20 — Session 25: direct xAI confirmed working; `pnpm corpus` project-list parsing fixed

- **Grok is reachable from Sameer's terminal.** `pnpm dev check --grok` passed: `XAI_API_KEY` set, `grok-4.6` in the model list, smoke test answered "ready", 648 + 254 tokens ≈ $0.002820 labelled *calculated from configured prices*. The direct xAI transport is verified end to end. No pilot call yet.
- **Bug, not a design problem:** `pnpm corpus boundary $P …` failed with `unknown project "jev-guard jev-router …"`. `select()` in `scripts/corpus.ts` treated every non-flag argument as exactly one slug, and a quoted shell variable (`"$P"`) arrives as **one** argument. The trailing `# plan only, sends nothing` comment was also passed through as arguments.
- **Fix (parsing only, nothing redesigned):**
  - non-flag arguments are split on whitespace and commas, so `boundary a b c`, `boundary "$P"` and `boundary $P` are the same list
  - duplicates collapse, so a project is never analyzed (or charged) twice
  - everything from a bare `#` onwards is dropped, for every `corpus` subcommand
  - an unknown slug now names the analyzable projects instead of only failing
- **`pnpm corpus report` before the first run** crashed with `ENOENT … dataset/boundary/PILOT-REPORT.md`; `writeReport()` now creates `dataset/boundary/` and the report says "No stored records yet" instead of pretending to be empty results.
- **Tests:** +4 (quoted list, separate arguments with a duplicate, unknown slug, empty report). **159 passing**; typecheck, lint clean. Synced to `~/Desktop/jevX` with md5 verification.
- **Note:** an earlier `pnpm test` in Sameer's terminal collected only 12 tests because `@jevx/boundary` was not linked yet — `pnpm install` first, then `pnpm test` shows 159.

---

## 2026-09-20 — Session 24: analyst moved to the DIRECT xAI API (Grok 4.6); still no real call

- **Sameer's call:** the M5b analyst is Grok 4.6 through xAI directly, not OpenRouter. Grok is required for this experiment, not optional. The provider abstraction stays.
- **New `packages/gemini/src/xai.ts`:**
  - `POST https://api.x.ai/v1/responses` with `instructions` + `input` and `text.format` = `json_schema` (strict), `temperature: 0`, `store: false`
  - answers read from `output_text` or the message items' `output_text` parts (reasoning items skipped)
  - `XAI_API_KEY` only; missing → "XAI_API_KEY is not set." and **no fallback to another provider**
  - 401/403 and 404 fatal; 429 and 5xx retried by the shared loop; the key is redacted from every message
  - `ping()` checks the model list and sends no code; `xaiSmokeTest()` sends one tiny no-code request
- **Accounting:** `cached_tokens` and `reasoning_tokens` are recorded. xAI reports no price, so cost is **calculated** from `xai.pricePerMInput` / `pricePerMOutput` (default 2 / 6 per million) and labelled `costSource: "calculated"`; OpenRouter's reported cost stays `"provider"`. The report prints which it is, plus cached tokens and the analyst.
- **Defaults:** `jevx boundary` and `boundary-patterns` use xAI; `--code-analyst xai|openrouter|gemini` still selects. Provider + model remain part of every cache key, so OpenRouter answers are never reused as xAI answers (test).
- **`jevx check --grok`:** key present, model available, and one tiny request that proves Grok answers. It never prints the key.
- **Adaptive context, prompts, schemas, parsers, contrast selection, privacy and budgets: unchanged.**
- **Tests:** +14 (`tests/xai.test.ts`, mock xAI Responses API in `tests/mock-xai.ts`); the older boundary CLI test now pins the OpenRouter provider explicitly. **155 passing**; typecheck, lint, build clean.
- **Still no real Grok call:** the xAI API is unreachable from the cloud workspace and from the VM on the Mac, and the key is only in Sameer's shell. The pilot runs there.

---

## 2026-09-20 — Session 23: M5b pilot prepared (the real run needs Sameer's terminal)

- **Task:** run the Grok 4.6 pilot (about 15 sites, 10 projects), evaluate, report, stop. Grok is required for this experiment.
- **Blocker:** neither the cloud workspace (proxy denies openrouter.ai) nor the VM on the Mac (no network) can reach OpenRouter, and `OPENROUTER_API_KEY` exists only in Sameer's shell. No real Grok call has been made yet.
- **Dry-run finding → minimal fix:** a product-code Jev site (jev-experiments `turbo-rerank/server/jev.ts judgeBatch`) was paired with a bench script (`turbo-rerank/bench.ts`) as a contrast. Bench / script / example code is now never a contrast for a product-code site. Regression test added.
- **Added `pnpm corpus report`** (`scripts/boundary-report.ts`). It builds `dataset/boundary/PILOT-REPORT.md` from stored records only:
  - exact counts: usages, contrasts, meaningful contrasts, no-contrast cases, context expansions, uncertain analyses
  - exact tokens and provider-reported cost from runs.jsonl
  - feature-level distributions (Jev sites vs contrasts), why-Jev hypothesis and not-reason tallies
  - the latest patterns, and per-site evidence (observed / inferred / unknown, contrasts)

  No API calls, no scoring.
- 141 tests passing; typecheck, lint and build clean. No architecture or provider change.

---

## 2026-09-20 — Session 22: M5b decisions locked; Jev finder + boundary analyst built (no real API calls yet)

**Decisions locked** (Sameer; CURRENT-ARCHITECTURE §11):

- Grok 4.6 through OpenRouter; no direct xAI integration.
- The finder only finds Jev, in four tiers (definite / likely / wrapper / uncertain). Uncertain is never an anchor, and other AI models are not Jev.
- No strong-candidate formula.
- Contrasts: nearest first, at most 3, never forced.
- Layers A–F kept apart.
- Observed / inferred / unknown kept apart.
- Pilot first, then stop.
- No git.

**Grok's key:** Sameer pasted an xAI key in chat "for reference". It was not used or written anywhere; he was told to revoke it. Grok runs through OpenRouter with `OPENROUTER_API_KEY`.

**Jev finder** (`packages/analyzer/src/jev-usage.ts`, `u1`, deterministic, no AI). Built against the real corpus (`~/jevx-corpus`, read-only). It covers the forms Jev actually takes there:

- SDK builders and `systemOne`, including aliases, namespace imports and `require`; `@typesafeai/sdk`; the AI SDK provider `@ai-sdk/typesafe-ai` + `experimental_evaluate`
- raw fetch to `api.typesafe.ai/v1/systemone` (e.g. jev-guard's `ask()`); OpenRouter and AI-gateway Jev models
- module-level question sets, question factories and projects' own `noul()` helpers, linked through the symbol table, never by name
- frontend `/api/jev` routes, counted only when a server-side proxy calls Jev
- test fakes excluded (tiershift defines a fake `noul()` / `systemOne`)

Wrapper walks stop at the function that defines the questions (the decision); its callers are recorded as callers. Result: **about 40 decision sites in 12 of the 17 TS/JS projects** (about 7 s). commit-miner, jev-ultrafast, quackd and socai have none; pi-jev-router has only plumbing.

**Code-analyst layer:**

- The adaptive-context loop is extracted into `runAdaptive()` (`packages/gemini/src/adaptive.ts`). The candidate analyst uses it unchanged (all 45 analyst tests pass). It adds retry with backoff for 429/5xx/timeouts.
- `ContextProvider.initial()` takes any anchor (file + function), not just a candidate.
- OpenRouter:
  - default model `x-ai/grok-4.6`; timeout 120 s (`OPENROUTER_TIMEOUT_MS`)
  - `usage: {include: true}` gives exact token and cost accounting, including reasoning tokens
  - a 404 (model unavailable) is fatal, so the run stops instead of burning calls

**`packages/boundary`** (new, model-agnostic):

- schema B–E: feature *levels* (no weights), why-Jev hypotheses and not-reasons with assessments, observed / inferred / unknown
- prompts `b1` (strict JSON schemas)
- validation: rejects shallow answers, scrubs secrets
- deterministic contrast selection
- runner: anchors (product code first, twin functions once), "why Jev here?" per anchor, one "why deterministic there?" call per anchor, per-project token budget checked before every call, per-call accounting
- a local cache keyed by site + code + provider:model + prompt
- a store at `dataset/boundary/<slug>/{usages,analyses,contrasts,runs}.jsonl` plus `boundary/patterns.jsonl`. Private projects get facts only; `check()` enforces it. The P1 candidate dataset is never touched.
- pattern derivation (E) from structured records only (no code), excluding TEST projects

**CLI:**

- `jevx jev-usages`, `jevx boundary` (`--dry-run`, `--max-usages`, `--max-contrasts`, `--budget-tokens`, `--model`, `--offline`, `--no-cache`), `jevx boundary-patterns`
- `pnpm corpus usages|boundary` (`--total-budget`, default 400k)
- Wording: no more "ground truth = human labels"; `meta.ts` milestones renamed (patch/apply → M9+); ABOUT rewritten.

**Tests:** +23 (`tests/jev-usage.test.ts`, `tests/boundary.test.ts`), all through mocks, never the real API. **139 passing**; typecheck, lint and build clean.

**Docs:** CURRENT-ARCHITECTURE (problem A vs B; §5–7, §8 storage and D selection, §10–13 updated), CLAUDE.md, PLAN (Now), README, BLUEPRINT, dataset/README.

**Dry-run plan on the real corpus:** jev-guard `assessAction` is paired with `decide` / `judgeInstructions` / hook `main`; jev-router `askJev` with `codexTierOf`; jev-firehose's Jev judge with its own `heuristicJudgment` fallback; 5 of 11 sites get no forced contrast.

**Next:** Sameer runs the pilot in his terminal (his OpenRouter key), then we inspect before scaling.

---

## 2026-09-20 — Session 21: repository normalization (direction change #3), no code changed

- **Why:** the direction has changed three times: v1 text-matching → P1 human-labelled candidates → M5b learning from real Jev usage with Grok 4.6. Old plans were still written as if current, and M4/M5 meant different things in different files.
- **Added `docs/CURRENT-ARCHITECTURE.md`** as the single authoritative description. It covers:
  - what JevX is, the corpus, Jev-call detection, Grok's role, TypeSafe's role
  - data layers A–F, what isn't ground truth, strong candidate (undefined), open decisions
  - M5b, the future milestones, and the deprecated approaches
- **Added `CLAUDE.md`**, which points every new session to it.
- **Marked as historical or partial:**
  - REBOOT-AUDIT.md and docs/BLUEPRINT-v1.md (historical banners)
  - BLUEPRINT.md (now the component reference; its ground-truth and M5b text replaced with pointers)
  - PLAN.md (split into "Now" and "History"; one milestone table)
  - dataset/README, TAXONOMY and INTAKE (banners)
  - README (new description and status)
  - COMMUNITY-NOTES (reference-only line)
- History was kept, not deleted.
- **Correction to Session 20:** its "2+ models agree → silver labels" idea is replaced. Grok 4.6 is the primary analyst, a second model may come later, and no AI output is ground truth.
- The code audit is reported to Sameer; no code changes yet.

---

## 2026-09-20 — Session 20: direction change — learn from real Jev usage (M5b)

- Sameer decided he won't hand-label the 616 candidates: the projects aren't his. The new dataset is anchored on real Jev call sites. Multi-model AI explains "why Jev here / why not there"; silver labels count only when the models agree. BLUEPRINT (layers, ground truth, milestone M5b) and PLAN updated.
- Model status: the free DeepSeek V4 Flash returns 404 "unavailable for free" (the paid slug `deepseek/deepseek-v4-flash-0731` exists). Nemotron 3 Ultra (free) works but has many 60 s timeouts. No code changed this session.

---

## 2026-09-20 — Session 19: OpenRouter as a second code-analyst provider

- **Why:** Sameer's first real Mac run worked end to end (check, fetch, analyze jev-guard, review TUI). But Gemini's free tier returned HTTP 503 and 429 on all 21 candidates. TypeSafe answered all 21.
- **Added OpenRouter next to Gemini, not replacing it.** Only the transport is new: `packages/gemini/src/openrouter.ts`, plain `fetch`, no SDK. It calls `POST https://openrouter.ai/api/v1/chat/completions` with the same system instruction and prompt (g2), and `response_format: json_schema` (strict) using the same `RESPONSE_SCHEMA`.
  - The answer goes through the same `parseGeminiAnalysis`, which validates it and scrubs secrets. Same adaptive context loop, same cache rules, same dataset privacy rules.
- **Model and key:** the default model is `deepseek/deepseek-v4-flash-0731:free` (override with `--openrouter-model` / `OPENROUTER_MODEL` / `openrouter.model`). The key comes from `OPENROUTER_API_KEY` only: it is sent in the Authorization header only and redacted from every error.
- **CLI:**
  - `analyze --openrouter` / `--code-analyst openrouter`. Independent of `--gemini`; both can run in one analysis.
  - `check --openrouter`: GET /key + GET /models; no code is sent.
  - `pnpm corpus analyze` passes the new flags through.
- **Errors:**
  - 429, 5xx, a 200 body carrying an error, a timeout (60 s) or malformed JSON fail only that candidate.
  - 401, 403 or 402 stop further calls.
- **Cache:** a separate file, `.jevx/cache/openrouter.json`. The key includes `openrouter:<model>`. Gemini's cache keys are unchanged.
- **Core types:**
  - Evidence has an optional `provider`.
  - Candidates have `openrouter` / `openrouterError`.
  - `AnalysisResult.openrouter` holds the run summary, using a shared `CodeAnalystSummary` type.
- **Dataset:** evidence goes in an `openrouter` slot next to `gemini`, with the same format. Public entries store the scrubbed analysis and context ids; private entries store facts only. `dataset check` validates both slots, including catching a slot holding the other provider's evidence.
- **Eval:** an informational side-by-side of TypeSafe, Gemini and OpenRouter against the human label, plus how often Gemini and OpenRouter agree. It is not a metric and nothing is tuned on it.
- **Review TUI:** shows both analysts.
- **Tests:** 21 new mocked tests in `tests/openrouter.test.ts` with `tests/mock-openrouter.ts`; the real API is never called. 116 tests pass in total; typecheck, lint and build are clean.
- **Docs:** BLUEPRINT (new OpenRouter section), `dataset/README`, `dataset/INTAKE`.
- **First real OpenRouter runs (Mac):**
  - `deepseek/deepseek-v4-flash-0731:free` returned 404 "unavailable for free" on every call. Switched with `OPENROUTER_MODEL=nvidia/nemotron-3-ultra-550b-a55b:free`; `check --openrouter` passes with it.
  - jev-guard: 12 of 21 candidates analyzed, 9 timed out (60 s). jev-router: 5 of 10 analyzed, 5 timed out. `dataset check` passes (17 projects, 616 entries).
  - Useful early signal: jev-router `codexTierOf` has 4 outcomes but is fixed regex lookup. OpenRouter called it exact logic, not a judgment, and TypeSafe agreed (judgment 0.07). A candidate hard negative, pending a human label.
  - The next step is human labels (jev-guard, jev-router), not more projects. Tune timeouts, retries and concurrency before running the full corpus.

---

## 2026-09-20 — Session 18: M5 intake — Sameer's 30 Jev projects checked and analyzed (offline)

- **Saved the list first:** `dataset/PROJECTS-30.md` (as given) and `dataset/intake.json` (slug, domain, and the check results below).
- **Checked every link** in the cloud workspace; Sameer gave permission to fetch these sites. Each repo was shallow-downloaded to a scratch folder, **not** into jevX. For each one I recorded:
  - pinned commit and date
  - lines of code per language
  - license, read from the LICENSE file
  - whether it depends on `@typesafe-ai/sdk`, and how many files mention Jev
- **Results:**
  - 13 ready (TS/JS), 4 partial, 12 needing another language (10 Python, 2 Rust).
  - 1 blocked: routeKit has no link.
  - 9 have no license. Rule: a project with no open-source license is saved `private`, meaning fingerprint-only.
- **Offline `jevx analyze --save`** on all 17 TS/JS projects (analysis a1):
  - 616 entries; the largest are jev-experiments (185 candidates) and socai (134).
  - Real decisions showed up, e.g. jev-guard `decide` (allow / ask / deny) and jev-router `codexTierOf` (model tier). So did noise (CLI `install`/`main`, UI render helpers); labels will separate the two.
- **Leak check found real shared code** between jkudish/jev-browser and jkudish/jev-mcp (`provider.ts`). The corpus runner now hashes the split from the GitHub owner when an owner has several projects, so both are TEST. After that fix, `dataset check` passes.
  - Resulting splits: TRAIN 13, TEST 4, **DEV 0**.
- **Added `scripts/corpus.ts`** (`pnpm corpus list | fetch | analyze`):
  - Downloads use GitHub tarballs at the pinned commit; no git.
  - It is resumable (a marker file per repo).
  - It runs `analyze --save` with visibility, source, commit, license, domain and group split from the intake, and passes through `--gemini`, `--validate` and the context flags.
- `dataset/INTAKE.md` is regenerated from intake.json.
- **Not done here:** Gemini/TypeSafe runs. The keys live on Sameer's Mac, and the cloud workspace can't download GitHub tarballs (the proxy returns 403), though the Mac VM can. No labels exist yet.

---

## 2026-09-20 — Session 17: adaptive repository context for Gemini (prompt g2)

Sameer: Gemini sometimes can't understand a decision from one function or file; it needs callers, other files, or an overview. The fix: JevX indexes the whole repo, then decides what Gemini needs to see, and expands when Gemini says it isn't enough.

**Added**

- `packages/analyzer/src/repo-index.ts` — `RepoIndex implements ContextProvider`. It's offline and built from the ts-morph project JevX already loaded.
  - Item types: whole file (line-numbered), file outline, function, callees, callers (via `findReferences`), types (interfaces, type aliases, enums, classes), module-level constants, importing files, folder outline, repo overview (package, README head, tree, exports).
  - `initial` / `resolve` / `neighbors` / `search` / `hashOf`.
  - Every item is secret-scrubbed. Paths matching `.env`, secret, credential, private key or password are never indexed.
- `core`:
  - Context types (`ContextKind`, `ContextRef`, `ContextItem`, `ContextProvider`, `ContextMode`, `ContextStop`).
  - `GeminiAnalysis` gains `context_sufficient`, `missing_context`, `context_used`, `understanding_confidence`.
  - `GeminiEvidence` gains `context` (mode, rounds, items, chars, stoppedBy) and `usable`.
- `tests/gemini-context.test.ts` (9 tests). The test repo has a router whose meaning depends on a callee in another file, a type and a caller, plus a `secrets.ts`.

**Changed**

- **Gemini prompt g2.** The system instruction now includes a context protocol. The request carries a header (candidate, structural evidence, included ids, catalog) plus line-numbered context sections.
- **Loop** (`analyzeWithGemini`):
  - It expands with what was asked (exact id → resolvable id → id embedded in the text → "callers" / "repo" keywords → index search). A vague request gets the next tier instead.
  - Neighbours of each added function join the catalog.
  - Anything inside a file already shown whole is skipped.
  - It stops on sufficient, max rounds, budget, or nothing more to add.
- **Cache:** the key adds the context mode, and each entry stores a hash per item. An entry is stale if any item changed; offline mode says "stale".
- **CLI:** `analyze --gemini` builds the index and prints an explicit data-sharing notice describing the adaptive expansion. New flags `--gemini-context`, `--gemini-rounds`, `--gemini-budget`. The output shows a context line (rounds, items, chars, understood, sufficient / ⚠ insufficient) and what Gemini saw.
- **Config:** `gemini.context { mode, maxRounds, maxChars, maxWholeFileChars }`; the init template is updated.
- **Dataset:** facts gain `usable`, `understanding_confidence`, `context_rounds`, `context_items`, `context_chars`. Public entries store `context.items` ids. Private entries store no context ids (the check enforces this).
- **Eval:** the Gemini agreement counts only usable analyses and reports how many were insufficient.
- **Review TUI:** shows the context line.
- **Docs:** BLUEPRINT (principles, CLI, M4 section), `dataset/README`, README, PLAN.

**Verified**

- 95/95 tests pass, and typecheck, lint and build are green.
- The built CLI ran against the mock Gemini on a two-file repo: `route` took 2 rounds and pulled in `tierFor` from the other file, then was sufficient.
- On umami with a fake transport, 40 candidates gave a median prompt of about 12k chars. Index lookups are fast (whole run 2.6 s without the network).

**Limits**

- No real-key run yet.
- Callers come from the TS language service. Dynamic dispatch and framework wiring (routes registered by string, DI) aren't followed; Gemini can still ask for the folder or repo overview.
- Each round resends everything so far, so cost grows with rounds. The budget and max rounds bound it.

---

## 2026-09-20 — Session 16: M4 Gemini code analyst + Blueprint v2

Sameer's M4 brief: Gemini acts as a **code analyst**, not a judge. The hierarchy is AST, then Gemini (explanation), then TypeSafe/Jev (validation), then the JevX policy, then the human (ground truth). Gemini is optional, cached and privacy-safe. No thresholds are hardcoded and nothing is tuned on TEST. I sent the plan first, then implemented.

**Added**

- `packages/gemini` (`@jevx/gemini`), the only package that imports `@google/genai` 2.23.0. The SDK loads lazily, so commands that never use Gemini never load it. It contains:
  - `prompt.ts`: prompt version g1, system instruction, JSON response schema, and the minimal scrubbed input. That input is one function (≤ 60 lines), its decision block, generator evidence, inputs with provenance, and outcomes.
  - `parse.ts`: validates every field of the answer, clips sizes, maps unknown categories to `other`, scrubs secrets, and never throws.
  - `cache.ts`: `.jevx/cache/gemini.json`, keyed by code hash + candidate id + prompt version + model. Only validated answers are stored.
  - `client.ts`: builds the transport. The key comes from `GEMINI_API_KEY` only, and error messages redact it. A bad key (400 API_KEY_INVALID, 401 or 403) stops all further calls. Requests have timeouts and 2 attempts.
  - `analyze.ts`: `analyzeWithGemini` adds `gemini` evidence to unfiltered candidates, or a `geminiError` on failure. It never sets a classification.
- `tests/gemini.test.ts` (15 tests) and `tests/mock-gemini.ts`, a mock REST API driven through the real SDK.
- `dataset/INTAKE.md`, the M5 project queue, pre-filled with 19 unverified GitHub links from the community notes.
- `BLUEPRINT.md` v2 is rewritten for the reboot architecture, role hierarchy and new milestone map. The v1 blueprint moved to `docs/BLUEPRINT-v1.md`.

**Changed**

- **`core`:** new types `GeminiAnalysis`, `GeminiEvidence` and `UNCERTAINTY`; `DecisionCandidate` gains `gemini`/`geminiError` and `AnalysisResult` gains `gemini`. In config, `gemini.apiKey` is gone (the key comes from the environment only) and `gemini.model`, `baseURL`, `timeoutMs` and `concurrency` are added.
- **CLI:** `analyze` gains `--gemini`, `--gemini-model` and `--offline` for both Gemini and TypeSafe. The order is Gemini, then TypeSafe; TypeSafe is not shown Gemini's text. Output is split into AST / Gemini / TypeSafe / JevX policy blocks. Data-sharing notices go to stderr on every run, including with `--json`. `--save` without `--public`/`--private` now fails before any network call.
- **`check`:** gains a Gemini section. The key is never printed, not even masked, and the check pings the model without sending code. `--gemini` makes Gemini required.
- **`init`:** the config template no longer has `gemini.apiKey`.
- **Dataset:** a new `gemini` field with `kind: "model_generated_evidence"`.
  - Public projects store the full analysis, scrubbed.
  - Private projects store facts only (enums, booleans, counts); `validateEntry` rejects private Gemini text.
  - Evidence is kept across re-analysis while the code is unchanged.
  - Eval gets an informational `gemini` block (evidence count and hypothesis agreement).
- **Review TUI:** shows AST, Gemini, Jev and JevX lines separately.

**Verified**

- 86/86 tests pass. Typecheck and lint are clean. tsup build is 217 KB; `@google/genai` stays external and is a CLI dependency.
- The built CLI was run against the mock Gemini, and the review TUI was smoke-tested with Gemini evidence present.
- Tests prove:
  - Gemini cannot change a human label.
  - Gemini evidence is not an eval prediction.
  - Private projects store no Gemini text.
  - Secrets are scrubbed before sending.
  - Timeouts, 500s and bad keys are handled.
  - Cache hits, misses and prompt-version invalidation work.
  - `analyze` works with Gemini disabled, without a key, and when the API fails.

**Not done / limits**

- There has been no real-key run yet; the default model `gemini-3.8-flash` is from Google's current model list.
- The SDK marks `responseMimeType`/`responseJsonSchema` as deprecated in favour of `responseFormat`; they still work, and JevX validates every answer anyway.
- The review queue isn't prioritized yet; ordering by where the evidence sources disagree is an M5/M6 idea.
- pnpm reports "ignored build scripts" for `@google/genai` and `protobufjs`. Both are no-ops or version checks, so nothing needs approving.

---

## 2026-09-20 — Session 15: Phase 1 reboot implemented

Sameer approved the reboot with four decisions (public/private storage, project-level deterministic splits, keep `scan` and add `analyze`, TS/JS only) and asked for the loop Project → Decisions → Labels → Dataset → Evaluation.

**Step 1: legacy suite moved**

- `examples/` moved to `regression/legacy-v1/` (with `mv` on the Mac).
- The harness, tests, `scripts/eval.ts`, eslint/prettier ignores and comments were updated.
- The 34 legacy tests are still green, and `jevx scan` is unchanged.

**Step 2: core vocabulary**

- `packages/core/src/decision.ts` adds labels, primitives, 24 decision categories, 19 hard-negative reasons, generator ids, provenance kinds, `DecisionCandidate`, `AnalysisResult` and `ProjectProfile`. None of it is language-specific.
- `packages/core/src/secrets.ts` adds `scrubSecrets` / `containsSecret`. It catches provider keys, credential assignments, URL passwords, PEM blocks, JWTs and long opaque literals.

**Step 3: `packages/analyzer`** (reuses the old `analyzer` stub; it does not import `@jevx/detector`)

- Every function-like is a decision unit. Nested functions are separate units.
- Facts collected per unit:
  - returns, including ternary leaves
  - literal assignments to returned locals
  - condition shapes: trivial, exact, relational, text method, regex, membership, call
  - arm sets: if-chains, guard chains, switches, ternary chains
  - selector ops, conditional accumulations, weighted terms
- Provenance kinds: parameter, request input, awaited call, caught error, UI event, env/config, constant, instance state.
- Types come from ts-morph, using the analyzed project's own tsconfig `paths`/`baseUrl` so imports resolve.
- Six structural generators: outcome-set, branch-map, selector, scorer, gate, text-match. A test proves they are vocabulary-independent: the same structure with different words gives identical generators and features.
- Deterministic filtering with named reasons: sorting_filtering, trivial_guard (including "only delegated predicate calls"), library_error_text, feature_flag, enum_dispatch (closed types), parsing, file_type, protocol_status, ui_plumbing, arithmetic.
- Representation: inputs, outcomes, suggested primitive with the reason, "stays deterministic" notes, and features.
- Candidates are ordered by how many generators agree, not by a score.
- IDs are stable across edits (file + unit name + ordinal). Code hash and file hash are recorded.

**Step 4: TypeSafe decision questions** (`packages/typesafe/src/decision.ts`, opt-in with `--validate`)

- Questions: `judgment`, `bounded`, `deterministic_is_correct`, `primitive`, `category`. Prompt version is d1.
- State sent: unit code (≤ 60 lines) and boundary (≤ 40 lines), both secret-scrubbed, plus a structural summary and the relative path. Filtered candidates are never sent.
- Policy `p0-uncalibrated` lives in code and can be replayed.
- The cache is `.jevx/cache/decisions.json`. `--offline` replays from it. An auth failure stops all further calls.

**Step 5: `packages/dataset`**

- Schema v1 with `project.json` and `entries.jsonl`.
- Private entries hold no code, no outcome literals and no generator evidence, and input names only when they are plain identifiers. Writes that would break this are refused.
- Splits are assigned deterministically: sha256(fingerprint + seed) against the 60/20/20 ratios. A manual split is also possible. A project never moves between splits, and its visibility never flips silently.
- Upsert keeps human labels. Changed code sets `needsRecheck`; units that disappeared become `stale`.
- `labelEntry` and `addMissed` record missed decisions, which gives recall a denominator.
- Checks cover schema, privacy, secrets, duplicate ids, and cross-split leakage from identical code.
- Metrics per split and per project: precision, recall, FPR, exact agreement, triage agreement, coverage, label/category/hard-negative counts. Evaluation can be rotated with `--rotate <seed>`.

**Step 6: CLI**

- New commands: `jevx analyze`, `review` (Ink TUI), `label`, `eval`, `dataset list|check|missed`.
- `meta.ts` lists them as P1, and ABOUT and the descriptions were rewritten for the new definition.
- The welcome menu now offers Analyze first.

**Step 7: verification**

- 71/71 tests pass (37 new): analyzer 17, dataset 10, decision validation 4, analyze CLI e2e 6, legacy 34.
- Typecheck, lint and the tsup build are all green.
- The review TUI was smoke-tested in a pseudo-terminal, and a label was saved from it.
- Real repos (cloud only, not saved to the dataset):

  | Repo | Files | Candidates | Filtered |
  | --- | --- | --- | --- |
  | umami | 1,050 | 158 | 104 |
  | chatbot-ui | 253 | 28 | 9 |

- Structural bugs found on those real repos and fixed:
  - concise arrows that return arrows
  - `find`/`map[key]` lookups wrongly treated as selection
  - keyboard events wrongly treated as text
  - nested-ternary detection
  - tsconfig path aliases not resolved, so closed types were missed
  - regex constants not recognised as constant

**Docs:** `dataset/README.md`, `dataset/TAXONOMY.md` (generated from core), `dataset/dataset.json`, a README rewrite, and the PLAN update.

**Preserved:** `jevx scan`/`inspect`/`explain`/`check`/`init`, the legacy detector, the M3 validation, `pnpm eval`/`--replay`, and all 34 legacy tests.

**Sameer must run:** `pnpm install` (new workspace packages), then `pnpm test`. No git was used.

---

## 2026-09-19 — Session 14: reboot audit (no code changed)

- Sameer's pivot: the text-matching definition is wrong. JevX should find semantic decision boundaries, backed by a real-project labelled dataset and project-level evaluation.
- Wrote `REBOOT-AUDIT.md`, covering:
  - A: current architecture
  - B: reusable parts
  - C: what to rewrite
  - D: what was wrong
  - E: new pipeline and v4 questions
  - F: dataset schema
  - G: candidate schema
  - H: taxonomy and hard negatives
  - I: evaluation
  - J: Phase 1 plan
  - Open decisions
- Updated PLAN.md: reboot pending approval; M4/M5 frozen.
- The two pasted markdown attachments weren't received (not in uploads or the folder), so they aren't reflected yet.
- Nothing implemented. Waiting on Sameer's approval.

---

## 2026-09-19 — Session 13: community notes saved

- Added `COMMUNITY-NOTES.md`, a reference-only digest of the Jev Discord thread Sameer pasted (2026-09-19, ~2:57–5:36 AM).
  - It covers takeaways relevant to JevX (Jev as decider not writer, deterministic-first plus Jev-for-judgement, cost/speed claims, Score-level pattern, pushback, OpenRouter availability).
  - It lists every project and link by category.
- It isn't part of the plan and no code changed.
- Later the same session: appended **Part 2** (Discord ~3:19–7:37 PM).
  - Takeaways: Jev-as-grep / jev-commit (closest prior art), the Seems language (rewrite inspiration for M4), FlyingDutchGeek's calibration lessons (confidence bands from your own traffic, the 255-option Choice limit, non-determinism near ties), orthogonal-Choice design advice, and the OpenRouter key request.
  - Plus a categorized project list, with a warning not to install the unsigned Bulls&Bears ZIP.
- Appended **Part 3** (the previous day, ~9:56 AM–12:25 PM).
  - Takeaways: Jev on OpenRouter ($0.042 per million input tokens, 32K context), production numbers (Swamp 91% cheaper alert triage; Solar 10× faster / 70% cheaper), a token-cost warning for per-line scoring, and computer use with Jev as the action picker.

---

## 2026-09-19 — Session 12: calibration results (prompt v3, current policy), M3 targets met

Sameer's run: `pnpm install` (added the root `ts-morph`), then `pnpm test` 34/34, `eval --validate` (55 calls, 51,497 input tokens), `eval --replay` (0 calls), GlobalCare scan.

**Results**

| view | precision | recall | notes |
| --- | --- | --- | --- |
| AST | 100% | 100% | 19 TP · 36 TN |
| **pipeline** (production) | **100%** | **100%** | what users get |
| **TypeSafe alone** (all 55, probes included) | **95%** | **100%** | 1 FP: `hard-negatives/errors.ts pay()` |
| GlobalCare (53 files) | — | — | 0 candidates, 0 calls |

**What the answers show**
- TypeSafe separates the classes cleanly. 32 of 36 negatives have `semantic` ≤ 0.10 and all but two are `not_semantic` at ≥ 0.78. Positives have `semantic` 0.49–0.89 with a semantic kind.
- `humanText` is back to normal for positives (0.61–0.83) under the v1 wording. Its gate-free role is confirmed: no case depends on it.
- The only ambiguous cases are **caught-error handling**:
  - `pay()` (GlobalCare pattern): semantic 0.64, kind `other_semantic` 0.40 → the TypeSafe-alone FP.
  - `retryable()`: semantic 0.47, `not_semantic` 0.50 → correctly rejected, but only 0.03 below the threshold.
  - In the pipeline both are removed by the AST caught-error rule before reaching TypeSafe. That confirms the layered design: **AST owns provenance, TypeSafe owns meaning.**
- The kind-assist rule is load-bearing for exactly one case: `isGreeting` (semantic 0.49, intent 0.87). With kind-assist off, recall drops to 95%.

**Policy sweep** (from `--replay`)
- `semanticMin` 0.50–0.60 with kind-assist on: pipeline 100/100, TypeSafe 95/100. All identical.
- At 0.40/0.45, TypeSafe precision drops to 90% (`retryable` gets confirmed).
- With kind-assist off, recall drops (0.50 → 95%, 0.60 → 84%).
- **Decision: keep `DEFAULT_POLICY` as is** (semanticMin 0.50, kind-assist on at ≥ 0.8 / semantic ≥ 0.4, `not_semantic` reject at ≥ 0.8, humanText advisory). The 0.50–0.60 plateau means the choice isn't knife-edge. With 55 cases, moving thresholds inside the plateau would be overfitting.

**M3 exit targets (PLAN item 21):** pipeline P/R ≥ 90% ✓ (100/100) · TypeSafe-alone precision measured ✓ (95%) · GlobalCare 0 FPs ✓. No code changed this session.

---

## 2026-09-19 — Session 11: calibration changes (prompt v3 + policy + real precision + replay)

Sameer approved the 7-step order. Steps 1–2 keep what was already there (the AST caught-error fix and `enclosing_function` context). Changes:

**3. `humanText` wording reverted to v1** (`packages/typesafe/src/questions.ts`, `PROMPT_VERSION` v2 → **v3**)
- The `semantic` question and the state (`decision_code` + `enclosing_function`) stay as in v2.
- Only `humanText` goes back to the v1 question and criteria.

**4–5. New decision policy** (`packages/typesafe/src/validate.ts`)
- `DEFAULT_POLICY` + `decide()`:
  - reject if kind = `not_semantic` at ≥ 0.8
  - confirm if `semantic` ≥ 0.5
  - confirm if a semantic kind at ≥ 0.8 with `semantic` ≥ 0.4
  - otherwise reject
- **`humanText` is advisory only**: below 0.3 it adds a note and never rejects.
- Each validation now records `reason` ("semantic 0.62 ≥ 0.50", "kind intent_or_topic (0.84) + semantic 0.43 ≥ 0.40", …) and `advisories`.
- Kind-assisted confirmations are floored at the minimum threshold (50) so they're shown.
- **Cached answers are re-decided with the current policy.** The cache stores raw answers, so changing thresholds never costs API calls.
- `explain` and the inspect view show "decided by" plus any notes.
- `ValidateOptions.offline`: cache only; a miss becomes "not in cache (offline replay)".

**6. Real precision** (`tests/harness.ts`, rewritten)
- `pnpm eval --validate` now sends **every labelled case** to TypeSafe. AST candidates of any score go as they are. Labelled functions the AST never flags go as a **probe**: the whole function as the decision, with the string literals as terms.
- 55 calls once, then cached.
- Three views are reported:
  - **AST**: the detector alone.
  - **pipeline**: production behaviour, where only AST ≥ 50 reaches TypeSafe.
  - **TypeSafe**: the validator alone on all 55 cases, which is the real precision measurement.
- Per-case lines show both verdicts plus sem / hum / kind.

**7. Offline replay** (`scripts/eval.ts`)
- `pnpm eval --replay` rebuilds the report from `.jevx/cache/typesafe.json` with no API calls.
- It also prints a **policy sweep**: `semanticMin` 0.40–0.60 × kind-assist on/off, showing pipeline and TypeSafe-alone P/R for each.

**Tests:** 34/34 (+5 policy tests: humanText advisory, kind assist, `not_semantic` reject, confidence floor, offline re-decide with 0 calls). Typecheck and lint clean. Checked the harness end to end with the mock (55 calls, then 0 on replay).
**Next:** Sameer runs `pnpm eval --validate` (v3 → 55 calls), then `pnpm eval --replay` to read the sweep.

---

## 2026-09-19 — Session 10: why v2 recall fell to 47% (inspection only, no code changed)

**Sameer's run after Session 9:** tests 29/29, AST 100/100 on 55 cases, GlobalCare **0 candidates** ✓. But `eval --validate` (prompt v2) gave **P 100% / R 47%**: 10 of 19 positives rejected.

**Method:** read `.jevx/cache/typesafe.json` on his Mac (holds both v1 and v2 answers) and mapped cache keys to cases with the same code. No API calls.

| case | shape | v1 sem / human | v2 sem / human | v2 kind (conf) | v2 result |
| --- | --- | --- | --- | --- | --- |
| chatbot/handle | if-chain | 0.88 / 0.66 | 0.87 / **0.26** | intent (0.97) | rejected |
| chatbot/isGreeting | function | 0.50 / 0.59 | **0.43** / 0.48 | intent (0.84) | rejected |
| chatbot/parseConfirmation | if-group | 0.67 / 0.59 | 0.72 / **0.05** | yes_no (1.00) | rejected |
| chatbot/wantsHuman | if-chain | 0.89 / 0.72 | 0.88 / 0.42 | intent (1.00) | confirmed |
| m2/classifySupportMessage | if-group | 0.81 / 0.74 | 0.85 / 0.31 | intent (1.00) | confirmed |
| m2/routeCustomerMessage | if-group | 0.87 / 0.72 | 0.88 / 0.39 | intent (1.00) | confirmed |
| moderation/isAbusive | function | 0.61 / 0.61 | 0.66 / 0.35 | moderation (1.00) | confirmed |
| moderation/toxicity | ternary | 0.77 / 0.64 | 0.61 / 0.39 | moderation (1.00) | confirmed |
| moderation/spamScore | if-group | 0.49 / 0.63 | **0.62** / **0.24** | moderation (0.99) | rejected |
| moderation/shouldEscalate | function | 0.81 / 0.71 | 0.83 / **0.26** | moderation (0.44) | rejected |
| support-bot/closestIntent | function | 0.75 / 0.60 | 0.75 / **0.07** | intent (1.00) | rejected |
| support-bot/routeMessage | if-chain | 0.84 / 0.79 | 0.88 / 0.50 | intent (1.00) | confirmed |
| support-bot/reactTo | switch | 0.59 / 0.80 | 0.54 / 0.58 | sentiment (0.99) | confirmed |
| support-bot/classifyFeedback | if-group | 0.55 / 0.83 | 0.70 / **0.20** | intent (0.51) | rejected |
| support-bot/isSpam | function | 0.59 / 0.46 | 0.67 / **0.22** | moderation (1.00) | rejected |
| support-bot/priorityOf | if-chain | 0.89 / 0.79 | 0.89 / **0.26** | urgency (1.00) | rejected |
| ticket-routing/departmentFor | if-chain | 0.87 / 0.76 | 0.84 / 0.35 | intent (0.99) | confirmed |
| ticket-routing/priorityFor | if-group | 0.87 / 0.77 | 0.88 / **0.13** | urgency (1.00) | rejected |
| ticket-routing/isComplaint | function | 0.74 / 0.69 | 0.80 / 0.36 | sentiment (0.93) | confirmed |

**Findings**
1. **`humanText` collapsed across the board**: mean 0.69 in v1 → 0.30 in v2. **9 of 10 rejections** are `humanText` < 0.3 while `semantic` stayed high (0.62–0.89).
2. **The cause is the question wording, not the added context.** The 6 `function`-shaped cases get no `enclosing_function` (their decision already *is* the whole function), so their state barely changed, yet `humanText` fell just as hard (closestIntent 0.60 → 0.07, isSpam 0.46 → 0.22, shouldEscalate 0.71 → 0.26). v2's humanText question added "use enclosing_function to see where that text comes from" and "…or the application itself" to the *false* criteria. In the examples the text arrives as a plain parameter (`message: string`) with no visible origin, so the model can't see a human source and leans "no".
3. **`semantic` held up or improved.** spamScore 0.49 → 0.62 (the context fix worked for it). 18 of 19 are ≥ 0.5; only isGreeting fell (0.50 → 0.43).
4. **`kind` never said `not_semantic`** for any positive (all semantic kinds, mostly ≥ 0.93 confidence).
5. **The rule's weak point is `humanText` as a hard gate.** The job it was added for, catching library/app error text, is now done deterministically in AST (Session 9, fix 16b), which is why GlobalCare shows 0.
6. **Blind spot in the eval:** negatives never reach TypeSafe (AST keeps them under 50), so "TypeSafe precision 100%" is untested. Only positives are ever validated. Calibrating thresholds needs negatives sent too (`--validate-all`).

**Offline replay of alternative rules on these cached v2 answers** (positives only, so recall only):
- `semantic ≥ 0.5` alone → 18/19 (misses isGreeting 0.43)
- `semantic ≥ 0.5`, or a semantic `kind` at ≥ 0.8 with `semantic` ≥ 0.4 → 19/19
- v1 answers with `semantic ≥ 0.5` alone → 18/19 (misses spamScore 0.49)

No code changed. Options are in PLAN.md item 19, awaiting Sameer.

---

## 2026-09-19 — Session 9: three M3 fixes (hard negative, caught-error text, enclosing function)

Sameer approved fixes 16a, 16b and 12a / 16c. Before these changes, his run showed: tests 29/29, `eval --validate` P 100% / R 95% (spamScore rejected at 0.49), and the GlobalCare checkout still confirmed at 78.

**1. Hard-negative example** (`examples/hard-negatives/src/errors.ts` + 3 labels)
- `pay()`: the GlobalCare pattern: `catch (e) { const msg = e instanceof Error ? e.message : "…"; if (/User rejected|…/i.test(msg)) … }`
- `retryable(err: Error)`: `err.message.toLowerCase().includes("network error" | "rate limit" | …)`
- `loadProfile()`: `.catch((error) => { const text = String(error); if (text.includes("connection refused") …) })`
- Before fix 2: `retryable` was flagged at 55, a false positive, and precision dropped to 95%. After: all three are ignored.

**2. Detector: caught-error text is machine text** (`packages/detector/src/text.ts`, `detect.ts`)
- New `isCaughtErrorText()`. It recognises `e.message`/`.stack`/`.reason`/`.shortMessage`/`.details` on a `catch (e)` variable, on the first parameter of a `.catch(err => …)` callback, or on anything whose static type is an `…Error`. It also handles `String(e)`, `e.toString()`, `a ? e.message : "x"`, `??`/`||`/`+`/template combinations, normalization (`.toLowerCase()`), and variables initialized from any of these.
- `TextJudgement.machine`: when set, no match site is created (includes, membership, regex, equality, switch), whatever the variable is called. This overrides the `msg`/`message` name heuristic.
- The GlobalCare checkout page (staged read-only into the cloud workspace, not modified) now produces **0 decisions, even with `--min 0`**. Before, it was AST 65.
- excalidraw, nlp.js and botkit: still 0 flagged.

**3. TypeSafe sees the enclosing function** (`PROMPT_VERSION` v1 → **v2**)
- `Candidate.source`: `decision` (the whole decision, ≤ 40 lines) plus `enclosing` (the enclosing function, windowed to header + ~20 lines before + ~8 after when longer than 60 lines, with inline callbacks climbed to the named function).
- The state is now `{ language, file, function, decision_lines, decision_code, enclosing_function, matched_terms }` (it was `code`).
- The `semantic` and `humanText` questions point at `decision_code` and say "use enclosing_function to see where the text comes from". `humanText`'s "false" criteria now name library/SDK/app error messages.
- spamScore's state now includes `spamScore(post: { body: string })`, `const text = post.body.toLowerCase()`, `let score = 0` and `return score`.
- v2 is part of the cache key, so every candidate gets re-asked once on the next validated run (~19 calls for `eval --validate`).

**Tests:** 29/29 (the validation test now asserts `decision_code`, `enclosing_function` and `decision_lines`; the mock reads the new state). AST eval: **P 100% / R 100%, 55 cases** (TN 36). Typecheck and lint clean.
**Not verified yet:** the real-TypeSafe effect of v2 on spamScore and the other borderline cases. No key here, and the key pasted in chat was not used.

---

## 2026-09-19 — Session 8: GlobalCare candidate traced → false positive (no code changed)

- Sameer granted read access to `~/Desktop/globalcare-ai`. I read `app/checkout/page.tsx` and modified nothing.
- `explain` (after the Session 7 fix) worked: 78 final, AST 65, meaning-based 78%, **human text 66%**, kind `intent_or_topic` (cached).
- **Where `msg` comes from:** line 238, `const msg = e instanceof Error ? e.message : "Payment failed.";`, inside `catch (e)` of `pay()` (lines ~171–250). The `try` block contains:
  - Privy `sendTransaction(...)` → wallet errors ("User rejected the request", "denied", insufficient funds)
  - viem `waitForTransactionReceipt({ timeout: 180_000 })` → "Timed out while waiting for transaction"
  - Supabase inserts/updates and `payOnArc()`
  - The app's own `throw new Error(...)`s ("This journey is already funded…", "Your GlobalCare wallet holds …", "…reverted — payment NOT recorded")
- There's no user-typed text anywhere on that path. Every string matched is written by a library or by the app's own code. The `&& !/GlobalCare wallet holds/.test(msg)` guard on line 243 even matches the app's own error text.
- **Verdict: false positive → hard negative.** It *is* brittle string matching, but the right fix is error codes/types (viem `UserRejectedRequestError` / EIP-1193 code 4001, `WaitForTransactionReceiptTimeoutError`, `InsufficientFundsError`), not a semantic AI call.
- **Why both layers were fooled:**
  - AST: `msg` is on the human-text name list, and the detector doesn't trace that it's `e.message` from a `catch`.
  - TypeSafe: the state contained only the if-chain lines (239–247), not line 238 or the `catch`, so it couldn't see where `msg` came from. This is the same context gap as the `spamScore` miss.
- Awaiting Sameer's go-ahead to add it as a hard-negative example. Proposed generalizable fixes are logged in PLAN.md.

---

## 2026-09-19 — Session 7: first real app (GlobalCare) + `explain` bug fixed

**Sameer's GlobalCare scan** (`~/Desktop/globalcare-ai`, validated with the real TypeSafe API)
- 53 files, 1 candidate, 1/1 confirmed, 0 rejected.
- `app/checkout/page.tsx:239–247`, if-chain: AST 65 → **final 78, `intent_or_topic`**.
- The code: `if (/User rejected|rejected the request|denied/i.test(msg)) … else if (/timed out|timeout/i.test(msg)) … else if (/insufficient|balance|exceeds|funds/i.test(msg)) …`

**Bug:** `pnpm dev explain ~/Desktop/globalcare-ai/app/checkout/page.tsx:239 --plain` → "No text-matching decision found at `../globalcare-ai/app/checkout/page.tsx:239`".
- Cause: without `--cwd`, `explain` used the directory it was run from (the jevX repo) as the project root. It scanned jevX, and the target path resolved to `../globalcare-ai/...`, so it could never match. The detector and the line range (239–247 contains 239) were both fine. This was a CLI root-resolution bug.
- `scan` worked because its path argument *is* the root.

**Fix** (`apps/cli/src/index.tsx`)
- `explain` now infers the project root from the file: the nearest ancestor with `jevx.config.*`, `package.json` or `.git`. `--cwd` still overrides it.
- `explain` analyses only that one file (config include/exclude no longer hide it). That's faster, and it still validates just that one decision.
- Clear errors for a missing file or a file outside `--cwd`. On a miss, it lists the line ranges of the decisions it did find in that file.
- New CLI test reproduces the exact case: a project in another folder, a regex if-chain on `msg`, `explain` run from the JevX repo with no `--cwd`. 29/29 tests pass.

**Open question on the candidate itself** (for Sameer to label, nothing changed):
- The matched text (`msg`) is most likely an error message from a wallet or payment SDK ("User rejected the request" is MetaMask/EIP-1193 wording), i.e. machine-generated, not written by a user.
- TypeSafe confirmed it at 78. It's brittle string matching, but the sturdier fix may be checking error codes (e.g. `err.code === 4001`) rather than a Jev call.
- If he labels it "not a Jev candidate", it becomes the first real-world false positive and a hard-negative example. Worth checking its `humanText` answer via `explain` first.

---

## 2026-09-19 — Session 6: first real TypeSafe run + `spamScore` investigation (no code changed)

**Sameer's real-API run (jev-latest → jev-1.13.0)**
- `pnpm dev check`: key present, API reachable, models `jev-latest` and `jev-preview`.
- `pnpm eval --validate`: **precision 100%, recall 95%** (TP 18, FN 1, FP 0, TN 33). 19 API calls, all cached in `.jevx/cache/typesafe.json` in his repo.
- `pnpm dev scan ~/Downloads/jevx-test`: STRONG case 82 final (AST 95), MEDIUM 73 final (AST 80), both `intent_or_topic`, 1,845 input tokens.
- The single miss: `moderation/src/filter.ts spamScore()`, AST 70 → **rejected**.

**Investigation** (read-only: his cache file, plus the exact request rebuilt with the same code)
- Cache entry `338eb4d5…` matches spamScore's cache key. TypeSafe answered **semantic 0.49**, **humanText 0.63**, **kind moderation_or_safety at 0.99**.
- The rule needs semantic ≥ 0.5, so it was rejected by 0.01, even though TypeSafe was 99% sure the code does moderation (a semantic kind).
- What was sent: only the 4 `if` lines (`if (text.includes("buy now")) score += 2;` …) plus the matched terms. The function signature `spamScore(post: { body: string })`, `const text = post.body.toLowerCase()`, `let score = 0` and `return score` were **not** included. The model couldn't see that `text` is a user's post body, or that the result is a spam score.
- Root cause 1 (context): for `if-group` and `if-chain` candidates, the state carries only the decision lines. Snippets across the 19 validated candidates were 1–15 lines, and 10 of them were 3 lines or fewer.
- Root cause 2 (decision rule): the rule ignores `kind`. The three answers disagreed (kind says semantic at 0.99, semantic says 0.49) and the weakest one decided.
- Root cause 3 (calibration): the semantic question sits close to 0.5 for more than one case. 5 of the 19 were within 0.10 of the threshold: isGreeting 0.50, classifyFeedback 0.55, isSpam 0.59, reactTo 0.59, spamScore 0.49. The "paraphrase should give the same outcome" framing may fit additive scoring and exact-set lookups poorly.
- **No code changed.** Proposed fixes are in PLAN.md under M3, waiting on Sameer's go-ahead.

**Security note:** the TypeSafe API key was pasted into the chat transcript. Sameer should rotate it. It was not written to any file or memory.

---

## 2026-09-19 — Session 5: M3 started (TypeSafe validation)

- Sameer locked M2 and started M3. Scope: the validation layer only, no patch generation.
- **Inspected the SDK**: `@typesafe-ai/sdk` 0.6.0 (published 4 days before this session), read its type declarations and README, and read docs.typesafe.ai (confidence, state, noul, models, jev-1.13 known weaknesses, legal index). Findings are in PLAN.md under "SDK facts".
- Wrote the M3 design and checklist in PLAN.md. Added an open item to read the Master Customer Agreement, since validation sends code snippets to the API.

**M3 implementation (same session)**

*packages/typesafe* (was a placeholder)
- `questions.ts`: `PROMPT_VERSION = "v1"`. `buildQuestions()` asks three atomic questions: `semantic` (noul), `humanText` (noul), `kind` (7-way choice, including `not_semantic`). `buildState()` sends only file, function, language, the decision snippet (≤ 40 lines) and matched terms (≤ 30), never the whole file.
- `cache.ts`: `ValidationCache` at `.jevx/cache/typesafe.json`. Key = sha256(file hash + candidate id + prompt version + model). Atomic tmp + rename writes; a corrupt cache just starts cold; can be disabled.
- `validate.ts`: `validateResult()`: worker pool (default 4), cache lookup, one `systemOne` call per candidate, per-candidate error isolation, stops after an authentication/permission error. `toValidation()` and `applyValidation()` hold the decision rule. Final band comes from confidence; rejected goes to `ignore`.
- `index.ts`: `createClient()` never throws; with no key it returns a reason. Also `hasApiKey()` and `maskKey()`.

*core*
- New types `Validation`, `ValidationSummary` and `SemanticKind`; `Candidate` gained `fileHash`, `terms`, `confidence` and `validation`. `JevxConfig.typesafe` gained `model`, `baseURL`, `concurrency` and `timeoutMs`.
- `summarize()` and `rankOf()` moved here from the detector. Validated candidates rank before unvalidated ones.

*detector*
- Every candidate now carries `fileHash` (sha256 of the file) and `terms` (matched vocabulary), for the cache and the validation state.

*CLI*
- `scan.ts`: `runScan(cfg, flags, onProgress)` validates by default through `validateDetected()`. Also `isValidated()`, a footer per run (confirmed / rejected / failed / API calls / cached / tokens), `candidateJson()` with final/preliminary scores, and `rejected[]` in JSON.
- New flags: `--no-cache`. `--no-validate` and `--validate-all` are now real.
- `explain` validates only the decision it was asked about (one call at most, even below 50) and prints the TypeSafe verdict.
- New `commands/check.ts`: `jevx check`.
- `meta.ts`: `SHIPPED = {M1, M3}`, `BUILD` string, updated `--about`. Stub commands name the current build.
- The `init` template now includes `typesafe.model`, `typesafe.concurrency` and a data-sharing comment, and says "Next: jevx check".

*terminal-ui*
- A "Validating with TypeSafe… n/m" progress phase. Rows show final confidence plus "AST n". The header says whether scores are validated. Inspect gains a score line and a "TypeSafe says" block (meaning-based %, human-text %, kind, model, cached). The notice is now computed from the result.

*Tests* (28 total, all passing)
- `tests/mock-typesafe.ts`: mock API with marker-driven verdicts (`MOCK_REJECT`, `MOCK_FAIL`, key `bad-key` → 401), used both as a `fetch` and as an HTTP server.
- `tests/validation.test.ts` (8): final confidence, rejection hides a candidate, only the 50+ band is sent, request shape (no key in body, small state), cache hit / file-edit invalidation / disabled cache, error isolation, stop after 401, cache-key composition.
- `tests/cli.test.ts` (12, rewritten): the key is blanked by default so a real key is never used. No-key fallback, check without a key, and against the mock server: validated JSON, second scan fully cached, `--no-validate` makes 0 calls, plain labels, `explain` makes 1 call, `check` passes, bad key stops early.
- `tests/harness.ts` and `scripts/eval.ts`: `pnpm eval --validate` scores the examples on final confidence. Checked with the mock: 19 calls, 100/100.

*Verified*
- typecheck, lint, 28/28 tests, build, the interactive TTY flow (list → inspect with the TypeSafe block), and `check` against the mock server.
- **Not yet verified against the real TypeSafe API.** There's no key in this environment.

---

## 2026-09-19 — Session 4: Sameer's own verification on Mac

**Sameer ran (Node 23.11, pnpm 10.34.5 via corepack):**
- `pnpm install` from a clean checkout: OK (1m49s).
- `pnpm test`: 12/12 pass, precision 100% / recall 100% on the examples.
- `pnpm dev scan ~/Downloads/jevx-test --plain` on his synthetic file `jevx-m2-test.ts`, outside the repo:
  - `getFileType` (GOOD, file extensions): not flagged ✓
  - `classifySupportMessage` (MEDIUM): line 27, **80 strong**
  - `routeCustomerMessage` (STRONG): line 55, **95 very strong**
- Verdict: works as designed. Detector unchanged.

**Added**
- `examples/m2-test-file/`: that same file plus `expected.json` (GOOD negative, MEDIUM positive, STRONG positive at ≥ strong), so it stays in the regression suite. Now 6 repos, 52 cases, still 100% / 100%.

**Observed, not changed**
- MEDIUM scores 80 (strong) rather than "possible". The AST can't tell an intentional small rule set from a brittle one; that call belongs to TypeSafe in M3.
- `textBranches` doesn't fire on `classifySupportMessage`: two sibling `if`s plus a trailing `return "other"` count as 2 branches, not 3. It's a candidate tweak (treat a trailing return as the else branch) if real code shows it matters.
- There's still no `pnpm jevx` script alias. Use `pnpm dev scan <path>` or the built `node apps/cli/dist/index.js`.

---

## 2026-09-19 — Session 3 (cont.): M2 started

**Step 1: more labelled examples** (M2 item 2)
- `examples/moderation/`: 4 positives (abuse word list, toxicity regex, spam scoring, legal-threat escalation) and 4 negatives (HTML escaping, markdown rendering, truncate, word count).
- `examples/ticket-routing/`: 3 positives (department keyword map, priority keywords, complaint regex) and 6 negatives (status enum switch, API route prefix, content type, MIME, log levels, NODE_ENV).
- `examples/chatbot/`: 4 positives (the blueprint's headline `message.includes("refund")`, a greeting Set, yes/no parsing, "talk to a human") and 3 negatives (slash commands, command switch, @mention).
- `examples/hard-negatives/`: 11 negatives (Mermaid-style lexer, diagram-direction codes, SQL highlighter, boolean flag parsing, month names, key handling, user-agent sniffing, unit switch, i18n lookup, feature flags, CSS class).
- `support-bot`: labelled `priorityOf` (urgency regex) as a positive. It was being flagged without a label.

**Step 2: measurement** (M2 item 5)
- `tests/harness.ts`: evaluates every `examples/*/expected.json`, reports TP/FN/FP/TN, precision, recall, and how often each signal fires on positives vs negatives. Anything flagged without a label counts as a false positive.
- `scripts/eval.ts` plus `pnpm eval`: prints the report.
- `tests/regression.test.ts` rewritten on top of the harness. It requires every case to pass, nothing unlabelled to be flagged, and precision and recall both ≥ 90% (the M2 bar).
- tsconfig now includes `scripts/`.

**Baseline before tuning** (47 labelled cases): **precision 82%, recall 60%** (TP 9, FN 6, FP 2, TN 30).
- Missed: `handle` 40 (single includes), `isGreeting` (Set `.has` isn't detected), `parseConfirmation` 45 (equality chain), `wantsHuman` 35, `shouldEscalate` 35 (3 inline terms, below the list minimum of 4), `departmentFor` 35 (the keyword map sits outside the if-condition, so it isn't seen).
- False positive: `tokenize` 55 (lexer).
- `fuzzyMatch` never fires in the new examples. Only support-bot has fuzzy code, and it isn't labelled.

**Step 3: detector fixes** (M2 items 3, 6)
- `.has()` on a word Set/Map with human-text input now counts as membership (and as `stringIncludes`): `GREETINGS.has(text)`.
- Membership (`LIST.includes(text)`) with human-text input also fires `stringIncludes`.
- Equality chains (`a === "yes" || a === "sure" || …`, 3+ distinct words) fire `switchOnText`.
- Inline terms: 3 distinct matched words count as a keyword list (new option `inlineTermsMin: 3`). Declared lists still need 4.
- When a match uses a variable (`words.some(w => text.includes(w))`), the keyword-list search now covers the whole enclosing function, which finds maps iterated in loops (`departmentFor`).
- New penalty signal `codeContext` (−30), in core types, defaults and config (`codeContextNames`). It fires when a function or file name has a code-processing token (tokenize, lexer, highlight, syntax, grammar, ast, compile…) or when ≥50% of matched terms are code keywords (`CODE_WORDS` in `text.ts`).
- `fire()` accepts negative weights. The UI and `explain` show "-30" in red instead of "+-30".
- `regexNaturalWords` ignores structural regexes (URLs, `\/` paths, `.com`/`.org`, HTML tags) and data extraction (`(\d`, `(.+`, `([^`).
- `isWordLike` and `isMultiWord` reject phrases with all-caps code tokens ("graph TD").
- `text.test.ts`: new tests for the DSL phrases and the regex filters.
- Kept the human-text name heuristic. Without it, `browserName` in hard-negatives gets flagged.
- Removed two new excalidraw false positives this step introduced (embed URL regexes and the Mermaid error-line regex).

**Step 4: decisions + weights** (M2 items 1, 4) ⚠️ need your review
- `hardcodedLabels` 15 → 25, so `message.includes("refund")` scores exactly 50 (possible).
- `fuzzyMatch` 10 → 20. Added a positive (`support-bot/closestIntent`) and a new negative (`hard-negatives/src/cli.ts` `suggestCommand`, a did-you-mean over command names).
- The `jevx init` template got the same weights plus `codeContext: -30`.
- **Fix:** `explain` showed "possible" for ignore-band candidates because it ran with min 0. It now keeps the real thresholds.

**Result:** 5 repos, 49 labelled cases → **precision 100%, recall 100%** (TP 17, TN 32). The regression suite enforces it: 12 tests (3 regression, 5 text, 4 CLI). Typecheck and lint are clean.
Real repos: excalidraw 529 files / 0 flagged (~4.4 s), nlp.js 709 / 0, botkit 104 / 0.

---

## 2026-09-19 — Session 3: stack migration (Phase A)

- **Decision:** pnpm workspaces + commander + c12 + chalk + figlet + ink-spinner + ink-select-input + new `packages/core`. No Turborepo. Order locked: migrate → lock stack → M2.
- PLAN.md rewritten: locked-stack table, Phase A checklist, M2 checklist, working rules (no git, M2 = detector only).

**pnpm**
- Added `pnpm-workspace.yaml` (with `onlyBuiltDependencies: [esbuild]`, which pnpm 10 needs for esbuild's postinstall).
- Root `package.json`: `packageManager: pnpm@10.34.5`, removed the `workspaces` field, scripts now use pnpm, internal deps are `workspace:*`.
- Deleted `package-lock.json`.
- Every package now declares its own runtime deps (pnpm is strict about undeclared ones). The CLI declares the external deps of the packages it bundles (ts-morph, fast-glob, ignore, c12, figlet, ink-*), so a published build resolves them.
- Upgraded dev tooling: ESLint 9 → 10 (9 is deprecated), Vitest 3 → 5 (the npm crash doesn't happen under pnpm), execa 9 → 10. Kept TypeScript on 5.9 because typescript-eslint supports only < 6.1.

**packages/core** (new)
- `types.ts`: SignalId, SignalWeights, Thresholds, DetectorOptions, Band, RootKind, FiredSignal, Candidate, DetectionResult.
- `defaults.ts`: SIGNAL_LABELS, default weights, thresholds, human-text names and labels, `defaultDetectorOptions`, `mergeDetectorOptions`, `bandFor`.
- `config.ts`: JevxConfig, `defineConfig`, DEFAULT_INCLUDE and DEFAULT_EXCLUDE.
- `load-config.ts`: c12 loader (rc, dotenv and package.json sources off). It takes `selfModule` so `import { defineConfig } from "jevx"` resolves inside user configs. Also `findConfig` and CONFIG_FILES.
- Removed `packages/detector/src/config.ts` and `apps/cli/src/load-config.ts`; their contents now live in core.

**Detector**
- Types and `bandFor` now come from `@jevx/core`. No logic changed, and scores match M1 exactly.

**terminal-ui**
- Banner uses figlet "ANSI Shadow", with a plain ASCII fallback. The spinner is ink-spinner, and the welcome menu uses ink-select-input.

**CLI**
- `index.tsx` rewritten on commander: `scan`/`inspect [path]`, `explain <file:line>`, `init [path] --force`, and the shared options `--json --plain --no-validate --validate-all --min --fail-on --config --cwd`.
- `--min` and `--fail-on` are validated by commander.
- Commands that aren't built yet are registered, so `--help` lists them with their milestone; running one exits with code 2.
- `apps/cli/src/config.ts` re-exports `defineConfig` from core. The new `self.ts` resolves the `jevx` alias.
- chalk replaces `node:util` styleText in `scan.ts` and `init.ts`.
- **Fix:** piping to `head` crashed with EPIPE. That's now handled and exits cleanly.

**Docs**
- README updated for pnpm and the core package.
- `NOTES-M2.md` merged into the M2 section of PLAN.md, then deleted.

**Verified**
- 19/19 tests pass, typecheck and ESLint are clean, and the build succeeds.
- In the built CLI: `--help`, plain scan, `init` plus a c12-loaded config (changing the threshold to 80 took effect), the stub command exits 2, invalid `--min`/`--fail-on` are rejected, and the welcome menu → scan → inspect flow works in a real TTY.

---

## 2026-09-19 — Session 2: planning files

- Added `PLAN.md` (living plan) and `JOURNAL.md` (this file). Both get updated after every change from now on.
- Reviewed the other chat's stack and scaffold (pnpm, commander, c12, chalk, figlet, `packages/core`, `support-router` fixture). **No code changed.** Differences are logged in PLAN.md as a pending decision.
- Noted working rule: no git operations of any kind; Sameer handles all git.

## 2026-09-19 — Session 1: M1 built

**Context gathered**
- Read BLUEPRINT.md and project memory from the "understanding jevx" chat. `~/Desktop/jevX` was empty.

**Scaffold (npm workspaces)**
- Root: `package.json`, `tsconfig.base.json`, `tsconfig.json`, `vitest.config.ts`, `eslint.config.js`, `.prettierrc`, `.prettierignore`, `.gitignore`, `package-lock.json`.
- Pinned `typescript ~5.9.3` (TS 7 native port is current on npm; avoided for tooling compatibility) and `vitest ^3.2` (vitest 4/5 crashed npm's installer with an `edgesOut` error).
- Workspace packages ship as TS source; `tsup` bundles them into `apps/cli/dist`.

**packages/scanner** — `src/index.ts`
- fast-glob + include/exclude + root `.gitignore`; always ignores node_modules, dist, build, .git, .jevx, `*.d.ts`, `*.min.js`, `*.bundle.js`.
- Skips generated/minified files (>512 KB, lines >2000 chars, or very high average line length).
- Loads files into a ts-morph `Project` (allowJs, JSX preserve).

**packages/detector** — `src/config.ts`, `text.ts`, `detect.ts`, `index.ts`, `text.test.ts`
- Default weights/thresholds exactly as the blueprint; human-text name list; intent-label list.
- Human-text oracle: last camelCase/snake token of a name (`userMessage` → `message`), follows `const x = msg.toLowerCase()`, unwraps toLowerCase/trim/replace/String()/parens/`as`.
- Finds match sites: `.includes/.startsWith/.endsWith/.indexOf`, keyword-list membership, regex `.test/.match/.search` (natural-word regexes only), `===` against word literals, `switch` over text, fuzzy libs (leven, fuse.js, string-similarity…) and fuzzy-named calls.
- Groups sites into decisions: if/else chains, runs of sibling ifs (early-return classifiers), switches, ternaries, functions. Inline callbacks (`.some(w => text.includes(w))`) join the outer decision.
- Scores the 8 signals, clamps 0–100, bands 50/75/90. Evidence recorded per signal. Candidate id = sha1(file + normalized source) for the M3 cache.
- `detect()` and `detectAsync()` (yields so the UI keeps rendering).

**packages/terminal-ui** — `components.tsx`, `scan-screen.tsx`, `welcome-screen.tsx`, `index.ts`
- Banner box + ASCII JEVX logo, spinner, score bars, band colors.
- Scan screen: progress → counts → candidate list (↑/↓, Enter inspect, P show/hide possible band, Q quit); every score labelled preliminary.
- Candidate detail: signals with weights + evidence, numbered code snippet.
- Welcome menu for bare `jevx`.

**apps/cli** (`jevx` package) — `index.tsx`, `config.ts`, `load-config.ts`, `meta.ts`, `commands/scan.ts`, `commands/init.ts`, `tsup.config.ts`
- Commands: `scan`, `inspect`, `explain <file:line>` (signal breakdown), `init`; flags `--json`, `--plain`, `--no-validate`, `--validate-all` (notice only until M3), `--min`, `--fail-on`, `-c/--config`, `--help`, `--commands`, `--about`, `--version`.
- Non-TTY falls back to plain output automatically (CI-safe).
- Unbuilt commands exit 2 and name their milestone.
- `defineConfig` exported from `jevx`; `jevx.config.ts` loaded via jiti with `jevx` aliased.
- `jevx init` writes the blueprint config template and says keys come from env vars.
- Fixed: `--json` output was truncated when piped (switched `process.exit` → `process.exitCode`).

**Placeholders** — `packages/typesafe`, `analyzer`, `patcher`, `validator` (`src/index.ts` exporting their milestone).

**Examples & tests**
- `examples/support-bot/` — router (if-chain), spam (keyword list + regex), sentiment (switch + early-return classifier), fuzzy, and 7 negatives (file extensions, HTTP methods, reducer, URL, CLI flags, roles, email regex); `expected.json` ground truth.
- `tests/regression.test.ts` (runs every `examples/*/expected.json`), `tests/cli.test.ts` (execa), `packages/detector/src/text.test.ts`. **19/19 passing**, typecheck and ESLint clean, build OK.

**Docs**
- `README.md`, copied `BLUEPRINT.md`, `NOTES-M2.md` (detector findings for M2).

**Results**
- support-bot: router 85 (strong); 4 possible; 0 negatives flagged.
- excalidraw (533 files): 1 candidate (a Mermaid lexer, false positive), ~8 s.
- nlp.js (709 files): 0 after skipping minified bundles.

**Git incident (resolved)**
- Ran `git init` in the folder; the sandbox couldn't remove `.git/index.lock`, leaving a broken repo. With your permission, deleted the empty `.git`. No commits were ever made. No git commands from here on.

**Not done / not installed**
- `node_modules` not installed in the folder (tests ran in a Linux sandbox; run `npm install` on the Mac).
- `@typesafe-ai/sdk` and Gemini SDK not installed.
