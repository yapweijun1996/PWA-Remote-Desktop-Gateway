// PROTOTYPE: pixel scrolling through the agent. A local page reports window.scrollY to this script, so the result is read
// without capturing or inspecting any screen content. Run with the owner's agreement while they watch.
import {execFileSync} from 'node:child_process';import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir,homedir} from 'node:os';import path from 'node:path';import http from 'node:http';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const token=readFileSync(path.join(homedir(),'Library/Application Support/RDG/agent.token'),'utf8').trim();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const results=[];const record=(name,ok,detail='')=>{results.push({name,ok,detail});console.log(`${ok?'PASS':'FAIL'}  ${name}${detail?'  ['+detail+']':''}`);};
let scrollY=0,reports=0,viewport=null;
const rows=Array.from({length:600},(_,i)=>`<p style="margin:0;padding:6px;border-bottom:1px solid #ccc">Scroll test row ${i+1}</p>`).join('');
const server=http.createServer((q,r)=>{
  if(q.url.startsWith('/y')){const u=new URL(q.url,'http://x');scrollY=Number(u.searchParams.get('v'));viewport=[Number(u.searchParams.get('w')),Number(u.searchParams.get('h'))];reports++;r.end('ok');return;}
  r.setHeader('content-type','text/html');
  r.end(`<!doctype html><title>agent scroll test</title><body style="margin:0;font:16px system-ui">${rows}<script>
    const send=()=>navigator.sendBeacon('/y?v='+Math.round(scrollY)+'&w='+innerWidth+'&h='+innerHeight);
    addEventListener('scroll',send,{passive:true});setInterval(send,300);</script></body>`);
}).listen(0,'127.0.0.1');
await new Promise(r=>server.on('listening',r));
const port=server.address().port;
let ws;
try{
  try{execFileSync('pgrep',['-f','RDGAgent.app/Contents/MacOS/rdg-agent --port']);}catch{execFileSync('open',['-n',path.join(root,'.tools/agent/RDGAgent.app'),'--args','--port','5960']);await sleep(2500);}
  execFileSync('open',[`http://127.0.0.1:${port}/`]);
  for(let i=0;i<60&&reports===0;i++)await sleep(100);
  record('the test page opened in the default browser and reports its scroll position',reports>0,reports?`viewport ${viewport}`:'');
  if(!reports)throw new Error('page did not load');
  await sleep(800);
  let ready=null;ws=new WebSocket('ws://127.0.0.1:5960');ws.onmessage=e=>{if(typeof e.data==='string'){const m=JSON.parse(e.data);if(m.t==='ready')ready=m;}};
  await new Promise(r=>ws.onopen=r);ws.send(JSON.stringify({t:'hello',v:1,token,control:true}));
  for(let i=0;i<80&&!ready;i++)await sleep(100);
  if(!ready?.control)throw new Error('no control');
  const cx=Math.round(ready.width/2),cy=Math.round(ready.height/2);
  const w=dy=>ws.send(JSON.stringify({t:'w',x:cx,y:cy,dy}));
  const before=scrollY;
  w(300);await sleep(700);const down=scrollY;
  record('dy +300 scrolls the page down',down>before,`${before} -> ${down}`);
  w(300);w(300);await sleep(700);const down2=scrollY;
  record('two more +300 messages keep scrolling down',down2>down,`${down} -> ${down2}`);
  w(-300);await sleep(700);const up=scrollY;
  record('dy -300 scrolls back up',up<down2,`${down2} -> ${up}`);
  const unit=down-before;record('one +300 message moves the page by about 300 px of its own pixels (scale 0.5..2)',unit>=150&&unit<=600,`${unit} px`);
  ws.send(JSON.stringify({t:'w',x:cx,y:cy,dy:0}));ws.send(JSON.stringify({t:'w',x:cx,y:cy,dy:99999}));ws.send(JSON.stringify({t:'w',x:-1,y:cy,dy:50}));await sleep(500);
  record('a zero, oversized or out-of-range scroll is ignored',scrollY===up,`${up} -> ${scrollY}`);
}catch(error){console.log('ABORTED:',error.message);record('test ran to completion',false,error.message);}
finally{try{ws?.close();}catch{}await sleep(400);server.close();console.log(`${results.filter(r=>r.ok).length}/${results.length} passed`);process.exit(results.every(r=>r.ok)?0:1);}
