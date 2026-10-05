// Prints which modifier keys macOS currently considers held: command control option shift. Needs no permission.
import CoreGraphics
let f = CGEventSource.flagsState(.combinedSessionState)
print(f.contains(.maskCommand), f.contains(.maskControl), f.contains(.maskAlternate), f.contains(.maskShift))
