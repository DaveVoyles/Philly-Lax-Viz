#!/usr/bin/env bash
# Regression test for the PLL 502 incident (2026-09-22): scripts/db-upload.sh
# used to run `chmod 664 /data /data/lacrosse.db` as one command, which
# strips the execute bit off the DIRECTORY too, making /data untraversable
# and killing pll-server with SQLITE_CANTOPEN. This never touches a real
# Docker volume or the mini host: it extracts the chmod calls embedded in
# the shipped script and replays them against a scratch directory.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TARGET="$REPO_ROOT/scripts/db-upload.sh"

fail() {
  echo "FAIL: $1" >&2
  exit 1
}

[ -f "$TARGET" ] || fail "$TARGET not found"

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

DATA_DIR="$WORK/data"
DB_FILE="$DATA_DIR/lacrosse.db"
mkdir -m 700 "$DATA_DIR"
: > "$DB_FILE"
chmod 600 "$DB_FILE"

# Pull the container command out of the script and grab just the chmod calls.
CMD_LINE=$(grep -oE "sh -c '[^']*'" "$TARGET" | sed "s/^sh -c '//; s/'\$//") \
  || fail "could not find the container command in $TARGET"
[ -n "$CMD_LINE" ] || fail "container command in $TARGET was empty"

CHMODS=$(printf '%s\n' "$CMD_LINE" | grep -oE 'chmod [0-7]+ [^&|]+' | sed 's/[[:space:]]*$//')
[ -n "$CHMODS" ] || fail "no chmod calls found in $TARGET"

while IFS= read -r c; do
  [ -n "$c" ] || continue
  # /data/lacrosse.db must be substituted before /data (longest match first).
  substituted=$(printf '%s' "$c" | sed "s#/data/lacrosse.db#@@DB_FILE@@#g; s#/data#$DATA_DIR#g; s#@@DB_FILE@@#$DB_FILE#g")
  eval "$substituted"
done <<< "$CHMODS"

if [ ! -x "$DATA_DIR" ]; then
  fail "data dir is not traversable after the script's chmod calls (the 502 bug)"
fi

MODE=$(stat -f '%Lp' "$DB_FILE" 2>/dev/null || stat -c '%a' "$DB_FILE")
if [ "$MODE" != "664" ]; then
  fail "db file mode is $MODE, expected 664"
fi

echo "PASS: /data stays traversable and lacrosse.db is 664 after scripts/db-upload.sh's chmod calls"
