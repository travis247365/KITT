#!/usr/bin/env bash
# Build the macOS app (scheme KITTMac) unsigned. Output: build/DerivedData/Build/Products/Debug/KITT.app
. "$(dirname "$0")/common.sh"
cd "$ROOT/apps/KITT" && xcodebuild -project KITT.xcodeproj -scheme KITTMac -destination 'platform=macOS' -derivedDataPath "$DD" CODE_SIGNING_ALLOWED=NO build
