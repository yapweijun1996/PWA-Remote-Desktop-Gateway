/** Delayed synthetic responses on the local API/Guacamole fixture; no real private payloads. */
export async function checkPrivacyLifecycle({page,base,check,pass}) {
  const origin=new URL(base).origin;
  if(!/^https?:\/\/127\.0\.0\.1(?::\d+)?$/.test(origin))throw new Error('PRIVACY_LOOPBACK_FIXTURE_REQUIRED');
  check(await page.evaluate(()=>Boolean(globalThis.__rdgConnectionFixture?.clients)),'PRIVACY_SIMULATED_TRANSPORT_REQUIRED');
  const record=(test,details={})=>pass(test,{scope:'LOCAL_PRIVACY_LIFECYCLE_FIXTURE',simulatedAPI:true,simulatedGuacamole:true,syntheticClipboard:true,realMac:false,realClipboard:false,...details});
  const waitState=value=>page.waitForFunction(value=>document.getElementById('status')?.dataset.state===value,value);
  const routeEntries=[];
  const route=async(path,handler)=>{const url=origin+path;await page.route(url,handler);routeEntries.push([url,handler]);};
  const connect=async(expectedState='CONNECTED')=>{
    if(!await page.locator('#prepare').isVisible())await page.locator('#deviceList article button').first().click();
    await page.locator('#mode').selectOption('control');await page.locator('#consent').check();await page.locator('#clipboardConsent').check();
    await page.locator('#connect').click();await waitState(expectedState);
  };
  const diagnostics=async()=>{
    if(await page.locator('#workspace').isVisible()){
      await page.locator('#moreBtn').click();await page.locator('#workspaceDiagnostics').click();
    }else await page.locator('#diagnosticsBtn').click();
    await page.locator('#diagnosticsDialog').waitFor({state:'visible'});
  };
  async function ensureCleared(code){
    const value=await page.evaluate(()=>({local:document.getElementById('localText').value,remote:document.getElementById('remoteText').value,status:document.getElementById('clipboardStatus').textContent,canvas:document.querySelectorAll('#surface canvas').length}));
    check(value.local===''&&value.remote===''&&value.canvas===0,code);
    return value.status;
  }
  try{
    await waitState('READY');
    await connect();
    await page.evaluate(()=>{
      const f=globalThis.__rdgPrivacyFixture={reads:0,writes:0,readResolve:null,writeResolve:null,reader:null,writer:null};
      f.clipboardDescriptor=Object.getOwnPropertyDescriptor(navigator,'clipboard');
      f.stringReader=Guacamole.StringReader;f.stringWriter=Guacamole.StringWriter;
      Object.defineProperty(navigator,'clipboard',{configurable:true,value:{
        readText(){f.reads++;return new Promise(resolve=>{f.readResolve=resolve;});},
        writeText(){f.writes++;return new Promise(resolve=>{f.writeResolve=resolve;});}
      }});
      Guacamole.StringReader=class{constructor(){f.reader=this;}};
      Guacamole.StringWriter=class{constructor(){f.writer=this;}sendText(){}sendEnd(){}};
      const client=globalThis.__rdgConnectionFixture.clients.at(-1);client.createClipboardStream=()=>({});
      client.onclipboard({sendAck(){}},'text/plain');f.reader.ontext('VISIBLE_SYNTHETIC_CLIPBOARD_FIXTURE');f.reader.onend();
    });
    check(await page.locator('#remoteText').inputValue()==='VISIBLE_SYNTHETIC_CLIPBOARD_FIXTURE','PRIVACY_STREAM_FIXTURE_NOT_LIVE');
    await page.locator('#clipboardBtn').click();await page.locator('#clipboardDialog').waitFor({state:'visible'});
    await page.locator('#localText').fill('SYNTHETIC_OUTGOING_FIXTURE');
    await page.locator('#sendText').click();await page.locator('#copyRemote').click();await page.locator('#readLocal').click();
    await page.waitForFunction(()=>globalThis.__rdgPrivacyFixture?.reads===1&&globalThis.__rdgPrivacyFixture?.writes===1&&globalThis.__rdgPrivacyFixture?.writer);
    await page.evaluate(()=>{
      const f=globalThis.__rdgPrivacyFixture,client=globalThis.__rdgConnectionFixture.clients.at(-1);
      client.onclipboard({sendAck(){}},'text/plain');f.reader.ontext('LATE_SYNTHETIC_STREAM_FIXTURE');f.pendingReader=f.reader;
    });
    await page.locator('#clipboardDialog [data-close]').click();await page.locator('#end').click();await waitState('READY');
    const cleared=await ensureCleared('PRIVACY_END_DID_NOT_CLEAR_CLIPBOARD');
    await page.evaluate(async()=>{globalThis.__rdgPrivacyFixture.readResolve('LATE_SYNTHETIC_LOCAL_FIXTURE');await new Promise(resolve=>setTimeout(resolve,0));});
    check(await ensureCleared('PRIVACY_LATE_LOCAL_READ_REPOPULATED')===cleared,'PRIVACY_LATE_LOCAL_READ_CHANGED_STATUS');
    record('Local clipboard read resolving after End cannot repopulate text or status',{localPermissionAndPayloadSimulated:true});
    await page.evaluate(()=>globalThis.__rdgPrivacyFixture.pendingReader.onend());
    check(await ensureCleared('PRIVACY_LATE_STREAM_REPOPULATED')===cleared,'PRIVACY_LATE_STREAM_CHANGED_STATUS');
    record('A clipboard stream ending after its adapter disconnects cannot repopulate received text',{streamCompletionSimulated:true});
    await page.evaluate(async()=>{globalThis.__rdgPrivacyFixture.writer.onack({isError:()=>false});await new Promise(resolve=>setTimeout(resolve,0));});
    check(await ensureCleared('PRIVACY_LATE_SEND_ACK_REPOPULATED')===cleared,'PRIVACY_LATE_SEND_ACK_CHANGED_STATUS');
    await page.evaluate(async()=>{globalThis.__rdgPrivacyFixture.writeResolve();await new Promise(resolve=>setTimeout(resolve,0));});
    check(await ensureCleared('PRIVACY_LATE_LOCAL_COPY_REPOPULATED')===cleared,'PRIVACY_LATE_LOCAL_COPY_CHANGED_STATUS');
    record('Send acknowledgement and local-copy completion after End cannot replace cleared clipboard status',{sendAcknowledgementSimulated:true,localCopyPermissionSimulated:true});

    for(const disconnect of [false,true]){
      if(disconnect)await connect();
      const marker=disconnect?'LATE_DISCONNECTED_DIAGNOSTICS_FIXTURE':'LATE_CLOSED_DIAGNOSTICS_FIXTURE';
      let release,reachedResolve;const held=new Promise(resolve=>{release=resolve;}),reached=new Promise(resolve=>{reachedResolve=resolve;});
      let arrived=0;
      const respond=async(request,value)=>{arrived++;if(arrived===2)reachedResolve();await held;await request.fulfill({status:200,contentType:'application/json',headers:{'Cache-Control':'no-store'},body:JSON.stringify(value)});};
      const diagRoute=request=>respond(request,{nodeId:marker,desktopEnabled:true,desktopPolicy:'FULL',keysyms:{},trustedDevicesEnabled:false});
      const historyRoute=request=>respond(request,[{at:'2026-10-04T00:00:00Z',event:marker,reason:'SYNTHETIC_FIXTURE'}]);
      await route('/api/diagnostics',diagRoute);await route('/api/history',historyRoute);
      try{
        await diagnostics();await Promise.race([reached,new Promise((resolve,reject)=>setTimeout(()=>reject(new Error('PRIVACY_DIAGNOSTICS_REQUEST_NOT_STARTED')),5000))]);
        await page.locator('#diagnosticsDialog [data-close]').click();
        if(disconnect){await page.locator('#end').click();await waitState('READY');}
        release();await page.waitForLoadState('networkidle');
        const text=await page.evaluate(()=>({diagnostics:document.getElementById('diagnostics').textContent,history:document.getElementById('history').textContent}));
        check(!text.diagnostics.includes(marker)&&!text.history.includes(marker),disconnect?'PRIVACY_LATE_DIAGNOSTICS_AFTER_END_RENDERED':'PRIVACY_LATE_DIAGNOSTICS_AFTER_CLOSE_RENDERED');
        record(disconnect?'Diagnostics and history resolving after End are discarded':'Diagnostics and history resolving after dialog close are discarded',{responseLifecycle:disconnect?'DISCONNECTED':'DIALOG_CLOSED'});
      }finally{release();await page.unroute(origin+'/api/diagnostics',diagRoute);await page.unroute(origin+'/api/history',historyRoute);}
    }

    await page.locator('#preferencesBtn').click();await page.locator('#languagePreference').selectOption('zh-CN');await page.locator('#preferencesDialog .dialog-footer [data-close]').click();
    const unknown='FIXTURE_UNRECOGNIZED_STATE';
    const unknownRoute=request=>request.fulfill({status:409,contentType:'application/json',headers:{'Cache-Control':'no-store'},body:JSON.stringify({code:unknown})});
    await route('/api/connect-intents',unknownRoute);
    await connect('ERROR');
    check(await page.locator('#status').innerText()==='错误','PRIVACY_UNKNOWN_STATE_NOT_LOCALIZED_ERROR');
    check(await page.locator('#notice').innerText()==='无法完成请求。请验证访问后重试。','PRIVACY_UNKNOWN_STATE_NOTICE_NOT_LOCALIZED');
    check(!(await page.locator('body').innerText()).includes(unknown),'PRIVACY_UNKNOWN_REASON_RENDERED');
    record('Unknown API failure codes become localized Error without rendering an arbitrary server reason',{locale:'zh-CN',displayedState:'ERROR',responseStatus:409});
    await page.locator('#preferencesBtn').click();await page.locator('#languagePreference').selectOption('en');await page.locator('#preferencesDialog .dialog-footer [data-close]').click();
  }finally{
    for(const [url,handler]of routeEntries)await page.unroute(url,handler);
    await page.evaluate(()=>{
      const f=globalThis.__rdgPrivacyFixture;if(!f)return;
      f.readResolve?.('');f.writeResolve?.();f.writer?.onack?.({isError:()=>false});
      if(f.clipboardDescriptor)Object.defineProperty(navigator,'clipboard',f.clipboardDescriptor);else delete navigator.clipboard;
      if(f.stringReader===undefined)delete Guacamole.StringReader;else Guacamole.StringReader=f.stringReader;
      if(f.stringWriter===undefined)delete Guacamole.StringWriter;else Guacamole.StringWriter=f.stringWriter;
      delete globalThis.__rdgPrivacyFixture;
    }).catch(()=>{});
  }
}
