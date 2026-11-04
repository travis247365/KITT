import SwiftUI

/// A Siri-style mic control for Ask Kitt: Liquid Glass at rest, a pulsing cyan ring while Kitt is listening.
/// Falls back to a translucent cockpit material where Liquid Glass isn't available (KITTMac's floor is macOS 15;
/// the iPhone/iPad app already requires iOS 26, so it always gets the real thing there).
struct SiriGlassButton: View {
    let isListening: Bool
    let isAvailable: Bool
    var size: CGFloat = 88
    let action: () -> Void

    @State private var pulse = false

    private var iconSize: CGFloat { size * 0.38 }

    var body: some View {
        Button(action: action) {
            ZStack {
                // two rings at different phases so the pulse reads as continuous, not a single flash
                ForEach(0..<2, id: \.self) { i in
                    Circle()
                        .stroke(Tv.cyan.opacity(isListening ? (pulse ? 0.0 : 0.6) : 0), lineWidth: pulse ? size * 0.22 : 2)
                        .scaleEffect(pulse ? 1.7 : 1.0)
                        .animation(
                            isListening
                                ? .easeOut(duration: 1.3).repeatForever(autoreverses: false).delay(Double(i) * 0.65)
                                : .default,
                            value: pulse
                        )
                }
                Circle()
                    .fill(Tv.cockpit)
                    .kittGlass(tint: isListening ? Tv.cyan : Tv.cyan.opacity(0.6))
                    .overlay(Circle().stroke(isListening ? Tv.cyan : Tv.cyan.opacity(0.55), lineWidth: 2))
                    .shadow(color: Tv.cyan.opacity(isListening ? 0.55 : 0.22), radius: isListening ? 18 : 8)
                Image(systemName: isListening ? "waveform" : "mic.fill")
                    .font(.system(size: iconSize, weight: .semibold))
                    .foregroundStyle(isListening ? Tv.cyan : Tv.ice)
                    .symbolEffect(.variableColor.iterative, isActive: isListening)
            }
            .frame(width: size, height: size)
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
