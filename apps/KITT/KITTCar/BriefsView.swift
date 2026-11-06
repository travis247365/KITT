import SwiftUI
import KITTKit

/// The briefs on this phone, and the player behind the car's Now Playing. Play here, from Siri or from the CarPlay list: one player.
struct BriefsView: View {
    @EnvironmentObject private var model: AppModel
    @State private var episodes: [Episode] = []
    /// Bumped by the player's notifications so the panel and the rows redraw as the position moves.
    @State private var tick = 0
    @State private var syncing = false
    @State private var note: String?
    private let store = BriefStore.standard

    private var rows: [CarContent.Row] { CarContent.briefRows(episodes) }
    private var byID: [String: Episode] { Dictionary(uniqueKeysWithValues: episodes.map { (String($0.id), $0) }) }

    private var emptyHint: String {
        if !model.isConnected { return "Connect Kitt to the hub in Settings, then the newest briefs download here." }
        if model.isOffline { return "The hub is not reachable. Open Kitt on your home Wi-Fi once and the briefs download." }
        return "The hub has not rendered a brief yet. The morning brief renders at 07:05, the evening recap at 17:45."
    }

    var body: some View {
        ScreenScaffold(level: model.state?.statusLevel(offline: model.isOffline) ?? .green, subtitle: "Briefs") {
            NowPlayingPanel(tick: tick)
            if let note {
                Label(note, systemImage: "info.circle").font(.callout).foregroundStyle(Tv.fog)
            }
            PanelSection(title: "On this phone") {
                if rows.isEmpty {
                    Text(emptyHint).foregroundStyle(Tv.fog).cockpitPanel()
                } else {
                    VStack(spacing: 8) {
                        ForEach(rows) { row in briefRow(row) }
                    }
                }
            }
            PanelSection(title: "In the car") {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Press play here, or say “Hey Siri, play my brief in Kitt”. CarPlay’s Now Playing shows it, with the steering-wheel buttons and 15-second skips.")
                        .foregroundStyle(Tv.ice)
                    Text("The newest four briefs stay on this phone whenever Kitt can reach the hub, so they play on the road without a connection.")
                        .font(.caption).foregroundStyle(Tv.fog)
                }
                .cockpitPanel()
            }
        }
        .navigationTitle("Briefs")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    Task { await sync() }
                } label: {
                    if syncing { ProgressView().controlSize(.small) } else { Image(systemName: "arrow.down.circle") }
                }
                .disabled(syncing || !model.isConnected)
                .accessibilityLabel("Download the newest briefs")
            }
        }
        .task {
            load()
            await sync()
            await autoplayIfRequested()
        }
        .onReceive(NotificationCenter.default.publisher(for: .kittPlayerChanged)) { _ in tick &+= 1 }
    }

    private func briefRow(_ row: CarContent.Row) -> some View {
        let episode = byID[row.id]
        let onPhone = episode.map { store.localAudio(for: $0) != nil } ?? false
        let isCurrent = episode.map { CarPlayer.shared.current?.id == $0.id } ?? false
        let playing = isCurrent && CarPlayer.shared.isPlaying
        return HStack(spacing: 14) {
            Image(systemName: row.title == "Evening recap" ? "moon.stars.fill" : "sun.max.fill")
                .font(.title3).foregroundStyle(Tv.cyan).frame(width: 28)
            VStack(alignment: .leading, spacing: 3) {
                Text(row.title).font(.headline).foregroundStyle(isCurrent ? Tv.cyan : Tv.ice)
                Text(onPhone ? row.detail : row.detail + " · needs the hub").font(.caption).foregroundStyle(Tv.fog)
            }
            Spacer()
            Button {
                Task { await play(row) }
            } label: {
                Image(systemName: playing ? "pause.circle.fill" : "play.circle.fill").font(.system(size: 32))
            }
            .buttonStyle(.plain)
            .foregroundStyle(Tv.cyan)
            .disabled(!onPhone && !model.isConnected)
            .accessibilityLabel(playing ? "Pause \(row.title)" : "Play \(row.title)")
        }
        .cockpitPanel(accent: isCurrent ? Tv.cyan : Tv.cyan.opacity(0.5))
    }

    private func load() { episodes = store.episodes() }

    private func sync() async {
        guard model.isConnected else { load(); return }
        syncing = true
        defer { syncing = false }
        if let outcome = await model.syncBriefsNow() {
            if outcome.failed > 0 { note = "\(outcome.failed) brief(s) could not be downloaded." }
            else if outcome.downloaded > 0 { note = "Downloaded \(outcome.downloaded) new brief(s) for the car." }
            else { note = nil }
        } else {
            note = "The hub is not reachable; showing what is on the phone."
        }
        load()
    }

    private func play(_ row: CarContent.Row) async {
        guard let episode = byID[row.id] else { return }
        if CarPlayer.shared.current?.id == episode.id {
            CarPlayer.shared.toggle()
            return
        }
        guard let source = await HubAccess.source(for: episode, store: store) else {
            note = "This brief is not on the phone and the hub is not reachable."
            return
        }
        note = nil
        CarPlayer.shared.play(episode, title: row.title, source: source)
    }

    /// Review aid (see KITTApp.swift): KITT_DEV_AUTOPLAY=1 starts the newest brief as soon as the screen is up.
    private func autoplayIfRequested() async {
        guard ProcessInfo.processInfo.environment["KITT_DEV_AUTOPLAY"] == "1", let first = rows.first else { return }
        await play(first)
    }
}

private struct NowPlayingPanel: View {
    let tick: Int

    var body: some View {
        let _ = tick
        let player = CarPlayer.shared
        VStack(alignment: .leading, spacing: 10) {
            Label("NOW PLAYING", systemImage: "waveform").font(Tv.mono(11, .medium)).tracking(1.4).foregroundStyle(Tv.cyan)
            if player.current != nil {
                Text(player.title).font(.headline).foregroundStyle(Tv.ice)
                let total = max(player.duration ?? 1, player.currentTime, 1)
                ProgressView(value: min(player.currentTime, total), total: total).tint(Tv.cyan)
                HStack {
                    Text(clock(player.currentTime)).monospacedDigit()
                    Spacer()
                    Text(player.duration.map(clock) ?? "–:––").monospacedDigit()
                }
                .font(Tv.mono(12)).foregroundStyle(Tv.fog)
                HStack(spacing: 34) {
                    Button { player.skip(by: -15) } label: { Image(systemName: "gobackward.15") }
                        .accessibilityLabel("Back 15 seconds")
                    Button { player.toggle() } label: { Image(systemName: player.isPlaying ? "pause.fill" : "play.fill").font(.system(size: 30)) }
                        .accessibilityLabel(player.isPlaying ? "Pause" : "Play")
                    Button { player.skip(by: 15) } label: { Image(systemName: "goforward.15") }
                        .accessibilityLabel("Forward 15 seconds")
                }
                .font(.title2).foregroundStyle(Tv.ice).buttonStyle(.plain)
                .frame(maxWidth: .infinity)
                if let failure = player.failure {
                    Label(failure, systemImage: "exclamationmark.triangle.fill").font(.caption).foregroundStyle(Tv.signal)
                }
            } else {
                Text("Nothing playing. Pick a brief below.").foregroundStyle(Tv.fog)
            }
        }
        .cockpitPanel()
    }

    private func clock(_ seconds: Double) -> String {
        let s = Int(seconds.rounded(.down))
        return "\(s / 60):" + String(format: "%02d", s % 60)
    }
}
