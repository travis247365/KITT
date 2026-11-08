# KITT iPhone, iPad and Mac app

One universal iOS/iPadOS app (`KITT`), a Mac app (`KITTMac`) and the Apple TV app (`KITTtv`), on one version number.

Since 0.4.0 the iPhone, iPad and Mac apps open on **the designed surface**: the web app in `../../mockups/`, which the hub serves
at `/app`, shown in a web view (`KITT/KittSurface.swift`) with the connection the app holds. Around it the app adds what a web
page cannot do (`KITT/KittShell.swift`): the microphone and voice for Talk to Kit, the brief player (lock-screen controls,
background audio, the copies kept for the car), the Lock Screen card (`KITTWidgets/`, a Live Activity with Open · Talk ·
Brief; 0.5.0), Siri App Shortcuts and CarPlay. The earlier console (Overview, Feed, Ask, Settings; `KITT/ContentView.swift`)
stays reachable from the surface's Settings and, on the Mac, Go › Hub Console. The Apple TV app draws its glance board natively.

The app:

- Holds the hub address and the app token (device Keychain); the surface never shows its own Connect form inside the app
- Shows "Hub unreachable" with Try again and Connection when the hub cannot be reached (home network, or a tunnel)
- Explicit Confirm and Cancel for pending actions, on the surface and in the console
- Home-screen and Lock Screen widgets (Now, Cash, Brief; `KITTWidgets/KittHomeWidgets.swift`, 0.6.0), fed by a snapshot the app writes into the App Group `group.com.tpcl.kitt`

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
