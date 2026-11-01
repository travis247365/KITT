// Renders the Apple TV screens to PNG on the Mac, so layout can be checked against the mockups without a tvOS simulator.
//   TvPreview <output directory>
// The animated top border and name are frozen at the middle of the sweep so every render is the same.
import AppKit
import SwiftUI
import KITTKit

@MainActor
func render<V: View>(_ view: V, to url: URL) {
    let framed = view
        .frame(width: Tv.size.width, height: Tv.size.height)
        .environment(\.tvFrozenPhase, 0.5)
        .environment(\.tvStaticFields, true)
        .environment(\.colorScheme, .dark)
    let renderer = ImageRenderer(content: framed)
    renderer.scale = 1
    guard let image = renderer.nsImage, let tiff = image.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
          let png = rep.representation(using: .png, properties: [:]) else {
        FileHandle.standardError.write(Data("render failed: \(url.lastPathComponent)\n".utf8)); exit(1)
    }
    try! png.write(to: url)
    print("wrote \(url.path)")
}

func state(_ json: String) -> KITTState {
    let decoder = JSONDecoder(); decoder.keyDecodingStrategy = .convertFromSnakeCase
    return try! decoder.decode(KITTState.self, from: Data(json.utf8))
}

let out = URL(fileURLWithPath: CommandLine.arguments.dropFirst().first ?? ".", isDirectory: true)
try? FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
for name in ["Orbitron-Bold.ttf"] {
    let font = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("KITTtv/Fonts/\(name)")
    CTFontManagerRegisterFontsForURL(font as CFURL, .process, nil)
}

let skills = """
"skills":{
 "security":{"name":"Security","ok":true,"detail":"gh and vercel present; last run today 06:10"},
 "chief":{"name":"Chief of Staff","ok":true,"detail":"board reachable, 5 items overdue"},
 "money":{"name":"Money","ok":true,"detail":"ledger ready; last entry Sat 14:31"},
 "receptionist":{"name":"Inbox","ok":true,"detail":"0 need a reply, 19 for information"},
 "whatsapp":{"name":"WhatsApp","ok":true,"detail":"linked and receiving"}}
"""
let brief = #""briefs":{"morning":{"at":"2026-11-01T05:00:00.000Z","text":"Two items are due today and cash is steady. One finding needs a look before noon, and nothing is waiting on you."}}"#
let cov = #""coverage":{"days":7,"uptime_pct":93.6}"#
// a fixed time so renders are repeatable
let fixed = Calendar.current.date(from: DateComponents(year: 2026, month: 11, day: 1, hour: 7, minute: 12))!

let green = state(#"{"version":"0.2.0",\#(skills),\#(brief),\#(cov)}"#)
let amber = state(#"{"version":"0.2.0","skills":{"security":{"name":"Security","ok":true,"detail":"gh and vercel present"},"chief":{"name":"Chief of Staff","ok":true,"detail":"board reachable"},"money":{"name":"Money","ok":true,"detail":"ledger ready"},"receptionist":{"name":"Inbox","ok":true,"detail":"0 need a reply"},"whatsapp":{"name":"WhatsApp","ok":false,"detail":"listener stopped; scan the QR again"}},\#(cov)}"#)
let critical = state(#"{"version":"0.2.0","skills":{"security":{"name":"Security","ok":false,"detail":"gh is missing, so repositories are not being watched"},"chief":{"name":"Chief of Staff","ok":true,"detail":"board reachable"},"money":{"name":"Money","ok":true,"detail":"ledger ready"},"receptionist":{"name":"Inbox","ok":true,"detail":"0 need a reply"},"whatsapp":{"name":"WhatsApp","ok":true,"detail":"linked and receiving"}},\#(cov)}"#)
let pending = state(#"{"version":"0.2.0",\#(skills),"pending":[{"code":"42","source":"siri","skill":"receptionist","summary":"Draft reply to the insurance broker","created_at":"2026-11-01T07:00:00.000Z","expires_at":"2099-01-01T00:00:00.000Z"}],\#(cov)}"#)

MainActor.assumeIsolated {
    render(NowScreen(glance: green.glance(), clock: fixed).environment(\.tvPreviewFocus, "chief"), to: out.appendingPathComponent("now-green.png"))
    render(NowScreen(glance: amber.glance(), clock: fixed).environment(\.tvPreviewFocus, "whatsapp"), to: out.appendingPathComponent("now-amber.png"))
    render(NowScreen(glance: critical.glance(), clock: fixed).environment(\.tvPreviewFocus, "security"), to: out.appendingPathComponent("now-critical.png"))
    render(NowScreen(glance: green.glance(offline: true), clock: fixed, offline: true, lastUpdated: fixed.addingTimeInterval(-1800)).environment(\.tvPreviewFocus, "chief"), to: out.appendingPathComponent("now-offline.png"))
    render(NowScreen(glance: pending.glance(), clock: fixed).environment(\.tvPreviewFocus, "review"), to: out.appendingPathComponent("now-pending.png"))
    render(AskScreen(summary: pending.glance().pendingSummary ?? "", expiresAt: nil, clock: fixed, level: .amber).environment(\.tvPreviewFocus, "cancel"), to: out.appendingPathComponent("ask.png"))
    render(AskScreen(summary: pending.glance().pendingSummary ?? "", expiresAt: nil, clock: fixed, level: .critical, outcome: "Draft saved in Gmail, not sent.").environment(\.tvPreviewFocus, "done"), to: out.appendingPathComponent("ask-done-critical.png"))
    render(DetailScreen(tile: amber.glance().tiles.last!, level: .amber, clock: fixed), to: out.appendingPathComponent("detail.png"))
    var address = "https://kitt-mac.example.ts.net", token = "0123456789abcdef"
    render(ConnectScreen(address: Binding(get: { address }, set: { address = $0 }), token: Binding(get: { token }, set: { token = $0 })).environment(\.tvPreviewFocus, "connect"), to: out.appendingPathComponent("connect.png"))
}
