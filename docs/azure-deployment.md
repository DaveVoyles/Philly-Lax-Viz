# Azure deployment — Philly Lacrosse Vis

Low-cost, scale-to-zero deployment of the PLL stack:

- **Web** (`@pll/web` — Vite/D3) → **Azure Static Web Apps** (Free tier, global CDN, custom domain).
- **API** (`@pll/server` — Fastify + better-sqlite3) → **Azure Container Apps** (Consumption plan, scale-to-zero).
- **DB** (`data/lacrosse.db`) → **baked into the container image** as a seed; copied to ephemeral `/tmp` on container start. Regenerated nightly by the ingest cron, so transient loss on cold-start is acceptable.

> **Live deployment** (as of v3): SWA at `https://victorious-pond-0c5ff000f.7.azurestaticapps.net` · API at `https://phillylaxstats.com` · ACR `adovizacr1771621563.azurecr.io`.

> ### Deployment learnings (v3, baked from real run)
>
> 1. **Static Web Apps region**: SWA is **not** available in `eastus`. The bootstrap script provisions SWA in `eastus2` (separate `SWA_LOCATION` var) while the rest of the stack stays in `eastus`.
> 2. **SQLite on Azure Files (SMB) is broken** for this workload. Even with `journal_mode=DELETE`, SMB does not support the byte-range locks SQLite needs for the migration transaction → `SQLITE_BUSY` on every start. **Solution**: don't put SQLite on SMB. Set `DB_PATH=/tmp/lacrosse.db` so the DB lives on the container's ephemeral disk, and bake the seed DB into the image so cold-starts are populated. The Azure Files share + volume mount can be removed entirely.
> 3. **Container Registry**: GHCR push needs the `write:packages` scope, which `gh auth refresh` only grants via interactive browser. **Use ACR** (admin user enabled) for non-interactive `docker push` from CI or local. Bootstrap creates the ACR.
> 4. **`az containerapp update --image` does not always replace the running image**. Pair it with `--revision-suffix vN` to force a new revision: `az containerapp update -n pll-server -g pll-rg --image .../pll-server:v3 --revision-suffix v3 --set-env-vars DB_PATH=/tmp/lacrosse.db`.
> 5. **GitHub Actions billing**: if the account hits a spending-limit error, the deploy.yml workflow fails before doing anything. Local docker push to ACR + `az containerapp update` is the documented fallback (see "Local fallback" below).

> The server already honours `DB_PATH` (preferred) and `PLL_DB_PATH` (legacy) env
> vars and listens on `process.env.PORT` (defaults to 3001 locally; we set 8080
> in the container). No code changes are required to deploy.

---

## 1. Cost estimate

Numbers are list price for `eastus`, single low-traffic instance.

| Resource                                              | SKU                          | Est. monthly |
| ----------------------------------------------------- | ---------------------------- | -----------: |
| Azure Static Web Apps                                 | Free                         |       **$0** |
| Azure Container Apps (Consumption, scale-to-zero)     | 0.5 vCPU / 1 GiB, ~5 min/day |     ~**$1**¹ |
| Azure Files (Standard LRS, 1 GiB share)               | Standard_LRS                 |    ~**$0.06** |
| Storage transactions (nightly upload + reads)         | <100k/mo                     |    ~**$0.10** |
| Container Registry (we use **GHCR**, not ACR)         | n/a                          |       **$0** |
| Egress (≤1 GiB/mo while traffic is light)             | First 100 GiB free           |       **$0** |
| Log Analytics (default ACA logs, 5 GB free)           | Pay-as-you-go                |    ~**$0–2** |
| **Total**                                             |                              |  **~$1–4/mo** |

¹ Container Apps Consumption: first **180,000 vCPU-seconds** and **360,000 GiB-seconds**
   per month are free per subscription. With scale-to-zero + ~5 min of warm time per
   day this stays inside the free grant for almost any month. Budget **$8/mo** to
   cover spikes (cold-start traffic, occasional manual pulls).

Set a hard budget alert (see [§9](#9-cost-monitoring)).

---

## 2. Architecture

```
                ┌──────────────────────────────┐
   browser  ──► │  Azure Static Web Apps       │  (Free, global CDN)
                │  - serves packages/web/dist  │
                └──────────────┬───────────────┘
                               │ /api/* fetch
                               ▼
                ┌──────────────────────────────┐
                │  Azure Container Apps        │  (Consumption, scale 0→1)
                │  Image: ghcr.io/<owner>/     │
                │         pll-server:<sha>     │
                │  Env:   DB_PATH=/data/...    │
                │  Mount: /data ──┐            │
                └──────────────┬──┘            │
                               ▼               │
                ┌──────────────────────────────┴┐
                │  Azure Files share `pll-data` │  (1 GiB, Standard LRS)
                │  └─ lacrosse.db               │
                └──────────────┬────────────────┘
                               ▲
                               │ nightly upload
                ┌──────────────┴───────────────┐
                │  GitHub Actions              │
                │  - deploy.yml      (push)    │
                │  - ingest-nightly.yml (cron) │
                └──────────────────────────────┘
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
export SWA_NAME=pll-web
export ACA_ENV=pll-env
export ACA_NAME=pll-server
export ACA_STORAGE_NAME=plldata               # the *named* mount inside ACA env
export GHCR_OWNER=<your-github-username-or-org>
```

### 4.1 Resource group

```bash
az group create --name "$RG" --location "$LOCATION"
```

### 4.2 Static Web App (Free)

```bash
az staticwebapp create \
  --name "$SWA_NAME" \
  --resource-group "$RG" \
  --location "$LOCATION" \
  --sku Free
```

Grab the deployment token (you'll paste this into GitHub):

```bash
az staticwebapp secrets list \
  --name "$SWA_NAME" --resource-group "$RG" \
  --query 'properties.apiKey' -o tsv
```

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

### 4.5 Container App (with `/data` mount, scale-to-zero)

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
  --min-replicas 0 \
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

## 5. GitHub repo secrets to set

Settings → Secrets and variables → Actions → **New repository secret**.

| Secret                            | Value source                                                          | Used by                     |
| --------------------------------- | --------------------------------------------------------------------- | --------------------------- |
| `AZURE_CREDENTIALS`               | full JSON from `az ad sp create-for-rbac --sdk-auth` (§4.7)           | deploy, ingest-nightly      |
| `AZURE_STATIC_WEB_APPS_API_TOKEN` | `az staticwebapp secrets list … --query properties.apiKey` (§4.2)     | deploy                      |
| `ACA_RESOURCE_GROUP`              | `pll-rg` (your `$RG`)                                                 | deploy, ingest-nightly      |
| `ACA_NAME`                        | `pll-server` (your `$ACA_NAME`)                                       | deploy, ingest-nightly      |
| `AZURE_STORAGE_ACCOUNT`           | `$STORAGE_ACCOUNT`                                                    | ingest-nightly              |
| `AZURE_STORAGE_KEY`               | `$STORAGE_KEY` from §4.3                                              | ingest-nightly              |
| `DISCORD_WEBHOOK_URL` *(optional)*| Discord channel webhook                                               | ingest-nightly anomaly ping |

You can do it from the CLI instead:

```bash
gh secret set AZURE_CREDENTIALS              < sp.json
gh secret set AZURE_STATIC_WEB_APPS_API_TOKEN -b "<token>"
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

1. `build-and-test` — installs, typechecks, runs all tests, builds web bundle.
2. `deploy-web` — uploads `packages/web/dist` to the Static Web App.
3. `deploy-server` — builds + pushes `ghcr.io/<owner>/pll-server:sha-<sha>`,
   then runs `azure/container-apps-deploy-action@v2` to roll the new revision.

URLs:

```bash
az staticwebapp show       --name "$SWA_NAME"   --resource-group "$RG" --query defaultHostname -o tsv
az containerapp show       --name "$ACA_NAME"   --resource-group "$RG" --query properties.configuration.ingress.fqdn -o tsv
```

Wire the SWA to call the Container App by setting the API base in the web bundle
(or via SWA's "linked backends" if/when SWA adds Container Apps as a first-class
linked backend). The simplest thing today is a same-origin proxy via
`staticwebapp.config.json`:

```json
{
  "routes": [
    { "route": "/api/*", "rewrite": "https://<aca-fqdn>/api/{*api}" }
  ]
}
```

Place that file in `packages/web/dist` (or `packages/web/public`) before the
deploy step.

---

## 7. Custom domain

```bash
# 1. Create CNAME at your DNS provider:
#    pll.example.com  CNAME  <swa-default-hostname>

# 2. Bind it to the SWA (will validate the CNAME):
az staticwebapp hostname set \
  --name "$SWA_NAME" \
  --resource-group "$RG" \
  --hostname pll.example.com
```

The Free SKU supports custom domains + auto-managed TLS at no extra cost.

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

### Set a hard $8/mo budget alert

```bash
SUB_ID=$(az account show --query id -o tsv)

az consumption budget create \
  --budget-name pll-monthly \
  --category Cost \
  --amount 8 \
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
# Are we actually scaling to zero overnight?
az containerapp revision list --name "$ACA_NAME" --resource-group "$RG" \
  --query '[].{name:name, replicas:properties.replicas, active:properties.active}' -o table
```

---

## 10. Troubleshooting

| Symptom                                                            | Likely cause                                                                 | Fix                                                                                              |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| First request after idle takes 5–10 s                              | Container App cold start (scale-from-zero)                                   | Expected on Consumption. Set `--min-replicas 1` (≈ $5–8/mo extra) if unacceptable.               |
| `SQLITE_BUSY: database is locked`                                  | Two writers (server + ingest) hitting the same file at the same time         | Nightly job restarts the revision *after* upload. Don't run ad-hoc `pnpm ingest` against prod.  |
| `Error: Could not locate the bindings file. better_sqlite3.node`   | Native module mismatched between build & runtime stage                       | Rebuild image — both stages must be the same `node:20-alpine`. Don't downgrade base in one stage.|
| Container App returns 503                                          | Image failed health check or app crashed on boot                             | `az containerapp logs show --name $ACA_NAME -g $RG --follow`                                     |
| Web app shows blank page                                           | Wrong `app_location` / missing `index.html` in upload                        | Confirm `packages/web/dist/index.html` exists in the artifact, redeploy.                         |
| `/api/*` returns 404 from SWA                                      | Missing `staticwebapp.config.json` rewrite to ACA FQDN                       | Add the rewrite (see [§6](#6-first-deploy)) and redeploy.                                         |
| Nightly job: `ResourceNotFound` on file download                   | First run, share is empty                                                    | The workflow already tolerates this — it logs a warning and creates the DB fresh.               |
| `AuthorizationFailed` from `az` in workflow                        | Service principal lost contributor on `$RG` (e.g. RG recreated)              | Re-run `az ad sp create-for-rbac` and update `AZURE_CREDENTIALS` secret.                        |
| GHCR pull `unauthorized`                                           | Package is private and ACA has no registry creds                             | Either make the package public, or run §4.6 to attach a PAT.                                     |

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
.github/workflows/deploy.yml            # push to main -> SWA + ACA
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
   `<random>.azurestaticapps.net`, you need DNS access to that domain. You
   can add it post-deploy via Azure Portal → Static Web Apps → Custom domains.
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
#    SWA, GHCR pull secret, Log Analytics workspace).
bash infra/azure-bootstrap.sh

# 2. Set GitHub Actions secrets (the bootstrap script prints these values).
#    The deploy workflow needs them to authenticate to Azure + push to GHCR.
gh secret set AZURE_TENANT_ID       --body "<from-bootstrap>"
gh secret set AZURE_SUBSCRIPTION_ID --body "<from-bootstrap>"
gh secret set AZURE_CLIENT_ID       --body "<from-bootstrap>"
gh secret set AZURE_RG              --body "pll-rg"
gh secret set AZURE_ACA_NAME        --body "pll-server"
gh secret set AZURE_SWA_TOKEN       --body "<from az staticwebapp secrets list>"

# 3. Push to main (or merge a PR). The deploy workflow will:
#    - build the web bundle and ship it to Static Web Apps
#    - build + push the server image to ghcr.io/<owner>/pll-server:<sha>
#    - update the Container App to the new image
git push origin main

# 4. Watch it deploy:
gh run watch

# 5. Smoke the live API once Actions go green:
curl -sf https://pll-server.<random>.<region>.azurecontainerapps.io/api/health
curl -sf https://pll-server.<random>.<region>.azurecontainerapps.io/api/freshness
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

Bottom line: still **~$1-4/mo** for typical traffic; **$8/mo** budget alert
remains a safe ceiling.

---

## Local fallback (when GitHub Actions is unavailable)

If CI is blocked (billing, secrets rotation, etc.), deploy directly from a workstation:

```bash
# 1. Build amd64 image with seed DB baked in
docker buildx build --platform linux/amd64 \
  -t adovizacr1771621563.azurecr.io/pll-server:vN --load .

# 2. Push to ACR (uses admin creds from `az acr credential show`)
az acr login -n adovizacr1771621563
docker push adovizacr1771621563.azurecr.io/pll-server:vN

# 3. Roll the container app to the new image (force new revision)
az containerapp update -n pll-server -g pll-rg \
  --image adovizacr1771621563.azurecr.io/pll-server:vN \
  --revision-suffix vN \
  --set-env-vars DB_PATH=/tmp/lacrosse.db PORT=8080 NODE_ENV=production

# 4. Verify
curl https://phillylaxstats.com/api/health

# 5. Build + deploy the web bundle to SWA
VITE_API_BASE_URL=https://phillylaxstats.com \
  pnpm --filter @pll/web build
SWA_TOKEN=$(az staticwebapp secrets list -n pll-web -g pll-rg --query "properties.apiKey" -o tsv)
npx -y @azure/static-web-apps-cli deploy packages/web/dist \
  --deployment-token "$SWA_TOKEN" --env production
```
