#!/usr/bin/env bash
# Update Namecheap DNS for phillylaxstats.com
# Sets apex (@) A record to Azure SWA stableInboundIP for HTTPS support
# Preserves www CNAME to Azure Static Web Apps
#
# Required env vars: NAMECHEAP_API_KEY, NAMECHEAP_API_USER, NAMECHEAP_CLIENT_IP
# Usage: ./scripts/dns-update.sh

set -euo pipefail

: "${NAMECHEAP_API_KEY:?Missing NAMECHEAP_API_KEY}"
: "${NAMECHEAP_API_USER:?Missing NAMECHEAP_API_USER}"
: "${NAMECHEAP_CLIENT_IP:?Missing NAMECHEAP_CLIENT_IP}"

API="https://api.namecheap.com/xml.response"
SLD="phillylaxstats"
TLD="com"

# Azure SWA stableInboundIP (from az rest API, api-version=2024-04-01)
# This is the static IP Azure provides for apex domain A records.
SWA_STABLE_IP="68.220.237.27"

# Azure SWA domain validation token (for phillylaxstats.com apex)
SWA_VALIDATION_TOKEN="_37dr3p6tqd79x3mm493o2kerot7rdnc"

echo "==> Fetching current DNS records for ${SLD}.${TLD}..."
CURRENT=$(curl -s "${API}?ApiUser=${NAMECHEAP_API_USER}&ApiKey=${NAMECHEAP_API_KEY}&UserName=${NAMECHEAP_API_USER}&Command=namecheap.domains.dns.getHosts&ClientIp=${NAMECHEAP_CLIENT_IP}&SLD=${SLD}&TLD=${TLD}")

echo "$CURRENT" | grep -q 'Status="OK"' || { echo "ERROR: Failed to fetch current records"; echo "$CURRENT"; exit 1; }

echo "Current records:"
echo "$CURRENT" | grep -o '<host[^/]*/>' | head -20
echo ""

echo "==> Setting new DNS records..."
# namecheap.domains.dns.setHosts REPLACES all records.
# MUST include ALL records in every call or they will be deleted.
# Records:
#   1. www -> CNAME to Azure Static Web Apps
#   2. @ -> A record to Azure SWA stableInboundIP (supports HTTPS)
#   3. @ -> TXT for Azure SWA apex domain verification
#   4. api -> CNAME to Azure Container Apps
#   5. asuid -> TXT for Azure SWA domain verification (www)
#   6. asuid.api -> TXT for Azure Container App domain verification
#   7. _dnsauth -> TXT for Azure SWA apex validation (alternate location)
RESULT=$(curl -s "${API}?ApiUser=${NAMECHEAP_API_USER}&ApiKey=${NAMECHEAP_API_KEY}&UserName=${NAMECHEAP_API_USER}&Command=namecheap.domains.dns.setHosts&ClientIp=${NAMECHEAP_CLIENT_IP}&SLD=${SLD}&TLD=${TLD}&HostName1=www&RecordType1=CNAME&Address1=victorious-pond-0c5ff000f.7.azurestaticapps.net.&TTL1=1800&HostName2=@&RecordType2=A&Address2=${SWA_STABLE_IP}&TTL2=300&HostName3=@&RecordType3=TXT&Address3=${SWA_VALIDATION_TOKEN}&TTL3=300&HostName4=api&RecordType4=CNAME&Address4=pll-server.proudwave-03a07ae1.eastus.azurecontainerapps.io.&TTL4=1800&HostName5=asuid&RecordType5=TXT&Address5=${SWA_VALIDATION_TOKEN}&TTL5=1800&HostName6=asuid.api&RecordType6=TXT&Address6=7BF1DE7F14D8B9B01A01A6B79D01CC7AF2ACF2FB09A12B1CD02437BD52E1ABF8&TTL6=1800&HostName7=_dnsauth&RecordType7=TXT&Address7=${SWA_VALIDATION_TOKEN}&TTL7=300")

if echo "$RESULT" | grep -q 'Status="OK"'; then
  echo "SUCCESS: DNS records updated."
  echo "  www       -> CNAME victorious-pond-0c5ff000f.7.azurestaticapps.net"
  echo "  @         -> A ${SWA_STABLE_IP} (Azure SWA stableInboundIP)"
  echo "  @         -> TXT ${SWA_VALIDATION_TOKEN} (Azure validation)"
  echo "  api       -> CNAME pll-server.proudwave-03a07ae1.eastus.azurecontainerapps.io"
  echo "  asuid     -> TXT (Azure SWA verification)"
  echo "  asuid.api -> TXT (Azure Container App verification)"
  echo "  _dnsauth  -> TXT (Azure apex validation alternate)"
  echo ""
  echo "DNS propagation may take 5-30 minutes."
else
  echo "ERROR: Failed to update records"
  echo "$RESULT"
  exit 1
fi
