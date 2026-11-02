import Foundation

/// One row of the hub's activity log (`/v1/events`): an ask, a decision, a brief or a routine run.
public struct FeedEvent: Decodable, Equatable, Sendable, Identifiable {
    public let id: Int
    public let ts: String
    public let source: String
    public let skill: String?
    public let intent: String?
    public let input: String?
    public let outcome: String
    public let detail: String?
    public let latencyMs: Int?
}

public struct EventsResponse: Decodable, Equatable, Sendable {
    public let audit: [FeedEvent]
    public let next: Int?
}

public enum FeedKind: String, CaseIterable, Identifiable, Hashable, Sendable {
    case decision, ask, brief, routine

    public var id: String { rawValue }
    public var title: String {
        switch self {
        case .decision: return "Decisions"
        case .ask: return "Questions"
        case .brief: return "Briefs"
        case .routine: return "Routines"
        }
    }
    public var symbol: String {
        switch self {
        case .decision: return "hand.raised"
        case .ask: return "bubble.left"
        case .brief: return "newspaper"
        case .routine: return "clock.arrow.circlepath"
        }
    }
}

/// A feed row ready to show: what it is, who did it, and the tags you can click to filter by.
public struct FeedItem: Identifiable, Hashable, Sendable {
    public let id: Int
    public let date: Date?
    public let kind: FeedKind
    public let title: String
    public let skillID: String
    public let skillName: String
    public let source: String
    public let sourceName: String
    public let outcome: String
    public let outcomeName: String
    public let latencyMs: Int?
    public let input: String?
    public let detail: String?
    public let intent: String?
    /// A routine run that succeeded (heartbeats, syncs, queue flushes): hidden unless asked for. A failed run is never noise.
    public let isNoise: Bool

    public var isProblem: Bool { outcome == "error" }
}

public extension FeedItem {
    /// Build a row from a log event. `skillNames` maps a skill id to its display name (from the hub state).
    init(_ e: FeedEvent, skillNames: [String: String] = [:]) {
        let intent = e.intent ?? ""
        let kind: FeedKind
        if intent.hasPrefix("execute:") || intent == "cancel" || e.outcome == "needs_confirm" { kind = .decision }
        else if intent.hasPrefix("brief:") { kind = .brief }
        else if intent.hasPrefix("routine:") { kind = .routine }
        else { kind = .ask }

        let skillID = (e.skill?.isEmpty == false ? e.skill! : "none")
        let skillName = skillNames[skillID] ?? (skillID == "none" ? "No skill" : Self.humanise(skillID))
        let routineName = intent.hasPrefix("routine:") ? String(intent.dropFirst("routine:".count)) : ""
        let title: String
        switch kind {
        case .routine:
            let action = routineName.split(separator: ".").last.map(String.init) ?? routineName
            title = "\(skillName) \(Self.humanise(action).lowercased())"
        case .brief:
            title = Self.humanise(String(intent.dropFirst("brief:".count))) + " brief"
        case .decision:
            title = e.input.flatMap { $0.isEmpty ? nil : String($0.prefix(110)) } ?? Self.humanise(intent)
        case .ask:
            title = e.input.flatMap { $0.isEmpty ? nil : String($0.prefix(110)) } ?? Self.humanise(intent)
        }

        self.init(
            id: e.id, date: KITTState.parseDate(e.ts), kind: kind, title: title,
            skillID: skillID, skillName: skillName, source: e.source, sourceName: Self.sourceName(e.source),
            outcome: e.outcome, outcomeName: Self.outcomeName(e.outcome), latencyMs: e.latencyMs,
            input: e.input, detail: e.detail.map { String($0.prefix(1200)) }, intent: e.intent,
            isNoise: kind == .routine && e.outcome == "ok"
        )
    }

    static func humanise(_ text: String) -> String {
        let t = text.replacingOccurrences(of: "_", with: " ").replacingOccurrences(of: ".", with: " ").trimmingCharacters(in: .whitespaces)
        return t.prefix(1).uppercased() + t.dropFirst()
    }

    static func sourceName(_ s: String) -> String {
        switch s {
        case "cron": return "Scheduled"
        case "cli": return "Terminal"
        case "app": return "App"
        case "tv": return "Apple TV"
        case "siri": return "Siri"
        case "podcast": return "Podcast"
        case "whatsapp": return "WhatsApp"
        default: return humanise(s)
        }
    }

    static func outcomeName(_ o: String) -> String {
        switch o {
        case "ok": return "OK"
        case "error": return "Error"
        case "needs_confirm": return "Needs decision"
        default: return humanise(o)
        }
    }
}

public enum FeedDimension: String, CaseIterable, Identifiable, Sendable {
    case skill, kind, source, outcome
    public var id: String { rawValue }
    public var title: String {
        switch self {
        case .skill: return "Skills"
        case .kind: return "Type"
        case .source: return "From"
        case .outcome: return "Result"
        }
    }
}

public struct FacetOption: Identifiable, Equatable, Sendable {
    public let value: String
    public let label: String
    public let count: Int
    public var id: String { value }
}

/// Multi-select filters for the feed. An empty selection in a dimension means "all"; dimensions combine with AND, values inside one with OR.
public struct FeedFilter: Equatable, Sendable {
    public var skills: Set<String> = []
    public var kinds: Set<String> = []       // FeedKind raw values
    public var sources: Set<String> = []
    public var outcomes: Set<String> = []
    public var query = ""
    public var showNoise = false

    public init(skills: Set<String> = [], kinds: Set<String> = [], sources: Set<String> = [], outcomes: Set<String> = [], query: String = "", showNoise: Bool = false) {
        self.skills = skills; self.kinds = kinds; self.sources = sources; self.outcomes = outcomes; self.query = query; self.showNoise = showNoise
    }

    public var isActive: Bool { !skills.isEmpty || !kinds.isEmpty || !sources.isEmpty || !outcomes.isEmpty || !query.isEmpty || showNoise }

    public func selection(_ d: FeedDimension) -> Set<String> {
        switch d {
        case .skill: return skills
        case .kind: return kinds
        case .source: return sources
        case .outcome: return outcomes
        }
    }

    public mutating func set(_ d: FeedDimension, _ value: Set<String>) {
        switch d {
        case .skill: skills = value
        case .kind: kinds = value
        case .source: sources = value
        case .outcome: outcomes = value
        }
    }

    public mutating func toggle(_ d: FeedDimension, _ value: String) {
        var s = selection(d)
        if s.contains(value) { s.remove(value) } else { s.insert(value) }
        set(d, s)
    }

    public static func value(_ d: FeedDimension, of item: FeedItem) -> String {
        switch d {
        case .skill: return item.skillID
        case .kind: return item.kind.rawValue
        case .source: return item.source
        case .outcome: return item.outcome
        }
    }

    public static func label(_ d: FeedDimension, of item: FeedItem) -> String {
        switch d {
        case .skill: return item.skillName
        case .kind: return item.kind.title
        case .source: return item.sourceName
        case .outcome: return item.outcomeName
        }
    }

    private func matches(_ item: FeedItem, ignoring skipped: FeedDimension?) -> Bool {
        if !showNoise && item.isNoise { return false }
        for d in FeedDimension.allCases where d != skipped {
            let sel = selection(d)
            if !sel.isEmpty && !sel.contains(Self.value(d, of: item)) { return false }
        }
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        if !q.isEmpty {
            let hay = [item.title, item.skillName, item.sourceName, item.outcomeName, item.input ?? "", item.detail ?? ""].joined(separator: " ").lowercased()
            if !hay.contains(q) { return false }
        }
        return true
    }

    public func apply(_ items: [FeedItem]) -> [FeedItem] { items.filter { matches($0, ignoring: nil) } }

    /// The options for one dropdown, with counts that respect every OTHER filter (so a count is what you would get by picking it).
    /// Selected values stay in the list even if their count is now zero.
    public func options(_ d: FeedDimension, in items: [FeedItem]) -> [FacetOption] {
        var counts: [String: (label: String, n: Int)] = [:]
        for item in items where matches(item, ignoring: d) {
            let v = Self.value(d, of: item)
            counts[v, default: (Self.label(d, of: item), 0)].n += 1
        }
        for v in selection(d) where counts[v] == nil {
            let sample = items.first { Self.value(d, of: $0) == v }
            counts[v] = (sample.map { Self.label(d, of: $0) } ?? FeedItem.humanise(v), 0)
        }
        return counts.map { FacetOption(value: $0.key, label: $0.value.label, count: $0.value.n) }
            .sorted { $0.count != $1.count ? $0.count > $1.count : $0.label < $1.label }
    }
}

public struct FeedDay: Identifiable, Equatable, Sendable {
    public let title: String
    public let items: [FeedItem]
    public var id: String { title }
}

public extension Array where Element == FeedItem {
    /// Newest first, grouped by day ("Today", "Yesterday", then the date).
    func groupedByDay(now: Date = Date(), calendar: Calendar = .current) -> [FeedDay] {
        let sorted = self.sorted { ($0.date ?? .distantPast) != ($1.date ?? .distantPast) ? ($0.date ?? .distantPast) > ($1.date ?? .distantPast) : $0.id > $1.id }
        var days: [FeedDay] = []
        var bucket: [FeedItem] = []
        var current: String?
        let fmt = DateFormatter(); fmt.locale = Locale(identifier: "en_GB"); fmt.dateFormat = "EEE d MMM"
        func title(_ d: Date?) -> String {
            guard let d else { return "Earlier" }
            if calendar.isDate(d, inSameDayAs: now) { return "Today" }
            if let y = calendar.date(byAdding: .day, value: -1, to: now), calendar.isDate(d, inSameDayAs: y) { return "Yesterday" }
            return fmt.string(from: d)
        }
        for item in sorted {
            let t = title(item.date)
            if t != current { if let c = current { days.append(FeedDay(title: c, items: bucket)) }; bucket = []; current = t }
            bucket.append(item)
        }
        if let c = current { days.append(FeedDay(title: c, items: bucket)) }
        return days
    }
}
