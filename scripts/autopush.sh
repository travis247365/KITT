#!/bin/bash
# Pushes committed work to both repositories whenever the internet is there. Plain shell: no AI, no tokens. launchd runs it every
# ten minutes (scripts/install-autopush.sh), or run it by hand. One pass:
#   - does nothing when GitHub is not reachable, when another pass is running, or when there is nothing to push;
#   - pushes the private `main` only when it is strictly ahead of origin (never force; a branch that is behind is logged for you);
#   - then publishes the same commit to the public repository through scripts/public-sync/sync.sh (export, scrub, leak scan,
#     tests, push), once per commit; a failed scan or test stops the public side and is logged;
#   - never commits for you, unless KITT_AUTOPUSH_COMMIT=1: then tracked changes only (never untracked files), as "autosave <date>".
#   bash scripts/autopush.sh          log: ~/Library/Logs/kitt-autopush.log (one line per pass that did or found something)
set -uo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
LOG="$HOME/Library/Logs/kitt-autopush.log"
STATE="$HOME/.config/kitt/autopush.state"          # the private commit last published to the public repository
LOCK="${TMPDIR:-/tmp}/kitt-autopush.lock"
export GIT_TERMINAL_PROMPT=0 GIT_ASKPASS=/usr/bin/false
mkdir -p "$(dirname "$LOG")" "$(dirname "$STATE")"
log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG"; }
if [ -f "$LOG" ] && [ "$(stat -f%z "$LOG")" -gt 300000 ]; then tail -n 400 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"; fi

# one pass at a time (mkdir is atomic); a lock older than an hour belongs to a pass that died
if ! mkdir "$LOCK" 2>/dev/null; then
  if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +60 2>/dev/null)" ]; then rmdir "$LOCK" 2>/dev/null; mkdir "$LOCK" 2>/dev/null || exit 0; else exit 0; fi
fi
trap 'rmdir "$LOCK" 2>/dev/null' EXIT

# the internet, and GitHub in particular
curl -sI -m 8 https://github.com >/dev/null 2>&1 || exit 0

cd "$ROOT" || exit 0
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || { log "not a git repository: $ROOT"; exit 0; }

if [ "${KITT_AUTOPUSH_COMMIT:-0}" = "1" ] && ! git diff --quiet HEAD -- 2>/dev/null; then
  git add -u && git commit -q -m "autosave $(date '+%Y-%m-%d %H:%M')" && log "committed tracked changes (autosave)"
fi

git fetch -q origin main 2>>"$LOG" || { log "fetch failed"; exit 0; }
BRANCH=$(git rev-parse --abbrev-ref HEAD)
[ "$BRANCH" = "main" ] || { log "on branch $BRANCH, not main: nothing pushed"; exit 0; }
AHEAD=$(git rev-list --count origin/main..HEAD)
BEHIND=$(git rev-list --count HEAD..origin/main)
if [ "$BEHIND" -gt 0 ]; then log "main is $BEHIND commit(s) behind origin and $AHEAD ahead: pull or rebase by hand, nothing pushed"; exit 0; fi
if [ "$AHEAD" -gt 0 ]; then
  if git push -q origin main 2>>"$LOG"; then log "private: pushed $AHEAD commit(s), head $(git rev-parse --short HEAD)"; else log "private: push failed"; exit 0; fi
fi

# the public repository: once per private commit
HEAD_SHA=$(git rev-parse HEAD)
if [ -f scripts/public-sync/sync.sh ] && [ "$(cat "$STATE" 2>/dev/null)" != "$HEAD_SHA" ]; then
  if OUT=$(bash scripts/public-sync/sync.sh 2>&1); then
    echo "$HEAD_SHA" > "$STATE"
    log "public: $(echo "$OUT" | grep -E "public repo" | tail -1 | tr -d '\n') (from $(git rev-parse --short HEAD))"
  else
    log "public: NOT published: $(echo "$OUT" | grep -E "LEAK|scrub:|fails its tests|error|fatal" | head -3 | tr '\n' ' ')"
  fi
fi
exit 0
