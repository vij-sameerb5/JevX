# Contributing to JevX

Thanks for helping. JevX is small and moves fast — short PRs with a test are the easiest to merge.

## Set up (5 minutes)

```bash
git clone <repo-url> jevX && cd jevX
pnpm install          # Node ≥ 20.10, pnpm ≥ 9
pnpm test             # ~220 tests, no network, no keys (mock AI + mock TypeSafe)
pnpm jevx --help      # run the CLI from source
```

## Where things live

| Folder | What |
| --- | --- |
| `apps/jevx` | the `jevx` CLI + MCP server (what ships to npm) |
| `packages/engine` | the pipeline: read → assess → scorecard → edit → apply → share |
| `packages/gemini` | AI transports (xAI, OpenRouter) and the adaptive context loop |
| `packages/analyzer`, `scanner`, `core` | local indexing, static candidates, secret scrubbing |
| `tests/` | vitest; `mock-xai.ts`, `mock-typesafe.ts`, `mock-engine.ts` stand in for real APIs |
| `examples/jev-demo` | the tiny helpdesk repo every end-to-end test runs on |
| `site/` | the landing + docs pages |
| `packages/boundary`, `apps/cli` | frozen research — please don't build on them |

## Rules we keep

1. **No API key ever** in code, config, tests or fixtures. Keys come from the environment.
2. **No user code leaves the machine** except to the user's own AI. Anything shared (`--share`)
   must be generic — add a test that proves names are scrubbed.
3. **Safety lives in the tool:** old rule as fallback, tests before/after with auto-revert,
   never touch files with uncommitted changes, `jevx undo`.
4. Prompts are versioned: bump `ENGINE_PROMPT_VERSION` when you change one.
5. User-facing text in plain English, short.

## A good PR

- One change, with a test (`pnpm test`), `pnpm typecheck` and `pnpm lint` green.
- For a new Jev pattern or prompt change: add the case to `tests/mock-engine.ts` or a unit test,
  and say in the PR which real repo you tried it on.
- Update `apps/jevx/CHANGELOG.md` under an "Unreleased" heading.

## Good first issues

- More languages' test runners in `checksFor` (vitest/jest detection, Bun).
- A `jevx --only <folder>` filter.
- More examples in `examples/` (a moderation app, a search-ranking app).
- Better diffs in `.jevx/report.html`.

## Reporting a bug

Include `jevx --version`, the command, and — if you can — `jevx --dry-run --report-json out.json`
plus the relevant `.jevx/debug/*.json` (check them for anything private first).

## Security

Found a way JevX could leak code or keys? Please email the maintainer instead of opening a public issue.
