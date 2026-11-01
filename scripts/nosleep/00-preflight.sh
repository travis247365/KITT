#!/usr/bin/env bash
# Is the machine fit to build? Read-only. Exit 1 if a hard floor is breached (the tripwire session alerts Travis at 15/8/3 GB free).
. "$(dirname "$0")/common.sh"
rc=0
f=$(free_gb); echo "free disk: ${f} GB"; [ "$f" -ge 18 ] || { echo "ABORT: under 18 GB free (floor is 15)"; rc=1; }
echo "xcode: $(xcodebuild -version 2>/dev/null | head -1)"
xcodebuild -checkFirstLaunchStatus >/dev/null 2>&1 && echo "xcode first-launch: done" || echo "xcode first-launch: NOT done (sudo xcodebuild -runFirstLaunch) — simulators/device destinations stay limited, compile-only builds still work"
for t in xcodegen swift node npm; do command -v $t >/dev/null || { echo "missing tool: $t"; rc=1; }; done
for p in 2000 7899 8787; do curl -s -m 1 -o /dev/null http://127.0.0.1:$p/ 2>/dev/null && echo "NOTE: something is listening on :$p (expected OFF)"; done
echo "swap: $(sysctl -n vm.swapusage | awk '{print $6}')"
exit $rc
