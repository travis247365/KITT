# Signing and TestFlight for the Apple clients

The apps build unsigned for the simulators. To run them on a real iPhone, iPad, Mac or Apple TV, or to ship a TestFlight build, they need your Apple Developer team.

1. **Add your Apple ID to Xcode.** Xcode > Settings > Accounts > + > Apple ID. A free Apple ID gives a "Personal Team" (7-day provisioning, no TestFlight). The paid Apple Developer Program gives TestFlight and the CarPlay entitlement request.
2. **Tell the project your team.** Copy the 10-character Team ID (Accounts > your team, or developer.apple.com > Membership) into `apps/KITT/Config/Signing.local.xcconfig`:
   ```
   DEVELOPMENT_TEAM = ABCDE12345
   ```
   That file is git-ignored, and it survives `xcodegen generate`. Targets use automatic signing.
3. **Build signed.** Open `apps/KITT/KITT.xcodeproj`, pick a scheme (`KITT` iPhone/iPad, `KITTMac`, `KITTtv`) and a device or "My Mac", then Run. Xcode creates the certificate and profiles.
4. **Names you can choose.** An Apple team's name comes from the Apple account (your legal name, or the registered organisation for a company account); it is not set in Xcode. What you can name is the App Store Connect app and the TestFlight tester group, for example a group called "Team No Sleep-tpcl".
5. **Apple TV.** Pair the Apple TV in Xcode (Window > Devices and Simulators), enable Developer Mode on the device, and give it the tvOS brand image assets before archiving for TestFlight.
