import XCTest

/// Drives the real tvOS app in the simulator with the Siri Remote (XCUIRemote) against a throwaway hub (scripts/dev-hub.mjs):
/// focus order, Select/Menu behaviour, the safety default on the decision screen, and what happens when the hub's pending request changes.
@MainActor
final class KITTtvUITests: XCTestCase {
    private var app: XCUIApplication!
    private let hubURL = URL(string: ProcessInfo.processInfo.environment["KITT_DEV_URL"] ?? "http://127.0.0.1:2998")!
    private let token = ProcessInfo.processInfo.environment["KITT_DEV_TOKEN"] ?? "dev-app-token-0123456789abcdef"

    override func setUp() async throws {
        continueAfterFailure = false
        try hubAsk("Kit, log cash 50 parking")
        app = XCUIApplication()
        app.launchEnvironment["KITT_DEV_URL"] = hubURL.absoluteString
        app.launchEnvironment["KITT_DEV_TOKEN"] = token
        app.launch()
    }

    // MARK: helpers

    private func button(_ text: String) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", text)).firstMatch
    }

    private func text(_ text: String) -> XCUIElement {
        app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", text)).firstMatch
    }

    private func wait(_ element: XCUIElement, _ seconds: TimeInterval = 25, _ message: String = "") {
        if !element.waitForExistence(timeout: seconds) {
            let tree = app.debugDescription.split(separator: "\n").prefix(40).joined(separator: " | ")
            XCTFail("expected \(element) \(message); app state \(app.state.rawValue); tree: \(tree)")
        }
    }

    private func press(_ b: XCUIRemote.Button) {
        XCUIRemote.shared.press(b)
        Thread.sleep(forTimeInterval: 0.6)   // let the focus engine settle
    }

    /// Press until `expected` appears. If the first press produced nothing, say so in the log (a dropped remote event is measured, not hidden)
    /// and press once more; a second miss fails the test.
    @discardableResult
    private func press(_ b: XCUIRemote.Button, expecting expected: XCUIElement, within seconds: TimeInterval = 4) -> Bool {
        press(b)
        if expected.waitForExistence(timeout: seconds) { return false }
        print("UITEST-NOTE first \(b) press was dropped; retrying once (focused: \(app.buttons.matching(NSPredicate(format: "hasFocus == true")).firstMatch.label))")
        press(b)
        return true
    }

    private func waitForFocus(_ element: XCUIElement, _ seconds: TimeInterval = 10) -> Bool {
        let deadline = Date().addingTimeInterval(seconds)
        while Date() < deadline { if element.hasFocus { Thread.sleep(forTimeInterval: 0.5); return true }; Thread.sleep(forTimeInterval: 0.25) }
        let focused = app.descendants(matching: .any).matching(NSPredicate(format: "hasFocus == true")).allElementsBoundByIndex.map { "\($0.elementType.rawValue):\($0.label)" }
        print("UITEST-NOTE focus never reached \(element); focused elements: \(focused)")
        return false
    }

    private func shot(_ name: String) {
        let a = XCTAttachment(screenshot: app.screenshot())
        a.name = name
        a.lifetime = .keepAlways
        add(a)
        let dir = ProcessInfo.processInfo.environment["KITT_UITEST_SHOTS"] ?? NSTemporaryDirectory()
        try? app.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: dir).appendingPathComponent("\(name).png"))
    }

    private func hubRequest(_ path: String, method: String = "GET", body: [String: Any]? = nil) throws -> [String: Any] {
        var req = URLRequest(url: hubURL.appendingPathComponent(path))
        req.httpMethod = method
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        if let body { req.setValue("application/json", forHTTPHeaderField: "Content-Type"); req.httpBody = try JSONSerialization.data(withJSONObject: body) }
        var result: [String: Any] = [:]
        let done = DispatchSemaphore(value: 0)
        URLSession.shared.dataTask(with: req) { data, response, _ in
            result = (data.flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any]) ?? [:]
            result["_status"] = (response as? HTTPURLResponse)?.statusCode
            done.signal()
        }.resume()
        done.wait()
        return result
    }

    private func hubAsk(_ text: String) throws { _ = try hubRequest("v1/ask", method: "POST", body: ["text": text, "source": "uitest"]) }
    private func hubPending() throws -> [[String: Any]] { (try hubRequest("v1/state")["pending"] as? [[String: Any]]) ?? [] }

    // MARK: tests

    func testBoardShowsTheDecisionAndFocusStartsOnReview() throws {
        wait(button("Review and decide"), 25, "(the board with a decision waiting)")
        XCTAssertTrue(button("Review and decide").hasFocus, "a decision waiting takes the first focus")
        XCTAssertTrue(text("log cash 50 parking").exists, "the headline is the waiting decision")
        shot("tv-board-decision")
    }

    func testDecisionScreenFocusesCancelFirstAndCancelWorks() throws {
        wait(button("Review and decide"))
        XCTAssertTrue(waitForFocus(button("Review and decide")), "Review has focus before we press")
        press(.select, expecting: button("Cancel"))
        wait(button("Cancel"), 10, "(the decision screen)")
        XCTAssertTrue(button("Cancel").hasFocus, "Cancel must be focused first so a stray Select never commits")
        shot("tv-decision-cancel-focused")
        press(.left)
        XCTAssertTrue(button("Confirm").hasFocus, "swipe left moves focus to Confirm")
        press(.right)
        XCTAssertTrue(button("Cancel").hasFocus, "swipe right moves focus back to Cancel")
        press(.select)
        wait(button("Done"), 15, "(the outcome)")
        XCTAssertTrue(button("Done").hasFocus, "Done is the only control after the outcome")
        XCTAssertTrue(text("Cancelled").exists, "the hub's reply is shown")
        shot("tv-decision-cancelled")
        XCTAssertEqual(try hubPending().count, 0, "the hub no longer has the request")
        press(.select)
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label CONTAINS[c] 'Review and decide'")).firstMatch.waitForNonExistence(timeout: 15), "back on a board with nothing waiting")
        shot("tv-board-clear")
    }

    func testMenuLeavesTheDecisionWithoutDeciding() throws {
        wait(button("Review and decide"))
        XCTAssertTrue(waitForFocus(button("Review and decide")))
        press(.select, expecting: button("Cancel"))
        wait(button("Cancel"))
        press(.menu)
        shot("tv-after-menu")
        XCTAssertEqual(app.state, .runningForeground, "Menu on the decision screen must not leave the app")
        wait(button("Review and decide"), 10, "(Menu returns to the board)")
        XCTAssertEqual(try hubPending().count, 1, "Menu must not confirm or cancel anything")
    }

    func testConfirmingARequestThatChangedIsRefusedAndNothingRuns() throws {
        wait(button("Review and decide"))
        XCTAssertTrue(waitForFocus(button("Review and decide")))
        press(.select, expecting: button("Cancel"))
        wait(button("Cancel"))
        // while the TV shows request A, another channel creates request B (this supersedes A on the hub)
        try hubAsk("Kit, log cash 60 taxi")
        press(.left)                              // Cancel -> Confirm
        XCTAssertTrue(button("Confirm").hasFocus)
        press(.select)                            // confirm what the TV showed (A)
        wait(button("Review and decide"), 20, "(the app closes the stale decision and shows the new one)")
        let pending = try hubPending()
        XCTAssertEqual(pending.count, 1, "request B is still waiting: nothing was executed")
        XCTAssertEqual(pending.first?["summary"] as? String, "log cash 60 taxi")
        XCTAssertTrue(text("log cash 60 taxi").exists, "the board now shows request B")
        shot("tv-stale-decision-refused")
    }

    func testRemoteMovesAcrossTheTiles() throws {
        try hubAsk("Kit, cancel")                 // no decision: the first tile takes focus
        XCTAssertEqual(try hubPending().count, 0, "the decision is cleared on the hub before the app starts")
        app.terminate(); app.launch()
        let tiles = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] 'OK'"))
        XCTAssertTrue(tiles.firstMatch.waitForExistence(timeout: 25), "skill tiles are on the board")
        XCTAssertTrue(tiles.firstMatch.hasFocus || tiles.allElementsBoundByIndex.contains { $0.hasFocus }, "a tile has focus")
        let before = tiles.allElementsBoundByIndex.firstIndex { $0.hasFocus }
        press(.right)
        let after = tiles.allElementsBoundByIndex.firstIndex { $0.hasFocus }
        if tiles.count > 1 { XCTAssertNotEqual(before, after, "swipe right moves focus to the next tile") }
        shot("tv-tiles")
    }
}
