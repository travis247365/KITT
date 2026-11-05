# CarPlay

Kitt in the car is an **audio app**. CarPlay draws Apple's own templates, so there is no custom full-screen layout (only navigation apps get a free-form map). Three tabs:

| Tab | What it is |
|---|---|
| Briefs | The rendered morning and evening briefs. Tap one to play it; Now Playing takes over, with the steering-wheel buttons (play/pause, 15 s back and forward, scrub). |
| Now | One status line (nothing waiting, needs attention, waiting for your OK) and what to say. Decisions are voice-only in the car: "Hey Siri, ask Kit to confirm". |
| Ask | The phrases that work with Siri. CarPlay has no keyboard, so Siri is the input. |

## Offline behaviour

The hub lives on the home network, so the car usually cannot reach it. The phone therefore keeps the newest four briefs on the device (`Application Support/KITTBriefs`):

- the phone app downloads them whenever it refreshes while the hub is reachable (at most every 10 minutes);
- the car scene also syncs when CarPlay connects, then every minute while connected;
- older audio is deleted; the list and files are kept out of iCloud backups.

So: open Kitt once on the home network before driving. The **Now** tab needs the hub; away from home it shows the cached copy or "Not connected". Reaching the hub from the road needs a tunnel (for example Tailscale) and an https address in Settings.

## The Apple step (yours)

CarPlay audio needs an entitlement Apple must approve for the App ID `com.tpcl.kitt`:

1. Request it at developer.apple.com/contact/carplay (category: **Audio**).
2. When approved, add the CarPlay (Audio) capability to the App ID and regenerate the provisioning profile.
3. Put `KITT_CARPLAY_ENTITLEMENTS = Config/KITTCar.entitlements` in `apps/KITT/Config/Signing.local.xcconfig`.

Until then the entitlement is applied to **simulator builds only**; a device build with an unapproved entitlement cannot be signed, so the iPhone install keeps working.

## Trying it

- A throwaway hub with two spoken briefs: `node scripts/dev-hub.mjs`, then launch the simulator app with `KITT_DEV_URL=http://127.0.0.1:2998` and `KITT_DEV_TOKEN=dev-app-token-0123456789abcdef` (the car scene honours the same variables).
- The CarPlay screen itself: Simulator > I/O > External Displays > CarPlay (needs the Simulator app from Xcode).

## Verified and not verified

Tested: car-screen text, brief list, offline store and sync (stubbed network, unit tests); the hub's episode and Range audio routes; on a simulator the phone app connects, downloads both briefs as real audio and still shows its own UI beside the CarPlay scene registration. **Not verified:** the CarPlay templates on a CarPlay display. The Simulator app was not available on the build Mac, and the entitlement is not approved for a real car.
