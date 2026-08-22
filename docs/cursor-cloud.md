# Cursor Cloud vs Mini

Cloud: `scripts/setup-cursor-cloud.sh` enables `pnpm` via corepack. On Node 22 (CI) it runs a full frozen install plus workspace typecheck/test. On Node 23+ it skips native `better-sqlite3` and proves `@pll/web` + `@pll/shared` only.

Mini / CI (self-hosted `pll`): nightly ingest, Azure config, `db:upload`, logo/PBLA sync.

Do not put Mini secrets, Azure credentials, or a live `.env` into Cloud.

GitHub Actions: `.github/workflows/cursor-cloud-setup.yml` runs the same script on `ubuntu-latest` (Node 22 when the prove needs npm/pnpm).
