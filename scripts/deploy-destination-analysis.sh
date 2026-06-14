#!/bin/bash
# deploy-destination-analysis.sh
#
# Deploys the destination-analysis edge function to Supabase.
#
# The Supabase CLI must be authenticated as the account that OWNS the
# fpwgnceigulqonjdzfbo project. Run this script after logging in with:
#
#   supabase login
#   (follow the browser login flow — sign in with the correct account)
#
# Then run:
#   chmod +x scripts/deploy-destination-analysis.sh
#   ./scripts/deploy-destination-analysis.sh
#
# Alternatively, if you have a Personal Access Token from
# https://supabase.com/dashboard/account/tokens
# you can pass it directly:
#
#   SUPABASE_ACCESS_TOKEN=sbp_xxxx ./scripts/deploy-destination-analysis.sh

set -e

PROJECT_REF="fpwgnceigulqonjdzfbo"
FUNCTION_NAME="destination-analysis"

echo "=== Deploying $FUNCTION_NAME to Supabase project $PROJECT_REF ==="
echo ""

# If access token provided via env var, use it directly
if [ -n "$SUPABASE_ACCESS_TOKEN" ]; then
  echo "Using SUPABASE_ACCESS_TOKEN from environment"
  supabase functions deploy "$FUNCTION_NAME" \
    --project-ref "$PROJECT_REF" \
    --token "$SUPABASE_ACCESS_TOKEN"
else
  echo "No SUPABASE_ACCESS_TOKEN found — using stored CLI credentials"
  echo "If this fails with 403, run: supabase login"
  echo ""
  supabase functions deploy "$FUNCTION_NAME" \
    --project-ref "$PROJECT_REF"
fi

echo ""
echo "=== Deployment complete! ==="
echo ""
echo "Verifying deployment..."
sleep 3

HTTP=$(curl -s -o /tmp/da_test.json -w "%{http_code}" -X OPTIONS \
  "https://${PROJECT_REF}.supabase.co/functions/v1/${FUNCTION_NAME}" \
  -H "Origin: http://localhost:3000" \
  -H "Access-Control-Request-Method: POST")

if [ "$HTTP" = "200" ]; then
  echo "✅ CORS preflight OK (HTTP $HTTP) — function is live!"
else
  echo "⚠️  CORS preflight returned HTTP $HTTP — function may not be live yet"
  echo "    Response: $(cat /tmp/da_test.json)"
fi
