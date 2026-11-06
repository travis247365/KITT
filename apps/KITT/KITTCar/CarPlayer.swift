import AVFoundation
import MediaPlayer
import UIKit
import KITTKit

extension Notification.Name {
    /// Posted on the main queue whenever what is playing, or its position, changes: the phone's Briefs screen and the car's list both redraw.
    static let kittPlayerChanged = Notification.Name("com.tpcl.kitt.player.changed")
}

/// Plays one brief at a time and tells the system (Now Playing on the lock screen and in CarPlay, steering-wheel and screen buttons) what is playing.
/// One player serves the phone's Briefs screen, Siri ("play my brief in Kitt") and the CarPlay scene, so the car's own Now Playing app
/// shows the brief whichever way it was started. That path needs no CarPlay entitlement.
@MainActor
final class CarPlayer {
    static let shared = CarPlayer()

    typealias Source = BriefSource

    private let player = AVPlayer()
    private(set) var current: Episode?
    private(set) var title = ""
    private var endObserver: NSObjectProtocol?
    private var interruptionObserver: NSObjectProtocol?
    private var timeObserver: Any?
    private var stateObservation: NSKeyValueObservation?
    /// Called when the playing item or its play/pause state changes, so the car list can mark the playing row.
    var onChange: (() -> Void)?

    private init() {
        wireRemoteCommands()
        timeObserver = player.addPeriodicTimeObserver(forInterval: CMTime(seconds: 1, preferredTimescale: 10), queue: .main) { _ in
            NotificationCenter.default.post(name: .kittPlayerChanged, object: nil)
        }
        // The system changes the rate on its own (a failure, the end of a phone call, another app taking the audio): the screens
        // and the car list follow the player, not the last button pressed.
        stateObservation = player.observe(\.timeControlStatus, options: [.new]) { @Sendable [weak self] _, _ in
            Task { @MainActor in self?.publishNowPlaying(); self?.changed() }
        }
        // A phone call pauses the brief and, when the call ends, picks it up again if the system says so.
        interruptionObserver = NotificationCenter.default.addObserver(forName: AVAudioSession.interruptionNotification, object: AVAudioSession.sharedInstance(), queue: .main) { [weak self] note in
            guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt, let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
            let options = AVAudioSession.InterruptionOptions(rawValue: (note.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt) ?? 0)
            Task { @MainActor in
                switch type {
                case .began: self?.pause()
                case .ended: if options.contains(.shouldResume) { self?.resume() }
                @unknown default: break
                }
            }
        }
    }

    var isPlaying: Bool { player.timeControlStatus != .paused }

    /// Why the current brief stopped, when the player gave up on it (an unreadable file, no audio output).
    var failure: String? {
        guard let item = player.currentItem, item.status == .failed else { return nil }
        return item.error?.localizedDescription ?? "The brief could not be played."
    }

    /// Seconds into the brief.
    var currentTime: Double {
        let s = player.currentTime().seconds
        return s.isFinite ? max(0, s) : 0
    }

    /// The brief's length: what the player measured once it loaded, else what the hub said.
    var duration: Double? {
        if let d = player.currentItem?.duration.seconds, d.isFinite, d > 0 { return d }
        if let s = current?.durationS, s > 0 { return Double(s) }
        return nil
    }

    func play(_ episode: Episode, title: String, source: Source) {
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .spokenAudio)
        try? session.setActive(true)

        let item: AVPlayerItem
        switch source {
        case .local(let url):
            item = AVPlayerItem(url: url)
        case .stream(let url, let headers):
            item = AVPlayerItem(asset: AVURLAsset(url: url, options: ["AVURLAssetHTTPHeaderFieldsKey": headers]))
        }
        if let old = endObserver { NotificationCenter.default.removeObserver(old) }
        endObserver = NotificationCenter.default.addObserver(forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.finished() }
        }
        current = episode
        self.title = title
        player.replaceCurrentItem(with: item)
        player.play()
        publishNowPlaying()
        changed()
    }

    func resume() { player.play(); publishNowPlaying(); changed() }
    func pause() { player.pause(); publishNowPlaying(); changed() }
    func toggle() { isPlaying ? pause() : resume() }

    func skip(by seconds: Double) {
        let target = max(0, player.currentTime().seconds + seconds)
        seek(to: target)
    }

    func seek(to seconds: Double) {
        player.seek(to: CMTime(seconds: seconds, preferredTimescale: 600)) { [weak self] _ in
            Task { @MainActor in self?.publishNowPlaying(); self?.changed() }
        }
    }

    private func finished() {
        player.pause()
        player.seek(to: .zero)
        publishNowPlaying()
        changed()
    }

    private func changed() {
        onChange?()
        NotificationCenter.default.post(name: .kittPlayerChanged, object: nil)
    }

    private func publishNowPlaying() {
        guard current != nil else { return }
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: title,
            MPMediaItemPropertyArtist: "Kitt",
            MPMediaItemPropertyAlbumTitle: "Briefs",
            MPNowPlayingInfoPropertyElapsedPlaybackTime: currentTime,
            MPNowPlayingInfoPropertyPlaybackRate: player.timeControlStatus == .playing ? 1.0 : 0.0,
            MPNowPlayingInfoPropertyDefaultPlaybackRate: 1.0,
            MPNowPlayingInfoPropertyMediaType: MPNowPlayingInfoMediaType.audio.rawValue
        ]
        if let duration { info[MPMediaItemPropertyPlaybackDuration] = duration }
        if let image = UIImage(named: "CarArtwork") {
            // MediaPlayer asks for the artwork on its own queue: the handler must not inherit this class's main-actor isolation
            // (under Swift 6 that trapped with SIGTRAP the first time a brief played; found by the simulator run of 6 Nov 2026).
            info[MPMediaItemPropertyArtwork] = MPMediaItemArtwork(boundsSize: image.size) { @Sendable _ in image }
        }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    private func wireRemoteCommands() {
        // The handlers are explicitly @Sendable for the same reason as the artwork: whichever queue the system calls them on,
        // they only hop to the main actor.
        let center = MPRemoteCommandCenter.shared()
        center.playCommand.addTarget { @Sendable _ in Task { @MainActor in CarPlayer.shared.resume() }; return .success }
        center.pauseCommand.addTarget { @Sendable _ in Task { @MainActor in CarPlayer.shared.pause() }; return .success }
        center.togglePlayPauseCommand.addTarget { @Sendable _ in Task { @MainActor in CarPlayer.shared.toggle() }; return .success }
        center.skipForwardCommand.preferredIntervals = [15]
        center.skipForwardCommand.addTarget { @Sendable _ in Task { @MainActor in CarPlayer.shared.skip(by: 15) }; return .success }
        center.skipBackwardCommand.preferredIntervals = [15]
        center.skipBackwardCommand.addTarget { @Sendable _ in Task { @MainActor in CarPlayer.shared.skip(by: -15) }; return .success }
        center.changePlaybackPositionCommand.addTarget { @Sendable event in
            guard let event = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            let position = event.positionTime
            Task { @MainActor in CarPlayer.shared.seek(to: position) }
            return .success
        }
        center.nextTrackCommand.isEnabled = false
        center.previousTrackCommand.isEnabled = false
    }
}
