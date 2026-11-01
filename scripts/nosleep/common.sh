# Shared helpers for the "no sleep" build scripts. Source this; do not run it.
# Rules: never start KITT, the WhatsApp listener or any local service (Travis stopped them on purpose); never sudo;
# never touch signing; everything writes to build/ (gitignored) and appends one row per step to build/STATUS.md.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/../.." && pwd)"
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
LOGS="$ROOT/build/logs"; DD="$ROOT/build/DerivedData"; STATUS="$ROOT/build/STATUS.md"
mkdir -p "$LOGS" "$DD"
[ -f "$STATUS" ] || printf '# Build status\n\n| time | step | result | seconds | log |\n|---|---|---|---|---|\n' > "$STATUS"

free_gb() { df -g /System/Volumes/Data | awk 'NR==2 {print $4}'; }

# step <name> <command...>  — run, time, log, record. Returns the command's exit code.
step() {
  local name="$1"; shift
  local log="$LOGS/${name// /-}-$(date +%H%M%S).log" t0; t0=$(date +%s)
  printf '>> %s\n' "$name"
  "$@" > "$log" 2>&1; local rc=$?
  local secs=$(( $(date +%s) - t0 ))
  printf '| %s | %s | %s | %s | %s |\n' "$(date '+%d %b %H:%M')" "$name" "$([ $rc -eq 0 ] && echo PASS || echo "FAIL ($rc)")" "$secs" "${log#$ROOT/}" >> "$STATUS"
  if [ $rc -eq 0 ]; then printf '   PASS (%ss)\n' "$secs"; else printf '   FAIL rc=%s (%ss) — tail of %s:\n' "$rc" "$secs" "${log#$ROOT/}"; grep -E 'error:|FAIL|Error' "$log" | head -6 | cut -c1-200 | sed 's/^/     /'; fi
  return $rc
}
