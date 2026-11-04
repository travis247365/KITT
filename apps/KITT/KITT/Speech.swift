import AVFoundation

/// Reads a short reply aloud, once, the way the TV's BriefVoice reads a brief. No toggle/stop state needed here -
/// Ask Kitt's replies are a sentence or two, not a multi-minute brief.
@MainActor
enum Speech {
    private static let synthesizer = AVSpeechSynthesizer()

    static func say(_ text: String) {
        guard !text.isEmpty else { return }
        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = AVSpeechSynthesisVoice(language: "en-GB")
        synthesizer.speak(utterance)
    }
}
