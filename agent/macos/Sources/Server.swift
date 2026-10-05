import CoreVideo
import Foundation
import Network

struct StreamSettings {
    var maxWidth = 1920
    var fps = 30
    var bitrate = 4_000_000
    /// Tried in order; each attempt has `encoderTimeout` seconds (VideoToolbox creation was seen to hang on the owner's Mac).
    var encoderModes: [EncoderMode] = [.lowLatencyHardware, .hardware, .software]
    /// true: create the encoder before ScreenCaptureKit starts; false: after (the order of the first working build).
    var encoderBeforeCapture = false
    var encoderTimeout: TimeInterval = 5
}

/// Loopback-only WebSocket server for exactly one authenticated client at a time.
final class Server {
    private let listener: NWListener
    private let queue = DispatchQueue(label: "rdg.server")
    private let token: Data
    private let settings: StreamSettings
    private var active: Session?

    init(port: UInt16, token: Data, allowedOrigins: Set<String>, settings: StreamSettings) throws {
        self.token = token; self.settings = settings
        let websocket = NWProtocolWebSocket.Options()
        websocket.autoReplyPing = true
        websocket.maximumMessageSize = 64 * 1024 // client messages are small; clipboard text is capped at 16 KiB
        websocket.setClientRequestHandler(queue) { _, headers in
            // Every browser sends Origin, so an arbitrary web page on this Mac is refused here. The gateway sends none.
            let origin = headers.first { $0.name.caseInsensitiveCompare("Origin") == .orderedSame }?.value
            let allowed = origin.map { allowedOrigins.contains($0) } ?? true
            return NWProtocolWebSocket.Response(status: allowed ? .accept : .reject, subprotocol: nil, additionalHeaders: nil)
        }
        let parameters = NWParameters.tcp
        parameters.defaultProtocolStack.applicationProtocols.insert(websocket, at: 0)
        parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: port)!)
        parameters.allowLocalEndpointReuse = true
        listener = try NWListener(using: parameters)
    }

    func start() {
        listener.newConnectionHandler = { [weak self] connection in self?.accept(connection) }
        listener.stateUpdateHandler = { state in
            switch state {
            case .ready: log("listening on 127.0.0.1:\(self.listener.port?.rawValue ?? 0)")
            case .failed: log("listener failed"); exit(1)
            default: break
            }
        }
        listener.start(queue: queue)
    }

    private func accept(_ connection: NWConnection) {
        guard active == nil else { connection.cancel(); log("refused a second client"); return }
        let session = Session(connection: connection, queue: queue, token: token, settings: settings) { [weak self] ended in
            if self?.active === ended { self?.active = nil }
        }
        active = session
        session.start()
    }
}

/// One client: authenticate, then stream video and accept input under the granted capabilities.
final class Session {
    static let protocolVersion = 1
    private let connection: NWConnection
    private let queue: DispatchQueue
    private let token: Data
    private let settings: StreamSettings
    private let onEnd: (Session) -> Void
    private var authenticated = false, closed = false
    private var control = false
    private var capture: Capture?
    private var encoder: Encoder?
    private var input: Input?
    private let clipboard = Clipboard()
    private var clipboardEnabled = false
    private var statusTimer: DispatchSourceTimer?
    // Backpressure: at most one video message in flight. A dropped frame breaks the H.264 reference chain, so all
    // frames are discarded until the next keyframe, which is requested immediately (re-encoding the last frame if idle).
    private var inFlight = 0, needKeyframe = true, awaitingKeyframe = true
    private var sequence: UInt32 = 0, framesSent = 0, framesDropped = 0, bytesSent = 0

    init(connection: NWConnection, queue: DispatchQueue, token: Data, settings: StreamSettings, onEnd: @escaping (Session) -> Void) {
        self.connection = connection; self.queue = queue; self.token = token; self.settings = settings; self.onEnd = onEnd
    }

    func start() {
        connection.stateUpdateHandler = { [weak self] state in
            if case .failed = state { self?.close("TRANSPORT_FAILED") }
            if case .cancelled = state { self?.close("TRANSPORT_CLOSED") }
        }
        connection.start(queue: queue)
        queue.asyncAfter(deadline: .now() + 2) { [weak self] in
            if let self, !self.authenticated { self.close("AUTH_TIMEOUT") }
        }
        receive()
    }

    private func receive() {
        connection.receiveMessage { [weak self] data, context, _, error in
            guard let self, !self.closed else { return }
            if error != nil { self.close("TRANSPORT_FAILED"); return }
            let metadata = context?.protocolMetadata(definition: NWProtocolWebSocket.definition) as? NWProtocolWebSocket.Metadata
            if metadata?.opcode == .close { self.close("CLIENT_CLOSED"); return }
            if metadata?.opcode == .text, let data,
               let message = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                self.handle(message)
            } else if !self.authenticated {
                self.close("AUTH_FAILED"); return
            }
            if !self.closed { self.receive() }
        }
    }

    private func handle(_ message: [String: Any]) {
        let type = message["t"] as? String
        if !authenticated {
            guard type == "hello", let candidate = message["token"] as? String, Token.matches(candidate, expected: token) else {
                close("AUTH_FAILED"); return
            }
            // The token proved the peer; only now may it learn why it is refused.
            guard message["v"] as? Int == Session.protocolVersion else { fail("PROTOCOL_UNSUPPORTED"); return }
            authenticated = true
            let wantsControl = message["control"] as? Bool ?? false
            clipboardEnabled = wantsControl && (message["clipboard"] as? Bool ?? false)
            log("client authenticated (control requested: \(wantsControl), clipboard: \(clipboardEnabled))")
            startPipeline(wantsControl: wantsControl)
            return
        }
        switch type {
        case "k":
            if control, let keysym = message["s"] as? Int, let down = message["d"] as? Bool, keysym > 0, keysym <= 0x1fff_ffff {
                input?.key(keysym: UInt32(keysym), down: down)
            }
        case "m":
            if control, let x = message["x"] as? Int, let y = message["y"] as? Int, let mask = message["b"] as? Int,
               (0...32767).contains(x), (0...32767).contains(y), (0...31).contains(mask) {
                input?.pointer(x: x, y: y, mask: mask)
            }
        case "w":
            if control, let x = message["x"] as? Int, let y = message["y"] as? Int, let dy = message["dy"] as? Int,
               (0...32767).contains(x), (0...32767).contains(y), dy != 0, (-4000...4000).contains(dy) {
                input?.scroll(x: x, y: y, dy: dy)
            }
        case "release":
            input?.releaseAll()
        case "kf":
            requestKeyframe()
        case "rate":
            if let kbps = message["kbps"] as? Int, (500...12000).contains(kbps) { encoder?.setBitrate(kbps * 1000) }
        case "clip":
            if control, clipboardEnabled, let text = message["text"] as? String {
                send(json: ["t": "clip-result", "ok": clipboard.set(text)])
            }
        case "type":
            if control, let text = message["text"] as? String, !text.isEmpty, text.utf8.count <= 4096 { input?.type(text: text) }
        default:
            break
        }
    }

    private func startPipeline(wantsControl: Bool) {
        let capture = Capture(onFrame: { [weak self] buffer, millis in
            self?.queue.async { self?.encode(buffer, millis: millis) }
        }, onStop: { [weak self] reason in
            self?.queue.async { self?.close(reason) }
        })
        self.capture = capture
        let plan = Capture.plan(maxWidth: settings.maxWidth)
        let settings = self.settings
        let makeEncoder: () async -> Encoder? = { [weak self] in
            await withCheckedContinuation { continuation in
                DispatchQueue.global().async {
                    continuation.resume(returning: Encoder.make(width: plan.width, height: plan.height, fps: settings.fps, bitrate: settings.bitrate,
                                                                modes: settings.encoderModes, timeout: settings.encoderTimeout) { frame in
                        self?.queue.async { self?.send(frame: frame) }
                    })
                }
            }
        }
        Task {
            do {
                var made: Encoder?
                if settings.encoderBeforeCapture {
                    made = await makeEncoder()
                    if made == nil { queue.async { self.fail("ENCODER_UNAVAILABLE") }; return }
                }
                let geometry = try await capture.start(width: plan.width, height: plan.height, fps: settings.fps)
                log("capture started (\(geometry.width)x\(geometry.height), encoder \(settings.encoderBeforeCapture ? "before" : "after") capture)")
                if made == nil {
                    made = await makeEncoder()
                    if made == nil { queue.async { self.fail("ENCODER_UNAVAILABLE") }; return }
                }
                let encoder = made!
                queue.async { self.ready(geometry: geometry, wantsControl: wantsControl, encoder: encoder) }
            } catch AgentError.captureUnavailable(let code) {
                queue.async { self.fail(code) }
            } catch {
                queue.async { self.fail("CAPTURE_FAILED") }
            }
        }
    }

    private func ready(geometry: CaptureGeometry, wantsControl: Bool, encoder: Encoder) {
        guard !closed else { encoder.stop(); return }
        self.encoder = encoder
        var controlReason = "VIEW_ONLY"
        if wantsControl {
            if Input.permitted { control = true; controlReason = "GRANTED"; input = Input(geometry: geometry) }
            else { controlReason = "ACCESSIBILITY_NOT_PERMITTED" }
        }
        if !control { clipboardEnabled = false }
        if clipboardEnabled {
            clipboard.watch(queue: queue) { [weak self] text in self?.send(json: ["t": "clip", "text": text]) }
        }
        send(json: ["t": "ready", "v": Session.protocolVersion, "width": geometry.width, "height": geometry.height, "control": control,
                    "controlReason": controlReason, "clipboard": clipboardEnabled, "encoder": encoder.mode.rawValue])
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now() + 1, repeating: 1)
        timer.setEventHandler { [weak self] in
            guard let self else { return }
            self.send(json: ["t": "status", "secureInput": Input.secureInputActive, "sent": self.framesSent,
                             "dropped": self.framesDropped, "bytes": self.bytesSent])
        }
        timer.resume()
        statusTimer = timer
        requestKeyframe()
    }

    private func encode(_ buffer: CVPixelBuffer, millis: Double) {
        guard !closed, let encoder else { return }
        let force = needKeyframe
        needKeyframe = false
        encoder.encode(buffer, captureMillis: millis, forceKeyframe: force)
    }

    private func requestKeyframe() {
        needKeyframe = true
        encoder?.resetConfig()
        if inFlight == 0 { capture?.repeatLatest() }
    }

    private func send(frame: EncodedFrame) {
        guard !closed else { return }
        if awaitingKeyframe && !frame.isKeyframe { framesDropped += 1; needKeyframe = true; return }
        if inFlight > 0 {
            framesDropped += 1; awaitingKeyframe = true; needKeyframe = true; encoder?.resetConfig(); return
        }
        if let config = frame.config {
            send(json: ["t": "config", "codec": config.codec, "avcc": config.avcC.base64EncodedString(),
                        "width": config.width, "height": config.height])
        }
        var header = Data([1, frame.isKeyframe ? 1 : 0])
        withUnsafeBytes(of: frame.captureMillis.bitPattern.bigEndian) { header.append(contentsOf: $0) }
        sequence &+= 1
        withUnsafeBytes(of: sequence.bigEndian) { header.append(contentsOf: $0) }
        let message = header + frame.data
        if frame.isKeyframe { awaitingKeyframe = false }
        inFlight += 1
        let context = NWConnection.ContentContext(identifier: "video", metadata: [NWProtocolWebSocket.Metadata(opcode: .binary)])
        connection.send(content: message, contentContext: context, isComplete: true, completion: .contentProcessed { [weak self] error in
            guard let self else { return }
            self.inFlight -= 1
            if error != nil { self.close("TRANSPORT_FAILED"); return }
            self.framesSent += 1; self.bytesSent += message.count
            if self.needKeyframe && self.inFlight == 0 { self.capture?.repeatLatest() }
        })
    }

    /// Reports a fixed error code to the client, then closes once it has been written (a cancel would discard it).
    private func fail(_ code: String) {
        guard !closed, let data = try? JSONSerialization.data(withJSONObject: ["t": "error", "code": code]) else { close(code); return }
        let context = NWConnection.ContentContext(identifier: "text", metadata: [NWProtocolWebSocket.Metadata(opcode: .text)])
        connection.send(content: data, contentContext: context, isComplete: true, completion: .contentProcessed { [weak self] _ in
            self?.close(code)
        })
        queue.asyncAfter(deadline: .now() + 1) { [weak self] in self?.close(code) }
    }

    private func send(json: [String: Any]) {
        guard !closed, let data = try? JSONSerialization.data(withJSONObject: json) else { return }
        let context = NWConnection.ContentContext(identifier: "text", metadata: [NWProtocolWebSocket.Metadata(opcode: .text)])
        connection.send(content: data, contentContext: context, isComplete: true, completion: .idempotent)
    }

    private func close(_ reason: String) {
        guard !closed else { return }
        input?.releaseAll() // never leave a key or button down on the Mac
        closed = true
        statusTimer?.cancel(); statusTimer = nil
        clipboard.stop()
        encoder?.stop(); encoder = nil
        if let capture { Task { await capture.stop() } }
        connection.cancel()
        log("session ended: \(reason)")
        onEnd(self)
    }
}

func log(_ message: String) {
    FileHandle.standardError.write(Data("rdg-agent: \(message)\n".utf8))
}
