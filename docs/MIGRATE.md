# Moving the hub to another Mac

Kitt's hub is one Node process plus two folders: `~/.config/kitt` (config, secrets, the SMS cursor) and `~/.local/share/kitt`
(the SQLite database with the money ledger, briefs, WhatsApp session). Moving it is: make an encrypted kit of those folders on the
old Mac, clone the repository on the new Mac, restore the kit, start the hub, and point the apps at the new Mac's address.

## On the old Mac (the one running the hub today)

```sh
bash scripts/migrate-to-mac.sh
```

Writes `kitt-migration-<date>.tar.enc` into iCloud Drive › KITT (another folder: pass it as the first argument), encrypted with a
passphrase kept only in `~/.config/kitt/migration-passphrase.txt` on that Mac. Rendered audio, the spool and the ledger backups are
left out (large, and re-made). Then stop the hub there (`pkill -f "bin/kitt serve"`, and the WhatsApp listener): two hubs with
the same WhatsApp session log each other out, and two money ledgers drift apart.

## On the new Mac

1. **Node 26** and **XcodeGen** (for the apps only; the hub needs Node): `brew install node xcodegen`.
2. **The repository:** `git clone https://github.com/travis247365/kitt-private.git ~/dev/kitt` (your GitHub login), then
   `cd ~/dev/kitt && npm ci && (cd mockups && npm ci && npm run build)`.
3. **The kit:** `bash scripts/restore-on-mac.sh ~/Library/Mobile\ Documents/com~apple~CloudDocs/KITT/kitt-migration-<date>.tar.enc`
   (asks for the passphrase). It fills `~/.config/kitt` and `~/.local/share/kitt`.
4. **Start:** `node bin/kitt serve` (or `node bin/kitt restart`). `npm test` should pass. The hub listens on every interface, port 2000.
5. **Money SMS:** System Settings › Privacy & Security › Full Disk Access › Terminal on, quit and reopen Terminal, start the hub from
   there (docs/SETUP.md step 7). The iPhone's Text Message Forwarding must include this Mac (iPhone › Settings › Apps › Messages ›
   Text Message Forwarding).
6. **WhatsApp:** the session came with the kit; `node src/skills/whatsapp/listener.mjs` (or the launchd agent, `scripts/install-whatsapp.sh`).
7. **Your address:** `ipconfig getifaddr en0` (or `scutil --get LocalHostName` + `.local`). With the phone's hotspot it is the Mac's
   address on that hotspot. The apps keep their token; only the hub address changes.

## Pointing the apps at the new Mac

| Where | What to do |
|---|---|
| iPhone, iPad | Settings › Connection (or the surface's Settings › Connection settings) › hub address `http://<new-mac>:2000` › Connect |
| Mac app on the new Mac | `bash scripts/uat-install-mac.sh` builds and installs it; first run asks for the address and the app token (`kitt token new` prints one, or reuse the saved one from the kit's `kitt.env`: `KITT_APP_TOKEN`) |
| Apple TV, LG TV | the same address, when they are on the same network as the new Mac |
| Web (hosted copy) | needs an https hub: a tunnel (docs/WEB.md) |

Nothing in the apps needs rebuilding for a move; the hub address is the only thing that changes.

## Going back

Run the kit the other way: `migrate-to-mac.sh` on the new Mac, `restore-on-mac.sh` on the old one, so the ledger and the
WhatsApp session come back with you. Start only one hub at a time.
