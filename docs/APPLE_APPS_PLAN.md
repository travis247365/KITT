# KITT for iPhone, iPad and Apple Watch — build plan (v1.1, 2026-10-27, revised after adversarial review)

**Written for:** Travis as product owner, and whoever writes the Swift (Travis with Claude Code, or a contractor).
**Position:** thin, dynamic SwiftUI clients of the KITT hub on the Mac. The hub keeps every secret and every integration; the apps
render, listen, speak, confirm and notify. **Nothing in this plan starts until the gate in §1 is passed.**

## 0. What changed from v1 (the review was right)
- Siri cannot take open-ended text in a single App Shortcut phrase and every phrase must contain the app name (Apple, WWDC22 "Implement
  App Shortcuts with App Intents"). Free-text asks are two turns: "Hey Siri, ask Kit" → "What do you want to ask?" → dictate. That is what
  the Shortcuts already do. The native win is the **fixed-vocabulary** intents and everything *outside* the car.
- Confirmation was keyed per channel in the hub; a draft asked by voice could not be confirmed from the watch. **Fixed in the hub today**
  (one owner, one pending action, any channel confirms; originating channel audited). Interactive Live Activity buttons are **inert on a
  locked phone and in CarPlay** (Apple ActivityKit/WidgetKit docs), so "confirm anywhere" means: watch notification actions, the app, Siri.
- ngrok Free is 20k requests/month; realistic app polling is 12–45k. **Primary transport becomes Tailscale** (WireGuard, end-to-end,
  no public hostname, no request cap); ngrok stays only for the two-week Shortcuts trial.
- Apple Watch: no Zambian carrier on Apple's cellular list → Wi-Fi standalone only; long-form audio on watch needs a Bluetooth route
  (no speaker playback); complications need their own widget-extension target inside the watch app.
- Current platform is **iOS 27 / watchOS 27 / Xcode 27.1 (Swift 6.4)**; iOS 27 App Intents add `LongRunningIntent`, `CancellableIntent`,
  `supportedModes`; Live Activities now *display* in CarPlay (display only). Minimum deployment iOS 26 is fine; build with the 27 SDK.
- The hub's brain is `claude -p` under the laptop's Claude Max login: the hub **cannot move off this laptop** without switching to the
  paid API. Written into the risks. Disk is ~50 GB free, not 68.
- Effort doubled and converted to part-time hours; Phase 1 is time-boxed with a kill criterion.
- Device tokens exist now (`KITT_APP_TOKEN`: read+write, **no admin**); URL/cookie tokens are refused over the tunnel; the money CSV import
  only reads from `~/.local/share/kitt/imports/`; audio supports range requests; Siri paths get shorter timeouts; a 15-minute heartbeat
  records hub uptime and power so the gate below is measurable (`kitt doctor`).

## 1. Gate before any Swift (two weeks, zero app code)
1. Run the hub permanently (`sh scripts/install.sh`), keep the Mac on power with `sudo pmset -c sleep 0 displaysleep 15`, expose it, and use
   the **existing Shortcuts** from the car every day.
2. Measure: 7-day hub coverage (`kitt doctor` → heartbeats / expected), Siri success rate (audit rows with `source=siri`, outcome ok vs error),
   and how often "hub unreachable" is spoken.
3. **Kill criterion:** coverage < 80 % during 06:00–21:00 or Siri success < 80 % → fix the hub's home (Mac mini on a shelf + API-key brain, or
   accept "KITT is a home-and-office assistant") before building apps. Pass → Phase 0.

## 2. What "dynamic UI/UX" means here
| Principle | In practice |
|---|---|
| **Server-driven screens** | Every skill's `GET /v1/skills/{id}/view` returns data **plus a `ui` descriptor** (sections of `kpis`, `list`, `table`, `chart`, `actions`). One SwiftUI renderer draws all twelve skills. A new hub skill appears in the app with no release. Bespoke views are the exception (Linktree drag-reorder, Shop Log preview). |
| **Priority stack, not a menu** | Home is a card stack ordered by hub signals: pending confirmation → security critical → overdue board items → money anomalies → everything else. Empty skills do not render. |
| **Two axes, not four modes** | **Layout**: Drive / Glance / Desk, from CarPlay `.carAudio` audio route (not generic Bluetooth), device class and size class, or a manual toggle that persists until the next CarPlay disconnect. **Appearance**: follows the system (light/dark) plus a persistent large-type switch. No sunset rule. |
| **One answer, three fidelities** | `speak` (voice), `headline` (watch, widgets), `display` (card). Never JSON on screen. |
| **Never a dead end** | Hub down → cached state and briefs with an "as of" stamp; voice reads the cache. |
| **Not** | Not a chat window, no animation for its own sake, no screen that assumes the driver is holding the phone. The scanner animation is the listening indicator only. |

Design tokens: TPCL (Poppins 400/500/700, white / charcoal `#3A3A3A`, amber `#FFC107`, cyan `#00BCD4`, surface `#B8C5D6`, radius 0, no shadows).
Dark appearance = charcoal with cyan accents.

## 3. Surfaces (what each device is actually for)
**In the car — unchanged by the apps:** Siri App Intents with fixed phrases, the Podcasts feed, Live Activities *displayed* on the CarPlay screen
(read-only). No CarPlay app UI (category entitlements). Recording while CarPlay audio is active is a known pain point (Bluetooth HFP switching):
the phone's push-to-talk is for the desk, not the car — in the car you talk to Siri.

**iPhone (iOS 26+):** Now stack · Talk (desk use; on-device `SFSpeechRecognizer`, `AVSpeechSynthesizer`, `.playAndRecord` only while pressed) ·
Briefs player (hub audio with range requests, else on-device speech of the cached text) · twelve server-rendered skill screens · Settings
(pairing by QR from the Mac dashboard, tokens in Keychain, biometric gate for Money and Inbox, notification rules) · Widgets (Lock Screen:
pending count + security; Home: next brief headline + cash position; StandBy: brief) · Live Activity for the current pending action (display
+ tap-through; buttons work only when unlocked) · Action button → Talk.

**iPad (iPadOS 26+) — command centre:** `NavigationSplitView` (3/2/1 columns), the same server-driven renderer in **Desk** density (tables with
sort/filter, Swift Charts), plus the two bespoke editors (Linktree reorder, Shop Log with scrubbed public preview). Keyboard: ⌘1–9 skills,
⌘K talk, ⌘↩ confirm, ⌘⌫ cancel.

**Apple Watch (watchOS 26+):** complications and Smart Stack (pending count, security state, cash position, next trip) in a **watch widget
extension**; notification actions **Confirm / Cancel / Later** (this is the real wrist-confirm path); app with three pages — Now (card +
confirm), Briefs (plays over Bluetooth headphones only), Idea (dictation → `/v1/idea`). Standalone over Wi-Fi only.

## 4. Technical architecture
- Xcode 27.1, Swift 6.4, SwiftUI; project `apps/KITT/` with targets `KITT` (iOS+iPadOS), `KITTWatch` (watchOS), `KITTWidgets` (iOS
  WidgetKit + Live Activities), `KITTWatchWidgets` (watch complications), App Intents inside the app target.
- `KITTKit` Swift package shared by all targets: `HubClient` (URLSession, bearer, ETag, backoff; URL = Tailscale MagicDNS name),
  `Models` (Codable mirrors of hub JSON), `UIDescriptor` + `Renderer` (server-driven views), `Store` (SwiftData cache, hub wins),
  `Speech`, `Layout` (Drive/Glance/Desk) and `Appearance`.
- Sync: `/v1/state` on appear; `/v1/events?since=` every 30 s while visible; `BGAppRefreshTask` otherwise; `WatchConnectivity` relays
  state to the watch when the phone is near.
- Intents (iOS 27 SDK): `LongRunningIntent` for briefs; `CancellableIntent` so a Siri timeout is distinguishable from a user cancel;
  `supportedModes` so the same intent works in the background from Siri and in the foreground in-app. Hub-side Siri budget: 8 s per skill
  in briefs, 15 s for the classifier (done).
- Notifications: Phase 1 **ntfy** (already on the phone). APNs from the hub is **deferred** until the hub produces asynchronous pending
  actions (today every pending comes from a command the owner just spoke, so remote Live Activity start has nothing to show).
- Optional: Apple Foundation Models (Apple Intelligence devices: iPhone 15 Pro+, M-series iPad) for local intent classification when the
  hub's brain is rate-limited. The hub's regex grammar stays first.
- Security: Keychain (`AfterFirstUnlock`), `KITT_APP_TOKEN` scope only (no admin), ATS, biometric gate, counts-only notifications (no
  client names), every app action audited with its channel. Transport: Tailscale → no third party sees plaintext; if ngrok is ever used,
  tokens travel only in the Authorization header (hub enforces this).

## 5. Hub API contract (status today)
| Endpoint | Purpose | Status |
|---|---|---|
| `GET /healthz` | reachability | live |
| `GET /v1/state` | version, brain/notifier state, pending, **7-day coverage**, routines, per-skill health, last briefs | live |
| `GET /v1/events?since=` | audit/pending deltas | live |
| `GET /v1/skills/{id}/view` | data for the skill screen, all 12 | live — **`ui` descriptor to add (Phase 0)** |
| `POST /v1/ask`, `GET /v1/brief/{kind}`, `POST /v1/confirm|cancel`, `GET /v1/more`, `POST /v1/idea`, `POST /v1/sms` | commands | live; confirm is cross-channel |
| `GET /feed/{feedToken}/kitt.xml`, `/feed/{feedToken}/audio/{file}` | podcast feed, **range requests** | live |
| `POST /v1/pair` (QR → device token, name, scope app; `DELETE /v1/pair/{id}`) | per-device tokens, revocation | Phase 0 |
| `GET /v1/openapi.json` | contract for the Swift generator | Phase 0 |

Transport: **Tailscale** on the Mac and on every device (free Personal plan). `tailscale serve` gives HTTPS on the tailnet; the MagicDNS name is
the hub URL in the apps. ngrok (Hobbyist, USD 10/month, if a public URL is ever needed for Podcasts: the free tier's interstitial and 20k cap make
it unfit for the feed). Apple Podcasts reaching a tailnet-only feed is **unverified**; fallback is the in-app player.

## 6. App Intents catalogue (Apple's rules: app name in every phrase, no open-ended text in the first utterance)
| Intent | Phrases | Hub call |
|---|---|---|
| `AskKitIntent` | "Ask Kit" → Siri prompts for the question (two turns) | `/v1/ask` |
| `KitBriefIntent(kind: morning/evening)` | "Kit brief", "Kit evening recap" | `/v1/brief/{kind}` (LongRunning) |
| `KitPlateIntent` | "Kit, what's on my plate" | `/v1/brief/chief` |
| `KitConfirmIntent` / `KitCancelIntent` / `KitMoreIntent` | "Kit confirm", "Kit cancel", "Kit more" | `/v1/confirm`, `/v1/cancel`, `/v1/more` |
| `KitSecurityIntent`, `KitMoneyIntent`, `KitInboxIntent` | "Kit security", "Kit money", "Kit inbox" | `/v1/brief/{skill}` |
| `KitIdeaIntent` | "Kit idea" → Siri prompts for the idea | `/v1/idea` |
| Money SMS relay | **stays an iOS Automation + shortcut** (automations cannot be shipped in an app) | `/v1/sms` |

## 7. Phases, in part-time hours (≈10 h/week) with exit criteria
| Phase | Scope | Exit criteria | Hours |
|---|---|---|---|
| **Gate** | hub permanent, Shortcuts in the car, coverage + Siri metrics | ≥ 80 % both, two weeks | 0 app hours |
| **0 — Hub prep** | `ui` descriptors for 12 views, `/v1/pair` + revocation, OpenAPI, Tailscale install, `tailscale serve` | pair an iPhone by QR; every view renders in a test harness | 20–30 h |
| **1 — iPhone** (time-box: 10 working days) | Now stack, server-driven renderer, Briefs player, Settings/pairing, Layout+Appearance, fixed-phrase App Intents, SwiftData cache, Keychain, biometric gate | daily use for a week; Siri intents replace the Shortcuts (except SMS relay) | 60–90 h |
| **2 — Watch** | complications + Smart Stack (own extension), notification actions Confirm/Cancel/Later, Now/Briefs/Idea pages, Wi-Fi standalone | confirm a draft from the wrist; brief plays on AirPods from the watch | 30–50 h |
| **3 — iPad** | split view, Desk density tables/charts, Linktree reorder, Shop Log editor, keyboard shortcuts | Monday review done on iPad | 30–50 h |
| **4 — Polish** | Foundation Models fallback, accessibility audit (VoiceOver, Dynamic Type XXL, Reduce Motion), TestFlight | passes audit; TestFlight build re-uploaded on a 90-day cadence | 20–40 h |

Total ≈ 160–260 hours → **4–6 months at 10 h/week, 2–3 months at 25 h/week**. Phase 1 alone is where the "Claude Code writes SwiftUI fast"
bet gets tested: if the 10-day box blows by more than 50 %, stop and keep the Shortcuts.

## 8. Tooling, accounts, machine
- Install Xcode 27.1 (≈ 3 GB download, far more installed) plus iOS 27 and watchOS 27 simulators; ~50 GB free today, so budget disk.
- Apple Developer Program (USD 99/year) for TestFlight, App Groups, Live Activities, watch app beyond the 7-day personal-team limit.
  Enrolment and payment from Zambia: **verify** before planning dates. TestFlight builds expire after 90 days.
- 8 GB RAM: compiling Swift and running Claude Code and the hub's brain compete for memory and for the **same Claude weekly quota**
  (Max plan limits are shared across Claude and Claude Code). Schedule app-building weeks away from client-deliverable crunches.
- Repo: `apps/KITT/` inside `~/dev/kitt`; `KITTKit` as a local Swift package; private GitHub remote when you say so.

## 9. Risks, honestly
| Risk | Mitigation |
|---|---|
| The hub lives on a laptop that sleeps in a bag; the brain is tied to that laptop's Claude login | Gate measures it; the fix is an always-on Mac mini with an API-key brain, or accepting a home/office assistant |
| Siri in the car is two turns for free text | Fixed-phrase intents cover the daily commands; free text is the exception |
| Transport caps and plaintext at a vendor | Tailscale end-to-end; ngrok only for the trial |
| Watch limits (no cellular here, no speaker audio, buttons on locked devices inert) | Notification actions + complications are the wrist product |
| Effort and quota | Part-time hours, time-boxed Phase 1, kill criterion, no Phase 2+ before Phase 1 is in daily use |
| TestFlight/personal-team expiry | Calendar reminder every 80 days; or App Store "unlisted" distribution later |

## 10. Decisions needed from Travis
1. Run the gate (install + pmset + expose) and commit to two weeks of car use before any Swift.
2. Tailscale as the transport (install on Mac, iPhone, iPad, Watch via the iPhone app).
3. Xcode 27.1 + Developer Program now, or Phase 0/1 on a free personal team first.
4. Where the hub lives long-term: this MacBook Air, or a Mac mini with an API-key brain.
5. Name "Kit" for Siri; icon: TPCL monogram or a bespoke black mark with one cyan scanner line.

## Owner decision — 2026-10-29

Travis explicitly chose to override the two-week reliability gate and begin a native iPhone/iPad client. The reported hub coverage at that
decision was 2.4%, with the launchd service not installed; this is a deliberate product-gate override, not a passed gate. The first
implementation is a narrow iPhone/iPad MVP in `apps/KITT/`; Apple Watch, widgets, QR pairing and background sync remain out of scope.
The TestFlight release is still blocked until the Mac has full Xcode and signing/App Store Connect setup, and the hub is reachable through
the private HTTPS transport.
