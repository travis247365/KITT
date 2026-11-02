import Foundation
import XCTest
@testable import KITTKit

final class FeedTests: XCTestCase {
    private func events(_ json: String) throws -> [FeedEvent] {
        let d = JSONDecoder(); d.keyDecodingStrategy = .convertFromSnakeCase
        return try d.decode(EventsResponse.self, from: Data(json.utf8)).audit
    }

    private let names = ["money": "Money", "receptionist": "Inbox", "kitt": "Kitt"]
    private let now = ISO8601DateFormatter().date(from: "2026-11-02T12:00:00Z")!

    private func items() throws -> [FeedItem] {
        try events("""
        {"audit":[
         {"id":1,"ts":"2026-11-02 09:00:00","source":"cron","skill":"kitt","intent":"routine:core.heartbeat","input":null,"outcome":"ok","detail":"ac=1","latency_ms":30},
         {"id":2,"ts":"2026-11-02 09:05:00","source":"cron","skill":"receptionist","intent":"routine:receptionist.sync","input":null,"outcome":"error","detail":"composio failed","latency_ms":6000},
         {"id":3,"ts":"2026-11-02 10:00:00","source":"siri","skill":"money","intent":"log_cash","input":"log cash 50 parking","outcome":"needs_confirm","detail":"pattern","latency_ms":120},
         {"id":4,"ts":"2026-11-02 10:01:00","source":"tv","skill":"money","intent":"execute:log_cash","input":"log cash 50 parking","outcome":"ok","detail":"asked via siri, confirmed via tv","latency_ms":null},
         {"id":5,"ts":"2026-11-01 07:00:00","source":"podcast","skill":"kitt","intent":"brief:morning","input":null,"outcome":"ok","detail":null,"latency_ms":900},
         {"id":6,"ts":"2026-11-02 11:00:00","source":"app","skill":"receptionist","intent":"brief","input":"what is in my inbox","outcome":"ok","detail":"pattern","latency_ms":2100}
        ],"next":6}
        """).map { FeedItem($0, skillNames: names) }
    }

    func testKindsTitlesAndNoise() throws {
        let i = try items()
        XCTAssertEqual(i.map(\.kind), [.routine, .routine, .decision, .decision, .brief, .ask])
        XCTAssertEqual(i[0].isNoise, true, "a successful heartbeat is plumbing")
        XCTAssertEqual(i[1].isNoise, false, "a failed routine is never hidden")
        XCTAssertEqual(i[1].title, "Inbox sync")
        XCTAssertEqual(i[3].title, "log cash 50 parking")
        XCTAssertEqual(i[4].title, "Morning brief")
        XCTAssertEqual(i[5].skillName, "Inbox")
        XCTAssertEqual(i[2].outcomeName, "Needs decision")
        XCTAssertEqual(i[3].sourceName, "Apple TV")
    }

    func testFiltersAreMultiSelectAndHideNoiseByDefault() throws {
        let i = try items()
        var f = FeedFilter()
        XCTAssertEqual(f.apply(i).map(\.id), [2, 3, 4, 5, 6], "noise hidden by default")
        f.showNoise = true
        XCTAssertEqual(f.apply(i).count, 6)
        f.showNoise = false
        f.toggle(.skill, "money"); f.toggle(.skill, "receptionist")
        XCTAssertEqual(f.apply(i).map(\.id), [2, 3, 4, 6], "two skills OR together")
        f.toggle(.outcome, "error")
        XCTAssertEqual(f.apply(i).map(\.id), [2], "dimensions AND together")
        f.set(.outcome, [])
        f.toggle(.kind, FeedKind.decision.rawValue)
        XCTAssertEqual(f.apply(i).map(\.id), [3, 4])
        f.query = "taxi"
        XCTAssertEqual(f.apply(i).count, 0)
        f.query = "PARKING"
        XCTAssertEqual(f.apply(i).count, 2, "search is case-insensitive over title, skill and detail")
        XCTAssertTrue(f.isActive)
        XCTAssertFalse(FeedFilter().isActive)
    }

    func testFacetCountsRespectTheOtherFilters() throws {
        let i = try items()
        var f = FeedFilter()
        let all = f.options(.skill, in: i)
        XCTAssertEqual(all.first { $0.value == "money" }?.count, 2)
        XCTAssertEqual(all.first { $0.value == "kitt" }?.count, 1, "the heartbeat is noise, so only the brief counts")
        f.toggle(.outcome, "error")
        XCTAssertEqual(f.options(.skill, in: i).map(\.value), ["receptionist"], "with Result = Error only Inbox has anything")
        XCTAssertEqual(f.options(.outcome, in: i).first { $0.value == "ok" }?.count, 3, "the Result menu ignores its own selection, so you can add OK")
        f.set(.outcome, ["ok"]); f.toggle(.skill, "kitt"); f.toggle(.skill, "money")
        XCTAssertEqual(f.options(.skill, in: i).first { $0.value == "receptionist" }?.count, 1)
        var g = FeedFilter(); g.toggle(.source, "cron"); g.toggle(.kind, "ask")
        XCTAssertEqual(g.options(.source, in: i).first { $0.value == "cron" }?.count, 0, "a selected value stays listed with a zero count")
    }

    func testGroupedByDayNewestFirst() throws {
        let days = try items().groupedByDay(now: now, calendar: { var c = Calendar(identifier: .gregorian); c.timeZone = TimeZone(identifier: "UTC")!; return c }())
        XCTAssertEqual(days.map(\.title), ["Today", "Yesterday"])
        XCTAssertEqual(days[0].items.map(\.id), [6, 4, 3, 2, 1])
        XCTAssertEqual(days[1].items.map(\.id), [5])
    }
}
