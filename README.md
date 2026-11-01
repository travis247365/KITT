# KITT

A personal in-car agent: twelve skills behind one hub on the Mac, voice in and out through Apple CarPlay via Siri Shortcuts.

- `docs/ARCHITECTURE.md` — how it fits together and where each skill's data comes from
- `docs/SETUP.md` — setting it up on your own Mac (exposure, passwords, logins)
- `docs/SKILL_CONTRACT.md` — how to add a skill
- `docs/WHATSAPP.md` — the WhatsApp decision (linked device = unofficial client)
- `docs/APPLE_APPS_PLAN.md` — the iPhone, iPad and Watch build plan
- `mockups/` — interactive mockups of those apps (Vite + React, synthetic data)

```
npm test                         # the hub tests
node bin/kitt setup              # what is configured
node bin/kitt ask "good morning" # talk to it from the terminal
node bin/kitt serve              # the hub (127.0.0.1:2000); launchd/com.tpcl.kitt.plist runs it permanently
node bin/kitt shortcuts build https://<public-host>   # 12 signed Siri Shortcuts in ./shortcuts
```

Zero runtime dependencies (Node 26, node:sqlite). Secrets live in `~/.config/kitt/kitt.env` (0600), never in the repo.

## Status and licence

A personal project, shared as is, with no warranty. It can link a real WhatsApp account through an unofficial client (see `docs/WHATSAPP.md` for the risk;
sending is off by default and messages are only drafted), so read the code before you point it at your own accounts.

Licensed under the Apache License 2.0 (`LICENSE`, `NOTICE`). "KITT" is a codename; no trademark rights are granted.
