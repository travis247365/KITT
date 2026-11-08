# Changelog

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
