# Releasing jevx to npm

Claude never publishes; Sameer runs these.

## One-time

```
npm login                       # your npm account
npm whoami
```

The name `jevx` was free on 2026-09-23. Check again: `npm view jevx` → 404 means free.

## Every release

```
cd ~/Desktop/jevX
pnpm install
bash scripts/release-check.sh          # typecheck, lint, tests, pack, clean install, smoke (CLI + MCP)
pnpm mcp-smoke ~/Desktop/globalcare-ai # real repo, MCP
```

Then the manual Claude Code steps in `docs/MCP-TEST.md`, and at least one real `jevx --dry-run`.

```
cd apps/jevx
npm publish --dry-run                  # shows exactly what would go up
npm publish                            # public (publishConfig.access = public)
```

Build the Claude Desktop bundle and attach it to a GitHub release (Releases → Draft → upload `apps/jevx/jevx-<version>.mcpb`):

```
pnpm build-mcpb                        # → apps/jevx/jevx-0.4.0.mcpb (validated with the official mcpb tool)
```

After publishing, from a clean folder:

```
npx jevx@latest --version
npx jevx --dry-run
```

## A fix release (0.4.1)

1. Fix + test (`pnpm test`).
2. Bump `apps/jevx/package.json` version **and** `VERSION` in `apps/jevx/src/server.ts`.
3. Add a `## 0.4.1` entry at the top of `apps/jevx/CHANGELOG.md` and in `site/docs.html#versions`.
4. `bash scripts/release-check.sh` → `npm publish`.

If a release is broken: `npm deprecate jevx@0.4.1 "broken, use 0.4.2"` (don't unpublish).

## The Claude Desktop warning, signing and the directory

- Any `.mcpb` that isn't in Anthropic's reviewed directory shows "not verified by Anthropic". That is
  expected; never try to hide it.
- `npx @anthropic-ai/mcpb sign apps/jevx/jevx-<v>.mcpb` can sign the bundle (with a real code-signing
  certificate, or `--self-signed` for integrity only). Signing proves the file wasn't altered; it does not
  make it "Anthropic verified".
- To be listed: submit JevX through Anthropic's desktop-extension directory process once 0.4 is public, with
  the GitHub repo, the privacy section of the README and `docs/SCORECARD.md`.

## Learned patterns (every few releases)

```
export JEVX_SUPABASE_URL=…            # in your shell only
export SUPABASE_SERVICE_ROLE_KEY=…     # never in a file in the repo
pnpm export-patterns                  # writes packages/engine/src/patterns-learned.json
```

Rebuild and release: users get the new patterns in their scorecards.

## Before the first public release

- [ ] License confirmed (currently MIT in `apps/jevx/LICENSE` and `LICENSE`)
- [x] GitHub repository: https://github.com/vij-sameerb5/JevX (in package.json, site, README)
- [x] `supabase/jevx-dataset-v2.sql` run in Supabase
- [ ] `docs/MCP-TEST.md` passed on GlobalCare + one other repo
- [ ] `docs/BENCHMARK.md` filled for 2–3 repos
- [ ] Landing page deployed (`site/`), recordings made (`site/recordings/`)
