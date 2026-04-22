#!/usr/bin/env bash
# infra/azure-bootstrap.sh — One-time Azure resource provisioning for PLL.
# Idempotent-ish: re-running mostly no-ops (Azure CLI returns existing resources).
#
# Usage:
#   export AZ_SUBSCRIPTION="00000000-0000-0000-0000-000000000000"
#   export GITHUB_REPO="owner/repo"            # for SP role scope display
#   ./infra/azure-bootstrap.sh
#
# Outputs the values you need to drop into GitHub repo secrets at the end.

set -euo pipefail

# ---- Configurable knobs (override via env) ---------------------------------
RG="${RG:-pll-rg}"
LOCATION="${LOCATION:-eastus}"
SWA_LOCATION="${SWA_LOCATION:-eastus2}"
STORAGE_ACCOUNT="${STORAGE_ACCOUNT:-pllstorage$RANDOM}"
FILE_SHARE="${FILE_SHARE:-pll-data}"
SWA_NAME="${SWA_NAME:-pll-web}"
ACA_ENV="${ACA_ENV:-pll-env}"
ACA_NAME="${ACA_NAME:-pll-server}"
ACA_STORAGE_NAME="${ACA_STORAGE_NAME:-plldata}"   # name *inside* the ACA env
IMAGE="${IMAGE:-ghcr.io/${GITHUB_REPO%%/*}/pll-server:latest}"

echo "==> Using RG=$RG LOCATION=$LOCATION"

if [ -n "${AZ_SUBSCRIPTION:-}" ]; then
  az account set --subscription "$AZ_SUBSCRIPTION"
fi
SUBSCRIPTION_ID="$(az account show --query id -o tsv)"

# ---- 1. Resource group -----------------------------------------------------
az group create --name "$RG" --location "$LOCATION" -o table

# ---- 2. Storage account + Azure Files share for SQLite --------------------
az storage account create \
  --name "$STORAGE_ACCOUNT" \
  --resource-group "$RG" \
  --location "$LOCATION" \
  --sku Standard_LRS \
  --kind StorageV2 \
  --access-tier Hot \
  -o table

STORAGE_KEY="$(az storage account keys list \
  --resource-group "$RG" --account-name "$STORAGE_ACCOUNT" \
  --query '[0].value' -o tsv)"

az storage share-rm create \
  --resource-group "$RG" \
  --storage-account "$STORAGE_ACCOUNT" \
  --name "$FILE_SHARE" \
  --quota 1 \
  -o table

# ---- 3. Static Web App (Free) ---------------------------------------------
az staticwebapp create \
  --name "$SWA_NAME" \
  --resource-group "$RG" \
  --location "$SWA_LOCATION" \
  --sku Free \
  -o table

SWA_TOKEN="$(az staticwebapp secrets list \
  --name "$SWA_NAME" --resource-group "$RG" \
  --query 'properties.apiKey' -o tsv)"

# ---- 4. Container Apps environment + storage mount ------------------------
az containerapp env create \
  --name "$ACA_ENV" \
  --resource-group "$RG" \
  --location "$LOCATION" \
  -o table

az containerapp env storage set \
  --name "$ACA_ENV" \
  --resource-group "$RG" \
  --storage-name "$ACA_STORAGE_NAME" \
  --azure-file-account-name "$STORAGE_ACCOUNT" \
  --azure-file-account-key "$STORAGE_KEY" \
  --azure-file-share-name "$FILE_SHARE" \
  --access-mode ReadWrite \
  -o table

# ---- 5. Container App (scale-to-zero, mounts /data) -----------------------
# Initial create uses a placeholder image; the real image is pushed by CI.
# After the first deploy.yml run, this app will host the GHCR image.
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
  --env-vars DB_PATH=/data/lacrosse.db PORT=8080 NODE_ENV=production \
  -o table

# Attach the file share as a volume at /data.
az containerapp update \
  --name "$ACA_NAME" \
  --resource-group "$RG" \
  --yaml <(cat <<EOF
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
) -o table

# ---- 6. Service principal for GitHub Actions ------------------------------
SP_JSON="$(az ad sp create-for-rbac \
  --name "pll-github-deployer" \
  --role contributor \
  --scopes "/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$RG" \
  --sdk-auth)"

# ---- 7. Print the secrets to set in GitHub --------------------------------
cat <<SUMMARY

==============================================================================
 GitHub repo secrets to create (Settings → Secrets and variables → Actions)
==============================================================================
AZURE_CREDENTIALS              (paste the full JSON below)
$SP_JSON

AZURE_STATIC_WEB_APPS_API_TOKEN
$SWA_TOKEN

AZURE_STORAGE_ACCOUNT          $STORAGE_ACCOUNT
AZURE_STORAGE_KEY              $STORAGE_KEY
ACA_RESOURCE_GROUP             $RG
ACA_NAME                       $ACA_NAME

(Optional)
DISCORD_WEBHOOK_URL            <your-webhook-if-you-want-anomaly-pings>
==============================================================================
SUMMARY
