# JevX — Blueprint v2 (reboot)

> ⚠️ **Partly historical.** Direction, ground truth, dataset meaning and milestones are superseded by [docs/CURRENT-ARCHITECTURE.md](docs/CURRENT-ARCHITECTURE.md), which wins where they differ. This file remains the **component reference** for the analyzer, code-analyst layer (Gemini/OpenRouter, adaptive context, cache), TypeSafe validation, privacy and splits. Its "human labels are the only ground truth" framing is the P1 approach, now deprecated.

_Updated 2026-09-20. Replaces the v1 blueprint (text-matching → patch generator), kept for history in [docs/BLUEPRINT-v1.md](./docs/BLUEPRINT-v1.md). Why it changed: [REBOOT-AUDIT.md](./REBOOT-AUDIT.md). Day-to-day plan: [PLAN.md](./PLAN.md). What was done: [JOURNAL.md](./JOURNAL.md)._

## What JevX is

JevX finds **semantic decision boundaries** in existing TypeScript/JavaScript projects. These are places where code makes a bounded judgment over state that a TypeSafe **Jev** Noul, Choice or Score could make. For each one, JevX explains why it does or doesn't fit.

The abstraction is:

```
STATE ──► DECISION ──► BOUNDED OUTCOME
task state        choose model      fast | smart | coding
incident state    risk judgment     safe | review | block
support request   routing           billing | technical | sales
```

A Jev opportunity is **not** only text classification. It can be routing, model or provider selection, next-action selection, risk, triage, prioritization, scoring, ranking, moderation, verification, security judgment, workflow branching, escalation, recommendation, game strategy, and more. JevX has to find these even when the code contains no telling keywords.

JevX gets better by analyzing **many real projects**. Humans label what it finds, and the result is measured on projects it has never seen. Adding synthetic rules does not count as improvement.

## Principles

1. **Roles are separate and never swap:**

   | Layer | Role | Is it ground truth? |
   | --- | --- | --- |
   | AST / structural analysis | proposes candidates; owns provenance and features; filters obvious non-decisions with a named reason | no |
   | Code analyst: Gemini and/or OpenRouter (optional) | **code analyst**: explains what a candidate decides, its inputs, outcomes, whether the rule is exact, and what kind of judgment it might approximate | no, model-generated evidence |
   | TypeSafe / Jev (optional) | **semantic validator**: answers bounded questions (judgment, bounded, exact-is-right, primitive, category) independently of the code analyst | no |
   | JevX policy | deterministic, versioned code that combines Jev's answers into STRONG / POSSIBLE / NOT | no, it's a prediction |
   | _(current layers: see docs/CURRENT-ARCHITECTURE.md §8)_ | | |

2. The code analyst (either provider) never labels, and never feeds the policy. Its optional `model_hypothesis` is for debugging only.
3. Confidence thresholds are **calibrated from human labels on TRAIN projects**, checked on DEV, and reported on TEST. They are never hand-picked (no "95/55/20"), and never tuned on TEST.
4. JevX works fully offline. The code analysts and TypeSafe are opt-in (`--gemini`, `--openrouter`, `--validate`).
5. Privacy is enforced in code:
   - **Whole-repo awareness, selective sending.** JevX indexes the whole repository locally. The code analyst gets the candidate's file first, and more (related functions, callers, types, constants, folder, repo overview) only when it says it needs it. The whole repo is never dumped by default, but nothing needed is off-limits. TypeSafe gets one function (≤ 60 lines). Secrets are scrubbed everywhere, and credential-looking files are never sent.
   - Nothing is ever uploaded silently; every run prints what it sends.
   - Private projects never store code, literals or model-written text in the dataset.
6. No git operations by tools. Sameer handles git.

## Pipeline

```
SOURCE CODE
   ↓  structural analysis (ts-morph, tsconfig paths, provenance)
   ↓  candidate generators: outcome-set · branch-map · selector · scorer · gate · text-match
   ↓  deterministic features + filtering (named hard negatives, kept in the report)
   ↓  decision representation (inputs, outcomes, suggested primitive, what stays exact)
   ├─► code analyst (optional: --gemini and/or --openrouter) ◄─ adaptive context from the whole-repo index
   │      (file → asks for more → callees/callers/types/constants/folder/repo → sufficient?) ── evidence ──┐
   └─► TypeSafe / Jev validation (optional, --validate) ───────┤
                                                               ↓
                 JevX policy (deterministic, versioned) → STRONG / POSSIBLE / NOT (prediction)
                                                               ↓
               human review (jevx review): sees AST · Gemini / OpenRouter · Jev · policy side by side
                                                               ↓
                       Decision Opportunity Dataset (public / private rules)
                                                               ↓
                   project-level evaluation per TRAIN / DEV / TEST split
```

## Packages

```
apps/cli              commander + Ink; the `jevx` binary
packages/core         shared, language-independent vocabulary (DecisionCandidate, taxonomy, labels,
                      Gemini evidence types), config, secret scrubber
packages/scanner      file walking, ignores, ts-morph loading
packages/analyzer     structural analysis → generators → filtering → representation, plus RepoIndex (whole-repo
                      context catalog for Gemini). Offline, deterministic
packages/gemini       the code analyst: shared context loop, prompt, schema, parser, cache, plus two
                      transports — Gemini (@google/genai, only importer) and OpenRouter (fetch). Evidence only
packages/boundary     M5b decision-boundary analyst; analyst transport = direct xAI/Grok (see docs/CURRENT-ARCHITECTURE.md §5–8, §12)
packages/typesafe     the ONLY package that talks to TypeSafe; decision questions + policy + cache
packages/dataset      schema, public/private storage, labels, splits, check, eval
packages/terminal-ui  Ink screens (review TUI, legacy scan screens)
packages/detector     legacy text-matching detector (only `jevx scan`)
dataset/              the Decision Opportunity Dataset (real projects only)
regression/legacy-v1/ the old 55 synthetic cases: regression suite for `jevx scan`, never "accuracy"
```

## CLI

| Command | Does |
| --- | --- |
| `jevx analyze [path]` | offline decision-boundary analysis |
| `  --gemini [--gemini-model <id>]` | add Gemini code-analyst evidence (needs `GEMINI_API_KEY`), with adaptive whole-repo context |
| `  --openrouter [--openrouter-model <id>]` | same analyst via OpenRouter (needs `OPENROUTER_API_KEY`; default model `x-ai/grok-4.6` (M5b; the free models failed, see CURRENT-ARCHITECTURE §14)). Independent of `--gemini`; both may run |
| `  --code-analyst gemini\|openrouter` | same as `--gemini` / `--openrouter` (repeatable) |
| `  --gemini-context adaptive\|local --gemini-rounds <n> --gemini-budget <chars>` | control context expansion for every code analyst (defaults: adaptive, 4 rounds, 250k chars per candidate; 0 = unlimited) |
| `  --validate` | add TypeSafe / Jev answers and the policy prediction (needs `TYPESAFE_API_KEY`) |
| `  --offline` | replay cached Gemini / OpenRouter / TypeSafe answers, no API calls |
| `  --save --public\|--private --project <slug>` | merge into the dataset (labels are always kept) |
| `jevx review <project> [--root <path>]` | label in the TUI, with AST, Gemini, OpenRouter, Jev and policy shown separately |
| `jevx label <project> <id> <label> --reason …` | label without the TUI |
| `jevx dataset list \| check \| missed` | inspect; privacy and leakage checks; record decisions JevX missed |
| `jevx eval [--rotate <seed>]` | per-split, per-project metrics from human labels |
| `jevx check [--gemini] [--openrouter]` | config, keys (never printed), API reachability. Sends no code |
| `jevx scan / inspect / explain` | legacy text-matching detector (regression path) |

## Gemini code analyst (M4)

- **SDK and model.** Uses `@google/genai` (loaded lazily, only when `--gemini` is used). The model is configurable (`--gemini-model`, `GEMINI_MODEL`, `gemini.model`) and defaults to `gemini-3.8-flash`. The key comes from `GEMINI_API_KEY` only, and is never written to config, cache, dataset, logs or reports.
- **Adaptive repository context** (prompt version `g2`). A candidate is only the starting point: some decisions (`router.ts:556`) are clear on their own, others only make sense once you see a callee, a type, a caller, a config constant or the module's purpose.
  1. JevX **indexes the whole repository** locally (`RepoIndex`, offline, deterministic): files, outlines, callees, callers, types, constants, importers, folders, and a repo overview.
  2. **Round 1** sends the candidate's **whole file** (line-numbered; outline + function if the file is very large), JevX's structural evidence, and a **catalog** of related context. The catalog is ids and titles only, no code.
  3. Gemini reports `context_sufficient`, `missing_context` (catalog ids or named symbols/files), `context_used` and `understanding_confidence`.
  4. If it isn't sufficient, JevX adds **exactly what was asked for**: a catalog id, or a symbol/file found by searching the index. When the request is vague, it adds the next tier: callees/types/constants, then callers/importers, then the folder outline, then the repo overview. Each added function brings its own neighbours into the catalog, so the context walks the code graph. Then it asks again.
  5. The loop stops when Gemini is **sufficient**, or at max rounds (default 4), or at the per-candidate cost guard (default 250,000 chars, `0` = unlimited), or when there is nothing more to add. Nothing is dumped by default; nothing in the repo is off-limits when it's needed. The exceptions are credential-looking files, which are never sent, and secrets, which are scrubbed from every item.
  6. An analysis that ends **insufficient** is marked `usable: false`. It is shown as weak evidence and excluded from Gemini-vs-human agreement.
  - Flags: `--gemini-context adaptive|local`, `--gemini-rounds <n>`, `--gemini-budget <chars>`; config `gemini.context`.
- **Output:** strict JSON, validated by JevX:
  - `summary`, `decision`, `decision_boundary`
  - `inputs[]`, `outcomes[]`, `decision_type` (taxonomy or `not_a_decision`)
  - `deterministic_logic`, `approximates_judgment`, `judgment_kind`
  - `plausible_primitive`, `stays_deterministic[]`, `reasoning`, `uncertainty`
  - `context_sufficient`, `missing_context[]`, `context_used[]`, `understanding_confidence`
  - optional debug `model_hypothesis`

  A malformed answer becomes an error on that one candidate. It never crashes the run and is never cached.
- **Cache:** `.jevx/cache/gemini.json`, keyed by code hash, candidate id, prompt version, model and context mode. An entry is reused only while **every context item it saw is unchanged**, so a changed callee or type forces a fresh analysis.
- **Failures:** one failing call only affects its own candidate. An auth failure stops all further calls. `analyze` completes either way.
- **Independence:** TypeSafe is not shown Gemini's text.
- **In the dataset**, entries carry `gemini.kind = "model_generated_evidence"`:
  - Public projects store the full analysis (scrubbed).
  - Private projects store facts only: enums, booleans and counts, including context rounds, item count and sufficiency, but no context ids.
  - `jevx eval` shows Gemini-vs-human agreement **for information only**.

## OpenRouter: second code-analyst provider (M4)

Added after the first real run hit Gemini free-tier HTTP 429 / 503 on every candidate. OpenRouter does **not** replace Gemini; it is a second provider for the **same** analyst.

- **Only the transport differs** (`packages/gemini/src/openrouter.ts`, plain `fetch`, no SDK). Everything else is shared: the adaptive context loop, prompt `g2`, `RESPONSE_SCHEMA`, the parser (validation + secret scrubbing), the cache rules, and the dataset privacy rules.
- **Request.** `POST https://openrouter.ai/api/v1/chat/completions` with:
  - `messages` = [system: the Gemini system instruction, user: the same prompt]
  - `response_format: {type: "json_schema", json_schema: {name: "jevx_code_analysis", strict: true, schema: RESPONSE_SCHEMA}}`
  - `temperature: 0`

  `choices[0].message.content` (a string or text parts) goes through the same `parseGeminiAnalysis`, so the evidence format is identical, including the `context_*` and `understanding_confidence` fields. `usage.prompt_tokens` / `completion_tokens` become the token counts.
- **Model and key.** The model resolves `--openrouter-model` → `OPENROUTER_MODEL` → `openrouter.model` → `x-ai/grok-4.6`. The key comes from `OPENROUTER_API_KEY` only. It is sent only in the `Authorization` header and redacted from every error; it is never written to config, cache, dataset or logs.
- **Selection.** `--gemini` and `--openrouter` are independent (either, both, or neither; also `--code-analyst gemini|openrouter`). Evidence goes to `candidate.openrouter` / `openrouterError`, and the run summary to `result.openrouter`. Evidence carries `provider`, which is absent on older Gemini entries.
- **Failures.** 429 (rate limit), 5xx, a 200 body carrying an error, timeouts (default 120 s, `OPENROUTER_TIMEOUT_MS`) and malformed JSON each fail only their own candidate. 401 / 403 / 402 / 404 (model unavailable) are fatal: calls stop. `analyze` always completes.
- **Cache.** A separate file, `.jevx/cache/openrouter.json`. The key is sha256(code hash, id, prompt version, `openrouter:<model>`, mode), so the same model id on two providers never collides. Gemini keys are unchanged. Item-hash invalidation is the same. Errors are never cached.
- **`jevx check --openrouter`** calls `GET /key` (key valid?) and `GET /models` (model exists?). It sends no code.
- **Dataset.** Evidence is stored under `openrouter` with the same format and privacy rules as `gemini`: public entries get the scrubbed analysis plus context ids, private entries get facts only. `dataset check` validates both slots.
- **Eval.** An informational side-by-side on labelled entries: Human vs TypeSafe (policy label) vs Gemini hypothesis vs OpenRouter hypothesis, plus how often the two analysts agree with each other. None of it is a metric, and nothing is tuned on it.

Gemini is there to help us understand real projects during the data-building stage. The goal is for JevX to eventually work mainly from AST plus Jev, with the code analyst (Gemini or OpenRouter) kept as an optional deep mode if it proves useful.

## Dataset and evaluation

- Layout: `dataset/projects/<slug>/{project.json, entries.jsonl}`. Taxonomy: [dataset/TAXONOMY.md](./dataset/TAXONOMY.md). Rules: [dataset/README.md](./dataset/README.md).
- **Public projects** store scrubbed snippets. **Private projects** store fingerprint, location, code hash, features, labels, reasoning and safe metadata. They never store code, literals or model-written text.
- **Splits** are per project and deterministic (hash, about 60/20/20), or assigned manually on the first save. A project is only ever in one split. `--rotate` re-hashes the split assignment to test how well results carry across projects.
- **Ground truth (superseded):** see [docs/CURRENT-ARCHITECTURE.md](docs/CURRENT-ARCHITECTURE.md) §8–9. There is no ground truth in the current phase: observed Jev usage is developer choice, and AI output is inference.
- **Metrics:**
  - precision, recall and false-positive rate (STRONG+POSSIBLE vs NOT)
  - exact agreement
  - how often humans agreed with the filter's NOT_JEV calls
  - candidate coverage, measured with human-added missed decisions
  - Gemini / OpenRouter agreement with humans and with each other (informational only)

## Milestones

| # | Milestone | Status |
| --- | --- | --- |
| M1–M3 | Legacy text-matching detector + TypeSafe validation (now `jevx scan`, regression only) | ✅ done |
| P1 | Reboot: decision discovery → labels → dataset → evaluation | ✅ done (2026-09-20) |
| **M4** | **AI code understanding: Gemini analyst**, optional, evidence only, cached, privacy-safe, with **adaptive whole-repo context** (g2) | ✅ built (2026-09-20). OpenRouter added as a second provider after Gemini free-tier 429/503. Needs a real-key run |
| M5 | Real project collection (✅ 17 TS/JS projects in, 616 candidates): first ~20–30 diverse OSS projects, including Jev projects, plus non-Jev projects so we don't only learn what "Jev-looking" code looks like. The list lives in [dataset/INTAKE.md](./dataset/INTAKE.md) | next |
| **M5b** | Learn the Jev boundary from real Jev usage (Grok 4.6 analyst). Definition: [docs/CURRENT-ARCHITECTURE.md](docs/CURRENT-ARCHITECTURE.md) §12 | **current** |
| M6 | Improve JevX from the boundary dataset: fix generators/filtering from reviewed findings, calibrate the TypeSafe policy (p0 → p1) on TRAIN, check on DEV, report on TEST | after M5 |
| M7 | Learned ranking / calibration / classifier, **only** once enough labelled projects exist | later |
| M8+ | Rewrite and apply (the old v1 M4/M5: SDK patch generation, diff, git checkpoint, revert) | frozen |

Rules for M5: do not assume that every decision in a Jev project is a Jev opportunity; analyze objectively. Variety of projects matters more than the count. Pick at least one TEST project before any tuning.

## Still true from v1 (for when rewriting is unfrozen)

- Patches must emit the real, documented `@typesafe-ai/sdk` pattern (`client.systemOne({ state, questions })`), never an invented helper.
- Async propagation (sync → async) must be shown honestly across call sites.
- Before apply: clean tree, git checkpoint, parse + typecheck + shape check. After apply: typecheck, tests, one-command revert.

## Stack (locked)

TypeScript strict, Node ≥ 22, pnpm 10 workspaces, commander, Ink + React (ink-spinner, ink-select-input), chalk, figlet, c12 config, ts-morph, `@typesafe-ai/sdk`, `@google/genai`, fetch (OpenRouter), tsup, Vitest + execa, ESLint + Prettier.

## Open questions and risks

- Read the TypeSafe, Gemini and OpenRouter API terms (and the terms of the model provider behind each OpenRouter model) before going public. Free OpenRouter models may log prompts. Both analyses send code snippets to a third party when they're asked to.
- Gemini's JSON-schema fields in the SDK are marked deprecated in favour of `responseFormat`. JevX validates every answer itself, but the adapter may need updating when the old fields are removed.
- Generators are recall-first and noisy until M6. Precision will come from labelled data, not from adding rules.
- A decision unit is one function. Decisions spread across several functions or files aren't modelled yet.
