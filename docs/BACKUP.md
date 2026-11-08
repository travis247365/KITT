# Backing up Kitt

`bash scripts/backup-to-icloud.sh` writes a dated folder into iCloud Drive › KITT › backups (another folder: first argument):

| File | What it is | Restore |
|---|---|---|
| `kitt-repo.bundle` | every branch and tag of this repository (a complete clone source) | `git clone kitt-repo.bundle ~/dev/kitt`, then `git remote set-url origin https://github.com/travis247365/kitt-private.git` |
| `kitt-repo.HEAD` | the commit the bundle was made at | |
| `kitt-untracked.tar.gz` | files git ignores on purpose but the build needs: the Vercel link (`.vercel/`), the signing team (`Config/Signing.local.xcconfig`), the design folder, the plans, the built Shortcuts | `tar -xzf kitt-untracked.tar.gz -C ~/dev/kitt` |
| `kitt-secrets.tar.enc` | **encrypted**: `~/.config/kitt` (config, secrets, SMS cursor), `~/.local/share/kitt` (the ledger with its backups, briefs audio, WhatsApp session), ngrok's config, the launchd agents, the Xcode provisioning profiles | `openssl enc -d -aes-256-cbc -pbkdf2 -in kitt-secrets.tar.enc \| tar -xz -C ~` (asks for the passphrase) |
| `environment.txt` | macOS, Node, Xcode, Homebrew packages, the launchd jobs | read it when setting a Mac up |
| `README.md` | this file | |

The GitHub repositories (private `kitt-private`, public `KITT`) are the other copy of the code; the bundle is for the day GitHub or
the account is not there.

## The passphrase

`kitt-secrets.tar.enc` is encrypted with the passphrase in `~/.config/kitt/migration-passphrase.txt` on this Mac (mode 600, made
once by `scripts/migrate-to-mac.sh` or this script). **A backup that only opens with a key kept on the same Mac is not a backup of
that Mac**: put the passphrase in your password manager once (`cat ~/.config/kitt/migration-passphrase.txt` at the Mac). It is
never printed by the scripts, never written to iCloud, never put in a chat.

## How often

By hand today. For a weekly run: `launchd/com.tpcl.kitt-backup.plist` can be written on request (Sunday 20:00, the script above);
iCloud keeps the dated folders, delete old ones yourself (never automatically). The ledger database is checkpointed before it is
copied, so the copy is consistent.

## Not in the backup

`node_modules`, `build/`, `mockups/dist`, Xcode's DerivedData and the simulator runtimes: all re-made from the repository
(`npm ci`, `npm run build`, `xcodegen generate`, `bash scripts/uat-install.sh`).
