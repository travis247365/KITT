import CarPlay
import UIKit
import KITTKit

/// CarPlay draws Apple's templates, not our own screens: Briefs (audio), Now (what needs a decision) and Ask (what to say to Siri).
/// Decisions are voice-only in the car by design, so nothing here confirms or runs anything.
@objc(KITTCarSceneDelegate)
final class CarSceneDelegate: UIResponder, CPTemplateApplicationSceneDelegate {
    private var controller: CarController?

    func templateApplicationScene(_ templateApplicationScene: CPTemplateApplicationScene, didConnect interfaceController: CPInterfaceController) {
        let controller = CarController(interface: interfaceController)
        self.controller = controller
        controller.start()
    }

    func templateApplicationScene(_ templateApplicationScene: CPTemplateApplicationScene, didDisconnectInterfaceController interfaceController: CPInterfaceController) {
        controller?.stop()
        controller = nil
    }
}

@MainActor
final class CarController {
    private let interface: CPInterfaceController
    private let store = BriefStore.standard
    private let briefsTab = CPListTemplate(title: "Briefs", sections: [])
    private let nowTab = CPListTemplate(title: "Now", sections: [])
    private let askTab = CPListTemplate(title: "Ask", sections: [])
    private var client: HubClient?
    private var state: KITTState?
    private var offline = false
    private var syncMessage: String?
    private var loop: Task<Void, Never>?

    /// The artwork for a list row, drawn once at the size and scale this car's display wants (CPListItem.maximumImageSize at the
    /// head unit's displayScale): sharp on the truck's 9-inch unit and on a small 7-inch one alike, instead of the 1024 px asset handed
    /// over raw and scaled by the car.
    private lazy var rowArtwork: UIImage? = {
        guard let art = UIImage(named: "CarArtwork") else { return nil }
        let size = CPListItem.maximumImageSize
        let format = UIGraphicsImageRendererFormat()
        format.scale = interface.carTraitCollection.displayScale
        return UIGraphicsImageRenderer(size: size, format: format).image { _ in art.draw(in: CGRect(origin: .zero, size: size)) }
    }()

    init(interface: CPInterfaceController) {
        self.interface = interface
        briefsTab.tabTitle = "Briefs"; briefsTab.tabImage = UIImage(systemName: "waveform") ?? UIImage()
        nowTab.tabTitle = "Now"; nowTab.tabImage = UIImage(systemName: "bolt.horizontal.circle") ?? UIImage()
        askTab.tabTitle = "Ask"; askTab.tabImage = UIImage(systemName: "mic") ?? UIImage()
    }

    func start() {
        client = HubAccess.makeClient()
        render()
        interface.setRootTemplate(CPTabBarTemplate(templates: [briefsTab, nowTab, askTab]), animated: false, completion: nil)
        CarPlayer.shared.onChange = { [weak self] in self?.render() }
        loop = Task { [weak self] in
            while !Task.isCancelled {
                await self?.refresh()
                try? await Task.sleep(for: .seconds(60))
            }
        }
    }

    func stop() {
        loop?.cancel()
        loop = nil
        CarPlayer.shared.onChange = nil
    }

    private func refresh() async {
        if client == nil { client = HubAccess.makeClient() }
        guard let client else { render(); return }
        do {
            state = try await client.state()
            offline = false
            let outcome = try await BriefSync.sync(client: client, store: store)
            syncMessage = outcome.failed > 0 ? "\(outcome.failed) brief(s) could not be downloaded" : nil
        } catch {
            if error is CancellationError { return }
            offline = true
        }
        render()
    }

    private func render() {
        renderBriefs()
        renderNow()
        renderAsk()
    }

    private func renderBriefs() {
        let episodes = store.episodes()
        let rows = CarContent.briefRows(episodes)
        let byID = Dictionary(uniqueKeysWithValues: episodes.map { (String($0.id), $0) })
        var items: [CPListItem] = rows.compactMap { row -> CPListItem? in
            guard let episode = byID[row.id] else { return nil }
            let downloaded = store.localAudio(for: episode) != nil
            let item = CPListItem(text: row.title, detailText: downloaded ? row.detail : row.detail + " · needs the hub", image: rowArtwork)
            item.accessoryType = .none
            item.isPlaying = CarPlayer.shared.current?.id == episode.id && CarPlayer.shared.isPlaying
            item.handler = { [weak self] _, completion in
                Task { @MainActor in
                    await self?.play(episode, title: row.title)
                    completion()
                }
            }
            return item
        }
        if items.isEmpty {
            let hint = client == nil ? "Open Kitt on your iPhone and connect to the hub" : (offline ? "Hub not reachable. Open Kitt on home Wi-Fi to download them" : "Nothing rendered yet")
            items = [CPListItem(text: "No briefs on this phone", detailText: hint)]
        }
        var sections = [CPListSection(items: items, header: "Briefs", sectionIndexTitle: nil)]
        if let syncMessage { sections.append(CPListSection(items: [CPListItem(text: syncMessage, detailText: nil)])) }
        briefsTab.updateSections(sections)
    }

    private func renderNow() {
        let now = CarContent.now(state, offline: offline)
        var items = [CPListItem(text: now.title, detailText: now.lines.first)]
        for line in now.lines.dropFirst() { items.append(CPListItem(text: line, detailText: nil)) }
        nowTab.updateSections([CPListSection(items: items)])
    }

    private func renderAsk() {
        let items = CarContent.siriPhrases.map { CPListItem(text: $0.title, detailText: $0.detail) }
        askTab.updateSections([CPListSection(items: items, header: "Say to Siri", sectionIndexTitle: nil)])
    }

    private func play(_ episode: Episode, title: String) async {
        guard let source = await HubAccess.source(for: episode, store: store) else {
            let ok = CPAlertAction(title: "OK", style: .default) { [weak self] _ in self?.interface.dismissTemplate(animated: true, completion: nil) }
            interface.presentTemplate(CPAlertTemplate(titleVariants: ["This brief is not on the phone and the hub is not reachable."], actions: [ok]), animated: true, completion: nil)
            return
        }
        CarPlayer.shared.play(episode, title: title, source: source)
        if !(interface.topTemplate is CPNowPlayingTemplate) {
            interface.pushTemplate(CPNowPlayingTemplate.shared, animated: true, completion: nil)
        }
    }
}
