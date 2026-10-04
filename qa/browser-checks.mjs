/** Production UI against disposable signed-identity/Guacamole peers, never real-Mac evidence. */
import {createRequire} from 'node:module';import {writeArtifact} from '../scripts/atomic-artifact.mjs';import {readFile,writeFile,mkdir} from 'node:fs/promises';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.RDG_PLAYWRIGHT_MODULE??'playwright');
const url=process.env.RDG_FIXTURE_URL;if(!url?.startsWith('https://127.0.0.1:'))throw new Error('Loopback HTTPS fixture required');
const target=process.env.RDG_BROWSER_CHECK_TARGET??'ALL';if(!['ALL','OWNER_SETUP_UI'].includes(target))throw new Error('Unsupported browser check target');
const browser=await chromium.launch({headless:true,executablePath:process.env.RDG_TEST_CHROMIUM,args:['--ignore-certificate-errors']});
const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1440,height:1000}});
const page=await context.newPage(),results=[],errors=[];let unexpectedConsoleErrors=0,expectedOfflineErrors=0,expectedUiErrors=0,intentionalOffline=false;
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
async function checkOwnerSetupUI(){
  // These routes prove UI behavior only: no credential store, trusted-cookie crypto or real VNC.
  const uiContext=await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block',viewport:{width:390,height:850}});
  const uiPage=await uiContext.newPage();uiPage.setDefaultTimeout(10000);
  const fixturePassword='FIXTURE_ONLY_VNC_PASSWORD';
  const currentId='fixture-current-device',otherId='fixture-other-device';
  let configured=false,credentialMode='INVALID_CREDENTIAL',credentialRequests=0,credentialShapeValid=true,credentialCsrfPresent=true;
  let intentionalResponseError=false,revokeFails=true,loginNavigations=0;
  let bootstrapRequests=0,expireSessionOnce=false,freshBootstrapIssued=false,freshCsrfUsed=true,desktopCleanupCalls=0,connectIntents=0,webSockets=0;
  const freshFixtureCsrf='F'.repeat(43),logoutFixtureCsrf='L'.repeat(43);
  let logoutMode='UNUSED',logoutBootstrapIssued=false,logoutFreshCsrfUsed=false;
  const logoutEvents=[];
  let trustedDevices=[{id:currentId,createdAt:'2026-10-03T00:00:00Z',expiresAt:'2027-10-03T00:00:00Z',current:true},{id:otherId,createdAt:'2026-10-03T00:00:00Z',expiresAt:'2027-10-03T00:00:00Z',current:false}];
  const revokedIds=[];
  let notifyCredentialSubmit,releaseCredentialResponse;
  const credentialSubmitted=new Promise(resolve=>{notifyCredentialSubmit=resolve;});
  const credentialRelease=new Promise(resolve=>{releaseCredentialResponse=resolve;});
  const flags=()=>({credentialSetupEnabled:true,credentialConfigured:configured,desktopEnabled:configured,desktopPolicy:'OWNER_SETUP',keyboardCalibration:'UNVERIFIED_TEST_PROFILE'});
  uiPage.on('pageerror',e=>errors.push(e.message));
  uiPage.on('websocket',()=>webSockets++);
  uiPage.on('console',message=>{if(message.type()==='error'){if(intentionalResponseError)expectedUiErrors++;else unexpectedConsoleErrors++;}});
  const noPasswordStorage=()=>uiPage.evaluate(()=>[localStorage,sessionStorage].every(storage=>storage.length===0));
  try{
    await uiContext.route('**/api/session/bootstrap',async route=>{
      const response=await route.fetch(),session=await response.json();
      check(response.status()===200&&typeof session.csrfToken==='string','OWNER_SETUP signed bootstrap fixture');
      bootstrapRequests++;if(logoutBootstrapIssued)logoutEvents.push('BOOTSTRAP');
      // A declared UI-only token makes fresh application-state use observable without retaining a real token.
      await route.fulfill({response,json:logoutBootstrapIssued?{...session,csrfToken:logoutFixtureCsrf}:freshBootstrapIssued?{...session,csrfToken:freshFixtureCsrf}:session});
    });
    await uiContext.route('**/api/session',async route=>{
      if(expireSessionOnce&&route.request().method()==='GET'){expireSessionOnce=false;await route.fulfill({status:401,json:{code:'SESSION_EXPIRED'}});return;}
      if(route.request().method()==='DELETE'){
        if(logoutMode==='FAIL'){await route.fulfill({status:503,json:{code:'FIXTURE_UNSAFE_ERROR',message:'FIXTURE_DETAIL_MUST_NOT_BE_RENDERED'}});return;}
        if(logoutMode==='EXPIRE'){logoutEvents.push('DELETE_EXPIRED');logoutMode='RETRY';logoutBootstrapIssued=true;await route.fulfill({status:401,json:{code:'SESSION_EXPIRED'}});return;}
        if(logoutMode==='RETRY'){logoutEvents.push('DELETE_SUCCESS');logoutFreshCsrfUsed=route.request().headers()['x-rdg-csrf']===logoutFixtureCsrf;await route.fulfill({status:204});return;}
      }
      await route.continue();
    });
    await uiContext.route('**/api/desktop-session',async route=>{
      check(route.request().method()==='DELETE','UI fixture only performs desktop cleanup');desktopCleanupCalls++;await route.fulfill({status:204});
    });
    await uiContext.route('**/api/connect-intents',async route=>{
      connectIntents++;await route.fulfill({status:503,json:{code:'FIXTURE_CONNECT_REFUSED'}});
    });
    await uiContext.route('**/api/devices',async route=>{
      const response=await route.fetch(),devices=await response.json();
      check(response.status()===200&&Array.isArray(devices)&&devices.some(item=>item.kind==='local'),'OWNER_SETUP signed device fixture');
      await route.fulfill({response,json:devices.map(item=>item.kind==='local'?{...item,...flags(),status:configured?'GATEWAY_REACHABLE':'BLOCKED'}:item)});
    });
    await uiContext.route('**/api/diagnostics',async route=>{
      const response=await route.fetch(),diagnostics=await response.json();
      check(response.status()===200&&typeof diagnostics.nodeId==='string','OWNER_SETUP signed diagnostics fixture');
      await route.fulfill({response,json:{...diagnostics,...flags(),trustedDevicesEnabled:true}});
    });
    await uiContext.route('**/api/desktop/credential',async route=>{
      credentialRequests++;
      const request=route.request(),body=request.postDataJSON();
      credentialShapeValid&&=request.method()==='POST'&&Object.keys(body??{}).length===1&&body.password===fixturePassword;
      credentialCsrfPresent&&=typeof request.headers()['x-rdg-csrf']==='string';
      if(credentialMode==='DELAYED_SUCCESS'){
        notifyCredentialSubmit();await credentialRelease;configured=true;
        await route.fulfill({status:200,json:flags()});return;
      }
      const status=credentialMode==='INVALID_CREDENTIAL'?400:credentialMode==='CONTROL_BUSY'?409:503;
      await route.fulfill({status,json:{code:credentialMode,message:'FIXTURE_DETAIL_MUST_NOT_BE_RENDERED'}});
    });
    await uiContext.route('**/api/trusted-devices',route=>route.fulfill({status:200,json:{devices:trustedDevices}}));
    await uiContext.route('**/api/trusted-devices/*',async route=>{
      const id=new URL(route.request().url()).pathname.split('/').at(-1);
      check(route.request().method()==='DELETE'&&[currentId,otherId].includes(id),'Trusted fixture DELETE target');
      freshCsrfUsed&&=route.request().headers()['x-rdg-csrf']===freshFixtureCsrf;
      if(revokeFails){await route.fulfill({status:503,json:{code:'FIXTURE_UNSAFE_ERROR',message:'FIXTURE_DETAIL_MUST_NOT_BE_RENDERED'}});return;}
      revokedIds.push(id);trustedDevices=trustedDevices.filter(device=>device.id!==id);await route.fulfill({status:204});
    });
    await uiContext.route('**/login',async route=>{
      loginNavigations++;await route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><html lang="en"><title>UI fixture sign-in</title><h1>UI fixture sign-in</h1></html>'});
    });
    await uiPage.goto(url);await waitState(uiPage,'CREDENTIAL_REQUIRED');await uiPage.waitForLoadState('networkidle');
    const password=uiPage.getByLabel('Screen Sharing VNC password',{exact:true});
    check(await password.isVisible()&&await uiPage.getByRole('button',{name:'Prepare connection',exact:true}).isDisabled(),'Missing credential shows password form and disables preparation');
    check(await password.getAttribute('autocomplete')==='off'&&await uiPage.locator('#credentialForm').getAttribute('autocomplete')==='off','Password form disables autofill persistence');
    await password.fill(fixturePassword);await uiPage.evaluate(()=>window.dispatchEvent(new Event('blur')));
    check(await password.inputValue()==='','Window blur clears unsaved password');
    await password.fill(fixturePassword);await uiPage.evaluate(()=>{
      Object.defineProperty(document,'hidden',{configurable:true,value:true});
      try{document.dispatchEvent(new Event('visibilitychange'));}finally{delete document.hidden;}
    });
    check(await password.inputValue()===''&&await noPasswordStorage(),'Hidden-page event clears password without browser storage');
    pass('OWNER_SETUP missing-credential form clears on blur and hide without browser password storage','LOCAL_UI_ROUTE_FIXTURE');
    const failures=[['INVALID_CREDENTIAL','Enter a valid Screen Sharing VNC password.'],['CONTROL_BUSY','End the active desktop session before changing its password.'],['CREDENTIAL_STORE_UNAVAILABLE','The desktop password could not be saved. Try again.'],['FIXTURE_UNKNOWN_FAILURE','The desktop password could not be saved. Verify access and try again.']];
    for(const [code,message] of failures){
      credentialMode=code;intentionalResponseError=true;await password.fill(fixturePassword);
      await uiPage.getByRole('button',{name:'Save desktop password',exact:true}).click();
      await uiPage.waitForFunction(value=>document.getElementById('credentialStatus').textContent===value,message);
      await uiPage.waitForLoadState('networkidle');intentionalResponseError=false;
      check(await password.inputValue()===''&&await noPasswordStorage(),'Credential rejection clears password and avoids storage');
      check(!(await uiPage.locator('body').innerText()).includes('FIXTURE_DETAIL_MUST_NOT_BE_RENDERED'),'Credential server detail never rendered');
    }
    pass('OWNER_SETUP maps credential failures to fixed messages without echoing password or server detail','LOCAL_UI_ROUTE_FIXTURE');
    credentialMode='DELAYED_SUCCESS';await password.fill(fixturePassword);
    await uiPage.getByRole('button',{name:'Save desktop password',exact:true}).click();
    let submitDeadline;
    try{await Promise.race([credentialSubmitted,new Promise((_,reject)=>{submitDeadline=setTimeout(()=>reject(new Error('Fixture credential submit timeout')),10000);})]);}finally{clearTimeout(submitDeadline);}
    check(await password.inputValue()===''&&await uiPage.getByRole('button',{name:'Save desktop password',exact:true}).isDisabled(),'Password cleared before credential response is released');
    check(await noPasswordStorage()&&credentialRequests===5&&credentialShapeValid&&credentialCsrfPresent,'UI credential requests keep expected JSON and CSRF shape without password storage');
    releaseCredentialResponse();await waitState(uiPage,'READY');
    check(!await uiPage.locator('#credentialSetup').isVisible()&&await uiPage.locator('#prepare').isVisible(),'Configured OWNER_SETUP directly displays connection settings');
    check(!await uiPage.getByRole('button',{name:'Prepare connection',exact:true}).isDisabled(),'Configured desktop preparation enabled');
    check(await uiPage.locator('#mode option').evaluateAll(options=>options.map(option=>option.value).join(','))==='control,view','Control and view options available together');
    check(await uiPage.getByLabel('Enable explicit plain text clipboard for this connection (up to 16 KiB).').isVisible()&&!await uiPage.getByLabel('I agree to control or view this shared desktop.').isChecked(),'Clipboard available while shared-desktop consent remains explicit');
    check((await uiPage.locator('#profileHelp').innerText()).includes('Standard profile — shortcuts awaiting your test.'),'Unverified standard keyboard profile remains truthful');
    check(!await uiPage.locator('#workspace').isVisible()&&await uiPage.locator('#surface canvas').count()===0,'Saving a password does not auto-connect');
    await uiPage.getByRole('button',{name:'Change desktop password',exact:true}).click();
    check(await password.isVisible()&&await password.inputValue()==='','Change-password form starts empty');
    await uiPage.getByRole('button',{name:'Cancel',exact:true}).click();
    pass('OWNER_SETUP credential success opens control, view and explicit clipboard settings without auto-connecting','LOCAL_UI_ROUTE_FIXTURE');
    const bootstrapBeforeExpiry=bootstrapRequests;
    expireSessionOnce=true;freshBootstrapIssued=true;intentionalResponseError=true;
    await uiPage.evaluate(()=>{
      Object.defineProperty(document,'hidden',{configurable:true,value:false});
      try{document.dispatchEvent(new Event('visibilitychange'));}finally{delete document.hidden;}
    });
    await waitState(uiPage,'REAUTH_REQUIRED');await uiPage.waitForLoadState('networkidle');intentionalResponseError=false;
    check(!expireSessionOnce&&desktopCleanupCalls===0&&await uiPage.locator('#reauth').isVisible(),'Expiry without a tab-owned intent stops locally without ending another tab and offers retry');
    await uiPage.locator('#reauth').click();await waitState(uiPage,'READY');await uiPage.waitForLoadState('networkidle');
    check(bootstrapRequests===bootstrapBeforeExpiry+1&&loginNavigations===0&&uiPage.url()===new URL('/',url).href,'Still-trusted UI uses a fresh application bootstrap without returning to login');
    check(await uiPage.locator('#prepare').isVisible()&&!await uiPage.getByRole('button',{name:'Prepare connection',exact:true}).isDisabled(),'Fresh application session restores owner desktop preparation');
    check(!await uiPage.locator('#workspace').isVisible()&&await uiPage.locator('#surface canvas').count()===0&&connectIntents===0&&webSockets===0,'Expired desktop is never automatically reconnected');
    pass('OWNER_SETUP short session expiry bootstraps again with valid trust without login or automatic desktop reconnect','LOCAL_UI_ROUTE_FIXTURE');
    await uiPage.getByRole('button',{name:'Trusted devices',exact:true}).click();
    await uiPage.waitForFunction(()=>document.querySelectorAll('#trustedDevicesList li').length===2);
    const list=uiPage.locator('#trustedDevicesList');
    check((await list.innerText()).includes(currentId+' · This browser')&&(await list.innerText()).includes(otherId)&&(await list.innerText()).includes('Expires')&&!(await list.innerText()).includes('Unavailable'),'Trusted list displays fixture opaque IDs, current browser and expiry');
    intentionalResponseError=true;await uiPage.getByRole('button',{name:'Revoke trusted device '+otherId,exact:true}).click();
    await uiPage.waitForFunction(()=>document.getElementById('trustedDevicesStatus').textContent==='The trusted device could not be revoked. Verify access and try again.');
    await uiPage.waitForLoadState('networkidle');intentionalResponseError=false;
    check(!(await uiPage.locator('body').innerText()).includes('FIXTURE_UNSAFE_ERROR')&&!(await uiPage.locator('body').innerText()).includes('FIXTURE_DETAIL_MUST_NOT_BE_RENDERED'),'Trusted revocation failure uses fixed error only');
    revokeFails=false;await uiPage.getByRole('button',{name:'Revoke trusted device '+otherId,exact:true}).click();
    await uiPage.waitForFunction(()=>document.querySelectorAll('#trustedDevicesList li').length===1);
    check(loginNavigations===0&&revokedIds.length===1&&revokedIds[0]===otherId,'Revoking another fixture browser keeps this UI active');
    await uiPage.getByRole('button',{name:'Revoke trusted device '+currentId,exact:true}).click();
    await uiPage.waitForURL(new URL('/login',url).href);
    check(freshCsrfUsed,'Trusted fixture mutations consume the refreshed application token');
    check(loginNavigations===1&&revokedIds.length===2&&revokedIds[1]===currentId&&await uiPage.getByRole('heading',{name:'UI fixture sign-in',exact:true}).isVisible(),'Current fixture revocation navigates to fixed login path');
    pass('Trusted-device UI lists expiry/current metadata, maps failures and returns current revocation to login','LOCAL_UI_ROUTE_FIXTURE');
    await uiPage.goto(url);await waitState(uiPage,'READY');await uiPage.waitForLoadState('networkidle');
    const bootstrapBeforeLogout=bootstrapRequests;logoutMode='FAIL';intentionalResponseError=true;
    await uiPage.locator('#logout').click();await waitState(uiPage,'REAUTH_REQUIRED');await uiPage.waitForLoadState('networkidle');intentionalResponseError=false;
    check(await uiPage.locator('#notice').innerText()==='Sign out could not be confirmed. Verify access and try again.','Unconfirmed signout uses a fixed honest message');
    check(loginNavigations===1&&uiPage.url()===new URL('/',url).href&&bootstrapRequests===bootstrapBeforeLogout,'Generic signout failure does not redirect or claim revocation');
    check(!(await uiPage.locator('body').innerText()).includes('FIXTURE_UNSAFE_ERROR')&&!(await uiPage.locator('body').innerText()).includes('FIXTURE_DETAIL_MUST_NOT_BE_RENDERED'),'Signout failure never renders server details');
    logoutMode='EXPIRE';intentionalResponseError=true;await uiPage.locator('#logout').click();
    await uiPage.waitForURL(new URL('/login',url).href);await uiPage.waitForLoadState('networkidle');intentionalResponseError=false;
    check(logoutEvents.join(',')==='DELETE_EXPIRED,BOOTSTRAP,DELETE_SUCCESS'&&logoutFreshCsrfUsed&&bootstrapRequests===bootstrapBeforeLogout+1,'Expired signout obtains fresh application CSRF and retries revocation before navigation');
    check(loginNavigations===2&&await uiPage.getByRole('heading',{name:'UI fixture sign-in',exact:true}).isVisible(),'Confirmed signout returns to the fixed enrollment path');
    pass('Trusted signout keeps generic failures visible and refreshes an expired application before successful revocation and login','LOCAL_UI_ROUTE_FIXTURE');
  }finally{releaseCredentialResponse();await uiContext.close();}
}
if(target==='OWNER_SETUP_UI'){
  try{
    await checkOwnerSetupUI();check(errors.length===0&&unexpectedConsoleErrors===0,'OWNER_SETUP fixture browser errors');
    console.log(JSON.stringify({status:'PASS',scope:'LOCAL_UI_ROUTE_FIXTURE',browser:browser.version(),fixture:true,realMac:false,realAccess:false,credentialStoreTested:false,trustedCryptoTested:false,results,errors:errors.length,unexpectedConsoleErrors,expectedUiErrors}));
  }catch{
    console.error(JSON.stringify({status:'FAIL',scope:'LOCAL_UI_ROUTE_FIXTURE',reason:'OWNER_SETUP_UI_CHECK_FAILED',results,errors:errors.length,unexpectedConsoleErrors,expectedUiErrors}));process.exitCode=1;
  }finally{await browser.close();}
}else{
await mkdir('output/playwright',{recursive:true});
const workerPath='web/dist/sw.js',originalWorker=await readFile(workerPath,'utf8');
try{
  await checkBlockedDesktopUI();
  await checkOwnerSetupUI();
  await page.goto(url);await waitState(page,'READY');await page.waitForFunction(()=>navigator.serviceWorker.controller);
  check(await page.getByText('Gateway reachable — desktop not tested',{exact:true}).isVisible(),'Truthful readiness');
  check(!await page.locator('#updateBanner').isVisible(),'Initial install must not produce update prompt');pass('Signed bootstrap, truthful readiness and clean first worker activation');
  await page.screenshot({path:'output/playwright/production-fixture-desktop.png',fullPage:true});
  await connect(page);for(const viewport of [{width:390,height:850},{width:850,height:390},{width:862,height:844},{width:1440,height:1000}]){await page.setViewportSize(viewport);check(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight+1),'Workspace fits viewport');check(await page.getByRole('button',{name:'End session',exact:true}).isVisible(),'Visible safety control');}pass('Workspace fits mobile portrait/landscape and desktop without page overflow');await page.locator('.capture').focus();await page.keyboard.down('Control');
  await page.getByRole('button',{name:'Release all',exact:true}).click();await page.keyboard.up('Control');
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
  await writeArtifact('qa/implementation/browser-results.json',JSON.stringify({status:'PASS',version:browser.version(),build:JSON.parse(await readFile('web/dist/build.json','utf8')).build,fixture:true,realMac:false,results,errors,unexpectedConsoleErrors,expectedOfflineErrors,expectedUiErrors},null,2)+'\n');
  console.log(JSON.stringify({browser:browser.version(),passed:results.length,errors:errors.length}));
}catch(error){await writeArtifact('qa/implementation/browser-results.json',JSON.stringify({status:'FAIL',fixture:true,realMac:false,results,errors,unexpectedConsoleErrors},null,2)+'\n');await page.screenshot({path:'output/playwright/browser-failure.png',fullPage:true});console.error(JSON.stringify({state:await page.locator('#status').innerText(),notice:await page.locator('#notice').innerText(),errors}));throw error;}finally{await writeFile(workerPath,originalWorker);await browser.close();}

}
