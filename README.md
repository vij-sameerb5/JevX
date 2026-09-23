# JevX

Learns **where and when a TypeSafe Jev decision (Noul / Choice / Score) is appropriate** by studying
real Jev usage in existing projects. It then applies that boundary to find decision points in
TypeScript/JavaScript code that a Jev decision could make.

**Current architecture (authoritative): [docs/CURRENT-ARCHITECTURE.md](./docs/CURRENT-ARCHITECTURE.md).**
Component reference: [BLUEPRINT.md](./BLUEPRINT.md) · history: [JOURNAL.md](./JOURNAL.md), [REBOOT-AUDIT.md](./REBOOT-AUDIT.md), [docs/BLUEPRINT-v1.md](./docs/BLUEPRINT-v1.md)

## Status: M5b current — learn the boundary from real Jev usage (Grok 4.6 analyst). Done: P1 analyzer, M4 code analysts, M5 corpus intake

Plan: [PLAN.md](./PLAN.md) · What's been done: [JOURNAL.md](./JOURNAL.md)

```bash
pnpm dev jev-usages <path>                  # M5b: where is Jev actually used? (deterministic, offline)
pnpm dev boundary <path> --public --dry-run # M5b: which Jev sites + nearby deterministic contrasts would be analyzed
pnpm dev boundary <path> --public           # M5b: why Jev here? why not there? (Grok 4.6, direct xAI)
pnpm dev check --grok                       # XAI_API_KEY, model and one tiny no-code request
pnpm corpus boundary <slugs…> --max-usages 2 --total-budget 400000   # the M5b pilot over the corpus
pnpm corpus report                          # → dataset/boundary/PILOT-REPORT.md
pnpm dev analyze <path>                     # P1 offline: structure → generators → filtering → decisions
pnpm dev analyze <path> --gemini            # + Gemini code analyst (whole-repo index, adaptive context; never a label)
pnpm dev analyze <path> --validate          # + TypeSafe decision questions (unit code, secret-scrubbed)
pnpm dev analyze <path> --save --private    # add to ./dataset (or --public for OSS snippets)
pnpm dev review <project> [--root <path>]   # optional human spot-check (STRONG_JEV / POSSIBLE_JEV / NOT_JEV)
pnpm dev eval                               # metrics vs human labels, if any exist (optional)
pnpm dev dataset check                      # schema, privacy and split-leakage checks
```

Pipeline: `project → structural analysis → candidate generators (outcome-set, branch-map,
selector, scorer, gate, text-match) → deterministic filtering (named hard negatives) →
decision representation → optional Gemini analyst (evidence) + optional TypeSafe (validation) →
policy → dataset`. This is the P1 candidate pipeline; M5b adds a Jev-usage pipeline on top
(see docs/CURRENT-ARCHITECTURE.md). Nothing here is ground truth. No patches, no learned ranker yet.

The legacy text-matching detector (`jevx scan`, M1–M3) still works and is kept as a
regression path over `regression/legacy-v1/` (the old 55 synthetic cases).

## Legacy: TypeSafe validation for `scan` (M3)

```bash
export TYPESAFE_API_KEY=...        # never put it in jevx.config.ts
pnpm dev check                     # key present? API reachable?
pnpm dev scan <path>               # AST detect → TypeSafe validates the 50+ band → final confidence
pnpm dev scan <path> --no-validate # AST only, nothing leaves your machine
pnpm eval --validate               # AST / pipeline / TypeSafe-alone precision & recall (all 55 cases)
pnpm eval --replay                 # same from cache only + threshold sweep — no API calls
```

Results are cached in `<project>/.jevx/cache/typesafe.json` (add `.jevx/` to `.gitignore`).
An unchanged candidate in an unchanged file is never sent twice. Use `--no-cache` to force fresh calls.

## Develop

Needs Node ≥ 22 and pnpm (`corepack enable` picks up the pinned version).

```bash
pnpm install
pnpm dev analyze regression/legacy-v1     # run the CLI from source
pnpm test                                # detector regression suite + CLI tests
pnpm typecheck && pnpm lint
pnpm build                               # bundles apps/cli/dist/index.js
node apps/cli/dist/index.js scan --plain
```

## Layout

```
apps/cli              commander commands and wiring (the `jevx` package)
packages/core         shared types + the language-independent decision vocabulary, secret scrubber
packages/scanner      file walking, ignores, ts-morph project loading
packages/analyzer     Phase 1 engine: structure, provenance, generators, filtering, representation (TS/JS)
packages/dataset      candidate dataset (P1): schema, storage, optional labels, splits, check, eval
packages/typesafe     the only package that talks to TypeSafe (legacy validation + decision questions d1)
packages/gemini       code-analyst layer: shared adaptive-context loop (runAdaptive), Gemini + OpenRouter transports
packages/boundary     M5b: "why Jev here / why not there" — schema B–E, prompts, contrasts, runner, store
packages/terminal-ui  Ink screens (banner, welcome, legacy scan list, review TUI)
packages/detector     legacy text-matching detector (used only by `jevx scan`)
packages/patcher      placeholder — later
packages/validator    placeholder — later
dataset/              the dataset itself (real projects only)
regression/legacy-v1/ the old 55 synthetic cases — regression suite for `jevx scan`, never "accuracy"
```

## Legacy detector tuning

The legacy detector's weights live in `jevx.config.ts`. `pnpm eval` / `pnpm test` check it against
`regression/legacy-v1/*/expected.json`. The Phase 1 engine is not tuned against these cases.
