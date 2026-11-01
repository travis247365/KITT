import Foundation
import XCTest
@testable import KITTKit

final class HubClientTests: XCTestCase {
    func testDecodesLiveStateShape() throws {
        let data = Data(
            """
            {
              "version": "0.1.0",
              "now": "2026-10-29T08:00:00.000Z",
              "tz": "Africa/Lusaka",
              "brain": {"ok": false, "provider": "claude-cli", "detail": "unavailable"},
              "pending": [{
                "code": "42",
                "source": "siri",
                "skill": "money",
                "summary": "log cash 50 parking",
                "created_at": "2026-10-29T07:55:00.000Z",
                "expires_at": "2026-10-29T08:05:00.000Z"
              }],
              "routines": [{
                "name": "core.podcast_evening",
                "skill": "core",
                "last_run_at": "2026-10-28T15:45:00.000Z",
                "last_status": "ok"
              }],
              "skills": {
                "money": {"name": "Money", "description": "Personal ledger", "ok": true, "detail": "ready"},
                "whatsapp": {"name": "WhatsApp", "ok": false, "detail": "listener stopped", "unavailable": true}
              },
              "coverage": {"days": 7},
              "briefs": {"morning": {"speak": "Good morning"}}
            }
            """.utf8
        )
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase

        let state = try decoder.decode(KITTState.self, from: data)
        XCTAssertEqual(state.version, "0.1.0")
        XCTAssertEqual(state.pendingActions.first?.summary, "log cash 50 parking")
        XCTAssertNotNil(state.pendingActions.first?.expiresAt)
        XCTAssertEqual(state.routineList.first?.lastStatus, "ok")
        XCTAssertEqual(state.skillList["whatsapp"]?.unavailable, true)
    }

    func testRequiresHTTPSAndAppScopedToken() throws {
        XCTAssertThrowsError(
            try HubClient(baseURL: URL(string: "http://hub.example.ts.net")!, token: String(repeating: "a", count: 32))
        ) { XCTAssertEqual($0 as? HubClientError, .invalidServerURL) }
        XCTAssertThrowsError(
            try HubClient(baseURL: URL(string: "https://hub.example.ts.net")!, token: "short")
        ) { XCTAssertEqual($0 as? HubClientError, .invalidToken) }
        XCTAssertThrowsError(
            try HubClient(baseURL: URL(string: "https://user:pass@hub.example.ts.net")!, token: String(repeating: "a", count: 32))
        ) { XCTAssertEqual($0 as? HubClientError, .invalidServerURL) }
    }

    func testReplySupportsOptionalConfirmationFlag() throws {
        let data = Data(#"{"speak":"What should I ask?","needs_confirm":true}"#.utf8)
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let reply = try decoder.decode(KITTReply.self, from: data)
        XCTAssertEqual(reply.speak, "What should I ask?")
        XCTAssertEqual(reply.needsConfirm, true)
    }
}
