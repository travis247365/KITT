#!/bin/bash
# Standing instruction: after a commit, update BOTH repos. Pushes the private repo, then publishes the scrubbed public copy.
#   scripts/sync-repos.sh [--dry-run]     (--dry-run only previews the public side)
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"
if [ "${1:-}" != "--dry-run" ]; then git push origin HEAD:main; fi
bash "$ROOT/scripts/public-sync/sync.sh" "$@"
