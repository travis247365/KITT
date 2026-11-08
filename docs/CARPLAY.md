# CarPlay

Kitt reaches the car two ways. The first works today with no Apple approval; the second is the CarPlay app and waits on an entitlement.

## The car's screen (the truck's 9-inch unit)

CarPlay apps do not draw pixels: the head unit draws Apple's templates (tab bar, lists, Now Playing, alerts) at its own size, so
Kitt fills a 9-inch display and a 7-inch one alike, in the car's own type size, with no layout of ours involved. What we
control is the artwork: the list rows draw it at the size and scale the connected car reports (`CPListItem.maximumImageSize` ×
`carTraitCollection.displayScale`), and the Now Playing artwork is the 1024 px `CarArtwork` asset. The tab bar has three tabs
(audio apps may have four). Nothing in the car scene assumes a width or a resolution.

What can be seen in the truck today, with no entitlement: Now Playing (the brief playing, artwork, play/pause, ±15 s, the
steering-wheel buttons) and Siri. The Kitt tabs on the car screen (Briefs · Now · Ask) appear only after the CarPlay audio
entitlement is approved (next section) and `com.apple.developer.carplay-audio` is added to `Config/KITT.entitlements`. This Mac's Xcode has no
Simulator app, so the CarPlay simulator window cannot be used here; the first look at the tabs will be in the truck.

## 1. Now Playing + Siri (works now)

Any app that plays audio in the background shows up in CarPlay's own **Now Playing** app, with artwork, the steering-wheel buttons,
play/pause and the 15-second skips. Kitt uses exactly that:

- **Briefs screen on the iPhone** (sidebar > Briefs): the rendered briefs, a player (play, pause, ±15 s, progress) and a download button.
  Press play before you pull off, or
- **Siri, hands-free**, through the app's own App Shortcuts (nothing to install, every phrase has to name the app):

| Say | What happens |
|---|---|
| "Hey Siri, play my brief in Kitt" | plays the newest brief from the phone's copy (works offline) |
| "… play my morning brief in Kitt" / "… play my evening recap in Kitt" | that one |
| "Hey Siri, ask Kitt" → Siri asks "What do you want to ask Kitt?" → say it | the hub answers, Siri reads it out |
| "Hey Siri, ask Kitt what's on my plate" | the plate, spoken |
| "Hey Siri, confirm with Kitt" / "cancel with Kitt" | resolves the pending decision |

Siri also answers to "Kit" (`INAlternativeAppNames`). Everything except "play my brief" needs the hub. Since 0.6.5 the hub does
not listen on the home Wi-Fi by default (GRC audit R1): the phone reaches it over Tailscale (the Tailscale app on the Mac and the
phone; the Mac's `server.host` is `"tailscale"`), at home and on the road, or at home during a test window
(`bash scripts/uat-lan.sh on`, which closes by itself after four hours).

The phone keeps the **newest four briefs** in `Application Support/KITTBriefs` (out of iCloud backups):

- the phone app downloads them whenever it refreshes while the hub is reachable (at most every 10 minutes), and right away when the
  Briefs screen opens or its download button is pressed;
- the car scene (below) also syncs when CarPlay connects, then every minute while connected;
- older audio is deleted.

So: open Kitt once where it reaches the hub (Tailscale, or a test window at home) before driving.

## 2. The CarPlay app (waits on Apple)

Kitt in the car is an **audio app**. CarPlay draws Apple's own templates, so there is no custom full-screen layout (only navigation apps get
a free-form map). Three tabs:

| Tab | What it is |
|---|---|
| Briefs | The rendered briefs. Tap one to play it; Now Playing takes over, with the steering-wheel buttons. |
| Now | One status line (nothing waiting, needs attention, waiting for your OK) and what to say. Decisions are voice-only in the car. |
| Ask | The Siri phrases above. CarPlay has no keyboard, so Siri is the input. |

It shares the player (`KITTCar/CarPlayer.swift`) and the hub access (`KITTCar/HubAccess.swift`) with the Briefs screen and the intents.

### The Apple step (yours)

CarPlay audio needs an entitlement Apple must approve for the App ID `com.tpcl.kitt`:

0. **Be in the paid Apple Developer Program.** The request page is for program members only: with a free Apple ID
   ("Personal Team") it answers `developer.apple.com/unauthorized/` — checked 7 Nov 2026, the account was not enrolled
   (developer.apple.com/account showed "Join the Apple Developer Program"). Enrol at developer.apple.com/enroll (individual,
   yearly fee, Apple's approval takes a day or two); the Personal Team becomes the paid team with the same Team ID. Until then
   a free team also means **7-day provisioning**: the iPhone build stops launching a week after it was signed and must be
   reinstalled (`ONLY=iphone bash scripts/uat-install.sh`, phone plugged in and unlocked).
1. Request it at developer.apple.com/contact/carplay (category: **Audio**). Apple reviews the use case; allow weeks.
2. When approved, add the CarPlay (Audio) capability to the App ID and regenerate the provisioning profile.
3. Add `com.apple.developer.carplay-audio` (true) to `apps/KITT/Config/KITT.entitlements` (the simulator file `KITTCar.entitlements` already has it).

Until then the entitlement is applied to **simulator builds only**; a device build with an unapproved entitlement cannot be signed, so the
iPhone install keeps working, and the Now Playing + Siri path above is what you get in the car.

## Trying it

- Against the real hub on this Mac, in a simulator: launch the app with `KITT_DEV_URL=http://127.0.0.1:2000` and `KITT_DEV_TOKEN=<the app
  token from ~/.config/kitt/kitt.env>`; `KITT_DEV_SECTION=briefs` opens the Briefs screen, `KITT_DEV_AUTOPLAY=1` starts the newest brief.
  (`scripts/dev-hub.mjs` is the throwaway hub with two spoken briefs, port 2998, when the real one must not be touched.)
- The CarPlay screen itself: Simulator > I/O > External Displays > CarPlay. That needs the Simulator app, which this Xcode install does not
  have (`Xcode.app/Contents/Applications` holds no Simulator.app); headless `simctl` runs cannot show the CarPlay display.

## Verified and not verified

Tested: car-screen text, brief list, offline store and sync (stubbed network, unit tests); the hub's episode and Range audio routes; on a
simulator against the real hub the phone app connects, downloads the real briefs, the Briefs screen lists them, and pressing play takes
the player through decode and priming to the Playing state with Now Playing published.

**What a headless simulator cannot show:** its audio device (`iOSSimulatorAudioDevice`) only renders through the Simulator app, so
without it `AudioDeviceStart` times out after 15 s and the queue fails (-66681): the position never moves and the player reports the
failure (which is how the state observer in `CarPlayer` was proven). Sound, the steering-wheel buttons and Siri's phrase matching need
a real iPhone. **Not verified:** the CarPlay templates on a CarPlay display (no Simulator app on the build Mac, entitlement not approved).

Found by the simulator runs of 6 Nov 2026 and fixed: the artwork handler trapped under Swift 6 the first time a brief played (SIGTRAP,
`dispatch_assert_queue_fail`), which would have crashed in the car too.
