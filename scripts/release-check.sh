#!/usr/bin/env bash
# Everything that must be true before `npm publish`. Publishes nothing.
#   bash scripts/release-check.sh           full: typecheck, lint, tests, pack, install, smoke
#   bash scripts/release-check.sh --quick   skip typecheck/lint/tests
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd)
say() { printf '\n\033[38;2;193;95;60m▸ %s\033[0m\n' "$1"; }

if [[ "${1:-}" != "--quick" ]]; then
  say "typecheck · lint · tests"
  pnpm -s typecheck
  pnpm -s lint
  pnpm -s test
fi

say "build + pack"
pnpm -s build
cd apps/jevx
rm -f jevx-*.tgz vij-sameerb5-jevx-*.tgz
pnpm pack >/dev/null
TGZ=$(ls vij-sameerb5-jevx-*.tgz)
echo "  $TGZ ($(du -h "$TGZ" | cut -f1))"

say "tarball contents"
LIST=$(tar tzf "$TGZ")
echo "$LIST" | sed 's/^/  /'
if echo "$LIST" | grep -Eq '(\.env|\.jevx/|/tests?/|\.map$|\.test\.)'; then
  echo "  ✗ the tarball contains files that must not ship"; exit 1
fi
for f in package/dist/index.js package/dist/mcp.js package/README.md package/LICENSE package/CHANGELOG.md package/package.json; do
  echo "$LIST" | grep -qx "$f" || { echo "  ✗ missing $f"; exit 1; }
done
echo "  ✓ only dist, README, LICENSE, CHANGELOG, package.json"

say "no keys in the bundle"
TMP=$(mktemp -d)
tar xzf "$TGZ" -C "$TMP"
if grep -REn --include='*.js' -e 'xai-[A-Za-z0-9]{20,}' -e 'sk-(or-|proj-|ant-)?[A-Za-z0-9_-]{24,}' -e 'eyJhbGciOi[A-Za-z0-9_-]{20,}' "$TMP/package/dist" ; then
  echo "  ✗ key-like strings found in the bundle"; exit 1
fi
echo "  ✓ none (only the scrubber's patterns)"

say "install into a clean prefix, like a new user"
PREFIX=$(mktemp -d)
npm install -g --prefix "$PREFIX" "./$TGZ" --silent --no-fund --no-audit
BIN="$PREFIX/bin/jevx"
echo "  installed: $("$BIN" --version)"

say "smoke test the installed CLI + MCP server (mock AI, mock TypeSafe)"
cd "$ROOT"
npx tsx scripts/release-smoke.ts "$BIN"

say "ready: apps/jevx/$TGZ — publish with: cd apps/jevx && npm publish"
