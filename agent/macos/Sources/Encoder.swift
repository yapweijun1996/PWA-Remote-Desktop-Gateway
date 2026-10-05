import CoreMedia
import Foundation
import VideoToolbox

final class EncoderBox { var result: Result<Encoder, Error>? }

struct EncodedFrame {
    let data: Data            // AVCC (length-prefixed NAL units), as WebCodecs expects with an avcC description
    let isKeyframe: Bool
    let captureMillis: Double // wall clock at capture, for end-to-end latency on a shared clock
    let config: StreamConfig? // present on keyframes whose parameter sets changed
}

struct StreamConfig: Equatable {
    let codec: String         // avc1.PPCCLL from the SPS profile, compatibility and level bytes
    let avcC: Data
    let width: Int
    let height: Int
}

enum EncoderMode: String {
    case lowLatencyHardware = "ll"   // hardware, low-latency rate control
    case hardware = "hw"             // hardware, default rate control
    case software = "sw"             // software encoder (no hardware encoder service involved)

    var specification: CFDictionary? {
        switch self {
        case .lowLatencyHardware: return [kVTVideoEncoderSpecification_EnableLowLatencyRateControl as String: true] as CFDictionary
        case .hardware: return nil
        case .software: return [kVTVideoEncoderSpecification_EnableHardwareAcceleratedVideoEncoder as String: false] as CFDictionary
        }
    }
}

/// Real-time H.264: no frame reordering, keyframes on request. Hardware low-latency by default.
final class Encoder {
    private(set) var mode = EncoderMode.lowLatencyHardware
    private var session: VTCompressionSession?
    private let width: Int32, height: Int32
    private let output: (EncodedFrame) -> Void
    private var lastConfig: StreamConfig?
    private let lock = NSLock()

    init(width: Int, height: Int, fps: Int, bitrate: Int, mode: EncoderMode, output: @escaping (EncodedFrame) -> Void) throws {
        self.width = Int32(width); self.height = Int32(height); self.output = output; self.mode = mode
        var created: VTCompressionSession?
        let status = VTCompressionSessionCreate(allocator: nil, width: self.width, height: self.height, codecType: kCMVideoCodecType_H264,
                                                encoderSpecification: mode.specification, imageBufferAttributes: nil, compressedDataAllocator: nil,
                                                outputCallback: nil, refcon: nil, compressionSessionOut: &created)
        guard status == noErr, let session = created else { throw AgentError.encoderUnavailable(status) }
        let properties: [CFString: Any] = [
            kVTCompressionPropertyKey_RealTime: true,
            kVTCompressionPropertyKey_AllowFrameReordering: false,
            kVTCompressionPropertyKey_ProfileLevel: kVTProfileLevel_H264_Main_AutoLevel,
            kVTCompressionPropertyKey_ExpectedFrameRate: fps,
            kVTCompressionPropertyKey_AverageBitRate: bitrate,
            // Measured: a keyframe every 4 s was about 75% of the idle bitrate. The transport is lossless TCP and the
            // session already forces a keyframe on request (new client, dropped frame, decoder error), so a long interval is safe.
            kVTCompressionPropertyKey_MaxKeyFrameInterval: fps * 30,
            kVTCompressionPropertyKey_MaxKeyFrameIntervalDuration: 30,
        ]
        for (key, value) in properties { VTSessionSetProperty(session, key: key, value: value as CFTypeRef) }
        VTCompressionSessionPrepareToEncodeFrames(session)
        self.session = session
    }

    /// Tries each mode in order on its own thread. VTCompressionSessionCreate waits synchronously on a system XPC service; on
    /// the owner's Mac it was seen never to return, so each attempt has a deadline and a stuck attempt is abandoned, not awaited.
    static func make(width: Int, height: Int, fps: Int, bitrate: Int, modes: [EncoderMode], timeout: TimeInterval,
                     output: @escaping (EncodedFrame) -> Void) -> Encoder? {
        for mode in modes {
            let started = Date()
            let done = DispatchSemaphore(value: 0)
            let box = EncoderBox()
            let thread = Thread {
                box.result = Result { try Encoder(width: width, height: height, fps: fps, bitrate: bitrate, mode: mode, output: output) }
                done.signal()
            }
            thread.stackSize = 1 << 20
            thread.start()
            let elapsed = { Int(Date().timeIntervalSince(started) * 1000) }
            if done.wait(timeout: .now() + timeout) == .timedOut {
                log("encoder \(mode.rawValue): no reply within \(Int(timeout)) s, abandoned")
                continue
            }
            switch box.result {
            case .success(let encoder): log("encoder \(mode.rawValue): created in \(elapsed()) ms"); return encoder
            case .failure(let error): log("encoder \(mode.rawValue): failed in \(elapsed()) ms (\(error))")
            case nil: break
            }
        }
        return nil
    }

    /// Adjusts the target while streaming (the client picks Smooth / Balanced / Sharp from its own network measurements).
    func setBitrate(_ bitsPerSecond: Int) {
        guard let session else { return }
        let bps = max(500_000, min(12_000_000, bitsPerSecond))
        VTSessionSetProperty(session, key: kVTCompressionPropertyKey_AverageBitRate, value: bps as CFTypeRef)
        // Peak: 1.5 x the average over one second, in bytes.
        VTSessionSetProperty(session, key: kVTCompressionPropertyKey_DataRateLimits, value: [bps * 3 / 16, 1] as CFArray)
    }

    func encode(_ pixelBuffer: CVPixelBuffer, captureMillis: Double, forceKeyframe: Bool) {
        guard let session else { return }
        let pts = CMTime(value: CMTimeValue(captureMillis * 1000), timescale: 1_000_000)
        let options = forceKeyframe ? [kVTEncodeFrameOptionKey_ForceKeyFrame: true] as CFDictionary : nil
        VTCompressionSessionEncodeFrame(session, imageBuffer: pixelBuffer, presentationTimeStamp: pts, duration: .invalid,
                                        frameProperties: options, infoFlagsOut: nil) { [weak self] status, _, sample in
            guard status == noErr, let sample, let self else { return }
            self.deliver(sample, captureMillis: captureMillis)
        }
    }

    private func deliver(_ sample: CMSampleBuffer, captureMillis: Double) {
        let attachments = CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: false) as? [[CFString: Any]]
        let notSync = attachments?.first?[kCMSampleAttachmentKey_NotSync] as? Bool ?? false
        guard let block = CMSampleBufferGetDataBuffer(sample) else { return }
        let length = CMBlockBufferGetDataLength(block)
        var data = Data(count: length)
        let copied = data.withUnsafeMutableBytes { CMBlockBufferCopyDataBytes(block, atOffset: 0, dataLength: length, destination: $0.baseAddress!) }
        guard copied == kCMBlockBufferNoErr else { return }
        var config: StreamConfig?
        if !notSync, let format = CMSampleBufferGetFormatDescription(sample), let candidate = makeConfig(format) {
            lock.lock()
            if candidate != lastConfig { lastConfig = candidate; config = candidate }
            lock.unlock()
        }
        output(EncodedFrame(data: data, isKeyframe: !notSync, captureMillis: captureMillis, config: config))
    }

    /// The next keyframe always repeats the configuration (a new client needs it).
    func resetConfig() { lock.lock(); lastConfig = nil; lock.unlock() }

    private func makeConfig(_ format: CMFormatDescription) -> StreamConfig? {
        guard let extensions = CMFormatDescriptionGetExtensions(format) as? [CFString: Any],
              let atoms = extensions[kCMFormatDescriptionExtension_SampleDescriptionExtensionAtoms] as? [String: Any],
              let avcC = atoms["avcC"] as? Data, avcC.count > 4 else { return nil }
        let codec = String(format: "avc1.%02X%02X%02X", avcC[1], avcC[2], avcC[3])
        return StreamConfig(codec: codec, avcC: avcC, width: Int(width), height: Int(height))
    }

    func stop() {
        if let session { VTCompressionSessionCompleteFrames(session, untilPresentationTimeStamp: .invalid); VTCompressionSessionInvalidate(session) }
        session = nil
    }
}
