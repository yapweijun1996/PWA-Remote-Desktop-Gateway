import CoreMedia
import Foundation
import ScreenCaptureKit

struct CaptureGeometry {
    let width: Int            // encoded video size in pixels
    let height: Int
    let displayBounds: CGRect // global display rectangle in points, for mapping pointer input
}

/// Main-display capture. ScreenCaptureKit delivers a complete frame only when content changes, so a static
/// desktop costs no bandwidth. The latest frame is kept so a keyframe can be produced on request while idle.
final class Capture: NSObject, SCStreamOutput, SCStreamDelegate {
    private var stream: SCStream?
    private let queue = DispatchQueue(label: "rdg.capture")
    private let onFrame: (CVPixelBuffer, Double) -> Void
    private let onStop: (String) -> Void
    private let latestLock = NSLock()
    private var latest: CVPixelBuffer?

    init(onFrame: @escaping (CVPixelBuffer, Double) -> Void, onStop: @escaping (String) -> Void) {
        self.onFrame = onFrame; self.onStop = onStop
    }

    func start(maxWidth: Int, fps: Int) async throws -> CaptureGeometry {
        // Preflight never prompts: a remote session must not raise a system dialog. Granting is the explicit
        // --request-permissions setup step.
        guard CGPreflightScreenCaptureAccess() else { throw AgentError.captureUnavailable("SCREEN_RECORDING_NOT_PERMITTED") }
        let content: SCShareableContent
        do { content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true) }
        catch { throw AgentError.captureUnavailable("SCREEN_RECORDING_NOT_PERMITTED") }
        guard let display = content.displays.first(where: { $0.displayID == CGMainDisplayID() }) ?? content.displays.first else {
            throw AgentError.captureUnavailable("NO_DISPLAY")
        }
        let bounds = CGDisplayBounds(display.displayID)
        // Points keep text legible at a fraction of Retina pixel cost; cap the width for bandwidth. Even sizes for H.264.
        let scale = min(1.0, Double(maxWidth) / Double(display.width))
        let width = Int(Double(display.width) * scale) & ~1
        let height = Int(Double(display.height) * scale) & ~1
        let config = SCStreamConfiguration()
        config.width = width
        config.height = height
        config.pixelFormat = kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange
        config.minimumFrameInterval = CMTime(value: 1, timescale: CMTimeScale(fps))
        config.queueDepth = 3
        config.showsCursor = true
        let filter = SCContentFilter(display: display, excludingWindows: [])
        let stream = SCStream(filter: filter, configuration: config, delegate: self)
        try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: queue)
        try await stream.startCapture()
        self.stream = stream
        return CaptureGeometry(width: width, height: height, displayBounds: bounds)
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sample: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen, sample.isValid,
              let attachments = CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
              let raw = attachments.first?[.status] as? Int, SCFrameStatus(rawValue: raw) == .complete,
              let pixelBuffer = CMSampleBufferGetImageBuffer(sample) else { return }
        latestLock.lock(); latest = pixelBuffer; latestLock.unlock()
        onFrame(pixelBuffer, Date().timeIntervalSince1970 * 1000)
    }

    /// Re-delivers the most recent frame (used to answer a keyframe request on a static screen).
    func repeatLatest() {
        latestLock.lock(); let buffer = latest; latestLock.unlock()
        if let buffer { queue.async { self.onFrame(buffer, Date().timeIntervalSince1970 * 1000) } }
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) { onStop("CAPTURE_STOPPED") }

    func stop() async {
        if let stream { try? await stream.stopCapture() }
        stream = nil
        clearLatest()
    }

    private func clearLatest() { latestLock.lock(); latest = nil; latestLock.unlock() }
}
