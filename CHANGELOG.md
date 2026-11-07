# Changelog

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
