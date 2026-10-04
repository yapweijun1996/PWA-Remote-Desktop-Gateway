import test from 'node:test';import assert from 'node:assert/strict';
import {logicalKey,encodeKey,RemoteInput,SCROLL_MAX_CLICKS,SCROLL_WINDOW_MS} from './input.mjs';
const keysyms={CommandLeft:0xffe7,CommandRight:0xffe8,OptionLeft:0xffe9,OptionRight:0xffea,ControlLeft:0xffe3,ControlRight:0xffe4};
function fixture(profile='windows-alt-command',calibrated=keysyms){
  globalThis.window=new EventTarget();const surface=new EventTarget();globalThis.document=new EventTarget();document.hidden=false;document.activeElement=surface;surface.blur=()=>{};surface.focus=()=>{};
  let keyboard,transitions=[],failures=[];
  class Keyboard{constructor(){keyboard=this;}reset(){}}
  class State{constructor(x,y,left,middle,right,up,down){Object.assign(this,{x,y,left,middle,right,up,down});}}
  class Mouse{static State=State;onEach(){}}Mouse.Touchpad=Mouse;
  const input=new RemoteInput({surface,client:{sendKeyEvent:(down,key)=>transitions.push([key,down]),sendMouseState:()=>{}},Guacamole:{Keyboard,Mouse},profile,keysyms:calibrated,onPause:()=>{},onFailure:e=>failures.push(e)});
  input.start('control');input.enabled=true;return{input,keyboard,transitions,failures,surface};
}
test('Calibrated mapping preserves Control and distinguishes Meta/Super logical aliases',()=>{assert.equal(logicalKey(0xffe3),'ControlLeft');assert.equal(encodeKey(logicalKey(0xffe3),keysyms),0xffe3);assert.equal(logicalKey(0xffeb),'CommandLeft');assert.equal(logicalKey(0xffe7),'CommandLeft');assert.throws(()=>encodeKey('Unknown',keysyms));});
test('Only observed physical Left Alt maps to Command; Right Alt remains Option',()=>{const f=fixture();f.input.leftAltPhysical=true;f.keyboard.onkeydown(0xffe9);f.keyboard.onkeyup(0xffe9);f.keyboard.onkeydown(0xffea);f.keyboard.onkeyup(0xffea);assert.deepEqual(f.transitions,[[0xffe7,1],[0xffe7,0],[0xffea,1],[0xffea,0]]);f.input.dispose();});
test('Blur and profile changes release original owned mapping',()=>{const f=fixture();f.input.leftAltPhysical=true;f.keyboard.onkeydown(0xffe9);f.surface.dispatchEvent(new Event('blur'));assert.deepEqual(f.transitions,[[0xffe7,1],[0xffe7,0]]);assert.equal(f.input.enabled,false);f.input.setProfile('windows-native');assert.equal(f.input.keys.profile,'windows-native');f.input.dispose();});
test('Synthetic AltGr modifiers do not leak Control/Command',()=>{const f=fixture();f.input.altGraph=true;f.keyboard.onkeydown(0xffe3);f.keyboard.onkeydown(0xffea);f.keyboard.onkeydown(64);f.keyboard.onkeyup(64);assert.deepEqual(f.transitions,[[64,1],[64,0]]);f.input.dispose();});
test('View mode, unfocused surface and Unicode fallback emit no typing',()=>{const f=fixture();f.input.start('view');f.keyboard.onkeydown(99);f.input.start('control');document.activeElement=null;f.keyboard.onkeydown(99);document.activeElement=f.surface;f.input.enabled=true;f.keyboard.onkeydown(0x01004f60);assert.deepEqual(f.transitions,[]);f.input.dispose();});
test('View-only status survives resize-style pause and focus loss without enabling input',()=>{const f=fixture();const messages=[];f.input.onPause=message=>messages.push(message);f.input.start('view');f.input.pause();f.surface.dispatchEvent(new Event('blur'));assert.deepEqual(messages,['View only','View only','View only']);assert.equal(f.input.enabled,false);assert.deepEqual(f.transitions,[]);f.input.dispose();});
test('Latch releases after the next physical character',()=>{const f=fixture();f.input.toggle('CommandLeft');f.keyboard.onkeydown(99);f.keyboard.onkeyup(99);assert.deepEqual(f.transitions,[[0xffe7,1],[99,1],[99,0],[0xffe7,0]]);assert.equal(f.input.latches.size,0);f.input.dispose();});
test('Physical alias ownership is balanced and a virtual chord waits for a clean boundary',()=>{const f=fixture();f.input.leftAltPhysical=true;f.keyboard.onkeydown(0xffe9);f.keyboard.onkeydown(0xffeb);f.keyboard.onkeyup(0xffe9);assert.deepEqual(f.transitions,[[0xffe7,1]]);f.input.chord('copy');assert.deepEqual(f.failures,[]);f.keyboard.onkeyup(0xffeb);assert.deepEqual(f.transitions,[[0xffe7,1],[0xffe7,0]]);f.input.dispose();});

test('Protocol refcounts preserve two sides when the target collapses keysyms',()=>{const f=fixture('mac-native',{...keysyms,CommandRight:keysyms.CommandLeft});f.keyboard.onkeydown(0xffeb);f.keyboard.onkeydown(0xffec);f.keyboard.onkeyup(0xffeb);assert.deepEqual(f.transitions,[[0xffe7,1]]);f.keyboard.onkeyup(0xffec);assert.deepEqual(f.transitions,[[0xffe7,1],[0xffe7,0]]);f.input.dispose();});
test('Composition pauses ASCII commits and focus cleanup discards raw modifier metadata',()=>{const f=fixture();f.input.leftAltPhysical=true;f.input.altGraph=true;f.surface.dispatchEvent(new Event('compositionstart'));f.keyboard.onkeydown(99);assert.equal(f.input.enabled,false);assert.equal(f.input.leftAltPhysical,false);assert.equal(f.input.altGraph,false);assert.deepEqual(f.transitions,[]);f.input.dispose();});

function scrollFixture(){
  globalThis.window=new EventTarget();globalThis.document=new EventTarget();document.hidden=false;
  const surface=new EventTarget(),attributes={};document.activeElement=surface;surface.blur=()=>{};surface.focus=()=>{};surface.setAttribute=(name,value)=>{attributes[name]=value;};
  class Keyboard{reset(){}}
  class State{constructor(x,y,left,middle,right,up,down){Object.assign(this,{x,y,left,middle,right,up,down});}}
  class Mouse{static State=State;onEach(){}}Mouse.Touchpad=Mouse;
  let time=0;const sent=[];
  const input=new RemoteInput({surface,client:{getDisplay:()=>({getScale:()=>1,getWidth:()=>1000,getHeight:()=>1000}),sendMouseState:state=>sent.push({...state}),sendKeyEvent(){}},
    Guacamole:{Keyboard,Mouse},profile:'mac-native',keysyms,onPause:()=>{},onFailure:error=>{throw new Error(error);},clock:()=>time});
  input.start('control');input.enabled=true;
  const wheel=(direction,x=5)=>{input.sendPointer(new State(x,5,false,false,false,direction==='up',direction==='down'));input.sendPointer(new State(x,5,false,false,false,false,false));};
  return {input,surface,sent,attributes,wheel,tick:ms=>{time+=ms;},State};
}
test('Wheel clicks are bounded per window in press/release pairs and resume in the next window',()=>{
  const f=scrollFixture();
  for(let n=0;n<25;n++)f.wheel(n%2?'up':'down');
  assert.equal(f.sent.length,SCROLL_MAX_CLICKS*2);
  f.sent.forEach((state,index)=>assert.equal(Boolean(state.up||state.down),index%2===0,'every press is followed by its release'));
  f.input.sendPointer(new f.State(9,9,false,false,false,false,false));assert.equal(f.sent.length,SCROLL_MAX_CLICKS*2+1,'pointer moves are never throttled');
  f.tick(SCROLL_WINDOW_MS-1);f.wheel('up');assert.equal(f.sent.length,SCROLL_MAX_CLICKS*2+1);
  f.tick(1);f.wheel('up');assert.equal(f.sent.length,SCROLL_MAX_CLICKS*2+3);assert.equal(f.sent.at(-2).up,true);assert.equal(f.sent.at(-1).up,false);
});
test('Wheel and touch reach Guacamole only from the active controller; otherwise the browser keeps its local scroll',()=>{
  const f=scrollFixture();
  const stops=(type,cancelable=true)=>{const event=new Event(type,{cancelable});let stopped=false;event.stopPropagation=()=>{stopped=true;};f.surface.dispatchEvent(event);return stopped;};
  for(const type of ['wheel','mousewheel','DOMMouseScroll']){assert.equal(stops(type),false,type+' active');f.input.enabled=false;assert.equal(stops(type),true,type+' paused');f.input.enabled=true;}
  document.activeElement=null;assert.equal(stops('wheel'),true,'unfocused');document.activeElement=f.surface;
  for(const type of ['touchstart','touchmove','touchend','touchcancel'])assert.equal(stops(type),false,type+' control');
  f.input.start('view');f.input.enabled=true;assert.equal(f.attributes['data-mode'],'view');
  for(const type of ['touchstart','touchmove','touchend','touchcancel'])assert.equal(stops(type),true,type+' view-only');
  assert.equal(stops('wheel'),true,'view-only wheel');
});
