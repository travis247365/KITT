import AppIntents
import KITTKit

/// What Siri can do with Kitt, in the car and anywhere else. App Shortcuts need no entitlement: every phrase has to name the app
/// ("Kitt", or "Kit" through INAlternativeAppNames), which is why the open-ended question is a second turn.

enum BriefChoice: String, AppEnum {
    case latest, morning, evening

    static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "Brief")
    static let caseDisplayRepresentations: [BriefChoice: DisplayRepresentation] = [
        .latest: DisplayRepresentation(title: "latest brief"),
        .morning: DisplayRepresentation(title: "morning brief"),
        .evening: DisplayRepresentation(title: "evening recap")
    ]
}

/// "Hey Siri, play my brief in Kitt": plays the newest brief on this phone, streaming from the hub only if it is not here yet.
struct PlayBriefIntent: AudioPlaybackIntent {
    static let title: LocalizedStringResource = "Play a brief"
    static let description = IntentDescription("Plays the newest brief Kitt has on this phone, in the car or anywhere.")

    @Parameter(title: "Which brief", default: .latest) var choice: BriefChoice

    static var parameterSummary: some ParameterSummary { Summary("Play the \(\.$choice)") }

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let store = BriefStore.standard
        let episodes = store.episodes()
        let pick: Episode? = switch choice {
        case .latest: episodes.first
        case .morning: episodes.first { !$0.isEvening }
        case .evening: episodes.first { $0.isEvening }
        }
        guard let episode = pick else {
            return .result(dialog: "There is no brief on this phone yet. Open Kitt once while it can reach the hub to download them.")
        }
        let title = episode.isEvening ? "Evening recap" : "Morning brief"
        guard let source = await HubAccess.source(for: episode, store: store) else {
            return .result(dialog: "That brief is not on this phone and the hub is not reachable.")
        }
        CarPlayer.shared.play(episode, title: title, source: source)
        return .result(dialog: IntentDialog("Playing your \(title.lowercased()).") )
    }
}

/// "Hey Siri, ask Kitt" then the question: the hub answers and Siri reads it out.
struct AskKittIntent: AppIntent {
    static let title: LocalizedStringResource = "Ask Kitt"
    static let description = IntentDescription("Asks the hub a question or gives it a command, and speaks the answer.")

    @Parameter(title: "Question", requestValueDialog: "What do you want to ask Kitt?") var question: String

    static var parameterSummary: some ParameterSummary { Summary("Ask Kitt \(\.$question)") }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        .result(dialog: await KittSiri.reply { try await $0.ask(question) })
    }
}

struct WhatsOnMyPlateIntent: AppIntent {
    static let title: LocalizedStringResource = "What's on my plate"
    static let description = IntentDescription("Kitt reads what is waiting on you today.")

    func perform() async throws -> some IntentResult & ProvidesDialog {
        .result(dialog: await KittSiri.reply { try await $0.ask("what's on my plate") })
    }
}

struct ConfirmWithKittIntent: AppIntent {
    static let title: LocalizedStringResource = "Confirm with Kitt"
    static let description = IntentDescription("Confirms the action the hub is waiting on.")

    func perform() async throws -> some IntentResult & ProvidesDialog {
        .result(dialog: await KittSiri.reply { try await $0.confirm() })
    }
}

struct CancelWithKittIntent: AppIntent {
    static let title: LocalizedStringResource = "Cancel with Kitt"
    static let description = IntentDescription("Cancels the action the hub is waiting on.")

    func perform() async throws -> some IntentResult & ProvidesDialog {
        .result(dialog: await KittSiri.reply { try await $0.cancel() })
    }
}

enum KittSiri {
    /// Runs one hub call for Siri and turns the outcome into something short to say.
    static func reply(_ call: @Sendable (HubClient) async throws -> KITTReply) async -> IntentDialog {
        guard let client = HubAccess.makeClient(source: "siri") else {
            return IntentDialog("Kitt is not connected to the hub yet. Open the app and connect it first.")
        }
        do {
            let reply = try await call(client)
            return IntentDialog("\(reply.speak)")
        } catch {
            return IntentDialog("\(HubAccess.spoken(error))")
        }
    }
}

struct KittShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: PlayBriefIntent(),
            phrases: [
                "Play my brief in \(.applicationName)",
                "Play the latest brief in \(.applicationName)",
                "Play my \(\.$choice) in \(.applicationName)",
                "\(.applicationName), play my brief",
                "Play my \(.applicationName) brief"
            ],
            shortTitle: "Play brief",
            systemImageName: "waveform"
        )
        AppShortcut(
            intent: AskKittIntent(),
            phrases: [
                "Ask \(.applicationName)",
                "Ask \(.applicationName) something",
                "Talk to \(.applicationName)"
            ],
            shortTitle: "Ask Kitt",
            systemImageName: "mic"
        )
        AppShortcut(
            intent: WhatsOnMyPlateIntent(),
            phrases: [
                "Ask \(.applicationName) what's on my plate",
                "What's on my plate in \(.applicationName)",
                "\(.applicationName), what's on my plate"
            ],
            shortTitle: "What's on my plate",
            systemImageName: "list.bullet"
        )
        AppShortcut(
            intent: ConfirmWithKittIntent(),
            phrases: [
                "Confirm with \(.applicationName)",
                "Tell \(.applicationName) to confirm",
                "\(.applicationName), confirm"
            ],
            shortTitle: "Confirm",
            systemImageName: "checkmark.circle"
        )
        AppShortcut(
            intent: CancelWithKittIntent(),
            phrases: [
                "Cancel with \(.applicationName)",
                "Tell \(.applicationName) to cancel",
                "\(.applicationName), cancel"
            ],
            shortTitle: "Cancel",
            systemImageName: "xmark.circle"
        )
    }

    static let shortcutTileColor: ShortcutTileColor = .teal
}
