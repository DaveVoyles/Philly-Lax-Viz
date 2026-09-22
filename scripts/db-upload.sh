#!/usr/bin/env bash
set -euo pipefail

cat >&2 <<'EOF'
pnpm db:upload is retired. Azure share pllstorage3426 is gone.

Copy data/lacrosse.db into Docker volume pll-lax_pll-data (container DB_PATH=/data/lacrosse.db).

  docker stop pll-server
  docker run --rm \
    -v pll-lax_pll-data:/data \
    -v "$PWD/data":/in \
    alpine:latest \
    sh -c 'cp /in/lacrosse.db /data/lacrosse.db && chown 100:101 /data/lacrosse.db && chmod 755 /data && chmod 664 /data/lacrosse.db && test -x /data || { echo "FATAL: /data not traversable after chmod" >&2; exit 1; }'
  docker start pll-server

See docs/deployment-mini.md.
EOF
exit 1
