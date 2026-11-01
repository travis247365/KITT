#!/bin/sh
# Install (or reinstall) the KITT hub as a launchd user agent. Run this yourself: `sh scripts/install.sh`
set -e
PLIST=~/Library/LaunchAgents/com.tpcl.kitt.plist
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
sed -e "s#__KITT_ROOT__#$ROOT#g" -e "s#__HOME__#$HOME#g" "$ROOT/launchd/com.tpcl.kitt.plist" > "$PLIST"
launchctl bootout "gui/$(id -u)/com.tpcl.kitt" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
sleep 4
curl -s -m 10 http://127.0.0.1:2000/healthz && echo && echo "KITT hub installed. Logs: ~/Library/Logs/kitt.log · stop: launchctl bootout gui/$(id -u) $PLIST"
