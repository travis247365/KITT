#if canImport(WebKit)
import AVFoundation
import Combine
import Foundation
import KITTKit
#if os(iOS)
import WidgetKit
#endif

/// What sits around the designed surface in the iPhone, iPad and Mac apps: the phone's microphone and voice for "Talk to Kitt",
/// the brief player, the Lock Screen card, and the two native screens the page asks for (connection, hub console).
@MainActor
final class KittShell: ObservableObject {
    let bridge = SurfaceBridge()
    let speech = SpeechInput()
    @Published var showConnection = false
    @Published var showConsole = false
    @Published private(set) var isListening = false
    @Published private(set) var heard = ""
    /// A short line for the listening bar when voice could not start.
    @Published private(set) var voiceNote: String?

    private weak var model: AppModel?
    private var subscriptions = Set<AnyCancellable>()
    private var wasListening = false
    private var attached = false
    #if os(iOS)
    private var moneyView: MoneyView?
    private var moneyFetchedAt: Date?
    private var lastSnapshot: KittWidgetSnapshot?
    #endif

    func attach(_ model: AppModel) {
        guard !attached else { return }
        attached = true
        self.model = model
        bridge.onMessage = { [weak self] m in self?.handle(m) }

        speech.$isListening.receive(on: RunLoop.main).sink { [weak self] listening in
            guard let self else { return }
            isListening = listening
            if wasListening && !listening { heardEverything() }
            wasListening = listening
        }.store(in: &subscriptions)
        speech.$transcript.receive(on: RunLoop.main).sink { [weak self] text in
            guard let self, isListening else { return }
            heard = text
            bridge.dispatch("kitt:listening", ["text": text])
        }.store(in: &subscriptions)
        speech.$deniedMessage.receive(on: RunLoop.main).sink { [weak self] note in self?.voiceNote = note }.store(in: &subscriptions)

        #if os(iOS)
        NotificationCenter.default.publisher(for: .kittPlayerChanged).receive(on: RunLoop.main).sink { [weak self] _ in self?.publishPlayer() }.store(in: &subscriptions)
        model.$state.receive(on: RunLoop.main).sink { [weak self] _ in self?.syncActivity() }.store(in: &subscriptions)
        KittHooks.talk = { [weak self] in self?.startListening() }
        KittHooks.playLatest = { _ = try await PlayBriefIntent().perform() }
        #endif
    }

    /// The app came to the front: a Lock Screen "Talk" tap that launched it is honoured here.
    func becameActive() {
        #if os(iOS)
        if UserDefaults.standard.bool(forKey: KittLaunch.talkKey) {
            UserDefaults.standard.removeObject(forKey: KittLaunch.talkKey)
            startListening()
        }
        syncActivity()
        #endif
    }

    /// `kitt://open` shows the home surface; `kitt://talk` starts listening.
    func open(_ url: URL) {
        showConnection = false
        showConsole = false
        if url.host == "talk" { startListening() }
    }

    /// The Mac's Go menu.
    func go(_ where: String?) {
        switch `where` {
        case "talk": startListening()
        case "settings": showConnection = true
        case "console": showConsole = true
        default: showConnection = false; showConsole = false
        }
    }

    func startListening() {
        voiceNote = nil
        heard = ""
        speech.start()
    }

    func stopListening() { speech.stop() }

    // MARK: from the page

    private func handle(_ m: [String: Any]) {
        switch m["type"] as? String {
        case "mic": startListening()
        case "answer": if let text = m["speak"] as? String { speak(text) }
        case "settings": showConnection = true
        case "console": showConsole = true
        case "disconnect": model?.disconnect()
        #if os(iOS)
        case "play": play(id: m["id"] as? Int, file: m["file"] as? String ?? "")
        case "pause": CarPlayer.shared.pause()
        #endif
        default: break
        }
    }

    /// Listening stopped: the words go to the page, which asks the hub and shows the answer; the hub's reply comes back as
    /// an `answer` message and is read aloud. Without the page (hub unreachable) the app asks the hub itself.
    private func heardEverything() {
        let text = heard.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { bridge.dispatch("kitt:say", ["text": ""]); return }
        if bridge.isLoaded { bridge.dispatch("kitt:say", ["text": text]); return }
        guard let model else { return }
        Task { @MainActor in
            await model.ask(text)
            if let reply = model.reply { speak(reply) } else if let err = model.errorMessage { speak(err) }
        }
    }

    private func speak(_ text: String) {
        #if os(iOS)
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .spokenAudio, options: .duckOthers)
        try? session.setActive(true)
        #endif
        Speech.say(text)
    }

    #if os(iOS)
    private func play(id: Int?, file: String) {
        Task { @MainActor in
            let store = BriefStore.standard
            var episode = store.episodes().first { $0.id == id || (!file.isEmpty && $0.file == file) }
            if episode == nil, let client = HubAccess.makeClient() {
                episode = (try? await client.episodes())?.first { $0.id == id || (!file.isEmpty && $0.file == file) }
            }
            guard let episode, let source = await HubAccess.source(for: episode, store: store) else {
                voiceNote = "That brief is not available right now."
                return
            }
            CarPlayer.shared.play(episode, title: episode.isEvening ? "Evening recap" : "Morning brief", source: source)
        }
    }

    private func publishPlayer() {
        let p = CarPlayer.shared
        bridge.dispatch("kitt:player", [
            "playing": p.isPlaying, "position": p.currentTime, "duration": p.duration ?? 0,
            "id": p.current?.id ?? NSNull(), "title": p.title, "file": p.current?.file ?? ""
        ])
        syncActivity()
    }

    private func syncActivity() {
        guard let model else { return }
        guard model.isConnected else { KittActivityManager.shared.end(); return }
        let p = CarPlayer.shared
        KittActivityManager.shared.sync(state: model.state, offline: model.isOffline, playing: p.isPlaying, briefTitle: p.current == nil ? nil : p.title, hub: model.baseURL)
        refreshMoneyIfStale()
        writeWidgetSnapshot()
    }

    /// The Cash widget's figures, from the Money skill's view, at most every five minutes.
    private func refreshMoneyIfStale() {
        if let at = moneyFetchedAt, Date().timeIntervalSince(at) < 300 { return }
        guard let client = HubAccess.makeClient() else { return }
        moneyFetchedAt = Date()
        Task { @MainActor in
            if let view = try? await client.moneyView() { moneyView = view; writeWidgetSnapshot() }
        }
    }

    /// The home-screen and Lock Screen widgets read this file from the App Group; written only when something changed.
    private func writeWidgetSnapshot() {
        guard let model, let state = model.state else { return }
        let g = state.glance(offline: model.isOffline)
        let brief = BriefStore.standard.episodes().first
        let snap = KittWidgetSnapshot(
            level: g.level.rawValue, eyebrow: g.hasPending ? "Waiting for your OK" : g.eyebrow, headline: g.hasPending ? (g.pendingSummary ?? g.headline) : g.headline, detail: g.sub,
            pending: g.hasPending ? 1 : 0, actionable: g.tiles.filter(\.needsAttention).count, critical: g.level == .critical,
            cashTotal: moneyView?.cashTotal, spendDaily: moneyView?.dailyDebits() ?? [], cashAsOf: moneyView?.cashAsOf,
            briefTitle: brief.map { $0.isEvening ? "Evening recap" : "Morning brief" }, briefWhen: brief?.date, briefDurationS: brief?.durationS, updatedAt: Date()
        )
        guard snap.withoutTime != lastSnapshot?.withoutTime else { return }
        lastSnapshot = snap
        do { try snap.save(); WidgetCenter.shared.reloadAllTimelines() } catch { /* the widgets keep their last snapshot */ }
    }
    #endif
}
#endif
