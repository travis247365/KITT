import SwiftUI
import KITTKit

private enum AppSection: String, CaseIterable, Identifiable, Hashable {
    case overview
    case ask
    case settings

    var id: String { rawValue }
    var title: String {
        switch self {
        case .overview: "Overview"
        case .ask: "Ask Kitt"
        case .settings: "Settings"
        }
    }
    var symbol: String {
        switch self {
        case .overview: "rectangle.grid.1x2"
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
                    OverviewView()
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
        VStack(alignment: .leading, spacing: 4) {
            Text("KITT").font(.system(size: 30, weight: .bold, design: .rounded))
            Text("Personal assistant · iPhone and iPad")
                .foregroundStyle(.secondary)
        }
    }

    private func summaryCards(_ state: KITTState) -> some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: 12) {
            SummaryCard(
                title: "Hub",
                value: "Connected",
                detail: "Version \(state.version)",
                symbol: "checkmark.circle.fill",
                color: .green
            )
            SummaryCard(
                title: "Pending",
                value: "\(state.pendingActions.count)",
                detail: state.pendingActions.isEmpty ? "No action needs approval" : "Review before confirming",
                symbol: "hand.raised.fill",
                color: state.pendingActions.isEmpty ? .secondary : .orange
            )
            SummaryCard(
                title: "Skills",
                value: "\(state.skillList.count)",
                detail: state.brain?.ok == false ? "Assistant brain needs attention" : "Available from your hub",
                symbol: "square.grid.2x2.fill",
                color: state.brain?.ok == false ? .orange : .accentColor
            )
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
                .padding(16)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(.thinMaterial)
                .overlay(alignment: .leading) { Rectangle().fill(.orange).frame(width: 4) }
            }
        }
    }

    private func skillsSection(_ skills: [String: SkillState]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Skills").font(.title2.bold())
            ForEach(skills.keys.sorted(), id: \.self) { key in
                if let skill = skills[key] {
                    HStack(alignment: .top, spacing: 12) {
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
                    }
                    .padding(.vertical, 8)
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
                    HStack {
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

    var body: some View {
        Form {
            Section {
                TextField("https://your-mac.tailnet.ts.net", text: $serverAddress)
                    .hubURLEntry()
                SecureField(model.hasSavedToken ? "Replace saved app token (optional)" : "Kitt app token", text: $token)
                    .secretEntry()
                if model.hasSavedToken {
                    Label("App token stored in this device’s Keychain", systemImage: "key.fill")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Button {
                    Task {
                        await model.connect(serverAddress: serverAddress, appToken: token)
                        token = ""
                    }
                } label: {
                    if model.isBusy {
                        ProgressView()
                    } else {
                        Text("Connect and verify")
                    }
                }
                .disabled(serverAddress.isEmpty || model.isBusy)
            } header: {
                Text("Hub connection")
            } footer: {
                Text("Use the hub’s HTTPS address. The app token is sent only in the Authorization header and stored in the Keychain.")
            }
            if let error = model.errorMessage {
                Section("Connection error") {
                    Text(error).foregroundStyle(.red)
                }
            }
            if model.isConnected {
                Section {
                    Button("Disconnect this device", role: .destructive) {
                        model.disconnect()
                        serverAddress = ""
                        token = ""
                    }
                } footer: {
                    Text("This removes the saved token from this device. It does not revoke the token on the hub.")
                }
            }
            Section("About") {
                LabeledContent("App", value: "KITT")
                LabeledContent("Hub version", value: model.state?.version ?? "Not connected")
                Text("This iPhone/iPad preview does not include Apple Watch, widgets, background sync, or QR pairing yet.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .navigationTitle("Settings")
        .onAppear {
            if serverAddress.isEmpty { serverAddress = model.baseURL }
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
            Label(title, systemImage: symbol)
                .font(.subheadline)
                .foregroundStyle(color)
            Text(value).font(.title2.bold())
            Text(detail).font(.caption).foregroundStyle(.secondary)
        }
        .padding(16)
        .frame(maxWidth: .infinity, minHeight: 110, alignment: .leading)
        .background(.thinMaterial)
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
