import AppKit
import Foundation

// PROTOTYPE host agent: loopback only, one authenticated client, view-only unless control is requested and the
// Accessibility permission exists. Not a production component until the feasibility exit criteria are met.
var port: UInt16 = 5960
var tokenPath = Token.defaultPath()
var origins = Set<String>()
var settings = StreamSettings()
var initTokenOnly = false
var requestPermissions = false
var arguments = CommandLine.arguments.dropFirst().makeIterator()
while let argument = arguments.next() {
    switch argument {
    case "--port": port = UInt16(arguments.next() ?? "") ?? port
    case "--token-file": tokenPath = arguments.next() ?? tokenPath
    case "--allow-origin": if let origin = arguments.next(), origin.hasPrefix("http://127.0.0.1:") || origin.hasPrefix("http://localhost:") { origins.insert(origin) }
    case "--max-width": settings.maxWidth = Int(arguments.next() ?? "") ?? settings.maxWidth
    case "--fps": settings.fps = max(1, min(60, Int(arguments.next() ?? "") ?? settings.fps))
    case "--bitrate": settings.bitrate = Int(arguments.next() ?? "") ?? settings.bitrate
    // Diagnostics for the VideoToolbox hang: --encoder-modes ll,hw,sw  --encoder-order before|after  --create-timeout 5
    case "--encoder-modes": settings.encoderModes = (arguments.next() ?? "").split(separator: ",").compactMap { EncoderMode(rawValue: String($0)) }
    case "--encoder-order": settings.encoderBeforeCapture = (arguments.next() == "before")
    case "--create-timeout": settings.encoderTimeout = TimeInterval(arguments.next() ?? "") ?? settings.encoderTimeout
    case "--init-token": initTokenOnly = true
    case "--request-permissions": requestPermissions = true
    default: log("unknown argument refused"); exit(2)
    }
}
if requestPermissions {
    // Explicit owner setup: shows the Screen Recording and Accessibility requests for this app bundle (launch it
    // with `open` so macOS attributes the permission to RDG Agent, not to Terminal).
    let screen = CGPreflightScreenCaptureAccess() || CGRequestScreenCaptureAccess()
    let accessibility = AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary)
    log("screen recording permitted: \(screen); accessibility permitted: \(accessibility)")
    exit(0)
}
do {
    try Token.createIfAbsent(at: tokenPath)
    if initTokenOnly { log("token file ready (contents not shown)"); exit(0) }
    let token = try Token.load(from: tokenPath)
    let server = try Server(port: port, token: token, allowedOrigins: origins, settings: settings)
    server.start()
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    app.run()
} catch {
    log("startup refused: \(error)")
    exit(1)
}
