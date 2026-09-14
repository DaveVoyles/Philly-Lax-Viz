#!/usr/bin/env bash
# Cursor Cloud portable-core contract (keep twins in lockstep):
#   1. No Mini secrets, App tokens, board PATs, MainVault, or .env copies.
#   2. Fail closed if a required prove tool is missing.
#   3. Prove is the repo's secret-free core — not a Mini-only path.
#   4. GitHub Actions job cursor-cloud-setup on ubuntu-latest must stay green.
# Portable Cloud prove: pnpm install + ds-tokens + typecheck + test. No ingest/Azure.
set -euo pipefail

ROOT_DIR="${CURSOR_CLOUD_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
PNPM_VERSION="${PNPM_VERSION:-10.33.1}"

if [ ! -f "$ROOT_DIR/pnpm-lock.yaml" ] || [ ! -f "$ROOT_DIR/package.json" ]; then
  echo "setup-cursor-cloud: invalid repository root: $ROOT_DIR" >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "setup-cursor-cloud: npm is required (install Node.js)" >&2
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "setup-cursor-cloud: enabling pnpm ${PNPM_VERSION} via corepack"
  if ! command -v corepack >/dev/null 2>&1; then
    npm install -g corepack || true
  fi
  if command -v corepack >/dev/null 2>&1; then
    corepack enable || true
    corepack prepare "pnpm@${PNPM_VERSION}" --activate
  fi
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "setup-cursor-cloud: pnpm still missing after corepack" >&2
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
# better-sqlite3@11 does not build on Node 23+ (CI uses Node 22).
if [ "$NODE_MAJOR" -ge 23 ]; then
  echo "setup-cursor-cloud: Node $(node -v) — skip native sqlite; prove @pll/web + @pll/shared"
  (cd "$ROOT_DIR" && pnpm install --frozen-lockfile --ignore-scripts)
  echo "setup-cursor-cloud: design tokens"
  bash "$ROOT_DIR/scripts/check-ds-tokens.sh" --token-file "$ROOT_DIR/packages/web/src/styles/tokens.css" "$ROOT_DIR/packages/web/src"
  (cd "$ROOT_DIR" && CI=1 pnpm --filter @pll/shared --filter @pll/web typecheck)
  (cd "$ROOT_DIR" && CI=1 pnpm --filter @pll/shared --filter @pll/web test)
else
  echo "setup-cursor-cloud: pnpm install --frozen-lockfile (Node $(node -v))"
  (cd "$ROOT_DIR" && pnpm install --frozen-lockfile)
  echo "setup-cursor-cloud: design tokens"
  bash "$ROOT_DIR/scripts/check-ds-tokens.sh" --token-file "$ROOT_DIR/packages/web/src/styles/tokens.css" "$ROOT_DIR/packages/web/src"
  echo "setup-cursor-cloud: typecheck + test (all workspaces, matches CI)"
  (cd "$ROOT_DIR" && CI=1 pnpm -r typecheck)
  (cd "$ROOT_DIR" && CI=1 pnpm -r test)
fi

echo "setup-cursor-cloud: environment ready"
echo "setup-cursor-cloud: ingest and logo/PBLA sync stay Mini-only"
