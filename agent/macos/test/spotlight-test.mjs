// PROTOTYPE: does an injected Command+Space open Spotlight? Needs the agent running with its own Accessibility grant.
import {execFileSync} from 'node:child_process';import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir,homedir} from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const token=readFileSync(path.join(homedir(),'Library/Application Support/RDG/agent.token'),'utf8').trim();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const dir=mkdtempSync(path.join(tmpdir(),'rdg-spot-'));const file=path.join(dir,'x.txt');writeFileSync(file,'');
const front=()=>{try{const a=execFileSync('lsappinfo',['front']).toString().trim();return execFileSync('lsappinfo',['info','-only','name',a]).toString().match(/"LSDisplayName"="([^"]*)"/)?.[1]??'?';}catch{return '?';}};
const spot=()=>execFileSync(path.join(root,'.tools/agent/windows'),['--all']).toString().trim();
let ws;
try{
  try{execFileSync('pgrep',['-f','RDGAgent.app/Contents/MacOS/rdg-agent --port']);}catch{execFileSync('open',['-n',path.join(root,'.tools/agent/RDGAgent.app'),'--args','--port','5960']);await sleep(2500);}
  execFileSync('open',['-a','TextEdit',file]);await sleep(2500);
  if(front()!=='TextEdit')throw new Error('TextEdit is not frontmost: '+front());
  console.log('before: Spotlight windows =',JSON.stringify(spot()));
  let ready=null;ws=new WebSocket('ws://127.0.0.1:5960');ws.onmessage=e=>{if(typeof e.data==='string'){const m=JSON.parse(e.data);if(m.t==='ready')ready=m;}};
  await new Promise(r=>ws.onopen=r);ws.send(JSON.stringify({t:'hello',v:1,token,control:true}));
  for(let i=0;i<80&&!ready;i++)await sleep(100);
  if(!ready?.control)throw new Error('no control');
  const k=(s,d)=>ws.send(JSON.stringify({t:'k',s,d}));
  k(0xffe7,true);await sleep(100);k(0x20,true);await sleep(40);k(0x20,false);k(0xffe7,false);
  for(let i=0;i<8;i++){await sleep(250);const w=spot();if(w){console.log(`+${(i+1)*250} ms: Spotlight windows = ${JSON.stringify(w)}`);break;}if(i===7)console.log('no Spotlight window within 2 s');}
  k(0xff1b,true);await sleep(40);k(0xff1b,false);await sleep(700);
  console.log('after Escape: Spotlight windows =',JSON.stringify(spot()),'| front app =',front());
}catch(e){console.log('ABORTED:',e.message);}
finally{try{ws?.close();}catch{}await sleep(400);try{execFileSync('pkill',['-x','TextEdit']);}catch{}rmSync(dir,{recursive:true,force:true});}
