#!/bin/bash
# ============================================================
# PASTE THIS INTO YOUR TERMINAL to deploy destination-analysis-new
# ============================================================
#
# WHAT TO DO:
# 1. Go to: https://supabase.com/dashboard/account/tokens
#    (Sign in with whichever account owns the fpwgnceigulqonjdzfbo project)
# 2. Click "Generate new token", name it anything, copy it
# 3. Paste it below replacing YOUR_TOKEN_HERE
# 4. Run this script: bash scripts/deploy-da-new.sh

TOKEN="YOUR_TOKEN_HERE"

if [[ "$TOKEN" == "YOUR_TOKEN_HERE" ]]; then
  echo "❌ You need to set your Supabase Personal Access Token first!"
  echo "   Get one at: https://supabase.com/dashboard/account/tokens"
  exit 1
fi

echo "🚀 Deploying destination-analysis-new to fpwgnceigulqonjdzfbo..."
cd "$(dirname "$0")/.."

SUPABASE_ACCESS_TOKEN="$TOKEN" supabase functions deploy destination-analysis-new \
  --project-ref fpwgnceigulqonjdzfbo \
  --no-verify-jwt

echo ""
echo "✅ Done! Network Pulse is live at:"
echo "   https://fpwgnceigulqonjdzfbo.supabase.co/functions/v1/destination-analysis-new"
echo ""
echo "🌐 Open the React app and click 'Destination Analysis New' to see it."
