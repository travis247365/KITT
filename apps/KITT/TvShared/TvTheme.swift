import SwiftUI
import KITTKit
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

/// Design System v2 "Scanner Grid" tokens for the big screen: void black, cyan neon, red only as the scanner core.
/// Shared by the Apple TV app and the macOS preview tool that renders its screens to PNG for review.
enum Tv {
    static let size = CGSize(width: 1920, height: 1080)
    static let void = Color(hex: 0x050507)
    static let cockpit = Color(hex: 0x0E1116)
    static let panel = Color(hex: 0x161B22)
    static let ice = Color(hex: 0xEAF6FF)
    static let fog = Color(hex: 0x8FA3B8)
    static let cyan = Color(hex: 0x19E6FF)
    static let red = Color(hex: 0xFF2A2A)
    static let signal = Color(hex: 0xFF6B6B)

    /// Orbitron Bold (OFL-1.1, bundled) for the wordmark; SF expanded when the font file is not present.
    static func display(_ size: CGFloat) -> Font {
        #if canImport(UIKit)
        if UIFont(name: "Orbitron-Bold", size: size) != nil { return .custom("Orbitron-Bold", size: size) }
        #elseif canImport(AppKit)
        if NSFont(name: "Orbitron-Bold", size: size) != nil { return .custom("Orbitron-Bold", size: size) }
        #endif
        return .system(size: size, weight: .bold).width(.expanded)
    }

    static func mono(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
        .system(size: size, weight: weight, design: .monospaced)
    }

    static func sys(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
        .system(size: size, weight: weight)
    }
}

extension Color {
    init(hex: UInt32, opacity: Double = 1) {
        self.init(.sRGB, red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255, blue: Double(hex & 0xFF) / 255, opacity: opacity)
    }
}

/// Colours and speed for the animated top border and KITT name, by status level.
/// Critical = red, blue and white (red leads) and fast; amber = blue and white and medium; green = blue only and slow.
struct LevelPalette {
    let base: Color
    let mid: Color
    let hi: Color
    let glow: Color
    let track: Color
    let line: Color
    let period: Double
    let barWidth: Double
    let bandHalfWidth: Double
}

extension StatusLevel {
    var palette: LevelPalette {
        let cyan = Tv.cyan
        switch self {
        case .green:
            return LevelPalette(base: Color(hex: 0x14C4DC), mid: cyan, hi: Color(hex: 0xB8FBFF), glow: cyan.opacity(0.45),
                                track: cyan.opacity(0.10), line: cyan.opacity(0.40), period: 2.6, barWidth: 0.22, bandHalfWidth: 0.24)
        case .amber:
            return LevelPalette(base: Color(hex: 0x14C4DC), mid: cyan, hi: .white, glow: cyan.opacity(0.40),
                                track: cyan.opacity(0.10), line: cyan.opacity(0.40), period: 1.6, barWidth: 0.22, bandHalfWidth: 0.24)
        case .critical:
            return LevelPalette(base: Tv.red, mid: cyan, hi: .white, glow: Tv.red.opacity(0.55),
                                track: Tv.red.opacity(0.12), line: Tv.red.opacity(0.50), period: 0.9, barWidth: 0.26, bandHalfWidth: 0.16)
        }
    }
}

/// Position of a ping-pong sweep, 0 ... 1 and back, eased at both ends. Same period + same function = bar and name stay in step.
func sweepPhase(at date: Date, period: Double) -> Double {
    let u = (date.timeIntervalSinceReferenceDate / period).truncatingRemainder(dividingBy: 2)
    let tri = u < 1 ? u : 2 - u
    return tri * tri * (3 - 2 * tri)
}

private struct FrozenPhaseKey: EnvironmentKey { static let defaultValue: Double? = nil }
private struct PreviewFocusKey: EnvironmentKey { static let defaultValue: String? = nil }
private struct StaticFieldsKey: EnvironmentKey { static let defaultValue = false }

extension EnvironmentValues {
    /// Preview tool only: freeze both sweeps at a fixed phase so a screenshot is deterministic.
    var tvFrozenPhase: Double? {
        get { self[FrozenPhaseKey.self] }
        set { self[FrozenPhaseKey.self] = newValue }
    }
    /// Preview tool only: draw this id as focused (the real app uses the focus engine).
    var tvPreviewFocus: String? {
        get { self[PreviewFocusKey.self] }
        set { self[PreviewFocusKey.self] = newValue }
    }
    /// Preview tool only: draw text fields as plain text (AppKit fields cannot be rendered offscreen).
    var tvStaticFields: Bool {
        get { self[StaticFieldsKey.self] }
        set { self[StaticFieldsKey.self] = newValue }
    }
}
