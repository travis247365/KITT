#!/usr/bin/env bash
# Proof run for the Apple TV app: a throwaway hub, the app in the tvOS simulator driven by the Siri Remote tests, and a screen recording
# plus screenshots of the whole thing. Nothing here touches the real hub or any signing.
#   bash scripts/nosleep/80-tv-proof.sh           headless
#   SHOW=1 bash scripts/nosleep/80-tv-proof.sh    also opens the Simulator window so you can watch it live
# Output: build/proof/tvos-remote-test.mp4, build/proof/shots/*.png, build/proof/RESULT.txt
set -uo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
DEV=${TV_SIM:-071F73C4-DAF7-4F94-956C-328CDEA62BAD}   # Apple TV 4K (3rd generation) at 1080p, tvOS 27
OUT="$ROOT/build/proof"; rm -rf "$OUT"; mkdir -p "$OUT/shots" "$ROOT/build/logs"
HUBPID=""
cleanup() { [ -n "$HUBPID" ] && kill "$HUBPID" 2>/dev/null; [ -n "${RECPID:-}" ] && kill -INT "$RECPID" 2>/dev/null; wait 2>/dev/null; }
trap cleanup EXIT
if ! curl -s -m 2 -o /dev/null http://127.0.0.1:2998/healthz; then node "$ROOT/scripts/dev-hub.mjs" > "$ROOT/build/logs/dev-hub.log" 2>&1 & HUBPID=$!; sleep 6; fi
xcrun simctl boot "$DEV" 2>/dev/null; xcrun simctl bootstatus "$DEV" -b >/dev/null 2>&1
[ "${SHOW:-0}" = "1" ] && open -a Simulator
xcrun simctl io "$DEV" recordVideo --codec h264 --force "$OUT/tvos-remote-test.mp4" 2>/dev/null & RECPID=$!
sleep 2
cd "$ROOT/apps/KITT"
xcodebuild test -project KITT.xcodeproj -scheme KITTtv -destination "platform=tvOS Simulator,id=$DEV" -derivedDataPath "$ROOT/build/DerivedData" -jobs 2 \
  CODE_SIGNING_ALLOWED=NO -resultBundlePath "$OUT/tvos.xcresult" > "$OUT/xcodebuild.log" 2>&1
RC=$?
kill -INT "$RECPID" 2>/dev/null; wait "$RECPID" 2>/dev/null; RECPID=""
xcrun xcresulttool export attachments --path "$OUT/tvos.xcresult" --output-path "$OUT/shots" >/dev/null 2>&1
{ echo "Apple TV remote tests, $(date)"; grep -E "Test Case '.*' (passed|failed)" "$OUT/xcodebuild.log" | sed -E "s/.*\.([A-Za-z]+)' (passed|failed) \(([0-9.]+) seconds\)./\2  \1  (\3 s)/"; echo "exit code $RC"; } > "$OUT/RESULT.txt"
cat "$OUT/RESULT.txt"; ls "$OUT/shots" | head -20
exit $RC
