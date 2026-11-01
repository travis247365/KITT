#!/usr/bin/env bash
# Read-only check of the built webOS packages (never installs, never rebuilds, never touches the TV or the lgtv-vibehack repo).
set -u
DIST="${LGTV_DIST:-$HOME/dev/lgtv-vibehack/dist}"
rc=0
shopt -s nullglob
files=("$DIST"/*.ipk)
[ ${#files[@]} -gt 0 ] || { echo "no .ipk in $DIST"; exit 1; }
for f in "${files[@]}"; do
  echo "== $(basename "$f")  $(stat -f %z "$f") bytes"
  ar t "$f" | tr '\n' ' '; echo
  inner=$(ar p "$f" data.tar.gz | tar -tz 2>/dev/null | grep 'appinfo.json$' | head -1)
  [ -n "$inner" ] || { echo "  no appinfo.json inside"; rc=1; continue; }
  ar p "$f" data.tar.gz | tar -xzO "$inner" | python3 -c "
import json,sys
d=json.load(sys.stdin)
need=['id','version','type','main','title']
miss=[k for k in need if k not in d]
print('  appinfo:', {k:d.get(k) for k in need})
sys.exit(1 if miss else 0)" || { echo "  appinfo.json missing required keys"; rc=1; }
  entries=$(ar p "$f" data.tar.gz | tar -tz 2>/dev/null | grep -c '\.html$')
  echo "  html files inside: $entries"
done
exit $rc
