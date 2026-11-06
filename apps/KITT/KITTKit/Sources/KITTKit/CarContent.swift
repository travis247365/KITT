import Foundation

/// A rendered brief (the hub's podcast episodes): the audio the CarPlay app plays.
public struct Episode: Codable, Equatable, Sendable, Identifiable {
    public let id: Int
    public let slug: String
    public let title: String
    public let file: String
    public let bytes: Int?
    public let durationS: Int?
    public let createdAt: String

    public var date: Date? { KITTState.parseDate(createdAt) }

    public var durationLabel: String {
        guard let s = durationS, s > 0 else { return "" }
        return "\(s / 60):" + String(format: "%02d", s % 60)
    }

    public var isEvening: Bool { slug == "evening" }
}

public struct EpisodesResponse: Codable, Equatable, Sendable {
    public let episodes: [Episode]
}

/// What the car screens say, worked out in one tested place. CarPlay draws Apple's templates, so this is only text (and what to say to Siri).
public enum CarContent {
    public struct Row: Equatable, Sendable, Identifiable {
        public let id: String
        public let title: String
        public let detail: String
    }

    /// Newest first, at most `limit`, with a title the driver can say ("Morning brief") and a detail line ("Today 08:06 · 0:47").
    public static func briefRows(_ episodes: [Episode], now: Date = Date(), calendar: Calendar = .current, limit: Int = 12) -> [Row] {
        let fmt = DateFormatter(); fmt.locale = Locale(identifier: "en_GB"); fmt.timeZone = calendar.timeZone; fmt.dateFormat = "EEE d MMM"
        let time = DateFormatter(); time.locale = Locale(identifier: "en_GB"); time.timeZone = calendar.timeZone; time.dateFormat = "HH:mm"
        return episodes.sorted { ($0.date ?? .distantPast) > ($1.date ?? .distantPast) }.prefix(limit).map { e in
            let day: String
            if let d = e.date {
                if calendar.isDate(d, inSameDayAs: now) { day = "Today" }
                else if let y = calendar.date(byAdding: .day, value: -1, to: now), calendar.isDate(d, inSameDayAs: y) { day = "Yesterday" }
                else { day = fmt.string(from: d) }
                return Row(id: String(e.id), title: e.isEvening ? "Evening recap" : "Morning brief",
                           detail: [day + " " + time.string(from: d), e.durationLabel].filter { !$0.isEmpty }.joined(separator: " · "))
            }
            return Row(id: String(e.id), title: e.isEvening ? "Evening recap" : "Morning brief", detail: e.durationLabel)
        }
    }

    /// The "Now" tab: one status line and what to say. Mirrors the CarPlay mockup's live-activity card (decisions are voice-only in the car).
    public static func now(_ state: KITTState?, offline: Bool, now: Date = Date()) -> (title: String, lines: [String]) {
        guard let state else { return ("Not connected", ["Open Kitt on your iPhone and connect to the hub."]) }
        let g = state.glance(offline: offline, now: now)
        if g.hasPending {
            return ("Waiting for your OK", [g.headline, "Say “Hey Siri, confirm with Kitt” or “cancel with Kitt”."])
        }
        switch g.level {
        case .critical:
            return ("Needs attention now", [g.headline, g.sub, "Say “Hey Siri, ask Kitt” then “security status”."].filter { !$0.isEmpty })
        case .amber:
            return (offline ? "Reading from the cached copy" : "Needs attention", [g.headline, g.sub].filter { !$0.isEmpty })
        case .green:
            return ("Nothing is waiting for you", ["Say “Hey Siri, play my brief in Kitt”."])
        }
    }

    /// The "Ask" tab: what the driver can say. CarPlay has no keyboard; Siri is the input. These are the app's own App Shortcuts
    /// (KittIntents.swift), so every phrase names the app; the open-ended question is a second turn.
    public static let siriPhrases: [Row] = [
        Row(id: "brief", title: "Play my brief", detail: "“Hey Siri, play my brief in Kitt” (or the morning brief, the evening recap)"),
        Row(id: "ask", title: "Ask anything", detail: "“Hey Siri, ask Kitt”, then say the question when asked"),
        Row(id: "plate", title: "What’s on my plate", detail: "“Hey Siri, ask Kitt what’s on my plate”"),
        Row(id: "confirm", title: "Confirm", detail: "“Hey Siri, confirm with Kitt”"),
        Row(id: "cancel", title: "Cancel", detail: "“Hey Siri, cancel with Kitt”"),
    ]
}
