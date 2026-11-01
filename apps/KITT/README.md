# KITT iPhone and iPad app

This is the first native KITT client, built as one universal iOS/iPadOS app. It currently provides:

- Secure HTTPS connection to the KITT hub
- Hub status, skill health and recent routine status
- Ask Kitt
- Explicit Confirm and Cancel controls for pending actions
- App-token storage in the device Keychain
- An iPad-friendly split navigation layout that adapts to iPhone

The app uses the hub's limited `KITT_APP_TOKEN` scope. It does not store a full Mac token and does not put tokens in URLs.
The token is currently entered manually; per-device QR pairing and token revocation require the planned hub `/v1/pair` work.

## Generate and build

Requires Xcode with the iOS 26 SDK and XcodeGen:

```sh
xcodegen generate --spec project.yml
xcodebuild -project KITT.xcodeproj -scheme KITT -destination 'generic/platform=iOS' build
```

The shared API package can be tested independently on this Mac:

```sh
cd KITTKit
swift test
```

## TestFlight prerequisites

A build Mac needs full Xcode, an Apple code-signing identity and App Store Connect API credentials.
Before an archive can be uploaded:

1. Install full Xcode and its iOS SDK.
2. Confirm Apple Developer Program enrollment and create or verify the App Store Connect app record.
3. Confirm the `com.tpcl.kitt` bundle identifier is available and select the correct Apple developer team.
4. Configure signing in Xcode and build an archive.
5. Test the HTTPS hub connection over Tailscale on both an iPhone and iPad, then upload and invite the TestFlight testers.

TestFlight requires a reachable hub. Use the private Tailscale HTTPS endpoint; do not expose the hub publicly or use the Mac-only `KITT_TOKEN`.

## Apple TV (tvOS)

Target `KITTtv` (unsigned build: `xcodebuild -scheme KITTtv -destination 'generic/platform=tvOS' build`). Design: `mockups/#/appletv` (Design System v2). The screens are plain SwiftUI in `TvShared/`; `KITTtv/` holds the app shell, the hub polling (every 60 s) and the Siri Remote handling.

- **Screens:** Now (status headline, five skill tiles, chips), skill detail, "Needs your decision" (Confirm / Cancel, Cancel is focused first so a stray Select never commits), Connect (hub address + app token, typed on a nearby iPhone's keyboard), plus loading and "can't reach your hub" states.
- **Animated top border and KITT name:** colour and speed follow `StatusLevel` (`KITTKit/Glance.swift`): critical = red/blue/white and fast, amber = blue/white and medium, green = blue only and slow. Reduce Motion freezes both.
- **Level rule:** the hub has no "critical finding" signal yet, so critical = a skill failed to load or the security skill is unhealthy; amber = a decision is waiting, any skill unhealthy, or the cached copy is showing; green otherwise.
- **Data:** only what `/v1/state` really sends (skill health words, latest brief, pending action, coverage). No invented figures.
- **Remote:** swipe moves focus, Select opens, Menu goes back, Play/Pause reads the brief aloud (the TV speaks; apps cannot use the remote's microphone).
- **Preview without a tvOS simulator:** `KITTtvPreview` (macOS tool) renders the screens to PNG: `scripts/nosleep/run.sh` steps `build-tvpreview tv-render` write `build/tv-preview/*.png`.
- **Not built yet:** Top Shelf extension, Siri/App Intents ("Ask Kit ..."), code-based pairing from the iPhone (needs the hub `/v1/pair` work), app icon and Top Shelf images, signing. Untested on a real Apple TV or the tvOS simulator (no tvOS runtime is installed on this Mac).
- The wordmark font is Orbitron Bold (OFL-1.1, licence file bundled in `KITTtv/Fonts/`).
