import SwiftUI
import KITTKit

@main
struct KITTApp: App {
    @StateObject private var model = AppModel()
    #if os(macOS)
    @AppStorage("zoomLevel") private var storedZoom: Double = ZoomLevel.actual
    #endif

    var body: some Scene {
        WindowGroup {
            #if os(macOS)
            ZoomContainer(zoom: ZoomLevel.snapped(storedZoom)) {
                ContentView()
                    .environmentObject(model)
                    .scannerGridSurface()
                    .onAppear { scheduleSnapshotIfRequested() }
            }
            #else
            ContentView()
                .environmentObject(model)
                .scannerGridSurface()
            #endif
        }
        #if os(macOS)
        .commands {
            ZoomCommands(zoom: $storedZoom)
            CommandMenu("Go") {
                Button("Overview") { NotificationCenter.default.post(name: .kittGo, object: "overview") }.keyboardShortcut("1", modifiers: .command)
                Button("Feed") { NotificationCenter.default.post(name: .kittGo, object: "feed") }.keyboardShortcut("2", modifiers: .command)
                Button("Ask Kitt") { NotificationCenter.default.post(name: .kittGo, object: "ask") }.keyboardShortcut("3", modifiers: .command)
                Button("Settings") { NotificationCenter.default.post(name: .kittGo, object: "settings") }.keyboardShortcut("4", modifiers: .command)
                Divider()
                Button("Copy Picture of This Window") { copySnapshotToClipboard() }.keyboardShortcut("c", modifiers: [.command, .option])
            }
        }
        #endif
    }
}

#if os(macOS)
import AppKit

/// Review aid: launch with KITT_SNAPSHOT_PATH=<file name> (written into the app's own temporary folder) and the app saves a picture of its
/// window after KITT_SNAPSHOT_DELAY seconds (default 4); KITT_SNAPSHOT_QUIT=1 then quits. KITT_DEV_SECTION=overview|feed|ask|settings opens that screen.
/// It does not need the Screen Recording permission, because the app draws its own window.
@MainActor
func scheduleSnapshotIfRequested() {
    let env = ProcessInfo.processInfo.environment
    guard let name = env["KITT_SNAPSHOT_PATH"] else { return }
    let delay = Double(env["KITT_SNAPSHOT_DELAY"] ?? "4") ?? 4
    NSApp.activate(ignoringOtherApps: true)
    DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
        guard let view = NSApp.windows.first(where: { $0.isVisible && $0.contentView != nil })?.contentView,
              let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { return }
        view.cacheDisplay(in: view.bounds, to: rep)
        if let png = rep.representation(using: .png, properties: [:]) {
            let url = name.hasPrefix("/") ? URL(fileURLWithPath: name) : URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent(name)
            try? png.write(to: url)
        }
        if env["KITT_SNAPSHOT_QUIT"] == "1" { NSApp.terminate(nil) }
    }
}

extension Notification.Name {
    static let kittGo = Notification.Name("com.tpcl.kitt.go")
}

/// Puts a picture of the window on the clipboard (the app draws its own window: no Screen Recording permission needed).
@MainActor
func copySnapshotToClipboard() {
    guard let view = NSApp.windows.first(where: { $0.isVisible && $0.contentView != nil })?.contentView,
          let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { return }
    view.cacheDisplay(in: view.bounds, to: rep)
    guard let png = rep.representation(using: .png, properties: [:]) else { return }
    NSPasteboard.general.clearContents()
    NSPasteboard.general.setData(png, forType: .png)
}

/// Window menu > Zoom In / Zoom Out / Actual Size (the zoom level is remembered).
struct ZoomCommands: Commands {
    @Binding var zoom: Double

    var body: some Commands {
        CommandGroup(after: .windowSize) {
            Divider()
            Button("Zoom In") { zoom = ZoomLevel.zoomedIn(zoom) }
                .keyboardShortcut("+", modifiers: .command)
                .disabled(!ZoomLevel.canZoomIn(zoom))
            Button("Zoom Out") { zoom = ZoomLevel.zoomedOut(zoom) }
                .keyboardShortcut("-", modifiers: .command)
                .disabled(!ZoomLevel.canZoomOut(zoom))
            Button("Actual Size (\(ZoomLevel.label(zoom)))") { zoom = ZoomLevel.actual }
                .keyboardShortcut("0", modifiers: .command)
                .disabled(ZoomLevel.snapped(zoom) == ZoomLevel.actual)
            Divider()
        }
    }
}

/// Scales everything inside the window while keeping the layout filling the window (the content is laid out at window size / zoom).
struct ZoomContainer<Content: View>: View {
    let zoom: Double
    @ViewBuilder var content: Content

    var body: some View {
        GeometryReader { geo in
            content
                .frame(width: geo.size.width / zoom, height: geo.size.height / zoom, alignment: .topLeading)
                .scaleEffect(zoom, anchor: .topLeading)
                .frame(width: geo.size.width, height: geo.size.height, alignment: .topLeading)
                .clipped()
        }
    }
}
#endif
