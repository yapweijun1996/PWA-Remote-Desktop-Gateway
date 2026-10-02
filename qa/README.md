# QA evidence index

`acceptance-matrix.csv` is the **future real-system acceptance plan**. All its rows begin NOT_RUN; do not confuse them with reference tests.

`reference-tests.tap` and `pack-validation.txt` record actual checks of this handoff. `prototype-browser-results.json` records local in-memory UI rendering/interactions plus separate loopback HTTP boundary probes. The environment blocked Chromium localhost navigation; no browser policy was changed. HTML/CSS/modules were rendered as an offline DOM fixture. Thus these checks do not prove the browser HTTP/CSP/module-loading path, Windows/Safari, Cloudflare or any real desktop.

The four `screenshots/*.png` are desktop/mobile renders of the labelled prototype, not screenshots of the user's Macs. They give the implementation Agent a visual target.

To rerun basic checks: from the root, `npm test` and `npm run verify`. `npm run preview` launches the loopback-only interactive prototype. The optional Python UI harness needs separately installed Playwright and a local Chromium executable; see its header. It is not a dependency of the application or basic tests. Rerendering QA output changes the corresponding archive hashes; verify the untouched archive first.
