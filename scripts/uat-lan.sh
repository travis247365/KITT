#!/bin/bash
# Let the iPhone/iPad (or the Apple TV) reach the hub on your home Wi-Fi, or stop doing so.
#   bash scripts/uat-lan.sh on      the hub listens on the home network (token still required; plain http, so only on a network you trust)
#   bash scripts/uat-lan.sh off     back to this Mac only
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
CFG=${KITT_CONFIG_DIR:-$HOME/.config/kitt}/kitt.json
case "${1:-}" in on) HOST=0.0.0.0;; off) HOST=127.0.0.1;; *) echo "usage: uat-lan.sh on|off"; exit 2;; esac
cp "$CFG" "$CFG.bak-$(date +%Y%m%d-%H%M%S)"
python3 - "$CFG" "$HOST" <<'PY'
import json, sys
p, h = sys.argv[1], sys.argv[2]
d = json.load(open(p)); d.setdefault('server', {})['host'] = h
json.dump(d, open(p, 'w'), indent=2)
PY
node "$ROOT/bin/kitt" restart
if [ "$HOST" = "0.0.0.0" ]; then
  IP=$(ipconfig getifaddr en0 || true); NAME=$(scutil --get LocalHostName 2>/dev/null || hostname -s)
  echo; echo "In the app, use:  http://$NAME.local:2000   (or http://$IP:2000)"
else
  echo "the hub is reachable from this Mac only"
fi
