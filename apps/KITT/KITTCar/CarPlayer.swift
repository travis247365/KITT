import AVFoundation
import MediaPlayer
import UIKit
import KITTKit

/// Plays one brief at a time and tells the car (Now Playing, steering-wheel and screen buttons) what is playing.
@MainActor
final class CarPlayer {
    static let shared = CarPlayer()

    enum Source {
        case local(URL)
        case stream(URL, headers: [String: String])
    }

    private let player = AVPlayer()
    private(set) var current: Episode?
    private var title = ""
    private var endObserver: NSObjectProtocol?
    /// Called when the playing item or its play/pause state changes, so the list can mark the playing row.
    var onChange: (() -> Void)?

    private init() { wireRemoteCommands() }

    var isPlaying: Bool { player.rate > 0 }

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
        onChange?()
    }

    func resume() { player.play(); publishNowPlaying(); onChange?() }
    func pause() { player.pause(); publishNowPlaying(); onChange?() }
    func toggle() { isPlaying ? pause() : resume() }

    func skip(by seconds: Double) {
        let target = max(0, player.currentTime().seconds + seconds)
        seek(to: target)
    }

    func seek(to seconds: Double) {
        player.seek(to: CMTime(seconds: seconds, preferredTimescale: 600)) { [weak self] _ in
            Task { @MainActor in self?.publishNowPlaying() }
        }
    }

    private func finished() {
        player.pause()
        player.seek(to: .zero)
        publishNowPlaying()
        onChange?()
    }

    private func publishNowPlaying() {
        guard current != nil else { return }
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: title,
            MPMediaItemPropertyArtist: "Kitt",
            MPMediaItemPropertyAlbumTitle: "Briefs",
            MPNowPlayingInfoPropertyElapsedPlaybackTime: max(0, player.currentTime().seconds.isFinite ? player.currentTime().seconds : 0),
            MPNowPlayingInfoPropertyPlaybackRate: isPlaying ? 1.0 : 0.0,
            MPNowPlayingInfoPropertyDefaultPlaybackRate: 1.0,
            MPNowPlayingInfoPropertyMediaType: MPNowPlayingInfoMediaType.audio.rawValue
        ]
        if let seconds = player.currentItem?.duration.seconds, seconds.isFinite, seconds > 0 {
            info[MPMediaItemPropertyPlaybackDuration] = seconds
        } else if let s = current?.durationS {
            info[MPMediaItemPropertyPlaybackDuration] = Double(s)
        }
        if let image = UIImage(named: "CarArtwork") {
            info[MPMediaItemPropertyArtwork] = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
        }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    private func wireRemoteCommands() {
        let center = MPRemoteCommandCenter.shared()
        center.playCommand.addTarget { _ in Task { @MainActor in CarPlayer.shared.resume() }; return .success }
        center.pauseCommand.addTarget { _ in Task { @MainActor in CarPlayer.shared.pause() }; return .success }
        center.togglePlayPauseCommand.addTarget { _ in Task { @MainActor in CarPlayer.shared.toggle() }; return .success }
        center.skipForwardCommand.preferredIntervals = [15]
        center.skipForwardCommand.addTarget { _ in Task { @MainActor in CarPlayer.shared.skip(by: 15) }; return .success }
        center.skipBackwardCommand.preferredIntervals = [15]
        center.skipBackwardCommand.addTarget { _ in Task { @MainActor in CarPlayer.shared.skip(by: -15) }; return .success }
        center.changePlaybackPositionCommand.addTarget { event in
            guard let event = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            let position = event.positionTime
            Task { @MainActor in CarPlayer.shared.seek(to: position) }
            return .success
        }
        center.nextTrackCommand.isEnabled = false
        center.previousTrackCommand.isEnabled = false
    }
}
