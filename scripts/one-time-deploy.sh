#!/bin/bash
# ============================================================
# PASTE THIS INTO YOUR TERMINAL to deploy destination-analysis
# ============================================================
#
# WHAT TO DO:
# 1. Go to: https://supabase.com/dashboard/account/tokens
#    (Sign in with whichever account owns the fpwgnceigulqonjdzfbo project)
# 2. Click "Generate new token", name it anything, copy it
# 3. Paste it below replacing YOUR_TOKEN_HERE
# 4. Run this script: bash scripts/one-time-deploy.sh

TOKEN="YOUR_TOKEN_HERE"

if [[ "$TOKEN" == "YOUR_TOKEN_HERE" ]]; then
  echo "❌ You need to set your Supabase Personal Access Token first!"
  echo "   Get one at: https://supabase.com/dashboard/account/tokens"
  exit 1
fi

echo "🚀 Deploying destination-analysis to fpwgnceigulqonjdzfbo..."
cd "$(dirname "$0")/.."

SUPABASE_ACCESS_TOKEN="$TOKEN" supabase functions deploy destination-analysis \
  --project-ref fpwgnceigulqonjdzfbo \
  --no-verify-jwt

echo ""
echo "✅ Verifying deployment..."
sleep 3

HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X OPTIONS \
  "https://fpwgnceigulqonjdzfbo.supabase.co/functions/v1/destination-analysis" \
  -H "Origin: http://localhost:3000" \
  -H "Access-Control-Request-Method: POST")

if [ "$HTTP" = "200" ]; then
  echo "🎉 SUCCESS! CORS preflight returned 200 — function is live!"
  echo "   Reload the dashboard — the CORS errors will be gone."
else
  echo "⚠️  Preflight returned $HTTP — deploy may have failed."
  echo "   Check: https://supabase.com/dashboard/project/fpwgnceigulqonjdzfbo/functions"
fi
