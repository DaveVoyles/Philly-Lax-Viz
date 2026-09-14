# Mini Docker (production)

Public origin is **`https://phillylaxstats.com`**. One Fastify process serves the SPA and `/api`. Synology DSM terminates TLS and reverse-proxies to Mini host port **8907** (container **8080**). SQLite is Docker volume `pll-lax_pll-data` at `/data/lacrosse.db`.

Proof origin: `https://pll.davevoyles.synology.me`.

## Topology

- App source: `~/REPOS/Philly-Lax-Viz` on Mini (`main` after merge)
- Compose: `~/docker-stack/philly-lax-viz/docker-compose.yml`
- Secrets: `~/docker-stack/secrets/pll.env` (gitignored)
- Volume: `pll-lax_pll-data` — do not delete
- Backup: `~/docker-stack/scripts/backup-pll-sqlite.sh` → NAS `NetBackup/mac-mini-backups/philly-lax-viz`. Nightly GHA `snapshot-db-nightly.yml` and Mini launchd `com.docker-stack.backup-pll-sqlite` both call that script.

## Nightly ingest

`ingest-nightly.yml` on the `pll` Mini runner copies the volume to the workspace, crawls/ingests, copies the DB back, and `docker start pll-server`. Hudl secrets stay in GitHub. Azure Files is not on this path.

## Deploy

`deploy.yml` is `workflow_dispatch` only. It rebuilds the Mini compose stack. Do not push linux/amd64 images for Azure.

## TLS

Certificates: acme.sh DNS-01 (Namecheap) on Mini, imported to DSM archive **PhlyLx**. Renew + `deploy-pll-le.sh`.
