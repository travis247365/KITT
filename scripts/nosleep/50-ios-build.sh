#!/usr/bin/env bash
# Build the iPhone/iPad app (scheme KITT) for a generic device, unsigned: proves it compiles against the iOS SDK without a simulator or an Apple account.
. "$(dirname "$0")/common.sh"
cd "$ROOT/apps/KITT" && xcodebuild -project KITT.xcodeproj -scheme KITT -destination 'generic/platform=iOS' -derivedDataPath "$DD" CODE_SIGNING_ALLOWED=NO build
