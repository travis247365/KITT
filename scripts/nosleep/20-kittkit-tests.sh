#!/usr/bin/env bash
. "$(dirname "$0")/common.sh"
cd "$ROOT/apps/KITT/KITTKit" && swift test
