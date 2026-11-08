# Hosting the hub: the options

The question: how does one hub power the web app (Vercel, with a Cloudflare DR copy), the Mac app, and the iPhone and iPad apps,
from anywhere, not only on the home Wi-Fi? The apps need nothing but an address they can reach (https for the hosted web copies,
http is fine on a private network). What ties the hub to the home Mac today:

| Hub piece | Needs the Mac? | Why |
|---|---|---|
| Money SMS feed | **yes** | reads Messages' database (`chat.db`); the alternative is the iPhone Shortcut relay (docs/SETUP.md, never set up) |
| Brief rendering | **yes** | uses macOS `say` for the voice; a cloud hub needs another text-to-speech |
| WhatsApp listener | no | Baileys session files; runs anywhere the session folder is |
| Composio, GitHub, Vercel, Fly checks | no | API calls with keys |
| Routines, ledger, audit, web app | no | Node + one SQLite file |

## The options

| | 1. Home Mac + Cloudflare Tunnel | 2. Home Mac + ngrok | 3. Home Mac + Tailscale | 4. Cloud hub (Railway, Render, a small VPS) | 5. Hybrid: cloud front door, Mac as worker |
|---|---|---|---|---|---|
| What reaches it | every device, anywhere, https on your own domain; Cloudflare Access (email code) in front | every device, anywhere, https on the fixed ngrok name | your devices only, on a private network; `tailscale serve` gives https | every device, anywhere, https | every device |
| What keeps working | everything (SMS, briefs, WhatsApp) | everything | everything | everything except the SMS feed and the voice until replaced (iPhone relay + a TTS API) | everything |
| Depends on | the Mac awake, home power and internet (load-shedding: a UPS for router and Mac) | the same, plus ngrok's free-plan interstitial (one tap in the app's web view) | the same, plus the Tailscale app on each device | nothing at home | both |
| Your data | stays on the Mac | stays on the Mac | stays on the Mac | the ledger and secrets live in the cloud (encrypt the volume, your personal finance data) | split |
| Cost | 0 (own domain optional) | 0 | 0 | about 5–10 USD a month; Fly.io is blocked by its overdue invoices | the same |
| Work to get there | one login (Cloudflare), one command, a DNS record; the ingress step needs your permission in Claude Code | installed and authenticated already; one command (`scripts/expose.sh`); the same permission | one login per device; no code change | 2–3 days: TTS, SMS relay, container, volume, deploy pipeline | the most |
| Risk | the home line goes down → nothing works until it is back | the same, and ngrok's free limits | the same (private, so the smallest exposure) | an internet-facing hub with your money data; more to keep patched | complexity |

## Where the hub listens (since 0.6.5)

GRC audit 8 Nov 2026, R1: the hub was listening on every network the laptop joined (home, office, hotel) with the firewall off.
Now `server.host` in `~/.config/kitt/kitt.json` decides, and nothing listens on a network by default (`src/net.js`):

| `server.host` | Who can reach the hub |
|---|---|
| `"127.0.0.1"` (the default) | this Mac only (the Mac app, a browser on the Mac, a tunnel agent running on the Mac) |
| `"tailscale"` (this Mac, since 9 Nov) | this Mac, plus your own devices over Tailscale: the hub picks up the Tailscale address within about ten seconds of Tailscale connecting and drops it when it disconnects; connections from any other address are refused |
| `scripts/uat-lan.sh on [hours]` | also every device on any network this Mac is connected to (Wi-Fi, Ethernet, a hotspot), for 1–12 hours (default 4). It ends by itself at the end time; it pauses within about ten seconds of the Mac joining another network (another router, by its hardware address, or another address for the Mac) and resumes if the Mac comes back before then; `off` ends it for good |

`kitt doctor` prints the sockets actually open and the firewall state, and the daily security sweep raises a finding when the hub is
open to the network or the firewall is off. Option 3 above therefore needs no code change: with `server.host` set to `"tailscale"`
(done on this Mac) and the hub restarted, install Tailscale and sign in on the Mac and each device, then use
`http://<the Mac's Tailscale address>:2000` in the apps.

## Recommendation

**Now: option 3 (Tailscale) or option 1 (Cloudflare Tunnel with Access).** The hub stays where its data and its Mac-only pieces
are, every app and both web copies reach it over https, and nothing in the code changes. Tailscale is the more private of the two
(no public address at all); the Cloudflare Tunnel is the one that also serves the Apple TV or a browser on a machine without
Tailscale. Both need you to sign in once on the Mac; the step that opens the Mac to the outside is the one Claude Code asks your
permission for.

**Later: option 4**, once the two Mac-bound pieces are portable: the iPhone SMS relay (the Shortcut that forwards MoMo, Airtel,
FNB and Stanbic texts to `/v1/sms`), and a TTS API for the briefs. Then a small always-on host removes the dependency on home power
and the Mac being awake, which is the real weakness of 1–3 in Lusaka.

Whatever hosts it, the web copies (Vercel, and the Cloudflare DR copy) only need the hub's https address typed once; the native
apps keep their token and change only the address.
