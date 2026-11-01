#!/bin/sh
# Keep the WhatsApp listener running under launchd. Run this yourself AFTER the QR has been scanned once:
#   sh scripts/install-whatsapp.sh
set -e
CREDS=~/.config/kitt/whatsapp-auth/creds.json
if [ ! -f "$CREDS" ]; then echo "Not linked yet. Run 'kitt whatsapp link' and scan the QR first."; exit 1; fi
if ! python3 -c "import json,sys; sys.exit(0 if (json.load(open(sys.argv[1])).get('me') or {}).get('id') else 1)" "$CREDS"; then echo "The pairing was not completed (no linked account in creds.json). Run 'kitt whatsapp link' again."; exit 1; fi
PLIST=~/Library/LaunchAgents/com.tpcl.kitt-whatsapp.plist
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
sed -e "s#__KITT_ROOT__#$ROOT#g" -e "s#__HOME__#$HOME#g" "$ROOT/launchd/com.tpcl.kitt-whatsapp.plist" > "$PLIST"
launchctl bootout "gui/$(id -u)/com.tpcl.kitt-whatsapp" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
sleep 6
echo "Listener installed. Logs: ~/Library/Logs/kitt-whatsapp.log · stop: launchctl bootout gui/$(id -u) $PLIST"
