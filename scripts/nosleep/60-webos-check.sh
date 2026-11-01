#!/usr/bin/env bash
# The webOS app lives in ~/dev/lgtv-vibehack (another session owns it). This only checks the package exists and is well-formed; it never touches the TV.
. "$(dirname "$0")/common.sh"
L="$HOME/dev/lgtv-vibehack"; ipk="$L/dist/com.tpcl.kitt_1.0.0_all.ipk"
[ -f "$ipk" ] || { echo "missing $ipk (build it: $L/tools/build-kitt-webos-app.sh <mac-ip>)"; exit 1; }
tmp="$(mktemp -d)"; ( cd "$tmp" && ar x "$ipk" 2>/dev/null && ls ) | tr '\n' ' '; echo
( cd "$tmp" && tar -xzf data.tar.gz 2>/dev/null; find . -name appinfo.json | head -1 | xargs cat )
rm -rf "$tmp"; node --check "$L/launcher/app.js" && echo "launcher/app.js parses"
