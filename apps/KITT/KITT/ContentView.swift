import SwiftUI
import KITTKit

private enum AppSection: String, CaseIterable, Identifiable, Hashable {
    case overview
    case feed
    case ask
    case settings

    var id: String { rawValue }
    var title: String {
        switch self {
        case .overview: "Overview"
        case .feed: "Feed"
        case .ask: "Ask Kitt"
        case .settings: "Settings"
        }
    }
    var symbol: String {
        switch self {
        case .overview: "rectangle.grid.1x2"
        case .feed: "list.bullet.rectangle"
        case .ask: "waveform"
        case .settings: "gearshape"
        }
    }
}

struct ContentView: View {
    @EnvironmentObject private var model: AppModel
    @State private var selection: AppSection? = .overview

    var body: some View {
        NavigationSplitView {
            List(AppSection.allCases, selection: $selection) { section in
                Label(section.title, systemImage: section.symbol)
                    .tag(section)
            }
            .navigationTitle("KITT")
        } detail: {
            Group {
                switch selection ?? .overview {
                case .overview:
                    OverviewView(openFeed: { filter in
                        model.feedFilter = filter
                        selection = .feed
                    })
                case .feed:
                    FeedView()
                case .ask:
                    AskView()
                case .settings:
                    SettingsView()
                }
            }
        }
        .task {
            if model.isConnected { await model.refresh() }
        }
    }
}

private struct OverviewView: View {
    @EnvironmentObject private var model: AppModel
    /// Opens the Feed, already filtered (a card, a skill or a routine on this screen is a shortcut to its items in the feed).
    let openFeed: (FeedFilter) -> Void

    private let columns = [GridItem(.adaptive(minimum: 190), spacing: 12)]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                header
                if let error = model.errorMessage {
                    ErrorBanner(message: error)
                }
                if !model.isConnected {
                    ContentUnavailableView {
                        Label("Connect Kitt", systemImage: "point.3.connected.trianglepath.dotted")
                    } description: {
                        Text("Add the secure hub address and app token in Settings.")
                    }
                } else if let state = model.state {
                    summaryCards(state)
                    if !state.pendingActions.isEmpty {
                        pendingSection(state.pendingActions)
                    }
                    skillsSection(state.skillList)
                    routinesSection(state.routineList)
                } else {
                    ProgressView("Loading Kitt status…")
                        .frame(maxWidth: .infinity, minHeight: 180)
                }
            }
            .padding(20)
            .frame(maxWidth: 1050, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .refreshable { await model.refresh() }
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

    private var header: some View {
        AppHeader(level: model.state?.statusLevel(offline: model.isOffline) ?? .green, subtitle: model.isConnected ? "Personal assistant" : "Not connected")
    }

    private func summaryCards(_ state: KITTState) -> some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: 12) {
            Button { openFeed(FeedFilter()) } label: { SummaryCard(
                title: "Hub",
                value: "Connected",
                detail: "Version \(state.version) · open the feed",
                symbol: "checkmark.circle.fill",
                color: .green
            ) }.buttonStyle(.plain)
            Button { openFeed(FeedFilter(kinds: [FeedKind.decision.rawValue])) } label: { SummaryCard(
                title: "Pending",
                value: "\(state.pendingActions.count)",
                detail: state.pendingActions.isEmpty ? "No action needs approval" : "Review before confirming",
                symbol: "hand.raised.fill",
                color: state.pendingActions.isEmpty ? .secondary : .orange
            ) }.buttonStyle(.plain)
            Button { openFeed(FeedFilter(showNoise: false)) } label: { SummaryCard(
                title: "Skills",
                value: "\(state.skillList.count)",
                detail: state.brain?.ok == false ? "Assistant brain needs attention" : "Available from your hub",
                symbol: "square.grid.2x2.fill",
                color: state.brain?.ok == false ? .orange : .accentColor
            ) }.buttonStyle(.plain)
        }
    }

    private func pendingSection(_ actions: [PendingAction]) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Needs your decision").font(.title2.bold())
            ForEach(actions) { action in
                VStack(alignment: .leading, spacing: 10) {
                    Text(action.summary).font(.headline)
                    Text("From \(action.source) · \(action.skill)")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    HStack {
                        Button("Confirm") {
                            Task { await model.resolvePending(confirm: true, code: action.code) }
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(model.isBusy)
                        Button("Cancel", role: .destructive) {
                            Task { await model.resolvePending(confirm: false, code: action.code) }
                        }
                        .buttonStyle(.bordered)
                        .disabled(model.isBusy)
                    }
                }
                .cockpitPanel(accent: Tv.cyan)
            }
        }
    }

    private func skillsSection(_ skills: [String: SkillState]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Skills").font(.title2.bold())
            ForEach(skills.keys.sorted(), id: \.self) { key in
                if let skill = skills[key] {
                    Button { openFeed(FeedFilter(skills: [key])) } label: { HStack(alignment: .top, spacing: 12) {
                        Image(systemName: skill.ok == true ? "checkmark.circle.fill" : "exclamationmark.circle.fill")
                            .foregroundStyle(skill.ok == true ? .green : .orange)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(skill.name).font(.headline)
                            if let detail = skill.detail, !detail.isEmpty {
                                Text(detail).font(.subheadline).foregroundStyle(.secondary)
                            }
                        }
                        Spacer()
                        Text(skill.ok == true ? "Ready" : "Attention")
                            .font(.caption.weight(.medium))
                            .foregroundStyle(skill.ok == true ? .green : .orange)
                        Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary)
                    }
                    .padding(.vertical, 8)
                    .contentShape(Rectangle()) }.buttonStyle(.plain)
                }
            }
        }
    }

    private func routinesSection(_ routines: [RoutineState]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Recent routines").font(.title2.bold())
            if routines.isEmpty {
                Text("No routines reported.")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(routines.prefix(8)) { routine in
                    Button { openFeed(FeedFilter(skills: routine.skill.map { [$0] } ?? [], kinds: [FeedKind.routine.rawValue], showNoise: true)) } label: { HStack {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(routine.name).font(.subheadline.weight(.medium))
                            Text(routine.lastRunAt ?? "Not run yet")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        Text(routine.lastStatus ?? "—")
                            .font(.caption)
                            .foregroundStyle(routine.lastStatus == "error" ? .red : .secondary)
                    }
                    .padding(.vertical, 5)
                    .contentShape(Rectangle()) }.buttonStyle(.plain)
                }
            }
        }
    }
}

private struct AskView: View {
    @EnvironmentObject private var model: AppModel
    @State private var command = ""

    var body: some View {
        Form {
            Section("Ask Kitt") {
                TextField("Type a command or question", text: $command, axis: .vertical)
                    .lineLimit(2...5)
                    .submitLabel(.send)
                    .onSubmit { send() }
                HStack {
                    Text("\(command.count)/2000")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Spacer()
                    Button {
                        send()
                    } label: {
                        if model.isBusy {
                            ProgressView()
                        } else {
                            Label("Ask", systemImage: "arrow.up.circle.fill")
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(command.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || command.count > 2_000 || model.isBusy || !model.isConnected)
                }
            }
            if let reply = model.reply {
                Section("Kitt says") {
                    Text(reply).textSelection(.enabled)
                }
            }
            if let error = model.errorMessage {
                Section("Couldn’t complete that") {
                    Text(error).foregroundStyle(.red)
                }
            }
            if let pending = model.state?.pendingActions, !pending.isEmpty {
                Section("Confirmation required") {
                    ForEach(pending) { action in
                        VStack(alignment: .leading, spacing: 8) {
                            Text(action.summary).font(.headline)
                            HStack {
                                Button("Confirm") { Task { await model.resolvePending(confirm: true, code: action.code) } }
                                    .buttonStyle(.borderedProminent)
                                Button("Cancel", role: .destructive) { Task { await model.resolvePending(confirm: false, code: action.code) } }
                                    .buttonStyle(.bordered)
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle("Ask Kitt")
    }

    private func send() {
        let text = command
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        command = ""
        Task { await model.ask(text) }
    }
}

private struct SettingsView: View {
    @EnvironmentObject private var model: AppModel
    @State private var serverAddress = ""
    @State private var token = ""
    @FocusState private var focus: Field?
    /// Shown as an alert after a failed connect, so a refusal can never go unnoticed.
    @State private var failure: String?
    private enum Field: Hashable { case address, token, connect, disconnect }

    private var addressURL: URL? { URL(string: serverAddress.trimmingCharacters(in: .whitespacesAndNewlines)) }
    private var canConnect: Bool {
        !serverAddress.trimmingCharacters(in: .whitespaces).isEmpty && !model.isBusy && (!token.trimmingCharacters(in: .whitespaces).isEmpty || model.hasSavedToken)
    }

    /// What is missing, in plain words, so a greyed button is never a mystery.
    private var missing: String? {
        if serverAddress.trimmingCharacters(in: .whitespaces).isEmpty { return "Enter the hub address first." }
        if token.trimmingCharacters(in: .whitespaces).isEmpty && !model.hasSavedToken { return "Paste the app token." }
        return nil
    }

    private var hasToken: Bool { model.hasSavedToken || model.isConnected }

    /// Tab / Shift-Tab move between the two fields (address, token). Buttons are reached with Return (Connect) or, with Full Keyboard Access, Tab.
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
        Form {
            Section {
                TextField("http://your-mac-name.local:2000", text: $serverAddress)
                    .hubURLEntry()
                    .focused($focus, equals: .address)
                    .submitLabel(.next)
                    .onSubmit { focus = .token }
                    .onKeyPress(keys: [.tab]) { press in tab(from: .address, back: press.modifiers.contains(.shift)) }
                if let url = addressURL, let note = HubEndpoint.note(for: url) {
                    Label(note, systemImage: HubEndpoint.classify(url) == .thisDevice ? "checkmark.shield" : "exclamationmark.triangle")
                        .font(.caption)
                        .foregroundStyle(HubEndpoint.classify(url) == .thisDevice ? Color.secondary : Color.orange)
                } else if let url = addressURL, HubEndpoint.classify(url) == .rejected, !serverAddress.isEmpty {
                    Label("Start with https://, or http:// for this device or your home network.", systemImage: "xmark.circle")
                        .font(.caption).foregroundStyle(.red)
                }
                HStack {
                    SecureField(model.hasSavedToken ? "Replace saved app token (optional)" : "Kitt app token", text: $token)
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
                if !token.isEmpty {
                    Text("\(token.trimmingCharacters(in: .whitespacesAndNewlines).count) characters pasted")
                        .font(.caption).foregroundStyle(.secondary)
                }
                if model.hasSavedToken {
                    Label("App token stored in this device’s Keychain", systemImage: "key.fill")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            } header: {
                Text("Hub connection")
            } footer: {
                Text("Use the hub’s https:// address. http:// is accepted only for this device (127.0.0.1) or your own home network, and the app says when it is not encrypted. The app token is sent only in the Authorization header and stored in the Keychain.")
            }

            Section {
                Button(action: connect) {
                    HStack(spacing: 10) {
                        if model.isBusy { ProgressView().controlSize(.small).tint(.black) }
                        Text(model.isBusy ? "Connecting…" : (model.isConnected ? "Reconnect" : "Connect"))
                            .font(.headline)
                    }
                    .foregroundStyle(Color.black)
                    .frame(maxWidth: .infinity, minHeight: 48)
                    .background(Tv.cyan.opacity(canConnect || model.isBusy ? 1 : 0.28))
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(!canConnect)
                .keyboardShortcut(.defaultAction)    // Return connects from anywhere in the form
                .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                .listRowBackground(Color.clear)

                ConnectStatus(missing: missing, onRetry: connect)
            }

            if hasToken {
                Section {
                    Button("Disconnect and remove saved token", role: .destructive) { disconnect() }
                } footer: {
                    Text("This removes the saved token and hub address from this device. It does not revoke the token on the hub.")
                }
            }
            Section("About") {
                LabeledContent("App", value: "KITT")
                LabeledContent("Hub version", value: model.state?.version ?? "Not connected")
                Text("This preview does not include Apple Watch, widgets or background sync yet.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
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

private struct SummaryCard: View {
    let title: String
    let value: String
    let detail: String
    let symbol: String
    let color: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(title.uppercased(), systemImage: symbol)
                .font(Tv.mono(12, .medium)).tracking(1.4)
                .foregroundStyle(Tv.fog)
            Text(value).font(Tv.mono(30, .semibold)).monospacedDigit().foregroundStyle(color == .orange ? Tv.cyan : Tv.ice)
            Text(detail).font(.caption).foregroundStyle(Tv.fog)
        }
        .frame(maxWidth: .infinity, minHeight: 96, alignment: .leading)
        .cockpitPanel(accent: color == .orange ? Tv.cyan : Tv.cyan)
    }
}

private struct ErrorBanner: View {
    let message: String

    var body: some View {
        Label(message, systemImage: "exclamationmark.triangle.fill")
            .font(.callout)
            .foregroundStyle(.red)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
            .background(.red.opacity(0.08))
    }
}

/// The answer to "did my click do anything?": a spinner with the current step and the seconds so far while connecting, then a green
/// "connected and verified" card or a red card with the exact refusal and a Retry button.
private struct ConnectStatus: View {
    @EnvironmentObject private var model: AppModel
    let missing: String?
    let onRetry: () -> Void

    var body: some View {
        Group {
            if model.isBusy {
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    HStack(spacing: 12) {
                        ProgressView()
                        VStack(alignment: .leading, spacing: 2) {
                            Text(model.connectStep ?? "Working…").font(.subheadline.weight(.semibold))
                            Text("Waiting for the hub… up to 20 seconds").font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                    }
                }
            } else if let error = model.errorMessage {
                VStack(alignment: .leading, spacing: 8) {
                    Label("Not connected", systemImage: "xmark.octagon.fill").font(.subheadline.weight(.semibold)).foregroundStyle(.red)
                    Text(error).font(.callout)
                    Button("Try again", action: onRetry)
                }
            } else if model.isConnected, let state = model.state {
                VStack(alignment: .leading, spacing: 4) {
                    Label("Connected and verified", systemImage: "checkmark.circle.fill").font(.subheadline.weight(.semibold)).foregroundStyle(.green)
                    Text(model.connectSummary ?? "Hub \(state.version)").font(.caption).foregroundStyle(.secondary)
                }
            } else if let missing {
                Label(missing, systemImage: "info.circle").font(.footnote).foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 4)
    }
}
