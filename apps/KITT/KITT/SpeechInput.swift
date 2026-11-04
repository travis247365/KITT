import Foundation
import Speech
import AVFoundation

/// Turns speech into the Ask Kitt text field, the way Siri turns speech into a command: tap to listen, watch the
/// words appear live, it closes its own ear after a beat of silence. It only fills the box — sending stays a
/// separate, deliberate action (the Ask button or Return), same as if you had typed it.
@MainActor
final class SpeechInput: ObservableObject {
    @Published private(set) var isListening = false
    @Published var transcript = ""
    @Published var deniedMessage: String?

    private let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en_GB"))
    private let engine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var silenceTimer: Timer?

    var isAvailable: Bool { recognizer?.isAvailable ?? false }

    func toggle() { isListening ? stop() : start() }

    func start() {
        guard !isListening else { return }
        deniedMessage = nil
        Task {
            let granted = await AVCaptureDevice.requestAccess(for: .audio)
            let authorized = await withCheckedContinuation { (c: CheckedContinuation<Bool, Never>) in
                SFSpeechRecognizer.requestAuthorization { c.resume(returning: $0 == .authorized) }
            }
            guard granted, authorized else {
                deniedMessage = "Kitt needs the microphone and Speech Recognition. Enable them in Settings, then try again."
                return
            }
            beginListening()
        }
    }

    func stop() {
        silenceTimer?.invalidate(); silenceTimer = nil
        guard isListening || engine.isRunning else { return }
        engine.stop()
        engine.inputNode.removeTap(onBus: 0)
        request?.endAudio()
        task?.cancel()
        task = nil
        request = nil
        isListening = false
        #if os(iOS)
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        #endif
    }

    private func beginListening() {
        guard let recognizer, recognizer.isAvailable else {
            deniedMessage = "Speech recognition isn't available right now."
            return
        }
        #if os(iOS)
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.record, mode: .measurement, options: .duckOthers)
            try session.setActive(true, options: .notifyOthersOnDeactivation)
        } catch {
            deniedMessage = "Couldn't prepare the microphone: \(error.localizedDescription)"
            return
        }
        #endif
        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        if recognizer.supportsOnDeviceRecognition { req.requiresOnDeviceRecognition = true }
        request = req

        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            self?.request?.append(buffer)
        }
        engine.prepare()
        do { try engine.start() } catch {
            deniedMessage = "Couldn't start listening: \(error.localizedDescription)"
            return
        }
        isListening = true
        transcript = ""
        task = recognizer.recognitionTask(with: req) { [weak self] result, error in
            guard let self else { return }
            Task { @MainActor in
                if let result {
                    self.transcript = result.bestTranscription.formattedString
                    self.resetSilenceTimer()
                    if result.isFinal { self.stop() }
                }
                if error != nil { self.stop() }
            }
        }
        resetSilenceTimer()
    }

    /// Stops on its own ~1.4s after the last word, the way Siri closes its ear once you've finished talking.
    private func resetSilenceTimer() {
        silenceTimer?.invalidate()
        silenceTimer = Timer.scheduledTimer(withTimeInterval: 1.4, repeats: false) { [weak self] _ in
            Task { @MainActor in self?.stop() }
        }
    }
}
