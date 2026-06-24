# Azure deployment — Philly Lacrosse Vis

Low-cost single-container deployment of the PLL stack:

- **App** (`@pll/server` + `@pll/web`) -> **Azure Container Apps** (Consumption plan, `--min-replicas 1`).
- **Static assets** (`packages/web/dist` + `data/logos/*.gif`) -> served by the Fastify app from the same container.
- **DB sync** (`data/lacrosse.db`) -> Azure Files share for nightly upload/downloads; do not run live SQLite from SMB.

> **Live deployment** (post-migration target): ACA at `https://phillylaxstats.com` · Image `ghcr.io/<owner>/pll-server`.

> ### Deployment learnings (single-container revision)
>
> 1. **Static Web Apps are retired** for this app. The Container App now serves the SPA, API, and logos from one hostname.
> 2. **Cold starts**: ACA Consumption with `min-replicas=0` cold-starts in 15-20 seconds after idle. GitHub Actions scheduler jitter made `*/5` keep-warm pings unreliable, so the service now runs with `--min-replicas 1`.
> 3. **SQLite on Azure Files (SMB) is broken** for this workload. Keep Azure Files only for nightly upload/download of the DB artifact; the live app should not open SQLite directly from the SMB mount.
> 4. **Container Registry**: GHCR works well for CI/CD here and keeps the deploy path simple.
> 5. **`az containerapp update --image` does not always replace the running image**. Pair it with a new revision (or let the deploy action create one) so the rollout is unambiguous.
> 6. **GitHub Actions scheduler jitter is real**. Treat cron-based keep-warm jobs as best effort, not as a substitute for always-on replicas.

> The server already honours `DB_PATH` (preferred) and `PLL_DB_PATH` (legacy) env
> vars and listens on `process.env.PORT` (defaults to 3001 locally; we set 8080
> in the container). No code changes are required to deploy.

---

## 1. Cost estimate

Numbers are list price for `eastus`, single low-traffic instance.

| Resource                                              | SKU                          | Est. monthly |
| ----------------------------------------------------- | ---------------------------- | -----------: |
| Azure Container Apps (Consumption, min-replicas=1)    | 0.5 vCPU / 1 GiB, always-on  |   **~$5–8** |
| Azure Files (Standard LRS, 1 GiB share)               | Standard_LRS                 |   ~**$0.06** |
| Storage transactions (nightly upload + reads)         | <100k/mo                     |   ~**$0.10** |
| Container Registry (GHCR)                             | n/a                          |      **$0** |
| Egress (≤1 GiB/mo while traffic is light)             | First 100 GiB free           |      **$0** |
| Log Analytics (default ACA logs, 5 GB free)           | Pay-as-you-go                |   ~**$0–2** |
| **Total**                                             |                              | **~$5–10/mo** |

Set a hard budget alert (see [§9](#9-cost-monitoring)).

### Architecture decision: single container (2026-06-24)

**Decision: Consolidated to single Azure Container App serving both static files and API.**

The previous two-service setup (SWA free + ACA scale-to-zero) produced unpredictable 15–20 second cold starts because:
1. `min-replicas=0` causes cold starts on any request after ~5 minutes of idle
2. The GitHub Actions health-check pinger (`*/5 * * * *`) has scheduler jitter of 2–5 minutes at peak load, creating actual gaps of 8–10 minutes between pings

The fix requires `--min-replicas 1` (always-on container). With that requirement the cost split becomes:
- Keep split (SWA free + ACA min-replicas=1): ~$5–9/mo
- Single container (ACA min-replicas=1, no SWA): ~$5–8/mo

Same cost, simpler architecture: one service, one deploy job, no cross-origin proxy rewrite, no SWA tooling.

The CDN advantage of SWA is negligible for a Philadelphia-metro audience. Static assets in the container are served with `Cache-Control: public, max-age=31536000, immutable` headers.

---

## 2. Architecture

```
              ┌──────────────────────────────────────┐
 browser  ──► │  Azure Container Apps (min-replicas=1)│  (Consumption plan, always-on)
              │  Fastify server - 0.5 vCPU / 1 GiB  │
              │                                      │
              │  /           -> packages/web/dist/  │  (SPA static files + fallback)
              │  /api/*      -> API routes          │
              │  /logos/*    -> data/logos/         │
              │                                      │
              │  Image: ghcr.io/<owner>/pll-server  │
              │  DB_PATH=/tmp/lacrosse.db           │
              └──────────────────┬───────────────────┘
                                 ▼
              ┌──────────────────────────────────────┐
              │  Azure Files share `pll-data`        │  (1 GiB, Standard LRS)
              │  └─ lacrosse.db                      │
              └──────────────────┬───────────────────┘
                                 ▲
                                 │ nightly upload
              ┌──────────────────┴───────────────────┐
              │  GitHub Actions                      │
              │  - deploy.yml      (push to main)    │
              │  - ingest-nightly.yml (cron)         │
              └──────────────────────────────────────┘
```

---

## 3. Prerequisites

| Tool       | Version          | Install                                              |
| ---------- | ---------------- | ---------------------------------------------------- |
| Azure sub  | any (Pay-as-you-go works) | https://azure.microsoft.com/free          |
| `az` CLI   | ≥ 2.60           | `brew install azure-cli`                             |
| `gh` CLI   | ≥ 2.40           | `brew install gh`                                    |
| Docker     | ≥ 24             | only needed if you want to test the image locally    |
| pnpm       | 10.33.1          | `corepack enable && corepack prepare pnpm@10.33.1`   |
| Node       | 20.x             | `fnm install 20`                                     |

```bash
az login
az account set --subscription "<your-subscription-id>"
gh auth login
```

Azure CLI extensions used:

```bash
az extension add --name containerapp --upgrade
az extension add --name storage-preview --upgrade   # for share-rm
az provider register --namespace Microsoft.App
az provider register --namespace Microsoft.OperationalInsights
```

---

## 4. One-time setup (concrete `az` commands)

You can run [`infra/azure-bootstrap.sh`](../infra/azure-bootstrap.sh) which does
all of this in one shot, or copy/paste the steps below.

### Variables

```bash
export RG=pll-rg
export LOCATION=eastus
export STORAGE_ACCOUNT=pllstorage$RANDOM     # must be globally unique, lowercase
export FILE_SHARE=pll-data
export SWA_NAME=pll-web                      # legacy only; used for SWA cleanup in §4b
export ACA_ENV=pll-env
export ACA_NAME=pll-server
export ACA_STORAGE_NAME=plldata               # the *named* mount inside ACA env
export GHCR_OWNER=<your-github-username-or-org>
```

### 4.1 Resource group

```bash
az group create --name "$RG" --location "$LOCATION"
```

### 4.2 Static Web App (legacy only)

SWA is no longer part of the active architecture. Skip this section for new deployments.

Keep `$SWA_NAME` only if you are migrating an older split deployment and want a handle for cleanup in §4b.

### 4.3 Storage account + Azure Files share for SQLite

```bash
az storage account create \
  --name "$STORAGE_ACCOUNT" \
  --resource-group "$RG" \
  --location "$LOCATION" \
  --sku Standard_LRS \
  --kind StorageV2

# 1 GiB quota — the DB is currently 3 MB, this leaves room to grow.
az storage share-rm create \
  --resource-group "$RG" \
  --storage-account "$STORAGE_ACCOUNT" \
  --name "$FILE_SHARE" \
  --quota 1

# Capture the access key for the workflow secrets.
export STORAGE_KEY=$(az storage account keys list \
  --resource-group "$RG" --account-name "$STORAGE_ACCOUNT" \
  --query '[0].value' -o tsv)
```

### 4.4 Container Apps environment

```bash
az containerapp env create \
  --name "$ACA_ENV" \
  --resource-group "$RG" \
  --location "$LOCATION"
```

Register the file share as a named storage in the env:

```bash
az containerapp env storage set \
  --name "$ACA_ENV" \
  --resource-group "$RG" \
  --storage-name "$ACA_STORAGE_NAME" \
  --azure-file-account-name "$STORAGE_ACCOUNT" \
  --azure-file-account-key "$STORAGE_KEY" \
  --azure-file-share-name "$FILE_SHARE" \
  --access-mode ReadWrite
```

### 4.5 Container App (serves SPA + API, always-on)

The first create uses a placeholder image; the deploy workflow will roll the
real GHCR image in afterward.

```bash
az containerapp create \
  --name "$ACA_NAME" \
  --resource-group "$RG" \
  --environment "$ACA_ENV" \
  --image mcr.microsoft.com/azuredocs/containerapps-helloworld:latest \
  --target-port 8080 \
  --ingress external \
  --min-replicas 1 \
  --max-replicas 1 \
  --cpu 0.5 --memory 1.0Gi \
  --env-vars DB_PATH=/data/lacrosse.db PORT=8080 NODE_ENV=production
```

Attach the volume mount (Azure CLI doesn't accept volumes on `create`, so we
patch with YAML):

```bash
cat > /tmp/aca-volume.yaml <<EOF
properties:
  template:
    volumes:
      - name: data-vol
        storageType: AzureFile
        storageName: $ACA_STORAGE_NAME
    containers:
      - name: $ACA_NAME
        image: mcr.microsoft.com/azuredocs/containerapps-helloworld:latest
        volumeMounts:
          - volumeName: data-vol
            mountPath: /data
EOF

az containerapp update \
  --name "$ACA_NAME" --resource-group "$RG" \
  --yaml /tmp/aca-volume.yaml
```

### 4.6 GHCR pull access

The image lives at `ghcr.io/$GHCR_OWNER/pll-server`. Make the package
**public** in GitHub (Profile → Packages → pll-server → Settings → Change
visibility) — this is the simplest path and costs nothing. If you must keep it
private, also run:

```bash
az containerapp registry set \
  --name "$ACA_NAME" --resource-group "$RG" \
  --server ghcr.io \
  --username "$GHCR_OWNER" \
  --password "<github-PAT-with-read:packages>"
```

### 4.7 Service principal for GitHub Actions

```bash
SUB_ID=$(az account show --query id -o tsv)

az ad sp create-for-rbac \
  --name "pll-github-deployer" \
  --role contributor \
  --scopes "/subscriptions/$SUB_ID/resourceGroups/$RG" \
  --sdk-auth
```

Copy the **entire JSON output** — you'll paste it into the
`AZURE_CREDENTIALS` GitHub secret verbatim.

---

## 4b. Migration log: SWA → single-container ACA (completed 2026-06-24)

All steps below were completed on 2026-06-24. This section is kept as an audit trail.

### ✅ Step 1: Set min-replicas=1
```bash
az containerapp update --name pll-server --resource-group pll-rg --min-replicas 1
```

### ✅ Step 2: Custom domain already bound on ACA
`phillylaxstats.com`, `www.phillylaxstats.com`, and `api.phillylaxstats.com` were already bound to ACA with managed TLS certs. No new binding required.

### ✅ Step 3: DNS updated via Namecheap API
- `phillylaxstats.com` A record → `4.156.244.210` (ACA IP)
- `www.phillylaxstats.com` CNAME → `pll-server.proudwave-03a07ae1.eastus.azurecontainerapps.io`
- All Azure domain-verification TXT records preserved

### ✅ Step 4: SWA deleted
```bash
az staticwebapp delete --name pll-web --resource-group pll-rg --yes
```

### ✅ Step 5: Stale GitHub secret removed
```bash
gh secret delete AZURE_STATIC_WEB_APPS_API_TOKEN
```

## 5. GitHub repo secrets to set

Settings → Secrets and variables → Actions → **New repository secret**.

| Secret                            | Value source                                                          | Used by                     |
| --------------------------------- | --------------------------------------------------------------------- | --------------------------- |
| `AZURE_CREDENTIALS`               | full JSON from `az ad sp create-for-rbac --sdk-auth` (§4.7)           | deploy, ingest-nightly      |
| `AZURE_STATIC_WEB_APPS_API_TOKEN` | ~~`az staticwebapp secrets list …`~~ | ~~deploy~~ — **no longer needed after SWA removal** |
| `ACA_RESOURCE_GROUP`              | `pll-rg` (your `$RG`)                                                 | deploy, ingest-nightly      |
| `ACA_NAME`                        | `pll-server` (your `$ACA_NAME`)                                       | deploy, ingest-nightly      |
| `AZURE_STORAGE_ACCOUNT`           | `$STORAGE_ACCOUNT`                                                    | ingest-nightly              |
| `AZURE_STORAGE_KEY`               | `$STORAGE_KEY` from §4.3                                              | ingest-nightly              |
| `DISCORD_WEBHOOK_URL` *(optional)*| Discord channel webhook                                               | ingest-nightly anomaly ping |

You can do it from the CLI instead:

```bash
gh secret set AZURE_CREDENTIALS              < sp.json
# Legacy only during migration: AZURE_STATIC_WEB_APPS_API_TOKEN (remove after SWA cleanup)
gh secret set ACA_RESOURCE_GROUP              -b "$RG"
gh secret set ACA_NAME                        -b "$ACA_NAME"
gh secret set AZURE_STORAGE_ACCOUNT           -b "$STORAGE_ACCOUNT"
gh secret set AZURE_STORAGE_KEY               -b "$STORAGE_KEY"
```

---

## 6. First deploy

```bash
# Trigger the deploy workflow manually (or just push to main).
gh workflow run deploy.yml
gh run watch
```

What happens:

1. `build-and-test` - installs dependencies, optionally regenerates the sitemap from Azure Files, then typechecks and runs tests.
2. `deploy-server` - downloads the latest DB seed, builds + pushes `ghcr.io/<owner>/pll-server:sha-<sha>` (including `packages/web/dist`), then runs `azure/container-apps-deploy-action@v2` to roll the new revision.

URL:

```bash
az containerapp show --name "$ACA_NAME" --resource-group "$RG" --query properties.configuration.ingress.fqdn -o tsv
```

The same ACA hostname now serves everything:
- `/` -> SPA static files from `packages/web/dist`
- `/api/*` -> Fastify API routes
- `/logos/*` -> `data/logos/`
- Unknown non-API routes -> `index.html` SPA fallback

---

## 7. Custom domain

```bash
# 1. Create CNAME at your DNS provider:
#    pll.example.com  CNAME  <aca-fqdn>

# 2. Add + bind it to the Container App:
az containerapp hostname add \
  --name "$ACA_NAME" \
  --resource-group "$RG" \
  --hostname pll.example.com

az containerapp hostname bind \
  --name "$ACA_NAME" \
  --resource-group "$RG" \
  --hostname pll.example.com \
  --validation-method CNAME
```

ACA supports managed TLS for the bound hostname. If you are migrating from SWA, finish the cleanup steps in §4b.

---

## 8. DB seeding (upload the local SQLite to Azure Files)

Run this **once** so the Container App has data on first cold-start. Re-run
any time you want to push a freshly-rebuilt local DB.

```bash
az storage file upload \
  --account-name "$STORAGE_ACCOUNT" \
  --account-key  "$STORAGE_KEY" \
  --share-name   "$FILE_SHARE" \
  --source       "data/lacrosse.db" \
  --path         "lacrosse.db"

# Verify
az storage file list \
  --account-name "$STORAGE_ACCOUNT" --account-key "$STORAGE_KEY" \
  --share-name "$FILE_SHARE" -o table
```

The nightly workflow does the inverse (download → ingest → upload) every night
at 02:00 ET.

### Nightly ingest order

1. **PhillyLacrosse** — walks the raw-cache HTML posts (scoreboard + summaries).
2. **LaxNumbers PA** — runs immediately after, additive-only for the last 2 days:
   ```
   pnpm --filter @pll/ingest ingest -- \
     --source=laxnumbers --since=YESTERDAY --until=TODAY --apply
   ```
   LaxNumbers never overwrites a game that already has scores from PhillyLacrosse.
   Unknown-team anomalies are persisted to `ingest_anomalies` and surface on
   the `/anomalies` page. No additional secrets are required (public API, no auth).

---

## 9. Cost monitoring

### Set a hard $10/mo budget alert

```bash
SUB_ID=$(az account show --query id -o tsv)

az consumption budget create \
  --budget-name pll-monthly \
  --category Cost \
  --amount 10 \
  --time-grain Monthly \
  --start-date $(date -u +%Y-%m-01) \
  --end-date   $(date -u -v+12m +%Y-%m-01) \
  --resource-group "$RG" \
  --notifications '[{
    "enabled": true,
    "operator": "GreaterThan",
    "threshold": 80,
    "contactEmails": ["you@example.com"]
  }]'
```

### Spot-check current spend

```bash
az consumption usage list --top 20 -o table
```

### Useful Container Apps queries

```bash
# Are replicas staying warm as expected?
az containerapp revision list --name "$ACA_NAME" --resource-group "$RG" \
  --query '[].{name:name, replicas:properties.replicas, active:properties.active}' -o table
```

---

## 10. Troubleshooting

| Symptom                                                            | Likely cause                                                                 | Fix                                                                                              |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| First request after idle takes 15–20 s                             | Container App is still allowed to scale from zero                            | Set `--min-replicas 1` to keep container always-on. The 5-min ping strategy was retired - GitHub Actions scheduler jitter allowed 8-10 min idle gaps. |
| `SQLITE_BUSY: database is locked`                                  | Two writers (server + ingest) hitting the same file at the same time         | Nightly job restarts the revision *after* upload. Don't run ad-hoc `pnpm ingest` against prod.  |
| `Error: Could not locate the bindings file. better_sqlite3.node`   | Native module mismatched between build & runtime stage                       | Rebuild image — both stages must be the same `node:20-alpine`. Don't downgrade base in one stage.|
| Container App returns 503                                          | Image failed health check or app crashed on boot                             | `az containerapp logs show --name $ACA_NAME -g $RG --follow`                                     |
| Web app shows blank page                                           | `packages/web/dist` was not copied into the container image, or the old revision is still live | Rebuild and redeploy the container image, then verify `packages/web/dist/index.html` exists in the image. |
| Direct navigation to a SPA route returns 404                       | Container is serving an old revision without the SPA fallback                | Deploy the latest server image so `setNotFoundHandler` can serve `index.html` for non-API routes. |
| Nightly job: `ResourceNotFound` on file download                   | First run, share is empty                                                    | The workflow already tolerates this — it logs a warning and creates the DB fresh.               |
| `AuthorizationFailed` from `az` in workflow                        | Service principal lost contributor on `$RG` (e.g. RG recreated)              | Re-run `az ad sp create-for-rbac` and update `AZURE_CREDENTIALS` secret.                        |
| GHCR pull `unauthorized`                                           | Package is private and ACA has no registry creds                             | Either make the package public, or run §4.6 to attach a PAT.                                     |
| Deploy workflow queued indefinitely                               | No registered self-hosted runner with `pll` label                            | Start runner on Mac Mini: `cd ~/github-runners/Philly-Lax-Viz && nohup ./run.sh >> runner.log 2>&1 &` — see §CI runner section below. |
| `docker login` fails: `User interaction not allowed (-25308)`     | macOS keychain blocks credential storage in headless runner                  | Fixed in `deploy.yml` by writing base64 credentials directly to `DOCKER_CONFIG/config.json` rather than using `docker/login-action`. |

### Live container logs

```bash
az containerapp logs show \
  --name "$ACA_NAME" --resource-group "$RG" \
  --follow --tail 100
```

---

## 11. Rollback

List revisions, pick a known-good SHA, and switch traffic.

```bash
# 1. List revisions (newest first)
az containerapp revision list \
  --name "$ACA_NAME" --resource-group "$RG" \
  --query '[].{name:name, created:properties.createdTime, image:properties.template.containers[0].image, active:properties.active}' \
  -o table

# 2. Switch to single-revision mode (so we control which one is live)
az containerapp revision set-mode \
  --name "$ACA_NAME" --resource-group "$RG" \
  --mode Single

# 3. Activate the prior good revision
az containerapp revision activate \
  --name "$ACA_NAME" --resource-group "$RG" \
  --revision "<prior-good-revision-name>"

# 4. (optional) Deactivate the bad one
az containerapp revision deactivate \
  --name "$ACA_NAME" --resource-group "$RG" \
  --revision "<bad-revision-name>"
```

To roll back the **DB**, copy a snapshot back into Azure Files:

```bash
az storage file upload \
  --account-name "$STORAGE_ACCOUNT" --account-key "$STORAGE_KEY" \
  --share-name "$FILE_SHARE" \
  --source "data/lacrosse.db.backup-2026-04-21" \
  --path   "lacrosse.db"

# Then restart the revision so the server reopens the file:
az containerapp revision restart \
  --name "$ACA_NAME" --resource-group "$RG" \
  --revision "$(az containerapp revision list --name $ACA_NAME -g $RG \
                  --query '[?properties.active].name | [0]' -o tsv)"
```

---

## Appendix — files in this lane

```
Dockerfile                              # multi-stage image for @pll/server
.dockerignore
.github/workflows/deploy.yml            # push to main -> single ACA deploy
.github/workflows/ingest-nightly.yml    # cron 06:00 UTC -> Azure Files round-trip
infra/azure-bootstrap.sh                # one-shot az CLI provisioning
docs/azure-deployment.md                # this file
```

---

## Known issues found in W17 smoke test

Local Docker smoke test results (R2, W17 L3) — `docker build && docker run` of
this Dockerfile against `data/lacrosse.db`:

| Symptom | Cause | Fix |
|---|---|---|
| Container exited(1) on first start with `Could not locate the bindings file ... better_sqlite3.node` | pnpm 10 ignores postinstall build scripts by default; the original `pnpm install --frozen-lockfile --ignore-scripts=false` flag is *not* sufficient — pnpm 10 also requires an `onlyBuiltDependencies` allow-list. | Added `pnpm.onlyBuiltDependencies = ["better-sqlite3", "esbuild"]` to root `package.json` and added a `RUN pnpm rebuild better-sqlite3` belt-and-braces line to the builder stage of the `Dockerfile`. After the fix all endpoints return 200 from the running container. |
| The original deploy doc said the leaders endpoint is `/api/leaders/scoring` | Actual route names are `/api/leaders/players?metric=points` and `/api/leaders/teams?metric=wins`. There is no `/leaders/scoring`. | No code change needed — just calling it out so future smoke scripts use the right URL. |

After the Dockerfile + `package.json` fixes, a clean smoke run:

```text
docker build -t pll-lacrosse:test .                 # OK
docker run -d --name pll-test -p 3002:3001 \
  -e PORT=3001 -e DB_PATH=/data/lacrosse.db \
  -v "$(pwd)/data:/data:ro" pll-lacrosse:test       # OK
curl -sf http://localhost:3002/api/health           # 200, schemaVersion=10, seasons=[{year:2026,games:531}]
curl -sf http://localhost:3002/api/freshness        # 200, scoreboardLast/recapsLast/... populated
curl -sf http://localhost:3002/api/teams            # 200, 207 teams
curl -sf 'http://localhost:3002/api/leaders/players?metric=points&season=2026'  # 200
curl -sf http://localhost:3002/api/seasons          # 200
docker stop pll-test && docker rm pll-test          # clean shutdown via tini
```

All five probes returned 200 with the expected JSON shape.

---

## Pre-deployment checklist for the user

Before running `infra/azure-bootstrap.sh` for the first time, you (the human
maintainer) need to decide / collect the following. Nothing else in this repo
can do this for you — these are *your* identity and *your* money.

1. **Azure subscription.** A Pay-as-you-go (or MSDN/free credit) subscription
   you control. Run `az account list -o table` and pick the one for this
   project. Set it: `az account set --subscription "<id>"`.
2. **Resource group name** (default `pll-rg`). Pick something unique to this
   project so cleanup is `az group delete -n <name> --yes`.
3. **Region** (default `eastus`). Container Apps Consumption is available in
   most regions; pick one geographically close to your users. `westus2`,
   `northeurope`, and `eastus2` are good alternates.
4. **Storage account name.** Must be **3-24 chars, lowercase, globally unique**
   (e.g. `pllstorage<your-initials><random>`). The bootstrap script appends
   `$RANDOM` if you don't override `STORAGE_ACCOUNT`.
5. **GHCR owner.** Your GitHub username or org. The image will live at
   `ghcr.io/<owner>/pll-server:<sha>`. Make sure you have a personal access
   token (or an OIDC config) that can push there.
6. **Custom domain (optional).** If you want `pll.example.com` instead of
   `<random>.<region>.azurecontainerapps.io`, you need DNS access to that domain.
   You can add it post-deploy via Azure Container Apps hostname binding.
7. **GitHub OIDC trust** for Azure (recommended over a long-lived service
   principal secret). You will need:
   - Tenant ID (`az account show --query tenantId -o tsv`)
   - Subscription ID (same)
   - Application (client) ID — created during bootstrap
   These three values become the `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`,
   `AZURE_CLIENT_ID` GitHub Actions secrets used by `deploy.yml`.
8. **Budget alert threshold.** Pick a hard ceiling (suggested: $10/mo). The
   bootstrap script can wire this up via `az consumption budget create`.

Tick each item off before you `bash infra/azure-bootstrap.sh`. If any are
missing the script will exit early with a clear message — but it's faster to
just have them ready.

---

## Manual deploy walkthrough

End-to-end, assuming the checklist above is satisfied:

```bash
# 1. One-time: provision Azure resources (RG, storage, file share, ACA env,
#    ACA app, GHCR pull access, Log Analytics workspace).
bash infra/azure-bootstrap.sh

# 2. Set GitHub Actions secrets from §5.
#    Required today: AZURE_CREDENTIALS, ACA_RESOURCE_GROUP, ACA_NAME,
#    AZURE_STORAGE_ACCOUNT, AZURE_STORAGE_KEY.

# 3. Push to main (or merge a PR). The deploy workflow will:
#    - build + test the monorepo
#    - build + push the server image to ghcr.io/<owner>/pll-server:<sha>
#      (including packages/web/dist)
#    - update the Container App to the new image
git push origin main

# 4. Watch it deploy:
gh run watch

# 5. Smoke the live site once Actions go green:
curl -sf https://pll-server.<random>.<region>.azurecontainerapps.io/api/health
curl -sf https://pll-server.<random>.<region>.azurecontainerapps.io/
```

The first deploy takes ~6-8 minutes (image push + container revision spin-up).
Subsequent deploys are ~3-4 minutes.

---

## Cost estimate refinement (post-W17)

The W17 smoke test ran the image locally for ~1 minute total across rebuilds
and probes. Real production usage will dominate the cost; nothing in W17
testing changed the original estimate. Two notes:

- The image is ~250 MB compressed (Node 20 alpine + node_modules + native
  better-sqlite3). GHCR storage for this is free; ACA cold-start pulls cost
  nothing extra inside the same Azure region.
- The new `/api/freshness` and `/api/health` endpoints query the SQLite file
  on every hit (no caching). At >1 req/s sustained you'd want to add a 30 s
  in-memory cache; below that the queries are sub-millisecond and not worth
  optimising.

Bottom line: with `--min-replicas 1`, expect **~$5-10/mo** for typical traffic; a **$10/mo** budget alert remains a safe ceiling.

---

## Local fallback (when GitHub Actions / Mac Mini runner is unavailable)

The normal CI path (`push to main → deploy workflow → Mac Mini runner`) can be
blocked if the runner is offline or Docker credentials have expired. In that
case, deploy directly from your local workstation in ~5 minutes.

### Prerequisites (one-time)

```bash
# Ensure Docker is running locally (Docker Desktop or OrbStack)
docker info

# Add write:packages scope to your gh token so you can push to GHCR
gh auth refresh -s write:packages
# → opens a browser flow; approve it, then come back

# Log in to GHCR with the refreshed token
gh auth token | docker login ghcr.io -u DaveVoyles --password-stdin
# → "Login Succeeded"
```

### Build, push, and deploy

```bash
# 1. Build the image for linux/amd64 and push to GHCR
SHA=$(git rev-parse HEAD)
docker buildx build \
  --platform linux/amd64 \
  --tag "ghcr.io/davevoyles/pll-server:sha-${SHA}" \
  --tag "ghcr.io/davevoyles/pll-server:latest" \
  --push \
  .

# 2. Update the Container App to the new image
az containerapp update \
  --name pll-server \
  --resource-group pll-rg \
  --image "ghcr.io/davevoyles/pll-server:sha-${SHA}"

# 3. Verify
curl -sf https://phillylaxstats.com/api/health
curl -I https://phillylaxstats.com/
```

The `docker buildx build` step takes 3–6 minutes on the first run (amd64
cross-compile via QEMU), but subsequent runs are fast because most layers are
cached locally.

> **Note on Docker caching:** If source files changed but the build is fully
> cached, the Docker layer cache may not have detected file modifications. Add
> `--no-cache-filter builder` to force a rebuild of the source/compile stages
> without invalidating the base image layers.

---

## CI runner (Mac Mini self-hosted runner)

The `deploy.yml` workflow runs on a self-hosted runner tagged `[self-hosted, pll]`.

### Runner location

```
~/github-runners/Philly-Lax-Viz/   (on daves-mac-mini.local)
```

### Starting the runner

```bash
ssh daves-mac-mini.local
cd ~/github-runners/Philly-Lax-Viz
nohup ./run.sh > runner.log 2>&1 &
tail -f runner.log   # should show: "Listening for Jobs"
```

### Known issues

| Issue | Cause | Fix |
|-------|-------|-----|
| Runner stops listening after a failed job | GitHub runner process exits on certain failures | Restart manually: `pkill -f 'Philly-Lax-Viz.*Runner' && nohup ./run.sh >> runner.log 2>&1 &` |
| Docker login fails: `User interaction is not allowed (-25308)` | macOS keychain blocks headless credential storage | The `deploy.yml` workflow writes the GITHUB_TOKEN directly as base64 into the Docker config `auths` section — this bypasses the credential helper entirely |
| `docker buildx`: error getting credentials | Buildkit runs in a separate process and ignores credential helpers | Fixed in `deploy.yml`: credentials are pre-written to `DOCKER_CONFIG/config.json` before the build step |
| `PATH` missing `az` or `docker` | Runner uses a minimal shell PATH | Runner `.env` at `~/github-runners/Philly-Lax-Viz/.env` sets `PATH=/opt/homebrew/bin:/usr/local/bin:...` |
| `write:packages` scope needed | GitHub token must have this scope to push to GHCR | `gh auth refresh -s write:packages` on the machine running the build |

### Runner environment files

- `~/.github-runners/Philly-Lax-Viz/.env` — sets `PATH` and `DOCKER_CONFIG`
- `~/github-runners/Philly-Lax-Viz/.docker/config.json` — Docker config with `orbstack` context
