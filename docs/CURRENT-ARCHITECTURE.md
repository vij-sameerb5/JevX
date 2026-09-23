# JevX — Current Architecture (authoritative)

> **This is the ONLY authoritative description of what JevX is doing now.**
> If any other file (BLUEPRINT.md, PLAN.md, JOURNAL.md, REBOOT-AUDIT.md, docs/BLUEPRINT-v1.md, dataset docs, code comments, CLI help) disagrees with this file, **this file wins** and the other file is out of date.
> Updated 2026-09-22 (**direction change #4, Sessions 27–28: `jevx` — one command, the user's AI does the semantic work, no human in the loop**). Changes to direction are made here first.

---

## 0. CURRENT DIRECTION (Sessions 27–28) — read this before anything below

**Sections 1–14 below describe the research phase (M5b). They are kept as history and reference. Where they
conflict with this section, this section wins.**

### Why the pivot

Jev is used everywhere: games, gateways, agents, review bots, trading, moderation. No two of the real Jev
projects looked alike. A pattern library or a trained model can only recognise what it has already seen, so
learned patterns can never decide where Jev belongs in an unfamiliar codebase. That takes an AI that reads the
actual code. JevX's job is to make that AI good at it, not to replace it.

### The product (Session 29: the AI is the brain — it reads the code itself)

```
                 jevx  (terminal, user's own AI key)        Claude Code / Cursor  (jevx mcp)
                    │                                                  │
                    └──────────────────────┬───────────────────────────┘
                                           ▼
                                  @jevx/engine  (packages/engine)
   index (local, free) → READ (AI reads every source file in ~23k-token parts, logic first) → assess (AI, repo context on demand)
   → scorecard (AI + TypeSafe + patterns) → edit (AI: search/replace, callers included) — STRONG fits only
   → apply (backup, skip files with the user's uncommitted edits, add @typesafe-ai/sdk)
   → the project's checks before/after; a change that breaks a passing check is reverted; `jevx undo`
                                           ▼
                     VS Code / Cursor Source Control shows every change in red/green
                                           ▼
             opt-in (--share): one anonymous row per finding → Supabase (jevx_findings), labelled by
             outcome (changed / reverted / undone) → later: train jevx from outcomes, not from AI opinion
```

- **Session 29 change (after the GlobalCare run found 0):** static analysis no longer decides what the AI sees.
  The survey prompt (overview + static candidates) timed out and the fallback read UI components; manual review
  found 4 real spots it never looked at (checkout wallet-error regexes, flight/hotel `.slice(0, n)` ranking,
  country-image lookup). Now the AI reads the source itself (`read.ts`, `READ_*` in prompts.ts, `r2`). Static
  analysis only orders the reading (api/lib first, UI last) and is the ranked fallback if every part fails.
  Consent scope bumped (`read-source-v2`) because more code is sent than before.
- **The dataset** (`supabase/jevx-dataset.sql`): insert-only for the anon key, no code/paths/names. Labels come
  from outcomes (tests passed + not undone = good; reverted/undone = bad), never from the AI's opinion alone.

- **No picking, no accepting.** Sameer's decision: vibe coders don't know where Jev belongs, so asking them is
  pointless. Safety comes from the tool instead: only STRONG fits change, old rule kept as fallback, checks
  before/after with automatic revert, the user's own uncommitted files never touched, undo.
- **Public commands:** `jevx`, `jevx --dry-run`, `jevx undo`, `jevx mcp install` (and `jevx mcp`, which editors
  start). The research CLI is `jevx-lab` (apps/cli) — internal.
- **AI in the terminal = the user's own key** (xAI or OpenRouter). JevX never ships a key (anything in an npm
  package can be extracted). One-time consent per provider; custom base URLs refused without
  `JEVX_ALLOW_CUSTOM_BASE_URL=1`. Free OpenRouter models only by explicit `--model`.
- **Static analysis = navigation. The user's AI = understanding. TypeSafe/Jev = second opinion.** Layer E
  patterns are one of three scorecard inputs (`packages/engine/src/profile.json`), never the authority. The
  average is shown next to its parts; disagreement is flagged and never changed automatically.
- **Cost for Sameer: $0 per user.**

### Status

- **Built:** Session 27, the MCP server + scorecard + preview + report. Session 28, `packages/engine`
  (shared), the autonomous pipeline, safe apply/undo, the one-command `jevx` CLI in #c15f3c, `jevx mcp install`,
  and an installable `jevx-0.2.0.tgz`. `tests/jevx-cli.test.ts` runs the whole thing on the demo repo against
  mock AI + mock TypeSafe (201 tests total).
- **Session 29:** AI full-read step, ranked static fallback, env file (`JEVX_ENV_FILE` / `~/.jevx/.env`),
  opt-in Supabase sharing, `jevx-0.3.0.tgz`. 214 tests.
- **Session 30 (0.4.0 RC):** generic patterns per finding (scrubbed in code) + learned blend; `--min-fit` (floor 50);
  MCP parity (balanced guide, reading order, `jevx_share`); first-run logo; npm packaging + release check;
  MCP smoke harness; `site/`. Release path: `docs/RELEASE.md`, `docs/MCP-TEST.md`, `docs/BENCHMARK.md`.
- **Next:** GlobalCare as benchmark #1 — must find the checkout error classifier and the flights ranking, must
  not touch refund/escrow maths. Then Sameer installs `jevx-0.2.0.tgz` on another laptop and runs `jevx` on 2–3 unrelated TypeScript repos; the benchmark (a corpus project with its real
  Jev call swapped for if/else → does the AI find it? plus a repo with no opportunity → does it say no?).
- **Later, not now:** publish to npm (`npx jevx`); OpenAI / Anthropic keys; a hosted free first scan (needs a
  server that holds the key — never a key in the package); paid credits.
- **Frozen, kept as reference:** Layer E extraction (`packages/boundary`), the B→C→D pilot runner, contrast
  selection, labelling, any trained model.

---

## 1. What JevX is

A TypeScript CLI (pnpm monorepo) that studies real code to learn **where and when a Jev decision (Noul / Choice / Score) is appropriate** and where ordinary deterministic code is the right tool. The long-term goal is to point at those places in new code, and eventually to help replace them.

## 2. The problem we are solving

The question is **not** "can this code technically be rewritten with Jev?". It is:

> **Why did a real developer use Jev at THIS location, while other parts of the same project stayed deterministic?**

A decision in code has the shape STATE → DECISION → BOUNDED OUTCOME. Some are exact rules that should stay code. Others are judgments that exact code approximates badly. We learn the boundary between them from the **contrast** between real Jev usage and the decision-like code next to it that stayed deterministic.

Two separate problems. Only **A** is current:

- **A (hard, current): WHEN and WHERE should Jev be considered?**
- **B (easier, later): once Jev fits, which primitive (Noul / Choice / Score), which question and which state?** Do not generate Jev code or questions yet.

## 3. What the current dataset represents

A **decision-boundary dataset** built from real Jev projects. For each real Jev call site, it records:

- *why* the developer plausibly used Jev there, according to an AI analyst;
- contrasting nearby decision-like code that stayed deterministic, and *why*, again according to an AI analyst;
- recurring patterns across projects.

It is **not** a set of human-verified STRONG/POSSIBLE/NOT labels on candidates.

## 4. What the 30 projects represent

`dataset/PROJECTS-30.md` / `dataset/intake.json` list 30 public projects built with Jev (mostly hackathon / showcase projects). They are **evidence of developer choice**.

- 17 have analyzable TS/JS: 13 fully TS/JS, 4 partly.
- 12 are Python/Rust (not yet supported). routeKit has no URL.
- Each project is pinned to one commit and fetched as a tarball (`pnpm corpus fetch`).
- Only 8 of the 17 depend on `@typesafe-ai/sdk`. The others reach Jev some other way (HTTP, OpenRouter, wrappers), which matters for §5.

## 5. How actual Jev calls are found (built: `packages/analyzer/src/jev-usage.ts`, finder `u1`)

The finder is **deterministic, with no AI**. It answers only "where is Jev actually used?". It never decides whether Jev *should* be used. It works through the TypeScript symbol table, so imports and aliases are followed and a shadowed local name doesn't count. Evidence tiers (how sure the *finder* is that this is Jev, not whether Jev fits):

| Tier | What | Anchor? |
| --- | --- | --- |
| **definite** | symbols resolved to `@typesafe-ai/sdk` / `@typesafeai/sdk` (`TypeSafeClient.systemOne`, `choice` / `noul` / `score`, aliases, namespace imports, `require`), or `experimental_evaluate` with `@ai-sdk/typesafe-ai` | yes |
| **likely** | the known Jev HTTP API (`api.typesafe.ai/v1/systemone`), Jev via OpenRouter (`typesafe/jev` models, the decisions endpoint), an AI gateway `typesafe-ai/jev` model | yes |
| **wrapper** | verified by the call graph: calls a local function that performs a definite/likely Jev call (e.g. `assessAction` → `ask()` → fetch). Also a frontend `/api/jev` route, but only if the project has a server-side proxy that calls Jev | yes |
| **uncertain** | Jev-looking but unverified (question-shaped objects with no Jev call in reach, `systemOne` on an unresolved receiver) | **never**; recorded apart |

Other rules:

- **Roles.** `decision` means questions are defined and asked here; this is the anchor. `questions` means a question factory or set. `plumbing` means clients, providers and proxies; recorded, not anchors.
- **Test files are excluded** (fakes such as a local `noul()` or a stub `systemOne`).
- **Other AI models are not Jev.** The finder never treats arbitrary LLM usage as Jev usage.
- **Each site records:** file, function, lines, tier, role, the questions (key, primitive, text, outcomes/scale, line), the calls (kind, line, `via` for wrappers), question sets, evidence strings and callers.
- **First run over the 17 TS/JS projects** (about 7 s in total): **about 40 decision sites in 12 projects**. commit-miner, jev-ultrafast, quackd and socai have none in TS/JS; pi-jev-router has only plumbing. `jevx jev-usages <path>` shows them.

## 6. What Grok 4.6 does

Grok 4.6 is the **primary code analyst for M5b**, and for this phase it is **required**, not optional. Since Session 24 it is reached through the **direct xAI API**: `POST https://api.x.ai/v1/responses`, model `grok-4.6`, key from `XAI_API_KEY` only, structured output via `text.format` (`json_schema`, strict). Grok is the researcher, not the system under study. The system under study is TypeSafe/Jev.

- **No fallback.** A missing key fails with "XAI_API_KEY is not set."; JevX never silently switches provider. `jevx check --grok` verifies the key, the model list and one tiny no-code request.
- **Accounting.** xAI reports `input_tokens`, `output_tokens`, `cached_tokens` and `reasoning_tokens` but **no price**, so cost is **calculated** from `xai.pricePerMInput` / `pricePerMOutput` (defaults 2 / 6 USD per million, the listed grok-4.6 prices) and is always labelled `calculated`. OpenRouter's own reported cost stays labelled `provider`. A calculated cost is never presented as provider-reported.
- **Provider abstraction stays:** `--code-analyst xai|openrouter|gemini` (default `xai`) behind one `GeminiTransport` interface. The provider and model are part of every cache key, so an OpenRouter answer is never reused as an xAI answer.

For each **anchor** (an observed decision site), Grok gets the smallest useful context first: the site's file (or its outline plus the function if the file is very large) and the finder's facts. It then asks for more through the shared adaptive loop: callees, types, constants → callers, importers → folder → repo overview. It answers **"why Jev here?"** (prompt `b1`, strict JSON):

- the decision: what is decided, inputs and where they come from, outcomes, downstream action, and whether it is exact or semantic
- the Jev questions and what each one asks
- **feature levels** (none/low/medium/high/unknown, **no weights**): semantic_ambiguity, context_dependence, deterministic_expressibility, judgment_required, rule_stability, risk_or_policy_component, natural_language_understanding, decision_complexity
- **why-Jev hypotheses**, each assessed as supported / contradicted / not_determinable with evidence: semantic interpretation, ambiguous NL/context, competing outcomes, judgment not computation, policy interpretation, risk assessment, classification needing context, hard to encode as rules, soft/changing rules, uncertain inputs, context-dependent behaviour, expensive/fragile rules
- **not-reasons**, assessed explicitly: critical, slow, large function, many branches, important feature, complex code. These may correlate with Jev use, but they are never reasons by themselves.
- `why_jev` split into **observed** (every claim cites a file:line), **inferred** and **unknown**; plus what an exact-rule alternative would need and how adequate it would be

Then, in **one call per anchor**, it gets up to 3 **contrasts** (§8 D) and the previous analysis (labelled *inference*), and answers **"why did these stay deterministic?"**: whether each one is a real decision at all, the same features, `why_deterministic` (observed / inferred / unknown), the concrete differences from the Jev site, and `shares_jev_site_traits` (no/partly/yes/unclear). That last field is a hypothesis, never a label.

Shallow answers are rejected: a sufficient answer needs observed or inferred claims. Everything is validated and secret-scrubbed. Grok's output is **AI inference**: never an observed fact, never ground truth. The layer is **model-agnostic**, so a second model can be added later for agreement (see §11). Disagreement will be recorded, never silently resolved.

## 7. What TypeSafe/Jev does

TypeSafe/Jev (`jevx analyze --validate`) answers bounded questions about a candidate: judgment, bounded, exact-is-right, primitive, category.

- **Not used in M5b.** It comes **later**, as a **secondary** semantic validation signal on candidates once the boundary is known: "does this decision require contextual judgment?", "is the distinction between outcomes semantic?".
- **Never the source of the label.** "Jev says yes, therefore use Jev" would be circular.
- Its policy `p0-uncalibrated` (thresholds on judgment/bounded) is an **uncalibrated placeholder**.

## 8. What the dataset stores (six separate layers — never mix them)

| Layer | What | Nature | Where (current / planned) |
| --- | --- | --- | --- |
| **A. Source corpus** | the 30 projects at pinned commits | fact | `dataset/intake.json`, `~/jevx-corpus/<slug>` (not in repo) |
| **B. Observed Jev usages** | Jev call sites found by the finder | fact (developer choice), **not** truth | `dataset/boundary/<slug>/usages.jsonl` |
| **C. AI analysis of usages** | Grok's "why Jev here?" | model inference (`kind: model_generated_inference`) | `dataset/boundary/<slug>/analyses.jsonl` (keyed by site + code hash + provider:model + prompt version) |
| **D. Contrasting decisions** | nearby decision-like non-Jev code + Grok's "why deterministic?" | selection is fact; the explanation is inference | `dataset/boundary/<slug>/contrasts.jsonl` |
| **E. Derived boundary patterns** | recurring patterns across C–D, citing record ids | hypotheses (`kind: derived_hypothesis`) | `dataset/boundary/patterns.jsonl` (every run), `patterns.json` + `PATTERNS.md` (latest) |
| _(accounting)_ | tokens, cost, calls, rounds, retries, failures per project run | fact | `dataset/boundary/<slug>/runs.jsonl` |
| **F. Future candidate evaluation** | new code scored with learned patterns | predictions | later; must never feed back into A–E as training data |

The **existing** `dataset/projects/<slug>/entries.jsonl` (616 candidate entries from P1) is **candidate data**. It is the pool that D selects from. It is not layer B, C or E, and M5b never writes to it.

**D selection** is deterministic, with no AI. Per anchor, up to 3 analyzer candidates, **nearest first**: same function → same file → a related file (imports it, is imported by it, or holds a caller). Candidates are excluded if they:

- touch Jev themselves, or are the Jev site's callers (they consume its answer: wiring, not independent decisions);
- were filtered by triage with a named hard negative;
- were already paired with another anchor.

**Never forced:** if nothing meaningful is near, a site gets fewer contrasts or none.

**Anchors** are decision sites of tier definite, likely or wrapper, product code before bench/examples/scripts. Twins that ask identical questions count once.

Rules:

- **observed usage ≠ ground truth**
- **AI inference ≠ observed fact**
- **future candidate ≠ training example**
- A **non-Jev location is not proof** that Jev doesn't belong there.
- **Privacy:** no secrets anywhere. **Private (unlicensed) projects** store only enums and levels in C/D, with no question text in B. Grok's free text for them stays in the project's local `.jevx/cache/boundary.json`, never in the dataset. `BoundaryStore.check()` enforces this.
- **Splits:** unchanged. Per project, deterministic, same-owner projects kept together. TEST projects must not be used to derive patterns (E).

## 9. What is NOT ground truth

- a Jev call in the corpus (developer choice, possibly demo-driven)
- the absence of Jev (possibly just "not done yet")
- Grok / Gemini / any OpenRouter model output
- TypeSafe answers and the p0 policy's STRONG/POSSIBLE/NOT
- AST generator output and triage filters

Human labels remain possible (`jevx review`) but are **optional spot-checks**, not a requirement. Nobody is expected to label the 616 candidates.

## 10. What "strong candidate" means currently

**Nothing established, and deliberately so.**

- `STRONG_JEV` in the code is the output label of the uncalibrated TypeSafe policy p0, and the vocabulary of the optional human review.
- **No scoring formula and no weights exist, and none may be hardcoded.** No "10 branches = strong", no "critical = strong", no "complex = strong".
- Semantic ambiguity, criticality, complexity, context dependence, rule stability, natural-language understanding, branch count and the cost of deterministic rules are **hypotheses**. Grok assesses them per site as levels; which of them actually separate Jev from deterministic code is what the dataset is for.

## 11. Decided (locked Session 22) / not yet decided

**Decided:**

1. Grok 4.6 through the **direct xAI API** (Session 24; was OpenRouter in Session 22). Required for the pilot, not optional. OpenRouter and Gemini remain selectable providers.
2. The finder only finds Jev (four tiers as in §5; uncertain is never an anchor; other AI models are not Jev).
3. No strong-candidate formula (§10).
4. Contrasts: same function/module → same file → related code; at most 3; never forced.
5. Layers A–F stay separate (§8).
6. Observed / inferred / unknown are kept apart in every answer.
7. A pilot of 10–20 usages first, then **stop and inspect**. Scale only after the output is seen to answer both "why Jev here?" and "why not Jev there?".
8. No git.

**Not yet decided:**

1. Which second model (and when) cross-checks Grok for agreement.
2. How patterns (E) are validated beyond counting records and naming what contradicts them. Layer E now
   reports how much evidence each pattern has; it does not establish that any pattern is true.
3. Python/Rust support (would unlock 12 projects).
4. How much of the ~4M-token budget the full corpus gets. Decide after the pilot's measured cost per site.
5. Any scoring formula (§10).

## 12. What M5b is (CURRENT milestone)

```
A. 30 Jev projects (pinned)
   ↓ deterministic Jev finder (u1)                        → B. observed usages   (jevx jev-usages)
   ↓ Grok 4.6 via OpenRouter + adaptive repo context
     "why Jev here?"                                      → C. usage analyses    (jevx boundary)
   ↓ nearest non-Jev decisions from the analyzer (≤ 3)
   ↓ Grok: "why did these stay deterministic?"            → D. contrasts         (jevx boundary)
   ↓ DETERMINISTIC aggregation of the stored records
   ↓ (optional) Grok words each counted group, in small batches
   ↓ recurring boundary patterns (cite records)           → E. patterns          (jevx boundary-patterns)
   ↓ decision-boundary dataset
```

**Layer E is two steps, and the first one needs no model.** Step 1 counts the stored C and D records:
levels per feature on each side, hypothesis assessments, decision natures, the record ids behind
every number, and every record that contradicts the result. Step 2 is optional and only *words* the
groups step 1 produced — a few groups per call, one statement each — so the model never supplies a
count, an id, a project or a counter-example, and a batch that fails costs only its own wording.
`--offline` skips step 2 entirely and still writes the full dataset.

Evidence recorded on Jev sites alone (the why-Jev hypotheses) **describes Jev sites and separates
nothing**; only the features, which are measured on both sides, can separate. `strength` and
`confidence` say how much evidence exists — how many records, how many projects, whether anything
contradicts it — never how good Jev would be anywhere. There is still no weight, score or threshold.

**Commands:**

- `pnpm corpus usages [slug…]`, or `jevx jev-usages <path>`: layer B, offline.
- `pnpm corpus report`: the evaluation, from stored records only.
- `jevx check --grok`: key, model and one tiny no-code request.
- `pnpm corpus boundary [slug…] --max-usages 2 --total-budget 400000`, or `jevx boundary <path> --public|--private`: layers B, C and D (direct xAI by default).
  - `--dry-run` shows the plan and sends nothing.
  - Per-project budget: `--budget-tokens` (default 150k).
  - The run stops *before* any call once a budget is spent.
  - 429/5xx/timeouts are retried with backoff. A 401/402/403/404 (bad key, no credits, model unavailable) stops the run.
  - Every run reports input, output, reasoning and cached tokens, calls, rounds, retries and the **cost**, labelled provider-reported or calculated.
- `jevx boundary-patterns`: layer E across stored projects. **TEST-split projects are excluded.**
  - `--offline`: step 1 only (counting). No key, no call, full dataset.
  - `--batch-size <n>` (default 4) groups per call, `--max-batches <n>` (default 8) caps the calls, `--timeout <ms>` per call.
  - Writes `dataset/boundary/patterns.json` (the dataset), `PATTERNS.md` (the write-up), and appends the run to `patterns.jsonl`.

**Order of work:**

1. Repository normalization. ✅
2. Decision lock. ✅
3. Finder, boundary analyst, storage, accounting, CLI and tests. ✅
4. Pilot: 10 Jev sites analyzed, 21 contrasts, 5 sites lost to timeouts, ~$1.68. ✅ (Session 25)
5. Layer E rebuilt as deterministic counting + bounded optional synthesis, after the single
   one-shot pattern call timed out. ✅ (Session 26)
6. **Sameer reads `dataset/boundary/PATTERNS.md` and decides what the evidence is worth.** ← next
7. Only then: fix the contrast finder (8 of 12 contrasts were not decisions), then scale.

## 13. After M5b (FUTURE)

The eventual flow (not being built yet):

source → structural analysis → candidates → state/context → **boundary features learned from the dataset** → deterministic filtering → semantic analysis → **TypeSafe/Jev validation (secondary)** → evidence + confidence → recommendation.

- **M6:** apply the learned boundary to candidates (layer F); make "strong candidate" concrete from evidence.
- **M7:** TypeSafe/Jev as a calibrated secondary signal (not truth).
- **M8:** Jev recommendations for new projects (problem B: primitive, question, state).
- **M9+:** patch generation / apply (frozen; this was the v1 "M4/M5").

## 14. Deprecated approaches

| Old approach | Why it changed | Now |
| --- | --- | --- |
| **v1 (M1–M3):** keyword/text-matching detector → TypeSafe validation → patch generator | Found brittle text checks only, and tuned on synthetic cases | kept as `jevx scan` regression path only |
| **v2 / P1:** candidate-first. Generators find decisions, **humans label** STRONG/POSSIBLE/NOT, eval by precision/recall | The corpus isn't Sameer's code, so labelling 616 candidates isn't realistic or reliable | candidate machinery reused; human labels optional |
| **M4:** Gemini as the code analyst | Free tier returned 429/503 | code kept (optional provider) |
| OpenRouter free models (DeepSeek V4 Flash free, Nemotron 3 Ultra free) | 404 "unavailable for free" / ~50% timeouts | transports kept; Grok 4.6 over **direct xAI** is primary |
| Session 20 idea: "2+ models agree → silver labels" | Premature; one good analyst first, agreement later | replaced by §6 / §11 |
| "Every decision in a Jev project is a Jev opportunity" | Never true | rejected |

## Milestone status

- **DONE:**
  - v1 M1–M3: legacy detector plus TypeSafe validation, kept as a regression path
  - P1: analyzer, candidate generators, triage, dataset schema, privacy, splits, review/eval tooling
  - M4: code-analyst layer — Gemini, OpenRouter, adaptive whole-repo context, provider-separated cache
  - M5 intake: 30 projects checked, 17 TS/JS fetched and analyzed, 616 candidates
  - M5b pilot: 10 Jev sites + 21 contrasts analyzed by Grok 4.6 over direct xAI (~$1.68)
  - M5b layer E: deterministic aggregation + bounded optional synthesis → `patterns.json`, `PATTERNS.md`
  - tests: 185 passing
- **CURRENT:** M5b. **Sameer reads PATTERNS.md and decides what the evidence is worth**; the contrast
  finder needs work before scaling (8 of 12 contrasts in the pilot were not decisions at all).
- **FUTURE:** M6–M9+ (above).

> **Milestone name collision:** in `docs/BLUEPRINT-v1.md`, the old PLAN sections and `apps/cli/src/meta.ts`, "M4" means patch generation and "M5" means apply/revert. Those are **not** today's M4/M5. Today they are M9+.

## Where things live

- `packages/analyzer`: AST analysis, candidate generators, `RepoIndex` (reused for B and D context)
- `packages/analyzer/src/jev-usage.ts`: the Jev finder (layer B)
- `packages/gemini`: the code-analyst layer. The shared adaptive loop (`adaptive.ts`, `runAdaptive`) and the transports: `xai.ts` (direct xAI / Grok, default), `openrouter.ts`, `client.ts` (Gemini). Also the P1 candidate analyst (prompt g2).
- `packages/boundary`: M5b. Schema B–E, prompts `b1` (usage, contrast) and `e1` (layer-E synthesis), validation, contrast selection, runner with budget and accounting, cache, store, `aggregate.ts` (deterministic layer E), `patterns.ts` (batched synthesis), `markdown.ts` (PATTERNS.md).
- `packages/typesafe`: TypeSafe/Jev validation (signal)
- `packages/dataset`: the P1 candidate dataset (`dataset/projects/`). The M5b layers live in `dataset/boundary/`.
- `scripts/corpus.ts`: fetch / analyze the corpus
- History: `JOURNAL.md` (sessions, newest first), `PLAN.md` (history section), `REBOOT-AUDIT.md`, `docs/BLUEPRINT-v1.md`, `BLUEPRINT.md` (component reference)

## Working rules

- **No git commands**; Sameer handles git.
- API keys come from environment variables only. They are never written to code, config, cache, dataset, logs or docs.
- Secret-scrub everything sent to any model. Never send credential-looking files.
