#!/bin/sh
# Expose the hub to the iPhone through ngrok's stable free hostname and build the Siri Shortcuts for it.
# Run this yourself after deciding to go public: `sh ~/dev/kitt/scripts/expose.sh`
# What it does: 1) discovers your assigned *.ngrok-free.dev hostname (9-second tunnel to a closed port, nothing served)
#               2) writes server.public_base_url into ~/.config/kitt/kitt.json  3) installs com.tpcl.kitt-ngrok under launchd
#               4) builds + signs the 12 shortcuts with the real URL and your token (~/dev/kitt/shortcuts/)
set -e
LOG=$(mktemp)
ngrok http 1 --log stdout --log-format json --inspect=false > "$LOG" 2>&1 &
PID=$!; sleep 9; kill $PID 2>/dev/null || true; sleep 1
HOST=$(grep -oE 'url=https://[a-z0-9.-]+\.ngrok-free\.(dev|app)' "$LOG" | head -1 | sed 's/url=//')
[ -n "$HOST" ] || { echo "could not read the ngrok hostname; log:"; tail -5 "$LOG"; exit 1; }
echo "ngrok hostname: $HOST"
python3 - "$HOST" <<'PY'
import json, sys, os
p = os.path.expanduser('~/.config/kitt/kitt.json'); d = json.load(open(p)) if os.path.exists(p) else {}
d.setdefault('server', {})['public_base_url'] = sys.argv[1]; json.dump(d, open(p, 'w'), indent=2); print('kitt.json updated')
PY
PLIST=~/Library/LaunchAgents/com.tpcl.kitt-ngrok.plist
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
sed -e "s#https://REPLACE-WITH-ASSIGNED.ngrok-free.dev#$HOST#" -e "s#__KITT_ROOT__#$ROOT#g" -e "s#__HOME__#$HOME#g" "$ROOT/launchd/com.tpcl.kitt-ngrok.plist" > "$PLIST"
launchctl bootout "gui/$(id -u)/com.tpcl.kitt-ngrok" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
sleep 5
curl -s -m 15 -H 'ngrok-skip-browser-warning: 1' "$HOST/healthz" && echo && echo "public endpoint is up"
cd ~/dev/kitt && node bin/kitt shortcuts build "$HOST"
echo "AirDrop the *.signed.shortcut files in ~/dev/kitt/shortcuts to the iPhone. Feed URL for Apple Podcasts is in shortcuts/README.md"
