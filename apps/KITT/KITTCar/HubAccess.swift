import Foundation
import KITTKit

/// Where a brief's audio comes from.
enum BriefSource: Sendable {
    case local(URL)
    case stream(URL, headers: [String: String])
}

/// The hub the phone app is connected to: its saved address and the Keychain token. The CarPlay scene, the Siri intents and the
/// Briefs screen's player all go through here, so they talk to the same hub as the app itself.
/// KITT_DEV_URL and KITT_DEV_TOKEN in the environment win, as in the phone app (simulator runs).
enum HubAccess {
    /// `source` names the channel in the hub's audit trail: "app" for the screens, "siri" for the intents.
    static func makeClient(source: String = "app") -> HubClient? {
        let env = ProcessInfo.processInfo.environment
        if let address = env["KITT_DEV_URL"], let token = env["KITT_DEV_TOKEN"], let url = URL(string: address),
           let dev = try? HubClient(baseURL: url, token: token, source: source) { return dev }
        guard let address = UserDefaults.standard.string(forKey: "hubBaseURL"), let url = URL(string: address),
              let token = try? KeychainTokenStore.load() else { return nil }
        return try? HubClient(baseURL: url, token: token, source: source)
    }

    /// The copy on this phone, else the hub (streamed), else nothing.
    static func source(for episode: Episode, store: BriefStore = .standard) async -> BriefSource? {
        if let local = store.localAudio(for: episode) { return .local(local) }
        if let client = makeClient(), let asset = try? await client.audioAsset(file: episode.file) {
            return .stream(asset.url, headers: asset.headers)
        }
        return nil
    }

    /// What to say when a hub call fails: short, and never the raw error text.
    static func spoken(_ error: Error) -> String {
        if case HubClientError.rejected(let status) = error, status == 401 || status == 403 {
            return "The hub refused the app token. Open Kitt and connect it again."
        }
        if error is HubClientError { return error.localizedDescription }
        return "Kitt can't reach the hub right now. It needs Tailscale (or a tunnel) to your Mac."
    }
}
