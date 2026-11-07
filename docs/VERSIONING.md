# Versioning

One number for the whole of Kitt: the hub (`package.json`), every Apple app (`apps/KITT/project.yml` → `MARKETING_VERSION`,
which the Info.plists read) and `CHANGELOG.md` carry the same version, bumped in the same commit.

## The rule (set 7 Nov 2026)

| Change | Bump | Example |
|---|---|---|
| A fix (a bug, a crash, a wrong number, a layout defect) | **+0.0.1** | 0.2.0 → 0.2.1 |
| A new feature (a screen, a skill, a Siri phrase, a new route) | **+0.1.0** | 0.2.1 → 0.3.0 |
| A platform-wide push: work that lands across the whole estate at once (iOS, iPadOS, macOS, watchOS, tvOS, CarPlay, and the webOS / LG TV side) or a change to the shared platform every app depends on | **major** (x.0.0) | 0.3.0 → 1.0.0 |

Every fix is its own bump, even when several ship on the same day: three fixes in one evening are three patch versions, each
with its own CHANGELOG line, so a build on a phone can always be matched to exactly what it contains.

`CURRENT_PROJECT_VERSION` (the build number) goes up by one with every build that is installed on a device or Mac.

## Where the number lives

- `package.json` / `package-lock.json` → `version` (the hub reports it at `/v1/state`; `test/api.test.js` reads it from
  `src/config.js`, so the test never pins a number).
- `apps/KITT/project.yml` → `settings.base.MARKETING_VERSION` and `CURRENT_PROJECT_VERSION`; run `xcodegen generate` after
  editing and commit the regenerated `KITT.xcodeproj` with it.
- `CHANGELOG.md` → one `## x.y.z — YYYY-MM-DD` block per version, newest first.

## Testing

The **iPhone is the test device** (`ONLY=iphone bash scripts/uat-install.sh`, then `docs/UAT.md`), the Mac app goes through
`scripts/uat-install-mac.sh`, and the Apple TV through `scripts/uat-install.sh`. Simulators are not used for sign-off: this
Xcode install has no Simulator app, a headless simulator has no audio and cannot show CarPlay, and each booted simulator costs
about 3 GB of swap on the build Mac.
