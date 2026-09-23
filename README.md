<p align="center"><img src="apps/jevx/assets/icon.png" width="96" alt="JevX"></p>

<h1 align="center">JevX</h1>
<p align="center"><b>Find where Jev fits in your codebase — and change it.</b></p>

Your code is full of hardcoded rules that are really judgment calls: regexes that guess what an
error means, keyword lists that guess what a customer wants, `slice(0, 3)` that guesses what's
best. JevX finds them, scores each one three ways (your AI, TypeSafe/Jev, patterns learned from
real Jev projects) and replaces the strong fits with a Jev decision (TypeSafe **noul** · **choice**
· **score**) — keeping the old rule as the fallback, and proving it with your own tests.

```bash
npm i -g @vij-sameerb5/jevx
cd your-project
jevx --dry-run      # preview: scorecards + red/green diffs, nothing written
jevx                # change strong fits (70%+), run your tests, auto-revert what breaks
jevx undo           # put everything back
```

**Or from the AI you already use** — Claude Code, Claude Desktop, Cursor, Windsurf, VS Code,
Gemini CLI, Codex:

```bash
jevx mcp install    # then say: "use jevx to find where Jev fits in this repo"
```

Claude Desktop users can also double-click `jevx.mcpb` (from the releases) and pick their project folder.

## Why you can trust it

- **Your key, your AI.** JevX never ships a key; the terminal version uses your xAI / OpenRouter key.
- **Safety lives in the tool:** only strong fits change by default, the old rule stays as the
  fallback, files you're editing are skipped, your tests run before and after, `jevx undo` restores.
- **Private by default.** Code goes only to your own AI. `--share` (opt-in) sends generic patterns
  — never code, file or function names — so JevX learns which changes hold up.

Full docs: [`apps/jevx/README.md`](apps/jevx/README.md) · website: [`site/`](site/) ·
changelog: [`apps/jevx/CHANGELOG.md`](apps/jevx/CHANGELOG.md)

## Working on JevX

```bash
git clone https://github.com/vij-sameerb5/JevX.git && cd JevX
pnpm install
pnpm test              # ~240 tests, no network, no keys
pnpm dev               # the CLI from source (shows the welcome)
pnpm jevx --help       # every command
pnpm mcp-smoke examples/jev-demo   # the MCP server, end to end
```

| Folder | What |
| --- | --- |
| `apps/jevx` | the `jevx` CLI + MCP server (published to npm) |
| `packages/engine` | read → assess → scorecard → edit → apply → share |
| `packages/gemini` | AI transports (xAI, OpenRouter) |
| `packages/analyzer`, `scanner`, `core` | local indexing, static candidates, secret scrubbing |
| `tests/`, `examples/jev-demo` | tests with mock AI + mock TypeSafe, and the demo repo they run on |
| `supabase/` | the opt-in anonymous-outcomes dataset (insert-only) |
| `site/` | landing page, docs, contributing |
| `packages/boundary`, `apps/cli` (`pnpm lab`) | frozen research — not part of the product |

See [CONTRIBUTING.md](CONTRIBUTING.md). MIT © Sameer Shaik.
