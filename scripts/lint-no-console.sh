#!/usr/bin/env bash
# lint-no-console.sh — fail when production source uses console.* directly.
#
# Allowed exceptions:
#   - Anywhere under packages/web/src (browser code keeps console for
#     dev-tools ergonomics).
#   - Test files (any path matching /__tests__/ or *.test.ts).
#   - Wave 4 quarantined scripts: mineAliases.ts, seedAliasesFromMine.ts.
#     These shipped just before the logger rollout and were intentionally
#     skipped for this wave; cover them in a follow-up PR.
#   - Any line with a trailing `// allow-console` comment (RFC #07 escape
#     hatch for genuine CLI/UX needs — see checkServerProcs.ts).
#
# Run:
#   bash scripts/lint-no-console.sh
#
# Exit code 0 = clean, 1 = violations found.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Targets: the two production runtimes covered by RFC #07.
TARGETS=(
  packages/server/src
  packages/ingest/src
)

# Files that are explicitly exempt for this wave.
EXEMPT_FILES=(
  packages/ingest/src/scripts/mineAliases.ts
  packages/ingest/src/scripts/seedAliasesFromMine.ts
  packages/ingest/src/scripts/lib/checkServerProcs.ts
)

# Build a single grep -v chain for the exempt file list.
exempt_pattern="$(printf '%s|' "${EXEMPT_FILES[@]}")"
exempt_pattern="${exempt_pattern%|}"

violations=$(
  grep -rn -E "console\.(log|warn|error|info|debug)" "${TARGETS[@]}" 2>/dev/null \
    | grep -v -E "/__tests__/" \
    | grep -v -E "\.test\.ts(:|$)" \
    | grep -v -E "// allow-console" \
    | grep -v -E "^($exempt_pattern):" \
    || true
)

if [ -n "$violations" ]; then
  echo "❌ console.* call found in ingest/server (use createLogger from @pll/shared):" >&2
  echo "$violations" >&2
  echo "" >&2
  echo "If the call is genuinely required (CLI safety messaging, --help output)," >&2
  echo "annotate it with a trailing '// allow-console' comment." >&2
  exit 1
fi

echo "✅ no stray console.* calls in server/ingest production source"
