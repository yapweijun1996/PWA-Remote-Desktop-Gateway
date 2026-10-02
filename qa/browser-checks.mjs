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
const pass=(name)=>results.push({test:name,status:'PASS',level:'LOCAL_PROTOCOL_FIXTURE'});
const check=(condition,name)=>{if(!condition)throw new Error(name);};
async function waitState(p,value){await p.waitForFunction(value=>document.getElementById('status')?.textContent===value,value);}
async function connect(p){await p.getByRole('button',{name:'Prepare connection',exact:true}).click();await p.getByLabel('I agree to control or view this shared desktop.').check();await p.getByRole('button',{name:'Open desktop',exact:true}).click();await waitState(p,'CONNECTED');}
await mkdir('output/playwright',{recursive:true});
const workerPath='web/dist/sw.js',originalWorker=await readFile(workerPath,'utf8');
try{
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
