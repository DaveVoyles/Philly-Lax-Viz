#!/usr/bin/env bash
# Azure Files upload is retired. Production SQLite is Mini volume pll-lax_pll-data.
set -euo pipefail

cat >&2 <<'EOF'
pnpm db:upload is retired. Azure share pllstorage3426 is gone.

Copy data/lacrosse.db into Docker volume pll-lax_pll-data (container DB_PATH=/data/lacrosse.db).

  docker stop pll-server
  docker run --rm \
    -v pll-lax_pll-data:/data \
    -v "$PWD/data":/in \
    alpine:latest \
    sh -c 'cp /in/lacrosse.db /data/lacrosse.db && chown 100:101 /data/lacrosse.db && chmod 664 /data /data/lacrosse.db'
  docker start pll-server

See docs/deployment-mini.md.
EOF
exit 1
