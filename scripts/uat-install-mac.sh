#!/bin/bash
# Build the Mac app signed with your Apple Development team (a stable signature, so the Keychain keeps the token across rebuilds),
# install it into ~/Applications and open it.   bash scripts/uat-install-mac.sh
set -uo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
TEAM=$(sed -n 's/^DEVELOPMENT_TEAM *= *//p' "$ROOT/apps/KITT/Config/Signing.local.xcconfig" 2>/dev/null | head -1 | tr -d ' ')
SIGN=(DEVELOPMENT_TEAM="$TEAM" CODE_SIGN_STYLE=Automatic -allowProvisioningUpdates)
[ -z "$TEAM" ] && { echo "No team set (apps/KITT/Config/Signing.local.xcconfig); building with an ad-hoc signature, so a rebuilt app can lose its Keychain token."; SIGN=(CODE_SIGN_IDENTITY=- CODE_SIGNING_ALLOWED=YES CODE_SIGNING_REQUIRED=NO DEVELOPMENT_TEAM=); }
LOG=$(mktemp)
( cd "$ROOT/apps/KITT" && xcodebuild -project KITT.xcodeproj -scheme KITTMac -configuration Release -derivedDataPath "$ROOT/build/DerivedData-mac" -jobs 2 \
    -destination 'generic/platform=macOS' "${SIGN[@]}" build 2>&1 | grep -E "error:|BUILD (SUCCEEDED|FAILED)" | tee "$LOG" )
# a failed build must not install (and open) the previous build left in DerivedData
grep -q "BUILD SUCCEEDED" "$LOG" || { rm -f "$LOG"; echo "not installed: the build failed"; exit 1; }
rm -f "$LOG"
APP="$ROOT/build/DerivedData-mac/Build/Products/Release/KITT.app"
[ -d "$APP" ] || { echo "no build"; exit 1; }
pkill -x KITT 2>/dev/null; sleep 1
mkdir -p ~/Applications && rm -rf ~/Applications/KITT.app && cp -R "$APP" ~/Applications/KITT.app
codesign --verify --deep --strict ~/Applications/KITT.app && echo "signed: $(codesign -dvv ~/Applications/KITT.app 2>&1 | grep -E 'Authority=' | head -1)"
open ~/Applications/KITT.app
