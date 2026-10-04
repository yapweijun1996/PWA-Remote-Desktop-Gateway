import AppKit
import ApplicationServices
import Carbon
import CoreGraphics
import Foundation

/// Injects keyboard and pointer input as real macOS key codes with explicit modifier flags. Keysyms follow the
/// gateway's existing mapping: Meta_L/R and Super_L/R → Command, Alt_L/R and ISO_Level3_Shift → Option.
/// Nothing typed is logged.
final class Input {
    private let source = CGEventSource(stateID: .privateState)
    private let geometry: CaptureGeometry
    private var pressedKeys = Set<CGKeyCode>()
    private var heldModifiers = Set<CGKeyCode>()
    private var buttons = 0
    private var pointer: CGPoint
    private var lastDown: (time: TimeInterval, point: CGPoint, button: Int, count: Int)?
    private var characterKeys: [Character: (code: CGKeyCode, shift: Bool)] = [:]
    /// Pixels scrolled per wheel click from the browser input layer (which already converts wheel travel to clicks).
    static let pixelsPerWheelClick: Int32 = 15

    static let specialKeys: [UInt32: CGKeyCode] = [
        0xff0d: 36, 0xff8d: 76, 0xff09: 48, 0x0020: 49, 0xff08: 51, 0xff1b: 53, 0xffff: 117, 0xff63: 114,
        0xff50: 115, 0xff57: 119, 0xff55: 116, 0xff56: 121, 0xff51: 123, 0xff53: 124, 0xff54: 125, 0xff52: 126,
        0xffbe: 122, 0xffbf: 120, 0xffc0: 99, 0xffc1: 118, 0xffc2: 96, 0xffc3: 97, 0xffc4: 98, 0xffc5: 100,
        0xffc6: 101, 0xffc7: 109, 0xffc8: 103, 0xffc9: 111,
        // Modifiers
        0xffe1: 56, 0xffe2: 60, 0xffe3: 59, 0xffe4: 62,
        0xffe7: 55, 0xffe8: 54, 0xffeb: 55, 0xffec: 54,
        0xffe9: 58, 0xffea: 61, 0xfe03: 61,
    ]
    static let modifierFlags: [CGKeyCode: CGEventFlags] = [
        55: .maskCommand, 54: .maskCommand, 58: .maskAlternate, 61: .maskAlternate,
        59: .maskControl, 62: .maskControl, 56: .maskShift, 60: .maskShift,
    ]

    init(geometry: CaptureGeometry) {
        self.geometry = geometry
        pointer = CGPoint(x: geometry.displayBounds.midX, y: geometry.displayBounds.midY)
        buildCharacterKeys()
    }

    static var permitted: Bool { AXIsProcessTrusted() }
    static var secureInputActive: Bool { IsSecureEventInputEnabled() }

    private var flags: CGEventFlags {
        heldModifiers.reduce(into: CGEventFlags()) { result, code in result.formUnion(Input.modifierFlags[code] ?? []) }
    }

    // MARK: Keyboard

    func key(keysym: UInt32, down: Bool) {
        if keysym == 0xffe5 { return } // Caps Lock toggles state on the Mac; not forwarded in the prototype
        if let code = Input.specialKeys[keysym] {
            if Input.modifierFlags[code] != nil {
                if down { heldModifiers.insert(code) } else { heldModifiers.remove(code) }
                postModifier(code, down: down)
            } else {
                postKey(code, down: down, extra: [])
            }
            return
        }
        guard let character = Input.character(for: keysym) else { return }
        if let mapped = characterKeys[character] {
            postKey(mapped.code, down: down, extra: mapped.shift ? .maskShift : [])
        } else if down {
            postUnicode(character) // e.g. Chinese: typed as text, modifiers do not apply
        }
    }

    static func character(for keysym: UInt32) -> Character? {
        let scalarValue: UInt32
        if (0x20...0x7e).contains(keysym) || (0xa0...0xff).contains(keysym) { scalarValue = keysym }
        else if keysym & 0xff00_0000 == 0x0100_0000 { scalarValue = keysym & 0x00ff_ffff }
        else { return nil }
        return Unicode.Scalar(scalarValue).map(Character.init)
    }

    private func postKey(_ code: CGKeyCode, down: Bool, extra: CGEventFlags) {
        guard let event = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: down) else { return }
        event.flags = flags.union(extra)
        event.post(tap: .cgSessionEventTap)
        if down { pressedKeys.insert(code) } else { pressedKeys.remove(code) }
    }

    private func postModifier(_ code: CGKeyCode, down: Bool) {
        guard let event = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: down) else { return }
        event.type = .flagsChanged
        event.flags = flags
        event.post(tap: .cgSessionEventTap)
    }

    private func postUnicode(_ character: Character) {
        let units = Array(String(character).utf16)
        for down in [true, false] {
            guard let event = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: down) else { continue }
            units.withUnsafeBufferPointer { event.keyboardSetUnicodeString(stringLength: units.count, unicodeString: $0.baseAddress) }
            event.post(tap: .cgSessionEventTap)
        }
    }

    /// Types text as keystrokes (used for client → Mac text when the pasteboard path is not wanted).
    func type(text: String) {
        for character in text.prefix(4096) {
            if let mapped = characterKeys[character] {
                postKey(mapped.code, down: true, extra: mapped.shift ? .maskShift : [])
                postKey(mapped.code, down: false, extra: mapped.shift ? .maskShift : [])
            } else if character == "\n" {
                postKey(36, down: true, extra: []); postKey(36, down: false, extra: [])
            } else {
                postUnicode(character)
            }
        }
    }

    /// Builds the character → key code table for the current keyboard layout (plain and Shift).
    private func buildCharacterKeys() {
        guard let source = TISCopyCurrentKeyboardLayoutInputSource()?.takeRetainedValue(),
              let raw = TISGetInputSourceProperty(source, kTISPropertyUnicodeKeyLayoutData) else { return }
        let layoutData = Unmanaged<CFData>.fromOpaque(raw).takeUnretainedValue() as Data
        layoutData.withUnsafeBytes { bytes in
            guard let layout = bytes.baseAddress?.assumingMemoryBound(to: UCKeyboardLayout.self) else { return }
            for (shift, modifierState) in [(false, UInt32(0)), (true, UInt32((shiftKey >> 8) & 0xff))] {
                for code in 0..<128 {
                    var deadKeys: UInt32 = 0
                    var length = 0
                    var chars = [UniChar](repeating: 0, count: 4)
                    let status = UCKeyTranslate(layout, UInt16(code), UInt16(kUCKeyActionDown), modifierState, UInt32(LMGetKbdType()),
                                                OptionBits(kUCKeyTranslateNoDeadKeysBit), &deadKeys, 4, &length, &chars)
                    guard status == noErr, length == 1, let scalar = Unicode.Scalar(chars[0]), scalar.value >= 0x20 else { continue }
                    let character = Character(scalar)
                    if characterKeys[character] == nil { characterKeys[character] = (CGKeyCode(code), shift) }
                }
            }
        }
    }

    // MARK: Pointer

    /// x, y are video pixels; mask bits: 1 left, 2 middle, 4 right, 8 wheel up, 16 wheel down (Guacamole convention).
    func pointer(x: Int, y: Int, mask: Int) {
        let bounds = geometry.displayBounds
        let px = bounds.minX + CGFloat(max(0, min(x, geometry.width - 1))) * bounds.width / CGFloat(geometry.width)
        let py = bounds.minY + CGFloat(max(0, min(y, geometry.height - 1))) * bounds.height / CGFloat(geometry.height)
        let point = CGPoint(x: px, y: py)
        let moved = point != pointer
        pointer = point
        let previous = buttons
        for (bit, button) in [(1, CGMouseButton.left), (2, .center), (4, .right)] {
            let was = previous & bit != 0, now = mask & bit != 0
            if was != now { postButton(button, bit: bit, down: now) }
        }
        if mask & 8 != 0 && previous & 8 == 0 { scroll(pixels: Input.pixelsPerWheelClick) }
        if mask & 16 != 0 && previous & 16 == 0 { scroll(pixels: -Input.pixelsPerWheelClick) }
        buttons = mask & 7
        if moved {
            let type: CGEventType = buttons & 1 != 0 ? .leftMouseDragged : buttons & 4 != 0 ? .rightMouseDragged
                : buttons & 2 != 0 ? .otherMouseDragged : .mouseMoved
            if let event = CGEvent(mouseEventSource: source, mouseType: type, mouseCursorPosition: point, mouseButton: .left) {
                event.flags = flags
                event.post(tap: .cgSessionEventTap)
            }
        }
    }

    private func postButton(_ button: CGMouseButton, bit: Int, down: Bool) {
        let type: CGEventType
        switch button {
        case .left: type = down ? .leftMouseDown : .leftMouseUp
        case .right: type = down ? .rightMouseDown : .rightMouseUp
        default: type = down ? .otherMouseDown : .otherMouseUp
        }
        var count = 1
        let now = Date().timeIntervalSince1970
        if down {
            if let last = lastDown, last.button == bit, now - last.time < NSEvent.doubleClickInterval,
               abs(last.point.x - pointer.x) < 4, abs(last.point.y - pointer.y) < 4 { count = last.count + 1 }
            lastDown = (now, pointer, bit, count)
        } else if let last = lastDown, last.button == bit { count = last.count }
        guard let event = CGEvent(mouseEventSource: source, mouseType: type, mouseCursorPosition: pointer, mouseButton: button) else { return }
        event.setIntegerValueField(.mouseEventClickState, value: Int64(count))
        event.flags = flags
        event.post(tap: .cgSessionEventTap)
    }

    func scroll(pixels: Int32) {
        guard let event = CGEvent(scrollWheelEvent2Source: source, units: .pixel, wheelCount: 1, wheel1: pixels, wheel2: 0, wheel3: 0) else { return }
        event.flags = flags
        event.post(tap: .cgSessionEventTap)
    }

    /// Server-side release on disconnect, failure or explicit request: no key or button stays down on the Mac.
    func releaseAll() {
        for code in pressedKeys { postKey(code, down: false, extra: []) }
        pressedKeys.removeAll()
        for code in heldModifiers { heldModifiers.remove(code); postModifier(code, down: false) }
        for (bit, button) in [(1, CGMouseButton.left), (2, .center), (4, .right)] where buttons & bit != 0 {
            postButton(button, bit: bit, down: false)
        }
        buttons = 0
    }
}
