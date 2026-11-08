#!/bin/bash
# Installs (or reinstalls) the launchd agent that runs scripts/autopush.sh every ten minutes: committed work goes to both
# repositories whenever GitHub is reachable, with no AI and no tokens involved.
#   bash scripts/install-autopush.sh            install, start now
#   bash scripts/install-autopush.sh --remove   stop and remove
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
LABEL=com.tpcl.kitt-autopush
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
if [ "${1:-}" = "--remove" ]; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  echo "removed $LABEL"
  exit 0
fi
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
sed -e "s#__KITT_ROOT__#$ROOT#g" -e "s#__HOME__#$HOME#g" "$ROOT/launchd/$LABEL.plist" > "$PLIST"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl print "gui/$(id -u)/$LABEL" | grep -E "^\s*(state|run interval)" | tr -s ' ' | sed 's/^ */  /'
echo "installed: every 10 minutes, when GitHub is reachable, committed work is pushed to the private repo and published to the public one"
echo "log: ~/Library/Logs/kitt-autopush.log"
