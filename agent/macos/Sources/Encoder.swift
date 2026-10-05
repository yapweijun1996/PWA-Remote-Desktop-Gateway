import CoreMedia
import Foundation
import VideoToolbox

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

/// Real-time hardware H.264: no frame reordering, low-latency rate control when available, keyframes on request.
final class Encoder {
    private var session: VTCompressionSession?
    private let width: Int32, height: Int32
    private let output: (EncodedFrame) -> Void
    private var lastConfig: StreamConfig?
    private let lock = NSLock()

    init(width: Int, height: Int, fps: Int, bitrate: Int, output: @escaping (EncodedFrame) -> Void) throws {
        self.width = Int32(width); self.height = Int32(height); self.output = output
        var created: VTCompressionSession?
        let lowLatency = [kVTVideoEncoderSpecification_EnableLowLatencyRateControl as String: true] as CFDictionary
        var status = VTCompressionSessionCreate(allocator: nil, width: self.width, height: self.height, codecType: kCMVideoCodecType_H264,
                                                encoderSpecification: lowLatency, imageBufferAttributes: nil, compressedDataAllocator: nil,
                                                outputCallback: nil, refcon: nil, compressionSessionOut: &created)
        if status != noErr {
            status = VTCompressionSessionCreate(allocator: nil, width: self.width, height: self.height, codecType: kCMVideoCodecType_H264,
                                                encoderSpecification: nil, imageBufferAttributes: nil, compressedDataAllocator: nil,
                                                outputCallback: nil, refcon: nil, compressionSessionOut: &created)
        }
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
