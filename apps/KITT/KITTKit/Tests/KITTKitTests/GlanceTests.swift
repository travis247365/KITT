import Foundation
import XCTest
@testable import KITTKit

final class GlanceTests: XCTestCase {
    private let now = ISO8601DateFormatter().date(from: "2026-10-29T08:00:00Z")!

    private func decode(_ json: String) throws -> KITTState {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return try decoder.decode(KITTState.self, from: Data(json.utf8))
    }

    private let healthy = """
    {"version":"0.1.0","skills":{
      "security":{"name":"Security","ok":true,"detail":"gh+vercel present, token KITT_CLOUDFLARE_TOKEN set; last run /Users/YOU/data/run.json"},
      "chief":{"name":"Chief of Staff","ok":true,"detail":"board reachable"},
      "money":{"name":"Money","ok":true,"detail":"ledger ready"}},
     "briefs":{"morning":{"at":"2026-10-29T05:00:00.000Z","text":"Good morning, Sam. Two items are due today. Cash is steady at 3.5 million."},
               "evening":{"at":"2026-10-28T15:45:00.000Z","text":"Old recap."}},
     "coverage":{"days":7,"uptime_pct":93.6},"unavailable":[]}
    """

    func testHealthyHubIsGreenAndTheHeadlineSkipsTheGreeting() throws {
        let g = try decode(healthy).glance(now: now)
        XCTAssertEqual(g.level, .green)
        XCTAssertEqual(g.eyebrow, "Morning brief")
        XCTAssertEqual(g.headline, "Two items are due today.")
        XCTAssertEqual(g.sub, "Cash is steady at 3.5 million.")
        XCTAssertEqual(g.chip, "All systems nominal")
        XCTAssertEqual(g.coverage, "Hub 94 % · 7 days")
        XCTAssertEqual(g.tiles.map(\.id), ["security", "chief", "money"])
        XCTAssertEqual(g.tiles.map(\.value), ["OK", "OK", "OK"])
        XCTAssertEqual(g.tiles.map(\.detail), ["", "", ""], "healthy skills show no hub text (paths and secret names stay off the TV)")
    }

    func testStaleBriefIsNotTheHeadline() throws {
        let g = try decode(healthy).glance(now: now.addingTimeInterval(3 * 86_400))
        XCTAssertEqual(g.headline, "All systems nominal")
        XCTAssertEqual(g.sub, "No recent brief.")
    }

    func testSentenceSplitKeepsDecimalsAndHandlesNoPunctuation() {
        let s = KITTState(version: "x", briefs: ["morning": BriefState(at: "2026-10-29T06:00:00Z", text: "Revenue is 3.5 million today")])
        XCTAssertEqual(s.glance(now: now).headline, "Revenue is 3.5 million today")
    }

    func testPendingDecisionIsAmberLeadsTheScreenAndCarriesItsCode() throws {
        let s = try decode("""
        {"version":"0.1.0","skills":{"money":{"name":"Money","ok":true}},
         "pending":[{"code":"42","source":"siri","skill":"money","summary":"log cash 50 parking","created_at":"2026-10-29 07:55:00","expires_at":"2026-10-29 08:05:00"}]}
        """)
        let g = s.glance(now: now)
        XCTAssertEqual(g.level, .amber)
        XCTAssertEqual(g.eyebrow, "Needs your decision")
        XCTAssertEqual(g.headline, "log cash 50 parking")
        XCTAssertEqual(g.sub, "")
        XCTAssertEqual(g.pendingCode, "42")
        XCTAssertTrue(g.hasPending)
        XCTAssertEqual(g.pendingExpiresAt, ISO8601DateFormatter().date(from: "2026-10-29T08:05:00Z"), "the hub's SQLite timestamps are UTC")
    }

    func testExpiredDecisionIsNotShownAsLive() throws {
        let s = try decode("""
        {"version":"0.1.0","skills":{"money":{"name":"Money","ok":true}},
         "pending":[{"code":"42","source":"siri","skill":"money","summary":"old","created_at":"2026-10-29 07:30:00","expires_at":"2026-10-29 07:40:00"}]}
        """)
        let g = s.glance(now: now)
        XCTAssertFalse(g.hasPending)
        XCTAssertEqual(g.level, .green)
    }

    func testUnhealthySkillIsAmberAndNamed() throws {
        let s = try decode("""
        {"version":"0.1.0","skills":{"whatsapp":{"name":"WhatsApp","ok":false,"detail":"listener stopped"},"money":{"name":"Money","ok":true}}}
        """)
        let g = s.glance(now: now)
        XCTAssertEqual(g.level, .amber)
        XCTAssertEqual(g.headline, "WhatsApp needs attention")
        XCTAssertEqual(g.sub, "listener stopped")
        XCTAssertEqual(g.tiles.first?.id, "whatsapp", "unhealthy skills come first")
        XCTAssertEqual(g.tiles.first?.value, "CHECK")
    }

    func testUnhealthySecurityIsCritical() throws {
        let s = try decode("""
        {"version":"0.1.0","skills":{"security":{"name":"Security","ok":false,"detail":"gh missing"}}}
        """)
        XCTAssertEqual(s.glance(now: now).level, .critical)
        XCTAssertEqual(s.glance(now: now).chip, "Critical")
        XCTAssertEqual(s.glance(now: now).eyebrow, "Critical")
    }

    func testFailedSkillLoadIsCriticalEvenWithOddErrorShapes() throws {
        let s = try decode("""
        {"version":"0.1.0","skills":{},"unavailable":[{"id":"trips","error":"boom"},{"id":"ideas","error":{"code":1}},"junk"]}
        """)
        XCTAssertEqual(s.glance(now: now).level, .critical)
        XCTAssertEqual(s.unavailableList.count, 3)
    }

    func testOfflineCachedCopyIsAmberAtMost() throws {
        XCTAssertEqual(try decode(healthy).glance(offline: true, now: now).level, .amber)
    }

    func testAnUnhealthySkillOutsideTheFirstFiveStillGetsATile() throws {
        let s = try decode("""
        {"version":"0.1.0","skills":{
          "security":{"name":"Security","ok":true},"chief":{"name":"Chief","ok":true},"money":{"name":"Money","ok":true},
          "receptionist":{"name":"Inbox","ok":true},"whatsapp":{"name":"WhatsApp","ok":true},
          "ideas":{"name":"Ideas","ok":true},"trips":{"name":"Trips","ok":false,"detail":"no calendar link"}}}
        """)
        let g = s.glance(now: now)
        XCTAssertEqual(g.tiles.map(\.id), ["trips", "security", "chief", "money", "receptionist"])
        XCTAssertEqual(g.headline, "Trips needs attention")
    }

    func testHubTextIsSanitisedBeforeItReachesTheScreen() {
        XCTAssertEqual(KITTState.sanitise("listener stopped; creds at /Users/YOU/.config/kitt/whatsapp-auth/creds.json"), "listener stopped; creds at …")
        XCTAssertEqual(KITTState.sanitise("missing KITT_COO_PASSWORD"), "missing …")
        XCTAssertLessThanOrEqual(KITTState.sanitise(String(repeating: "word ", count: 60)).count, 91)
    }

    func testNoBriefAndNothingWrongSaysSo() throws {
        let g = try decode(#"{"version":"0.1.0","skills":{"money":{"name":"Money","ok":true}}}"#).glance(now: now)
        XCTAssertEqual(g.headline, "All systems nominal")
        XCTAssertEqual(g.sub, "No recent brief.")
    }

    /// A real /v1/state response captured from the hub itself (a throwaway instance with an isolated config), so the Swift decoder is
    /// tested against what the hub actually sends: SQLite-format pending timestamps, the real key names, nullable fields.
    func testDecodesARealHubStateCapture() throws {
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("Fixtures/state-live.json")
        let state = try decode(String(contentsOf: url, encoding: .utf8))
        let at = ISO8601DateFormatter().date(from: "2026-11-01T01:21:00Z")!
        let g = state.glance(now: at)
        XCTAssertTrue(g.hasPending)
        XCTAssertEqual(g.pendingCode, state.pendingActions.first?.code)
        XCTAssertEqual(g.pendingSummary, "log cash 50 parking")
        XCTAssertEqual(g.pendingExpiresAt, ISO8601DateFormatter().date(from: "2026-11-01T01:30:02Z"))
        XCTAssertEqual(state.glance(now: at.addingTimeInterval(3600)).hasPending, false, "an hour later the same action has expired")
        XCTAssertTrue(g.tiles.map(\.id).contains("money"))
    }
}
