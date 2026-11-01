#!/usr/bin/env bash
# Install and launch the iOS/iPadOS app in the simulator, screenshot it, shut the simulators down. No hub needed: it shows the
# "connect to your hub" screen. Boots one device at a time (this Mac has 8 GB of RAM) and always shuts them down again.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; APP="$ROOT/apps/KITT"; OUT="$ROOT/build/screens"; mkdir -p "$OUT"
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
DEVICES=("${SIM_PHONE:-iPhone 17}|iphone" "${SIM_PAD:-iPad Pro 11-inch (M5)}|ipad")
udid_of() { xcrun simctl list devices available | grep -F "    $1 (" | head -1 | sed -E 's/.*\(([0-9A-F-]{36})\).*/\1/'; }
cleanup() { xcrun simctl shutdown all >/dev/null 2>&1 || true; }
trap cleanup EXIT

first="$(udid_of "${DEVICES[0]%%|*}")"; [ -n "$first" ] || { echo "no simulator named ${DEVICES[0]%%|*}"; exit 1; }
xcodebuild -project "$APP/KITT.xcodeproj" -scheme KITT -destination "platform=iOS Simulator,id=$first" \
  -derivedDataPath "$ROOT/build/DerivedDataSim" -jobs 2 CODE_SIGNING_ALLOWED=NO build 2>&1 | tail -3
APPBUNDLE="$ROOT/build/DerivedDataSim/Build/Products/Debug-iphonesimulator/KITT.app"
[ -d "$APPBUNDLE" ] || { echo "simulator build produced no app"; exit 1; }

for d in "${DEVICES[@]}"; do
  name="${d%%|*}"; tag="${d##*|}"; u="$(udid_of "$name")"; [ -n "$u" ] || { echo "skip: no simulator named $name"; continue; }
  echo "== $name ($u)"
  xcrun simctl shutdown all >/dev/null 2>&1 || true
  xcrun simctl boot "$u"; xcrun simctl bootstatus "$u" -b >/dev/null
  xcrun simctl install "$u" "$APPBUNDLE"
  xcrun simctl launch "$u" com.tpcl.kitt
  sleep "${SIM_WAIT:-12}"
  xcrun simctl io "$u" screenshot "$OUT/ios-$tag.png"
  xcrun simctl terminate "$u" com.tpcl.kitt >/dev/null 2>&1 || true
  echo "screenshot: $OUT/ios-$tag.png"
done
