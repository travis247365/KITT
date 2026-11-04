import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

public enum HubClientError: Error, LocalizedError, Equatable {
    case invalidServerURL
    case invalidToken
    case invalidCommand
    case rejected(Int)
    case invalidResponse

    public var errorDescription: String? {
        switch self {
        case .invalidServerURL:
            return "Use an https:// address, or http:// only for this device (127.0.0.1) or your own home network."
        case .invalidToken:
            return "Enter a valid Kitt app token."
        case .invalidCommand:
            return "Enter a command of 1 to 2,000 characters."
        case .rejected(401):
            return "The hub rejected the app token. Check it in Settings."
        case .rejected(403):
            return "This token does not have permission for that action."
        case .rejected(409):
            return "That request changed on the hub. Review the new one."
        case .rejected(let status):
            return "The hub returned HTTP \(status)."
        case .invalidResponse:
            return "The hub returned an unreadable response."
        }
    }
}

public actor HubClient {
    private let baseURL: URL
    private let token: String
    private let session: URLSession
    private let decoder: JSONDecoder
    private let source: String

    /// `source` names the device in the hub's audit trail and continuation store ("app" for iPhone/iPad/Mac, "tv" for Apple TV).
    public init(baseURL: URL, token: String, source: String = "app", session: URLSession = .shared) throws {
        guard HubEndpoint.classify(baseURL) != .rejected else {
            throw HubClientError.invalidServerURL
        }
        guard token.trimmingCharacters(in: .whitespacesAndNewlines).count >= 16 else {
            throw HubClientError.invalidToken
        }

        self.baseURL = URL(string: baseURL.absoluteString.hasSuffix("/") ? baseURL.absoluteString : baseURL.absoluteString + "/")!
        self.token = token.trimmingCharacters(in: .whitespacesAndNewlines)
        self.session = session
        self.source = source
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        self.decoder = decoder
    }

    public func state() async throws -> KITTState {
        try await request(path: "v1/state", method: "GET", body: Optional<EmptyBody>.none)
    }

    /// The brief episodes, newest first.
    public func episodes() async throws -> [Episode] {
        let response: EpisodesResponse = try await request(path: "v1/episodes", method: "GET", body: Optional<EmptyBody>.none)
        return response.episodes
    }

    /// Where to fetch one episode's audio and the header that authorises it (a player cannot use the app's own session).
    public func audioAsset(file: String) throws -> (url: URL, headers: [String: String]) {
        guard file.range(of: #"^[\w.-]+\.(m4a|mp3)$"#, options: .regularExpression) != nil,
              let url = URL(string: "v1/audio/\(file)", relativeTo: baseURL)?.absoluteURL else { throw HubClientError.invalidResponse }
        return (url, ["Authorization": "Bearer \(token)"])
    }

    /// The newest `latest` rows of the hub's activity log, oldest first within them.
    public func events(latest: Int = 300) async throws -> EventsResponse {
        try await request(path: "v1/events?latest=\(min(max(latest, 1), 500))", method: "GET", body: Optional<EmptyBody>.none)
    }

    public func ask(_ text: String) async throws -> KITTReply {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed.count <= 2_000 else { throw HubClientError.invalidCommand }
        return try await request(path: "v1/ask", method: "POST", body: TextBody(text: trimmed, source: source))
    }

    /// Pass the code of the decision the user was shown: the hub refuses (HTTP 409) if a different request is pending by now.
    public func confirm(code: String? = nil) async throws -> KITTReply {
        try await request(path: "v1/confirm", method: "POST", body: SourceBody(source: source, code: code))
    }

    public func cancel(code: String? = nil) async throws -> KITTReply {
        try await request(path: "v1/cancel", method: "POST", body: SourceBody(source: source, code: code))
    }

    private func request<Body: Encodable, Response: Decodable>(
        path: String,
        method: String,
        body: Body?
    ) async throws -> Response {
        guard let url = URL(string: path, relativeTo: baseURL)?.absoluteURL else {
            throw HubClientError.invalidServerURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder().encode(body)
        }

        let (data, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse else { throw HubClientError.invalidResponse }
        guard (200..<300).contains(response.statusCode) else {
            throw HubClientError.rejected(response.statusCode)
        }
        do {
            return try decoder.decode(Response.self, from: data)
        } catch {
            throw HubClientError.invalidResponse
        }
    }
}

private struct EmptyBody: Encodable {}

private struct TextBody: Encodable {
    let text: String
    let source: String
}

private struct SourceBody: Encodable {
    let source: String
    var code: String? = nil
}
