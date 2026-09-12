#!/usr/bin/env bash
# End-to-end walkthrough of the mock: order an eSIM, install it, burn data,
# watch the bundle deplete, then revoke and refund.
#
# Usage: ./examples/quickstart.sh [base-url]
set -euo pipefail

BASE="${1:-http://localhost:4010}"
API="$BASE/v2.5"
MOCK="$BASE/__mock"
KEY="${API_KEY:-esimgo-mock-key}"
JSON="Content-Type: application/json"

# The mock enforces the documented 10 requests/second limit, and the catalogue
# endpoints cost 5 tokens each, so the walkthrough paces itself between steps.
say() { sleep 1; printf '\n\033[1m== %s\033[0m\n' "$1"; }
get() { curl -sS -H "X-API-Key: $KEY" "$@"; }
post() { curl -sS -H "X-API-Key: $KEY" -H "$JSON" -X POST "$@"; }

say "1. Reset the mock to a clean state"
curl -sS -X POST "$MOCK/reset" -H "$JSON" -d '{"seed":false}'; echo

say "2. Find a bundle in the catalogue"
get "$API/catalogue?countries=GB&perPage=3" | head -c 400; echo

say "3. Price the order (no charge, nothing provisioned)"
post "$API/orders" -d '{"type":"validate","assign":true,"order":[{"type":"bundle","item":"esim_1GB_7D_GB_V2","quantity":1}]}'; echo

say "4. Place the order"
ORDER=$(post "$API/orders" -d '{"type":"transaction","assign":true,"order":[{"type":"bundle","item":"esim_1GB_7D_GB_V2","quantity":1}]}')
echo "$ORDER"
REFERENCE=$(printf '%s' "$ORDER" | sed -n 's/.*"orderReference":"\([^"]*\)".*/\1/p')
ICCID=$(printf '%s' "$ORDER" | sed -n 's/.*"iccid":"\([0-9]*\)".*/\1/p' | head -1)
echo "orderReference=$REFERENCE iccid=$ICCID"

say "5. Installation details (LPA / QR data)"
get -H "Accept: application/json" "$API/esims/assignments?reference=$REFERENCE&additionalFields=installUrl"; echo

say "6. Download the QR codes as a ZIP"
get -H "Accept: application/zip" "$API/esims/assignments?reference=$REFERENCE" -o /tmp/esim-qr.zip
ls -la /tmp/esim-qr.zip

say "7. Simulate the traveller installing the eSIM and attaching in the UK"
curl -sS -X POST "$MOCK/esims/$ICCID/install"; echo
curl -sS -X POST "$MOCK/esims/$ICCID/attach" -H "$JSON" -d '{"iso":"GB"}'; echo

say "8. Burn 800 MB, then finish the bundle off"
curl -sS -X POST "$MOCK/esims/$ICCID/usage" -H "$JSON" -d '{"mb":800}'; echo
curl -sS -X POST "$MOCK/esims/$ICCID/usage" -H "$JSON" -d '{"mb":200}'; echo

say "9. Bundle state and eSIM history"
get "$API/esims/$ICCID/bundles?includeUsed=true" | head -c 500; echo
get "$API/esims/$ICCID/history" | head -c 400; echo

say "10. Callbacks the platform would have sent"
curl -sS "$MOCK/callbacks?limit=10" | head -c 700; echo

say "11. Send an SMS and check the location"
post "$API/esims/$ICCID/sms" -d '{"message":"Welcome! Your eSIM is now active.","from":"eSIM"}'; echo
get "$API/esims/$ICCID/location"; echo

say "12. Order a spare bundle into inventory and refund it"
post "$API/orders" -d '{"type":"transaction","assign":false,"order":[{"type":"bundle","item":"esim_1GB_7D_GB_V2","quantity":2}]}' > /dev/null
USAGE_ID=$(get "$API/inventory" | sed -n 's/.*"id":\([0-9]*\).*/\1/p' | head -1)
post "$API/inventory/refund" -d "{\"usageId\":$USAGE_ID,\"quantity\":1}"; echo

say "Done"
