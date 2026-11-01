import SwiftUI
import KITTKit

/// Apple TV client: pick the screen from the hub connection and state; the screens themselves live in TvShared.
/// Siri Remote: swipe moves focus, Select opens, Menu goes back (sheets) or leaves the app (root), Play/Pause reads the brief.
struct TvRootView: View {
    @EnvironmentObject private var model: AppModel
    @StateObject private var voice = BriefVoice()
    @State private var detail: GlanceTile?
    @State private var asking: AskSnapshot?
    @State private var address = ""
    @State private var token = ""

    /// What the decision screen was opened for. The code is sent back with Confirm/Cancel so the hub refuses if a different request is pending by then.
    private struct AskSnapshot: Identifiable {
        let id = UUID()
        let code: String?
        let summary: String
        let expiresAt: Date?
        var outcome: String?
        var submitting = false
    }

    var body: some View {
        Group {
            if !model.isConnected {
                ConnectScreen(address: $address, token: $token, error: model.errorMessage, busy: model.isBusy) {
                    Task {
                        await model.connect(serverAddress: address, appToken: token)
                        if model.isConnected { token = "" }
                    }
                }
            } else if model.authFailed {
                Unreachable(title: "THE HUB REJECTED THIS APPLE TV", message: "The saved token no longer works.", hint: "Forget this hub, then connect again with a current app token.", busy: model.isBusy,
                            retry: { Task { await model.refresh() } }, forget: { model.disconnect() })
            } else if let state = model.state {
                board(state)
            } else if model.errorMessage != nil {
                Unreachable(title: "CAN’T REACH YOUR HUB", message: model.errorMessage ?? "", hint: "The Mac that runs KITT may be asleep. This screen retries every minute.", busy: model.isBusy,
                            retry: { Task { await model.refresh() } }, forget: { model.disconnect() })
            } else {
                Loading()
            }
        }
        .task(id: model.isConnected) {
            // Same cadence as the /tv page: the hub keeps this cheap, and the Mac may be asleep.
            while model.isConnected && !Task.isCancelled {
                await model.refresh()
                try? await Task.sleep(for: .seconds(60))
            }
        }
    }

    private func board(_ state: KITTState) -> some View {
        let glance = state.glance(offline: model.isOffline)
        return TimelineView(.everyMinute) { context in
            NowScreen(
                glance: glance, clock: context.date, offline: model.isOffline, lastUpdated: model.lastUpdated, speaking: voice.speaking,
                onOpen: { detail = $0 },
                onReview: { asking = AskSnapshot(code: glance.pendingCode, summary: glance.pendingSummary ?? "", expiresAt: glance.pendingExpiresAt) }
            )
            .onPlayPauseCommand { voice.toggle([glance.headline, glance.sub].filter { !$0.isEmpty }.joined(separator: ". ")) }
            .fullScreenCover(item: $detail) { tile in
                DetailScreen(tile: tile, level: glance.level, clock: context.date)
            }
            .fullScreenCover(item: $asking, onDismiss: { Task { await model.refresh() } }) { snapshot in
                AskScreen(
                    summary: snapshot.summary, expiresAt: snapshot.expiresAt, clock: context.date, level: glance.level, outcome: snapshot.outcome,
                    onConfirm: { resolve(confirm: true) },
                    onCancel: { resolve(confirm: false) },
                    onDone: { asking = nil }
                )
            }
        }
    }

    /// One tap, one request: `submitting` is local to this screen (the shared busy flag is also toggled by the minute poll) and is never cleared.
    private func resolve(confirm: Bool) {
        guard var snapshot = asking, !snapshot.submitting else { return }
        snapshot.submitting = true
        asking = snapshot
        Task {
            let result = await model.resolvePending(confirm: confirm, code: snapshot.code)
            switch result {
            case .done(let spoken):
                asking?.outcome = spoken.isEmpty ? (confirm ? "Confirmed." : "Cancelled.") : spoken
            case .changed:
                asking = nil    // a different request is pending now; the board behind shows it
            case .failed(let why):
                asking?.outcome = "Could not finish: \(why)"
            }
        }
    }
}

private struct Loading: View {
    var body: some View {
        ZStack(alignment: .topLeading) {
            Tv.void
            VStack(alignment: .leading, spacing: 0) {
                TvHeader(level: .green)
                Text("Connecting to your hub…").font(Tv.sys(56, .semibold)).foregroundStyle(Tv.ice).frame(maxHeight: .infinity, alignment: .center)
            }
            .padding(.horizontal, 90).padding(.vertical, 60)
        }
        .ignoresSafeArea()
    }
}

private struct Unreachable: View {
    let title: String
    let message: String
    let hint: String
    let busy: Bool
    let retry: () -> Void
    let forget: () -> Void
    @State private var armed = false

    var body: some View {
        ZStack(alignment: .topLeading) {
            Tv.void
            VStack(alignment: .leading, spacing: 0) {
                TvHeader(level: .amber)
                VStack(alignment: .leading, spacing: 28) {
                    Text(title).font(Tv.mono(26, .medium)).tracking(4.7).foregroundStyle(Tv.fog)
                    Text(message).font(Tv.sys(56, .semibold)).foregroundStyle(Tv.ice).lineLimit(3)
                    Text(hint).font(Tv.sys(36)).foregroundStyle(Tv.fog)
                    HStack(spacing: 32) {
                        Button(action: retry) {
                            Text(busy ? "Trying…" : "Try again").font(Tv.sys(40, .semibold)).foregroundStyle(Tv.void).frame(width: 420, height: 110).background(Tv.cyan)
                        }
                        .buttonStyle(PanelButtonStyle(id: "retry", lift: 1.06, ring: Tv.ice))
                        Button { if armed { forget() } else { armed = true } } label: {
                            Text(armed ? "Select again to forget" : "Forget this hub").font(Tv.sys(40, .semibold)).foregroundStyle(Tv.ice).frame(width: 520, height: 110)
                                .overlay(Rectangle().strokeBorder(armed ? Tv.signal : Tv.fog, lineWidth: 2))
                        }
                        .buttonStyle(PanelButtonStyle(id: "forget", lift: 1.06))
                    }
                    .padding(.top, 20)
                }
                .frame(maxHeight: .infinity, alignment: .center)
            }
            .padding(.horizontal, 90).padding(.vertical, 60)
        }
        .ignoresSafeArea()
    }
}
