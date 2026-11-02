import SwiftUI
import KITTKit

/// Design System v2 "Scanner Grid" for the iPhone, iPad and Mac app: void-black surfaces, cockpit panels with a cyan hairline, LED-style figures,
/// and the animated scanner bar + KITT name whose colour and speed follow the status level (critical red/blue/white, amber blue/white, green blue).
/// The tokens and the animated pieces are shared with the Apple TV app (TvShared).

struct AppHeader: View {
    let level: StatusLevel
    var subtitle: String

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 14) {
                KittMark(size: 44)
                VStack(alignment: .leading, spacing: 4) {
                    KittName(level: level, size: 24)
                    Text(subtitle.uppercased()).font(Tv.mono(11, .medium)).tracking(1.6).foregroundStyle(Tv.fog)
                }
                Spacer()
            }
            ScannerBar(level: level)
        }
    }
}

/// A cockpit panel: dark surface, one cyan hairline on top.
struct CockpitPanel: ViewModifier {
    var accent: Color = Tv.cyan
    func body(content: Content) -> some View {
        content
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Tv.cockpit)
            .overlay(alignment: .top) { Rectangle().fill(accent.opacity(0.45)).frame(height: 1) }
    }
}

extension View {
    func cockpitPanel(accent: Color = Tv.cyan) -> some View { modifier(CockpitPanel(accent: accent)) }

    /// The app is dark by design.
    func scannerGridSurface() -> some View {
        self.preferredColorScheme(.dark).tint(Tv.cyan).background(Tv.void)
    }
}
