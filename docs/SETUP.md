# KITT: set-up

Run these on the Mac that will host the hub (Node 22.13 or later; Node 26 recommended).

1. **Config and secrets.** Defaults are in `config/defaults.json`. Put your own values in `~/.config/kitt/kitt.json` (owner name, e-mail, aliases,
   phone, skill settings) and secrets in `~/.config/kitt/kitt.env` (mode 600). Never commit either file. `kitt setup` shows what is configured.
2. **Tokens.** `kitt token new` creates the Mac-only token; app and feed tokens are separate and scoped (read / write).
3. **Run the hub.** `node bin/kitt serve` (127.0.0.1:2000). To keep it running: `sh scripts/install.sh` installs a launchd user agent from
   `launchd/com.tpcl.kitt.plist`; the installer fills in your paths.
4. **Reach it from your phone.** The hub binds to localhost only. Expose it through a private tunnel (Tailscale) or an HTTPS tunnel
   (`scripts/expose.sh` writes an ngrok launchd agent); the Apple clients require HTTPS.
5. **Siri Shortcuts.** `node bin/kitt shortcuts build https://<your-host>` writes signed shortcuts into `./shortcuts`.
6. **Skills that need a login.** The operations board (`kitt secret set KITT_COO_PASSWORD`, with `chief.base_url` in `kitt.json`), the WhatsApp
   link (`kitt whatsapp link`, read `docs/WHATSAPP.md` first), Composio-backed skills (`composio link <toolkit>`), Cloudflare/GitHub/Vercel/Fly
   tokens for the security skill (`security.cloudflare_account` in `kitt.json`).
7. **Apple clients.** See `apps/KITT/README.md` (XcodeGen, then build the `KITT`, `KITTMac` and `KITTtv` schemes; signing needs your own Apple
   Developer team).

Everything that writes, sends or spends needs a spoken or on-screen confirmation first.
