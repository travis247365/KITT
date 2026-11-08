import SwiftUI
import KITTKit

private enum AppSection: String, CaseIterable, Identifiable, Hashable {
    case overview
    case feed
    case briefs
    case ask
    case settings

    var id: String { rawValue }
    var title: String {
        switch self {
        case .overview: "Overview"
        case .feed: "Feed"
        case .briefs: "Briefs"
        case .ask: "Ask Kitt"
        case .settings: "Settings"
        }
    }
    var symbol: String {
        switch self {
        case .overview: "rectangle.grid.1x2"
        case .feed: "list.bullet.rectangle"
        case .briefs: "play.circle"
        case .ask: "waveform"
        case .settings: "gearshape"
        }
    }

    /// The briefs player lives on the iPhone and iPad (it is the car's player); the Mac has the hub's feed instead.
    static var visible: [AppSection] {
        #if os(iOS)
        return allCases
        #else
        return allCases.filter { $0 != .briefs }
        #endif
    }
}

struct ContentView: View {
    @EnvironmentObject private var model: AppModel
    @State private var selection: AppSection? = {
        // review aid (see KITTApp.swift): open a given screen at launch
        AppSection(rawValue: ProcessInfo.processInfo.environment["KITT_DEV_SECTION"] ?? "") ?? .overview
    }()

    private var level: StatusLevel { model.state?.statusLevel(offline: model.isOffline) ?? .green }

    var body: some View {
        NavigationSplitView {
            List(AppSection.visible, selection: $selection) { section in
                Label(section.title, systemImage: section.symbol)
                    .font(Tv.sys(15, .medium))
                    .tag(section)
            }
            .scrollContentBackground(.hidden)
            .background(Tv.cockpit)
            .safeAreaInset(edge: .top, spacing: 0) { SidebarHeader(level: level) }
            .navigationTitle("KITT")
            .navigationSplitViewColumnWidth(min: 190, ideal: 220)
        } detail: {
            Group {
                switch selection ?? .overview {
                case .overview:
                    OverviewView(
                        openFeed: { filter in
                            model.feedFilter = filter
                            selection = .feed
                        },
                        openSettings: { selection = .settings }
                    )
                case .feed:
                    FeedView()
                case .briefs:
                    #if os(iOS)
                    BriefsView()
                    #else
                    EmptyView()
                    #endif
                case .ask:
                    AskView(openFeed: { filter in
                        model.feedFilter = filter
                        selection = .feed
                    })
                case .settings:
                    SettingsView()
                }
            }
            .background(Tv.void)
        }
        .task {
            if model.isConnected { await model.refresh() }
        }
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("com.tpcl.kitt.go"))) { note in
            if let raw = note.object as? String, let section = AppSection(rawValue: raw) { selection = section }
        }
    }
}

// MARK: Overview

private struct OverviewView: View {
    @EnvironmentObject private var model: AppModel
    /// Opens the Feed, already filtered (a card, a skill or a routine on this screen is a shortcut to its items in the feed).
    let openFeed: (FeedFilter) -> Void
    let openSettings: () -> Void

    private let columns = [GridItem(.adaptive(minimum: 200), spacing: 12)]

    var body: some View {
        ScreenScaffold(
            level: model.state?.statusLevel(offline: model.isOffline) ?? .green,
            subtitle: model.isConnected ? "Personal assistant" : "Not connected"
        ) {
            if let error = model.errorMessage {
                ErrorBanner(message: error)
            }
            if !model.isConnected {
                VStack(alignment: .leading, spacing: 14) {
                    Label("CONNECT KITT", systemImage: "point.3.connected.trianglepath.dotted")
                        .font(Tv.mono(12, .medium)).tracking(1.6).foregroundStyle(Tv.cyan)
                    Text("Add the hub address and the app token in Settings.").font(.title3).foregroundStyle(Tv.ice)
                    Button("Open Settings", action: openSettings).buttonStyle(CyanButtonStyle()).frame(maxWidth: 240)
                }
                .cockpitPanel()
            } else if let state = model.state {
                summaryCards(state)
                ForEach(state.pendingActions) { DecisionPanel(action: $0) }
                skillsSection(state.skillList)
                routinesSection(state.routineList)
            } else {
                HStack(spacing: 12) { ProgressView(); Text("Loading Kitt status…").foregroundStyle(Tv.fog) }
                    .frame(maxWidth: .infinity, minHeight: 120)
            }
        }
        .navigationTitle("Overview")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    Task { await model.refresh() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .disabled(model.isBusy || !model.isConnected)
                .accessibilityLabel("Refresh Kitt status")
            }
        }
    }

    private func summaryCards(_ state: KITTState) -> some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: 12) {
            Button { openFeed(FeedFilter()) } label: {
                SummaryCard(title: "Hub", value: "Online", detail: "Version \(state.version) · open the feed", symbol: "checkmark.circle.fill", highlight: false)
            }.buttonStyle(.plain)
            Button { openFeed(FeedFilter(kinds: [FeedKind.decision.rawValue])) } label: {
                SummaryCard(
                    title: "Decisions",
                    value: "\(state.pendingActions.count)",
                    detail: state.pendingActions.isEmpty ? "Nothing waits on you" : "Review before confirming",
                    symbol: "hand.raised.fill",
                    highlight: !state.pendingActions.isEmpty
                )
            }.buttonStyle(.plain)
            Button { openFeed(FeedFilter()) } label: {
                SummaryCard(
                    title: "Skills",
                    value: "\(state.skillList.count)",
                    detail: state.brain?.ok == false ? "Assistant brain needs attention" : "Available from your hub",
                    symbol: "square.grid.2x2.fill",
                    highlight: state.brain?.ok == false
                )
            }.buttonStyle(.plain)
        }
    }

    private func skillsSection(_ skills: [String: SkillState]) -> some View {
        PanelSection(title: "Skills") {
            VStack(spacing: 8) {
                ForEach(skills.keys.sorted(), id: \.self) { key in
                    if let skill = skills[key] {
                        Button { openFeed(FeedFilter(skills: [key])) } label: {
                            HStack(alignment: .top, spacing: 12) {
                                Image(systemName: skill.ok == true ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                                    .foregroundStyle(skill.ok == true ? Tv.cyan : Tv.signal)
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(skill.name).font(.headline).foregroundStyle(Tv.ice)
                                    if skill.ok != true, let detail = skill.detail, !detail.isEmpty {
                                        Text(detail).font(.caption).foregroundStyle(Tv.fog).lineLimit(2)
                                    }
                                }
                                Spacer()
                                Text(skill.ok == true ? "READY" : "ATTENTION")
                                    .font(Tv.mono(11, .semibold)).tracking(1.2)
                                    .foregroundStyle(skill.ok == true ? Tv.fog : Tv.cyan)
                                Image(systemName: "chevron.right").font(.caption).foregroundStyle(Tv.fog)
                            }
                            .cockpitPanel(accent: skill.ok == true ? Tv.cyan : Tv.signal)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    private func routinesSection(_ routines: [RoutineState]) -> some View {
        PanelSection(title: "Recent routines") {
            if routines.isEmpty {
                Text("No routines reported.").foregroundStyle(Tv.fog)
            } else {
                VStack(spacing: 6) {
                    ForEach(routines.prefix(8)) { routine in
                        Button { openFeed(FeedFilter(skills: routine.skill.map { [$0] } ?? [], kinds: [FeedKind.routine.rawValue], showNoise: true)) } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(routine.name).font(Tv.mono(13, .medium)).foregroundStyle(Tv.ice)
                                    Text(routine.lastRunAt ?? "Not run yet").font(.caption).foregroundStyle(Tv.fog)
                                }
                                Spacer()
                                Text((routine.lastStatus ?? "—").uppercased())
                                    .font(Tv.mono(11, .semibold)).tracking(1.2)
                                    .foregroundStyle(routine.lastStatus == "error" ? Tv.signal : Tv.fog)
                            }
                            .cockpitPanel()
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }
}

// MARK: Ask

/// The exact phrases from the approved mockup (mockups/src/engine.ts SUGGESTIONS) - real commands the grammar knows,
/// not placeholder copy.
private let askSuggestions = ["What's on my plate", "Cash position", "Anything past due", "Security status", "Log cash 200 fuel", "Idea: voice briefs for the car"]

private struct AskView: View {
    @EnvironmentObject private var model: AppModel
    @StateObject private var speech = SpeechInput()
    @State private var command = ""
    let openFeed: (FeedFilter) -> Void

    var body: some View {
        ScreenScaffold(level: model.state?.statusLevel(offline: model.isOffline) ?? .green, subtitle: "Ask Kitt") {
            PanelSection(title: "Ask Kitt") {
                VStack(alignment: .leading, spacing: 18) {
                    HStack(spacing: 20) {
                        SiriGlassButton(isListening: speech.isListening, isAvailable: speech.isAvailable) { speech.toggle() }
                        VStack(alignment: .leading, spacing: 5) {
                            Text(speech.isListening ? "Listening…" : "Talk to Kitt")
                                .font(Tv.sys(20, .semibold))
                                .foregroundStyle(speech.isListening ? Tv.cyan : Tv.ice)
                            if let denied = speech.deniedMessage {
                                Text(denied).font(Tv.mono(12)).foregroundStyle(Tv.signal)
                            } else {
                                Text(speech.isAvailable ? "Tap the mic and ask, the way you'd ask Siri." : "Voice isn't available on this device; type below instead.")
                                    .font(Tv.mono(12))
                                    .foregroundStyle(Tv.fog)
                            }
                        }
                        Spacer()
                    }
                    Rectangle().fill(Tv.cyan.opacity(0.18)).frame(height: 1)
                    VStack(alignment: .leading, spacing: 8) {
                        Text("TRY SAYING").font(Tv.mono(11, .medium)).tracking(1.4).foregroundStyle(Tv.fog)
                        FlowChips(items: askSuggestions) { phrase in command = phrase; send() }
                    }
                    LabeledPanel(label: "Or type a command or question") {
                        TextField("What's on my plate?", text: $command, axis: .vertical)
                            .lineLimit(2...5)
                            .submitLabel(.send)
                            .onSubmit { send() }
                    }
                    HStack(spacing: 14) {
                        Text("\(command.count)/2000").font(Tv.mono(12)).foregroundStyle(Tv.fog)
                        Spacer()
                        Button(action: send) {
                            if model.isBusy { ProgressView().controlSize(.small).tint(.black) } else { Label("Ask", systemImage: "arrow.up.circle.fill") }
                        }
                        .buttonStyle(CyanButtonStyle())
                        .frame(maxWidth: 180)
                        .disabled(command.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || command.count > 2_000 || model.isBusy || !model.isConnected)
                    }
                }
                .cockpitPanel()
            }
            if let reply = model.reply {
                PanelSection(title: "Kitt says") {
                    VStack(alignment: .leading, spacing: 12) {
                        Text(reply).foregroundStyle(Tv.ice).textSelection(.enabled)
                        if let answer = model.lastAnswer {
                            HStack(spacing: 10) {
                                Label(answer.ruleMatched ? "Matched by rule" : answer.via == "llm" ? "Answered by the language brain" : "No rule matched",
                                      systemImage: answer.ruleMatched ? "checkmark.seal.fill" : answer.via == "llm" ? "sparkles" : "questionmark.circle")
                                    .font(Tv.mono(11, .medium))
                                    .foregroundStyle(answer.ruleMatched ? Tv.cyan : answer.via == "llm" ? Tv.ice : Tv.fog)
                                Spacer()
                                Button("Speak aloud") { Speech.say(reply) }.buttonStyle(.plain).font(Tv.mono(12)).foregroundStyle(Tv.cyan)
                                if let skillID = answer.skillID, let skill = model.state?.skillList[skillID] {
                                    Button("Open \(skill.name)") { openFeed(FeedFilter(skills: [skillID])) }
                                        .buttonStyle(.plain).font(Tv.mono(12)).foregroundStyle(Tv.cyan)
                                }
                            }
                        }
                    }
                    .cockpitPanel()
                }
            }
            if let error = model.errorMessage {
                PanelSection(title: "Couldn’t complete that") {
                    Text(error).foregroundStyle(Tv.signal).cockpitPanel(accent: Tv.signal)
                }
            }
            if let pending = model.state?.pendingActions, !pending.isEmpty {
                PanelSection(title: "Confirmation required") {
                    ForEach(pending) { DecisionPanel(action: $0) }
                }
            }
        }
        .navigationTitle("Ask Kitt")
        .onChange(of: speech.transcript) { _, new in command = new }
        .onDisappear { speech.stop() }
    }

    private func send() {
        let text = command
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        speech.stop()
        command = ""
        Task { await model.ask(text) }
    }
}

// MARK: Settings

struct SettingsView: View {
    @EnvironmentObject private var model: AppModel
    @State private var serverAddress = ""
    @State private var token = ""
    @FocusState private var focus: Field?
    /// Shown as an alert after a failed connect, so a refusal can never go unnoticed.
    @State private var failure: String?
    private enum Field: Hashable { case address, token }

    private var addressURL: URL? { URL(string: serverAddress.trimmingCharacters(in: .whitespacesAndNewlines)) }
    private var hasToken: Bool { model.hasSavedToken || model.isConnected }
    private var canConnect: Bool {
        !serverAddress.trimmingCharacters(in: .whitespaces).isEmpty && !model.isBusy && (!token.trimmingCharacters(in: .whitespaces).isEmpty || model.hasSavedToken)
    }

    /// What is missing, in plain words, so a greyed button is never a mystery.
    private var missing: String? {
        if serverAddress.trimmingCharacters(in: .whitespaces).isEmpty { return "Enter the hub address first." }
        if token.trimmingCharacters(in: .whitespaces).isEmpty && !model.hasSavedToken { return "Paste the app token." }
        return nil
    }

    /// Tab / Shift-Tab move between the two fields (address, token). Return connects.
    private func tab(from field: Field, back: Bool) -> KeyPress.Result {
        let order: [Field] = [.address, .token]
        guard let i = order.firstIndex(of: field) else { return .ignored }
        focus = order[(i + (back ? order.count - 1 : 1)) % order.count]
        return .handled
    }

    private func disconnect() {
        model.disconnect()
        serverAddress = ""
        token = ""
        focus = .address
    }

    private func connect() {
        focus = nil
        Task {
            await model.connect(serverAddress: serverAddress, appToken: token)
            if model.isConnected && model.errorMessage == nil { token = "" }   // keep what you typed when it fails, so you can fix and retry
            else if let error = model.errorMessage {
                let pasted = token.trimmingCharacters(in: .whitespacesAndNewlines).count
                failure = pasted > 0 ? "\(error)\n\nYou pasted \(pasted) characters. An app token from the hub is 43. Copy it again from the hub and paste it here." : error
            }
        }
    }

    var body: some View {
        ScreenScaffold(level: model.state?.statusLevel(offline: model.isOffline) ?? .green, subtitle: "Settings") {
            PanelSection(title: "Hub connection") {
                VStack(alignment: .leading, spacing: 16) {
                    LabeledPanel(label: "Hub address") {
                        TextField("http://100.x.y.z:2000 (the Mac's Tailscale address)", text: $serverAddress)
                            .hubURLEntry()
                            .focused($focus, equals: .address)
                            .submitLabel(.next)
                            .onSubmit { focus = .token }
                            .onKeyPress(keys: [.tab]) { press in tab(from: .address, back: press.modifiers.contains(.shift)) }
                    }
                    if let url = addressURL, let note = HubEndpoint.note(for: url) {
                        Label(note, systemImage: HubEndpoint.classify(url) == .thisDevice ? "checkmark.shield" : "exclamationmark.triangle")
                            .font(.caption)
                            .foregroundStyle(HubEndpoint.classify(url) == .thisDevice ? Tv.fog : Color.orange)
                    } else if let url = addressURL, HubEndpoint.classify(url) == .rejected, !serverAddress.isEmpty {
                        Label("Start with https://, or http:// for this device, Tailscale or your own network.", systemImage: "xmark.circle")
                            .font(.caption).foregroundStyle(Tv.signal)
                    }

                    LabeledPanel(label: model.hasSavedToken ? "App token (saved; paste to replace)" : "App token") {
                        HStack {
                            SecureField("Paste the app token", text: $token)
                                .secretEntry()
                                .focused($focus, equals: .token)
                                .submitLabel(.go)
                                .onSubmit { if canConnect { connect() } }
                                .onKeyPress(keys: [.tab]) { press in tab(from: .token, back: press.modifiers.contains(.shift)) }
                            // PasteButton reads the clipboard without iOS's "Allow Paste" prompt
                            PasteButton(payloadType: String.self) { strings in
                                if let pasted = strings.first { token = pasted.trimmingCharacters(in: .whitespacesAndNewlines) }
                            }
                            .labelStyle(.titleOnly)
                            .buttonBorderShape(.capsule)
                        }
                    }
                    if !token.isEmpty {
                        Text("\(token.trimmingCharacters(in: .whitespacesAndNewlines).count) characters pasted")
                            .font(Tv.mono(12)).foregroundStyle(Tv.fog)
                    }
                    if model.hasSavedToken {
                        Label("App token stored in this device’s Keychain", systemImage: "key.fill")
                            .font(.caption).foregroundStyle(Tv.fog)
                    }

                    Button(action: connect) {
                        HStack(spacing: 10) {
                            if model.isBusy { ProgressView().controlSize(.small).tint(.black) }
                            Text(model.isBusy ? "Connecting…" : (model.isConnected ? "Reconnect" : "Connect"))
                        }
                    }
                    .buttonStyle(CyanButtonStyle())
                    .disabled(!canConnect)
                    .keyboardShortcut(.defaultAction)    // Return connects from anywhere
                    ConnectStatus(missing: missing, onRetry: connect)

                    Text("Use the hub’s https:// address. http:// is accepted only for this device (127.0.0.1), Tailscale (100.x) or your own network, and the app says when it is not encrypted. The app token is sent only in the Authorization header and stored in the Keychain.")
                        .font(.caption).foregroundStyle(Tv.fog)
                }
                .cockpitPanel()
            }

            if hasToken {
                PanelSection(title: "This device") {
                    VStack(alignment: .leading, spacing: 10) {
                        Button("Disconnect and remove saved token") { disconnect() }
                            .buttonStyle(GhostButtonStyle(danger: true))
                            .frame(maxWidth: 360)
                        Text("This removes the saved token and hub address from this device. It does not revoke the token on the hub.")
                            .font(.caption).foregroundStyle(Tv.fog)
                    }
                    .cockpitPanel()
                }
            }

            PanelSection(title: "About") {
                VStack(alignment: .leading, spacing: 8) {
                    HStack { Text("App").foregroundStyle(Tv.fog); Spacer(); Text("KITT").foregroundStyle(Tv.ice) }
                    HStack { Text("Hub version").foregroundStyle(Tv.fog); Spacer(); Text(model.state?.version ?? "Not connected").font(Tv.mono(14)).foregroundStyle(Tv.ice) }
                    Text("This preview does not include Apple Watch, widgets or background sync yet.").font(.caption).foregroundStyle(Tv.fog)
                }
                .cockpitPanel()
            }
        }
        .navigationTitle("Settings")
        .alert("Couldn’t connect", isPresented: Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })) {
            Button("OK") { failure = nil }
        } message: {
            Text(failure ?? "")
        }
        .onAppear {
            if serverAddress.isEmpty {
                serverAddress = model.baseURL
                #if os(macOS)
                // the hub normally runs on this Mac
                if serverAddress.isEmpty { serverAddress = "http://127.0.0.1:2000" }
                #endif
            }
        }
    }
}

// MARK: pieces

private struct SummaryCard: View {
    let title: String
    let value: String
    let detail: String
    let symbol: String
    let highlight: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(title.uppercased(), systemImage: symbol)
                .font(Tv.mono(12, .medium)).tracking(1.4)
                .foregroundStyle(Tv.fog)
            Text(value)
                .font(Tv.mono(34, .semibold)).monospacedDigit()
                .foregroundStyle(highlight ? Tv.cyan : Tv.ice)
                .shadow(color: highlight ? Tv.cyan.opacity(0.4) : .clear, radius: 14)
            Text(detail).font(.caption).foregroundStyle(Tv.fog)
        }
        .frame(maxWidth: .infinity, minHeight: 100, alignment: .leading)
        .cockpitPanel()
    }
}

private struct ErrorBanner: View {
    let message: String

    var body: some View {
        Label(message, systemImage: "exclamationmark.triangle.fill")
            .font(.callout)
            .foregroundStyle(Tv.signal)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
            .overlay(Rectangle().strokeBorder(Tv.signal.opacity(0.6), lineWidth: 1))
    }
}

/// The answer to "did my click do anything?": a spinner with the current step while connecting, then a green "connected and verified"
/// card or a red card with the exact refusal and a Try again button.
private struct ConnectStatus: View {
    @EnvironmentObject private var model: AppModel
    let missing: String?
    let onRetry: () -> Void

    var body: some View {
        Group {
            if model.isBusy {
                HStack(spacing: 12) {
                    ProgressView()
                    VStack(alignment: .leading, spacing: 2) {
                        Text(model.connectStep ?? "Working…").font(.subheadline.weight(.semibold)).foregroundStyle(Tv.ice)
                        Text("Waiting for the hub… up to 20 seconds").font(.caption).foregroundStyle(Tv.fog)
                    }
                    Spacer()
                }
            } else if let error = model.errorMessage {
                VStack(alignment: .leading, spacing: 8) {
                    Label("Not connected", systemImage: "xmark.octagon.fill").font(.subheadline.weight(.semibold)).foregroundStyle(Tv.signal)
                    Text(error).font(.callout).foregroundStyle(Tv.ice)
                    Button("Try again", action: onRetry).buttonStyle(GhostButtonStyle()).frame(maxWidth: 200)
                }
            } else if model.isConnected, let state = model.state {
                VStack(alignment: .leading, spacing: 4) {
                    Label("Connected and verified", systemImage: "checkmark.circle.fill").font(.subheadline.weight(.semibold)).foregroundStyle(Tv.cyan)
                    Text(model.connectSummary ?? "Hub \(state.version)").font(.caption).foregroundStyle(Tv.fog)
                }
            } else if let missing {
                Label(missing, systemImage: "info.circle").font(.footnote).foregroundStyle(Tv.fog)
            }
        }
        .padding(.vertical, 2)
    }
}
