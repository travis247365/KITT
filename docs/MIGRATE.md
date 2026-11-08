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
4. **Start:** `node bin/kitt serve` (or `node bin/kitt restart`). `npm test` should pass. Since 0.6.5 the hub listens on this Mac only (port 2000; the restore script resets a kit made before 9 Nov 2026,
   which still says every interface, to `"tailscale"`); other devices reach it over Tailscale
   (`server.host: "tailscale"` in `~/.config/kitt/kitt.json`) or, at home, during a `bash scripts/uat-lan.sh on` window (docs/HOSTING.md).
5. **Money SMS:** System Settings › Privacy & Security › Full Disk Access › Terminal on, quit and reopen Terminal, start the hub from
   there (docs/SETUP.md step 7). The iPhone's Text Message Forwarding must include this Mac (iPhone › Settings › Apps › Messages ›
   Text Message Forwarding).
6. **WhatsApp:** the session came with the kit; `node src/skills/whatsapp/listener.mjs` (or the launchd agent, `scripts/install-whatsapp.sh`).
7. **Your address:** the Mac's Tailscale address (`tailscale ip -4`), or during a `uat-lan.sh on` window `ipconfig getifaddr en0`
   (or `scutil --get LocalHostName` + `.local`). The apps keep their token; only the hub address changes.

## Pointing the apps at the new Mac

| Where | What to do |
|---|---|
| iPhone, iPad | Settings › Connection (or the surface's Settings › Connection settings) › hub address `http://<new-mac>:2000` › Connect |
| Mac app on the new Mac | `bash scripts/uat-install-mac.sh` builds and installs it; first run asks for the address and the app token (`kitt token new` prints one, or reuse the saved one from the kit's `kitt.env`: `KITT_APP_TOKEN`) |
| Apple TV, LG TV | the Apple TV over Tailscale or in a `uat-lan.sh on` window; the LG TV through the Mac's launcher (`~/dev/lgtv-vibehack`), which answers only the paired TV |
| Web (hosted copy) | needs an https hub: a tunnel (docs/WEB.md) |

Nothing in the apps needs rebuilding for a move; the hub address is the only thing that changes.

## Going back

Run the kit the other way: `migrate-to-mac.sh` on the new Mac, `restore-on-mac.sh` on the old one, so the ledger and the
WhatsApp session come back with you. Start only one hub at a time.
