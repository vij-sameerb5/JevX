# JevX — Plan

> **Current direction: [docs/CURRENT-ARCHITECTURE.md](docs/CURRENT-ARCHITECTURE.md) (authoritative).** This file has two parts. **Now**, which is current, and **History**, which is kept for context and must not be followed. What was done: [JOURNAL.md](./JOURNAL.md).

_Last updated: 2026-09-23 (Session 30: 0.4.0 release candidate — patterns dataset, --min-fit, MCP parity, npm packaging, site)._

# Now

## Milestones (the only current table)

| Status | Milestone |
| --- | --- |
| ✅ DONE | v1 M1–M3: legacy detector + TypeSafe validation (`jevx scan`, regression only) |
| ✅ DONE | P1: analyzer, candidate generators, triage, candidate dataset, privacy, splits, review/eval tooling |
| ✅ DONE | M4: code-analyst layer — Gemini, OpenRouter, adaptive whole-repo context, provider-separated cache |
| ✅ DONE | M5 intake: 30 projects checked; 17 TS/JS fetched (`pnpm corpus`) and analyzed; 616 candidates |
| ✅ DONE | M5b research: real Jev usage → Grok → contrasts → Layer E patterns (frozen as reference) |
| ▶ **CURRENT** | **M6**: `jevx` — one command finds Jev opportunities and changes the code (terminal with the user's key, or Claude Code / Cursor via MCP) |
| FUTURE | M6: apply the boundary to candidates · M7: TypeSafe as a secondary calibrated signal · M8: recommendations (primitive, question, state) · M9+: patch/apply (frozen; the v1 "M4/M5") |

## M6 steps (3-day target)

1. ✅ Day 1 (Session 27): MCP server — tools, scorecard (patterns + AI + TypeSafe), red/green preview, report, demo repo.
2b. ✅ Session 30: 0.4.0 RC. Remaining before publish: Sameer runs v2 SQL, confirms MIT + GitHub URL, runs docs/MCP-TEST.md in real Claude Code on GlobalCare + 1 other repo, fills docs/BENCHMARK.md for 2–3 repos, deploys site/, records GIFs, then `bash scripts/release-check.sh` → `npm publish`.
2a. ✅ Session 29: AI full-read replaces the survey; ranked static fallback; env file; `--share` → Supabase (`supabase/jevx-dataset.sql`). Next: GlobalCare benchmark (find checkout errors + flights ranking, leave refunds alone).
2. ✅ Day 2 (Session 28): `packages/engine` (one engine, two interfaces); autonomous pipeline (survey → assess →
   score → edit, callers included); safe apply (backup, skip the user's uncommitted files, add the SDK, checks
   before/after, automatic revert, `jevx undo`); the `jevx` CLI in #c15f3c; `jevx mcp install`; MCP guide now
   changes STRONG fits directly too. Installable `jevx-0.2.0.tgz` verified from a clean prefix. 201 tests.
3. [ ] Day 3 — **Sameer**: on another laptop `npm i -g ./jevx-0.2.0.tgz`, then `jevx` in 2–3 unrelated TS repos
   (and `jevx mcp install` for Claude Code). Report: what it found, what it wrongly changed, what broke, cost.
4. [ ] Fix what that shows. Then benchmark v0: a corpus project with its real Jev call swapped for if/else.
5. [ ] Later: publish `jevx` to npm; OpenAI / Anthropic keys; hosted free first scan (server-held key).

## M5b steps (research — done, frozen)

1. ✅ Normalize the repository (Session 21).
2. ✅ Lock decisions (Session 22, CURRENT-ARCHITECTURE §11):
   - Grok 4.6 via OpenRouter
   - the finder only finds Jev, in 4 tiers
   - no strong-candidate formula
   - contrasts nearest-first, at most 3, never forced
   - layers A–F kept apart
   - observed / inferred / unknown kept apart
   - pilot first
   - no git
3. ✅ Analyst provider: **direct xAI** (Session 24) — `POST /v1/responses`, `grok-4.6`, `XAI_API_KEY`, no fallback, calculated cost labelled as calculated, `check --grok`, provider in every cache key.
3b. ✅ Build (Session 22):
   - Jev finder `u1`: about 40 decision sites in 12 of the 17 projects
   - `packages/boundary`: schema, prompts b1, validation, contrasts, runner with budget and accounting, cache, store, patterns
   - `jevx jev-usages` / `jevx boundary` / `jevx boundary-patterns`; `pnpm corpus usages|boundary`
   - 159 tests
3c. ✅ `pnpm dev check --grok` verified on the Mac (Session 25): key set, `grok-4.6` reachable, smoke test answered, cost labelled *calculated*.
3d. ✅ `pnpm corpus` project lists (Session 25): a quoted list (`"$P"`) is one argument, so it is split on whitespace/commas; a stray shell `#` comment is ignored; duplicates collapse; an unknown slug names the analyzable projects. `pnpm corpus report` no longer fails before the first run.
4. ✅ **Pilot run** (Session 25, Sameer's terminal). 10 Jev sites analyzed in 8 projects, 21 contrasts, 5 sites lost to
   120-second timeouts, 482k tokens, **$1.68** (calculated). Records in `dataset/boundary/**`.
5. ✅ **Layer E rebuilt** (Session 26) after the single one-shot pattern call timed out:
   - step 1 `aggregate.ts` — deterministic, offline: 21 evidence groups, every count traced to record ids, every
     contradiction named. Runs with no key.
   - step 2 — optional synthesis in small bounded batches (default 4 groups per call, ≤8 calls, one statement each);
     a failed batch loses only its own wording.
   - outputs `dataset/boundary/patterns.json`, `PATTERNS.md`, and a line in `patterns.jsonl` per run.
   - xAI default timeout raised 120s → 300s (the pilot's 5 timeouts were the reply window, not the payload).
6. [ ] **Sameer reads `dataset/boundary/PATTERNS.md`** and decides what the evidence is worth. Optionally re-run with
   Grok's wording: `pnpm dev boundary-patterns --max-batches 3` (≈6 short calls' worth of budget, well under $0.30).
7. [ ] Fix the contrast finder before scaling: 8 of 12 non-excluded contrasts were judged *not decisions at all*
   (plumbing, parsing, formatting), and 4 of 7 analyzed Jev sites ended up with no real comparison.
8. [ ] Look at `jev-firehose/src/jev.ts:123 heuristicJudgment` — one contrast contradicts 8 of the 21 groups on its
   own. Either a mis-selected contrast or the most interesting record in the corpus.
9. [ ] Then scale to all analyzable projects and re-derive layer E.

## Not decided (do not assume)

- Any scoring formula or weights. The features are hypotheses only.
- What "strong candidate" means.
- Which second model cross-checks Grok, and when.
- Python/Rust support.

---

# History — NOT current instructions

> ⚠️ Everything below records earlier plans (v1 text-matching/patching, P1 human-labelling, M4 Gemini, M5 intake, the first M5b sketch with "silver labels"). It explains how the repo got here. **Do not follow it where it conflicts with docs/CURRENT-ARCHITECTURE.md.** In particular: "label the candidates", "human labels are the only ground truth", "M4 = patcher / M5 = apply", and "Gemini never decides anything" are all superseded.


## ▶ M5b — Learn from real Jev usage (next, decided 2026-09-20)

Sameer's call: these 30 projects aren't his, so he won't hand-label 616 candidates. The dataset learns from **where the developers actually used Jev**, and AI explains why.

1. [ ] **Find Jev usages** deterministically, with no AI needed: imports of `@typesafe-ai/sdk`, and `systemOne` / `choice` / `noul` / `score` call sites, in all 17 TS/JS projects.
2. [ ] **Why Jev here?** The AI analyst gets each usage with adaptive context: inputs, the question asked, the outcomes, what happens with the answer.
3. [ ] **Why not there?** Contrast each usage with decision-like code in the same project that stays exact (the existing candidates).
4. [ ] **Boundary dataset:** anchor → reason → decision traits → contrasting exact code. Silver labels count only when **2+ models agree**; disagreements are flagged (a human may look, optional).
5. [ ] **Cross-project patterns**, then score the 616 candidates and evaluate on the TEST projects.
- **Models:** the free DeepSeek V4 Flash returns 404 "unavailable for free" on this account. Nemotron 3 Ultra (free) works but half the calls time out at 60 s.
  - [ ] Pick 2–3 working models: list the free ones that support `response_format`, and compare with paid DeepSeek V4 Flash (likely a dollar or two for the whole corpus).
  - [ ] Add per-run model lists, a timeout setting, and retry/backoff before running the full corpus.
- Caveat: a Jev call means "a developer chose Jev here", not "Jev is right". "Not Jev" may just mean "not done yet".

## ▶ M4c — OpenRouter as a second code-analyst provider (built 2026-09-20)

- ✅ `--openrouter` / `--code-analyst openrouter` / `--openrouter-model`; `check --openrouter`. Default model `deepseek/deepseek-v4-flash-0731:free`, key from `OPENROUTER_API_KEY`.
- ✅ Same prompt, schema, adaptive context, parser, scrubbing, cache and dataset rules as Gemini. Only the transport differs.
- ✅ Separate cache and dataset slot; the eval comparison is informational only.
- [ ] **Sameer:** revoke the key pasted in chat and set a new one in `~/.zshrc`. Then run `pnpm dev check --openrouter`, then `pnpm corpus analyze jev-guard --openrouter --validate`.
- [ ] Watch free-model rate limits on the full corpus. If needed, lower `openrouter.concurrency` to 1 or run project by project.

## ▶ M5 — Real projects: Sameer's 30 Jev projects (started 2026-09-20)

- ✅ The list is saved as given in `dataset/PROJECTS-30.md`, machine-readable with the check results in `dataset/intake.json`, and as a status table in `dataset/INTAKE.md`.
- ✅ **All 29 links checked**: downloaded, commit pinned, languages counted, license read. routeKit (#19) has no link yet.
  - 13 ready (TS/JS) and 4 partial (TS/JS alongside Python or Rust).
  - **12 need another language: 10 Python, 2 Rust.**
  - 9 have no license, so they're stored **private**, fingerprint-only.
- ✅ Offline analysis of all 17 TS/JS projects is saved to `dataset/`: 616 entries, and `dataset check` passes.
- ✅ **The leak check caught a real issue.** jkudish/jev-browser and jkudish/jev-mcp share `provider.ts`. Projects with the same owner now share a split (done in the corpus runner).
- Splits now: TRAIN has 13 projects; TEST has 4 (jev-browser-use, jevbridge, jev-browser, jev-mcp); **DEV has none**. Decide whether to put one project in DEV by hand before tuning.
- ✅ `pnpm corpus list | fetch | analyze` downloads the pinned commits (tarball, no git) and runs `analyze --save` with the right `--public`/`--private`, source, commit, license, domain and split. It passes `--gemini` and `--validate` through.
- [ ] **Sameer, on the Mac:**
  1. `pnpm install`
  2. `pnpm dev check --gemini`
  3. `pnpm corpus fetch --all`
  4. `pnpm corpus analyze jev-guard --gemini --validate`, then the others
- [ ] Review and label. Start with the small projects (jev-guard, jev-router, tiershift, jev-review…). Record missed decisions.
- [ ] routeKit: needs its URL.
- [ ] **Decide:** add Python support next (it would unlock 10 of these projects), or add non-Jev TS/JS projects first.
- Observation: Jev projects already contain real Jev calls (`systemOne`, `choice`/`noul`/`score`), plus heuristic fallbacks next to them. These show a person decided "this is a Jev decision". That's useful evidence, but **not** a label.

## ▶ M4b — Adaptive repository context for Gemini (built 2026-09-20)

Sameer's call: Gemini must not be limited to 60 lines. Some candidates (`router.ts:556`) are clear on their own; others need callers, callees, types, config or the module's purpose. The approach is **whole-repo awareness, selective context, adaptive expansion**.

- ✅ `RepoIndex` (analyzer, offline) indexes the whole repo and builds, per candidate:
  - the whole file, or its outline + the function when the file is over 60k chars
  - a catalog of related context: callees, callers, types, constants, importers, folder outline, repo overview
- ✅ Prompt **g2**: Gemini returns `context_sufficient`, `missing_context`, `context_used` and `understanding_confidence`.
- ✅ **Loop.** When Gemini says the context isn't enough, JevX adds exactly what it asked for (catalog id, or a symbol/file found by searching the index). If the request is vague, it adds the next tier instead: callees/types/constants → callers/importers → folder → repo. It stops when Gemini says sufficient, or at max rounds (4), the budget (250k chars; 0 = unlimited), or when there's nothing more to add.
- ✅ An analysis still insufficient at the end gets `usable=false`: weak evidence, not counted in agreement, flagged in the output and the review screen.
- ✅ **Cache:** an entry is reused only while every context item it saw is unchanged.
- ✅ **Privacy:** credential-looking files are never indexed or sent, and everything is secret-scrubbed. Private projects store only counts and the sufficiency flag in the dataset, never context ids.
- ✅ **CLI:** `--gemini-context adaptive|local`, `--gemini-rounds`, `--gemini-budget`; config `gemini.context`.
- ✅ 95 tests (9 new). Typecheck, lint and build are green.
- Measured on umami, with a fake Gemini that asks for more once: median prompt ≈ 12k chars (~3k tokens), p90 ≈ 39k, max ≈ 143k (a large file).
- [ ] Sameer: real-key run. `pnpm dev analyze <repo> --gemini --limit 5`, then look at the "context … sufficient" lines.

## ▶ M4 — AI code understanding: Gemini analyst (built 2026-09-20)

Gemini is an **optional code analyst**. It explains what a candidate decides, its inputs and outcomes, whether the rule is exact, and whether it approximates a judgment. Its output is **evidence only**:

- it never produces a label
- the policy never uses it
- TypeSafe never sees it
- it never overwrites a human label

Only human labels are ground truth.

| # | Step | Status |
| --- | --- | --- |
| 1 | Inspect repo, send a short plan | ✅ |
| 2 | `packages/gemini` adapter + types (`core`: `GeminiAnalysis`, `GeminiEvidence`) | ✅ |
| 3 | Connectivity: `jevx check [--gemini]`. Key is never printed; the check sends no code | ✅ |
| 4 | Structured prompt g1: minimal context (≤ 60-line function + evidence), secrets scrubbed | ✅ |
| 5 | Response validation: malformed answers become an error on that candidate and never crash the run | ✅ |
| 6 | Cache `.jevx/cache/gemini.json` (code hash + id + prompt version + model); errors never cached | ✅ |
| 7 | `jevx analyze --gemini [--gemini-model] [--offline]`; plain `analyze` unchanged | ✅ |
| 8 | Output + review TUI show AST / Gemini / Jev / JevX policy as separate blocks | ✅ |
| 9 | Dataset `gemini` evidence: public = full analysis; private = facts only; eval shows Gemini agreement for information only | ✅ |
| 10 | 15 new tests (86 total) | ✅ |
| 11 | test / typecheck / lint / build green | ✅ |

**Sameer next:**

- [ ] `pnpm install`, then `pnpm test`.
- [ ] `export GEMINI_API_KEY=…`, then `pnpm dev check --gemini`.
- [ ] Try it on a real project: `pnpm dev analyze <path> --gemini --validate --limit 5`.
- [ ] Paste the 30 Jev projects into `dataset/INTAKE.md`. 19 candidates from the community notes are already listed there, unverified.

**M5 (next):** add about 20–30 diverse OSS projects, including Jev projects and non-Jev ones. Label objectively; a project using Jev doesn't make every decision in it a Jev opportunity. Pick at least one TEST project before any tuning.

**M6:** improve the generators and filtering from reviewed findings. Calibrate the policy p0 → p1 on TRAIN, check on DEV, report on TEST.

**Frozen:** learned ranker (M7), patches/apply (M8+).

## ✅ Phase 1 — decision discovery → labels → dataset → evaluation (done)

The main deliverable of Phase 1 is the loop itself: **Project → Decisions → Labels → Dataset → Evaluation**. Accuracy has to come from a wide range of real software, not from adding more synthetic rules.

**Sameer's decisions (2026-09-20)**

1. **Storage.** Open-source projects may store scrubbed snippets plus metadata, labels and features. Private projects store fingerprint, location, code hash, structural features, labels, reasoning and decision metadata. They never store code, and never store literals either. Secrets are never stored for any project.
2. **Splits.** Splits are per project and deterministic: a hash giving roughly 60/20/20. No project ever appears in two splits. Rotation must be possible later.
3. **CLI.** `jevx scan` stays as the legacy/regression path. `jevx analyze` is the new engine and does not depend on the old detector.
4. **Languages.** Phase 1 implements TS/JS only. Schemas, taxonomy and evaluation are language-independent.
5. **Not in Phase 1:** patches, Gemini, a learned ranker, or rewriting code.

**Phase 1 plan (audit §J)**

| # | Step | Status |
| --- | --- | --- |
| 1 | Audit → approval; PLAN/JOURNAL | ✅ |
| 2 | `examples/` → `regression/legacy-v1/` (legacy suite still green) | ✅ |
| 3 | `core`: language-independent decision vocabulary (labels, primitives, taxonomy, hard negatives, provenance, DecisionCandidate) + secret scrubber | ✅ |
| 4 | `packages/analyzer`: structural index + provenance (TS/JS, uses the project's tsconfig paths) | ✅ |
| 5 | Generators: outcome-set, branch-map, selector, scorer, gate, text-match (structural, no vocabulary) | ✅ |
| 6 | Features + deterministic filtering with named hard negatives | ✅ |
| 7 | `jevx analyze` (offline; `--validate` = TypeSafe decision questions d1, policy p0-uncalibrated) | ✅ |
| 8 | `packages/dataset`: schema, public/private storage, splits, upsert that keeps labels, secret/privacy checks | ✅ |
| 9 | `jevx review` TUI + `jevx label` + `jevx dataset missed` | ✅ |
| 10 | `jevx eval` (per split, per project; `--rotate`) + `jevx dataset check` | ✅ |
| 11 | Tests: 71 green (37 new); typecheck + lint green | ✅ |
| 12 | Not built: ranker, patches, Gemini, auto-apply | — |

**Phase 2 — real data (next)**

- [ ] Sameer: `pnpm install` on the Mac, then `pnpm test`.
- [ ] GlobalCare first: `pnpm dev analyze <globalcare> --save --private --project globalcare`, then `pnpm dev review globalcare --root <globalcare>`. Also record missed decisions.
- [ ] Choose the first open-source projects across domains: AI agents, SaaS, devtools, bots, fintech. Record `--source/--commit/--license`.
- [ ] Before any tuning, confirm that at least one TEST project exists and has labels.
- [ ] Calibrate the TypeSafe policy (p0 → p1) on TRAIN labels only. Check on DEV. Report on TEST.
- [ ] Improve the generators and filtering only from reviewed findings. Every change bumps `ANALYSIS_VERSION`.

**Known limitations (Phase 1)**

- The generators are recall-first and noisy. On umami (1,050 files) the analyzer produced 158 candidates plus 104 filtered; on chatbot-ui it produced 28 plus 9. None of this is measured yet, because nothing is labelled.
- A decision unit is a function. Decisions spread across several functions or files aren't modelled.
- The TypeSafe policy p0 thresholds are guesses until there are human labels.
- The review screen shows code only for public projects, or for private ones when `--root` is given.
- The two pasted markdown attachments from Sameer were never received.

## What JevX is (one paragraph)

A local CLI that sweeps a TS/JS repo for code that *looks* like logic but is really a frozen human judgement call — `if (message.includes("refund"))`, keyword lists, regexes over sentences, switches over free text. It scores each one, explains why it's brittle, and (later) proposes a real `@typesafe-ai/sdk` replacement as a red/green diff you accept or reject, with git checkpoints and revert. Hard rule: **AST decides what's a candidate, TypeSafe decides if it's semantically real, Gemini never decides anything.**

## Working rules

- **No git operations of any kind.** No init/commit/push, no remotes, no GitHub. Sameer handles all git.
- Order is fixed: **migrate → lock stack → M2.** No infrastructure changes after Phase A.
- M3 is the validation layer only. **No patch generation, Gemini, rewriting, or apply** until M4/M5.
- Scores shown before M3 are always labelled **preliminary**.
- API keys come from env vars only, never written to config.
- PLAN.md and JOURNAL.md are updated after every step.

## Milestones

| # | Milestone | Status |
| --- | --- | --- |
| M1 | AST scanner + preliminary scoring | ✅ Done |
| A | Stack migration + lock | ✅ Done — stack locked |
| M2 | Detector quality + regression suite | ✅ Locked (Sameer, 2026-09-19) |
| M3 | TypeSafe validation + final confidence | ✅ Targets met (pipeline 100/100, TypeSafe 95/100, GlobalCare 0). Close-out items 22–23 remain |
| P1 | Reboot: decision boundaries + dataset + review + eval | ✅ Infrastructure built (2026-09-20). Phase 2 = real projects |
| M4 | AI code understanding: Gemini analyst (evidence only) | ✅ Built 2026-09-20 — needs a real-key run |
| M5 | Real project collection (~20–30 diverse OSS incl. Jev projects) | Next |
| M6 | Improve from labels; calibrate policy on TRAIN | After M5 |
| M7 | Learned ranking / calibration | Later, needs labelled projects |
| M8+ | Rewrite + apply (old v1 M4/M5) | Frozen |

## Locked stack (decided 2026-09-19 — 🔒 no infrastructure changes from here)

| Layer | Tech |
| --- | --- |
| Language / runtime | TypeScript strict, Node ≥ 22 (Ink 7 and commander 15 need it) |
| Package manager | **pnpm 10** workspaces (`packageManager: pnpm@10.34.5`), no Turborepo until builds get slow |
| Arg parsing | **commander** |
| Terminal UI | Ink + React, **ink-spinner**, **ink-select-input** (ink-text-input added when a screen needs text input) |
| Colors / banner | **chalk**, **figlet** |
| Config loading | **c12** (loads `jevx.config.ts`) |
| Detection | ts-morph, fast-glob, ignore, node:crypto |
| Shared types | **`packages/core`** — types, defaults, `defineConfig`, config loading; no internal deps |
| Later (install at their milestone) | `@typesafe-ai/sdk` (M3), `@google/generative-ai` (M3, off by default), `diff` (M4), `simple-git` (M5) |
| Dev | tsup, Vitest 5, execa, ESLint 10 + typescript-eslint, Prettier, TypeScript 5.9 (TS 7 not yet — typescript-eslint supports < 6.1) |

Deferred, do not install: Tree-sitter, Next.js, Clerk, PostgreSQL, Drizzle, Plasmo, GitHub App SDK.

## Phase A — stack migration ✅

- [x] A1. pnpm workspaces (`pnpm-workspace.yaml`, `workspace:*`, `package-lock.json` removed)
- [x] A2. `packages/core` (types, defaults, signal labels, `defineConfig`, c12 loader)
- [x] A3. detector / terminal-ui / cli import from `@jevx/core`; each package declares its own deps
- [x] A4. CLI on commander; chalk for plain output
- [x] A5. figlet banner, ink-spinner, ink-select-input
- [x] A6. 19/19 tests, typecheck, lint, build green; same scores as M1
- [x] A7. Synced to `~/Desktop/jevX`, README updated, stack locked

## M3 — TypeSafe semantic validation (current)

Goal: every AST candidate scoring 50 or more is checked by TypeSafe, and the number shown becomes the **final confidence**.

**SDK facts (inspected 2026-09-19, `@typesafe-ai/sdk` 0.6.0, MIT, no deps)**
- `new TypeSafeClient({ apiKey?, baseURL?, defaultModel?, timeout?, retry?, fetch? })`. The key falls back to `TYPESAFE_API_KEY`, the base URL to `TYPESAFE_BASE_URL`, and the model to `jev-latest` (= `jev-1.13.0`).
- `client.systemOne({ state, questions })` returns `{ model, answers, usage }`. Question types: `noul` (answer: `noul` 0–1), `choice` (`choice`, `confidence`, `probabilities`), `score`.
- `client.models.list()` can serve as a reachability check. Errors: AuthenticationError, RateLimitError, APIConnectionError and friends. Retries 2× by default, 10 s timeout per attempt.
- Custom `fetch` option, so tests can mock the transport without a network.
- Docs guidance: ask atomic questions and combine them in code; keep state small and relevant (accuracy drops with unrelated state); state budget is 32k tokens; 1,200 requests/min; input-only pricing; noul has no separate confidence (the probability is the certainty).

**Design**
- One `systemOne` call per candidate, with three atomic questions on a small JSON state (file, function, language, the decision's code snippet, matched terms):
  - `semantic` (noul): does this decide based on what a person *means* in free text, so paraphrases should give the same outcome?
  - `humanText` (noul): is the matched text written by a person in natural language?
  - `kind` (choice): intent/topic · sentiment/tone · moderation/safety · urgency/priority · yes-no/agreement · other semantic · not semantic
- **Final confidence** = round(100 × `semantic`). **Confirmed** if `semantic` ≥ 0.5 and `humanText` ≥ 0.3. Otherwise **rejected** (hidden, and counted in the summary). The AST score is kept alongside as `preliminary`.
- Cache in `.jevx/cache/typesafe.json`, keyed by file hash + candidate id + prompt version + model. An unchanged candidate never costs a second call.
- No key → the scan still works, shows preliminary scores and says why. API error on one candidate → that candidate keeps its preliminary score, marked `error`.
- Flags: default validates 50+; `--validate-all` validates everything; `--no-validate` is AST-only and makes no network calls.
- `jevx check`: config, whether the key is present (masked), SDK reachable via `models.list()`, cache size.

**Checklist**
1. [x] `@typesafe-ai/sdk` ^0.6.0 is installed in `packages/typesafe`, the only package that calls it. The CLI declares it too, for the bundle.
2. [x] Core types: `Validation`, `ValidationSummary`, `SemanticKind`, `Candidate.confidence`/`fileHash`/`terms`, `DetectionResult.validation`. `summarize()` moved to core.
3. [x] Question builder (`questions.ts`, `PROMPT_VERSION = "v1"`) and response → validation mapping (`toValidation`, `applyValidation`)
4. [x] Cache in `.jevx/cache/typesafe.json`. Key = sha256(file hash + candidate id + prompt version + model). Errors are never cached; writes are atomic.
5. [x] Validator: 4 workers by default, per-candidate error isolation, stops after a 401/403, progress callback
6. [x] CLI: validates the 50+ band by default, plus `--validate-all`, `--no-validate` and `--no-cache`. Without a key it falls back to preliminary scores. JSON now has `score`/`scoreKind`/`preliminaryScore`/`validation` plus a `rejected[]` list.
7. [x] UI: final confidence with the AST score beside it, header says whether scores are validated, a "TypeSafe says" block in inspect, and a validating progress phase
8. [x] `jevx check`: config, masked key, API reachability via `models.list()`, cache size, and a data-sharing note
9. [x] Tests: `tests/validation.test.ts` (8 unit tests, mocked `fetch`) and `tests/cli.test.ts` (12 end-to-end tests against a local mock server via `TYPESAFE_BASE_URL`). 28 tests in total.
10. [x] `pnpm eval --validate` scores the examples on final confidence. Checked against the mock; the real run needs a key.
11. [x] **Sameer's real run:** `check` ✓, `eval --validate` → **P 100% / R 95%** (19 calls), test file STRONG 82 / MEDIUM 73.
12. [ ] Fix the `spamScore` false negative (semantic 0.49, humanText 0.63, kind moderation 0.99 → rejected by 0.01). **Proposed, not yet approved:**
    - a. ✅ **Done (v2, Session 9).** Send the enclosing function, not just the decision lines. Signature, the lines that build the matched text, and the return, capped at ~40 lines, with the decision lines marked. spamScore was sent 4 bare `if` lines without `post.body` or `return score`.
    - b. **Let `kind` corroborate.** Confirm when `kind ≠ not_semantic` with kind confidence ≥ 0.9 and `semantic` ≥ 0.4. Reject when `kind = not_semantic` with high confidence, even if `semantic` ≥ 0.5.
    - c. **Re-test the `semantic` wording** ("keyword/regex matching is approximating an understanding of human-written text"). 5 of 19 answers landed within 0.10 of 0.5.
    - Each change bumps `PROMPT_VERSION` to v2 (so the cache refreshes) and is measured with `pnpm eval --validate` before and after. Do (a) first on its own, since it's the root cause.
13. [ ] Rotate the TypeSafe key that was pasted into chat
14. [x] Real app: GlobalCare (53 files) → 1 candidate, `app/checkout/page.tsx:239` (regex if-chain on `msg`), AST 65 → final 78, confirmed
15. [x] Bug: `explain` ignored the file's project and used the directory it was run from → fixed (root inferred from the file, single-file analysis, clearer errors, regression test)
16. [x] GlobalCare candidate traced: `msg = e.message` in `catch (e)` around Privy `sendTransaction`, viem `waitForTransactionReceipt`, Supabase, and the app's own `throw new Error(...)`. **False positive → hard negative** (TypeSafe answered humanText 66%, final 78)
16a. [x] Hard negatives added: `examples/hard-negatives/src/errors.ts` (`pay`, `retryable`, `loadProfile`)
16b. [x] AST: caught-error text is machine text (`isCaughtErrorText`, `TextJudgement.machine`). The GlobalCare checkout now has 0 decisions.
16c. [x] Covered by 12a (v2 state includes `enclosing_function`)
18. [x] Sameer's rerun (v2): tests 29/29, AST 100/100 (55 cases), GlobalCare 0 candidates ✓, **TypeSafe P 100% / R 47%** ✗
19. [x] Calibration changes (Session 11):
    - [x] 1. Keep the AST caught-error fix · [x] 2. Keep `enclosing_function` context
    - [x] 3. `humanText` wording reverted to v1 (prompt **v3**)
    - [x] 4. `humanText` is advisory (a note, never a gate)
    - [x] 5. semantic + kind decide: reject on confident `not_semantic`; confirm on semantic ≥ 0.5 or on a confident semantic kind with semantic ≥ 0.4
    - [x] 6. `eval --validate` sends all 55 labelled cases (probes for AST-unflagged functions) → pipeline + TypeSafe-alone precision/recall
    - [x] 7. `eval --replay`: cache-only report + policy sweep, 0 API calls
20. [x] Sameer's run: tests 34/34 · pipeline **100/100** · TypeSafe-alone **95/100** (1 FP: the `pay()` probe, which AST blocks in production) · GlobalCare 0
21. [x] Policy kept as `DEFAULT_POLICY`: semanticMin 0.50, kind-assist on. The sweep shows a flat plateau from 0.50 to 0.60.
22. [ ] Lock calibration in CI: snapshot the 55 v3 answers into `tests/fixtures/typesafe-v3.json` and add a test that replays them through `decide()`. `pnpm test` would then catch a policy regression with no API or key. Proposed.
23. [ ] One more real app with genuine intent-routing code, before M4, to see a confirmed real-world positive. Optional, Sameer's call.

**Decision rule (in code, `packages/typesafe/src/validate.ts`)**
- confirmed ⇔ `semantic` ≥ 0.5 and `humanText` ≥ 0.3. Final confidence = round(100 × `semantic`), banded with the same 50/75/90 thresholds.
- rejected → band `ignore`: hidden from the list, listed in JSON `rejected[]`, counted in the footer.
- error → keeps its preliminary score and band, marked "not validated". Ranking puts validated candidates first, because the two scales aren't comparable.

**Open**
- [ ] Read the TypeSafe Master Customer Agreement (typesafe.ai/legal/mca) for the competing-product clause before going public. Validation sends code snippets to api.typesafe.ai; zero data retention is enterprise-only.

## M2 — detector quality (locked)

Goal: `jevx scan` reliably finds the kind of code Jev is meant to replace.
**Exit bar:** precision ≥ 90% and recall ≥ 90% on `examples/`, with every labelled case passing (enforced by `pnpm test`, measured by `pnpm eval`).
Working order: examples → measure → fix false positives → decide on the single-includes case and tune → human text.

| Run | Precision | Recall | Notes |
| --- | --- | --- | --- |
| Baseline (5 repos, 47 cases) | 82% | 60% | before any tuning |
| Detector fixes (5 repos, 47 cases) | 100% | 94% | Set `.has`, equality chains, 3 inline terms, keyword map lookup, codeContext penalty, DSL/URL/extraction regex filters |
| + labels 25 (5 repos, 47 cases) | 100% | 100% | the headline single `.includes("refund")` now reaches 50 |
| + fuzzy 20 (5 repos, 49 cases) | 100% | 100% | added a fuzzy positive (`closestIntent`) and a fuzzy negative (`suggestCommand`) |
| + Sameer's test file (6 repos, 52 cases) | 100% | 100% | `jevx-m2-test.ts`: GOOD not flagged, MEDIUM 80, STRONG 95. Verified on his Mac. |

Real repos, final rubric: excalidraw (529 files) 0 flagged, nlp.js (709) 0, botkit (104) 0. That's no noise, but it isn't evidence of recall either: none of these are app-style classifier code.

1. [x] Single labelled `message.includes("refund")`: **yes, detect it at "possible" (50)**. `hardcodedLabels` went 15 → 25. Reason: the AST pass is a shortlist and TypeSafe decides at M3, and this is the product's headline example. ⚠️ Needs Sameer's review.
2. [x] Add more real positive and negative examples: moderation, ticket-routing, chatbot, hard-negatives (5 repos, 47 labelled cases)
3. [x] Fix false positives like lexers and parsers. New negative signal `codeContext` (−30) fires on tokenizer/lexer/highlighter names or a mostly code-keyword vocabulary. Regexes are now filtered for URLs, paths, HTML tags and data-extraction capture groups. Phrases containing all-caps code tokens ("graph TD") no longer count as prose.
4. [x] Tuned weights against the examples: `hardcodedLabels` 25, `fuzzyMatch` 20, `codeContext` −30 (new). New options `inlineTermsMin: 3` and `codeContextNames`. ⚠️ Needs Sameer's review, because these differ from the blueprint's starting weights.
5. [x] Measure precision/recall, overall and per signal: `pnpm eval`, also printed by `pnpm test`
6. [x] Human text: **kept the name heuristic**. Dropping it (flagging any string with ≥3 word literals) would flag `browserName` (user-agent sniffing) in hard-negatives. Multi-word literals still count on any receiver.

**Test ladder (Sameer's order)**
- [x] Clean install on Mac, then `pnpm test` / `eval` / `typecheck` / `lint`
- [x] Synthetic test file `jevx-m2-test.ts` (now `examples/m2-test-file/`)
- [ ] Small real application with actual intent-routing logic ← **next**
- [ ] Larger real repository
- [ ] Then M3: TypeSafe validation

**Open for review (M2 decisions that change the blueprint rubric)**
- [ ] `hardcodedLabels` 15 → 25 (makes the single-includes headline example detectable)
- [ ] `fuzzyMatch` 10 → 20. Thin margin: `closestIntent` 50 vs `suggestCommand` 40, and the only difference is normalization.
- [ ] New 9th signal `codeContext` (−30), a penalty that isn't in the blueprint

**Known gaps / M2 follow-ups**
- Declarative keyword triggers such as botkit's `controller.hears(["hello","hi"], ...)` aren't branches, so they aren't detected.
- Helper indirection (`if (isRefund(msg))`) isn't followed.
- Generic names (`s`, `str`, `value`) with single-word terms are missed on purpose.
- The examples are hand-written. A labelled slice of real app code (a support bot, a moderation service) would be the next evidence.
- `textBranches` ignores a trailing `return` after sibling ifs (`classifySupportMessage` counts 2 branches, not 3). Change it only if real code shows it matters.

**Findings carried over from M1** (all addressed above) (these were in NOTES-M2.md, now merged here):
- A single `.includes()` scores 40 (`stringIncludes` 25 + `hardcodedLabels` 15), below the threshold. That includes the blueprint's own headline example.
- Fuzzy matching stays under 50: `closestIntent` (leven + intent list + normalization) scores 40.
- Lexers and parsers look like classifiers: a Mermaid lexer in excalidraw scored 65 (a regex over programming keywords, plus branches).
- Real-repo noise is low: excalidraw (533 files) had 1 candidate, nlp.js (709) had 0. Recall on app-style code still needs labelled examples.
- Human text is judged only by the last token of a name. Values named `s`, `str` or `value` are missed on purpose.

## Later milestones (outline)

- **M3**: `packages/typesafe` validates every candidate ≥ 50, cached by file hash + candidate hash. Adds `--no-validate`, `--validate-all` and `jevx check`. Needs the real SDK docs first.
- **M4**: `patcher` generates `choice(...)` + `client.systemOne(...)`, hoists imports, makes the function async and flags its call sites. `validator` parses and typechecks the result. Output is a red/green diff.
- **M5**: refuse on a dirty tree, checkpoint, apply, typecheck and run tests after applying, `jevx revert`, `.jevx/metrics.json`, `jevx status`.

## Open questions

- [ ] Read the TypeSafe early-access agreement (affects going public).
- [ ] `checkpointMode` default: branch or stash.
- [x] ~~Stack decision~~ → pnpm + commander + c12 + chalk/figlet + `packages/core` (2026-09-19)
- [x] ~~Diff library~~ → `diff` (installed at M4)
