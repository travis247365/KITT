#!/bin/bash
# UAT install: build the KITT app signed for your iPhone / iPad and install + launch it.
#   bash scripts/uat-install.sh --check     what is ready and what is missing (installs nothing)
#   bash scripts/uat-install.sh             install on every connected iPhone/iPad
#   ONLY=ipad bash scripts/uat-install.sh   (or ONLY=iphone)
# Needs, once: an Apple ID signed in to Xcode (Settings > Accounts), Developer Mode ON on the device, the device unlocked and connected.
set -uo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
APPDIR="$ROOT/apps/KITT"
BUNDLE=com.tpcl.kitt
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT

team() {
  if [ -f "$APPDIR/Config/Signing.local.xcconfig" ]; then sed -n 's/^DEVELOPMENT_TEAM *= *//p' "$APPDIR/Config/Signing.local.xcconfig" | head -1 | tr -d ' '; return; fi
  defaults export com.apple.dt.Xcode - 2>/dev/null | python3 -c '
import plistlib, sys
try: d = plistlib.loads(sys.stdin.buffer.read())
except Exception: sys.exit(0)
t = d.get("IDEProvisioningTeamByIdentifier") or {}
for teams in t.values():
    for x in teams or []:
        if x.get("teamID"): print(x["teamID"]); sys.exit(0)'
}

devices() {   # prints: udid|name|platform|state|developerMode
  xcrun devicectl list devices --json-output "$TMP/d.json" >/dev/null 2>&1
  python3 - "$TMP/d.json" <<'PY'
import json, sys
try: d = json.load(open(sys.argv[1]))
except Exception: sys.exit(0)
for x in d.get("result", {}).get("devices", []):
    hp, dp, cp = x.get("hardwareProperties", {}), x.get("deviceProperties", {}), x.get("connectionProperties", {})
    if hp.get("reality") != "physical" or hp.get("platform") not in ("iOS", "iPadOS"): continue
    print("|".join([hp.get("udid", ""), dp.get("name", ""), hp.get("deviceType", ""), cp.get("tunnelState", "?"), dp.get("developerModeStatus", "?")]))
PY
}

TEAM=$(team)
echo "Apple team: ${TEAM:-NOT SET (Xcode > Settings > Accounts > + > Apple ID, then run this again)}"
LIST=$(devices)
[ -z "$LIST" ] && echo "No physical iPhone/iPad found. Connect it by cable, unlock it and tap Trust."
echo "$LIST" | while IFS='|' read -r udid name type state dev; do
  [ -z "$udid" ] && continue
  echo "device: $name ($type)  connection: $state  Developer Mode: $dev"
  [ "$dev" != "enabled" ] && echo "   -> on the device: Settings > Privacy & Security > Developer Mode > On (it restarts), then unlock and confirm"
done
[ "${1:-}" = "--check" ] && exit 0
[ -z "$TEAM" ] && exit 1

echo "$LIST" | while IFS='|' read -r udid name type state dev; do
  [ -z "$udid" ] && continue
  case "${ONLY:-}" in ipad) [[ "$type" == iPad* ]] || continue;; iphone) [[ "$type" == iPhone* ]] || continue;; esac
  if [ "$dev" != "enabled" ]; then echo "skip $name: Developer Mode is not on"; continue; fi
  echo "== building for $name"
  ( cd "$APPDIR" && xcodebuild -project KITT.xcodeproj -scheme KITT -configuration Release -destination "id=$udid" -derivedDataPath "$ROOT/build/DerivedData-device" \
      -allowProvisioningUpdates DEVELOPMENT_TEAM="$TEAM" CODE_SIGN_STYLE=Automatic build 2>&1 | grep -E "error:|BUILD (SUCCEEDED|FAILED)" )
  APP="$ROOT/build/DerivedData-device/Build/Products/Release-iphoneos/KITT.app"
  [ -d "$APP" ] || { echo "no build for $name"; continue; }
  xcrun devicectl device install app --device "$udid" "$APP" 2>&1 | tail -2
  xcrun devicectl device process launch --device "$udid" "$BUNDLE" 2>&1 | tail -1
done
