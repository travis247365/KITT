#!/bin/bash
# Backs up Kitt's development environment to iCloud Drive › KITT › backups › <date> (docs/BACKUP.md):
#   kitt-repo.bundle          every branch and tag of this repository (git clone <bundle> restores it)
#   kitt-public.bundle        the scrubbed public mirror, when ~/dev/kitt-public exists
#   kitt-untracked.tar.gz     files git ignores on purpose but a rebuild needs (Vercel link, signing team, design, plans, shortcuts)
#   kitt-secrets.tar.enc      ENCRYPTED: ~/.config/kitt, ~/.local/share/kitt, ngrok config, launchd agents, provisioning profiles
#   environment.txt           macOS, Node, Xcode, Homebrew packages, launchd jobs
# The passphrase is the one in ~/.config/kitt/migration-passphrase.txt (made once, mode 600, never written anywhere else).
#   bash scripts/backup-to-icloud.sh [output folder]
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT=${1:-"$HOME/Library/Mobile Documents/com~apple~CloudDocs/KITT/backups/$(date +%F)"}
PASSFILE="$HOME/.config/kitt/migration-passphrase.txt"
mkdir -p "$OUT"
[ -s "$PASSFILE" ] || (umask 077; openssl rand -base64 24 > "$PASSFILE")

# 1 the repositories
(cd "$ROOT" && git bundle create "$OUT/kitt-repo.bundle" --all >/dev/null 2>&1 && git rev-parse --short HEAD > "$OUT/kitt-repo.HEAD")
[ -d "$HOME/dev/kitt-public/.git" ] && (cd "$HOME/dev/kitt-public" && git bundle create "$OUT/kitt-public.bundle" --all >/dev/null 2>&1) || true

# 2 untracked files a rebuild needs
UNTRACKED=()
for p in .vercel apps/KITT/Config/Signing.local.xcconfig design docs/HIGGSFIELD_PLAN.md docs/HIGGSFIELD_PLAN_v1.1.md docs/RUN_PLAN_3X.md shortcuts; do [ -e "$ROOT/$p" ] && UNTRACKED+=("$p"); done
(cd "$ROOT" && tar -czf "$OUT/kitt-untracked.tar.gz" --exclude='*/xcuserdata' "${UNTRACKED[@]}")

# 3 secrets and data, encrypted (the ledger is checkpointed first so the copy is one consistent file)
sqlite3 "$HOME/.local/share/kitt/kitt.sqlite" "PRAGMA wal_checkpoint(TRUNCATE);" >/dev/null 2>&1 || true
cd "$HOME"
SECRET=()
for p in .config/kitt .local/share/kitt "Library/Application Support/ngrok/ngrok.yml" "Library/Developer/Xcode/UserData/Provisioning Profiles"; do [ -e "$p" ] && SECRET+=("$p"); done
for p in Library/LaunchAgents/com.tpcl.kitt*.plist Library/LaunchAgents/com.tpcl.lgtv*.plist; do [ -e "$p" ] && SECRET+=("$p"); done
# whatsapp-auth.loggedout-* are sessions WhatsApp already ended (tens of thousands of key files): not worth keeping
tar -cz --exclude='*.sqlite-wal' --exclude='*.sqlite-shm' --exclude='.config/kitt/whatsapp-auth.loggedout-*' "${SECRET[@]}" | openssl enc -aes-256-cbc -pbkdf2 -salt -pass "file:$PASSFILE" -out "$OUT/kitt-secrets.tar.enc"
N=$(openssl enc -d -aes-256-cbc -pbkdf2 -pass "file:$PASSFILE" -in "$OUT/kitt-secrets.tar.enc" | tar -tz | wc -l | tr -d ' ')

# 4 the machine
{ sw_vers; echo; echo "node $(node -v)  npm $(npm -v)"; xcodebuild -version 2>/dev/null | tr '\n' ' '; echo; echo; echo "## brew"; brew list --versions 2>/dev/null; echo; echo "## launchd (com.tpcl)"; launchctl list 2>/dev/null | grep -E "com\.tpcl" || true; } > "$OUT/environment.txt" 2>&1
cp "$ROOT/docs/BACKUP.md" "$OUT/README.md"
echo "backup: $OUT"; (cd "$OUT" && du -h ./* | awk '{printf "  %-6s %s\n", $1, substr($2, 3)}'); echo "  secrets archive opens: $N files"
