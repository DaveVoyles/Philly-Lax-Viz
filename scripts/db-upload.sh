#!/usr/bin/env bash
# Upload the local SQLite DB to Azure File Share.
# The SWA + ACA deployments pick up DB changes automatically on next request.
#
# Usage:
#   ./scripts/db-upload.sh
#
# Prerequisites:
#   - az CLI authenticated (az login)

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
