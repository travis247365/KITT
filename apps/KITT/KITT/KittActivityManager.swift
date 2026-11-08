#if os(iOS)
import ActivityKit
import Foundation
import KITTKit

/// The Lock Screen card (and Dynamic Island) that stays up while Kitt is connected: the hub's headline and status, with Open,
/// Talk and Brief buttons (drawn by the KITTWidgets extension). Started when the app comes to the front connected, updated on
/// every state refresh and player change, ended on disconnect. iOS keeps a Live Activity for at most 8 hours without a push,
/// so the next time the app is opened it starts a fresh one.
/// ActivityKit's Activity is not Sendable, but its update/end calls are async and run off the main actor; this carries one across.
private struct Unchecked<T>: @unchecked Sendable { let value: T }

@MainActor
final class KittActivityManager {
    static let shared = KittActivityManager()
    private var activity: Activity<KittActivityAttributes>?

    func sync(state: KITTState?, offline: Bool, playing: Bool, briefTitle: String?, hub: String) {
        guard ActivityAuthorizationInfo().areActivitiesEnabled, let state else { return }
        let g = state.glance(offline: offline)
        let content = KittActivityAttributes.ContentState(
            level: g.level.rawValue,
            eyebrow: g.hasPending ? "Waiting for your OK" : g.eyebrow,
            headline: g.hasPending ? (g.pendingSummary ?? g.headline) : g.headline,
            detail: g.sub,
            playing: playing,
            briefTitle: briefTitle
        )
        let stale = Date().addingTimeInterval(8 * 3600)
        if activity == nil { activity = Activity<KittActivityAttributes>.activities.first }
        if let activity {
            guard activity.content.state != content else { return }
            let boxed = Unchecked(value: activity)
            Task { await boxed.value.update(ActivityContent(state: content, staleDate: stale)) }
        } else {
            activity = try? Activity.request(attributes: KittActivityAttributes(hub: hub), content: ActivityContent(state: content, staleDate: stale), pushType: nil)
        }
    }

    func end() {
        activity = nil
        let boxed = Unchecked(value: Activity<KittActivityAttributes>.activities)
        guard !boxed.value.isEmpty else { return }
        Task { for running in boxed.value { await running.end(nil, dismissalPolicy: .immediate) } }
    }
}
#endif
