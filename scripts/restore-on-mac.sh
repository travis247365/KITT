#!/bin/bash
# Restores a kit made by scripts/migrate-to-mac.sh into this Mac's ~/.config/kitt and ~/.local/share/kitt.
#   bash scripts/restore-on-mac.sh <kitt-migration-<date>.tar.enc>     (asks for the passphrase)
set -euo pipefail
KIT=${1:?usage: restore-on-mac.sh <kit.tar.enc>}
[ -f "$KIT" ] || { echo "no such file: $KIT"; exit 1; }
read -rs -p "passphrase: " PASS; echo
mkdir -p "$HOME/.config/kitt" "$HOME/.local/share/kitt"
openssl enc -d -aes-256-cbc -pbkdf2 -pass "pass:$PASS" -in "$KIT" | tar -xz -C "$HOME"
chmod 600 "$HOME/.config/kitt/kitt.env" 2>/dev/null || true
# GRC audit R1: a kit made before 9 Nov 2026 carries server.host 0.0.0.0 (every network interface). Never restore that: anything that is
# not this Mac only becomes "tailscale", and any test window is dropped (scripts/uat-lan.sh on opens one again when needed).
[ -f "$HOME/.config/kitt/kitt.json" ] && python3 -I - "$HOME/.config/kitt/kitt.json" <<'PY'
import json, re, sys
p = sys.argv[1]; d = json.load(open(p)); s = d.setdefault('server', {})
host = str(s.get('host', '127.0.0.1')).strip().lower()
if not (re.fullmatch(r'127\.\d{1,3}\.\d{1,3}\.\d{1,3}', host) or host in ('::1', 'localhost', 'local', 'tailscale')):
    print('server.host was %r: set to "tailscale" (this Mac plus Tailscale)' % host); s['host'] = 'tailscale'
s.pop('lan_until', None); s.pop('lan_network', None)
json.dump(d, open(p, 'w'), indent=2)
PY
chmod 600 "$HOME/.config/kitt/kitt.json" 2>/dev/null || true
echo "restored into ~/.config/kitt and ~/.local/share/kitt; start the hub with: node bin/kitt serve"
