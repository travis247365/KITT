import Foundation

/// How worried the big screen should look. It drives the colour and speed of the animated top border and the KITT name.
public enum StatusLevel: String, Equatable, Sendable {
    case critical
    case amber
    case green
}

/// One skill on the glance board: a state word in big type, with a short note under it when something needs attention.
public struct GlanceTile: Equatable, Identifiable, Sendable {
    public let id: String
    public let name: String
    public let symbol: String
    public let value: String
    public let detail: String
    public let needsAttention: Bool
}

/// Everything the Apple TV "Now" screen shows, worked out from the hub state in one place so it can be tested.
public struct Glance: Equatable, Sendable {
    public let level: StatusLevel
    public let eyebrow: String
    public let headline: String
    public let sub: String
    public let chip: String
    public let coverage: String?
    public let tiles: [GlanceTile]
    public let pendingCode: String?
    public let pendingSummary: String?
    public let pendingExpiresAt: Date?

    public var hasPending: Bool { pendingSummary != nil }
}

public extension KITTState {
    /// The skills shown first, in this order; any other skills fill the remaining places.
    static let glanceSkillOrder = ["security", "chief", "money", "receptionist", "whatsapp"]
    static let glanceTileCount = 5
    /// A brief older than this is not shown as the current headline.
    static let briefFreshness: TimeInterval = 36 * 3600

    /// Level rule (the hub does not send a "critical finding" signal yet, so this uses what it does send):
    /// critical = a skill failed to load or the security skill is unhealthy;
    /// amber = a decision is waiting, any skill is unhealthy, or the screen is showing a cached copy;
    /// green = everything else.
    func statusLevel(offline: Bool = false, now: Date = Date()) -> StatusLevel {
        let skills = skillList
        if !unavailableList.isEmpty || skills["security"]?.isUnhealthy == true { return .critical }
        if livePending(now: now) != nil || skills.values.contains(where: \.isUnhealthy) || offline { return .amber }
        return .green
    }

    func glance(offline: Bool = false, now: Date = Date()) -> Glance {
        let skills = skillList
        let level = statusLevel(offline: offline, now: now)

        // Unhealthy skills always get a tile, then the usual five, then any others.
        func rank(_ id: String) -> Int { Self.glanceSkillOrder.firstIndex(of: id) ?? Self.glanceSkillOrder.count }
        let sorted = skills.sorted { l, r in
            if l.value.isUnhealthy != r.value.isUnhealthy { return l.value.isUnhealthy }
            if rank(l.key) != rank(r.key) { return rank(l.key) < rank(r.key) }
            return l.key < r.key
        }
        let allTiles = sorted.map { id, skill in
            GlanceTile(
                id: id,
                name: skill.name,
                symbol: Self.symbol(for: id),
                value: skill.unavailable == true ? "DOWN" : (skill.ok == false ? "CHECK" : "OK"),
                // Healthy skills show no note: their health strings can name tools, paths and secrets, which do not belong on a living-room TV.
                detail: skill.isUnhealthy ? Self.sanitise(skill.detail ?? "") : "",
                needsAttention: skill.isUnhealthy
            )
        }
        let tiles = Array(allTiles.prefix(Self.glanceTileCount))
        // Keep the priority order among healthy skills: the sort above put unhealthy first, then by rank.
        let problems = allTiles.filter(\.needsAttention) + unavailableList.map {
            GlanceTile(id: $0.id ?? "unknown", name: $0.id ?? "A skill", symbol: "exclamationmark.triangle", value: "DOWN", detail: Self.sanitise($0.error ?? "failed to load"), needsAttention: true)
        }

        let pending = livePending(now: now)
        let brief = latestBrief(now: now)

        let eyebrow: String, headline: String, sub: String
        if let pending {
            (eyebrow, headline, sub) = ("Needs your decision", pending.summary, "")
        } else if !problems.isEmpty {
            let first = problems[0]
            (eyebrow, headline, sub) = (level == .critical ? "Critical" : "Needs attention", problems.count == 1 ? "\(first.name) needs attention" : "\(problems.count) things need attention", problems.count == 1 ? first.detail : problems.map(\.name).joined(separator: " · "))
        } else if let brief {
            (eyebrow, headline, sub) = (brief.kind.capitalized + " brief", brief.headline, brief.rest)
        } else {
            (eyebrow, headline, sub) = ("Status", "All systems nominal", "No recent brief.")
        }

        let coverageText: String? = coverage.flatMap { c in
            guard let pct = c.uptimePct, let days = c.days else { return nil }
            return "Hub \(pct.formatted(.number.precision(.fractionLength(0)))) % · \(days) days"
        }
        return Glance(
            level: level, eyebrow: eyebrow, headline: headline, sub: sub, chip: level.chipWord, coverage: coverageText, tiles: tiles,
            pendingCode: pending?.code, pendingSummary: pending?.summary, pendingExpiresAt: pending?.expiresAt.flatMap(Self.parseDate)
        )
    }

    /// The newest pending action that has not expired (an expired one never reaches a screen as a live decision).
    func livePending(now: Date = Date()) -> PendingAction? {
        pendingActions.first { action in
            guard let expires = action.expiresAt.flatMap(Self.parseDate) else { return true }
            return expires > now
        }
    }

    private struct LatestBrief {
        let kind: String
        let headline: String
        let rest: String

        init?(kind: String, text: String) {
            let sentences = Self.sentences(text)
            // A brief opens with a greeting ("Good morning, <name>."): the headline is the first sentence that says something.
            let body = sentences.drop { Self.isGreeting($0) }
            guard let first = body.first ?? sentences.first else { return nil }
            self.kind = kind
            headline = first
            var rest = ""
            for s in (body.isEmpty ? sentences.dropFirst() : body.dropFirst()) {
                let next = rest.isEmpty ? s : rest + " " + s
                if next.count > 240 { break }
                rest = next
            }
            self.rest = rest
        }

        static func sentences(_ text: String) -> [String] {
            let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !t.isEmpty else { return [] }
            var out: [String] = []
            var current = ""
            let chars = Array(t)
            for (i, c) in chars.enumerated() {
                current.append(c)
                guard ".!?".contains(c) else { continue }
                let next = i + 1 < chars.count ? chars[i + 1] : nil
                // a sentence ends at punctuation followed by space and an upper-case letter or digit ("3.5" and "e.g. x" do not end one)
                if next == nil || (next!.isWhitespace && i + 2 < chars.count && (chars[i + 2].isUppercase || chars[i + 2].isNumber || "“\"".contains(chars[i + 2]))) {
                    out.append(current.trimmingCharacters(in: .whitespaces)); current = ""
                }
            }
            let tail = current.trimmingCharacters(in: .whitespacesAndNewlines)
            if !tail.isEmpty { out.append(tail) }
            return out
        }

        static func isGreeting(_ s: String) -> Bool {
            let l = s.lowercased()
            return ["good morning", "good afternoon", "good evening", "hello", "hi,", "hi "].contains { l.hasPrefix($0) } && s.count < 60
        }
    }

    /// Latest morning/evening brief (per-skill briefs are stored under other keys), and only if it is recent.
    private func latestBrief(now: Date) -> LatestBrief? {
        let all = briefs ?? [:]
        let preferred = all.filter { ["morning", "evening"].contains($0.key) }
        var best: (at: Date, kind: String, text: String)?
        for (kind, state) in (preferred.isEmpty ? all : preferred) {
            guard let text = state.text, !text.isEmpty else { continue }
            let at = state.at.flatMap(Self.parseDate) ?? .distantPast
            if now.timeIntervalSince(at) > Self.briefFreshness { continue }
            if best == nil || at > best!.at { best = (at, kind, text) }
        }
        return best.flatMap { LatestBrief(kind: $0.kind, text: $0.text) }
    }

    /// Hub text goes on a TV: drop file paths and secret/env names, and cap the length.
    static func sanitise(_ text: String) -> String {
        var s = text
        for pattern in [#"(~|/[A-Za-z0-9._-]+)(/[A-Za-z0-9._ -]+)+"#, #"\bKITT_[A-Z0-9_]+\b"#, #"\b[A-Za-z0-9_-]{32,}\b"#] {
            s = s.replacingOccurrences(of: pattern, with: "…", options: .regularExpression)
        }
        s = s.trimmingCharacters(in: .whitespacesAndNewlines)
        return s.count > 90 ? String(s.prefix(90)).trimmingCharacters(in: .whitespaces) + "…" : s
    }

    private static func symbol(for id: String) -> String {
        switch id {
        case "security": return "shield"
        case "chief": return "checklist"
        case "money": return "banknote"
        case "receptionist": return "envelope"
        case "whatsapp": return "bubble.left"
        default: return "square.grid.2x2"
        }
    }

    /// The hub sends ISO-8601 (`now`, brief times) and SQLite UTC timestamps ("2026-10-29 08:05:00", pending times).
    static func parseDate(_ text: String) -> Date? {
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = withFraction.date(from: text) ?? ISO8601DateFormatter().date(from: text) { return d }
        let sqlite = DateFormatter()
        sqlite.locale = Locale(identifier: "en_US_POSIX")
        sqlite.timeZone = TimeZone(identifier: "UTC")
        sqlite.dateFormat = "yyyy-MM-dd HH:mm:ss"
        return sqlite.date(from: text)
    }
}

extension StatusLevel {
    /// Short word for the status chip.
    public var chipWord: String {
        switch self {
        case .critical: return "Critical"
        case .amber: return "Needs attention"
        case .green: return "All systems nominal"
        }
    }
}

extension SkillState {
    /// Not ok, or failed to load.
    var isUnhealthy: Bool { ok == false || unavailable == true }
}
