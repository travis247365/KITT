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


// MARK: layout pieces shared by every screen

/// Void background, faint grid floor, the animated header, then the screen's content: the same frame on Overview, Ask and Settings.
struct ScreenScaffold<Content: View>: View {
    /// On macOS the window content runs under the toolbar; keep the header clear of it.
    static var toolbarClearance: CGFloat {
        #if os(macOS)
        return 66
        #else
        return 0
        #endif
    }
    let level: StatusLevel
    let subtitle: String
    @ViewBuilder var content: Content

    var body: some View {
        ZStack(alignment: .topLeading) {
            Tv.void
            GridFloor(opacity: 0.07)
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    AppHeader(level: level, subtitle: subtitle)
                    content
                }
                .padding(24)
                .padding(.top, Self.toolbarClearance)
                .frame(maxWidth: 1050, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
        }
    }
}

/// A small caps mono title over a block of content.
struct PanelSection<Content: View>: View {
    let title: String
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title.uppercased()).font(Tv.mono(12, .medium)).tracking(1.8).foregroundStyle(Tv.fog)
            content
        }
    }
}

/// A labelled input on a panel with a cyan hairline.
struct LabeledPanel<Content: View>: View {
    let label: String
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label.uppercased()).font(Tv.mono(11, .medium)).tracking(1.4).foregroundStyle(Tv.fog)
            content
                .textFieldStyle(.plain)
                .font(Tv.sys(16))
                .padding(.horizontal, 12).padding(.vertical, 11)
                .background(Tv.panel)
                .overlay(Rectangle().strokeBorder(Tv.cyan.opacity(0.28), lineWidth: 1))
        }
    }
}

/// Primary action: a full-width cyan bar.
struct CyanButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View { BarLabel(configuration: configuration) }
    private struct BarLabel: View {
        let configuration: ButtonStyleConfiguration
        @Environment(\.isEnabled) private var enabled
        var body: some View {
            configuration.label
                .font(.headline)
                .foregroundStyle(Color.black)
                .frame(maxWidth: .infinity, minHeight: 46)
                .background(Tv.cyan.opacity(enabled ? (configuration.isPressed ? 0.7 : 1) : 0.28))
                .contentShape(Rectangle())
        }
    }
}

/// Secondary action: an outline.
struct GhostButtonStyle: ButtonStyle {
    var danger = false
    func makeBody(configuration: Configuration) -> some View { OutlineLabel(configuration: configuration, danger: danger) }
    private struct OutlineLabel: View {
        let configuration: ButtonStyleConfiguration
        let danger: Bool
        @Environment(\.isEnabled) private var enabled
        var body: some View {
            configuration.label
                .font(.headline)
                .foregroundStyle(danger ? Tv.signal : Tv.ice)
                .frame(maxWidth: .infinity, minHeight: 46)
                .overlay(Rectangle().strokeBorder(danger ? Tv.signal : Tv.fog, lineWidth: 1.5))
                .opacity(enabled ? (configuration.isPressed ? 0.7 : 1) : 0.4)
                .contentShape(Rectangle())
        }
    }
}

struct SidebarHeader: View {
    let level: StatusLevel
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) { KittMark(size: 30); KittName(level: level, size: 16) }
            ScannerBar(level: level)
        }
        .padding(.horizontal, 14).padding(.vertical, 12)
        .background(Tv.cockpit)
    }
}

/// One waiting decision, with Confirm and Cancel (sends the code it shows, so the hub refuses a different request).
struct DecisionPanel: View {
    @EnvironmentObject private var model: AppModel
    let action: PendingAction

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("NEEDS YOUR DECISION", systemImage: "hand.raised").font(Tv.mono(11, .medium)).tracking(1.4).foregroundStyle(Tv.cyan)
            Text(action.summary).font(.headline).foregroundStyle(Tv.ice)
            Text("From \(action.source) · \(action.skill)").font(.subheadline).foregroundStyle(Tv.fog)
            HStack(spacing: 12) {
                Button("Confirm") { Task { await model.resolvePending(confirm: true, code: action.code) } }
                    .buttonStyle(CyanButtonStyle()).disabled(model.isBusy)
                Button("Cancel") { Task { await model.resolvePending(confirm: false, code: action.code) } }
                    .buttonStyle(GhostButtonStyle()).disabled(model.isBusy)
            }
            .frame(maxWidth: 360)
        }
        .cockpitPanel()
    }
}
