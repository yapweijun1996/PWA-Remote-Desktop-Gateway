/** Bounded real local VNC VIEW ONLY check: metadata only, never pixels or input. */
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {readFile} from 'node:fs/promises';
import {writeArtifact} from '../scripts/atomic-artifact.mjs';

const require = createRequire(import.meta.url);
const url = process.env.RDG_LOCAL_VIEW_URL;
if (url !== 'https://127.0.0.1:32122') throw new Error('Explicit loopback view pilot required');
const output = resolve(process.env.RDG_LOCAL_VIEW_OUTPUT ?? 'qa/implementation/local-mac-view-results.json');
const expectedImage = JSON.parse(await readFile(new URL('./implementation/artifacts.json', import.meta.url), 'utf8')).oci.guacd.localId;
if (!/^sha256:[a-f0-9]{64}$/.test(expectedImage)) throw new Error('Invalid recorded image identity');
if (process.env.RDG_LOCAL_VIEW_GUACD_IMAGE_ID !== expectedImage)
  throw new Error('Reviewed guacd image identity required');
const evidence = {
  scope: 'LOCAL_REAL_VNC_VIEW_ONLY',
  status: 'FAIL',
  testIdentity: true,
  localDockerEndpointPinned: process.env.RDG_LOCAL_DOCKER_ENDPOINT_PINNED === 'true',
  cloudflare: false,
  calibration: false,
  realMac: false,
  screenSharingIdentityVerified: false,
  realVncEndpoint: false,
  target: 'CURRENT_MAC_VIA_HOST_DOCKER_INTERNAL_5900',
  guacdImageId: expectedImage,
  connected: false,
  display: null,
  leaseTeardown: false,
  screenshots: false,
  clipboard: false,
  inputTested: false,
  mode: 'view',
  javascriptErrors: 0,
  unexpectedConsoleErrors: 0
};
let browser, page, phase = 'BROWSER_STARTUP', deadline;
const started = Date.now();
async function run() {
  const {chromium} = require(process.env.RDG_PLAYWRIGHT_MODULE ?? 'playwright');
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.RDG_TEST_CHROMIUM,
    args: ['--ignore-certificate-errors']
  });
  evidence.browserVersion = browser.version();
  const context = await browser.newContext({ignoreHTTPSErrors: true, viewport: {width: 1280, height: 900}});
  context.setDefaultTimeout(15000);
  page = await context.newPage();
  page.on('pageerror', () => { evidence.javascriptErrors++; });
  page.on('console', message => { if (message.type() === 'error') evidence.unexpectedConsoleErrors++; });
  phase = 'SIGNED_BOOTSTRAP';
  await page.goto(url, {waitUntil: 'domcontentloaded'});
  await page.waitForFunction(() => document.getElementById('status')?.textContent === 'READY');
  const diagnostics = await page.evaluate(async () => {
    const response = await fetch('/api/diagnostics', {cache: 'no-store'});
    if (!response.ok) return false;
    const result = await response.json();
    return result.keysyms && Object.keys(result.keysyms).length === 0;
  });
  if (!diagnostics) throw new Error('Pilot calibration must stay unavailable');
  await page.getByRole('button', {name: 'Prepare connection', exact: true}).click();
  await page.locator('#mode').selectOption('view');
  await page.locator('#clipboardConsent').uncheck();
  await page.getByLabel('I agree to control or view this shared desktop.').check();
  phase = 'VIEW_CONNECTION';
  await page.getByRole('button', {name: 'Open desktop', exact: true}).click();
  await page.waitForFunction(() => document.getElementById('status')?.textContent === 'CONNECTED');
  evidence.connected = true;
  phase = 'DISPLAY_DIMENSIONS';
  await page.waitForFunction(() => {
    const display = document.querySelector('#surface .capture > div');
    return display && parseFloat(display.style.width) > 0 && parseFloat(display.style.height) > 0
      && document.querySelector('#surface canvas');
  });
  evidence.display = await page.evaluate(() => {
    const display = document.querySelector('#surface .capture > div');
    return {width: parseFloat(display.style.width), height: parseFloat(display.style.height)};
  });
  if (!await page.locator('#keysBtn').isDisabled() || !await page.locator('#clipboardBtn').isDisabled())
    throw new Error('View-only controls required');
  evidence.realVncEndpoint = true;
  phase = 'LEASE_TEARDOWN';
  await page.getByRole('button', {name: 'End session', exact: true}).click();
  await page.waitForFunction(() => document.getElementById('status')?.textContent === 'READY');
  await page.waitForFunction(async () => {
    const response = await fetch('/api/session', {cache: 'no-store'});
    if (!response.ok) return false;
    const state = await response.json();
    return state.activeDesktop === false && state.nodeActiveDesktops === 0;
  });
  evidence.leaseTeardown = true;
  if (evidence.javascriptErrors !== 0 || evidence.unexpectedConsoleErrors !== 0)
    throw new Error('Browser error');
  evidence.status = 'PASS';
}
try {
  await Promise.race([run(), new Promise((_, reject) => {
    deadline = setTimeout(() => reject(new Error('Pilot deadline')), 55000);
  })]);
} catch {
  evidence.failedPhase = phase;
  if (page && !page.isClosed()) {
    try {
      const state = await page.locator('#status').innerText({timeout: 1000});
      if (/^[A-Z_]{1,40}$/.test(state)) evidence.observedState = state;
    } catch {}
  }
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  if (page && !page.isClosed() && !evidence.leaseTeardown) {
    try {
      await page.getByRole('button', {name: 'End session', exact: true}).click({timeout: 1500});
    } catch {}
  }
  if (browser) {
    try { await browser.close(); }
    catch { evidence.status = 'FAIL'; evidence.failedPhase = 'BROWSER_CLOSE'; process.exitCode = 1; }
  }
  evidence.elapsedMs = Date.now() - started;
  await writeArtifact(output, JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify({
    scope: evidence.scope,
    status: evidence.status,
    connected: evidence.connected,
    nonzeroDisplay: Boolean(evidence.display),
    leaseTeardown: evidence.leaseTeardown,
    realMacIdentityVerified: false
  }));
}
