import Foundation

/// Content zoom for the Mac app (Window menu: Zoom In, Zoom Out, Actual Size). Fixed steps so the layout is always one that was designed for.
public enum ZoomLevel {
    public static let steps: [Double] = [0.75, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0]
    public static let actual = 1.0

    /// Snap any stored value to the nearest step (a hand-edited or old preference never breaks the layout).
    public static func snapped(_ value: Double) -> Double {
        steps.min { abs($0 - value) < abs($1 - value) } ?? actual
    }

    public static func zoomedIn(_ value: Double) -> Double {
        let v = snapped(value)
        return steps.first { $0 > v + 0.001 } ?? v
    }

    public static func zoomedOut(_ value: Double) -> Double {
        let v = snapped(value)
        return steps.last { $0 < v - 0.001 } ?? v
    }

    public static func canZoomIn(_ value: Double) -> Bool { snapped(value) < steps.last! - 0.001 }
    public static func canZoomOut(_ value: Double) -> Bool { snapped(value) > steps.first! + 0.001 }
    public static func label(_ value: Double) -> String { "\(Int((snapped(value) * 100).rounded())) %" }
}
