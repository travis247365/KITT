# Changelog

## 0.6.5 — 2026-11-09
- Fix, security (GRC audit 8 Nov, R1): the hub no longer listens on every network the laptop joins. It had been on all interfaces
  since `scripts/uat-lan.sh on` (the setting never ended), with the macOS firewall off. So anyone on the same home, office or hotel
  network could reach it, and the LG proxy's `/kitt` route (which adds a token itself) showed them the brief with the cash position
  and client names. Now `src/net.js` decides where it listens:
  - this Mac only by default;
  - `server.host: "tailscale"` adds the Mac's Tailscale addresses on their own: picked up within about ten seconds of Tailscale
    connecting and dropped when it disconnects. Only an interface that carries Tailscale's IPv6 prefix counts, so a network that
    hands out 100.64/10 addresses is never mistaken for it, even when typed in as a literal address. Connections from any other
    address are refused;
  - the local network (every network the Mac is on: Wi-Fi, Ethernet, a hotspot) only through `scripts/uat-lan.sh on [hours]`, a
    window of 1–12 hours that ends by itself at the end time. The script records the network it was opened on: the router's address
    and hardware address, read from each physical interface's service in the system configuration store (so a VPN as the primary
    service does not hide it), plus the Mac's own address. On macOS it refuses to open a window when the router cannot be read. The
    window pauses within about ten seconds of the Mac joining another network (or of the router becoming unreadable) and resumes if
    the Mac comes back before the end time; `uat-lan.sh off` ends it for good. A connection that arrives after the end time is
    refused even before the next check;
  - every spelling of "all interfaces" (`0.0.0.0`, `::`, `0`, …) and any other network address or host name still work, but they
    are warned about at start, and `uat-lan.sh off` replaces them with `"tailscale"`. `off` then lists the sockets actually open and
    fails if one is still on the network.
- `/tv` (the TV and big-screen view) shows counts and status only: "Morning brief ready", the pending and coverage pills, which skill
  needs attention. It never shows the brief's text or a skill's health detail; the brief is heard in the app.
- The security sweep checks this Mac too (provider `mac`, read-only). It reads the hub's real sockets as well as its plan, so a hub
  socket on the network is raised even when the config says otherwise (HIGH unless the firewall is confirmed on). The firewall off
  is MEDIUM; other node/python servers open to the network are LOW. A run that cannot read the firewall never clears an earlier
  "off", and a run that cannot read the sockets leaves those findings as they were.
- Fix, security sweep (found while reviewing the above): a check that could not run no longer clears what it found before. A
  provider that could not run at all (GitHub, Vercel or Fly unreachable, Cloudflare zones unreadable, the Cloudflare token invalid or
  removed) keeps its open findings; a sub-check that failed part-way (GitHub 2FA, Dependabot or secret scanning for one repo, Vercel
  env or domains, Fly certificates, a Cloudflare zone setting) keeps the findings it would have produced, and the provider's note says
  "partial". Each observation is now compared with its own latest earlier value, so a failed run is never the baseline and, for
  example, a repo that turns public across a failed sweep is still reported. Removing the Cloudflare token settles the old "token
  invalid" finding. Test: `test/skills/security.test.js` (a stub `gh`).
  `kitt doctor` prints the hub's open sockets, the other servers open to the network and the firewall state.
- Shutting the hub down lets requests in progress finish again; only a listener whose address leaves the plan has its connections
  cut. `close()` waits for a change in progress, so nothing is left listening.
- In-app and web texts no longer say the hub is on the home Wi-Fi: they point at Tailscale (the connect screens and their
  address placeholders, the unreachable panel, the CarPlay and Siri messages, the web connect screen). `scripts/restore-on-mac.sh`
  resets a kit made before 9 Nov 2026 (which still says every interface) to `"tailscale"`; `docs/BACKUP.md` says to run
  `uat-lan.sh off` after restoring an older backup.
- Outside this repo, in the LG TV launcher (`~/dev/lgtv-vibehack`; earlier versions of `launcher/server.py`, `tools/autohome.py`,
  `tools/lgtv.py`, `tools/tvguard.py`, `state/tv.json`, `CLAUDE.md` and `docs/INSTALL-WEBOS-APP.md` kept next to them as `*.bak-20261109-*`):
  - every route answers only this Mac, or a sender at the TV's address while the paired TV proves itself there. The proof is a TLS
    handshake against the TV's own certificate on port 3001, pinned in `state/tv.json` by `tools/tvguard.py pin`, cached for ten
    seconds per (TV address, Mac address). Anyone else gets 403, at home or on another network that reuses the same numbering;
  - the pairing key is sent only after a 4 s probe of port 3001 shows the pinned certificate (nothing there, or another certificate:
    no socket opened, nothing sent), then over `wss://TV:3001` with the certificate checked again on that same socket, or over the
    plain socket if the TV refuses wss. The link used is logged once per process. This is in the server, the auto-home loop and
    `tools/lgtv.py`, including a first pairing once a certificate is pinned. Not yet tried against the TV: it was off;
  - a web page cannot drive it: the Host header must be an IP address or localhost, a browser `Origin` must be the launcher itself
    (or `null`/`file://` from the proven TV, for the packaged Home app), a POST must be JSON and Transfer-Encoding is refused, and every
    response closes its connection, so nothing after a request is ever parsed as another one; an idle connection times out after 15 s;
  - `/icon/` can no longer read files outside the icon folder (it could read any `.png` the user can read);
  - it uses a new read-only `KITT_READ_TOKEN` instead of the app token.
- On this Mac, `kitt.json` moved to `server.host: "tailscale"` (the old file is kept next to it) and the Mac app to
  `http://127.0.0.1:2000`. Until Tailscale is installed and signed in, the iPhone and iPad reach the hub only during a `uat-lan.sh on`
  window at home.
- The window tests bind "every interface" to `::1`, so `npm test` (which also runs unattended in the public sync) never opens a port on
  the network it runs on; `KITT_TEST_LAN=1` adds one real check.

## 0.6.4 — 2026-11-08
- Fix, hub: the language-brain fallback never ran. `route()` in `src/intents/router.js` took one argument while `app.js` passed a
  second (`{ fast }` for Siri's shorter timeout), so `fast` was undeclared and every question the grammar did not match threw
  "fast is not defined" before the classifier was called; the app then said "I couldn't reach my language brain", which was not
  true. Since 27 Oct (commit e03b4fe) no free-text ask from any client reached the model. Found by the 8 Nov engineering and AI
  reviews of the v1.0.0 assessment (`docs/reviews/2026-11-08-platform-v1-bj-review.md`). Now `route(text, { fast })`, with a test
  that drives a stub brain through a grammar miss (the old test passed `brain: null`, so it could never see this).

## 0.6.3 — 2026-11-08
- Tooling: `scripts/autopush.sh`, a plain shell script launchd runs every ten minutes (`scripts/install-autopush.sh`,
  `launchd/com.tpcl.kitt-autopush.plist`): when GitHub is reachable it pushes committed work on `main` to the private repository
  (only when strictly ahead, never force) and publishes the same commit to the public one through the scrub and leak scan, once per
  commit. It never commits on its own unless asked (`KITT_AUTOPUSH_COMMIT=1`, tracked files only). Log in
  `~/Library/Logs/kitt-autopush.log`. Details in `docs/BACKUP.md`.

## 0.6.2 — 2026-11-08
- Backup: `scripts/backup-to-icloud.sh` writes a dated folder into iCloud Drive › KITT › backups: a git bundle of every branch
  and tag (and of the public mirror), the untracked files a rebuild needs, the secrets and data encrypted with the passphrase kept
  only on the Mac, and a description of the machine. `docs/BACKUP.md` says how each piece is restored and why the passphrase
  belongs in your password manager.
- Disaster recovery for the web app: a second copy on Cloudflare Pages (project `kitt-web`, `scripts/deploy-cloudflare.sh`),
  the same build Vercel serves with the same headers (`mockups/public/_headers`); the hub's default CORS list now includes it.
- `docs/HOSTING.md`: the options for hosting the hub so the web, Mac, iPhone and iPad apps reach it from anywhere, what each
  keeps working, what it costs and a recommendation.

## 0.6.1 — 2026-11-08
- Tooling: moving the hub to another Mac. `scripts/migrate-to-mac.sh` makes an encrypted kit (config, secrets, the ledger, the
  WhatsApp session; audio, spool and backups left out) into iCloud Drive › KITT with a passphrase kept only on the old Mac;
  `scripts/restore-on-mac.sh` restores it on the new one. `docs/MIGRATE.md` is the step list, including pointing the apps at the
  new address (nothing in the apps needs rebuilding).

## 0.6.0 — 2026-11-08
- **Widgets** (iPhone, iPad), in the design of the mockups' widget row: **Now** (the number that needs you, a decision waiting or
  skills to review, with the status; small on the home screen, and on the Lock Screen as the circular count, the rectangular
  headline and the inline line), **Cash** (the position across wallets, a 14-day spend sparkline, the Measured mark and how old
  the balances are; small and medium) and **Brief** (the newest brief, the hub's headline and a Play button that starts it
  without opening the app; medium). Tapping a widget opens the app on its home surface. The app writes what they show into an
  App Group (`group.com.tpcl.kitt`) whenever its state refreshes, and the Cash figures come from the Money skill's view at most
  every five minutes; the widgets never see the hub or the token. A widget placed before the app has run once says so.
- Hub client: a typed `moneyView()` (balances, spend windows, newest transactions). Entitlements: device builds now carry
  `Config/KITT.entitlements` (the App Group; the CarPlay key is added there after Apple's approval), the widget extension
  `Config/KITTWidgets.entitlements`.
- The Mac and the Apple TV have no widgets of this kind; they carry the version only.

## 0.5.1 — 2026-11-08
- Fix, CarPlay: the Briefs rows handed the car a raw 600 px image to scale; they now draw the artwork once at the size and scale
  the connected head unit reports (`CPListItem.maximumImageSize` × the car's `displayScale`), so it is sharp on the truck's 9-inch
  display and on a 7-inch unit alike. The Now Playing artwork (`CarArtwork`) is rendered at 1024 px by
  `scripts/make-icons.mjs` instead of a hand-made 600 px file. The templates themselves (tab bar, lists, Now Playing) are drawn by
  the car at its own size, so nothing in the car scene assumes a width. `docs/CARPLAY.md` says what shows in the truck today
  (Now Playing + Siri) and what waits on the entitlement (the Kitt tabs).

## 0.5.0 — 2026-11-08
- **Kitt on the Lock Screen** (iPhone, iPad): a Live Activity card in the design of the mockups' Live Activity, where a music app
  has back · play · next: **Open** (the app, on its home surface), **Talk** (the app opens listening; a locked phone asks for
  Face ID as for any app) and **Brief** (plays the newest brief through the same player as Siri and CarPlay, without opening the
  app). The card shows the hub's headline, status and what is playing; in the Dynamic Island the K mark and status colour, with
  the three buttons when expanded. It starts when the app comes to the front connected, follows every state refresh and player
  change, and ends on disconnect (iOS keeps it for at most 8 hours without a push, then the next open starts a fresh one).
  New extension target `KITTWidgets`; `kitt://open` and `kitt://talk` URL scheme. The Apple TV and the Mac have no Lock Screen;
  there Open is the app itself.

## 0.4.0 — 2026-11-08
- **The designed surface is the app** (iPhone, iPad, Mac): the Overview / Feed / Briefs / Ask / Settings console that opened
  before is replaced, as the front door, by the designed screens the hub serves at `/app` (the phone's Now stack, Briefs,
  Skills and Settings; the iPad and Mac command centre), on the hub's data. The app holds the connection (hub address, Keychain
  token) and hands it to the surface; the surface's Settings opens the app's own connection screen and the hub console (the old
  screens, kept one tap away; on the Mac also Go › Hub Console, ⌘4). Talk to Kit uses the phone's microphone and voice: the
  words appear in the surface's talk sheet as you speak, the hub's answer is shown there and read aloud; Briefs play through the
  app's own player (lock-screen controls, background audio, the copies kept for the car). When the hub cannot be reached the
  app says so and offers Try again and Connection; the Apple TV keeps its native glance board.
- Fix, Mac: the app spun at 35 % CPU, took no clicks and its window controls misbehaved (the Move & Resize menu displaced,
  tiling dead). The header's sweeping light, a TimelineView at 30 frames a second, made the window re-lay out on every frame
  (sampled: the main thread spent all its time in NSWindow layout). The sweep is still on the Mac; the TV and phone keep it.

## 0.3.5 — 2026-11-08
- Fix, Money SMS feed: when macOS refused the Messages database, the feed said only "cannot open the Messages database (unable
  to open database file)", which is what node's SQLite reports for a privacy refusal. It now checks the file itself and says
  what to do: no Full Disk Access for the app running the hub, or no Messages database on this Mac (Text Message Forwarding off).
- Installed on the iPhone and the iPad as build 5 (the first build with a fresh 7-day signing that covers both devices).

## 0.3.4 — 2026-11-08
- Fix, Money SMS feed: nothing read new messages after 5 Nov. `scripts/sms-watch.mjs` had run once by hand (it set its cursor
  and stopped) and was never scheduled, so the ledger's newest transaction stayed at 5 Nov 06:14 UTC with no warning anywhere.
  The hub now runs the watcher itself every 10 minutes (routine `money.sms_watch`, code in `src/skills/money/smswatch.js`,
  shared with the script). It also reads messages Messages keeps only in `attributedBody` (newer macOS leaves `text` empty for
  some; the old watcher skipped them), and ignores outgoing ones. When it cannot read `chat.db` (no Full Disk Access for the app
  the hub runs under) the routine fails with that reason and the Money skill turns red ("SMS feed down since …") instead of
  staying green on a stale ledger. `sms-watch.mjs --since <date>` re-reads from a date; nothing is logged twice. The cursor
  was pointed back to 5 Nov 00:00 UTC, so the first pass with access also covers the hours between the export and the old cursor.
  Off with `money.sms_watch: false`. Docs: `docs/SETUP.md` step 7.

## 0.3.3 — 2026-11-08
- Fix, Money: about 400 real transactions in the message history were never counted, and 46 that never happened were.
  - MTN's newer wording puts the currency after the amount ("You have transferred 150 ZMW to ..."); every pattern read
    "ZMW 150", so transfers to people, agent cash-outs and "Your payment of ... has been completed" were all kept raw. The MTN
    and Airtel parsers now turn "150 ZMW" into "ZMW 150" first (an amount that already has the currency in front is left
    alone), which also lets about 870 counted messages give their balance: the MTN MoMo balance is now dated 5 Nov, not 7 Oct.
  - New readings: FNB card-hold reversals (money back), FNB "Approved for Purchase", FNB airtime, Stanbic loan recoveries
    (account read from "AccNr XX1234"), Airtel loans credited and repaid, Airtel loyalty credits.
  - Not transactions, now refused: payments that failed, were refused or are only initiated (46 MTN "Payment ... failed" messages
    had been counted as spend), airtime received, loan status notices, Airtel cash pick-ups, a scheduled FNB order.
  - Second messages about one payment are not counted twice: an Airtel ZESCO token (its payment arrives as its own message, same
    TrxID), MTN's merchant "You have paid ... Merchant Code" (always followed by "Your payment of ... to <payee>"), the second
    voucher message, and MTN's two wordings of one payment confirmation (the ledger keeps the first of the same wallet, direction
    and amount within 3 minutes, unless both carry different references).
  - An FNB alert naming MTN as the merchant ("reserved for purchase @ Mtn", airtime) was read by the MTN parser; FNB alerts are
    now read as FNB first.
  - The raw log keeps each distinct message once (a re-run no longer adds copies; index on sender and text); a re-read message
    fills in a balance its row lacked.
- Data: the 5 Nov message export was re-read through the new parsers (backup first:
  `~/.local/share/kitt/backups/kitt-before-0.3.3-2026-11-08.sqlite`). Counted transactions 5,461 → 5,807; unread messages
  3,902 → 3,486 (what remains is promotions, failed transactions, loan reminders and token duplicates); the rows that were
  wrong are kept and marked (`kind` not_a_transaction or superseded, `direction` empty), never deleted. A second run adds nothing.
  Every previously counted message keeps its ledger id (checked across all 10,052 messages; only two FNB airtime rows move from
  the MTN wallet to FNB).

## 0.3.2 — 2026-11-08
- Fix, device installs (`scripts/uat-install.sh`): a device that is not yet in the team's signing profile (the iPad) could never
  be added, because the build did not allow device registration; it now passes `-allowProvisioningDeviceRegistration`. `--check`
  (and every run) now says whether Xcode has an Apple account signed in, when the signing profile expires (local time, hours
  left) and which connected devices it covers, and a failed build that needs the account says so. Background: on a free
  Personal Team every install is valid for 7 days from the profile's creation, and without an account in Xcode the cached
  profile can be reused but never renewed: reinstalling does not move the expiry.

## 0.3.1 — 2026-11-07
- Fix, Vercel: every Git deployment of the web app failed in about a second. The repository's `.vercelignore` keeps only `mockups/`
  (so nothing private is ever uploaded) and therefore also strips `.git`; `mockups/vercel.json`'s `ignoreCommand`
  (`git diff --quiet HEAD^ HEAD -- ./`) then ran outside a repository, printed git's usage and exited 129, which Vercel treats as an
  error. The ignore step is removed: a push now always builds the web app (about 15 s). Earlier pushes were blocked for a different
  reason, an unrecognised commit author, fixed in 0.3.0 by committing as the GitHub account's no-reply address.

## 0.3.0 — 2026-11-07
- **The designed surfaces run on the hub** (`mockups/`, now the live web client): connect once with the hub address and the app
  token, and the iPhone screens (Now stack, Briefs, Skills, Settings), the iPad command centre (sidebar by priority, the board, the
  Ask panel, last commands) and the Apple TV glance board (`#/tv`: tiles, Enter, Space plays the newest brief, Y/N decides) draw the
  hub's own data: every skill's view, the audit log, pending decisions (Confirm/Cancel go to the hub), Ask (typed; answers and the
  confirm flow from the hub), the rendered briefs with a real player. `#/app` picks the phone layout up to 760 px and the iPad layout
  above it; `?hub=…&token=…` connects a television once from the address bar. Nothing is invented: what the hub does not report is
  empty, and every figure keeps its Measured / Modelled / Assumed mark. The design prototype with synthetic data stays at `#/demo`.
- Hub: serves the built web app at `/app` (single-page fallback, immutable assets, no token for the files themselves), so every
  device on the home network gets it over plain http; CORS for the hosted copy (`server.web_origins`, default the Vercel project's
  production and preview origins, a `*` matching one label); `server.web_dir` overrides the folder. Tested in `test/web.test.js`.
- Versions: 0.3.0 everywhere (hub, web, Apple apps; build 3), per `docs/VERSIONING.md`. The Apple apps carry the number only.
- Docs: `docs/WEB.md`, `docs/VERSIONING.md`; the CarPlay step now says the entitlement needs the paid Developer Program and that a
  free-team build expires after 7 days.

## 0.2.0 — 2026-11-06
- iPhone/iPad: a **Briefs** screen with the player behind the car's Now Playing (play, pause, 15 s skips, progress), the newest
  four briefs kept on the phone for the road, and a download button. Playing a brief shows in CarPlay's own Now Playing app with
  the steering-wheel buttons: no CarPlay entitlement needed for that path.
- Siri App Shortcuts (no Shortcuts files to install): "play my brief in Kitt" (also the morning brief / evening recap, from the
  phone's copy, offline), "ask Kitt" then the question, "ask Kitt what's on my plate", "confirm with Kitt", "cancel with Kitt".
  Siri also answers to "Kit".
- CarPlay app (Briefs / Now / Ask tabs, from 0.1.x) now shares the same player and hub access as the phone and Siri.
- Hub: brief rendering survives the wake-up catch-up storm (`say` gets ten minutes and one retry instead of being killed at
  120 s), partial files never survive a failure, and the episode length is measured with `afinfo` instead of guessed from the
  word count (the guess was about half the real length).
- Versions: every Apple app now carries 0.2.0 (build 2); before this the generated Info.plists said 1.0.
- Apple TV, Mac: rebuilt on the same sources; no behaviour change.

## 0.1.0 — 2026-10-26
- Hub: config/secrets, SQLite, router + bearer auth (3 scopes) + rate limiting, intent grammar + haiku classifier, confirm flow,
  continuation ("more"), audit log, scheduler with catch-up, ntfy/Resend notifier with spool, Composio + CLI + MCP-OAuth services,
  dashboard, podcast feed, Siri Shortcuts builder, launchd templates.
- Skills (12): receptionist, money, whatsapp, ideas, chief, comments, collab, linktree, shoplog, trips, subscriptions, security.
- Verified live: subscriptions, security (GitHub/Vercel/Fly), trips (Spotify parser), ideas, receptionist triage, HTTP hub.
- Not yet live (needs Travis): public exposure (ngrok), board password, Linktree login, Cloudflare token, OneNote link, WhatsApp link.
