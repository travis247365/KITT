#!/bin/bash
# Makes an encrypted kit of this Mac's Kitt (config, secrets, the SQLite ledger, the WhatsApp session) for a move to another Mac.
#   bash scripts/migrate-to-mac.sh [output folder]      default: iCloud Drive › KITT
# The passphrase is generated once and kept only in ~/.config/kitt/migration-passphrase.txt (mode 600). Restore with
# scripts/restore-on-mac.sh on the other Mac. Audio, the spool and the ledger backups are left out. See docs/MIGRATE.md.
set -euo pipefail
OUT=${1:-"$HOME/Library/Mobile Documents/com~apple~CloudDocs/KITT"}
PASSFILE="$HOME/.config/kitt/migration-passphrase.txt"
KIT="$OUT/kitt-migration-$(date +%F).tar.enc"
mkdir -p "$OUT"
if [ ! -s "$PASSFILE" ]; then (umask 077; openssl rand -base64 24 > "$PASSFILE"); echo "passphrase written to $PASSFILE"; fi
cd "$HOME"
INCLUDE=()
for p in .config/kitt/kitt.json .config/kitt/kitt.env .config/kitt/public-blocklist.txt .config/kitt/sms-watch-cursor.json .local/share/kitt; do [ -e "$p" ] && INCLUDE+=("$p"); done
tar -cz --exclude='.local/share/kitt/audio' --exclude='.local/share/kitt/spool' --exclude='.local/share/kitt/backups' --exclude='*.sqlite-wal' --exclude='*.sqlite-shm' "${INCLUDE[@]}" \
  | openssl enc -aes-256-cbc -pbkdf2 -salt -pass "file:$PASSFILE" -out "$KIT"
N=$(openssl enc -d -aes-256-cbc -pbkdf2 -pass "file:$PASSFILE" -in "$KIT" | tar -tz | wc -l | tr -d ' ')
echo "kit: $KIT ($(du -h "$KIT" | cut -f1), $N files, opens with the passphrase)"
echo "next: stop the hub on this Mac before starting it on the other one (docs/MIGRATE.md)"
