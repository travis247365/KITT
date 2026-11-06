# Changelog

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
