import test from 'node:test';import assert from 'node:assert/strict';
import {AgentAdapter,CLIPBOARD_RESULT_MS,FIRST_FRAME_MS} from './agent-adapter.mjs';
import {setLocale} from './i18n.mjs';

const avcc='AU1EKP/hABRnTQAo2oBQAW5AtQYGhoAAAAMAgA==';
const ready=(over={})=>JSON.stringify({t:'ready',v:1,width:1280,height:720,control:true,controlReason:'GRANTED',clipboard:true,encoder:'hw',...over});
const config=JSON.stringify({t:'config',codec:'avc1.4D0028',avcc,width:1280,height:720});
const frame=(key,sequence)=>{const bytes=new Uint8Array(18),view=new DataView(bytes.buffer);bytes[0]=1;bytes[1]=key?1:0;view.setUint32(10,sequence,false);return bytes.buffer;};

function rig({mode='control',clipboard=true,scrollSpeed}={}) {
  setLocale('en');
  const log={sent:[],states:[],failures:[],inputMessages:[],clipboard:[],readies:[],timers:new Map(),frames:new Map(),decoders:[],closedSockets:[]};let time=0,id=0,frameId=0;
  class FakeSocket{
    static last=null;
    constructor(url,protocol){this.url=url;this.protocol=protocol;this.readyState=0;this.bufferedAmount=0;FakeSocket.last=this;log.socket=this;}
    send(text){log.sent.push(JSON.parse(text));}
    close(code){this.readyState=3;log.closedSockets.push(code);}
    open(){this.readyState=1;}
    receive(data){this.onmessage?.({data});}   // a closed adapter has no handler, as in a browser
  }
  class FakeFrame{constructor(){this.closed=false;}close(){this.closed=true;}}
  class FakeDecoder{
    static async isConfigSupported(){return {supported:true};}
    constructor(init){this.init=init;this.state='unconfigured';this.decodeQueueSize=0;log.decoders.push(this);}
    configure(){this.state='configured';}decode(){}close(){this.state='closed';}
    emit(){const f=new FakeFrame();this.init.output(f);return f;}
  }
  const elements=[];
  const makeElement=tag=>{const element=Object.assign(new EventTarget(),{tag,children:[],style:{},attributes:{},className:'',width:0,height:0,clientWidth:1280,clientHeight:720,
    append(...nodes){this.children.push(...nodes);},replaceChildren(...nodes){this.children=nodes;},setAttribute(name,value){this.attributes[name]=value;},focus(){document.activeElement=this;},blur(){},
    getContext:()=>({drawImage:()=>{}}),getBoundingClientRect:()=>({left:0,top:0})});elements.push(element);return element;};
  globalThis.window=new EventTarget();globalThis.document=Object.assign(new EventTarget(),{hidden:false,activeElement:null,createElement:makeElement});
  globalThis.location={protocol:'https:',host:'gateway.example'};
  class State{constructor(x,y,left,middle,right,up,down){Object.assign(this,{x,y,left,middle,right,up,down});}}
  class Mouse{static State=State;onEach(){}}Mouse.Touchpad=Mouse;
  let keyboard;class Keyboard{constructor(){keyboard=this;}reset(){}}
  globalThis.Guacamole={Keyboard,Mouse};
  const surface=makeElement('div');
  const adapter=new AgentAdapter({surface,profile:'mac-native',keysyms:{CommandLeft:0xffe7,CommandRight:0xffe8,OptionLeft:0xffe9,OptionRight:0xffea,ControlLeft:0xffe3,ControlRight:0xffe4},
    onState:value=>log.states.push(value),onFailure:code=>log.failures.push(code),onInput:message=>log.inputMessages.push(message),onClipboard:text=>log.clipboard.push(text),
    onReady:info=>log.readies.push(info),clipboard,scrollSpeed,
    deps:{WebSocketImpl:FakeSocket,VideoDecoder:FakeDecoder,EncodedVideoChunk:class{constructor(i){Object.assign(this,i);}},createCanvas:()=>makeElement('canvas'),
      setTimer:(fn,ms)=>{log.timers.set(++id,{fn,ms});return id;},clearTimer:i=>log.timers.delete(i),now:()=>time,frame:fn=>{log.frames.set(++frameId,fn);return frameId;},cancelFrame:i=>log.frames.delete(i)}});
  const tick=async()=>{await new Promise(resolve=>setImmediate(resolve));};
  const runFrames=()=>{for(const [key,fn] of [...log.frames]){log.frames.delete(key);fn();}};
  const fire=ms=>{for(const [key,timer] of [...log.timers])if(timer.ms===ms){log.timers.delete(key);timer.fn();}};
  const connect=async()=>{adapter.connect('I'.repeat(43),mode);const socket=log.socket;socket.open();socket.receive(ready());socket.receive(config);await tick();return socket;};
  return {adapter,log,surface,connect,tick,runFrames,fire,advance:ms=>{time+=ms;},keyboard:()=>keyboard,FakeSocket};
}

test('connects to the agent route with the agent subprotocol and shows CONNECTING; CONNECTED comes with the first drawn frame',async()=>{
  const r=rig();r.adapter.connect('A'.repeat(43),'control');
  assert.equal(r.log.socket.url,'wss://gateway.example/ws/agent/'+'A'.repeat(43));assert.equal(r.log.socket.protocol,'rdg-agent.v1');assert.equal(r.log.socket.binaryType,'arraybuffer');
  assert.deepEqual(r.log.states,['CONNECTING']);
  r.log.socket.open();r.log.socket.receive(ready());r.log.socket.receive(config);await r.tick();
  assert.deepEqual(r.log.states,['CONNECTING'],'ready alone is not a picture');
  r.log.decoders[0].emit();r.runFrames();assert.deepEqual(r.log.states,['CONNECTING','CONNECTED']);
  assert.equal(r.adapter.stats().firstDisplayMs!==null,true);
});

test('ready decides the effective capabilities: control and clipboard are granted only when both the request and the agent say so',async()=>{
  let r=rig();await r.connect();
  assert.deepEqual(r.log.readies.at(-1),{control:true,clipboard:true,controlReason:'GRANTED'});assert.equal(r.adapter.input.mode,'control');
  r=rig({mode:'view'});await r.connect();assert.deepEqual(r.log.readies.at(-1),{control:false,clipboard:false,controlReason:'GRANTED'});assert.equal(r.adapter.input.mode,'view');
  r=rig({clipboard:false});await r.connect();assert.equal(r.log.readies.at(-1).clipboard,false);
});

test('a missing Accessibility grant downgrades the session to view only and says so, never claiming control',async()=>{
  const r=rig();r.adapter.connect('A'.repeat(43),'control');r.log.socket.open();
  r.log.socket.receive(ready({control:false,controlReason:'ACCESSIBILITY_NOT_PERMITTED',clipboard:false}));
  assert.equal(r.adapter.input.mode,'view');assert.deepEqual(r.log.readies.at(-1),{control:false,clipboard:false,controlReason:'ACCESSIBILITY_NOT_PERMITTED'});
  assert.ok(r.log.inputMessages.some(message=>/Accessibility/.test(message)));
  r.adapter.input.enabled=true;document.activeElement=r.adapter.input.surface;r.adapter.input.keys.down('physical:99','keysym:99',{physical:true});
  assert.equal(r.log.sent.filter(m=>m.t==='k').length,0,'no key reaches the agent in view mode');
  await assert.rejects(async()=>r.adapter.sendClipboard('x'),/CLIPBOARD_DISABLED/);
});

test('keys, pointer and wheel reach the agent in the protocol shape, and a pause sends release as well',async()=>{
  const r=rig({scrollSpeed:'fast'});await r.connect();const input=r.adapter.input;
  input.enabled=true;document.activeElement=input.surface;r.log.sent.length=0;
  r.keyboard().onkeydown(0xffe7);r.keyboard().onkeydown(99);r.keyboard().onkeyup(99);r.keyboard().onkeyup(0xffe7);
  assert.deepEqual(r.log.sent.map(m=>[m.t,m.s,m.d]),[['k',0xffe7,true],['k',99,true],['k',99,false],['k',0xffe7,false]]);
  r.log.sent.length=0;
  const wheel=Object.assign(new Event('wheel',{cancelable:true}),{deltaY:120,deltaMode:0,clientX:200,clientY:100});input.surface.dispatchEvent(wheel);
  assert.equal(wheel.defaultPrevented,true);r.advance(20);r.runFrames();
  assert.deepEqual(r.log.sent,[{t:'w',x:200,y:100,dy:120}],'default speed is 1:1 pixels, with no click conversion');
  r.log.sent.length=0;input.pause();assert.deepEqual(r.log.sent.at(-1),{t:'release'});
});

test('blur, hide and disconnect release everything on the agent',async()=>{
  const r=rig();await r.connect();const input=r.adapter.input;
  for(const trigger of [()=>input.surface.dispatchEvent(new Event('blur')),()=>{document.hidden=true;document.dispatchEvent(new Event('visibilitychange'));document.hidden=false;},()=>window.dispatchEvent(new Event('blur'))]){
    r.log.sent.length=0;trigger();assert.ok(r.log.sent.some(m=>m.t==='release'));
  }
  r.log.sent.length=0;r.adapter.disconnect();assert.ok(r.log.sent.some(m=>m.t==='release'),'release goes out before the socket closes');
});

test('input before ready or after the socket closes is dropped, never queued',async()=>{
  const r=rig();r.adapter.connect('A'.repeat(43),'control');
  assert.equal(r.adapter.input,null,'no input surface exists before ready');
  r.log.socket.open();r.log.socket.receive(ready());r.log.socket.receive(config);await r.tick();
  r.log.socket.readyState=2;r.log.sent.length=0;r.adapter.sink.sendKeyEvent(1,99);r.adapter.sink.wheel(1,1,50);r.runFrames();assert.equal(r.log.sent.length,0);
  r.log.socket.readyState=1;r.runFrames();assert.equal(r.log.sent.length,0);
});

test('fixed error codes from the agent or gateway end the session once with a known code; unknown text is never shown',async()=>{
  for(const [sent,shown] of [['SCREEN_RECORDING_NOT_PERMITTED','SCREEN_RECORDING_NOT_PERMITTED'],['AGENT_UNAVAILABLE','AGENT_UNAVAILABLE'],['READ_ONLY','READ_ONLY'],['/Users/x/secret path','TRANSPORT_ERROR']]) {
    const r=rig();r.adapter.connect('A'.repeat(43),'control');r.log.socket.open();
    r.log.socket.receive(JSON.stringify({t:'error',code:sent}));r.log.socket.onclose();r.log.socket.onerror();await r.tick();
    assert.deepEqual(r.log.failures,[shown],'a close after the error does not report a second failure');
  }
});

test('a socket that closes or errors without a code is reported as a plain disconnect or transport error, once',async()=>{
  let r=rig();r.adapter.connect('A'.repeat(43),'view');r.log.socket.onclose();await r.tick();assert.deepEqual(r.log.failures,['DISCONNECTED']);
  r=rig();r.adapter.connect('A'.repeat(43),'view');r.log.socket.onerror();r.log.socket.onclose();await r.tick();assert.deepEqual(r.log.failures,['TRANSPORT_ERROR']);
  r=rig();r.adapter.connect('A'.repeat(43),'view');r.log.socket.receive('not json');await r.tick();assert.deepEqual(r.log.failures,['AGENT_PROTOCOL']);
});

test('no picture within the time limit fails with a fixed code',async()=>{
  const r=rig();await r.connect();r.fire(FIRST_FRAME_MS);await r.tick();assert.deepEqual(r.log.failures,['VIDEO_UNAVAILABLE']);
  const q=rig();await q.connect();q.log.decoders[0].emit();q.runFrames();q.fire(FIRST_FRAME_MS);await q.tick();assert.deepEqual(q.log.failures,[],'the watchdog is cancelled by the first frame');
});

test('clipboard to the Mac waits for the agent’s result, one transfer at a time, and times out',async()=>{
  const r=rig();await r.connect();
  const first=r.adapter.sendClipboard('hello');
  assert.deepEqual(r.log.sent.at(-1),{t:'clip',text:'hello'});
  await assert.rejects(async()=>r.adapter.sendClipboard('second'),/CLIPBOARD_UNAVAILABLE/,'a second transfer is refused while one is in flight');
  r.log.socket.receive(JSON.stringify({t:'clip-result',ok:true}));await first;
  const failed=r.adapter.sendClipboard('again');r.log.socket.receive(JSON.stringify({t:'clip-result',ok:false}));await assert.rejects(failed,/CLIPBOARD_UNAVAILABLE/);
  const slow=r.adapter.sendClipboard('slow');r.fire(CLIPBOARD_RESULT_MS);await assert.rejects(slow,/CLIPBOARD_TIMEOUT/);
  r.log.socket.receive(JSON.stringify({t:'clip-result',ok:true}));   // a late result after the timeout is ignored
  await assert.rejects(async()=>r.adapter.sendClipboard(''),/CLIPBOARD_EMPTY/);
  await assert.rejects(async()=>r.adapter.sendClipboard('a'.repeat(16385)),/CLIPBOARD_TOO_LARGE/);
  await assert.rejects(async()=>r.adapter.sendClipboard('\u0001'.repeat(16384)),/CLIPBOARD_TOO_LARGE/,'would exceed the gateway’s raw message limit');
});

test('clipboard from the Mac is accepted only when granted and within the size cap',async()=>{
  let r=rig();await r.connect();r.log.socket.receive(JSON.stringify({t:'clip',text:'from the mac'}));assert.deepEqual(r.log.clipboard,['from the mac']);
  r.log.socket.receive(JSON.stringify({t:'clip',text:'a'.repeat(16385)}));assert.equal(r.log.clipboard.length,1);
  r=rig({clipboard:false});await r.connect();r.log.socket.receive(JSON.stringify({t:'clip',text:'unwanted'}));assert.deepEqual(r.log.clipboard,[]);
});

test('status updates frame rates and tells the user about secure input without claiming control is broken',async()=>{
  const r=rig();await r.connect();
  r.advance(1000);r.log.socket.receive(JSON.stringify({t:'status',secureInput:false,sent:10,dropped:0,bytes:1000}));
  r.advance(1000);r.log.socket.receive(JSON.stringify({t:'status',secureInput:false,sent:40,dropped:0,bytes:5000}));
  assert.equal(Math.round(r.adapter.stats().display.serverFps),30);
  r.advance(1000);r.log.socket.receive(JSON.stringify({t:'status',secureInput:true,sent:70,dropped:0,bytes:9000}));
  assert.equal(r.adapter.stats().secureInput,true);assert.ok(r.log.inputMessages.at(-1).includes('secure input'));
  r.advance(1000);r.log.socket.receive(JSON.stringify({t:'status',secureInput:false,sent:100,dropped:0,bytes:9500}));assert.ok(!r.log.inputMessages.at(-1).includes('secure input'));
});

test('stats report open, unstable (no message for a while) and closed transport, plus byte counts',async()=>{
  const r=rig();await r.connect();r.log.socket.receive(frame(true,1));
  let stats=r.adapter.stats();assert.equal(stats.tunnelState,'open');assert.ok(stats.inboundBytes>=18&&stats.outboundBytes>0);
  r.advance(5000);assert.equal(r.adapter.stats().tunnelState,'unstable');
  r.log.socket.readyState=3;assert.equal(r.adapter.stats().tunnelState,'closed');
});

test('disconnect closes the socket, the decoder and every frame, clears the surface, and ignores late events',async()=>{
  const r=rig();const socket=await r.connect();const decoder=r.log.decoders[0],pending=decoder.emit();
  const clip=r.adapter.sendClipboard('x');
  r.adapter.disconnect();
  assert.ok(pending.closed);assert.equal(decoder.state,'closed');assert.deepEqual(r.log.closedSockets,[1000]);assert.deepEqual(r.surface.children,[]);
  await assert.rejects(clip,/CLIPBOARD_UNAVAILABLE/);assert.equal(r.adapter.stats(),null);
  r.log.sent.length=0;socket.receive(JSON.stringify({t:'error',code:'NO_DISPLAY'}));socket.onclose?.();await r.tick();assert.deepEqual(r.log.failures,[]);assert.equal(r.log.sent.length,0);
});

test('fit scales the canvas to the surface and keeps pointer math on the same scale',async()=>{
  const r=rig();await r.connect();const canvas=r.adapter.canvas;
  r.surface.clientWidth=640;r.surface.clientHeight=720;r.adapter.fit('fit');assert.equal(canvas.style.width,'640px');assert.equal(canvas.style.height,'360px');assert.equal(r.adapter.scale,0.5);
  r.adapter.fit('actual');assert.equal(canvas.style.width,'1280px');assert.equal(r.adapter.scale,1);
});
