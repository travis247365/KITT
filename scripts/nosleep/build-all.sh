#!/usr/bin/env bash
# Run every scriptable build step, in order, without stopping at the first failure. No tokens, no sudo, no services started.
#   scripts/nosleep/build-all.sh            # everything
#   scripts/nosleep/build-all.sh macos ios  # only the named steps (hub kittkit gen macos ios webos)
. "$(dirname "$0")/common.sh"
D="$(dirname "$0")"
want() { [ $# -eq 0 ] && return 0; for w in "${ONLY[@]}"; do [ "$w" = "$1" ] && return 0; done; [ ${#ONLY[@]} -eq 0 ]; }
ONLY=("$@"); fail=0
bash "$D/00-preflight.sh" || { echo "preflight failed; not building"; exit 1; }
want hub     && { step "hub tests"        bash -c "cd '$ROOT' && npm test" || fail=1; }
want kittkit && { step "KITTKit tests"    bash "$D/20-kittkit-tests.sh" || fail=1; }
want gen     && { step "xcodegen"         bash "$D/30-xcodegen.sh" || fail=1; }
want macos   && { step "macOS build"      bash "$D/40-macos-build.sh" || fail=1; }
want ios     && { step "iOS build"        bash "$D/50-ios-build.sh" || fail=1; }
want webos   && { step "webOS package"    bash "$D/60-webos-check.sh" || fail=1; }
echo; tail -n 12 "$STATUS"; echo "free disk: $(free_gb) GB"; exit $fail
