# KITT — architecture (v0.1.0, 2026-10-26)

KITT is a hybrid personal agent for Travis: twelve skills behind one hub on the Mac, driven by voice from the car's CarPlay
through Siri Shortcuts, and fed by scheduled routines. "Hybrid" means: **deterministic code decides, the LLM only speaks**
(and parses free text when the pattern router cannot). Nothing is sent, posted or spent without a spoken confirmation.

```
            ┌──────────── iPhone (CarPlay) ────────────┐
 "Hey Siri, Kit …" → Siri Shortcut → HTTPS POST /v1/ask ──┐        Apple Podcasts ← /feed/<token>/kitt.xml (m4a briefs)
 "Hey Siri, Kit Brief" → GET /v1/brief/morning           │        iPhone Automation: MTN/Airtel/FNB SMS → POST /v1/sms
            └──────────────────────────────────────────┘│
                                                         ▼  (ngrok free static hostname, bearer token, 30 req/min)
┌────────────────────────── Mac (M2, 8 GB) — launchd com.tpcl.kitt, 127.0.0.1:2000 ──────────────────────────┐
│ server.js  → auth (3 token scopes) → intent router (regex grammar first, haiku classifier second) → skill.handle │
│ app.js     → confirm flow (pending action per channel, 10 min) · continuation ("Kit, more") · audit log           │
│ scheduler  → cron routines, Africa/Lusaka, catch-up when the Mac was asleep · notify (ntfy push, Resend email)    │
│ brain      → `claude -p` (Max plan, haiku, ~1.4k-token context, serialised) · optional Anthropic API fallback     │
│ services   → gmail (Composio), calendar (Composio), cli (gh/vercel/flyctl), mcp-oauth (Linktree), composio CLI     │
│ storage    → SQLite (node:sqlite) at ~/.local/share/kitt/kitt.sqlite · secrets ~/.config/kitt/kitt.env (0600)    │
│ skills/    receptionist money whatsapp ideas chief comments collab linktree shoplog trips subscriptions security   │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

## Skills and where their data comes from
| # | Skill | Source of truth | Writes (always confirmed) |
|---|---|---|---|
| 1 | Receptionist | Gmail via Composio (`GMAIL_FETCH_EMAILS`, rules in `receptionist/rules.js`) | Gmail **drafts** in-thread, archive (remove INBOX), local snooze |
| 2 | Money | iPhone SMS relay (MTN MoMo, Airtel Money, FNB, Stanbic), voice cash log, CSV import | none (local ledger) |
| 3 | WhatsApp | optional linked-device listener (Baileys) → local store | draft outbox; sending only if `whatsapp.allow_send` |
| 4 | Ideas | Siri dictation → SQLite + `~/.config/kitt/ideas.md` → nightly turn into a standing `claude --resume` session | none |
| 5 | Chief of Staff | an operations board's JSON API with a password session (`/api/items`, `/api/ops/*`) | add item, mark done |
| 6 | Comments | Instagram Graph via Composio (`INSTAGRAM_GET_IG_USER_MEDIA/…_COMMENTS`) | OneNote page via Composio (once linked) |
| 7 | Collab | Firecrawl web search + deterministic fit score | weekly Resend e-mail to Travis only |
| 8 | Linktree | **Linktree's official MCP server** (OAuth 2.1, dynamic client registration) | reorder/hide/show/add link |
| 9 | Shop Log | voice entries → scrubbed public page/RSS/JSON in `~/.local/share/kitt/shoplog/` | publish (visibility flip) |
| 10 | Trips | Spotify concert e-mails (parser in `trips/parse.js`) + Google Calendar away events | tentative calendar hold |
| 11 | Subscriptions | Gmail receipts (merchant rules in `subscriptions/rules.js`), FX from open.er-api.com | none |
| 12 | Security | `gh`, `vercel api`, `flyctl` reads, Cloudflare API (token needed), baseline diff | none |

## Request lifecycle (voice)
1. Shortcut "Kit" asks Siri for the command and POSTs `{text, source:"siri"}` with the bearer token.
2. `normalize()` strips the wake word; `matchDeterministic()` tries every skill pattern (`{slot}` templates); only on a miss does
   `brain.classify()` run (haiku, JSON schema, confidence ≥ 0.6).
3. The skill returns `{speak, display, confirm?}`. A `confirm` becomes a pending action; "Kit, confirm" calls `skill.execute()`.
4. `speakable()` strips markdown, spells money ("12,500 kwacha"), expands acronyms, clips at ~900 chars and parks the rest for
   "Kit, more". Every call is audited (source, intent, latency, outcome; inputs redacted).

## Provenance
Every derived number carries EXTRACTED / INFERRED / ASSUMED (FX conversions are INFERRED, trip budgets ASSUMED, cadence
guesses INFERRED). The dashboard shows the tag next to the figure.

## Failure modes (by design)
- Hub unreachable → the Shortcut errors; the Mac must be awake and on power (see SETUP). A Vercel "front door" that answers
  with the cached last brief is the planned week-2 piece.
- Brain rate-limited (Max plan is shared with Travis's own Claude Code use) → pattern-matched commands still work; free-text
  commands get "my language brain is rate limited"; receptionist summaries fall back to snippets.
- Composio link expired → the skill says which toolkit; `composio link <toolkit>` fixes it.
- Push/e-mail failures are spooled in SQLite and retried every 5 minutes.
