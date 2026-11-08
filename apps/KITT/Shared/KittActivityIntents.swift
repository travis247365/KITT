#if os(iOS)
import AppIntents
import Foundation

/// The Talk and Brief buttons on the Lock Screen card. Both run in the app's own process (that is what LiveActivityIntent and
/// AudioPlaybackIntent are for), so the app sets these hooks at launch and the widget extension only needs the types to compile.
@MainActor
enum KittHooks {
    static var talk: (@MainActor @Sendable () -> Void)?
    static var playLatest: (@MainActor @Sendable () async throws -> Void)?
}

enum KittLaunch {
    /// Set by the Talk button before the app is in front; the app reads and clears it when it becomes active.
    static let talkKey = "kitt.launch.talk"
}

/// Talk: opens the app listening (a locked phone asks for Face ID first, as it does for any app).
struct TalkToKittIntent: LiveActivityIntent {
    static let title: LocalizedStringResource = "Talk to Kitt"
    static let description = IntentDescription("Opens Kitt listening, so you can ask it something or give it a command.")
    static let openAppWhenRun = true

    func perform() async throws -> some IntentResult {
        UserDefaults.standard.set(true, forKey: KittLaunch.talkKey)
        await MainActor.run {
            if let talk = KittHooks.talk { UserDefaults.standard.removeObject(forKey: KittLaunch.talkKey); talk() }
        }
        return .result()
    }
}

/// Brief: plays the newest brief without opening the app, through the same player as Siri and CarPlay.
struct PlayLatestBriefIntent: AudioPlaybackIntent {
    static let title: LocalizedStringResource = "Play the latest brief"
    static let description = IntentDescription("Plays the newest brief Kitt has, on the lock screen or anywhere.")

    func perform() async throws -> some IntentResult {
        if let play = await MainActor.run(body: { KittHooks.playLatest }) { try await play() }
        return .result()
    }
}
#endif
