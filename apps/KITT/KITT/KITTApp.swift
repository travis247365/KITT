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
            }
            #else
            ContentView()
                .environmentObject(model)
                .scannerGridSurface()
            #endif
        }
        #if os(macOS)
        .commands { ZoomCommands(zoom: $storedZoom) }
        #endif
    }
}

#if os(macOS)
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
