// Window owner names, layers and sizes only: no titles, no contents, no pixels.
import CoreGraphics
import Foundation
let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]] ?? []
let wantsAll = CommandLine.arguments.dropFirst().first == "--all"
var seen = Set<String>()
for w in list {
    let owner = w[kCGWindowOwnerName as String] as? String ?? "?"
    let layer = w[kCGWindowLayer as String] as? Int ?? 0
    let b = w[kCGWindowBounds as String] as? [String: CGFloat] ?? [:]
    let size = "\(Int(b["Width"] ?? 0))x\(Int(b["Height"] ?? 0))"
    let key = "\(owner)|\(layer)|\(size)"
    if seen.contains(key) { continue }
    if wantsAll ? owner.contains("Spotlight") : (layer > 0 && (b["Width"] ?? 0) > 120 && (b["Height"] ?? 0) > 60) {
        seen.insert(key); print("layer \(layer)  \(owner)  \(size)")
    }
}
