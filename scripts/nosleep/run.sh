#!/usr/bin/env bash
# Team No Sleep: build and verify every KITT client with plain scripts (no AI tokens), resumable, overnight-safe.
#   scripts/nosleep/run.sh                       run everything; finished steps are skipped
#   FORCE=1 scripts/nosleep/run.sh               redo everything
#   STEPS="build-mac tv-es5" scripts/nosleep/run.sh   run only these steps
# Logs: build/logs/<step>.log   Markers: build/state/   Summary: build/STATUS.md   Exit: 0 all ok, 1 a step failed, 10 blocked.
# It never starts KITT or the WhatsApp listener (Travis stopped all local services on purpose), never signs, never installs on a TV or phone.
[ -z "${NOSLEEP_CAFF:-}" ] && exec env NOSLEEP_CAFF=1 caffeinate -i "$0" "$@"     # keep the Mac awake while this runs
. "$(cd "$(dirname "$0")" && pwd)/lib.sh"
APP="$ROOT/apps/KITT"
export ROOT BUILD LOGS STATE APP
ALL="preflight hub-tests kittkit-tests gen-project build-ios build-mac build-tv build-tvpreview tv-render sim-smoke tv-es5 webos-verify"
RUN="${STEPS:-$ALL}"
want() { case " $RUN " in *" $1 "*) return 0;; *) return 1;; esac; }
overall=0
go() { local n="$1"; shift; want "$n" || return 0; run_step "$n" "$@"; local rc=$?; [ $rc -ne 0 ] && { [ $rc -eq 10 ] && [ $overall -eq 0 ] && overall=10; [ $rc -eq 1 ] && overall=1; }; return $rc; }

say "=== Team No Sleep start  (free ${free_gb_start:=$(free_gb)} GB, guard ${MIN_FREE_GB} GB) ==="

go preflight 120 bash -c '
  xcodebuild -version && swift --version 2>&1 | head -1 && xcodegen --version && node -v && npm -v &&
  echo "free GB: $(df -k /System/Volumes/Data | awk "NR==2 {printf \"%d\", \$4/1048576}")" &&
  echo "RAM GB: $(( $(sysctl -n hw.memsize) / 1073741824 ))" &&
  { xcodebuild -checkFirstLaunchStatus && echo "xcode first launch: done" || echo "xcode first launch: NOT done (builds may still work; simulators need it)"; } &&
  for p in 2000 7899; do curl -s -m 2 -o /dev/null http://127.0.0.1:$p/ && echo "WARNING: something is listening on :$p" || echo ":$p is down (as Travis wants)"; done'
go hub-tests 300 bash -c 'cd "$ROOT" && npm test'
go kittkit-tests 600 bash -c 'cd "$APP/KITTKit" && env -u DEVELOPER_DIR swift test'
go gen-project 120 bash -c 'cd "$APP" && xcodegen generate'

XB=(xcodebuild -project "$APP/KITT.xcodeproj" -derivedDataPath "$BUILD/DerivedData" -jobs 2 CODE_SIGNING_ALLOWED=NO)
if [ -f "$STATE/gen-project.ok" ]; then
  go build-ios 1800 "${XB[@]}" -scheme KITT -destination 'generic/platform=iOS' build
  go build-mac 1800 "${XB[@]}" -scheme KITTMac -destination 'generic/platform=macOS' build
  go build-tv 1800 "${XB[@]}" -scheme KITTtv -destination 'generic/platform=tvOS' build
  go build-tvpreview 900 "${XB[@]}" -scheme KITTtvPreview -destination 'platform=macOS' build
else
  want build-ios && say "SKIP    build-ios (gen-project not ok)"; want build-mac && say "SKIP    build-mac (gen-project not ok)"
fi
[ -f "$STATE/build-tvpreview.ok" ] && go tv-render 120 bash -c 'mkdir -p "$BUILD/tv-preview" && "$BUILD/DerivedData/Build/Products/Debug/KITTtvPreview" "$BUILD/tv-preview"'
[ -f "$STATE/build-ios.ok" ] && go sim-smoke 900 bash "$ROOT/scripts/nosleep/sim-smoke.sh"
go tv-es5 60 node "$ROOT/scripts/nosleep/check-tv-es5.mjs"
go webos-verify 60 bash "$ROOT/scripts/nosleep/webos-verify.sh"

# ---- summary -------------------------------------------------------------------------------------------------------------
{
  echo "# Team No Sleep status"; echo; echo "Updated $(now). Free disk now: $(free_gb) GB (started at ${free_gb_start} GB)."; echo
  echo "| Step | Result | Seconds | Log |"; echo "|---|---|---|---|"
  for s in $ALL; do printf '| %s | %s | %s | `build/logs/%s.log` |\n' "$s" "$(step_result "$s")" "$(step_secs "$s")" "$s"; done
  echo; echo "## Artifacts"
  # only claim an artifact when its build step passed in this state: leftover folders from earlier failed builds do not count
  for a in "build-ios|build/DerivedData/Build/Products/Debug-iphoneos/KITT.app|iOS / iPadOS app (unsigned device build)" "build-mac|build/DerivedData/Build/Products/Debug/KITT.app|macOS app (unsigned)" "build-tv|build/DerivedData/Build/Products/Debug-appletvos/KITT.app|Apple TV app (unsigned device build)" ; do
    st="${a%%|*}"; rest="${a#*|}"; p="${rest%%|*}"; l="${rest#*|}"
    if [ "$(step_result "$st")" = "OK" ] && [ -d "$ROOT/$p" ]; then echo "- $l: \`$p\` ($(du -sh "$ROOT/$p" 2>/dev/null | cut -f1))"; else echo "- $l: NOT built ($st: $(step_result "$st"))"; fi
  done
  [ "$(step_result tv-render)" = "OK" ] && echo "- Apple TV screens rendered on the Mac (no tvOS simulator needed): \`build/tv-preview/*.png\`"
  [ "$(step_result sim-smoke)" = "OK" ] && echo "- Simulator screenshots (iPhone 17, iPad Pro 11-inch M5): \`build/screens/ios-iphone.png\`, \`build/screens/ios-ipad.png\`"
  echo "- webOS packages: \`~/dev/lgtv-vibehack/dist/*.ipk\` (verified read-only, not installed)"
  echo; echo "## Needs you"
  xcodebuild -checkFirstLaunchStatus >/dev/null 2>&1 || echo "- Xcode first run (needs your Mac password): \`sh ~/dev/kitt/scripts/xcode-first-run.sh\`. Until then there is no simulator, and CoreSimulator is older than this Xcode."
  echo "- Apple Developer team: pick it in Xcode (Signing & Capabilities) before any run on a real iPhone, iPad or Mac outside this machine, or TestFlight. These are unsigned builds."
  echo "- LG TV: Developer Mode passphrase to install the .ipk files; the lgtv-vibehack server and KITT must be running for the /kitt route."
  echo "- KITT is off by your instruction. Say when it may start so the clients can be tested against a live hub."
} > "$BUILD/STATUS.md"

fails=0; for s in $ALL; do [ "$(step_result "$s")" = "FAIL" ] && fails=$((fails+1)); done
oks=0; for s in $ALL; do [ "$(step_result "$s")" = "OK" ] && oks=$((oks+1)); done
say "=== Team No Sleep done: $oks ok, $fails failed, free $(free_gb) GB -> $BUILD/STATUS.md ==="
osascript -e "display notification \"$oks steps ok, $fails failed. See build/STATUS.md\" with title \"Team No Sleep finished\"" >/dev/null 2>&1
[ $fails -gt 0 ] && exit 1
[ $overall -eq 10 ] && exit 10
exit 0
