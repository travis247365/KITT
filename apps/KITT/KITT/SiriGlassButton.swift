import SwiftUI

/// A Siri-style mic control for Ask Kitt: Liquid Glass at rest, a pulsing cyan ring while Kitt is listening.
/// Falls back to a translucent cockpit material where Liquid Glass isn't available (KITTMac's floor is macOS 15;
/// the iPhone/iPad app already requires iOS 26, so it always gets the real thing there).
struct SiriGlassButton: View {
    let isListening: Bool
    let isAvailable: Bool
    let action: () -> Void

    @State private var pulse = false

    var body: some View {
        Button(action: action) {
            ZStack {
                if isListening {
                    Circle()
                        .stroke(Tv.cyan.opacity(pulse ? 0.05 : 0.55), lineWidth: pulse ? 14 : 2)
                        .scaleEffect(pulse ? 1.55 : 1.0)
                        .animation(.easeOut(duration: 1.1).repeatForever(autoreverses: false), value: pulse)
                }
                Circle()
                    .fill(Tv.cockpit)
                    .kittGlass(tint: isListening ? Tv.cyan : Tv.fog)
                    .overlay(Circle().stroke(isListening ? Tv.cyan : Tv.cyan.opacity(0.35), lineWidth: 1.5))
                Image(systemName: isListening ? "waveform" : "mic.fill")
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(isListening ? Tv.cyan : Tv.ice)
                    .symbolEffect(.variableColor.iterative, isActive: isListening)
            }
            .frame(width: 52, height: 52)
        }
        .buttonStyle(.plain)
        .disabled(!isAvailable)
        .opacity(isAvailable ? 1 : 0.4)
        .onAppear { pulse = true }
        .accessibilityLabel(isListening ? "Stop listening" : "Ask Kitt by voice")
    }
}

/// Real Liquid Glass on iOS/macOS 26+; a cockpit-dark translucent material everywhere else.
extension View {
    @ViewBuilder func kittGlass(tint: Color) -> some View {
        if #available(iOS 26.0, macOS 26.0, *) {
            self.glassEffect(.regular.tint(tint.opacity(0.35)).interactive(), in: .circle)
        } else {
            self.background(.ultraThinMaterial, in: .circle)
        }
    }
}
