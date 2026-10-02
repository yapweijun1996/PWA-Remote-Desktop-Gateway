# Offline interface prototype

From the archive root, run `npm run preview` and open the loopback URL printed in the terminal. No npm dependency download is required. Stop with Ctrl+C in that terminal.

It demonstrates device cards, workspace layout, three keyboard profiles, logical-key ownership, virtual modifiers/chords and release controls. It does not connect to your Mac or Cloudflare, and has no live authentication, clipboard transport, VNC keysym calibration or service worker. Both devices are Unverified.

Test harmless keys only in the labelled area. The trace is held in memory, never sent or saved, and clears on end/visibility loss. Do not type passwords. Real IME/AltGr and OS-reserved keyboard behavior are not implemented or validated by this reference.

Screenshots in `qa/screenshots/`, when present, render this prototype's example content. They are not screenshots of the owner's Mac or evidence of deployment.
