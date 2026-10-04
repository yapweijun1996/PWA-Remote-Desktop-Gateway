/** Local simulated APIs/Guacamole only; never proof of real authentication or lease enforcement. */
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {writeArtifact} from '../scripts/atomic-artifact.mjs';
import {openWorkspaceControls,endWorkspace} from './workspace-controls-helper.mjs';
import {checkWorkspaceUI} from './workspace-ui-checks.mjs';
import {checkPwaExperience} from './pwa-experience-checks.mjs';
import {checkPrivacyLifecycle} from './privacy-lifecycle-checks.mjs';
const require=createRequire(import.meta.url),{chromium}=require(process.env.RDG_PLAYWRIGHT_MODULE??'playwright');
const scope='LOCAL_BROWSER_CONNECTION_LIFECYCLE_FIXTURE',priorApp=process.env.RDG_CONNECT_BROWSER_PRIOR_APP==='true';
const baselineSourceCommit='4deb5fc3d7262ed6a8de813c4fc7a7c33d0b95ed';
const html=await readFile('web/dist/index.html','utf8'),assets=JSON.parse(await readFile('web/dist/asset-manifest.json','utf8')),build=JSON.parse(await readFile('web/dist/build.json','utf8')).build;
const guacPath=html.match(/<script defer src="([^"]+)"/)?.[1],appPath=html.match(/<script type="module" src="([^"]+)"/)?.[1];
if(!guacPath||!appPath||!assets[guacPath]||!assets[appPath])throw new Error('CONNECT_FIXTURE_ASSETS_REFUSED');
let priorSource;
if(priorApp){
  const current=await readFile('web/dist'+appPath,'utf8');
  priorSource=current.match(/^import .*;$/gm).join('\n')+'\n'+execFileSync('git',['show',baselineSourceCommit+':web/src/app.mjs'],{encoding:'utf8',maxBuffer:128*1024}).replace(/^import .*;$/gm,'');
}
const fakeGuac=[
"globalThis.__rdgConnectionFixture={clients:[]};",
"class Display{constructor(){this.element=document.createElement('canvas');this.element.width=640;this.element.height=480;}getElement(){return this.element;}getWidth(){return 640;}getHeight(){return 480;}getScale(){return 1;}scale(){}}",
"class Client{constructor(tunnel){this.tunnel=tunnel;this.display=new Display();globalThis.__rdgConnectionFixture.clients.push(this);}getDisplay(){return this.display;}connect(){this.savedFailure=this.onerror;queueMicrotask(()=>{this.tunnel.oninstruction?.('sync',['1']);this.tunnel.sendMessage('sync','1');this.onstatechange?.(3);});}disconnect(){}sendKeyEvent(){}sendMouseState(){}}",
"class Keyboard{reset(){}}",
"class Mouse{onEach(){}}",
"Mouse.State=class{constructor(x,y,left,middle,right,up,down){Object.assign(this,{x,y,left,middle,right,up,down});}};Mouse.Touchpad=Mouse;",
"globalThis.Guacamole={Client,Keyboard,Mouse,WebSocketTunnel:class{constructor(url){this.url=url;}isConnected(){return true;}sendMessage(){}}};"
].join('\n');
const results=[],totals={clipboardRequests:0,intentRequests:0,scopedDeletes:0,unscopedDeletes:0,expected409ConsoleErrors:0,expectedStale401ConsoleErrors:0,pageErrors:0,unexpectedConsoleErrors:0,webSockets:0,fixtureErrors:0};
let fixture,browser,origin,failedStep='STARTUP',closed=false;
const check=(condition,code)=>{if(!condition){failedStep=code;throw new Error(code);}};
const pass=(test,metadata={})=>results.push({test,status:'PASS',...metadata});
const fresh=(options={})=>({refusalStage:null,refusalCode:null,sameAppActive:false,lease:null,issued:0,clipboardRequests:0,intentRequests:0,qualities:[],deletes:[],holdIntent:false,holdDelete:false,holdSession:false,pendingIntent:null,pendingDelete:null,pendingSession:null,sessionDenialExpected:false,enforceBusy:false,...options});
const respond=(response,status,body)=>{response.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});response.end(body===undefined?'':JSON.stringify(body));};
const server=http.createServer(async(request,response)=>{
  try{
    const pathname=new URL(request.url,origin??'http://127.0.0.1').pathname;
    if(pathname.startsWith('/api/')){
      let bytes='';for await(const chunk of request){bytes+=chunk;check(bytes.length<=4096,'FIXTURE_REQUEST_TOO_LARGE');}
      const body=bytes?JSON.parse(bytes):undefined,f=fixture;
      if(!f){respond(response,503,{code:'FIXTURE_UNAVAILABLE'});return;}
      if(request.method!=='GET'&&pathname!=='/api/session/bootstrap'&&request.headers['x-rdg-csrf']!=='F'.repeat(43)){respond(response,403,{code:'CSRF_INVALID'});return;}
      if(pathname==='/api/session/bootstrap'){respond(response,200,{csrfToken:'F'.repeat(43),nodeId:'fixture-lifecycle-node',expiresAt:new Date(Date.now()+3600000).toISOString()});return;}
      if(pathname==='/api/devices'){respond(response,200,[{id:'fixture-local-desktop',label:'Local simulated desktop — fixture only',kind:'local',status:'GATEWAY_REACHABLE',desktopEnabled:true,desktopPolicy:'FULL',checkedAt:'2026-10-03T00:00:00Z'}]);return;}
      if(pathname==='/api/diagnostics'){respond(response,200,{nodeId:'fixture-lifecycle-node',desktopEnabled:true,desktopPolicy:'FULL',keysyms:{},trustedDevicesEnabled:false});return;}
      if(pathname==='/api/session'){
        if(f.holdSession){f.pendingSession={reply:(status,value)=>respond(response,status,value)};return;}
        const active=f.sameAppActive||f.lease!==null;
        respond(response,200,{activeDesktop:active,...(active?{activeDesktopIntentId:f.lease}:{}),nodeActiveDesktops:active?1:f.refusalCode==='CONTROL_BUSY'?1:0,clipboardConsent:false,maintenance:f.refusalCode==='UPDATE_IN_PROGRESS'});return;
      }
      if(pathname==='/api/clipboard-consent'){
        f.clipboardRequests++;totals.clipboardRequests++;
        if(f.refusalStage==='CLIPBOARD'||f.enforceBusy&&f.lease!==null){respond(response,409,{code:f.refusalCode??'CONTROL_BUSY'});return;}
        respond(response,200,{enabled:body?.enabled===true});return;
      }
      if(pathname==='/api/connect-intents'){
        f.intentRequests++;totals.intentRequests++;
        f.qualities.push(body?.displayQuality);
        if(f.refusalStage==='INTENT'){respond(response,409,{code:f.refusalCode});return;}
        const intentId=String.fromCharCode(65+f.issued++).repeat(43);f.lease=intentId;
        const reply=()=>respond(response,201,{intentId,displayQuality:body?.displayQuality??'balanced',expiresAt:new Date(Date.now()+30000).toISOString()});
        if(f.holdIntent){f.pendingIntent={intentId,reply};return;}reply();return;
      }
      if(pathname==='/api/desktop-session'&&request.method==='DELETE'){
        const scoped=body!==undefined,record={scoped,onlyIntentField:scoped&&Object.keys(body).length===1&&typeof body.intentId==='string',intentId:body?.intentId};
        f.deletes.push(record);totals[scoped?'scopedDeletes':'unscopedDeletes']++;
        const reply=()=>{if(scoped){if(f.lease===body.intentId){f.lease=null;f.sameAppActive=false;f.refusalStage=null;f.refusalCode=null;}}else{f.lease=null;f.sameAppActive=false;f.refusalStage=null;f.refusalCode=null;}respond(response,204);};
        if(f.holdDelete&&scoped){f.pendingDelete={record,reply};return;}reply();return;
      }
      if(pathname==='/api/history'){respond(response,200,[]);return;}
      respond(response,404,{code:'FIXTURE_NOT_FOUND'});return;
    }
    const key=pathname==='/'?'/index.html':pathname;
    if(!Object.hasOwn(assets,key)){response.writeHead(404);response.end();return;}
    let data=key===guacPath?fakeGuac:key===appPath&&priorApp?priorSource:await readFile('web/dist'+key);
    if(key==='/index.html')data=String(data).replace('<body>','<body><aside aria-label="Test fixture" style="position:fixed;left:0;bottom:0;z-index:16;pointer-events:none;max-width:calc(100vw - 48px);background:#16343d;color:white;font:11px system-ui;padding:4px">LOCAL SIMULATED CONNECTION FIXTURE — no real desktop or authentication</aside>');
    response.writeHead(200,{'Content-Type':assets[key].type,'Cache-Control':'no-store'});response.end(data);
  }catch{totals.fixtureErrors++;respond(response,500,{code:'FIXTURE_REQUEST_REFUSED'});}
});
server.on('upgrade',(_request,socket)=>{totals.webSockets++;socket.end('HTTP/1.1 403 Denied\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');});
const wait=async(predicate,code)=>{const until=Date.now()+8000;while(!predicate()){if(Date.now()>until){failedStep=code;throw new Error(code);}await new Promise(resolve=>setTimeout(resolve,20));}};
const waitState=(page,state)=>page.waitForFunction(state=>document.getElementById('status')?.dataset.state===state,state);
const makeContext=async()=>{
  const context=await browser.newContext({viewport:{width:390,height:850},serviceWorkers:'block'});
  context.on('page',page=>{
    page.setDefaultTimeout(8000);page.on('pageerror',()=>totals.pageErrors++);
    page.on('console',message=>{
      if(message.type()!=='error')return;
      const path=new URL(message.location().url||origin,origin).pathname;
      if(['/api/clipboard-consent','/api/connect-intents'].includes(path)&&/server responded with a status of 409/.test(message.text()))totals.expected409ConsoleErrors++;
      else if(fixture?.sessionDenialExpected&&path==='/api/session'&&/server responded with a status of 401/.test(message.text()))totals.expectedStale401ConsoleErrors++;
      else totals.unexpectedConsoleErrors++;
    });page.on('websocket',()=>totals.webSockets++);
  });return context;
};
const prepare=async(page)=>{await page.goto(origin);await waitState(page,'READY');if(await page.getByRole('button',{name:'Prepare connection',exact:true}).isVisible())await page.getByRole('button',{name:'Prepare connection',exact:true}).click();await page.getByLabel('I agree to control or view this shared desktop.').check();};
const open=page=>page.getByRole('button',{name:'Open desktop',exact:true}).click();
const cleanup=async()=>{if(closed)return;closed=true;if(fixture?.pendingSession)fixture.pendingSession.reply(200,{activeDesktop:false});if(fixture?.pendingIntent)fixture.pendingIntent.reply();if(fixture?.pendingDelete)fixture.pendingDelete.reply();if(browser)await browser.close().catch(()=>{});server.closeAllConnections();await new Promise(resolve=>server.close(resolve));};
const deadline=setTimeout(()=>{console.error(JSON.stringify({status:'FAIL',scope,reason:'CONNECT_BROWSER_DEADLINE',results,totals}));void cleanup().finally(()=>process.exit(1));},120000);
try{
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});origin='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({headless:true,executablePath:process.env.RDG_TEST_CHROMIUM});
  for(const [refusalStage,refusalCode,sameAppActive] of [['CLIPBOARD','CONTROL_BUSY',false],['INTENT','CONTROL_BUSY',true],['CLIPBOARD','UPDATE_IN_PROGRESS',false],['INTENT','UPDATE_IN_PROGRESS',false]]){
    const snapshot='R'.repeat(43);fixture=fresh({refusalStage,refusalCode,sameAppActive,lease:sameAppActive?snapshot:null});const context=await makeContext(),page=await context.newPage();
    await prepare(page);await open(page);await wait(()=>fixture.clipboardRequests>0&&(refusalStage==='CLIPBOARD'||fixture.intentRequests>0),'REFUSAL_NOT_OBSERVED');await page.waitForLoadState('networkidle');
    check(fixture.deletes.length===0,'REFUSAL_SENT_DELETE');await waitState(page,refusalCode);
    check(!await page.locator('#workspace').isVisible()&&await page.locator('#surface canvas').count()===0,'REFUSAL_OPENED_DESKTOP');
    check(refusalStage!=='CLIPBOARD'||fixture.intentRequests===0,'CLIPBOARD_REFUSAL_SENT_INTENT');
    check(await page.locator('#recoverConnection').isVisible()===sameAppActive,'RECOVERY_VISIBILITY_NOT_SAME_APP');
    if(sameAppActive){
      check(fixture.deletes.length===0,'RECOVERY_RAN_BEFORE_CLICK');await page.locator('#recoverConnection').click();await waitState(page,'CONNECTED');
      check(fixture.deletes.length===1&&fixture.deletes[0].onlyIntentField&&fixture.deletes[0].intentId===snapshot&&fixture.intentRequests===2,'RECOVERY_NOT_SNAPSHOT_SCOPED_THEN_RETRIED');
      const owned=fixture.lease;await endWorkspace(page);await wait(()=>fixture.deletes.length===2,'END_CLEANUP_MISSING');await waitState(page,'READY');
      check(fixture.deletes[1].onlyIntentField&&fixture.deletes[1].intentId===owned&&fixture.lease===null,'END_NOT_OWN_INTENT_SCOPED');
    }
    pass(refusalStage+' '+refusalCode+' refusal preserves leases until explicit same-app snapshot recovery',{deletesBeforeClick:0,recoveryShown:sameAppActive,...(sameAppActive?{recoverySnapshotScoped:true,retryConnected:true,endScopedToOwnIntent:true}:{})});await context.close();
  }
  fixture=fresh();{
    const context=await makeContext(),page=await context.newPage();await prepare(page);await open(page);await waitState(page,'CONNECTED');const owned=fixture.lease;
    await page.evaluate(()=>globalThis.__rdgConnectionFixture.clients[0].onerror());await wait(()=>fixture.deletes.length===1,'TARGET_FAILURE_CLEANUP_MISSING');await waitState(page,'TARGET_UNAVAILABLE');
    check(fixture.deletes[0].onlyIntentField&&fixture.deletes[0].intentId===owned&&fixture.lease===null,'TARGET_FAILURE_NOT_OWN_INTENT_SCOPED');
    pass('Target failure after an issued intent cleans up only its own intent',{scopedDeletes:1,unscopedDeletes:0});await context.close();
  }
  fixture=fresh({holdIntent:true});{
    const context=await makeContext(),page=await context.newPage();await prepare(page);await open(page);await wait(()=>fixture.pendingIntent!==null,'DELAYED_INTENT_MISSING');const owned=fixture.pendingIntent.intentId;
    await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide')));fixture.pendingIntent.reply();fixture.pendingIntent=null;
    await wait(()=>fixture.deletes.length===1,'STALE_INTENT_NOT_CANCELLED');await page.waitForLoadState('networkidle');
    check(fixture.deletes[0].onlyIntentField&&fixture.deletes[0].intentId===owned&&fixture.lease===null,'STALE_INTENT_CANCEL_NOT_SCOPED');
    check(await page.evaluate(()=>globalThis.__rdgConnectionFixture.clients.length)===0,'STALE_INTENT_OPENED_ADAPTER');
    pass('A 201 intent arriving after synthetic pagehide epoch invalidation is scoped-cancelled without opening an adapter',{scopedDeletes:1,adapterConnections:0,syntheticPagehide:true});await context.close();
  }
  fixture=fresh({holdDelete:true});{
    const context=await makeContext(),oldPage=await context.newPage();await prepare(oldPage);await open(oldPage);await waitState(oldPage,'CONNECTED');const oldIntent=fixture.lease;
    await oldPage.evaluate(()=>globalThis.__rdgConnectionFixture.clients[0].onerror());await wait(()=>fixture.pendingDelete!==null,'DELAYED_OLD_CLEANUP_MISSING');
    const replacement=await context.newPage();await prepare(replacement);await open(replacement);await waitState(replacement,'CONNECTED');const newIntent=fixture.lease;
    check(newIntent!==oldIntent&&fixture.pendingDelete.record.onlyIntentField&&fixture.pendingDelete.record.intentId===oldIntent,'DELAYED_CLEANUP_LOST_OWNERSHIP');
    const before=fixture.deletes.length;await oldPage.evaluate(()=>globalThis.__rdgConnectionFixture.clients[0].savedFailure());await oldPage.evaluate(()=>new Promise(resolve=>setTimeout(resolve,100)));
    check(fixture.deletes.length===before,'STALE_TAB_FAILURE_SENT_NEW_CLEANUP');fixture.pendingDelete.reply();fixture.pendingDelete=null;fixture.holdDelete=false;await oldPage.waitForLoadState('networkidle');
    check(fixture.lease===newIntent&&await replacement.locator('#workspace').isVisible()&&await replacement.locator('#status').innerText()==='CONNECTED','OLD_CLEANUP_ENDED_REPLACEMENT');
    await endWorkspace(replacement);await wait(()=>fixture.deletes.length===2,'REPLACEMENT_END_MISSING');await waitState(replacement,'READY');
    check(fixture.deletes[1].onlyIntentField&&fixture.deletes[1].intentId===newIntent&&fixture.lease===null,'REPLACEMENT_END_NOT_SCOPED');
    pass('Delayed old scoped cleanup and a stale tab callback preserve a replacement simulated lease',{oldCleanupScoped:true,staleCallbackDeletes:0,replacementPreserved:true,realBackendLeaseIsolationTested:false});await context.close();
  }
  for(const denied of [false,true]){
    fixture=fresh();const context=await makeContext(),page=await context.newPage();await prepare(page);await open(page);await waitState(page,'CONNECTED');const oldIntent=fixture.lease;
    fixture.holdSession=true;fixture.sessionDenialExpected=denied;await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await wait(()=>fixture.pendingSession!==null,'OLD_VISIBILITY_STATUS_MISSING');
    await endWorkspace(page);await waitState(page,'READY');await wait(()=>fixture.deletes.length===1,'OLD_END_MISSING');
    await open(page);await waitState(page,'CONNECTED');const replacementIntent=fixture.lease;
    check(replacementIntent!==oldIntent&&fixture.deletes[0].onlyIntentField&&fixture.deletes[0].intentId===oldIntent,'STATUS_REPLACEMENT_PRECONDITION_FAILED');
    fixture.pendingSession.reply(denied?401:200,denied?{code:'SESSION_EXPIRED'}:{activeDesktop:false});fixture.pendingSession=null;fixture.holdSession=false;await page.waitForLoadState('networkidle');
    check(fixture.deletes.length===1&&fixture.lease===replacementIntent&&await page.locator('#status').innerText()==='CONNECTED'&&await page.locator('#workspace').isVisible(),'LATE_OLD_STATUS_ENDED_REPLACEMENT');
    await endWorkspace(page);await waitState(page,'READY');await wait(()=>fixture.deletes.length===2,'STATUS_REPLACEMENT_END_MISSING');
    check(fixture.deletes[1].onlyIntentField&&fixture.deletes[1].intentId===replacementIntent,'STATUS_REPLACEMENT_END_NOT_SCOPED');
    pass(denied?'Late old visibility status 401 is ignored after a replacement adapter':'Late old visibility activeDesktop:false is ignored after a replacement adapter',{syntheticVisibilityEvent:true,lateStatus:denied?401:200,replacementPreserved:true,staleStatusDeletes:0});await context.close();
  }
  fixture=fresh({refusalStage:'INTENT',refusalCode:'CONTROL_BUSY',sameAppActive:true,lease:'R'.repeat(43)});{
    const context=await makeContext(),oldPage=await context.newPage();await prepare(oldPage);await open(oldPage);await waitState(oldPage,'CONTROL_BUSY');await oldPage.locator('#recoverConnection').waitFor({state:'visible'});
    fixture.holdDelete=true;await oldPage.locator('#recoverConnection').click();await wait(()=>fixture.pendingDelete!==null,'DELAYED_RECOVERY_MISSING');const snapshot=fixture.pendingDelete.record.intentId;
    fixture.refusalStage=null;fixture.refusalCode=null;fixture.sameAppActive=false;fixture.lease=null;
    const replacement=await context.newPage();await prepare(replacement);await open(replacement);await waitState(replacement,'CONNECTED');const replacementIntent=fixture.lease;fixture.enforceBusy=true;
    fixture.pendingDelete.reply();fixture.pendingDelete=null;fixture.holdDelete=false;await waitState(oldPage,'CONTROL_BUSY');await oldPage.waitForLoadState('networkidle');
    check(snapshot==='R'.repeat(43)&&fixture.deletes.length===1&&fixture.deletes[0].onlyIntentField&&fixture.lease===replacementIntent&&await replacement.locator('#status').innerText()==='CONNECTED','DELAYED_RECOVERY_ENDED_REPLACEMENT');
    await endWorkspace(replacement);await waitState(replacement,'READY');await wait(()=>fixture.deletes.length===2,'RECOVERY_REPLACEMENT_END_MISSING');
    pass('Delayed explicit recovery remains scoped to its status snapshot and preserves a replacement simulated lease',{recoverySnapshotScoped:true,replacementPreserved:true,unscopedDeletes:0});await context.close();
  }
  fixture=fresh();{
    const context=await makeContext(),page=await context.newPage();await prepare(page);
    failedStep='QUALITY_INITIAL';await page.locator('#displayQuality').selectOption('low');await open(page);await waitState(page,'CONNECTED');
    check(fixture.qualities.length===1&&fixture.qualities[0]==='low','QUALITY_INITIAL_REQUEST_MISSING');
    failedStep='QUALITY_PANEL';await openWorkspaceControls(page);await page.getByText('Current mode: Low bandwidth').waitFor();
    check(await page.locator('#applyDisplayQuality').isDisabled(),'QUALITY_APPLY_SAME_MODE_ENABLED');
    check((await page.locator('#transportMetrics').innerText()).includes('Received'),'METRICS_MISSING_WHILE_CONNECTED');
    failedStep='QUALITY_PROBE';await page.locator('#measureNetwork').click();await page.getByText(/^Latest HTTP round trip: [\d.]+ ms$/).waitFor();
    check(await page.locator('#measureNetwork').isEnabled(),'METRICS_PROBE_NOT_REENABLED');
    failedStep='QUALITY_CLEAR_RECONNECT';const old=fixture.lease;await page.locator('#liveDisplayQuality').selectOption('clear');
    check(fixture.intentRequests===1&&fixture.deletes.length===0,'QUALITY_SELECTION_AUTO_RECONNECTED');
    await page.locator('#applyDisplayQuality').click();await wait(()=>fixture.intentRequests===2,'QUALITY_RECONNECT_NOT_REQUESTED');await waitState(page,'CONNECTED');
    check(fixture.deletes.length===1&&fixture.deletes[0].intentId===old&&fixture.deletes[0].onlyIntentField&&fixture.qualities[1]==='clear','QUALITY_RECONNECT_NOT_SCOPED');
    failedStep='QUALITY_CLEAR_PANEL';await openWorkspaceControls(page);await page.getByText('Current mode: Clear').waitFor();
    await page.getByText('Not measured',{exact:true}).waitFor();
    check((await page.locator('#inputStatus').innerText()).includes('paused'),'QUALITY_RECONNECT_ENABLED_HIDDEN_INPUT');
    await page.locator('#liveDisplayQuality').selectOption('balanced');await page.locator('#applyDisplayQuality').click();await wait(()=>fixture.intentRequests===3,'QUALITY_BALANCED_RECONNECT_MISSING');await waitState(page,'CONNECTED');
    check(fixture.qualities.join(',')==='low,clear,balanced'&&fixture.deletes.length===2,'QUALITY_CATALOG_NOT_COMPLETE');
    await openWorkspaceControls(page);fixture.holdSession=true;await page.locator('#measureNetwork').click();await wait(()=>fixture.pendingSession!==null,'METRICS_DELAYED_PROBE_MISSING');
    await page.keyboard.press('Escape');fixture.pendingSession.reply(200,{activeDesktop:true});fixture.pendingSession=null;fixture.holdSession=false;
    await openWorkspaceControls(page);await page.getByText('Not measured',{exact:true}).waitFor();
    check(await page.locator('#measureNetwork').isEnabled(),'METRICS_CLOSED_PROBE_BLOCKED_BUTTON');
    await page.locator('#preferencesBtn').click();await page.locator('#languagePreference').selectOption('zh-CN');await page.locator('#preferencesDialog button[data-close]').first().click();
    check((await page.locator('#activeDisplayQuality').innerText()).includes('平衡'),'QUALITY_NOT_LOCALIZED');
    await page.locator('#measureNetwork').click();await page.getByText(/^最近 HTTP 往返耗时：[\d.]+ ms$/).waitFor();
    fixture.holdSession=true;await page.locator('#measureNetwork').click();await wait(()=>fixture.pendingSession!==null,'METRICS_STALE_PROBE_MISSING');
    await page.locator('#end').click();await waitState(page,'READY');fixture.pendingSession.reply(200,{activeDesktop:true});fixture.pendingSession=null;fixture.holdSession=false;
    await page.waitForLoadState('networkidle');
    check(await page.locator('#transportMetrics').innerText()===''&&await page.locator('#networkLatency').innerText()==='','METRICS_STALE_PROBE_REPOPULATED_AFTER_END');
    check(await page.evaluate(()=>{const entries=[...Object.keys(localStorage),...Object.keys(sessionStorage)];return entries.every(key=>/^rdg:(quality:|profile:|theme$|locale$)/.test(key));}),'METRICS_PERSISTED_TO_STORAGE');
    pass('Low/balanced/clear requests require explicit scoped reconnect; live payload/HTTP metrics localize and clear without stale probe writes',{profiles:['low','clear','balanced'],noSelectionSideEffect:true,scopedReconnects:2,metricsStayInMemory:true,syntheticMetrics:true,realInputLatency:false});await context.close();
  }
  fixture=fresh();{
    const context=await makeContext(),page=await context.newPage();await prepare(page);await open(page);await waitState(page,'CONNECTED');await openWorkspaceControls(page);
    await page.evaluate(()=>{document.getElementById('closeWorkspacePanel').click();document.getElementById('moreBtn').click();});
    await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,50)));
    check(await page.locator('#workspaceMenu').isVisible()&&await page.locator('#moreBtn').getAttribute('aria-expanded')==='true','METRICS_STALE_CLOSE_ENDED_REOPENED_PANEL');
    fixture.holdSession=true;fixture.sessionDenialExpected=true;await page.locator('#measureNetwork').click();await wait(()=>fixture.pendingSession!==null,'METRICS_AUTH_PROBE_MISSING');
    const old=fixture.lease;fixture.pendingSession.reply(401,{code:'SESSION_EXPIRED'});fixture.pendingSession=null;fixture.holdSession=false;
    await waitState(page,'REAUTH_REQUIRED');await wait(()=>fixture.deletes.length===1,'METRICS_AUTH_CLEANUP_MISSING');
    check(!await page.locator('#workspace').isVisible()&&await page.locator('#surface canvas').count()===0&&fixture.deletes[0].intentId===old,'METRICS_AUTH_FAILURE_LEFT_DESKTOP');
    check(await page.locator('#transportMetrics').innerText()===''&&await page.locator('#networkLatency').innerText()==='','METRICS_AUTH_FAILURE_LEFT_COUNTERS');
    pass('Queued close events preserve reopened controls and explicit probe authorization failure immediately clears only the owned desktop',{syntheticRapidReopen:true,authDenial:401,scopedCleanup:true});await context.close();
  }
  fixture=fresh();{
    const context=await makeContext(),page=await context.newPage();await prepare(page);await open(page);await waitState(page,'CONNECTED');
    await checkPwaExperience({page,check,pass,connected:true});await checkWorkspaceUI({page,check,pass});await context.close();
  }
  fixture=fresh();{const context=await makeContext(),page=await context.newPage();await page.goto(origin);await waitState(page,'READY');await checkPwaExperience({page,check,pass});await context.close();}
  fixture=fresh();{const context=await makeContext(),page=await context.newPage();await page.goto(origin);await waitState(page,'READY');await checkPrivacyLifecycle({page,base:origin,check,pass});await context.close();}
  check(totals.pageErrors===0&&totals.unexpectedConsoleErrors===0&&totals.fixtureErrors===0&&totals.webSockets===0&&totals.unscopedDeletes===0,'UNEXPECTED_FIXTURE_ERROR');
  check(!priorApp,'PRIOR_APP_UNEXPECTEDLY_PASSED');
  const evidence={status:'PASS',scope,browser:browser.version(),build,fixture:true,simulatedAPI:true,simulatedGuacamole:true,recoveryDesign:'SCOPED_SESSION_STATUS_SNAPSHOT',priorGlobalRecoveryDesign:'ABANDONED_BEFORE_DEPLOYMENT',realAccess:false,realMac:false,realSafari:false,realBackendLeaseIsolationTested:false,inputOrClipboardPayloadTested:false,results,totals};
  await writeArtifact('qa/implementation/connect-browser-results.json',JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));
}catch(error){
  const sensitive=priorApp&&error.message==='REFUSAL_SENT_DELETE';
  const evidence={status:sensitive?'EXPECTED_FAILURE':'FAIL',scope,reason:sensitive?'PRIOR_APP_REFUSAL_SENT_DELETE':'CONNECT_BROWSER_CHECK_FAILED',failedStep,priorAppFixture:priorApp,...(priorApp?{baselineSourceCommit}:{}),productionBuild:build,results,totals};
  if(priorApp)await writeArtifact('qa/implementation/connect-browser-prior-app-negative.json',JSON.stringify(evidence,null,2)+'\n');
  console.error(JSON.stringify(evidence));process.exitCode=sensitive?0:1;
}finally{clearTimeout(deadline);await cleanup();}
