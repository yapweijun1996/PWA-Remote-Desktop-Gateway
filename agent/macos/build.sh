#!/bin/sh
# Builds the PROTOTYPE host agent as an app bundle with a stable identifier, ad-hoc signed. Starts nothing.
# Avoid needless rebuilds after permissions are granted: a new signature can make macOS ask again.
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
out="${1:-$here/../../.tools/agent}"
app="$out/RDGAgent.app"
rm -rf "$app"; mkdir -p "$app/Contents/MacOS"
swiftc -O -swift-version 5 -target arm64-apple-macos13.0 \
  -framework ScreenCaptureKit -framework VideoToolbox -framework CoreMedia -framework Network -framework AppKit -framework Carbon \
  "$here"/Sources/*.swift -o "$app/Contents/MacOS/rdg-agent"
cat > "$app/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>com.rdg.local.agent</string>
  <key>CFBundleName</key><string>RDG Agent</string>
  <key>CFBundleExecutable</key><string>rdg-agent</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1.0-prototype</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSUIElement</key><true/>
</dict></plist>
PLIST
codesign --force --sign - --identifier com.rdg.local.agent "$app"
codesign --verify --strict "$app"
echo "built $app"
echo "binary sha256 $(shasum -a 256 "$app/Contents/MacOS/rdg-agent" | cut -d ' ' -f1)"
