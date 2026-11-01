import SwiftUI

@main
struct KITTApp: App {
    @StateObject private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(model)
                .tint(Color(red: 0.0, green: 0.55, blue: 0.62))
        }
    }
}
