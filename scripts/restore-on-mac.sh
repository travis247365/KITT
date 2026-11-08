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
echo "restored into ~/.config/kitt and ~/.local/share/kitt; start the hub with: node bin/kitt serve"
