#!/usr/bin/env bash
# Regenerate the Xcode project from project.yml (deterministic; commit the result if it changes).
. "$(dirname "$0")/common.sh"
cd "$ROOT/apps/KITT" && xcodegen generate
