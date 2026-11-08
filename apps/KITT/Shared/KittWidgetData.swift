#if os(iOS)
import Foundation

/// What the home-screen and Lock Screen widgets show. The app writes it into the shared App Group container whenever its state
/// refreshes (widgets run in their own process and never see the hub or the token); the KITTWidgets extension reads it.
struct KittWidgetSnapshot: Codable, Equatable {
    static let groupID = "group.com.tpcl.kitt"
    static let fileName = "widget.json"

    /// critical | amber | green
    var level: String
    var eyebrow: String
    var headline: String
    var detail: String
    /// 1 when a decision is waiting on you.
    var pending: Int
    /// Skills that need attention.
    var actionable: Int
    var critical: Bool
    var cashTotal: Double?
    /// Debits per day, oldest first (14 days).
    var spendDaily: [Double]
    var cashAsOf: Date?
    var briefTitle: String?
    var briefWhen: Date?
    var briefDurationS: Int?
    var updatedAt: Date

    static var fileURL: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: groupID)?.appendingPathComponent(fileName)
    }

    static func load() -> KittWidgetSnapshot? {
        guard let url = fileURL, let data = try? Data(contentsOf: url) else { return nil }
        let decoder = JSONDecoder(); decoder.dateDecodingStrategy = .iso8601
        return try? decoder.decode(KittWidgetSnapshot.self, from: data)
    }

    func save() throws {
        guard let url = Self.fileURL else { return }
        let encoder = JSONEncoder(); encoder.dateEncodingStrategy = .iso8601
        try encoder.encode(self).write(to: url, options: .atomic)
    }

    /// The same snapshot with the timestamp zeroed, to tell a real change from a re-write.
    var withoutTime: KittWidgetSnapshot { var c = self; c.updatedAt = Date(timeIntervalSince1970: 0); return c }

    /// What the widget gallery shows before the app has written anything.
    static let placeholder = KittWidgetSnapshot(
        level: "green", eyebrow: "All systems nominal", headline: "Nothing needs you right now", detail: "12 skills · hub reachable",
        pending: 0, actionable: 0, critical: false, cashTotal: 46_473, spendDaily: [320, 0, 1_250, 90, 410, 0, 760, 2_100, 0, 180, 640, 0, 980, 230],
        cashAsOf: Date(), briefTitle: "Morning brief", briefWhen: Date(), briefDurationS: 212, updatedAt: Date()
    )
}
#endif
