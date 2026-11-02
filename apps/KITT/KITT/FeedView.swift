import SwiftUI
import KITTKit

/// The hub as a feed: everything the hub did (questions, decisions, briefs, routine runs), newest first, with drop-down multi-select filters per
/// dimension (skill, type, source, result), clickable tags on every row, search, and a detail view per item.
struct FeedView: View {
    @EnvironmentObject private var model: AppModel
    @State private var selected: FeedItem?

    var body: some View {
        let all = model.feedItems
        let filter = model.feedFilter
        let shown = filter.apply(all)
        VStack(spacing: 0) {
            AppHeader(level: model.state?.statusLevel(offline: model.isOffline) ?? .green, subtitle: "Feed · \(shown.count) of \(all.count)")
                .padding(.horizontal, 16).padding(.top, 14 + ScreenScaffold<EmptyView>.toolbarClearance)
            FilterBar(items: all)
            ActiveFilters()
            Divider()
            if !model.isConnected {
                ContentUnavailableView("Connect Kitt", systemImage: "point.3.connected.trianglepath.dotted", description: Text("Add the hub address and app token in Settings."))
            } else if all.isEmpty {
                ContentUnavailableView(model.feedError == nil ? "Nothing in the feed yet" : "Couldn’t load the feed", systemImage: "tray",
                                       description: Text(model.feedError ?? "Ask Kitt something and it shows up here."))
            } else {
                List {
                    if let pending = model.state?.pendingActions, !pending.isEmpty, !filter.isActive {
                        Section("Needs your decision") { ForEach(pending) { DecisionPanel(action: $0).listRowBackground(Color.clear) } }
                    }
                    if shown.isEmpty {
                        Text("No items match these filters.").foregroundStyle(.secondary)
                        Button("Clear filters") { model.feedFilter = FeedFilter() }
                    }
                    ForEach(shown.groupedByDay()) { day in
                        Section("\(day.title) · \(day.items.count)") {
                            ForEach(day.items) { item in
                                FeedRow(item: item)
                                    .contentShape(Rectangle())
                                    .onTapGesture { selected = item }
                                    .listRowBackground(Tv.cockpit)
                            }
                        }
                    }
                }
                .scrollContentBackground(.hidden)
                .refreshable { await model.refreshFeed() }
            }
        }
        .background(Tv.void)
        .navigationTitle("Feed")
        .searchable(text: $model.feedFilter.query, prompt: "Search the feed")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { Task { await model.refresh() } } label: { Image(systemName: "arrow.clockwise") }
                    .disabled(model.isBusy || !model.isConnected)
                    .accessibilityLabel("Refresh the feed")
            }
        }
        .task { await model.refreshFeed() }
        .sheet(item: $selected) { FeedDetail(item: $0) }
    }
}

// MARK: filters

private struct FilterBar: View {
    @EnvironmentObject private var model: AppModel
    let items: [FeedItem]

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(FeedDimension.allCases) { FacetMenu(dimension: $0, items: items) }
                Toggle(isOn: $model.feedFilter.showNoise) { Label("Routine runs", systemImage: "waveform.path") }
                    .toggleStyle(.button)
                    .help("Also show routine runs that succeeded (failed ones always show)")
                if model.feedFilter.isActive {
                    Button("Clear") { model.feedFilter = FeedFilter() }.buttonStyle(.borderless)
                }
            }
            .padding(.horizontal, 16).padding(.vertical, 10)
        }
    }
}

private struct FacetMenu: View {
    @EnvironmentObject private var model: AppModel
    let dimension: FeedDimension
    let items: [FeedItem]

    var body: some View {
        let options = model.feedFilter.options(dimension, in: items)
        let selected = model.feedFilter.selection(dimension)
        Menu {
            ForEach(options) { option in
                Toggle(isOn: Binding(get: { selected.contains(option.value) }, set: { _ in model.feedFilter.toggle(dimension, option.value) })) {
                    Text("\(option.label)  ·  \(option.count)")
                }
            }
            if !selected.isEmpty {
                Divider()
                Button("Clear \(dimension.title)") { model.feedFilter.set(dimension, []) }
            }
        } label: {
            HStack(spacing: 6) {
                Text(selected.isEmpty ? dimension.title : "\(dimension.title) (\(selected.count))")
                Image(systemName: "chevron.down").font(.caption2)
            }
        }
        #if os(iOS)
        .menuActionDismissBehavior(.disabled)   // stays open while you tick several (macOS menus close after each pick)
        #endif
        .buttonStyle(.bordered)
        .tint(selected.isEmpty ? .secondary : .accentColor)
    }
}

private struct ActiveFilters: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        let f = model.feedFilter
        let chips: [(FeedDimension, String)] = FeedDimension.allCases.flatMap { d in f.selection(d).sorted().map { (d, $0) } }
        if !chips.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(chips, id: \.1) { d, v in
                        Button { model.feedFilter.toggle(d, v) } label: {
                            Label("\(d.title): \(model.feedItems.first { FeedFilter.value(d, of: $0) == v }.map { FeedFilter.label(d, of: $0) } ?? FeedItem.humanise(v))", systemImage: "xmark.circle.fill")
                                .labelStyle(.titleAndIcon).font(.caption)
                        }
                        .buttonStyle(.bordered).controlSize(.small)
                    }
                }
                .padding(.horizontal, 16).padding(.bottom, 8)
            }
        }
    }
}

// MARK: rows

private struct TagChip: View {
    @EnvironmentObject private var model: AppModel
    let dimension: FeedDimension
    let item: FeedItem

    var body: some View {
        let value = FeedFilter.value(dimension, of: item)
        let on = model.feedFilter.selection(dimension).contains(value)
        Button { model.feedFilter.toggle(dimension, value) } label: {
            Text(FeedFilter.label(dimension, of: item))
                .font(.caption2.weight(.medium))
                .padding(.horizontal, 7).padding(.vertical, 3)
                .background(on ? Color.accentColor.opacity(0.28) : Color.secondary.opacity(0.14), in: Capsule())
                .foregroundStyle(dimension == .outcome && item.isProblem ? Color.red : Color.primary)
        }
        .buttonStyle(.plain)
        .help("Filter by \(FeedFilter.label(dimension, of: item))")
    }
}

private struct FeedRow: View {
    let item: FeedItem

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: item.kind.symbol)
                .frame(width: 28, height: 28)
                .foregroundStyle(item.isProblem ? Color.red : (item.kind == .decision ? Color.orange : Color.accentColor))
            VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .firstTextBaseline) {
                    Text(item.title).font(.headline).lineLimit(2)
                    Spacer(minLength: 8)
                    if let d = item.date { Text(d, style: .time).font(.caption).foregroundStyle(.secondary) }
                }
                HStack(spacing: 6) {
                    TagChip(dimension: .skill, item: item)
                    TagChip(dimension: .kind, item: item)
                    TagChip(dimension: .source, item: item)
                    TagChip(dimension: .outcome, item: item)
                }
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }
}

// MARK: detail

private struct FeedDetail: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    let item: FeedItem

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    LabeledContent("What", value: item.title)
                    LabeledContent("Type", value: item.kind.title)
                    LabeledContent("Skill", value: item.skillName)
                    LabeledContent("From", value: item.sourceName)
                    LabeledContent("Result", value: item.outcomeName)
                    if let d = item.date { LabeledContent("When") { Text(d, format: .dateTime.day().month().hour().minute().second()) } }
                    if let ms = item.latencyMs { LabeledContent("Took", value: ms >= 1000 ? String(format: "%.1f s", Double(ms) / 1000) : "\(ms) ms") }
                    if let intent = item.intent, !intent.isEmpty { LabeledContent("Intent", value: intent) }
                }
                if let input = item.input, !input.isEmpty { Section("You said") { Text(input).textSelection(.enabled) } }
                if let detail = item.detail, !detail.isEmpty { Section(item.isProblem ? "What went wrong" : "Details") { Text(detail).font(.callout).textSelection(.enabled) } }
                Section("Filter the feed") {
                    Button("Only \(item.skillName)") { apply(.skill) }
                    Button("Only \(item.kind.title.lowercased())") { apply(.kind) }
                    Button("Only from \(item.sourceName)") { apply(.source) }
                }
            }
            .formStyle(.grouped)
            .navigationTitle("Feed item")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
        .frame(minWidth: 440, minHeight: 420)
    }

    private func apply(_ d: FeedDimension) {
        model.feedFilter = FeedFilter()
        model.feedFilter.toggle(d, FeedFilter.value(d, of: item))
        dismiss()
    }
}
