import Foundation
import XCTest
@testable import KITTKit

final class CarContentTests: XCTestCase {
    private let now = ISO8601DateFormatter().date(from: "2026-11-03T10:00:00Z")!
    private var utc: Calendar { var c = Calendar(identifier: .gregorian); c.timeZone = TimeZone(identifier: "UTC")!; return c }

    private func decode<T: Decodable>(_ json: String) throws -> T {
        let d = JSONDecoder(); d.keyDecodingStrategy = .convertFromSnakeCase
        return try d.decode(T.self, from: Data(json.utf8))
    }

    func testEpisodesDecodeAndBecomeBriefRows() throws {
        let r: EpisodesResponse = try decode("""
        {"episodes":[
         {"id":3,"slug":"evening","title":"Evening brief","file":"evening-1.m4a","bytes":900,"duration_s":16,"created_at":"2026-11-02 16:04:36"},
         {"id":4,"slug":"morning","title":"Morning brief","file":"morning-2.m4a","bytes":1900,"duration_s":47,"created_at":"2026-11-03 08:06:03"},
         {"id":2,"slug":"morning","title":"Morning brief","file":"morning-0.m4a","bytes":1800,"duration_s":null,"created_at":"2026-10-30 05:05:06"}]}
        """)
        let rows = CarContent.briefRows(r.episodes, now: now, calendar: utc)
        XCTAssertEqual(rows.map(\.id), ["4", "3", "2"], "newest first")
        XCTAssertEqual(rows[0].title, "Morning brief")
        XCTAssertEqual(rows[0].detail, "Today 08:06 · 0:47")
        XCTAssertEqual(rows[1].title, "Evening recap")
        XCTAssertEqual(rows[1].detail, "Yesterday 16:04 · 0:16")
        XCTAssertEqual(rows[2].detail, "Fri 30 Oct 05:05", "no duration, no dangling separator")
        XCTAssertEqual(r.episodes[0].durationLabel, "0:16")
    }

    func testNowTabMirrorsTheMockup() throws {
        XCTAssertEqual(CarContent.now(nil, offline: false).title, "Not connected")
        let green = KITTState(version: "1", skills: ["money": SkillState(name: "Money", description: nil, ok: true, detail: nil, unavailable: nil)])
        XCTAssertEqual(CarContent.now(green, offline: false, now: now).title, "Nothing is waiting for you")
        let waiting = try decode("""
        {"version":"1","skills":{},"pending":[{"code":"42","source":"siri","skill":"money","summary":"log cash 50 parking","created_at":"2026-11-03 09:55:00","expires_at":"2026-11-03 10:05:00"}]}
        """) as KITTState
        let n = CarContent.now(waiting, offline: false, now: now)
        XCTAssertEqual(n.title, "Waiting for your OK")
        XCTAssertEqual(n.lines, ["log cash 50 parking", "Say “Hey Siri, confirm with Kitt” or “cancel with Kitt”."], "decisions are voice-only in the car")
        XCTAssertEqual(CarContent.siriPhrases.map(\.id), ["brief", "ask", "plate", "confirm", "cancel"])
        XCTAssertTrue(CarContent.siriPhrases.allSatisfy { $0.detail.contains("Kitt") }, "every App Shortcut phrase names the app")
        let critical = try decode(#"{"version":"1","skills":{"security":{"name":"Security","ok":false,"detail":"gh is missing"}}}"#) as KITTState
        XCTAssertEqual(CarContent.now(critical, offline: false, now: now).title, "Needs attention now")
        XCTAssertEqual(CarContent.now(green, offline: true, now: now).title, "Reading from the cached copy")
    }

    func testAudioAssetCarriesTheTokenAndRefusesOddFileNames() throws {
        let client = try HubClient(baseURL: URL(string: "http://127.0.0.1:2000")!, token: String(repeating: "t", count: 32))
        let a = try awaitValue { try await client.audioAsset(file: "morning-20261103T080603.m4a") }
        XCTAssertEqual(a.url.absoluteString, "http://127.0.0.1:2000/v1/audio/morning-20261103T080603.m4a")
        XCTAssertEqual(a.headers["Authorization"], "Bearer " + String(repeating: "t", count: 32))
        XCTAssertThrowsError(try awaitValue { try await client.audioAsset(file: "../kitt.sqlite") })
    }

    private func awaitValue<T>(_ f: @escaping @Sendable () async throws -> T) throws -> T {
        let box = Box<T>()
        let sem = DispatchSemaphore(value: 0)
        Task { do { box.value = .success(try await f()) } catch { box.value = .failure(error) }; sem.signal() }
        sem.wait()
        return try box.value!.get()
    }
    private final class Box<T>: @unchecked Sendable { var value: Result<T, Error>? }
}
