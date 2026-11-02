import Foundation

/// Where the hub may be reached, and over what.
/// - `https://` anywhere: always fine (a Tailscale `serve` name, a tunnel, a real certificate).
/// - `http://` only for this device itself (127.0.0.1, ::1, localhost: the traffic never leaves the machine, which is how the Mac app and the
///   simulators talk to a hub on the same Mac) or for an address on your own network (192.168.x.x, 10.x.x.x, 172.16-31.x.x, 100.64-127.x.x
///   Tailscale, `.local`). That traffic is not encrypted, so the apps say so on screen.
/// - `http://` to any other host: refused.
public enum HubEndpoint {
    public enum Verdict: Equatable, Sendable {
        case secure
        case thisDevice
        case privateNetwork
        case rejected
    }

    public static func classify(_ url: URL) -> Verdict {
        guard let c = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let host = c.host?.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "[]")), !host.isEmpty,
              c.user == nil, c.password == nil, c.query == nil, c.fragment == nil else { return .rejected }
        switch c.scheme?.lowercased() {
        case "https": return .secure
        case "http":
            if ["localhost", "127.0.0.1", "::1"].contains(host) || host.hasPrefix("127.") { return .thisDevice }
            if host.hasSuffix(".local") || isPrivateIPv4(host) { return .privateNetwork }
            return .rejected
        default: return .rejected
        }
    }

    /// A short line for the connect screens when the connection is not encrypted; nil when it is.
    public static func note(for url: URL) -> String? {
        switch classify(url) {
        case .thisDevice: return "This hub is on this device: the connection never leaves it."
        case .privateNetwork: return "Not encrypted: use this only on your own home network."
        default: return nil
        }
    }

    static func isPrivateIPv4(_ host: String) -> Bool {
        let p = host.split(separator: ".").compactMap { Int($0) }
        guard p.count == 4, p.allSatisfy({ (0...255).contains($0) }) else { return false }
        switch (p[0], p[1]) {
        case (10, _), (192, 168): return true
        case (172, 16...31): return true
        case (100, 64...127): return true   // Tailscale (CGNAT range)
        default: return false
        }
    }
}
