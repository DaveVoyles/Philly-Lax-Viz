# 09 — GitHub-hosted runner + OIDC-backed Azure deploys

> **Status:** partially resolved · **Owner:** DevOps lane · **Priority:** P2 (runner works; OIDC migration is optional hardening)

> **2026-06-25 update:** The Mac Mini self-hosted runner (`[self-hosted, pll]`) is back online and all CI workflows are functioning. The `deploy.yml` Docker context bug (hardcoded `"currentContext":"orbstack"`) that was causing failures was fixed in commit `fb0947d`. Deploys now succeed consistently. The remaining open item from this RFC is migrating from service-principal credentials to OIDC federation — worthwhile for security but not blocking anything today.

---

## Motivation

Every workflow in this repo declares `runs-on: [self-hosted, pll]`. The
self-hosted runner that label points to is **gone** — `gh api
/repos/<owner>/<repo>/actions/runners` returns `total_count: 0`, and the same
is true at the org level. Concretely this means:

- `deploy.yml` does not run on push to `main`. The web bundle and the server
  image have not been rebuilt by CI in weeks.
- `ingest-nightly.yml` does not run at 06:00 UTC. The DB on Azure Files is
  stale; nightly anomaly deltas to Discord stopped silently.
- `snapshot-db-nightly.yml` does not run. We have no off-host backup.
- Every push to `main` queues a job that will never start. The Actions tab
  shows a growing pile of yellow "Queued" runs that masks real failures.

Today's manual deploy (v11) took **30+ minutes** and hit three discrete
failures, two of which CI would have caught:

1. Malformed `--command` override on `az containerapp update` — would have
   been caught by a smoke test step.
2. Stale ACR admin credentials — would not exist at all under managed-identity
   auth.
3. Un-checkpointed SQLite WAL on the seed DB baked into the image — would
   have been caught by a pre-build validation gate (covered in
   [#10](./10-pre-deploy-validation-and-rollback.md)).

The self-hosted runner was on a Mac Mini at home. It is not coming back.
We need CI to work without any local infrastructure, with secrets that
cannot leak or expire, and with a deploy that does not require a human at
a terminal.

## Current state

- **Workflows:** three files in `.github/workflows/`, all pinned to
  `[self-hosted, pll]`.
- **Auth to Azure:** `secrets.AZURE_CREDENTIALS` — a JSON service-principal
  blob with a client secret. Rotates manually, has no expiry alarm.
- **Auth to ACR:** username + password (admin user enabled on the registry).
  Today's deploy failed because the cached password in `~/.docker/config.json`
  was stale. Same credential is also in the `AZURE_CREDENTIALS` secret blob
  for CI.
- **Auth to Azure Files (ingest workflow):** `AZURE_STORAGE_KEY` — a
  storage-account access key. Long-lived, full-access, no rotation policy.
- **Image registry:** `deploy.yml` pushes to **GHCR** (`ghcr.io/<owner>/pll-server`),
  but the manual deploy workflow uses **ACR** (`adovizacr1771621563.azurecr.io`).
  Two registries, divergent tags, no single source of truth for what is in
  production.
- **Web deploy:** `deploy.yml` ships to Azure Static Web Apps via
  `AZURE_STATIC_WEB_APPS_API_TOKEN`, but per the v3 deployment notes the
  SWA resource may not currently be provisioned. Web changes have only ever
  reached production through local `az` runs.

## Proposed design

Three changes, in order of payoff:

### 1. Move every workflow to `runs-on: ubuntu-latest`

GitHub-hosted runners are free for public repos and effectively free for
this repo's volume on a personal account (well under the 2,000 free
private-repo minutes/month). We trade the Mac Mini's local DB cache for a
3-line `az storage file download` step, which we already do.

```diff
- runs-on: [self-hosted, pll]
+ runs-on: ubuntu-latest
```

Drop the conditional Azure-CLI install (`if ! command -v az ...`) — `az` is
preinstalled on `ubuntu-latest`. Net workflow becomes shorter, not longer.

### 2. Replace `AZURE_CREDENTIALS` with workload-identity federation (OIDC)

Federated credentials let `azure/login@v2` exchange the workflow's OIDC
token for an Azure access token at runtime. **No client secret stored
anywhere.** Setup is one-time:

```bash
# Variables
RG=pll-rg
SUB_ID=$(az account show --query id -o tsv)
APP_NAME=pll-github-actions
REPO=<owner>/<repo>

# 1. Create app registration + service principal
APP_ID=$(az ad app create --display-name "$APP_NAME" --query appId -o tsv)
az ad sp create --id "$APP_ID"
SP_OBJ_ID=$(az ad sp show --id "$APP_ID" --query id -o tsv)

# 2. Grant minimum roles on the resource group only (NOT subscription-wide)
az role assignment create --assignee "$APP_ID" --role "Contributor" \
  --scope "/subscriptions/$SUB_ID/resourceGroups/$RG"
az role assignment create --assignee "$APP_ID" --role "AcrPush" \
  --scope "/subscriptions/$SUB_ID/resourceGroups/$RG/providers/Microsoft.ContainerRegistry/registries/adovizacr1771621563"

# 3. Federated credential — one per (repo, ref) pair we deploy from
az ad app federated-credential create --id "$APP_ID" --parameters '{
  "name": "main-branch",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "repo:'"$REPO"':ref:refs/heads/main",
  "audiences": ["api://AzureADTokenExchange"]
}'

# 4. (Optional) one for workflow_dispatch from any branch
az ad app federated-credential create --id "$APP_ID" --parameters '{
  "name": "workflow-dispatch",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "repo:'"$REPO"':environment:production",
  "audiences": ["api://AzureADTokenExchange"]
}'

# 5. Set repo secrets (no client secret needed!)
gh secret set AZURE_CLIENT_ID    --body "$APP_ID"
gh secret set AZURE_TENANT_ID    --body "$(az account show --query tenantId -o tsv)"
gh secret set AZURE_SUBSCRIPTION_ID --body "$SUB_ID"
```

Workflow change:

```yaml
permissions:
  contents: read
  id-token: write       # required for OIDC
  packages: write       # only if keeping GHCR push

steps:
  - uses: azure/login@v2
    with:
      client-id:       ${{ secrets.AZURE_CLIENT_ID }}
      tenant-id:       ${{ secrets.AZURE_TENANT_ID }}
      subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}
```

`AZURE_CREDENTIALS` is deleted. So is the rotation calendar reminder we
never set.

### 3. Consolidate on ACR + managed identity for pull

Pick **one** registry. ACR is already provisioned, already used by the
running container, and is in the same RG as ACA — that's the right call.
Stop pushing to GHCR.

Replace ACR admin-user auth with a system-assigned managed identity on the
Container App:

```bash
# Enable system-assigned identity on the app
az containerapp identity assign \
  --name pll-server --resource-group pll-rg --system-assigned

# Grant AcrPull to that identity
PRINCIPAL=$(az containerapp show -n pll-server -g pll-rg \
  --query identity.principalId -o tsv)
ACR_ID=$(az acr show -n adovizacr1771621563 -g pll-rg --query id -o tsv)
az role assignment create --assignee "$PRINCIPAL" --role AcrPull --scope "$ACR_ID"

# Tell the app to use that identity for registry auth
az containerapp registry set \
  --name pll-server --resource-group pll-rg \
  --server adovizacr1771621563.azurecr.io \
  --identity system

# Disable admin user — it's no longer the auth path
az acr update -n adovizacr1771621563 --admin-enabled false
```

Today's "stale ACR creds" failure mode is now structurally impossible.

The CI push step uses the federated SP's `AcrPush` role:

```yaml
- name: Build + push to ACR
  run: |
    az acr login --name adovizacr1771621563
    docker buildx build --push \
      --tag adovizacr1771621563.azurecr.io/pll-server:${{ github.sha }} \
      --tag adovizacr1771621563.azurecr.io/pll-server:latest \
      --cache-from type=gha --cache-to type=gha,mode=max \
      .

- name: Update Container App revision
  run: |
    az containerapp update \
      --name pll-server --resource-group pll-rg \
      --image adovizacr1771621563.azurecr.io/pll-server:${{ github.sha }} \
      --revision-suffix "sha${GITHUB_SHA:0:7}"
```

### 4. Replace `AZURE_STORAGE_KEY` in `ingest-nightly.yml`

The federated SP gets `Storage File Data SMB Share Contributor` on the
share, and the workflow uses `--auth-mode login`:

```bash
az role assignment create --assignee "$APP_ID" \
  --role "Storage File Data SMB Share Contributor" \
  --scope "/subscriptions/$SUB_ID/resourceGroups/$RG/providers/Microsoft.Storage/storageAccounts/<account>/fileServices/default/fileshares/pll-data"
```

```diff
- env:
-   AZURE_STORAGE_ACCOUNT: ${{ secrets.AZURE_STORAGE_ACCOUNT }}
-   AZURE_STORAGE_KEY:     ${{ secrets.AZURE_STORAGE_KEY }}
- run: az storage file download --account-name ... --account-key ... ...
+ run: |
+   az storage file download \
+     --account-name "${{ secrets.AZURE_STORAGE_ACCOUNT }}" \
+     --share-name pll-data --path lacrosse.db --dest data/lacrosse.db \
+     --auth-mode login --enable-file-backup-request-intent
```

`AZURE_STORAGE_KEY` is then deleted from repo secrets.

## Scope

In:

- Edit all three workflow files: `runs-on`, login step, registry auth, storage auth.
- One-time Azure setup: app registration, federated credentials, role
  assignments, managed identity on the Container App.
- Delete deprecated repo secrets: `AZURE_CREDENTIALS`, `AZURE_STORAGE_KEY`,
  ACR admin credentials.
- Update `docs/azure-deployment.md` §4 and §6 to reflect OIDC + MI auth.
- Decommission the self-hosted runner registration (already offline) so it
  stops appearing in repo settings.

Out:

- Pre-deploy validation gates and rollback — see [#10](./10-pre-deploy-validation-and-rollback.md).
- Web hosting decision (SWA vs server-side static) — separate proposal.
- Application Insights / observability — separate proposal.
- Migrating off Azure Files for the DB — covered by the existing v3
  workaround (DB baked in image, copied to `/tmp`).

## Validation plan

1. **Dry-run on a branch.** Create `chore/oidc-migration`, change
   `deploy.yml` only, push, trigger via `workflow_dispatch`. Confirm:
   - Job picks up on `ubuntu-latest` within 10 s.
   - `azure/login@v2` succeeds with no client secret.
   - `az acr login` succeeds via the federated token.
   - Image push lands in ACR with the SHA tag.
   - `az containerapp update` creates a new revision.
2. **Smoke check the new revision** — `curl -fsS
   https://pll-server.proudwave-03a07ae1.eastus.azurecontainerapps.io/api/health`
   returns `{"ok":true}`. (Step #10 makes this part of the pipeline.)
3. **Repeat for `ingest-nightly.yml`.** Trigger manually, confirm DB
   download/upload works under `--auth-mode login`, confirm anomaly count
   posts to Discord.
4. **Repeat for `snapshot-db-nightly.yml`.**
5. **Rotate-by-deletion test.** Delete `AZURE_CREDENTIALS` from repo
   secrets. Re-run all three workflows. Anything that still depends on it
   will fail loudly.
6. **Cost check.** After 7 days, look at Actions usage in repo settings;
   expect well under 200 minutes/month total. Look at ACR pull telemetry
   (`az monitor metrics list ...`) to confirm MI-based pulls succeed.

## Effort estimate

| Task | Effort |
| --- | --- |
| App registration + federated creds + role assignments | 30 min |
| Edit 3 workflow files (runs-on, login, registry auth) | 45 min |
| MI on Container App + ACR admin disable | 20 min |
| Doc updates (`azure-deployment.md`) | 30 min |
| Per-workflow validation runs | 60 min |
| Buffer for first-run weirdness | 60 min |
| **Total** | **~4 hours, single sitting** |

## Risk

- **Federated subject mismatch.** The most common OIDC failure: `subject`
  in the federated credential doesn't match the workflow's token (e.g.
  `ref:refs/heads/main` vs `environment:production`). Mitigation: capture
  the actual subject from a failed `azure/login` debug log, then
  `az ad app federated-credential update` to match. Repository-level
  `subject` claims are documented at
  <https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/about-security-hardening-with-openid-connect>.
- **GitHub-hosted runner slower than the Mac Mini.** Cold builds will
  take ~3–5 min instead of ~1 min. Mitigation: GHA cache for pnpm store
  (`actions/setup-node` does this) and Docker BuildKit (`type=gha`
  cache, already enabled in `deploy.yml`).
- **Loss of the local DB cache** in `ingest-nightly.yml`. Currently the
  Mac Mini retains `data/lacrosse.db` between runs as a warm start. On
  GitHub-hosted runners we always download fresh from Azure Files. This
  is actually the correct behaviour — anything else risks divergence.
  Adds ~30 s per run for the download.
- **`Storage File Data SMB Share Contributor` is RBAC-on-files**, which
  some older `az storage file` commands don't honour without
  `--enable-file-backup-request-intent`. Mitigation: pin `azure-cli` to
  ≥ 2.61 (the `ubuntu-latest` baseline already exceeds this) and include
  the flag explicitly.
- **Spending-limit billing failure** (called out in `azure-deployment.md`)
  is unrelated to this change but reappears the moment CI starts running
  again. Mitigation: confirm the GitHub account has a payment method on
  file before merging, or accept that overflow runs simply queue.

## Open questions

1. Do we keep pushing to GHCR in parallel for any reason (e.g. public
   pull, contributor convenience)? Default answer: no, ACR only.
2. Should the federated subject be scoped to a GitHub Environment named
   `production` so we get the manual-approval gate for free? Likely yes —
   pairs naturally with the rollout gate in #10.
3. Do we want a second app registration with **read-only** roles for PR
   workflows (typecheck/test only, no deploy)? Probably yes once we add
   PR CI; out of scope for this proposal.
4. Self-hosted runner: tear down the docker-compose stack on the Mac Mini
   entirely, or leave it stopped in case we want to bring it back for
   beefier ingest jobs? Default: tear down — dead infra accretes bit-rot.
