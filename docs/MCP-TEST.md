# MCP release test — Claude Code / Cursor

MCP is release-ready only when **both halves pass on GlobalCare and on one unrelated repo**.

## 1. Automated half (2 minutes)

```
cd ~/Desktop/jevX
pnpm mcp-smoke ~/Desktop/globalcare-ai
pnpm mcp-smoke ~/Desktop/globalcare-ai --spot app/checkout/page.tsx:236-248
```

It starts `jevx mcp` exactly like Claude Code does (stdio) and calls every tool in the order the
guide gives the editor's AI: guide → scan (+ reading order) → read → related → scorecard →
preview (changes nothing) → report → share (stays off). All steps must be ✓.

To test the INSTALLED package instead of the source: `pnpm mcp-smoke <repo> --bin "$(which jevx)"`.

## 2. Real Claude Code (15 minutes)

| # | Do | Expect | ✓ |
|---|---|---|---|
| 1 | `npm i -g ./apps/jevx/jevx-0.4.0.tgz` then `jevx --version` | `0.4.0` | |
| 2 | `jevx mcp install` | "Claude Code — added for every project" | |
| 3 | `claude mcp list` | `jevx: … mcp — ✓ Connected` | |
| 4 | `cd ~/Desktop/globalcare-ai && claude`, then type `/mcp` | `jevx` listed, 9 tools | |
| 5 | Say: **"use jevx to find where Jev fits in this repo — preview only, don't change files"** | Claude calls `jevx_guide`, `jevx_scan`, then `jevx_read` on files in the reading order | |
| 6 | Watch the scorecards | `jevx_scorecard` called for the checkout wallet-error block (≈ lines 236–248); refund / escrow / payments NOT proposed | |
| 7 | Ask **"show me the diff for the checkout one"** | `jevx_preview_change` red/green diff; file unchanged (`git status` clean) | |
| 8 | Ask **"now apply the strong fits and run the tests"** | Claude edits with its own tool, keeps the old rule as fallback, runs tests | |
| 9 | Ask **"use Jev where the fit is at least 55%"** | only fits ≥ 55% changed; asking for 40% is refused (never under 50%) | |
| 10 | Open `.jevx/report.html` | every scorecard + diff | |
| 11 | Undo with `git checkout .` (you run it) | repo back to normal | |

Repeat steps 4–10 on one completely different TypeScript repo. Note anything odd in the table.

## 3. Cursor (optional, 5 minutes)

`jevx mcp install` also writes `~/.cursor/mcp.json`. Restart Cursor → Settings → MCP → `jevx`
enabled → in chat: "use jevx to find where Jev fits in this repo".

## Known limits

- In MCP mode the editor's AI (and its tokens) do the reading; quality depends on that model.
- TypeSafe's opinion appears only if `TYPESAFE_API_KEY` is set (via `JEVX_ENV_FILE`).
