#!/usr/bin/env bash
# Upload the local SQLite DB to Azure File Share and optionally trigger
# a GitHub Pages redeploy so the live site reflects local changes.
#
# Usage:
#   ./scripts/db-upload.sh            # upload only
#   ./scripts/db-upload.sh --deploy   # upload + trigger Pages workflow
#
# Prerequisites:
#   - az CLI authenticated (az login)
#   - gh CLI authenticated (gh auth status)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB_PATH="${REPO_ROOT}/data/lacrosse.db"
STORAGE_ACCOUNT="pllstorage3426"
FILE_SHARE="pll-data"
REMOTE_NAME="lacrosse.db"

if [ ! -f "$DB_PATH" ]; then
  echo "Error: DB not found at $DB_PATH"
  exit 1
fi

echo "Uploading $DB_PATH to Azure File Share ($STORAGE_ACCOUNT/$FILE_SHARE/$REMOTE_NAME)..."
az storage file upload \
  --account-name "$STORAGE_ACCOUNT" \
  --share-name "$FILE_SHARE" \
  --source "$DB_PATH" \
  --path "$REMOTE_NAME" \
  --no-progress \
  --only-show-errors

echo "Upload complete ($(du -h "$DB_PATH" | cut -f1))."

if [[ "${1:-}" == "--deploy" ]]; then
  echo "Triggering GitHub Pages workflow..."
  gh workflow run pages.yml --ref main
  echo "Pages workflow dispatched. Monitor with: gh run list --workflow=pages.yml"
fi
