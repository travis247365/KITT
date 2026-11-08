#if canImport(WebKit)
import SwiftUI
import WebKit

/// The designed surfaces (the `mockups/` web app: the phone's Now stack, the iPad command centre) inside the native app.
/// The hub serves them at `<hub>/app/`; this view loads that page and hands it the connection the app holds, so the page never
/// shows its own Connect form and the token never appears in a URL. Messages go both ways (see `mockups/src/native.ts`):
/// the page asks for the microphone, a brief, or the app's connection screen; the app sends what it heard and what is playing.
@MainActor
final class SurfaceBridge: NSObject, ObservableObject, WKScriptMessageHandler, WKNavigationDelegate {
    @Published private(set) var isLoaded = false
    @Published private(set) var loadError: String?
    /// Counts failed loads, so the screen can retry on its own (the hub on the Mac comes back after a restart or a sleep).
    @Published private(set) var failures = 0
    /// A message from the page: `type` plus its fields.
    var onMessage: (([String: Any]) -> Void)?

    private(set) var webView: WKWebView?
    private var loadedFor: (address: String, token: String)?

    /// The web view for this connection, made once and reloaded when the address or token changes.
    func webView(address: String, token: String) -> WKWebView {
        if let webView, let loadedFor, loadedFor.address == address, loadedFor.token == token { return webView }
        let view = webView ?? makeWebView()
        webView = view
        loadedFor = (address, token)
        view.configuration.userContentController.removeAllUserScripts()
        view.configuration.userContentController.addUserScript(WKUserScript(source: Self.bootstrap(address: address, token: token), injectionTime: .atDocumentStart, forMainFrameOnly: true))
        isLoaded = false
        loadError = nil
        if let url = URL(string: "\(address)/app/#/app") { view.load(URLRequest(url: url, cachePolicy: .useProtocolCachePolicy, timeoutInterval: 20)) }
        return view
    }

    func reload() {
        guard let loadedFor else { return }
        let keep = loadedFor
        self.loadedFor = nil
        _ = webView(address: keep.address, token: keep.token)
    }

    /// Sends a window event to the page (`window.dispatchEvent(new CustomEvent(name, { detail }))`).
    func dispatch(_ name: String, _ detail: [String: Any]) {
        guard let webView, isLoaded,
              let data = try? JSONSerialization.data(withJSONObject: detail), let json = String(data: data, encoding: .utf8) else { return }
        webView.evaluateJavaScript("window.dispatchEvent(new CustomEvent(\(Self.js(name)), { detail: \(json) }))") { _, _ in }
    }

    private func makeWebView() -> WKWebView {
        let config = WKWebViewConfiguration()
        config.userContentController.add(WeakHandler(self), name: "kitt")
        #if os(iOS)
        config.allowsInlineMediaPlayback = true
        #endif
        config.mediaTypesRequiringUserActionForPlayback = []
        let view = WKWebView(frame: .zero, configuration: config)
        view.navigationDelegate = self
        if #available(iOS 16.4, macOS 13.3, *) { view.isInspectable = true }
        #if os(iOS)
        view.isOpaque = false
        view.backgroundColor = UIColor(Tv.void)
        view.scrollView.backgroundColor = UIColor(Tv.void)
        view.scrollView.contentInsetAdjustmentBehavior = .never
        view.scrollView.bounces = false
        #else
        view.setValue(false, forKey: "drawsBackground")
        view.underPageBackgroundColor = NSColor(Tv.void)
        #endif
        return view
    }

    /// Runs before the page's own script: the connection into the page's store, and the mark that says an app is around it.
    private static func bootstrap(address: String, token: String) -> String {
        #if os(iOS)
        let platform = "ios"; let player = "true"
        #else
        let platform = "macos"; let player = "false"
        #endif
        return """
        (function () {
          try { localStorage.setItem('kitt.web.hub.v1', JSON.stringify({ url: \(js(address)), token: \(js(token)) })); } catch (e) {}
          window.__KITT_NATIVE__ = { platform: '\(platform)', speech: true, player: \(player) };
        })();
        """
    }

    private static func js(_ s: String) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: s, options: .fragmentsAllowed), let out = String(data: data, encoding: .utf8) else { return "\"\"" }
        return out
    }

    // MARK: WKScriptMessageHandler

    nonisolated func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "kitt", let body = message.body as? [String: Any] else { return }
        Task { @MainActor in self.onMessage?(body) }
    }

    // MARK: WKNavigationDelegate

    nonisolated func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        Task { @MainActor in self.isLoaded = true; self.loadError = nil }
    }
    nonisolated func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        let text = Self.describe(error)
        Task { @MainActor in self.isLoaded = false; self.loadError = text; self.failures += 1 }
    }
    nonisolated func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        let text = Self.describe(error)
        Task { @MainActor in self.loadError = text; self.failures += 1 }
    }
    nonisolated func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        Task { @MainActor in self.reload() }
    }

    nonisolated private static func describe(_ error: Error) -> String {
        let e = error as NSError
        if e.domain == NSURLErrorDomain {
            switch e.code {
            case NSURLErrorCannotConnectToHost, NSURLErrorCannotFindHost, NSURLErrorTimedOut, NSURLErrorNotConnectedToInternet: return "The hub is not reachable from here."
            default: break
            }
        }
        return e.localizedDescription
    }
}

/// WKWebView keeps its message handlers strongly; this breaks the cycle so a bridge can be released with its screen.
private final class WeakHandler: NSObject, WKScriptMessageHandler {
    weak var target: SurfaceBridge?
    init(_ target: SurfaceBridge) { self.target = target }
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(controller, didReceive: message)
    }
}

#if os(iOS)
struct KittSurfaceView: UIViewRepresentable {
    @ObservedObject var bridge: SurfaceBridge
    let address: String
    let token: String
    func makeUIView(context: Context) -> WKWebView { bridge.webView(address: address, token: token) }
    func updateUIView(_ view: WKWebView, context: Context) { _ = bridge.webView(address: address, token: token) }
}
#else
struct KittSurfaceView: NSViewRepresentable {
    @ObservedObject var bridge: SurfaceBridge
    let address: String
    let token: String
    var zoom: Double = 1
    func makeNSView(context: Context) -> WKWebView { let v = bridge.webView(address: address, token: token); v.pageZoom = zoom; return v }
    func updateNSView(_ view: WKWebView, context: Context) { _ = bridge.webView(address: address, token: token); if view.pageZoom != zoom { view.pageZoom = zoom } }
}
#endif
#endif
