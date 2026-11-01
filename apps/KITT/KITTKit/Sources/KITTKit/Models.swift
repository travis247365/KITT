import Foundation

public struct KITTState: Decodable, Equatable, Sendable {
    public let version: String
    public let now: String?
    public let tz: String?
    public let brain: BrainState?
    public let pending: [PendingAction]?
    public let routines: [RoutineState]?
    public let skills: [String: SkillState]?
    public let briefs: [String: BriefState]?
    public let coverage: CoverageState?
    public let unavailable: [UnavailableSkill]?

    public init(
        version: String,
        now: String? = nil,
        tz: String? = nil,
        brain: BrainState? = nil,
        pending: [PendingAction]? = nil,
        routines: [RoutineState]? = nil,
        skills: [String: SkillState]? = nil,
        briefs: [String: BriefState]? = nil,
        coverage: CoverageState? = nil,
        unavailable: [UnavailableSkill]? = nil
    ) {
        self.version = version
        self.now = now
        self.tz = tz
        self.brain = brain
        self.pending = pending
        self.routines = routines
        self.skills = skills
        self.briefs = briefs
        self.coverage = coverage
        self.unavailable = unavailable
    }

    public var pendingActions: [PendingAction] { pending ?? [] }
    public var routineList: [RoutineState] { routines ?? [] }
    public var skillList: [String: SkillState] { skills ?? [:] }
    public var unavailableList: [UnavailableSkill] { unavailable ?? [] }
}

/// A generated brief ("morning", "evening"): when the hub made it and what it says.
public struct BriefState: Decodable, Equatable, Sendable {
    public let at: String?
    public let text: String?

    public init(at: String? = nil, text: String? = nil) {
        self.at = at
        self.text = text
    }
}

/// How much of the last days the hub was actually up (the Mac sleeps).
public struct CoverageState: Decodable, Equatable, Sendable {
    public let days: Int?
    public let uptimePct: Double?

    public init(days: Int? = nil, uptimePct: Double? = nil) {
        self.days = days
        self.uptimePct = uptimePct
    }
}

/// A skill that failed to load at hub start. Decoded leniently: an odd failure record must never stop the whole state from loading.
public struct UnavailableSkill: Decodable, Equatable, Sendable {
    public let id: String?
    public let error: String?

    public init(id: String? = nil, error: String? = nil) {
        self.id = id
        self.error = error
    }

    private enum Keys: String, CodingKey { case id, error }

    public init(from decoder: Decoder) throws {
        let container = try? decoder.container(keyedBy: Keys.self)
        id = (try? container?.decodeIfPresent(String.self, forKey: .id)) ?? nil
        error = (try? container?.decodeIfPresent(String.self, forKey: .error)) ?? nil
    }
}

public struct BrainState: Decodable, Equatable, Sendable {
    public let ok: Bool?
    public let provider: String?
    public let detail: String?

    public init(ok: Bool? = nil, provider: String? = nil, detail: String? = nil) {
        self.ok = ok
        self.provider = provider
        self.detail = detail
    }
}

public struct PendingAction: Decodable, Equatable, Sendable, Identifiable {
    public let code: String
    public let source: String
    public let skill: String
    public let summary: String
    public let createdAt: String?
    public let expiresAt: String?

    public var id: String { code }
}

public struct RoutineState: Decodable, Equatable, Sendable, Identifiable {
    public let name: String
    public let skill: String?
    public let lastRunAt: String?
    public let lastStatus: String?

    public var id: String { name }
}

public struct SkillState: Decodable, Equatable, Sendable, Identifiable {
    public let name: String
    public let description: String?
    public let ok: Bool?
    public let detail: String?
    public let unavailable: Bool?

    public var id: String { name }
}

public struct KITTReply: Decodable, Equatable, Sendable {
    public let speak: String
    public let needsConfirm: Bool?

    public init(speak: String, needsConfirm: Bool? = nil) {
        self.speak = speak
        self.needsConfirm = needsConfirm
    }
}
