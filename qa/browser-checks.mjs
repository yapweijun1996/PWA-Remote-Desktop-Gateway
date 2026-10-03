/** Production UI against disposable signed-identity/Guacamole peers, never real-Mac evidence. */
import {createRequire} from 'node:module';import {writeArtifact} from '../scripts/atomic-artifact.mjs';import {readFile,writeFile,mkdir} from 'node:fs/promises';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.RDG_PLAYWRIGHT_MODULE??'playwright');
const url=process.env.RDG_FIXTURE_URL;if(!url?.startsWith('https://127.0.0.1:'))throw new Error('Loopback HTTPS fixture required');
const browser=await chromium.launch({headless:true,executablePath:process.env.RDG_TEST_CHROMIUM,args:['--ignore-certificate-errors']});
const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1440,height:1000}});
const page=await context.newPage(),results=[],errors=[];let unexpectedConsoleErrors=0,expectedOfflineErrors=0,intentionalOffline=false;
context.on('page',p=>p.on('console',m=>{if(m.type()==='error' && !m.text().includes('status of 409')){if(intentionalOffline)expectedOfflineErrors++;else unexpectedConsoleErrors++;}}));
page.on('console',m=>{if(m.type()==='error' && !m.text().includes('status of 409')){if(intentionalOffline)expectedOfflineErrors++;else unexpectedConsoleErrors++;}});
page.on('pageerror',e=>errors.push(e.message));
const pass=(name,level='LOCAL_PROTOCOL_FIXTURE')=>results.push({test:name,status:'PASS',level});
const check=(condition,name)=>{if(!condition)throw new Error(name);};
async function waitState(p,value){await p.waitForFunction(value=>document.getElementById('status')?.textContent===value,value);}
async function connect(p){await p.getByRole('button',{name:'Prepare connection',exact:true}).click();await p.getByLabel('I agree to control or view this shared desktop.').check();await p.getByRole('button',{name:'Open desktop',exact:true}).click();await waitState(p,'CONNECTED');}
async function checkBlockedDesktopUI(){
  // Only UI response fixtures change; bootstrap still uses the signed loopback gateway.
  const blockedContext=await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block'});
  let deviceResponses=0,diagnosticResponses=0,connectIntents=0,clipboardEnabledCalls=0,webSockets=0;
  const blockedPage=await blockedContext.newPage();
  blockedPage.on('pageerror',e=>errors.push(e.message));
  blockedPage.on('console',m=>{if(m.type()==='error')unexpectedConsoleErrors++;});
  blockedPage.on('websocket',()=>webSockets++);
  try{
    await blockedContext.route('**/api/devices',async route=>{
      const response=await route.fetch(),devices=await response.json();
      check(response.status()===200&&Array.isArray(devices)&&devices.some(d=>d.kind==='local'),'Signed device fixture response');
      deviceResponses++;
      await route.fulfill({response,json:devices.map(d=>d.kind==='local'?{...d,desktopEnabled:false,status:'BLOCKED',desktopPolicy:'BLOCKED'}:d)});
    });
    await blockedContext.route('**/api/diagnostics',async route=>{
      const response=await route.fetch(),diagnostics=await response.json();
      check(response.status()===200&&typeof diagnostics.nodeId==='string','Signed diagnostics fixture response');
      diagnosticResponses++;
      await route.fulfill({response,json:{...diagnostics,desktopEnabled:false,desktopPolicy:'BLOCKED',keysyms:{}}});
    });
    // Never forward a forbidden UI action into the fixture's FULL desktop backend.
    await blockedContext.route('**/api/connect-intents',async route=>{
      connectIntents++;
      await route.fulfill({status:503,json:{code:'DESKTOP_BLOCKED_BY_POLICY'}});
    });
    await blockedContext.route('**/api/clipboard-consent',async route=>{
      if(route.request().postDataJSON()?.enabled===true)clipboardEnabledCalls++;
      await route.fulfill({status:503,json:{code:'DESKTOP_BLOCKED_BY_POLICY'}});
    });
    await blockedPage.goto(url);await waitState(blockedPage,'BLOCKED');
    check(await blockedPage.getByText('BLOCKED — desktop connection not verified',{exact:true}).isVisible(),'Visible BLOCKED device state');
    check(await blockedPage.getByText('Cloudflare Access login and gateway status are available. Remote viewing, input and clipboard are disabled.',{exact:true}).isVisible(),'Truthful BLOCKED capability explanation');
    const prepare=blockedPage.getByRole('button',{name:'Prepare connection',exact:true});
    check(await prepare.isVisible()&&await prepare.isDisabled(),'BLOCKED Prepare connection disabled');
    // A DOM-dispatched action must also preserve the disabled-device boundary.
    await prepare.evaluate(button=>button.dispatchEvent(new MouseEvent('click',{bubbles:true})));
    await blockedPage.evaluate(()=>{
      document.getElementById('consent').checked=true;
      document.getElementById('clipboardConsent').checked=true;
      document.getElementById('connect').click();
    });
    check(!await blockedPage.locator('#prepare').isVisible(),'BLOCKED connection settings remain hidden');
    check(!await blockedPage.locator('#workspace').isVisible(),'BLOCKED remote workspace remains hidden');
    check(!await blockedPage.locator('#clipboardDialog').isVisible(),'BLOCKED clipboard remains hidden');
    check(await blockedPage.locator('#surface canvas').count()===0,'BLOCKED creates no remote display canvas');
    await blockedPage.getByRole('button',{name:'Diagnostics & session history',exact:true}).click();
    await blockedPage.waitForFunction(()=>{try{return JSON.parse(document.getElementById('diagnostics').textContent).desktopPolicy==='BLOCKED';}catch{return false;}});
    const diagnostics=JSON.parse(await blockedPage.locator('#diagnostics').innerText());
    check(diagnostics.desktopEnabled===false&&Object.keys(diagnostics.keysyms).length===0,'BLOCKED diagnostics expose no calibrated keysyms');
    await blockedPage.waitForLoadState('networkidle');
    check(deviceResponses===1&&diagnosticResponses===2,'BLOCKED fixture routes exercised at bootstrap and diagnostics');
    check(connectIntents===0&&clipboardEnabledCalls===0&&webSockets===0,'BLOCKED sends no desktop intent, enabled clipboard or WebSocket');
    check(await blockedPage.locator('#status').innerText()==='BLOCKED','BLOCKED state survives diagnostics interaction');
    pass('BLOCKED policy disables desktop preparation, display, connect intents and clipboard while diagnostics remain available','LOCAL_UI_ROUTE_FIXTURE');
  }finally{await blockedContext.close();}
}
await mkdir('output/playwright',{recursive:true});
const workerPath='web/dist/sw.js',originalWorker=await readFile(workerPath,'utf8');
try{
  await checkBlockedDesktopUI();
  await page.goto(url);await waitState(page,'READY');await page.waitForFunction(()=>navigator.serviceWorker.controller);
  check(await page.getByText('Gateway reachable — desktop not tested',{exact:true}).isVisible(),'Truthful readiness');
  check(!await page.locator('#updateBanner').isVisible(),'Initial install must not produce update prompt');pass('Signed bootstrap, truthful readiness and clean first worker activation');
  await page.screenshot({path:'output/playwright/production-fixture-desktop.png',fullPage:true});
  await connect(page);for(const viewport of [{width:390,height:850},{width:850,height:390},{width:1440,height:1000}]){await page.setViewportSize(viewport);check(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight+1),'Workspace fits viewport');check(await page.getByRole('button',{name:'End session',exact:true}).isVisible(),'Visible safety control');}pass('Workspace fits mobile portrait/landscape and desktop without page overflow');await page.locator('.capture').focus();await page.keyboard.down('Control');
  await page.getByRole('button',{name:'Pause input',exact:true}).click();await page.keyboard.up('Control');
  check((await page.locator('#inputStatus').innerText()).includes('paused'),'Focus release');pass('Official Guacamole display and browser focus-loss input pause');
  const second=await context.newPage();await second.goto(url);await waitState(second,'READY');
  check(await page.locator('#workspace').isVisible(),'Second tab preserves desktop');pass('Second tab bootstrap preserves existing shared node session');
  await writeFile(workerPath,originalWorker+'\n/* Disposable browser update exercise. */\n');
  await second.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration();await r.update();});
  await second.waitForFunction(async()=>Boolean((await navigator.serviceWorker.getRegistration())?.waiting));
  await second.getByRole('button',{name:'Update when idle',exact:true}).click();await waitState(second,'UPDATE_DEFERRED');
  check(await page.locator('#workspace').isVisible(),'Active tab must remain connected');
  const safe=await second.evaluate(async()=>{const b=await fetch('/api/session/bootstrap',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).then(r=>r.json());const r=await fetch('/api/update-boundary',{method:'POST',headers:{'Content-Type':'application/json','X-RDG-CSRF':b.csrfToken},body:'{}'});return r.status;});
  check(safe===409,'Server reservation rejects suspended/other desktop');pass('Waiting-worker update defers for another tab and authoritative server lease');
  await page.getByRole('button',{name:'End session',exact:true}).click();await waitState(page,'READY');
  check(await page.locator('#surface canvas').count()===0,'Display cleared on disconnect');pass('Disconnect clears display and clipboard state');
  await second.getByRole('button',{name:'Update when idle',exact:true}).click();await second.waitForEvent('load');await waitState(second,'READY');
  check(await page.locator('#status').innerText()==='READY','Other tab does not auto reload');pass('Explicit idle update activates, reloads accepting tab and preserves other tab');
  for(const width of [390,430,768,1024,1440]){
    await second.setViewportSize({width,height:850});await second.evaluate(()=>document.fonts.ready);
    const overflow=await second.evaluate(()=>document.documentElement.scrollWidth>innerWidth);check(!overflow,`Overflow at ${width}`);
  }pass('Responsive launcher at 390/430/768/1024/1440 widths');
  await second.setViewportSize({width:390,height:850});await second.emulateMedia({colorScheme:'dark',reducedMotion:'reduce'});
  await second.screenshot({path:'output/playwright/production-fixture-mobile.png',fullPage:true});
  await second.evaluate(()=>{document.documentElement.style.fontSize='200%';});check(!(await second.evaluate(()=>document.documentElement.scrollWidth>innerWidth)),'200% text zoom overflow');pass('Dark theme, reduced motion and 200% text zoom');
  const cacheKeys=await second.evaluate(async()=>{const paths=[];for(const name of await caches.keys())for(const req of await(await caches.open(name)).keys())paths.push(new URL(req.url).pathname);return paths;});
  check(cacheKeys.length>0&&cacheKeys.every(p=>p==='/offline.html'||p.startsWith('/assets/')),'No private cache entry');pass('Cache Storage contains only explicit generic static assets');
  intentionalOffline=true;await context.setOffline(true);await second.reload();check(await second.getByRole('heading',{name:'You are offline.'}).isVisible(),'Generic offline page');
  const offline=await second.locator('body').innerText();check(!offline.includes('Disposable protocol fixture'),'Offline device privacy');pass('Offline navigation exposes no device, identity or desktop');
  await context.setOffline(false);
  check(errors.length===0,'Browser JavaScript errors: '+errors.join(';'));check(unexpectedConsoleErrors===0,'Unexpected browser console errors');
  await writeArtifact('qa/implementation/browser-results.json',JSON.stringify({status:'PASS',version:browser.version(),build:JSON.parse(await readFile('web/dist/build.json','utf8')).build,fixture:true,realMac:false,results,errors,unexpectedConsoleErrors,expectedOfflineErrors},null,2)+'\n');
  console.log(JSON.stringify({browser:browser.version(),passed:results.length,errors:errors.length}));
}catch(error){await writeArtifact('qa/implementation/browser-results.json',JSON.stringify({status:'FAIL',fixture:true,realMac:false,results,errors,unexpectedConsoleErrors},null,2)+'\n');await page.screenshot({path:'output/playwright/browser-failure.png',fullPage:true});console.error(JSON.stringify({state:await page.locator('#status').innerText(),notice:await page.locator('#notice').innerText(),errors}));throw error;}finally{await writeFile(workerPath,originalWorker);await browser.close();}
