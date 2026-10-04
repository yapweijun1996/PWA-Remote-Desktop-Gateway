// PROTOTYPE agent security checks. The agent is launched with `open` so macOS treats RDG Agent as its own responsible
// process: without its own Screen Recording grant it reports SCREEN_RECORDING_NOT_PERMITTED and never captures or prompts.
// (Spawned directly from a terminal it would inherit the terminal's grant and capture the real screen.)
// Usage: node agent/macos/test/security-checks.mjs <path to RDGAgent.app> (Playwright via RDG_PLAYWRIGHT_MODULE / RDG_TEST_CHROMIUM)
import {spawn,execFileSync} from 'node:child_process';
import {mkdtempSync,statSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import path from 'node:path';import http from 'node:http';import net from 'node:net';
import {createRequire} from 'node:module';
const app=process.argv[2];const binary=path.join(app,'Contents/MacOS/rdg-agent');
const results=[];const check=(name,ok,detail='')=>{results.push({name,ok,detail});if(!ok)process.exitCode=1;};
const freePort=()=>new Promise(r=>{const s=net.createServer().listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));});});
const dir=mkdtempSync(path.join(tmpdir(),'rdg-agent-'));const tokenFile=path.join(dir,'agent.token');
let agent;
try{
  execFileSync(binary,['--init-token','--token-file',tokenFile],{stdio:'ignore'});
  const mode=statSync(tokenFile).mode&0o777,first=readFileSync(tokenFile,'utf8');
  check('token file is 0600',mode===0o600,mode.toString(8));
  execFileSync(binary,['--init-token','--token-file',tokenFile],{stdio:'ignore'});
  check('an existing token is never replaced',readFileSync(tokenFile,'utf8')===first);
  const token=first.trim();
  const port=await freePort(),pagePort=await freePort(),otherPort=await freePort();
  let stderr='';
  const logFile=path.join(dir,'agent.log');
  execFileSync('open',['-n','--stderr',logFile,app,'--args','--port',String(port),'--token-file',tokenFile,'--allow-origin',`http://127.0.0.1:${pagePort}`]);
  agent={kill:()=>{try{execFileSync('pkill',['-f',`${binary} --port ${port} `]);}catch{}}};
  const readLog=()=>{try{return readFileSync(logFile,'utf8');}catch{return '';}};
  for(let i=0;i<50&&!readLog().includes('listening');i++)await new Promise(r=>setTimeout(r,100));
  const listeners=execFileSync('netstat',['-anv','-p','tcp'],{encoding:'utf8'}).split('\n').filter(l=>l.includes(`.${port} `)&&l.includes('LISTEN'));
  check('listens on 127.0.0.1 only',listeners.length===1&&listeners[0].includes(`127.0.0.1.${port}`),listeners.map(l=>l.trim().split(/\s+/)[3]).join(','));
  const session=(send,waitMs=3500)=>new Promise(resolve=>{
    const ws=new WebSocket(`ws://127.0.0.1:${port}`);const messages=[];let opened=false;const t0=Date.now();
    ws.onopen=()=>{opened=true;send?.(ws);};ws.onmessage=e=>messages.push(typeof e.data==='string'?JSON.parse(e.data):'binary');
    const done=()=>resolve({opened,messages,closedAfterMs:Date.now()-t0});ws.onclose=done;setTimeout(()=>{ws.close();done();},waitMs);
  });
  let r=await session(ws=>ws.send(JSON.stringify({t:'hello',token:'A'.repeat(43)})));
  check('wrong token is disconnected without data',r.opened&&r.messages.length===0&&r.closedAfterMs<1500,JSON.stringify(r));
  r=await session(null,4000);
  check('silence is disconnected after the 2 s auth deadline',r.opened&&r.messages.length===0&&r.closedAfterMs>=1800&&r.closedAfterMs<3500,String(r.closedAfterMs));
  r=await session(ws=>ws.send('not json'));
  check('a non-hello first message is disconnected',r.messages.length===0&&r.closedAfterMs<1500);
  r=await session(ws=>ws.send(JSON.stringify({t:'hello',token,control:true})));
  check('valid token authenticates; missing Screen Recording is reported, not prompted',
    r.messages.some(m=>m.t==='error'&&m.code==='SCREEN_RECORDING_NOT_PERMITTED'),JSON.stringify(r.messages));
  const holder=new WebSocket(`ws://127.0.0.1:${port}`);await new Promise(res=>holder.onopen=res);
  r=await session(ws=>ws.send(JSON.stringify({t:'hello',token})),1500);
  check('a second client is refused while one is connected',!r.opened&&r.messages.length===0,JSON.stringify(r));
  holder.close();await new Promise(res=>setTimeout(res,2300));
  const {chromium}=createRequire(import.meta.url)(process.env.RDG_PLAYWRIGHT_MODULE);
  stderr=readLog();
  const browser=await chromium.launch({headless:true,executablePath:process.env.RDG_TEST_CHROMIUM});
  const servePage=p=>new Promise(res=>{const s=http.createServer((q,a)=>{a.setHeader('content-type','text/html');a.end('<!doctype html><title>t</title>');}).listen(p,'127.0.0.1',()=>res(s));});
  for(const [label,pport,expectOpen] of [['allowed local test origin',pagePort,true],['any other web page',otherPort,false]]){
    const server=await servePage(pport);const page=await browser.newPage();await page.goto(`http://127.0.0.1:${pport}/`);
    const out=await page.evaluate(([p,tok])=>new Promise(res=>{const ws=new WebSocket(`ws://127.0.0.1:${p}`);const m=[];let opened=false;
      ws.onopen=()=>{opened=true;ws.send(JSON.stringify({t:'hello',token:tok}));};ws.onmessage=e=>m.push(typeof e.data==='string'?JSON.parse(e.data):{t:'binary'});
      ws.onclose=()=>res({opened,m});setTimeout(()=>res({opened,m}),2500);}),[port,token]);
    check(`browser from ${label} ${expectOpen?'connects':'is refused at the handshake'}`,out.opened===expectOpen,JSON.stringify(out));
    if(expectOpen)check('no ready, config or video without the app\'s own Screen Recording grant',
      out.m.some(x=>x.code==='SCREEN_RECORDING_NOT_PERMITTED')&&!out.m.some(x=>['ready','config','binary'].includes(x.t)),JSON.stringify(out.m));
    await page.close();server.close();await new Promise(res=>setTimeout(res,2300));
  }
  await browser.close();
  stderr=readLog();
  check('agent log never contains the token',!stderr.includes(token));
  check('agent log has no message content',!/hello|token\W/i.test(stderr.replace('token file ready','')),stderr.split('\n').filter(Boolean).slice(-3).join(' | '));
}finally{agent?.kill();rmSync(dir,{recursive:true,force:true});}
for(const r of results)console.log(`${r.ok?'PASS':'FAIL'}  ${r.name}${r.detail?'  ['+r.detail+']':''}`);
