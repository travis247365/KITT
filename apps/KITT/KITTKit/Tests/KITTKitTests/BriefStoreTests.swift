import Foundation
import XCTest
@testable import KITTKit

/// Answers every request from a closure, so BriefSync runs without a hub.
final class StubProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var handler: (@Sendable (URLRequest) -> (Int, Data))?
    nonisolated(unsafe) static var seen: [URLRequest] = []
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.seen.append(request)
        let (status, body) = Self.handler?(request) ?? (500, Data())
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: body)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

final class BriefStoreTests: XCTestCase {
    private var dir: URL!
    override func setUp() {
        dir = FileManager.default.temporaryDirectory.appendingPathComponent("briefs-\(UUID().uuidString)")
        StubProtocol.seen = []
    }
    override func tearDown() { try? FileManager.default.removeItem(at: dir); StubProtocol.handler = nil }

    private func episode(_ id: Int, _ file: String, _ created: String) -> Episode {
        Episode(id: id, slug: "morning", title: "t", file: file, bytes: nil, durationS: 10, createdAt: created)
    }

    func testStoreRoundTripsNewestFirstAndRefusesUnsafeNames() throws {
        let store = BriefStore(directory: dir)
        XCTAssertEqual(store.episodes(), [], "nothing saved yet")
        let a = episode(1, "morning-a.m4a", "2026-11-01 08:00:00"), b = episode(2, "morning-b.m4a", "2026-11-03 08:00:00")
        try store.save([a, b])
        XCTAssertEqual(store.episodes().map(\.id), [2, 1])
        XCTAssertNil(store.audioURL(for: episode(3, "../kitt.sqlite", "2026-11-03 08:00:00")))
        XCTAssertNil(store.audioURL(for: episode(4, "a/b.m4a", "2026-11-03 08:00:00")))
        XCTAssertNil(store.localAudio(for: a), "listed but not downloaded")
    }

    func testPruneKeepsOnlyWantedAudioAndTheIndex() throws {
        let store = BriefStore(directory: dir)
        try store.save([])
        for name in ["keep.m4a", "drop.m4a", "other.txt"] { try Data("x".utf8).write(to: dir.appendingPathComponent(name)) }
        store.prune(keeping: ["keep.m4a"])
        let left = Set(try FileManager.default.contentsOfDirectory(atPath: dir.path))
        XCTAssertEqual(left, ["keep.m4a", "episodes.json", "other.txt"])
    }

    func testSyncDownloadsNewestAndDeletesOlder() async throws {
        let cfg = URLSessionConfiguration.ephemeral; cfg.protocolClasses = [StubProtocol.self]
        let session = URLSession(configuration: cfg)
        let token = String(repeating: "t", count: 32)
        let client = try HubClient(baseURL: URL(string: "http://127.0.0.1:2000")!, token: token, session: session)
        let list = """
        {"episodes":[
         {"id":1,"slug":"morning","title":"a","file":"morning-old.m4a","bytes":3,"duration_s":5,"created_at":"2026-10-01 08:00:00"},
         {"id":2,"slug":"evening","title":"b","file":"evening-mid.m4a","bytes":3,"duration_s":5,"created_at":"2026-11-02 16:00:00"},
         {"id":3,"slug":"morning","title":"c","file":"morning-new.m4a","bytes":3,"duration_s":5,"created_at":"2026-11-03 08:00:00"}]}
        """
        StubProtocol.handler = { req in
            if req.url!.path == "/v1/episodes" { return (200, Data(list.utf8)) }
            if req.url!.path.hasPrefix("/v1/audio/morning-new") { return (200, Data("NEW".utf8)) }
            if req.url!.path.hasPrefix("/v1/audio/evening-mid") { return (404, Data()) }
            return (500, Data())
        }
        let store = BriefStore(directory: dir)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try Data("OLD".utf8).write(to: dir.appendingPathComponent("morning-old.m4a"))

        let outcome = try await BriefSync.sync(client: client, store: store, keep: 2, session: session)

        XCTAssertEqual(outcome, BriefSync.Outcome(episodes: 3, downloaded: 1, failed: 1), "one file failed; the other still arrived")
        XCTAssertEqual(try String(contentsOf: dir.appendingPathComponent("morning-new.m4a"), encoding: .utf8), "NEW")
        XCTAssertFalse(FileManager.default.fileExists(atPath: dir.appendingPathComponent("morning-old.m4a").path), "older than the newest two: removed")
        XCTAssertTrue(StubProtocol.seen.filter { $0.url!.path.hasPrefix("/v1/audio") }.allSatisfy { $0.value(forHTTPHeaderField: "Authorization") == "Bearer " + token })
        XCTAssertEqual(store.episodes().count, 3, "the list is saved even when a download fails")
    }
}
