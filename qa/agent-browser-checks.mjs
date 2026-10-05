/**
 * Production PWA, real gateway and real H.264 WebCodecs decode in Chromium, against a disposable host agent peer that plays a
 * synthetic clip (qa/make-agent-test-video.mjs). It proves the browser adapter, the relay and the decoder together. It is not
 * evidence about the real agent, the Mac, Cloudflare Access or Safari/Windows browsers.
 */
import {createRequire} from 'node:module';
import {readFileSync,mkdirSync} from 'node:fs';
import {writeArtifact} from '../scripts/atomic-artifact.mjs';
import {openWorkspaceControls,endWorkspace} from './workspace-controls-helper.mjs';
const require=createRequire(import.meta.url),{chromium}=require(process.env.RDG_PLAYWRIGHT_MODULE??'playwright');
const url=process.env.RDG_FIXTURE_URL,directory=process.env.RDG_FIXTURE_DIR;
if(!url?.startsWith('https://127.0.0.1:')||!directory)throw new Error('Loopback HTTPS agent fixture required');
mkdirSync('output/playwright',{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.RDG_TEST_CHROMIUM,args:['--ignore-certificate-errors']});
const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1280,height:900},serviceWorkers:'block'});
const page=await context.newPage(),results=[],errors=[],intentBodies=[];let consoleErrors=0,socketMode='pass';
page.on('pageerror',error=>errors.push(error.message));
page.on('console',message=>{if(message.type()==='error')consoleErrors++;});
const pass=(name,detail={})=>results.push({test:name,status:'PASS',level:'LOCAL_AGENT_FIXTURE',...detail});
const check=(condition,name)=>{if(!condition)throw new Error(name);};
const received=()=>{try{return readFileSync(`${directory}/agent-received.jsonl`,'utf8').split('\n').filter(Boolean).map(line=>JSON.parse(line));}catch{return [];}};
const waitState=value=>page.waitForFunction(value=>document.getElementById('status')?.textContent===value,value,{timeout:15000});
const until=async(condition,name,ms=8000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await condition())return;await page.waitForTimeout(50);}throw new Error('Timed out: '+name);};

// The page-side view of the relay can be altered per scenario to see how the UI treats an agent that reports less than asked.
await page.routeWebSocket(/\/ws\/agent\//,socket=>{
  const server=socket.connectToServer();
  server.onMessage(message=>{
    if(typeof message==='string'){
      const parsed=JSON.parse(message);
      if(parsed.t==='ready'&&socketMode==='error'){socket.send(JSON.stringify({t:'error',code:'SCREEN_RECORDING_NOT_PERMITTED'}));return;}
      if(parsed.t==='ready'&&socketMode==='downgrade'){socket.send(JSON.stringify({...parsed,control:false,controlReason:'ACCESSIBILITY_NOT_PERMITTED',clipboard:false}));return;}
    }
    socket.send(message);
  });
  socket.onMessage(message=>server.send(message));
  socket.onClose((code,reason)=>server.close({code,reason}));
  server.onClose((code,reason)=>socket.close({code,reason}));
});
await page.route('**/api/connect-intents',route=>{intentBodies.push(route.request().postDataJSON());route.continue();});

async function open(){
  await page.goto(url);await waitState('READY');
}
async function startSession({clipboard=false,mode='control'}={}){
  if(await page.getByRole('button',{name:'Prepare connection',exact:true}).isVisible())await page.getByRole('button',{name:'Prepare connection',exact:true}).click();
  await page.getByLabel('I agree to control or view this shared desktop.').check();
  await page.locator('#mode').selectOption(mode);
  await page.locator('#clipboardConsent').setChecked(clipboard);
  await page.getByRole('button',{name:'Open desktop',exact:true}).click();
}
async function canvasFingerprint(){
  return page.evaluate(()=>{
    const canvas=document.querySelector('#surface canvas');if(!canvas)return null;
    const {data}=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height),colors=new Set();let hash=0;
    for(let i=0;i<data.length;i+=4*97){colors.add((data[i]<<16)|(data[i+1]<<8)|data[i+2]);hash=(hash*31+data[i]+data[i+1]*3+data[i+2]*7)>>>0;}
    return {width:canvas.width,height:canvas.height,colors:colors.size,hash};
  });
}
async function endSession(){await endWorkspace(page);await waitState('READY');}

try {
  await open();
  // ---- engine choice -----------------------------------------------------------------------------------------------
  check(await page.locator('#backendField').isVisible(),'Engine selector is offered when the server enables the agent and WebCodecs exists');
  check(await page.locator('#backend').inputValue()==='agent','The agent is the default when offered');
  check((await page.locator('#displayQuality option[value=low]').innerText()).includes('1.5 Mbit/s'),'Picture mode is described as a bitrate for the agent');
  check(await page.locator('#backendHelp').isVisible(),'Engine help is shown');
  await page.locator('#backend').selectOption('vnc');
  check((await page.locator('#displayQuality option[value=low]').innerText()).includes('16-bit'),'Picture mode is described as VNC colors for Screen Sharing');
  await page.locator('#backend').selectOption('agent');
  const diagnostics=await page.evaluate(()=>fetch('/api/diagnostics').then(r=>r.json()));
  check(JSON.stringify(diagnostics.backends)==='["vnc","agent"]'&&!JSON.stringify(diagnostics).includes('5960'),'Gateway advertises backends without agent details');
  pass('Engine selector, defaults, backend-specific picture mode text and capability advertisement');

  // ---- connect, decode, draw -----------------------------------------------------------------------------------------
  await startSession({clipboard:true});await waitState('CONNECTED');
  check(intentBodies.at(-1).backend==='agent','Intent names the agent backend');
  const first=await canvasFingerprint();
  check(first&&first.width===640&&first.height===360,'Canvas has the encoded size');check(first.colors>=8,'Canvas shows a decoded picture, not a blank frame: '+first.colors+' colors');
  await page.waitForTimeout(700);const later=await canvasFingerprint();check(later.hash!==first.hash,'The picture keeps changing (live decode)');
  await page.screenshot({path:'output/playwright/agent-fixture-desktop.png'});
  check(received()[0]?.t==='rate'&&received()[0].kbps===4000,'Balanced picture mode sets the initial bitrate');
  check(await page.locator('#clipboardBtn').isEnabled()&&await page.locator('#keysBtn').isEnabled(),'Capabilities follow the agent’s ready');
  pass('Real H.264 over the gateway relay is decoded and drawn; first frame sets CONNECTED; bitrate follows the picture mode',{colors:first.colors,size:`${first.width}x${first.height}`});

  // ---- input -----------------------------------------------------------------------------------------------------------
  const mark=received().length;
  await page.locator('#surface canvas').click({position:{x:100,y:100}});
  await until(async()=>(await page.locator('#inputStatus').innerText()).includes('Input active'),'input becomes active');
  await page.keyboard.press('a');await page.keyboard.down('Meta');await page.keyboard.press('c');await page.keyboard.up('Meta');
  await until(()=>received().slice(mark).filter(m=>m.t==='k').length>=6,'key messages reach the agent');
  const keys=received().slice(mark).filter(m=>m.t==='k');
  check(keys[0].s===97&&keys[0].d===true&&keys[1].s===97&&keys[1].d===false,'Plain key down and up in protocol shape');
  check(keys.some(k=>k.d===true&&(k.s===0xffe7||k.s===0xffe8||k.s===0xffeb||k.s===0xffec)),'Command modifier is its own key event (explicit modifier semantics)');
  const clickMark=received().length;await page.mouse.click(300,300);
  await until(()=>{const sent=received().slice(clickMark),press=sent.findIndex(m=>m.t==='m'&&m.b===1);return press>=0&&sent.slice(press).some(m=>m.t==='m'&&m.b===0);},'press and release reach the agent, in that order');
  check(received().slice(clickMark).every(m=>m.t!=='m'||(m.b&24)===0&&m.x>=0&&m.x<640&&m.y>=0&&m.y<360),'Pointer positions are video pixels and never carry wheel bits');
  pass('Keys, modifiers and clicks arrive in the protocol shape through the relay');

  // ---- scroll and move rates -------------------------------------------------------------------------------------------
  const scrollMark=received().length;
  await page.mouse.move(320,200);await page.mouse.wheel(0,300);
  await until(()=>received().slice(scrollMark).some(m=>m.t==='w'&&m.dy>0),'a wheel scroll reaches the agent as pixels');
  const floodMark=received().length,started=Date.now();
  await page.evaluate(()=>new Promise(resolve=>{
    const target=document.querySelector('#surface .capture'),box=document.querySelector('#surface canvas').getBoundingClientRect();let n=0;
    const timer=setInterval(()=>{
      target.dispatchEvent(new WheelEvent('wheel',{deltaY:4,deltaMode:0,clientX:box.left+200,clientY:box.top+120,bubbles:true,cancelable:true}));
      document.querySelector('#surface canvas').dispatchEvent(new MouseEvent('mousemove',{clientX:box.left+100+(n%200),clientY:box.top+100,bubbles:true}));
      if(++n>=1200){clearInterval(timer);resolve();}
    },1);
  }));
  await page.waitForTimeout(300);
  const flood=received().slice(floodMark),seconds=(Date.now()-started)/1000,wheels=flood.filter(m=>m.t==='w'),moves=flood.filter(m=>m.t==='m');
  check(wheels.length>0,'Flooded wheel input still produces scrolling');
  check(wheels.length/seconds<=75,`Wheel messages per second stay below the gateway limit: ${(wheels.length/seconds).toFixed(1)}/s`);
  check(moves.length/seconds<=130,`Move messages per second stay bounded: ${(moves.length/seconds).toFixed(1)}/s`);
  check(await page.locator('#status').innerText()==='CONNECTED','The session survived the flood (no RATE_LIMITED)');
  pass('A wheel/mouse flood stays under the gateway limits and the session survives',{wheelPerSecond:Number((wheels.length/seconds).toFixed(1)),movePerSecond:Number((moves.length/seconds).toFixed(1))});

  // ---- clipboard -------------------------------------------------------------------------------------------------------
  await openWorkspaceControls(page);await page.locator('#clipboardBtn').click();
  await page.locator('#localText').fill('剪贴板 rdg-123 café');await page.locator('#sendText').click();
  await until(()=>received().some(m=>m.t==='clip'&&m.text==='剪贴板 rdg-123 café'),'clipboard text reaches the agent');
  await until(async()=>(await page.locator('#clipboardStatus').innerText()).includes('The Mac confirmed the text'),'the agent’s confirmation is shown, without the VNC caveats');
  await page.keyboard.press('Escape');await page.locator('#clipboardDialog [data-close], #clipboardDialog button').first().click().catch(()=>{});
  pass('Clipboard text is sent once and confirmed by the agent’s result');

  // ---- release on end --------------------------------------------------------------------------------------------------
  const endMark=received().length;await endSession();
  await until(()=>received().slice(endMark).some(m=>m.t==='release'),'release reaches the agent when the session ends');
  pass('Ending the session releases everything on the agent');

  // ---- agent reports less than requested ------------------------------------------------------------------------------
  socketMode='downgrade';await startSession({clipboard:true});await waitState('CONNECTED');
  check((await page.locator('#inputStatus').innerText()).includes('Accessibility'),'The UI says the Accessibility grant is missing');
  check(await page.locator('#keysBtn').isDisabled()&&await page.locator('#clipboardBtn').isDisabled(),'Remote keys and clipboard stay disabled when the agent grants view only');
  const downMark=received().length;await page.locator('#surface canvas').click({position:{x:50,y:50}});await page.keyboard.press('b');await page.waitForTimeout(400);
  check(received().slice(downMark).every(m=>m.t!=='k'),'No key is sent when the agent reported view only');
  await endSession();
  pass('A missing Accessibility grant is shown and the UI never claims control');

  // ---- agent error ----------------------------------------------------------------------------------------------------
  socketMode='error';await startSession();await page.waitForFunction(()=>document.getElementById('notice')?.textContent.includes('Screen Recording permission'),null,{timeout:10000});
  check(await page.locator('#status').innerText()==='SCREEN_RECORDING_NOT_PERMITTED'||(await page.locator('#status').innerText())==='ERROR','Failure state shown');
  check((await page.locator('#notice').innerText()).includes('Screen Sharing'),'The message offers the VNC fallback');
  socketMode='pass';
  pass('A fixed agent error code becomes fixed explanatory text that points to the Screen Sharing fallback');

  // ---- VNC stays byte-identical ---------------------------------------------------------------------------------------
  await page.goto(url);await waitState('READY');await page.locator('#backend').selectOption('vnc');
  await startSession();await waitState('CONNECTED');
  check(!('backend' in intentBodies.at(-1)),'A VNC request does not mention a backend');
  check((await page.locator('#commandKeyField').evaluate(node=>node.hidden))===false,'The Command key trial is shown for VNC only');
  await endSession();
  pass('Choosing Screen Sharing leaves the VNC request unchanged and still connects');

  check(errors.length===0,'Browser JavaScript errors: '+errors.join(';'));check(consoleErrors===0,'Unexpected console errors: '+consoleErrors);
  await writeArtifact('qa/implementation/agent-browser-results.json',JSON.stringify({status:'PASS',browser:browser.version(),build:JSON.parse(readFileSync('web/dist/build.json','utf8')).build,fixture:true,realMac:false,realAgent:false,results,errors,consoleErrors},null,2)+'\n');
  console.log(JSON.stringify({browser:browser.version(),passed:results.length,errors:errors.length}));
}catch(error){
  await writeArtifact('qa/implementation/agent-browser-results.json',JSON.stringify({status:'FAIL',fixture:true,realMac:false,realAgent:false,results,errors,consoleErrors,failure:error.message},null,2)+'\n');
  await page.screenshot({path:'output/playwright/agent-browser-failure.png',fullPage:true}).catch(()=>{});
  console.error(JSON.stringify({failure:error.message,state:await page.locator('#status').innerText().catch(()=>null),notice:await page.locator('#notice').innerText().catch(()=>null),errors}));
  throw error;
}finally{await browser.close();}
