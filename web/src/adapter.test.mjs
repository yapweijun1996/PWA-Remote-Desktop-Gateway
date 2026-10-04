import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {DesktopAdapter} from './adapter.mjs';

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
  const context=vm.createContext({window,WebSocket:Socket});
  vm.runInContext(readFileSync(new URL('../vendor/all.min.js',import.meta.url),'utf8'),context);
  const G=context.Guacamole;
  G.Display=class {getElement(){return new Node();}getWidth(){return 640;}getHeight(){return 480;}getScale(){return 1;}scale(){}moveCursor(){}};
  G.Keyboard=class {reset(){}};
  G.Mouse=class {onEach(){}};G.Mouse.Touchpad=G.Mouse;G.Mouse.State=class {constructor(x,y,left,middle,right,up,down){Object.assign(this,{x,y,left,middle,right,up,down});}};
  globalThis.Guacamole=G;globalThis.window=window;globalThis.location=window.location;
  globalThis.document=Object.assign(new EventTarget(),{hidden:false,createElement:()=>new Node()});
  let failures=0;
  const adapter=new DesktopAdapter({surface:new Node(),profile:'mac-native',keysyms:{ControlLeft:0xffe3},onState:()=>{},onFailure:()=>{failures++;adapter.disconnect();},onInput:()=>{}});
  adapter.connect('F'.repeat(43),'control');
  const socket=sockets[0];socket.readyState=1;socket.onopen({});
  socket.onmessage({data:G.Parser.toInstruction(['','fixture-uuid'])});
  return {adapter,socket,sent,timers,counts:()=>({closedSends,disconnects,failures})};
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

test('Manual close sends official disconnect once and ignores a queued failure after teardown',async()=>{
  const f=fixture();f.adapter.tunnel.onerror({code:512});f.adapter.disconnect();await Promise.resolve();
  assert.deepEqual(f.counts(),{closedSends:0,disconnects:1,failures:0});
  assert.equal(f.sent.filter(data=>data.includes('disconnect')).length,1);
  assert.equal(f.timers.size,0);
});
