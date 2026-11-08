import AppIntents
import SwiftUI
import WidgetKit

/// Home-screen and Lock Screen widgets, in the design of the mockups' widget row (mockups/src/surfaces/Surfaces.tsx › Widgets):
/// Now (what needs you), Cash (the position with 14 days of spend), Brief (the newest brief, with Play). They read the snapshot
/// the app writes into the App Group (Shared/KittWidgetData.swift); tapping any of them opens the app on its home surface.

struct SnapshotEntry: TimelineEntry {
    let date: Date
    let snap: KittWidgetSnapshot?
}

struct SnapshotProvider: TimelineProvider {
    func placeholder(in context: Context) -> SnapshotEntry { SnapshotEntry(date: Date(), snap: .placeholder) }
    func getSnapshot(in context: Context, completion: @escaping (SnapshotEntry) -> Void) {
        completion(SnapshotEntry(date: Date(), snap: context.isPreview ? .placeholder : (KittWidgetSnapshot.load() ?? .placeholder)))
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<SnapshotEntry>) -> Void) {
        // The app reloads the timelines whenever it writes a new snapshot; this is only the fallback cadence.
        completion(Timeline(entries: [SnapshotEntry(date: Date(), snap: KittWidgetSnapshot.load())], policy: .after(Date().addingTimeInterval(30 * 60))))
    }
}

// MARK: Now

struct KittNowWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "com.tpcl.kitt.now", provider: SnapshotProvider()) { entry in
            NowWidgetView(entry: entry)
                .containerBackground(Palette.void, for: .widget)
                .widgetURL(URL(string: "kitt://open"))
        }
        .configurationDisplayName("Now")
        .description("What needs you: a decision waiting, findings to review, the hub's status.")
        .supportedFamilies([.systemSmall, .accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}

struct NowWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: SnapshotEntry

    private var snap: KittWidgetSnapshot? { entry.snap }
    private var number: Int { snap.map { $0.pending > 0 ? $0.pending : $0.actionable } ?? 0 }
    private var caption: String {
        guard let snap else { return "open Kitt once" }
        if snap.pending > 0 { return "waiting for your OK" }
        return snap.actionable == 1 ? "skill to review" : "skills to review"
    }

    var body: some View {
        switch family {
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                VStack(spacing: 0) {
                    Text("\(number)").font(.system(size: 22, weight: .bold, design: .rounded))
                    Text("K").font(.system(size: 9, weight: .heavy).width(.expanded))
                }
            }
        case .accessoryRectangular:
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 4) { Text("KITT").font(.system(size: 11, weight: .bold).width(.expanded)); Text(snap?.eyebrow.uppercased() ?? "").font(.system(size: 10, design: .monospaced)).lineLimit(1) }
                Text(snap?.headline ?? "Open Kitt once to fill this").font(.system(size: 13, weight: .medium)).lineLimit(2)
            }
        case .accessoryInline:
            Label(snap.map { "\(number) · \($0.headline)" } ?? "Kitt: open the app once", systemImage: "bolt.horizontal.circle")
        default:
            VStack(alignment: .leading, spacing: 6) {
                Text("NOW").font(.system(size: 11, weight: .medium, design: .monospaced)).tracking(1.2).foregroundStyle(Palette.fog)
                Text("\(number)").font(.system(size: 44, weight: .semibold, design: .rounded)).foregroundStyle(Palette.ice).minimumScaleFactor(0.6)
                Text(caption).font(.system(size: 13)).foregroundStyle(Palette.ice).lineLimit(2)
                Spacer(minLength: 0)
                HStack(spacing: 6) {
                    Circle().fill(Palette.level(snap?.level ?? "green")).frame(width: 7, height: 7)
                    Text(snap?.critical == true ? "Critical" : (snap?.level == "amber" ? "Needs attention" : "None critical")).font(.system(size: 11, design: .monospaced)).foregroundStyle(Palette.fog).lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }
}

// MARK: Cash

struct KittCashWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "com.tpcl.kitt.cash", provider: SnapshotProvider()) { entry in
            CashWidgetView(entry: entry)
                .containerBackground(Palette.void, for: .widget)
                .widgetURL(URL(string: "kitt://open"))
        }
        .configurationDisplayName("Cash")
        .description("Your cash position across wallets and the last 14 days of spend, from the Money skill.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

struct CashWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: SnapshotEntry

    private static let formatter: NumberFormatter = { let f = NumberFormatter(); f.numberStyle = .decimal; f.maximumFractionDigits = 0; f.locale = Locale(identifier: "en_GB"); return f }()
    static func kwacha(_ v: Double) -> String { "K" + (formatter.string(from: NSNumber(value: v)) ?? "0") }

    var body: some View {
        let snap = entry.snap
        HStack(alignment: .top, spacing: 16) {
            VStack(alignment: .leading, spacing: 6) {
                Text("CASH").font(.system(size: 11, weight: .medium, design: .monospaced)).tracking(1.2).foregroundStyle(Palette.fog)
                Text(snap?.cashTotal.map(Self.kwacha) ?? "—").font(.system(size: family == .systemSmall ? 26 : 30, weight: .semibold, design: .rounded)).foregroundStyle(Palette.ice).minimumScaleFactor(0.6).lineLimit(1)
                Sparkline(points: snap?.spendDaily ?? []).frame(height: family == .systemSmall ? 26 : 34)
                Spacer(minLength: 0)
                HStack(spacing: 6) {
                    Text("MEASURED").font(.system(size: 9, weight: .semibold, design: .monospaced)).tracking(0.8).padding(.horizontal, 5).padding(.vertical, 2).foregroundStyle(Palette.void).background(Palette.cyan)
                    if let asOf = snap?.cashAsOf { Text(asOf, style: .relative).font(.system(size: 10, design: .monospaced)).foregroundStyle(Palette.fog).lineLimit(1) }
                }
            }
            if family == .systemMedium, let snap {
                VStack(alignment: .leading, spacing: 6) {
                    Text("14 DAYS OUT").font(.system(size: 11, weight: .medium, design: .monospaced)).tracking(1.2).foregroundStyle(Palette.fog)
                    Text(Self.kwacha(snap.spendDaily.reduce(0, +))).font(.system(size: 22, weight: .semibold, design: .rounded)).foregroundStyle(Palette.ice).lineLimit(1)
                    Text("from the newest transactions the hub holds").font(.system(size: 10)).foregroundStyle(Palette.fog).lineLimit(2)
                    Spacer(minLength: 0)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

/// The mockups' Spark: a 2 px line, square caps, no fill.
struct Sparkline: View {
    let points: [Double]
    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width, h = geo.size.height
            let maxV = max(points.max() ?? 1, 1)
            Path { p in
                guard points.count > 1 else { return }
                for (i, v) in points.enumerated() {
                    let x = w * CGFloat(i) / CGFloat(points.count - 1)
                    let y = h - CGFloat(v / maxV) * (h - 2) - 1
                    i == 0 ? p.move(to: CGPoint(x: x, y: y)) : p.addLine(to: CGPoint(x: x, y: y))
                }
            }
            .stroke(Palette.cyan, style: StrokeStyle(lineWidth: 2, lineCap: .square, lineJoin: .miter))
        }
    }
}

// MARK: Brief

struct KittBriefWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "com.tpcl.kitt.brief", provider: SnapshotProvider()) { entry in
            BriefWidgetView(entry: entry)
                .containerBackground(Palette.void, for: .widget)
        }
        .configurationDisplayName("Brief")
        .description("The newest brief with the hub's headline; Play starts it without opening the app.")
        .supportedFamilies([.systemMedium])
    }
}

struct BriefWidgetView: View {
    let entry: SnapshotEntry

    var body: some View {
        let snap = entry.snap
        HStack(alignment: .center, spacing: 14) {
            Link(destination: URL(string: "kitt://open")!) {
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 6) {
                        Text((snap?.briefTitle ?? "Brief").uppercased()).font(.system(size: 11, weight: .medium, design: .monospaced)).tracking(1.2).foregroundStyle(Palette.fog)
                        if let when = snap?.briefWhen { Text("· ").font(.system(size: 11, design: .monospaced)).foregroundStyle(Palette.fog) + Text(when, style: .relative).font(.system(size: 11, design: .monospaced)).foregroundStyle(Palette.fog) }
                    }
                    Text(snap?.headline ?? "Open Kitt once to fill this").font(.system(size: 16, weight: .medium)).foregroundStyle(Palette.ice).lineLimit(2)
                    Text(snap?.detail ?? "").font(.system(size: 12)).foregroundStyle(Palette.fog).lineLimit(2)
                    Spacer(minLength: 0)
                    if let s = snap?.briefDurationS, s > 0 { Text("\(s / 60):" + String(format: "%02d", s % 60)).font(.system(size: 11, design: .monospaced)).foregroundStyle(Palette.fog) }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            }
            Button(intent: PlayLatestBriefIntent()) {
                Image(systemName: "play.fill").font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(Palette.void)
                    .frame(width: 58, height: 58)
                    .background(Palette.cyan)
            }
            .buttonStyle(.plain)
        }
    }
}
