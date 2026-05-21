#!/usr/bin/env bash
# Update Namecheap DNS for phillylaxstats.com
# Sets apex (@) to redirect 301 -> https://www.phillylaxstats.com
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
#   2. @ -> URL redirect (301) to https://www.phillylaxstats.com
#   3. api -> CNAME to Azure Container Apps
#   4. asuid -> TXT for Azure SWA domain verification
#   5. asuid.api -> TXT for Azure Container App domain verification
RESULT=$(curl -s "${API}?ApiUser=${NAMECHEAP_API_USER}&ApiKey=${NAMECHEAP_API_KEY}&UserName=${NAMECHEAP_API_USER}&Command=namecheap.domains.dns.setHosts&ClientIp=${NAMECHEAP_CLIENT_IP}&SLD=${SLD}&TLD=${TLD}&HostName1=www&RecordType1=CNAME&Address1=victorious-pond-0c5ff000f.7.azurestaticapps.net.&TTL1=1800&HostName2=@&RecordType2=URL301&Address2=https://www.phillylaxstats.com&TTL2=1800&HostName3=api&RecordType3=CNAME&Address3=pll-server.proudwave-03a07ae1.eastus.azurecontainerapps.io.&TTL3=1800&HostName4=asuid&RecordType4=TXT&Address4=_vw5h165whr7aw57rtrlorvoxkv4xm95&TTL4=1800&HostName5=asuid.api&RecordType5=TXT&Address5=7BF1DE7F14D8B9B01A01A6B79D01CC7AF2ACF2FB09A12B1CD02437BD52E1ABF8&TTL5=1800")

if echo "$RESULT" | grep -q 'Status="OK"'; then
  echo "SUCCESS: DNS records updated."
  echo "  www      -> CNAME victorious-pond-0c5ff000f.7.azurestaticapps.net"
  echo "  @        -> 301 redirect to https://www.phillylaxstats.com"
  echo "  api      -> CNAME pll-server.proudwave-03a07ae1.eastus.azurecontainerapps.io"
  echo "  asuid    -> TXT (Azure SWA verification)"
  echo "  asuid.api-> TXT (Azure Container App verification)"
  echo ""
  echo "DNS propagation may take 5-30 minutes."
else
  echo "ERROR: Failed to update records"
  echo "$RESULT"
  exit 1
fi
