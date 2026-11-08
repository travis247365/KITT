#if os(iOS)
import ActivityKit
import Foundation

/// What the Lock Screen card and the Dynamic Island show. Compiled into the app (which starts and updates the activity) and the
/// KITTWidgets extension (which draws it); the two must agree, which is why it lives in `Shared/`.
struct KittActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        /// critical | amber | green, the same levels as the Apple TV board.
        var level: String
        /// "All systems nominal", "Needs attention", "Waiting for your OK".
        var eyebrow: String
        var headline: String
        var detail: String
        var playing: Bool
        var briefTitle: String?
    }

    /// The hub address, for the card's small print.
    var hub: String
}
#endif
