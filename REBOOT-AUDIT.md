> ⚠️ **HISTORICAL — not current instructions.** The 2026-09-19 reboot proposal (approved and built as P1). Its human-labelled-dataset and ground-truth model is deprecated. The current architecture is [docs/CURRENT-ARCHITECTURE.md](docs/CURRENT-ARCHITECTURE.md); where they differ, that file wins.

# JevX Reboot — Audit & Proposal (awaiting approval)

_2026-09-19 · proposal only, no code changed. Supersedes nothing until Sameer approves._

**New product definition:** JevX discovers *semantic decision boundaries* in existing software (places where code makes a judgment that could be a Jev Noul / Choice / Score) and proves why each one does or doesn't fit. Every analyzed project feeds a growing, human-labelled **Decision Opportunity Dataset**, and accuracy is measured on projects JevX has never seen.

---

## A. Current architecture (as built, M1–M3)

```
apps/cli (commander, Ink UI)            ~700 LOC
  scan · inspect · explain · init · check · stubs for M4/M5
packages/core                           ~360 LOC   types, defaults, c12 config
packages/scanner                        ~120 LOC   fast-glob + .gitignore + ts-morph Project, skips minified
packages/detector                       ~1000 LOC  site finder → decision grouping → 9 weighted signals → 0–100 score
packages/typesafe                       ~400 LOC   SDK client, questions (v3), policy + decide(), cache, replay
packages/terminal-ui                    ~420 LOC   banner, scan list, candidate detail
packages/analyzer|patcher|validator     stubs
tests/  (34 tests)                      harness (AST/pipeline/TypeSafe views, probes), mock API, CLI e2e
examples/ (6 synthetic repos, 55 labels) regression suite
```

Pipeline today: `files → ts-morph AST → text-matching "sites" (includes/regex/===/switch/Set.has/fuzzy) → group into if-chain/switch/function → weighted signals → score ≥ 50 → TypeSafe (semantic, humanText, kind) → policy → confirmed/rejected`.

## B. Reusable (keep, mostly as-is)

| Piece | Why it survives |
| --- | --- |
| Monorepo, pnpm, commander, Ink, c12, tsup, Vitest | locked stack; no reason to change |
| `scanner` | file walking, ignores, minified skip, ts-morph loading: language infra, not detection philosophy |
| `typesafe` client / cache / **policy + `decide()` + offline replay** | exactly the machinery a semantic layer needs; only the questions change |
| **`isCaughtErrorText` provenance tracing** | first real "where does this value come from" analysis; generalises into input provenance |
| `enclosing_function` context builder | proven by the M3 data (spamScore, invoice-community lesson) |
| Eval harness structure (multi-view metrics, probes, replay, sweeps) | becomes project-level evaluation |
| CLI UX: `check`, `explain`, `--json`, `--no-validate`, root inference, EPIPE, cache flags | developer-facing plumbing |
| Mock TypeSafe server + CLI e2e tests | test infra |
| PLAN/JOURNAL discipline, no-git rule, key-from-env rule | process |

## C. Must be rewritten

- **Detector core (`detect.ts`, `text.ts`)**: its unit of analysis is a *text-matching site*. Needs a new unit: the **decision unit** (a function or block that maps state → one of a bounded set of outcomes).
- **Scoring model**: 9 hand-weighted signals tuned on 55 synthetic cases. Replace with *features* recorded per candidate (not summed into a magic number) until real data can calibrate a ranker.
- **TypeSafe questions**: "does it decide based on what a *person means* in free-form text" is the old definition. New questions must be about *judgment vs exact rule*, boundedness, and primitive fit.
- **`examples/` role**: demoted to `regression/legacy-v1/`; it no longer defines "correct".
- **Candidate/Validation types in `core`**: extended to the new schema (G).

Deprecate (keep compiling, stop extending): the `keywordList / stringIncludes / hardcodedLabels …` signal set becomes **one candidate generator ("text-match")** among several, not the definition.

## D. What was fundamentally wrong with the old detector

1. **Wrong definition.** It equated "Jev opportunity" with "code that matches strings against natural language". Jev's real domain is *any bounded judgment over state*: routing, risk, next action, model selection, triage, verification.
2. **Wrong unit.** It found *matching sites* and grouped them, instead of finding *decisions* and asking what they decide.
3. **Evidence was syntactic.** Variable names (`message`, `feedback`), label words ("refund"), `.includes()`. GlobalCare (53 real files) → 0 candidates is the symptom: real apps make decisions without keywords.
4. **Circular validation.** 55 synthetic examples, written by us to exercise the same heuristics, then 100/100 on them. It proved internal consistency, not generalisation. No project-level split, no unseen test set.
5. **Scores hid reasoning.** "AST 80" said nothing about *what* was decided, the outcomes, or which primitive fits.

What was *right*, and carries forward: layered design (**static analysis proposes, Jev judges, deterministic code owns provenance**); measuring precision *and* recall; human-readable explanations; calibration with replay.

## E. Proposed architecture

```
Project
  │  1. Project understanding      language, framework, entry points, file roles (test/config/generated)
  ▼
  2. Structural index (ts-morph)   functions, call graph (local), returns, branches, data-flow of params
  ▼
  3. Candidate generators          several independent, cheap, deterministic:
       • outcome-set   function returns one of a finite set (string/enum/union literals, booleans with is/should/can/needs…)
       • branch-map    if/switch/ternary chains mapping state → distinct outcomes/actions
       • selector      picks one from a collection/strategy map (find, sort()[0], reduce-max, providers[key])
       • scorer        combines several weak signals into a number compared to a threshold
       • gate          approve/reject/escalate/retry/fallback paths
       • text-match    (legacy detector, demoted)
  ▼
  4. Feature extraction (deterministic, recorded)
       inputs + provenance (user/external text, config, DB, caught error, constants),
       outputs (enumerated), arithmetic density, exact-comparison density, side effects,
       callers, hard-negative markers (parse/crypto/http/status/ext/schema…)
  ▼
  5. Deterministic triage          obvious NOT_JEV (pure arithmetic, parsing, crypto…) labelled with a reason, kept in the report
  ▼
  6. Semantic layer (TypeSafe, bounded questions, minimal context, cached, replayable)
  ▼
  7. JevX classification + explanation   NOT_JEV / POSSIBLE_JEV / STRONG_JEV, primitive, "what stays deterministic"
  ▼
  8. Dataset entry + human review (J/P/N)  →  project-level evaluation
  ▼
  (later) ranker trained on the dataset · (much later) replacement / diff / apply
```

New packages: `packages/analysis` (steps 2–5), `packages/dataset` (schema, storage, review, splits). `detector` shrinks into the text-match generator. `typesafe` gets a v4 question set.

**Proposed Jev questions (v4), one call per candidate:**
- `judgment` (Noul): does the decision require interpreting meaning/context, rather than applying an exact rule to exact values?
- `bounded` (Noul): are the possible outcomes a small, known set (or a graded level)?
- `primitive` (Choice): noul · choice · score · none
- `category` (Choice): taxonomy (H), ≤ 255 options
- `deterministic_is_correct` (Noul): would exact code remain the right solution even if a semantic model were available?

Policy stays in code (`decide()`), is replayable, and is calibrated on *human* labels, never on Jev's own answers.

## F. Decision Opportunity Dataset schema (v1)

Storage: `dataset/projects/<project-slug>/project.json` + `entries.jsonl` (one line per candidate, git-diffable).

```jsonc
// project.json
{ "slug": "globalcare-ai", "source": "local|git url", "commit": "…", "language": ["ts"], "framework": ["next"],
  "domain": ["fintech","health"], "split": "train|dev|test", "added": "2026-09-…", "license_ok": true, "notes": "" }

// entries.jsonl (one per candidate)
{ "id": "sha1(project+file+unit_hash)",
  "project": "globalcare-ai", "file": "app/checkout/page.tsx", "function": "pay", "lines": [171,250],
  "code_hash": "sha256", "code_context": "≤60 lines (or omitted for non-OSS projects; hash + location only)",
  "input_state": [{ "name": "msg", "provenance": "caught_error", "type": "string" }],
  "decision_description": "Map a payment error to a user-facing reason",
  "decision_boundary": "if-chain lines 239–247",
  "possible_outputs": ["cancelled","timeout","insufficient_funds","other"],
  "decision_type": "classification",                 // taxonomy H
  "jev_primitive": "choice|score|noul|none",
  "features": { … step-4 features … },
  "generators": ["branch-map","text-match"],
  "auto": { "label": "POSSIBLE_JEV", "jev_answers": {…}, "policy_version": "p1", "prompt_version": "v4" },
  "label": "NOT_JEV", "label_source": "human", "labeller": "sameer", "confidence": "high|medium|low",
  "reasoning": "Machine-generated library error text; exact error codes are the right fix",
  "hard_negative_reason": "library_error_text",
  "versions": { "analysis": "a1", "detector": "g1", "schema": 1 }, "timestamp": "…" }
```

No secrets: a secret scanner runs over `code_context` before writing, and private projects can store hashes and locations only.

## G. Internal candidate schema

```ts
interface DecisionCandidate {
  id: string; file: string; unit: { kind: "function"|"block"; name?: string; start: number; end: number };
  generators: GeneratorHit[];            // which generators fired and why (evidence strings)
  inputs: InputRef[];                    // params/fields read, with provenance + type
  outputs: OutcomeSet;                   // enumerated literals / boolean / numeric / unknown
  features: Record<string, number|boolean|string>;
  triage?: { verdict: "NOT_JEV"; reason: HardNegativeReason };
  semantic?: { answers: RawJevAnswers; promptVersion: string; cached: boolean };
  classification?: { label: Label; primitive: Primitive; category: Category; reason: string; policyVersion: string };
  explanation?: Explanation;             // decision, inputs, outcomes, why, stays-deterministic
  hashes: { code: string; file: string };
}
```

## H. Taxonomy (v1, grows from real projects)

**Opportunity categories:** classification · routing · triage · prioritization · scoring/grading · ranking · matching/dedup · selection (tool/model/provider/resource) · next-action · workflow branching · human-escalation / automate-vs-human · risk/fraud · safety/moderation · security judgment · verification/evaluation/quality · code-review/PR triage · document/policy interpretation · anomaly interpretation · recommendation · data labeling/extraction-choice · task dependency · UI/context decision · game strategy · other.

**Hard-negative categories (`hard_negative_reason`):** arithmetic/calculation · sorting/filtering by exact key · exact lookup/DB query · parsing (URL/protocol/syntax) · compiler/AST/lexer · cryptography · schema/format validation · exact business rule (thresholds on exact numbers) · HTTP/status/error-code handling · library/app error text · deterministic state machine · feature flags/config switches · file/MIME/extension · performance heuristics · data transformation · enum/protocol dispatch · UI event plumbing.

Each category gets a one-line definition and a canonical example in `dataset/TAXONOMY.md`; new categories are added only from real project findings.

## I. Evaluation strategy

- **Unit of split = project.** `split` is assigned when a project is added (default rotation: 60% train / 20% dev / 20% test). Test projects are never used to write rules or tune thresholds.
- **Ground truth = human labels.** Jev answers are features, not truth.
- **Metrics per split and per project:** precision / recall / FPR on STRONG+POSSIBLE vs NOT_JEV; *candidate coverage* (recall of human-found decisions that no generator proposed; found in review via "missed decision" notes); Jev–human agreement; taxonomy coverage; cost (calls/tokens per 1k LOC).
- **Recall needs a denominator:** for dev/test projects, a human also skims files for decisions JevX *didn't* propose (sampled if the project is large).
- **Legacy:** `regression/legacy-v1` (the 55 cases) keeps running in `pnpm test`, as a regression suite only.
- **Report:** `jevx eval` prints per-project and per-split tables and never mixes splits.

## J. Phase 1 plan (foundation, no rewriting of user code)

1. `REBOOT-AUDIT.md` (this) → approval. Update PLAN/JOURNAL.
2. Move `examples/` → `regression/legacy-v1/` (harness path update only; still 34 tests green).
3. `core`: add `DecisionCandidate`, `DatasetEntry`, `Label`, `Primitive`, taxonomy + hard-negative enums; keep old types for legacy.
4. `packages/analysis`: structural index (functions, returns, branches, param provenance), reusing the scanner and `isCaughtErrorText`.
5. Candidate generators: outcome-set, branch-map, selector, scorer, gate (+ legacy text-match adapter). Each has unit tests on tiny fixtures.
6. Feature extraction + deterministic triage (hard negatives with reasons).
7. `jevx analyze <project>`: structured report (JSON + Ink list), **no network by default**; `--validate` opt-in uses TypeSafe v4 questions (reuses cache/policy/replay).
8. `packages/dataset`: schema validation, `dataset/projects/<slug>/…` writer, secret scrubber, provenance/versions.
9. `jevx review <project>`: Ink TUI, J/P/N + note + "missed decision" entry; writes human labels.
10. `jevx eval`: project-level metrics by split (empty until projects are labelled).
11. Tests for 3–10; legacy suite still green; typecheck/lint green.
12. **Not in Phase 1:** learned ranker, patch generation, Gemini, auto-apply.

Then Phase 2 is real data collection. GlobalCare is project #1 (train), each project goes through analyze → review → dataset, and the first held-out test project is chosen before any tuning.

## Open decisions for Sameer

1. **Which projects, and licensing:** only OSS we can store snippets from, plus private ones stored as hashes and locations only?
2. **Split rule:** fixed rotation, or you assign train/dev/test per project?
3. **Keep `jevx scan` as-is (legacy) during Phase 1,** and add `analyze` alongside it? (Recommended.)
4. **Language scope:** TS/JS only for Phase 1? (Recommended; the schema is language-agnostic.)
