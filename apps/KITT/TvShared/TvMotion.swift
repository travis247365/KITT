import SwiftUI
import KITTKit

/// The top border: a light bar that sweeps all the time. Colour and speed follow the status level;
/// with Reduce Motion it stops at the centre.
struct ScannerBar: View {
    let level: StatusLevel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.tvFrozenPhase) private var frozen

    var body: some View {
        let p = level.palette
        TimelineView(.animation(minimumInterval: level == .critical ? 1.0 / 60.0 : 1.0 / 30.0, paused: reduceMotion || frozen != nil || Tv.motionPaused)) { context in
            let phase = frozen ?? ((reduceMotion || Tv.motionPaused) ? 0.5 : sweepPhase(at: context.date, period: p.period))
            GeometryReader { geo in
                let barWidth = geo.size.width * p.barWidth
                ZStack(alignment: .topLeading) {
                    Rectangle().fill(p.track)
                    Rectangle().fill(p.line).frame(height: 1)
                    Rectangle().fill(p.line).frame(height: 1).frame(maxHeight: .infinity, alignment: .bottom)
                    Rectangle()
                        .fill(LinearGradient(stops: Self.stops(for: level), startPoint: .leading, endPoint: .trailing))
                        .frame(width: barWidth)
                        .shadow(color: p.glow, radius: 14)
                        .offset(x: (geo.size.width - barWidth) * phase)
                }
                .clipped()
            }
        }
        .frame(height: 8)
        .accessibilityHidden(true)
    }

    private static func stops(for level: StatusLevel) -> [Gradient.Stop] {
        let cyan = Tv.cyan
        switch level {
        case .green:
            return [.init(color: cyan.opacity(0), location: 0), .init(color: cyan.opacity(0.6), location: 0.28), .init(color: cyan, location: 0.5),
                    .init(color: cyan.opacity(0.6), location: 0.72), .init(color: cyan.opacity(0), location: 1)]
        case .amber:
            return [.init(color: cyan.opacity(0), location: 0), .init(color: cyan, location: 0.28), .init(color: .white, location: 0.5),
                    .init(color: cyan, location: 0.72), .init(color: cyan.opacity(0), location: 1)]
        case .critical:
            return [.init(color: cyan.opacity(0), location: 0), .init(color: cyan, location: 0.12), .init(color: .white, location: 0.27),
                    .init(color: Tv.red, location: 0.42), .init(color: Tv.red, location: 0.58), .init(color: .white, location: 0.73),
                    .init(color: cyan, location: 0.88), .init(color: cyan.opacity(0), location: 1)]
        }
    }
}

/// The KITT name in Orbitron, with a band of light travelling through the letters in step with the bar.
struct KittName: View {
    let level: StatusLevel
    var size: CGFloat = 38
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.tvFrozenPhase) private var frozen

    var body: some View {
        let p = level.palette
        TimelineView(.animation(minimumInterval: level == .critical ? 1.0 / 60.0 : 1.0 / 30.0, paused: reduceMotion || frozen != nil || Tv.motionPaused)) { context in
            let phase = frozen ?? ((reduceMotion || Tv.motionPaused) ? 0.5 : sweepPhase(at: context.date, period: p.period))
            let centre = -p.bandHalfWidth + (1 + 2 * p.bandHalfWidth) * phase
            Text("KITT")
                .font(Tv.display(size))
                .tracking(size * 0.3)
                .foregroundStyle(LinearGradient(stops: Self.band(p, centre: centre), startPoint: .leading, endPoint: .trailing))
                .shadow(color: p.glow, radius: 14)
        }
        .accessibilityLabel("KITT")
    }

    private static func band(_ p: LevelPalette, centre c: Double) -> [Gradient.Stop] {
        let h = p.bandHalfWidth
        func at(_ x: Double) -> Double { min(1, max(0, x)) }
        return [.init(color: p.base, location: 0), .init(color: p.base, location: at(c - h)), .init(color: p.mid, location: at(c - h * 0.45)),
                .init(color: p.hi, location: at(c)), .init(color: p.mid, location: at(c + h * 0.45)), .init(color: p.base, location: at(c + h)),
                .init(color: p.base, location: 1)]
    }
}

/// The mark: a light bar on a grid.
struct KittMark: View {
    var size: CGFloat = 72

    var body: some View {
        Canvas { ctx, canvas in
            let k = canvas.width / 100
            ctx.fill(Path(CGRect(origin: .zero, size: canvas)), with: .color(Tv.void))
            var grid = Path()
            for y in [70.0, 82, 94] { grid.move(to: CGPoint(x: 0, y: y * k)); grid.addLine(to: CGPoint(x: 100 * k, y: y * k)) }
            for (x1, x2) in [(20.0, 4.0), (40, 32), (60, 68), (80, 96)] { grid.move(to: CGPoint(x: x1 * k, y: 60 * k)); grid.addLine(to: CGPoint(x: x2 * k, y: 100 * k)) }
            ctx.stroke(grid, with: .color(Tv.cyan.opacity(0.14)), lineWidth: max(1, k))
            var rails = Path()
            for y in [41.0, 59] { rails.move(to: CGPoint(x: 10 * k, y: y * k)); rails.addLine(to: CGPoint(x: 90 * k, y: y * k)) }
            ctx.stroke(rails, with: .color(Tv.cyan.opacity(0.5)), lineWidth: max(1, k))
            let bar = CGRect(x: 10 * k, y: 46 * k, width: 80 * k, height: 8 * k)
            ctx.fill(Path(bar), with: .linearGradient(Gradient(colors: [Tv.red, .white, Tv.cyan]), startPoint: CGPoint(x: bar.minX, y: 0), endPoint: CGPoint(x: bar.maxX, y: 0)))
        }
        .frame(width: size, height: size)
        .accessibilityLabel("KITT mark")
    }
}

/// A faint perspective grid under custom surfaces (never on the car).
struct GridFloor: View {
    var opacity: Double = 0.08

    var body: some View {
        GeometryReader { geo in
            Canvas { ctx, canvas in
                var path = Path()
                let step: CGFloat = 96
                var x: CGFloat = 0
                while x <= canvas.width { path.move(to: CGPoint(x: x, y: 0)); path.addLine(to: CGPoint(x: x, y: canvas.height)); x += step }
                var y: CGFloat = 0
                while y <= canvas.height { path.move(to: CGPoint(x: 0, y: y)); path.addLine(to: CGPoint(x: canvas.width, y: y)); y += step }
                ctx.stroke(path, with: .color(Tv.cyan), lineWidth: 1)
            }
            .frame(width: geo.size.width * 1.4, height: geo.size.height * 0.46 * 1.6)
            .rotation3DEffect(.degrees(64), axis: (x: 1, y: 0, z: 0), anchor: .bottom, perspective: 0.5)
            .mask(LinearGradient(colors: [.clear, .black], startPoint: .top, endPoint: .bottom))
            .opacity(opacity)
            .frame(width: geo.size.width, height: geo.size.height, alignment: .bottom)
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}
