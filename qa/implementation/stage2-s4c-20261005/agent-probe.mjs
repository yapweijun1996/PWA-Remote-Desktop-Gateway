/**
 * Stage 2 S4(c): a protocol-only look at the real agent on loopback. Authenticates with the token file (never printed), asks for
 * control so the agent reveals which permissions it really has, counts video frames for a few seconds and closes. It sends no key,
 * pointer, clipboard or text message and keeps no frame. Run it only while the owner is watching the Mac.
 */
import {readFileSync} from 'node:fs';import {homedir} from 'node:os';
const token=readFileSync(homedir()+'/Library/Application Support/RDG/agent.token','utf8').trim();
const ws=new WebSocket('ws://127.0.0.1:5960');ws.binaryType='arraybuffer';
const seen={ready:null,config:null,frames:0,keyframes:0,bytes:0,maxFrame:0,errors:[],statuses:0,secureInput:null};
const done=new Promise(resolve=>{
  const stop=setTimeout(()=>resolve('timeout'),6000);
  ws.onopen=()=>ws.send(JSON.stringify({t:'hello',v:1,token,control:true,clipboard:false}));
  ws.onmessage=event=>{
    if(typeof event.data!=='string'){const view=new DataView(event.data);seen.frames++;seen.bytes+=event.data.byteLength;seen.maxFrame=Math.max(seen.maxFrame,event.data.byteLength);if(view.getUint8(1)===1)seen.keyframes++;return;}
    const message=JSON.parse(event.data);
    if(message.t==='ready')seen.ready={width:message.width,height:message.height,control:message.control,controlReason:message.controlReason,clipboard:message.clipboard,encoder:message.encoder};
    else if(message.t==='config')seen.config={codec:message.codec,width:message.width,height:message.height};
    else if(message.t==='status'){seen.statuses++;seen.secureInput=message.secureInput;}
    else if(message.t==='error')seen.errors.push(message.code);
    if(seen.ready&&seen.statuses>=3){clearTimeout(stop);resolve('observed');}
  };
  ws.onclose=()=>{clearTimeout(stop);resolve('closed');};ws.onerror=()=>{clearTimeout(stop);resolve('error');};
});
const how=await done;
try{ws.send(JSON.stringify({t:'release'}));ws.close();}catch{}
console.log(JSON.stringify({how,...seen,avgFrameBytes:seen.frames?Math.round(seen.bytes/seen.frames):0}));
process.exit(seen.ready&&!seen.errors.length?0:1);
