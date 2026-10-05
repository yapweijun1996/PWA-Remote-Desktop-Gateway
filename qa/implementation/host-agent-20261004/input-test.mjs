// PROTOTYPE input and clipboard test against the owner's real Mac, run WITH the owner's agreement and while they watch.
// Injects keys only into a TextEdit window showing a throwaway file, and checks the frontmost app before every step.
// Reads back only that file, the test strings it set on the clipboard, and modifier state. Usage: node input-test.mjs
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir,homedir} from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const token=readFileSync(path.join(homedir(),'Library/Application Support/RDG/agent.token'),'utf8').trim();
const dir=mkdtempSync(path.join(tmpdir(),'rdg-input-test-'));const file=path.join(dir,'rdg-key-test.txt');writeFileSync(file,'');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const front=()=>{try{const asn=execFileSync('lsappinfo',['front']).toString().trim();
  return execFileSync('lsappinfo',['info','-only','name',asn]).toString().match(/"LSDisplayName"="([^"]*)"/)?.[1]??'?';}catch{return '?';}};
const flags=()=>execFileSync(path.join(root,'.tools/agent/flags')).toString().trim();
// Spotlight is a system overlay, so lsappinfo keeps reporting the previous app; look for its window instead.
const spotlightOpen=()=>/Spotlight/.test(execFileSync(path.join(root,'.tools/agent/windows'),['--all']).toString());
const waitSpotlight=async(want,ms=2000)=>{for(let t=0;t<ms;t+=100){if(spotlightOpen()===want)return true;await sleep(100);}return spotlightOpen()===want;};
const KS={Return:0xff0d,BackSpace:0xff08,Delete:0xffff,Escape:0xff1b,Space:0x20,Control:0xffe3,Command:0xffe7};
const results=[];const record=(name,ok,detail='')=>{results.push({name,ok,detail});console.log(`${ok?'PASS':'FAIL'}  ${name}${detail?'  ['+detail+']':''}`);};
let ws,ready=null,clipFromMac=null,abort=null;
const send=o=>ws.send(JSON.stringify(o));
const down=s=>send({t:'k',s,d:true}),up=s=>send({t:'k',s,d:false});
const tap=async s=>{down(s);await sleep(25);up(s);await sleep(25);};
const typeAscii=async text=>{for(const ch of text)await tap(ch.charCodeAt(0));};
const holdAndPress=async(mod,key,holdMs=1000)=>{down(mod);await sleep(holdMs);await tap(key);up(mod);await sleep(150);};
const guardTextEdit=()=>{if(front()!=='TextEdit'){abort=`front app is "${front()}", not TextEdit`;throw new Error(abort);}};
const saveAndRead=async()=>{guardTextEdit();await holdAndPress(KS.Command,'s'.charCodeAt(0),150);await sleep(900);return readFileSync(file,'utf8');};
const clearDoc=async()=>{guardTextEdit();for(let i=0;i<60;i++){down(KS.BackSpace);up(KS.BackSpace);down(KS.Delete);up(KS.Delete);}await sleep(300);};

try{
  const wasRunning=(()=>{try{execFileSync('pgrep',['-x','TextEdit']);return true;}catch{return false;}})();
  try{execFileSync('pgrep',['-f','RDGAgent.app/Contents/MacOS/rdg-agent --port']);}catch{
    execFileSync('open',['-n','--stderr',path.join(dir,'agent.log'),path.join(root,'.tools/agent/RDGAgent.app'),'--args','--port','5960','--max-width','1920']);await sleep(2000);}
  execFileSync('open',['-a','TextEdit',file]);await sleep(2500);
  record('TextEdit is frontmost with the throwaway file',front()==='TextEdit',front());guardTextEdit();

  ws=new WebSocket('ws://127.0.0.1:5960');ws.binaryType='arraybuffer';
  ws.onmessage=e=>{if(typeof e.data!=='string')return;const m=JSON.parse(e.data);if(m.t==='ready')ready=m;if(m.t==='clip')clipFromMac=m.text;if(m.t==='error')abort='agent error '+m.code;};
  await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=()=>rej(new Error('connect failed'));});
  send({t:'hello',token,control:true,clipboard:true});
  for(let i=0;i<60&&!ready&&!abort;i++)await sleep(100);
  if(abort)throw new Error(abort);
  record('agent grants control and clipboard',ready?.control===true&&ready?.clipboard===true,JSON.stringify({control:ready?.control,reason:ready?.controlReason,clipboard:ready?.clipboard}));
  if(!ready?.control)throw new Error('control not granted');

  await typeAscii('abc');let text=await saveAndRead();
  record('plain typing works (baseline)',text==='abc',JSON.stringify(text));

  await holdAndPress(KS.Control,'a'.charCodeAt(0));await typeAscii('x');text=await saveAndRead();
  record('Control held 1 s + A moves to line start (expect xabc)',text==='xabc',JSON.stringify(text));
  await clearDoc();

  for(const holdMs of [150,1000]){
    await typeAscii('123');await holdAndPress(KS.Command,'a'.charCodeAt(0),holdMs);await typeAscii('x');text=await saveAndRead();
    record(`Command held ${holdMs} ms + A selects all, then x replaces it (expect x)`,text==='x',JSON.stringify(text));
    await clearDoc();
  }

  down(KS.Command);await sleep(100);await tap(KS.Space);up(KS.Command);
  record('Command+Space opens Spotlight',await waitSpotlight(true),'');
  await tap(KS.Escape);
  record('Escape closes Spotlight',await waitSpotlight(false)&&front()==='TextEdit',front());

  guardTextEdit();send({t:'type',text:'你好 rdg'});await sleep(600);text=await saveAndRead();
  record('typing Chinese as text (expect 你好 rdg)',text==='你好 rdg',JSON.stringify(text));
  await clearDoc();

  const clipTest='剪贴板 rdg-123 café';send({t:'clip',text:clipTest});await sleep(500);
  const mac=execFileSync('pbpaste',{env:{...process.env,LC_ALL:'en_US.UTF-8'}}).toString();record('client → Mac clipboard reaches the pasteboard (incl. Chinese and é)',mac===clipTest,JSON.stringify(mac));
  guardTextEdit();await holdAndPress(KS.Command,'v'.charCodeAt(0),150);await sleep(300);text=await saveAndRead();
  record('Command+V pastes it into TextEdit',text===clipTest,JSON.stringify(text));
  await clearDoc();

  const macSide='456-MAC-TO-CLIENT 出 RDG';clipFromMac=null;send({t:'type',text:macSide});await sleep(600);guardTextEdit();
  await holdAndPress(KS.Command,'a'.charCodeAt(0),150);await holdAndPress(KS.Command,'c'.charCodeAt(0),150);
  for(let i=0;i<30&&clipFromMac===null;i++)await sleep(100);
  record('Mac → client: copying in TextEdit arrives at the client',clipFromMac===macSide,JSON.stringify(clipFromMac));
  await clearDoc();

  down(KS.Command);down(KS.Control);await sleep(400);const held=flags();
  ws.close();await sleep(800);const after=flags();
  record('held modifiers are visible to macOS while held',held.startsWith('true true'),held);
  record('closing the client mid-chord releases every key (no stuck modifier)',after==='false false false false',after);
}catch(error){
  console.log('ABORTED:',error.message);record('test ran to completion',false,error.message);
}finally{
  try{ws?.readyState===1&&(send({t:'release'}),ws.close());}catch{}
  await sleep(500);
  const wasRunning=false;
  try{execFileSync('pkill',['-x','TextEdit']);}catch{}
  const leftover=flags();record('no modifier is stuck at the end',leftover==='false false false false',leftover);
  rmSync(dir,{recursive:true,force:true});
  writeFileSync(path.join(root,'.tools/agent/measure/input-test.json'),JSON.stringify(results,null,1));
  console.log(`${results.filter(r=>r.ok).length}/${results.length} passed`);
  process.exit(results.every(r=>r.ok)?0:1);
}
