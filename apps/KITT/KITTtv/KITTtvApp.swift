import SwiftUI

@main
struct KITTtvApp: App {
    @StateObject private var model = AppModel()
    @Environment(\.scenePhase) private var phase

    var body: some Scene {
        WindowGroup {
            TvRootView()
                .environmentObject(model)
                .preferredColorScheme(.dark)
                // A glance board must not let the Apple TV fall asleep while it is open.
                .onChange(of: phase) { _, new in UIApplication.shared.isIdleTimerDisabled = (new == .active) }
        }
    }
}
