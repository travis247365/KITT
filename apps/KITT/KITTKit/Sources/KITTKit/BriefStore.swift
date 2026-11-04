import Foundation

/// The briefs kept on the phone so the car can play them away from the home network.
/// A folder holding `episodes.json` (the hub's list as last seen) and the newest audio files.
public struct BriefStore: Sendable {
    public let directory: URL

    public init(directory: URL) { self.directory = directory }

    /// Application Support/KITTBriefs, kept out of backups (the hub re-renders them).
    public static var standard: BriefStore {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSTemporaryDirectory())
        return BriefStore(directory: base.appendingPathComponent("KITTBriefs", isDirectory: true))
    }

    private var indexURL: URL { directory.appendingPathComponent("episodes.json") }

    /// The list as last saved, newest first; empty if nothing was ever saved or the file is unreadable.
    public func episodes() -> [Episode] {
        guard let data = try? Data(contentsOf: indexURL) else { return [] }
        let decoder = JSONDecoder(); decoder.keyDecodingStrategy = .convertFromSnakeCase
        let list = (try? decoder.decode(EpisodesResponse.self, from: data))?.episodes ?? []
        return Self.newestFirst(list)
    }

    public func save(_ episodes: [Episode]) throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let encoder = JSONEncoder(); encoder.keyEncodingStrategy = .convertToSnakeCase
        try encoder.encode(EpisodesResponse(episodes: Self.newestFirst(episodes))).write(to: indexURL, options: .atomic)
        var dir = directory
        var values = URLResourceValues(); values.isExcludedFromBackup = true
        try? dir.setResourceValues(values)
    }

    /// Where an episode's audio lives on this phone. The name is checked: a file name from the hub never leaves the folder.
    public func audioURL(for episode: Episode) -> URL? {
        guard Self.isSafe(episode.file) else { return nil }
        return directory.appendingPathComponent(episode.file)
    }

    /// The local copy, only if it is really there.
    public func localAudio(for episode: Episode) -> URL? {
        guard let url = audioURL(for: episode), FileManager.default.fileExists(atPath: url.path) else { return nil }
        return url
    }

    /// Deletes audio files that are not in the wanted set. Leaves the index and anything it does not recognise.
    public func prune(keeping wanted: Set<String>) {
        let files = (try? FileManager.default.contentsOfDirectory(atPath: directory.path)) ?? []
        for name in files where Self.isSafe(name) && !wanted.contains(name) {
            try? FileManager.default.removeItem(at: directory.appendingPathComponent(name))
        }
    }

    public static func newestFirst(_ list: [Episode]) -> [Episode] {
        list.sorted { ($0.date ?? .distantPast, $0.id) > ($1.date ?? .distantPast, $1.id) }
    }

    static func isSafe(_ name: String) -> Bool {
        name.range(of: #"^[\w.-]+\.(m4a|mp3)$"#, options: .regularExpression) != nil && !name.contains("..")
    }
}

public enum BriefSync {
    public struct Outcome: Equatable, Sendable {
        public let episodes: Int
        public let downloaded: Int
        public let failed: Int
    }

    /// Refreshes the list and downloads the newest `keep` briefs that are not on the phone yet; older audio is deleted.
    /// Throws only when the list itself cannot be fetched; one failed file is counted and the others still download.
    @discardableResult
    public static func sync(client: HubClient, store: BriefStore = .standard, keep: Int = 4, session: URLSession = .shared) async throws -> Outcome {
        let list = BriefStore.newestFirst(try await client.episodes())
        try store.save(list)
        let wanted = Array(list.prefix(keep))
        var downloaded = 0, failed = 0
        for episode in wanted where store.localAudio(for: episode) == nil {
            do {
                try await download(episode, client: client, store: store, session: session)
                downloaded += 1
            } catch {
                if error is CancellationError { throw error }
                failed += 1
            }
        }
        store.prune(keeping: Set(wanted.map(\.file)))
        return Outcome(episodes: list.count, downloaded: downloaded, failed: failed)
    }

    static func download(_ episode: Episode, client: HubClient, store: BriefStore, session: URLSession) async throws {
        guard let destination = store.audioURL(for: episode) else { throw HubClientError.invalidResponse }
        let asset = try await client.audioAsset(file: episode.file)
        var request = URLRequest(url: asset.url)
        asset.headers.forEach { request.setValue($1, forHTTPHeaderField: $0) }
        request.timeoutInterval = 60
        let (tmp, response) = try await session.download(for: request)
        defer { try? FileManager.default.removeItem(at: tmp) }
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else { throw HubClientError.invalidResponse }
        try FileManager.default.createDirectory(at: store.directory, withIntermediateDirectories: true)
        if FileManager.default.fileExists(atPath: destination.path) { try FileManager.default.removeItem(at: destination) }
        try FileManager.default.moveItem(at: tmp, to: destination)
    }
}
