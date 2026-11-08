import ActivityKit
import AppIntents
import SwiftUI
import WidgetKit

/// Kitt on the Lock Screen and in the Dynamic Island, in the design of the mockups' Live Activity (design/DESIGN_SYSTEM_v2.md:
/// void black, cyan, square corners): the hub's headline, then Open · Talk · Brief where a music app has back · play · next.
@main
struct KittWidgets: WidgetBundle {
    var body: some Widget { KittLiveActivity() }
}

enum Palette {
    static let void = Color(red: 5 / 255, green: 5 / 255, blue: 7 / 255)
    static let cockpit = Color(red: 14 / 255, green: 17 / 255, blue: 22 / 255)
    static let ice = Color(red: 234 / 255, green: 246 / 255, blue: 1)
    static let fog = Color(red: 143 / 255, green: 163 / 255, blue: 184 / 255)
    static let cyan = Color(red: 25 / 255, green: 230 / 255, blue: 1)
    static let amber = Color(red: 1, green: 176 / 255, blue: 32 / 255)
    static let signal = Color(red: 1, green: 107 / 255, blue: 107 / 255)

    static func level(_ s: String) -> Color { s == "critical" ? signal : s == "amber" ? amber : cyan }
}

struct KittLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: KittActivityAttributes.self) { context in
            LockCard(state: context.state)
                .activityBackgroundTint(Palette.void)
                .activitySystemActionForegroundColor(Palette.cyan)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) { Wordmark(level: context.state.level).padding(.leading, 4) }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(context.state.eyebrow.uppercased()).font(.system(size: 10, weight: .medium, design: .monospaced)).tracking(1).foregroundStyle(Palette.fog).lineLimit(1)
                }
                DynamicIslandExpandedRegion(.center) {
                    Text(context.state.headline).font(.system(size: 15, weight: .medium)).foregroundStyle(Palette.ice).lineLimit(2).multilineTextAlignment(.center)
                }
                DynamicIslandExpandedRegion(.bottom) { Controls(playing: context.state.playing).padding(.top, 4) }
            } compactLeading: {
                KMark(level: context.state.level)
            } compactTrailing: {
                Image(systemName: context.state.playing ? "waveform" : "circle.fill")
                    .font(.system(size: context.state.playing ? 12 : 8))
                    .foregroundStyle(Palette.level(context.state.level))
            } minimal: {
                KMark(level: context.state.level)
            }
            .keylineTint(Palette.cyan)
        }
    }
}

/// The Lock Screen card.
struct LockCard: View {
    let state: KittActivityAttributes.ContentState

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                KMark(level: state.level)
                Text(state.eyebrow.uppercased()).font(.system(size: 11, weight: .medium, design: .monospaced)).tracking(1.2).foregroundStyle(Palette.fog).lineLimit(1)
                Spacer(minLength: 0)
                if state.playing, let title = state.briefTitle {
                    HStack(spacing: 5) { Image(systemName: "waveform").font(.system(size: 10)); Text(title).font(.system(size: 11, weight: .medium)) }.foregroundStyle(Palette.cyan).lineLimit(1)
                }
            }
            Text(state.headline).font(.system(size: 17, weight: .medium)).foregroundStyle(Palette.ice).lineLimit(2)
            if !state.detail.isEmpty {
                Text(state.detail).font(.system(size: 12)).foregroundStyle(Palette.fog).lineLimit(1)
            }
            Controls(playing: state.playing)
        }
        .padding(16)
    }
}

/// Open · Talk · Brief. Open is a link into the app; the other two run in the app without leaving the card.
struct Controls: View {
    let playing: Bool

    var body: some View {
        HStack(spacing: 8) {
            Link(destination: URL(string: "kitt://open")!) { Pill(symbol: "arrow.up.right.square", title: "Open") }
            Button(intent: TalkToKittIntent()) { Pill(symbol: "mic.fill", title: "Talk", primary: true) }
            Button(intent: PlayLatestBriefIntent()) { Pill(symbol: playing ? "waveform" : "play.fill", title: playing ? "Playing" : "Brief") }
        }
        .buttonStyle(.plain)
    }
}

struct Pill: View {
    let symbol: String
    let title: String
    var primary = false

    var body: some View {
        HStack(spacing: 7) {
            Image(systemName: symbol).font(.system(size: 13, weight: .semibold))
            Text(title).font(.system(size: 13, weight: .semibold))
        }
        .frame(maxWidth: .infinity, minHeight: 40)
        .foregroundStyle(primary ? Palette.void : Palette.ice)
        .background(primary ? Palette.cyan : Palette.cockpit)
        .overlay(Rectangle().stroke(primary ? Palette.cyan : Palette.ice.opacity(0.35), lineWidth: 2))
    }
}

struct Wordmark: View {
    let level: String
    var body: some View {
        Text("KITT").font(.system(size: 12, weight: .bold).width(.expanded)).tracking(2).foregroundStyle(Palette.level(level))
    }
}

struct KMark: View {
    let level: String
    var body: some View {
        Text("K").font(.system(size: 12, weight: .heavy).width(.expanded))
            .foregroundStyle(Palette.void)
            .frame(width: 18, height: 18)
            .background(Palette.level(level))
    }
}
