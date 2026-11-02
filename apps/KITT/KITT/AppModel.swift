import Foundation
import Combine
import KITTKit

@MainActor
final class AppModel: ObservableObject {
    @Published private(set) var state: KITTState?
    @Published private(set) var isBusy = false
    @Published private(set) var reply: String?
    @Published var errorMessage: String?
    @Published private(set) var baseURL: String
    @Published private(set) var hasSavedToken = false
    /// True when the last refresh failed but an earlier copy of the state is still on screen (the Mac sleeps).
    @Published private(set) var isOffline = false
    /// The hub answered 401/403: the saved token no longer works. This is not "offline"; the user has to connect again.
    @Published private(set) var authFailed = false
    /// What a connect attempt is doing right now ("Contacting the hub…"), so the Settings screen can show progress; nil when idle.
    @Published private(set) var connectStep: String?
    @Published private(set) var connectSummary: String?
    /// The hub's activity log, newest 300 rows, for the Feed screen; the filter lives here so the Overview can open the feed already filtered.
    @Published private(set) var feedEvents: [FeedEvent] = []
    @Published private(set) var feedError: String?
    @Published var feedFilter = FeedFilter()
    @Published private(set) var lastUpdated: Date?

    private var client: HubClient?

    /// Names this device in the hub's audit trail and per-channel continuation store.
    private static var deviceSource: String {
        #if os(tvOS)
        return "tv"
        #else
        return "app"
        #endif
    }

    enum ResolveOutcome: Equatable {
        case done(String)
        /// The hub's pending request is not the one that was shown (HTTP 409); nothing was run.
        case changed
        case failed(String)
    }

    init() {
        baseURL = UserDefaults.standard.string(forKey: "hubBaseURL") ?? ""
        if let token = try? KeychainTokenStore.load(), !baseURL.isEmpty,
           let url = URL(string: baseURL), let client = try? HubClient(baseURL: url, token: token, source: Self.deviceSource) {
            self.client = client
            hasSavedToken = true
        }
        connectFromDevelopmentEnvironment()
    }

    var isConnected: Bool { client != nil }

    var feedItems: [FeedItem] {
        let names = (state?.skillList ?? [:]).mapValues(\.name)
        return feedEvents.map { FeedItem($0, skillNames: names) }
    }

    func refreshFeed() async {
        guard let client else { return }
        do {
            feedEvents = try await client.events(latest: 300).audit
            feedError = nil
        } catch {
            if error is CancellationError || (error as? URLError)?.code == .cancelled { return }
            feedError = error.localizedDescription
        }
    }

    /// Launch with KITT_DEV_URL and KITT_DEV_TOKEN in the environment to connect without typing (simulator runs, UI tests, review snapshots).
    private func connectFromDevelopmentEnvironment() {
        let env = ProcessInfo.processInfo.environment
        guard client == nil, let address = env["KITT_DEV_URL"], let token = env["KITT_DEV_TOKEN"],
              let url = URL(string: address), let dev = try? HubClient(baseURL: url, token: token, source: Self.deviceSource) else { return }
        client = dev
        baseURL = address
        hasSavedToken = true
    }

    func connect(serverAddress: String, appToken: String) async {
        errorMessage = nil
        connectSummary = nil
        isBusy = true
        defer { isBusy = false; connectStep = nil }

        // Each step is shown for a moment, so even a hub on this Mac (answers in milliseconds) visibly "does something".
        func step(_ text: String) async {
            connectStep = text
            try? await Task.sleep(for: .milliseconds(450))
        }

        do {
            await step("Checking the address…")
            let token: String
            if appToken.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                guard let saved = try KeychainTokenStore.load() else { throw HubClientError.invalidToken }
                token = saved
            } else {
                token = appToken
            }

            guard let url = URL(string: serverAddress.trimmingCharacters(in: .whitespacesAndNewlines)) else {
                throw HubClientError.invalidServerURL
            }
            let cfg = URLSessionConfiguration.ephemeral
            cfg.timeoutIntervalForRequest = 20       // a hub that does not answer fails in 20 s, not a minute
            cfg.waitsForConnectivity = false
            let candidate = try HubClient(baseURL: url, token: token, source: Self.deviceSource, session: URLSession(configuration: cfg))

            await step("Contacting the hub and checking the token…")
            let loadedState = try await candidate.state()

            await step("Saving the token in the Keychain…")
            try KeychainTokenStore.save(token.trimmingCharacters(in: .whitespacesAndNewlines))
            UserDefaults.standard.set(url.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")), forKey: "hubBaseURL")
            baseURL = url.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
            client = candidate
            hasSavedToken = true
            state = loadedState
            reply = nil
            isOffline = false
            authFailed = false
            lastUpdated = Date()

            await step("Loading the feed…")
            await refreshFeed()
            connectSummary = "Hub \(loadedState.version) · \(loadedState.skillList.count) skills · \(feedEvents.count) feed items"
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func disconnect() {
        do {
            try KeychainTokenStore.delete()
            UserDefaults.standard.removeObject(forKey: "hubBaseURL")
            baseURL = ""
            hasSavedToken = false
            client = nil
            state = nil
            reply = nil
            errorMessage = nil
            isOffline = false
            authFailed = false
            lastUpdated = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func refresh() async {
        guard let client else { return }
        isBusy = true
        defer { isBusy = false }
        do {
            state = try await client.state()
            errorMessage = nil
            isOffline = false
            authFailed = false
            lastUpdated = Date()
            await refreshFeed()
        } catch {
            if error is CancellationError || (error as? URLError)?.code == .cancelled { return }
            errorMessage = error.localizedDescription
            if case HubClientError.rejected(let status) = error, status == 401 || status == 403 {
                authFailed = true
                isOffline = false
            } else {
                isOffline = state != nil
            }
        }
    }

    func ask(_ command: String) async {
        guard let client else { return }
        isBusy = true
        defer { isBusy = false }
        do {
            let result = try await client.ask(command)
            reply = result.speak
            state = try await client.state()
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// Confirm or cancel the pending request. Pass the code of the request the user was shown: the hub refuses a different one.
    /// The outcome of the action is reported even if the follow-up state refresh fails.
    @discardableResult
    func resolvePending(confirm: Bool, code: String? = nil) async -> ResolveOutcome {
        guard let client else { return .failed("Not connected.") }
        isBusy = true
        defer { isBusy = false }
        let result: KITTReply
        do {
            result = confirm ? try await client.confirm(code: code) : try await client.cancel(code: code)
        } catch HubClientError.rejected(409) {
            errorMessage = HubClientError.rejected(409).localizedDescription
            await refreshQuietly()
            return .changed
        } catch {
            errorMessage = error.localizedDescription
            return .failed(error.localizedDescription)
        }
        reply = result.speak
        errorMessage = nil
        await refreshQuietly()
        return .done(result.speak)
    }

    private func refreshQuietly() async {
        guard let client, let fresh = try? await client.state() else { return }
        state = fresh
        isOffline = false
        authFailed = false
        lastUpdated = Date()
        await refreshFeed()
    }
}
