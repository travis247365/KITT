#if canImport(WebKit)
import SwiftUI
import KITTKit

/// The app's front door on iPhone, iPad and Mac: the designed surface on the hub's data once connected, the connection screen
/// before that. The earlier Overview / Feed / Ask / Settings screens remain as the hub console, one tap away.
struct RootView: View {
    @EnvironmentObject private var model: AppModel
    @StateObject private var shell = KittShell()
    @Environment(\.scenePhase) private var scenePhase
    var zoom: Double = 1

    var body: some View {
        Group {
            if model.isConnected {
                SurfaceScreen(shell: shell, zoom: zoom)
            } else {
                SettingsView()
                    .background(Tv.void)
            }
        }
        .background(Tv.void)
        .onAppear { shell.attach(model) }
        .onChange(of: scenePhase) { _, phase in if phase == .active { shell.becameActive() } }
        .onOpenURL { url in shell.open(url) }
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("com.tpcl.kitt.go"))) { note in shell.go(note.object as? String) }
        .sheet(isPresented: $shell.showConnection) {
            NavigationStack {
                SettingsView()
                    .background(Tv.void)
                    .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { shell.showConnection = false } } }
            }
            .frame(minWidth: 520, minHeight: 560)
        }
        .sheet(isPresented: $shell.showConsole) {
            ContentView()
                .environmentObject(model)
                .scannerGridSurface()
                .overlay(alignment: .topTrailing) {
                    Button("Done") { shell.showConsole = false }
                        .buttonStyle(.borderedProminent)
                        .tint(Tv.cyan)
                        .padding(12)
                }
                .frame(minWidth: 900, minHeight: 640)
        }
    }
}

/// The surface itself, with what the native side adds on top: the listening bar while the microphone is on, and the
/// "hub unreachable" panel when the page cannot load.
private struct SurfaceScreen: View {
    @EnvironmentObject private var model: AppModel
    @ObservedObject var shell: KittShell
    @ObservedObject private var bridge: SurfaceBridge
    let zoom: Double

    init(shell: KittShell, zoom: Double) {
        self.shell = shell
        self.zoom = zoom
        _bridge = ObservedObject(wrappedValue: shell.bridge)
    }

    private var token: String { (try? KeychainTokenStore.load()) ?? "" }

    var body: some View {
        ZStack(alignment: .bottom) {
            #if os(iOS)
            KittSurfaceView(bridge: bridge, address: model.baseURL, token: token)
                .ignoresSafeArea()
            #else
            KittSurfaceView(bridge: bridge, address: model.baseURL, token: token, zoom: zoom)
            #endif
            if let error = bridge.loadError {
                UnreachablePanel(address: model.baseURL, error: error, retry: { bridge.reload() }, settings: { shell.showConnection = true })
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Tv.void)
            }
            if shell.isListening || shell.voiceNote != nil {
                ListeningBar(shell: shell)
                    .padding(.horizontal, 16)
                    .padding(.bottom, 24)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(.easeOut(duration: 0.2), value: shell.isListening)
        // While the hub is unreachable, try again every few seconds: it is usually the Mac waking up or the hub restarting.
        .task(id: bridge.failures) {
            guard bridge.loadError != nil else { return }
            try? await Task.sleep(for: .seconds(8))
            if !Task.isCancelled, bridge.loadError != nil { bridge.reload() }
        }
    }
}

private struct ListeningBar: View {
    @ObservedObject var shell: KittShell

    var body: some View {
        HStack(spacing: 16) {
            SiriGlassButton(isListening: shell.isListening, isAvailable: shell.speech.isAvailable) { shell.isListening ? shell.stopListening() : shell.startListening() }
            VStack(alignment: .leading, spacing: 4) {
                Text(shell.isListening ? "Listening…" : "Kitt")
                    .font(Tv.sys(17, .semibold))
                    .foregroundStyle(shell.isListening ? Tv.cyan : Tv.ice)
                Text(shell.voiceNote ?? (shell.heard.isEmpty ? "Say what you want Kitt to do." : "“\(shell.heard)”"))
                    .font(Tv.mono(12))
                    .foregroundStyle(shell.voiceNote == nil ? Tv.fog : Tv.signal)
                    .lineLimit(2)
            }
            Spacer(minLength: 0)
        }
        .padding(14)
        .background(Tv.cockpit.opacity(0.96))
        .overlay(Rectangle().stroke(Tv.cyan.opacity(0.35), lineWidth: 1))
    }
}

private struct UnreachablePanel: View {
    let address: String
    let error: String
    let retry: () -> Void
    let settings: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("KITT").font(Tv.display(22)).foregroundStyle(Tv.cyan).tracking(3)
            Text("Hub unreachable").font(Tv.sys(22, .semibold)).foregroundStyle(Tv.ice)
            Text(error).font(Tv.mono(13)).foregroundStyle(Tv.fog)
            Text(address).font(Tv.mono(12)).foregroundStyle(Tv.fog)
            Text("Kitt's screens come from the hub on your Mac. Over Tailscale they load in a moment, at home or away (docs/HOSTING.md). Trying again every few seconds.")
                .font(Tv.sys(14, .regular)).foregroundStyle(Tv.fog)
            HStack(spacing: 12) {
                Button("Try again", action: retry).buttonStyle(CyanButtonStyle()).frame(maxWidth: 180)
                Button("Connection", action: settings).buttonStyle(.bordered).tint(Tv.cyan)
            }
        }
        .padding(24)
        .frame(maxWidth: 520, alignment: .leading)
        .background(Tv.cockpit)
        .overlay(Rectangle().stroke(Tv.cyan.opacity(0.25), lineWidth: 1))
        .padding(24)
    }
}
#endif
