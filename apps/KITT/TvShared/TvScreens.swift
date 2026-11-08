import SwiftUI
import KITTKit

// The Apple TV screens in Design System v2 "Scanner Grid" (mockups/#/appletv). Each screen is plain SwiftUI with its actions injected,
// so the same views run in the tvOS app and in the macOS preview tool. 1920 x 1080 tvOS points, 90 pt side and 60 pt top safe areas.

// MARK: shared pieces

struct PanelButtonStyle: ButtonStyle {
    let id: String
    var lift: CGFloat = 1.04
    var ring: Color = Tv.cyan

    func makeBody(configuration: Configuration) -> some View {
        Inner(configuration: configuration, id: id, lift: lift, ring: ring)
    }

    private struct Inner: View {
        let configuration: ButtonStyleConfiguration
        let id: String
        let lift: CGFloat
        let ring: Color
        @Environment(\.isFocused) private var isFocused
        @Environment(\.tvPreviewFocus) private var forced

        var body: some View {
            let focused = isFocused || forced == id
            configuration.label
                .scaleEffect(focused ? lift : 1)
                .shadow(color: focused ? Tv.cyan.opacity(0.28) : .clear, radius: focused ? 40 : 0)
                .overlay(Rectangle().strokeBorder(focused ? ring : .clear, lineWidth: 4).scaleEffect(focused ? lift : 1))
                .animation(.easeOut(duration: 0.15), value: focused)
        }
    }
}

private struct Chip: View {
    let text: String
    var tint: Color = Tv.cyan
    var textColor: Color = Tv.ice
    var body: some View {
        HStack(spacing: 14) {
            Rectangle().fill(tint).frame(width: 12, height: 12).shadow(color: tint.opacity(0.4), radius: 8)
            Text(text.uppercased()).font(Tv.mono(24, .medium)).tracking(2.4).foregroundStyle(textColor)
        }
        .padding(.horizontal, 24).padding(.vertical, 12)
        .overlay(Rectangle().strokeBorder(tint.opacity(0.5), lineWidth: 1))
    }
}

private struct KeyHint: View {
    let key: String
    let label: String
    var body: some View {
        HStack(spacing: 8) {
            Text(key.uppercased()).font(Tv.mono(22, .semibold)).tracking(1.3).foregroundStyle(Tv.ice)
                .padding(.horizontal, 12).padding(.vertical, 4).overlay(Rectangle().strokeBorder(Tv.fog, lineWidth: 1))
            Text(label).font(Tv.sys(25)).foregroundStyle(Tv.fog)
        }
    }
}

private func timeString(_ date: Date) -> String {
    let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.dateFormat = "HH:mm"; return f.string(from: date)
}

private func dateString(_ date: Date) -> String {
    let f = DateFormatter(); f.locale = Locale(identifier: "en_GB"); f.dateFormat = "EEE d MMM"; return f.string(from: date).uppercased()
}

/// Which clock a screen shows: none, the live one (it updates itself every minute, in its own small view, so the screen above it is never rebuilt
/// by a clock tick: a rebuilt screen could close a presented sheet), or a fixed time (the Mac preview tool).
enum TvClock {
    case none
    case live
    case fixed(Date)
}

struct ClockBlock: View {
    let clock: TvClock

    var body: some View {
        switch clock {
        case .none: EmptyView()
        case .fixed(let d): block(d)
        case .live: TimelineView(.everyMinute) { block($0.date) }
        }
    }

    private func block(_ date: Date) -> some View {
        VStack(alignment: .trailing, spacing: 4) {
            Text(timeString(date)).font(Tv.mono(104, .semibold)).monospacedDigit().tracking(-3).foregroundStyle(Tv.ice)
            Text(dateString(date)).font(Tv.sys(26, .medium)).tracking(3).foregroundStyle(Tv.fog)
        }
    }
}

/// Brand row (mark + animated name) with the clock on the right, then the animated top border.
struct TvHeader: View {
    let level: StatusLevel
    var clock: TvClock = .none

    var body: some View {
        VStack(spacing: 26) {
            HStack(alignment: .center) {
                HStack(spacing: 24) { KittMark(size: 72); KittName(level: level) }
                Spacer()
                ClockBlock(clock: clock)
            }
            ScannerBar(level: level)
        }
    }
}

private struct Backdrop<Content: View>: View {
    var grid = true
    @ViewBuilder var content: Content
    var body: some View {
        ZStack(alignment: .topLeading) {
            Tv.void
            if grid { GridFloor() }
            content.padding(.horizontal, 90).padding(.vertical, 60)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .foregroundStyle(Tv.ice)
        .ignoresSafeArea()
    }
}

// MARK: Now

struct SkillTile: View {
    let tile: GlanceTile
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 14) {
                Image(systemName: tile.symbol).font(.system(size: 28))
                Text(tile.name.uppercased()).font(Tv.sys(22, .medium)).tracking(3.5).lineLimit(1)
            }
            .foregroundStyle(Tv.fog)
            Spacer(minLength: 0)
            Text(tile.value).font(Tv.mono(72, .semibold)).monospacedDigit()
                .foregroundStyle(tile.needsAttention ? Tv.cyan : Tv.ice)
                .shadow(color: tile.needsAttention ? Tv.cyan.opacity(0.4) : .clear, radius: 18)
            Spacer(minLength: 0)
            Text(tile.detail).font(Tv.sys(23)).foregroundStyle(Tv.fog).lineLimit(2).multilineTextAlignment(.leading)
        }
        .padding(.horizontal, 28).padding(.vertical, 26)
        .frame(width: 322, height: 304, alignment: .topLeading)
        .background(Tv.cockpit)
        .overlay(alignment: .top) { Rectangle().fill(Tv.cyan.opacity(0.4)).frame(height: 1) }
        .shadow(color: Tv.cyan.opacity(0.08), radius: 24)
    }
}

struct NowScreen: View {
    let glance: Glance
    var clock: TvClock = .live
    var offline = false
    var lastUpdated: Date? = nil
    var speaking = false
    var onOpen: (GlanceTile) -> Void = { _ in }
    var onReview: () -> Void = {}

    @FocusState private var focus: String?

    /// Long headlines (a whole sentence of the brief) step down so the headline stays on one or two lines above the tiles.
    private static func headlineSize(_ text: String) -> CGFloat {
        text.count <= 30 ? 88 : (text.count <= 48 ? 66 : 54)
    }

    var body: some View {
        Backdrop {
            VStack(alignment: .leading, spacing: 0) {
                TvHeader(level: glance.level, clock: clock)
                if offline {
                    HStack(spacing: 18) {
                        Image(systemName: "wifi.slash").font(.system(size: 34))
                        Text("Hub unreachable" + (lastUpdated.map { " since \(timeString($0))" } ?? "") + ". Showing the cached copy.").font(Tv.sys(30))
                    }
                    .foregroundStyle(Tv.signal)
                    .padding(.horizontal, 28).padding(.vertical, 20)
                    .overlay(Rectangle().strokeBorder(Tv.signal, lineWidth: 2))
                    .padding(.top, 24)
                }
                VStack(alignment: .leading, spacing: 0) {
                    Text((speaking ? "Reading the brief…" : glance.eyebrow).uppercased()).font(Tv.mono(26, .medium)).tracking(4.7).foregroundStyle(Tv.fog)
                    Text(glance.headline).font(Tv.sys(Self.headlineSize(glance.headline), .semibold)).tracking(-1.3).lineLimit(2).minimumScaleFactor(0.7)
                        .padding(.top, 20).padding(.bottom, 14)
                    if !glance.sub.isEmpty {
                        Text(glance.sub).font(Tv.sys(40)).foregroundStyle(Tv.fog).lineSpacing(6).lineLimit(3)
                    }
                    if glance.hasPending {
                        Button(action: onReview) {
                            HStack(spacing: 18) { Image(systemName: "checkmark").font(.system(size: 34, weight: .semibold)); Text("Review and decide").font(Tv.sys(36, .semibold)) }
                                .foregroundStyle(Tv.void).padding(.horizontal, 44).frame(height: 96).background(Tv.cyan)
                        }
                        .buttonStyle(PanelButtonStyle(id: "review", lift: 1.06, ring: Tv.ice))
                        .focused($focus, equals: "review")
                        .padding(.top, 36)
                    }
                }
                .frame(maxWidth: 1560, maxHeight: .infinity, alignment: .leading)

                HStack(spacing: 30) {
                    ForEach(glance.tiles) { tile in
                        Button { onOpen(tile) } label: { SkillTile(tile: tile) }
                            .buttonStyle(PanelButtonStyle(id: tile.id))
                            .focused($focus, equals: tile.id)
                            .accessibilityLabel("\(tile.name), \(tile.value). \(tile.detail)")
                    }
                }
                .padding(.bottom, 40)

                HStack {
                    HStack(spacing: 18) {
                        Chip(text: glance.chip, tint: glance.level == .critical ? Tv.red : Tv.cyan, textColor: glance.level == .critical ? Tv.signal : Tv.ice)
                        if let c = glance.coverage { Chip(text: c, tint: Tv.fog, textColor: Tv.fog) }
                    }
                    Spacer()
                    HStack(spacing: 22) { KeyHint(key: "Select", label: "open"); KeyHint(key: "Play/Pause", label: "hear the brief") }
                }
            }
        }
        .defaultFocus($focus, glance.hasPending ? "review" : (glance.tiles.first?.id ?? ""))
        // The system's default focus alone is not reliable when the content arrives after launch (the hub answers a moment later), so ask for it.
        .onAppear { focus = glance.hasPending ? "review" : (glance.tiles.first?.id) }
        .onChange(of: glance.pendingCode) { _, new in if new != nil { focus = "review" } }
        .onChange(of: glance.tiles.first?.id) { _, new in if !glance.hasPending, focus == nil { focus = new } }
    }
}

// MARK: tile detail

struct DetailScreen: View {
    let tile: GlanceTile
    let level: StatusLevel
    var clock: TvClock = .live

    var body: some View {
        Backdrop(grid: false) {
            VStack(alignment: .leading, spacing: 0) {
                TvHeader(level: level, clock: clock)
                VStack(alignment: .leading, spacing: 24) {
                    Text(tile.name.uppercased()).font(Tv.mono(26, .medium)).tracking(4.7).foregroundStyle(Tv.fog)
                    Text(tile.value).font(Tv.mono(200, .semibold)).monospacedDigit().foregroundStyle(tile.needsAttention ? Tv.cyan : Tv.ice)
                    Text(tile.detail.isEmpty ? "No details from the hub." : tile.detail).font(Tv.sys(46)).foregroundStyle(Tv.fog).lineSpacing(8).lineLimit(4)
                }
                .padding(.horizontal, 70)
                .frame(maxWidth: 1560, maxHeight: .infinity, alignment: .leading)
                HStack { Spacer(); KeyHint(key: "Menu", label: "back") }
            }
        }
    }
}

// MARK: Needs your decision

struct AskScreen: View {
    let summary: String
    var expiresAt: Date? = nil
    var clock: TvClock = .live
    /// The live status level, so a critical hub with a decision waiting still reads critical.
    var level: StatusLevel = .amber
    var outcome: String? = nil
    var onConfirm: () -> Void = {}
    var onCancel: () -> Void = {}
    var onDone: () -> Void = {}

    @FocusState private var focus: String?

    var body: some View {
        Backdrop {
            VStack(spacing: 0) {
                HStack(alignment: .center) {
                    HStack(spacing: 24) { KittMark(size: 72); KittName(level: level) }
                    Spacer()
                    ClockBlock(clock: clock)
                }
                Spacer(minLength: 0)
                VStack(alignment: .leading, spacing: 0) {
                    ScannerBar(level: level).padding(.bottom, 56)
                    VStack(alignment: .leading, spacing: 0) {
                        HStack(spacing: 16) {
                            Image(systemName: "exclamationmark.triangle").font(.system(size: 32))
                            if let expiresAt { TimelineView(.periodic(from: .now, by: 1)) { ctx in Text(eyebrow(expiresAt, now: ctx.date)) } } else { Text("Needs your decision") }
                        }
                        .font(Tv.mono(28, .medium)).tracking(4.5).textCase(.uppercase).foregroundStyle(Tv.signal)
                        Text(summary).font(Tv.sys(74, .semibold)).tracking(-1.1).lineLimit(3).minimumScaleFactor(0.7).padding(.top, 24)
                        Text(outcome ?? "Nothing happens until you confirm.").font(Tv.sys(38)).foregroundStyle(outcome == nil ? Tv.fog : Tv.cyan)
                            .padding(.top, 22).padding(.bottom, 46)
                        if outcome == nil {
                            HStack(spacing: 32) {
                                Button(action: onConfirm) {
                                    HStack(spacing: 22) { Image(systemName: "checkmark").font(.system(size: 40, weight: .semibold)); Text("Confirm").font(Tv.sys(44, .semibold)) }
                                        .foregroundStyle(Tv.void).frame(width: 420, height: 128).background(Tv.cyan)
                                }
                                .buttonStyle(PanelButtonStyle(id: "confirm", lift: 1.06, ring: Tv.ice)).focused($focus, equals: "confirm")
                                Button(action: onCancel) {
                                    Text("Cancel").font(Tv.sys(44, .semibold)).foregroundStyle(Tv.ice).frame(width: 420, height: 128)
                                        .overlay(Rectangle().strokeBorder(Tv.fog, lineWidth: 2))
                                }
                                .buttonStyle(PanelButtonStyle(id: "cancel", lift: 1.06, ring: Tv.ice)).focused($focus, equals: "cancel")
                            }
                        } else {
                            Button(action: onDone) {
                                Text("Done").font(Tv.sys(44, .semibold)).foregroundStyle(Tv.void).frame(width: 420, height: 128).background(Tv.cyan)
                            }
                            .buttonStyle(PanelButtonStyle(id: "done", lift: 1.06, ring: Tv.ice)).focused($focus, equals: "done")
                        }
                    }
                    .padding(.horizontal, 80).padding(.bottom, 64)
                }
                .frame(width: 1620)
                .background(Tv.cockpit)
                .shadow(color: Tv.cyan.opacity(0.10), radius: 40)
                Spacer(minLength: 0)
            }
        }
        // Cancel is focused first: a stray Select on the remote must never commit an action. After an outcome, Done is the only control.
        .defaultFocus($focus, outcome == nil ? "cancel" : "done")
        .onChange(of: outcome) { _, new in if new != nil { focus = "done" } }
        .accessibilityElement(children: .contain)
    }

    private func eyebrow(_ expiresAt: Date, now: Date) -> String {
        let left = max(0, Int(expiresAt.timeIntervalSince(now)))
        return "Needs your decision · expires in \(left / 60):" + String(format: "%02d", left % 60)
    }
}

// MARK: Connect

private struct FieldBox: View {
    let title: String
    @Binding var text: String
    var secure = false
    var placeholder = ""
    @Environment(\.tvStaticFields) private var staticFields

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title.uppercased()).font(Tv.mono(24, .medium)).tracking(4).foregroundStyle(Tv.fog)
            if staticFields {
                Text(text.isEmpty ? placeholder : (secure ? String(repeating: "•", count: text.count) : text))
                    .font(Tv.sys(34)).foregroundStyle(text.isEmpty ? Tv.fog : Tv.ice).frame(maxWidth: .infinity, minHeight: 90, alignment: .leading)
                    .padding(.horizontal, 24).background(Tv.panel)
            } else if secure {
                SecureField(placeholder, text: $text).font(Tv.sys(34))
            } else {
                TextField(placeholder, text: $text).font(Tv.sys(34))
            }
        }
    }
}

struct ConnectScreen: View {
    @Binding var address: String
    @Binding var token: String
    var error: String? = nil
    var busy = false
    var onConnect: () -> Void = {}

    @FocusState private var focus: String?

    var body: some View {
        Backdrop {
            VStack(alignment: .leading, spacing: 0) {
                TvHeader(level: error == nil ? .green : .amber)
                HStack(alignment: .center, spacing: 110) {
                    VStack(alignment: .leading, spacing: 0) {
                        Text("CONNECT THIS APPLE TV").font(Tv.mono(26, .medium)).tracking(4.7).foregroundStyle(Tv.fog)
                        Text("Connect to your KITT hub").font(Tv.sys(76, .semibold)).tracking(-1.1).padding(.top, 20).padding(.bottom, 42)
                        VStack(alignment: .leading, spacing: 24) {
                            step("1", "Select a field. A nearby iPhone offers its keyboard.")
                            step("2", "Enter the hub address and the app token.")
                            step("3", "Select Connect.")
                        }
                        .padding(.bottom, 44)
                        Text("Use an https:// address (for example your Tailscale name), or the Mac's http:// Tailscale address. The token is the Kitt app token from the hub.")
                            .font(Tv.sys(29)).foregroundStyle(Tv.fog).lineSpacing(6)
                    }
                    .frame(maxWidth: 880, alignment: .leading)
                    VStack(alignment: .leading, spacing: 30) {
                        FieldBox(title: "Hub address", text: $address, placeholder: "https://kitt.example.ts.net").focused($focus, equals: "address")
                        FieldBox(title: "App token", text: $token, secure: true, placeholder: "Paste the token").focused($focus, equals: "token")
                        Button(action: onConnect) {
                            Text(busy ? "Connecting…" : "Connect").font(Tv.sys(40, .semibold)).foregroundStyle(Tv.void)
                                .frame(maxWidth: .infinity, minHeight: 110).background(Tv.cyan)
                        }
                        .buttonStyle(PanelButtonStyle(id: "connect", lift: 1.04, ring: Tv.ice)).focused($focus, equals: "connect")
                        if let error {
                            HStack(spacing: 14) { Image(systemName: "exclamationmark.triangle"); Text(error).font(Tv.sys(29)) }.foregroundStyle(Tv.signal)
                        }
                    }
                    .frame(width: 780)
                }
                .frame(maxHeight: .infinity)
            }
        }
        .defaultFocus($focus, "address")
    }

    private func step(_ n: String, _ text: String) -> some View {
        HStack(spacing: 26) {
            Text(n).font(Tv.mono(32, .semibold)).foregroundStyle(Tv.cyan).frame(width: 60, height: 60).overlay(Rectangle().strokeBorder(Tv.cyan, lineWidth: 1))
            Text(text).font(Tv.sys(40))
        }
    }
}
