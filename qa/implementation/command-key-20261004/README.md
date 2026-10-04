# Command key code trial (web 1.2.10)

Evidence: with the standard test profile (Command = Meta_L, 0xffe7) the owner's real Mac typed a plain `v` for Remote Paste, so that VNC server did not treat the code as Command. The real code has never been calibrated (docs/03, docs/05). 1.2.10 adds a page-only "Command key code (test)" choice in Remote keys (Server setting, Super, Alt, Hyper, Meta). The owner finds the one that makes Remote Paste work; saving it in the server device configuration is a separate owner-approved change.

`connect-browser-results.json` is a passing 33-case run for this build. Intermittent causes found while preparing it: `SIDEBAR_CAPTURE_NOT_ACTIVE` (focus before the resize handler paused input) and a 50 ms real-timer PWA unit test; both were made robust, but four passing browser runs are weak evidence for a race that appeared roughly once in five to eight runs.
