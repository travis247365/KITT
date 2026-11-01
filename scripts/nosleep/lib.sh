#!/usr/bin/env bash
# Shared helpers for the "Team No Sleep" build job. Plain shell on purpose: zero tokens, resumable, no hidden state.
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BUILD="$ROOT/build"; LOGS="$BUILD/logs"; STATE="$BUILD/state"
mkdir -p "$LOGS" "$STATE"
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
MIN_FREE_GB="${MIN_FREE_GB:-18}"        # the memory/disk tripwire alerts at 15, 8 and 3 GB: stay clear of it
free_gb() { df -k /System/Volumes/Data | awk 'NR==2 {printf "%d", $4/1048576}'; }
now() { date '+%Y-%m-%d %H:%M:%S'; }
say() { printf '%s %s\n' "$(now)" "$*"; }

# run_step <name> <timeout-seconds> <command...>   Resumable: a step with a .ok marker is skipped unless FORCE=1.
# Returns 0 ok, 1 failed, 10 blocked (disk). Each step logs to build/logs/<name>.log.
run_step() {
  local name="$1" to="$2"; shift 2
  if [ -f "$STATE/$name.ok" ] && [ -z "${FORCE:-}" ]; then say "SKIP    $name (already ok: $(cut -d' ' -f3- "$STATE/$name.ok" 2>/dev/null))"; return 0; fi
  local f; f=$(free_gb)
  if [ "$f" -lt "$MIN_FREE_GB" ]; then say "BLOCKED $name: only ${f} GB free (guard ${MIN_FREE_GB} GB)"; echo "disk ${f}GB" > "$STATE/$name.blocked"; return 10; fi
  rm -f "$STATE/$name.fail" "$STATE/$name.blocked"
  say "START   $name"
  local t0=$SECONDS rc=0
  perl -e 'alarm shift; exec @ARGV' "$to" "$@" > "$LOGS/$name.log" 2>&1 || rc=$?
  if [ "$rc" -eq 0 ]; then echo "$(now) ${SECONDS}s $((SECONDS-t0))s" > "$STATE/$name.ok"; say "OK      $name ($((SECONDS-t0))s)"; return 0; fi
  echo "rc=$rc $(now)" > "$STATE/$name.fail"; say "FAIL    $name rc=$rc  -> $LOGS/$name.log"; return 1
}

step_result() { # name -> OK|FAIL|BLOCKED|NOT RUN
  if [ -f "$STATE/$1.ok" ]; then echo OK; elif [ -f "$STATE/$1.fail" ]; then echo FAIL; elif [ -f "$STATE/$1.blocked" ]; then echo BLOCKED; else echo "NOT RUN"; fi
}
step_secs() { [ -f "$STATE/$1.ok" ] && awk '{print $4}' "$STATE/$1.ok" || echo "-"; }
