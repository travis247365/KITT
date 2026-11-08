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
  # a team picked in the Xcode UI (Signing & Capabilities) is written into the project: use it
  local picked; picked=$(sed -n 's/.*DEVELOPMENT_TEAM = \([A-Z0-9]\{10\}\);.*/\1/p' "$APPDIR/KITT.xcodeproj/project.pbxproj" 2>/dev/null | head -1)
  if [ -n "$picked" ]; then
    # remember it outside the generated project, so `xcodegen generate` can never lose the choice
    [ -f "$APPDIR/Config/Signing.local.xcconfig" ] || printf 'DEVELOPMENT_TEAM = %s\n' "$picked" > "$APPDIR/Config/Signing.local.xcconfig"
    echo "$picked"; return
  fi
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

signing() {   # args: udid list. Prints whether Xcode can renew signing, and how long each device's install stays valid.
  defaults export com.apple.dt.Xcode - 2>/dev/null > "$TMP/x.plist"
  for f in "$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles"/*.mobileprovision "$HOME/Library/MobileDevice/Provisioning Profiles"/*.mobileprovision; do
    [ -f "$f" ] && security cms -D -i "$f" 2>/dev/null > "$TMP/p-$(basename "$f").plist"
  done
  python3 - "$TMP" "$BUNDLE" "$@" <<'PY'
import glob, os, plistlib, sys, datetime as dt
tmp, bundle, udids = sys.argv[1], sys.argv[2], sys.argv[3:]
try: x = plistlib.load(open(os.path.join(tmp, "x.plist"), "rb"))
except Exception: x = {}
accounts = [a for v in (x.get("DVTDeveloperAccountManagerAppleIDLists") or {}).values() for a in (v or [])]
free = any(t.get("isFreeProvisioningTeam") for v in (x.get("IDEProvisioningTeamByIdentifier") or {}).values() for t in (v or []))
if accounts: print("Xcode account: signed in" + (" (free Personal Team: every install is valid for 7 days, then reinstall)" if free else ""))
else: print("Xcode account: NONE. Builds can only reuse the profile below until it expires; nothing can be renewed or added.\n   -> Xcode > Settings > Accounts > + > Apple Account, sign in, then run this again")
best = None
for p in glob.glob(os.path.join(tmp, "p-*.plist")):
    try: d = plistlib.load(open(p, "rb"))
    except Exception: continue
    if not str((d.get("Entitlements") or {}).get("application-identifier", "")).endswith("." + bundle): continue
    if best is None or d["ExpirationDate"] > best["ExpirationDate"]: best = d
if not best: print("signing profile: none for " + bundle); sys.exit(0)
exp = best["ExpirationDate"].replace(tzinfo=dt.timezone.utc)
left = exp - dt.datetime.now(dt.timezone.utc)
local = exp.astimezone().strftime("%a %d %b %H:%M %Z")
hours = int(left.total_seconds() // 3600)
state = "EXPIRED" if hours < 0 else (f"{hours} h left" if hours < 48 else f"{hours // 24} days left")
print(f"signing profile: expires {local} ({state}); made {best['CreationDate'].replace(tzinfo=dt.timezone.utc).astimezone().strftime('%a %d %b %H:%M')}")
covered = set(best.get("ProvisionedDevices") or [])
for u in udids:
    if u: print(f"   {u}: " + ("covered" if u in covered else "NOT in the profile: a build with the Xcode account signed in adds it"))
PY
}

TEAM=$(team)
echo "Apple team: ${TEAM:-NOT SET (Xcode > Settings > Accounts > + > Apple ID, then run this again)}"
LIST=$(devices)
[ -z "$LIST" ] && echo "No physical iPhone/iPad found. Connect it by cable, unlock it and tap Trust."
echo "$LIST" | while IFS='|' read -r udid name type state dev; do
  [ -z "$udid" ] && continue
  echo "device: $name ($type)  udid: $udid  connection: $state  Developer Mode: $dev"
  [ "$dev" != "enabled" ] && echo "   -> on the device: Settings > Privacy & Security > Developer Mode > On (it restarts), then unlock and confirm"
done
signing $(echo "$LIST" | cut -d'|' -f1)
[ "${1:-}" = "--check" ] && exit 0
[ -z "$TEAM" ] && exit 1

echo "$LIST" | while IFS='|' read -r udid name type state dev; do
  [ -z "$udid" ] && continue
  case "${ONLY:-}" in ipad) [[ "$type" == iPad* ]] || continue;; iphone) [[ "$type" == iPhone* ]] || continue;; esac
  if [ "$dev" != "enabled" ] && [ "${FORCE:-0}" != "1" ]; then echo "skip $name: Developer Mode is not on (FORCE=1 tries anyway: the attempt makes the device show its Developer Mode switch)"; continue; fi
  echo "== building for $name"
  # -allowProvisioningDeviceRegistration: a device that is not in the team's profile yet (a new iPad) is registered and a fresh
  # profile made for it; without it xcodebuild stops at "no profile includes this device".
  ( cd "$APPDIR" && xcodebuild -project KITT.xcodeproj -scheme KITT -configuration Release -destination "id=$udid" -derivedDataPath "$ROOT/build/DerivedData-device" \
      -allowProvisioningUpdates -allowProvisioningDeviceRegistration DEVELOPMENT_TEAM="$TEAM" CODE_SIGN_STYLE=Automatic build 2>&1 | grep -E "error:|BUILD (SUCCEEDED|FAILED)" ) | tee "$TMP/build.log"
  grep -q "No Accounts" "$TMP/build.log" && echo "   -> Xcode has no Apple account signed in: Xcode > Settings > Accounts > + > Apple Account, then run this again"
  APP="$ROOT/build/DerivedData-device/Build/Products/Release-iphoneos/KITT.app"
  [ -d "$APP" ] || { echo "no build for $name"; continue; }
  xcrun devicectl device install app --device "$udid" "$APP" 2>&1 | tail -2
  xcrun devicectl device process launch --device "$udid" "$BUNDLE" 2>&1 | tail -1
done
