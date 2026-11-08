#!/bin/bash
# The disaster-recovery copy of the web app on Cloudflare Pages (project kitt-web → https://kitt-web.pages.dev): the same
# mockups/dist Vercel serves, the same headers (mockups/public/_headers). One-time on a new Mac: npx wrangler@3 login.
# wrangler 3 on purpose: wrangler 4 routes Pages deploys through Workers, which needs the workers:write login scope this Mac's
# login does not have (it has pages:write); wrangler 3 deploys to Pages directly with that scope.
#   bash scripts/deploy-cloudflare.sh
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
PROJECT=${CF_PAGES_PROJECT:-kitt-web}
export CI=1   # never open a browser from here; a missing login fails instead
(cd "$ROOT/mockups" && npm run build >/dev/null)
cd "$ROOT"   # no wrangler.toml here: wrangler 3 must not read one meant for Workers
W="npx --yes wrangler@3"
$W pages project list 2>/dev/null | grep -q "$PROJECT" || $W pages project create "$PROJECT" --production-branch main >/dev/null
$W pages deploy "$ROOT/mockups/dist" --project-name "$PROJECT" --branch main --commit-dirty=true 2>&1 | grep -E "https://|Success|✘|error" | sed 's/^ *//' | tail -3
