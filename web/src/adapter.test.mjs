import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {DesktopAdapter,useFastImageStreams} from './adapter.mjs';

/** Actual pinned Client/WebSocketTunnel, minimal DOM and socket boundary doubles. */
function fixture(){
  class Node extends EventTarget {clientWidth=640;clientHeight=480;setAttribute(){}append(){}replaceChildren(){}focus(){}blur(){}}
  const sockets=[],sent=[],timers=new Set();let timerId=0,closedSends=0,disconnects=0;
  const window=Object.assign(new EventTarget(),{location:{protocol:'https:',host:'fixture.test'},setTimeout:()=>{timers.add(++timerId);return timerId;},clearTimeout:id=>timers.delete(id)});
  class Socket {
    readyState=0;
    constructor(){sockets.push(this);}
    send(data){if(this.readyState!==1){closedSends++;throw new Error('SEND_ON_CLOSED_SOCKET');}sent.push(data);}
    close(){this.readyState=3;disconnects++;}
  }
  const context=vm.createContext({window,WebSocket:Socket,Blob});window.atob=atob;
  vm.runInContext(readFileSync(new URL('../vendor/all.min.js',import.meta.url),'utf8'),context);
  const G=context.Guacamole;
  G.Display=class {getElement(){return new Node();}getWidth(){return 640;}getHeight(){return 480;}getScale(){return 1;}scale(){}moveCursor(){}};
  G.Keyboard=class {reset(){}};
  G.Mouse=class {onEach(){}};G.Mouse.Touchpad=G.Mouse;G.Mouse.State=class {constructor(x,y,left,middle,right,up,down){Object.assign(this,{x,y,left,middle,right,up,down});}};
  globalThis.Guacamole=G;globalThis.window=window;globalThis.location=window.location;
  globalThis.document=Object.assign(new EventTarget(),{hidden:false,createElement:()=>new Node()});
  let failures=0,lastReason=null;
  const adapter=new DesktopAdapter({surface:new Node(),profile:'mac-native',keysyms:{ControlLeft:0xffe3},onState:()=>{},onFailure:reason=>{failures++;lastReason=reason;adapter.disconnect();},onInput:()=>{}});
  adapter.connect('F'.repeat(43),'control');
  const socket=sockets[0];socket.readyState=1;socket.onopen({});
  socket.onmessage({data:G.Parser.toInstruction(['','fixture-uuid'])});
  return {adapter,socket,sent,timers,reason:()=>lastReason,counts:()=>({closedSends,disconnects,failures})};
}

test('Pinned tunnel error-before-CLOSED does not send input release or disconnect on a closed socket',async()=>{
  const f=fixture();assert.equal(f.adapter.display.statisticWindow,5000);
  f.adapter.input.start('control');f.adapter.input.toggle('ControlLeft');
  f.socket.readyState=3;f.socket.onclose({code:1006});
  assert.equal(f.counts().failures,0);await Promise.resolve();
  assert.deepEqual(f.counts(),{closedSends:0,disconnects:1,failures:1});
  assert.equal(f.timers.size,0);assert.equal(f.adapter.stats(),null);
  f.adapter.disconnect();assert.equal(f.counts().disconnects,1);
});

test('Only an exact bounded target close reason is attributed upstream; arbitrary close text stays generic',async()=>{
  for(const [message,expected] of [['TARGET_UNAVAILABLE','TARGET_UNAVAILABLE'],['untrusted arbitrary close text','TRANSPORT_ERROR']]){
    const f=fixture();f.socket.readyState=3;f.socket.onclose({code:1008,reason:message});await Promise.resolve();
    assert.equal(f.reason(),expected);assert.equal(f.counts().closedSends,0);assert.equal(f.timers.size,0);
  }
});

test('Manual close sends official disconnect once and ignores a queued failure after teardown',async()=>{
  const f=fixture();f.adapter.tunnel.onerror({code:512});f.adapter.disconnect();await Promise.resolve();
  assert.deepEqual(f.counts(),{closedSends:0,disconnects:1,failures:0});
  assert.equal(f.sent.filter(data=>data.includes('disconnect')).length,1);
  assert.equal(f.timers.size,0);
});

test('Image streams never reach ImageDecoder: native base64 draws one Blob, otherwise a data URI',async()=>{
  const f=fixture(),G=globalThis.Guacamole;
  globalThis.ImageDecoder=class{constructor(){throw new Error('IMAGE_DECODER_USED');}};
  try {
    // The adapter installs the fast path on its own display.
    assert.equal(typeof f.adapter.display.drawStream,'function');
    for(const native of [true,false]) {
      const drawn=[],display={drawBlob:(...a)=>drawn.push(['blob',...a]),draw:(...a)=>drawn.push(['uri',...a])};
      useFastImageStreams(display,G,native);
      const stream=new G.InputStream({sendAck(){}},7);
      display.drawStream('layer',3,4,stream,'image/png');
      stream.onblob(btoa('ABC'));stream.onblob(btoa('DEF'));assert.equal(drawn.length,0,'nothing is drawn before the stream ends');
      stream.onend();assert.equal(drawn.length,1);
      if(native){assert.deepEqual(drawn[0].slice(0,4),['blob','layer',3,4]);assert.equal(drawn[0][4].type,'image/png');assert.equal(await drawn[0][4].text(),'ABCDEF');}
      else assert.deepEqual(drawn[0],['uri','layer',3,4,'data:image/png;base64,QUJDREVG']);
    }
  } finally {delete globalThis.ImageDecoder;}
});
test('An empty clipboard send is refused locally so it cannot clear the remote clipboard',()=>{
  const f=fixture();f.adapter.clipboard=true;f.adapter.input.start('control');
  assert.throws(()=>f.adapter.sendClipboard(''),{message:'CLIPBOARD_EMPTY'});
  assert.throws(()=>f.adapter.sendClipboard('x'.repeat(16385)),{message:'CLIPBOARD_TOO_LARGE'});
});
