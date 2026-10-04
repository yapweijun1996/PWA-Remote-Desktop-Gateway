import test from 'node:test';import assert from 'node:assert/strict';
import {logicalKey,encodeKey,RemoteInput,COMMAND_KEY_CANDIDATES,SCROLL_MAX_CLICKS,SCROLL_WINDOW_MS,SCROLL_SPEEDS,DEFAULT_SCROLL_SPEED,WHEEL_BURST,WHEEL_BACKLOG_CLICKS,WHEEL_CLICKS_PER_SECOND} from './input.mjs';
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
  let time=0,timerId=0;const sent=[],timers=new Map();
  const input=new RemoteInput({surface,client:{getDisplay:()=>({getScale:()=>1,getWidth:()=>1000,getHeight:()=>1000}),sendMouseState:state=>sent.push({...state}),sendKeyEvent(){}},
    Guacamole:{Keyboard,Mouse},profile:'mac-native',keysyms,onPause:()=>{},onFailure:error=>{throw new Error(error);},clock:()=>time,
    schedule:fn=>{timers.set(++timerId,fn);return timerId;},cancel:id=>timers.delete(id)});
  input.start('control');input.enabled=true;
  const defaultSpeed=input.pixelsPerClick;input.setScrollSpeed('normal');   // most cases below assume 30 px per click
  const wheelEvent=(deltaY,deltaMode=0,type='wheel')=>Object.assign(new Event(type,{cancelable:true}),{deltaY,deltaMode,clientX:7,clientY:9});
  const wheel=(deltaY,deltaMode)=>{const event=wheelEvent(deltaY,deltaMode);surface.dispatchEvent(event);return event;};
  const clicks=()=>sent.filter(state=>state.up||state.down);
  const runTimers=()=>{for(const [id,fn] of [...timers]){timers.delete(id);fn();}};
  return {input,surface,sent,attributes,wheel,wheelEvent,clicks,runTimers,timers,defaultSpeed,tick:ms=>{time+=ms;},State};
}
test('Touch scroll clicks are bounded per window in press/release pairs and resume in the next window',()=>{
  const f=scrollFixture(),touch=direction=>{f.input.sendPointer(new f.State(5,5,false,false,false,direction==='up',direction==='down'),true);f.input.sendPointer(new f.State(5,5,false,false,false,false,false),true);};
  for(let n=0;n<25;n++)touch(n%2?'up':'down');
  assert.equal(f.sent.length,SCROLL_MAX_CLICKS*2);
  f.sent.forEach((state,index)=>assert.equal(Boolean(state.up||state.down),index%2===0,'every press is followed by its release'));
  f.input.sendPointer(new f.State(9,9,false,false,false,false,false),true);assert.equal(f.sent.length,SCROLL_MAX_CLICKS*2+1,'pointer moves are never throttled');
  f.tick(SCROLL_WINDOW_MS-1);touch('up');assert.equal(f.sent.length,SCROLL_MAX_CLICKS*2+1);
  f.tick(1);touch('up');assert.equal(f.sent.length,SCROLL_MAX_CLICKS*2+3);
});
test('Wheel pixels convert to clicks keeping the remainder, with direction, position and units',()=>{
  const f=scrollFixture();
  let event=f.wheel(100);assert.equal(event.defaultPrevented,true);assert.equal(f.clicks().length,3,'100px at 30px/click, remainder 10 kept');
  f.wheel(100);f.wheel(100);assert.equal(f.clicks().length,10,'300px total = 10 clicks; Guacamole alone would send 5');
  assert.deepEqual([f.sent.at(-2).down,f.sent.at(-2).up,f.sent.at(-1).down,f.sent.at(-1).up],[true,false,false,false],'press then release, scrolling down');
  assert.deepEqual([f.sent.at(-2).x,f.sent.at(-2).y],[0,0],'position falls back to the last pointer when the surface has no geometry');
  const fresh=()=>{f.sent.length=0;f.input.wheelPixels=0;f.tick(1000);};
  fresh();f.wheel(-60);assert.equal(f.clicks().length,2);assert.equal(f.clicks()[0].up,true);
  fresh();f.wheel(3,1);assert.equal(f.clicks().length,1,'3 lines = 54px');
  fresh();f.wheel(1,2);assert.equal(f.clicks().length,9,'1 page = 288px');
  fresh();f.input.setScrollSpeed('fast');f.wheel(100);assert.equal(f.clicks().length,6);
  fresh();f.input.setScrollSpeed('faster');f.wheel(100);assert.equal(f.clicks().length,12);
  fresh();f.input.setScrollSpeed('max');f.wheel(100);assert.equal(f.clicks().length,25);
  fresh();f.input.setScrollSpeed('slow');f.wheel(100);assert.equal(f.clicks().length,1);
  f.input.setScrollSpeed('bogus');fresh();f.wheel(100);assert.equal(f.clicks().length,1,'unknown speed keeps the current one');
});
test('The default speed follows a Mac line click and a sustained flick is paced, not truncated',()=>{
  const f=scrollFixture();assert.equal(DEFAULT_SCROLL_SPEED,'fast');assert.equal(f.defaultSpeed,SCROLL_SPEEDS.fast);
  assert.ok(WHEEL_CLICKS_PER_SECOND*2<1000,'wheel traffic stays under the gateway limit of 1000 messages/s');
  // 1 s of 60 Hz events at 50 px each = 3000 px = 200 clicks at 15 px: all of it is delivered, none dropped
  f.input.setScrollSpeed('fast');let delivered=0;
  for(let n=0;n<60;n++){f.wheel(50);f.tick(1000/60);f.runTimers();}
  for(let n=0;n<400&&f.timers.size;n++){f.tick(4);f.runTimers();}
  assert.equal(f.clicks().length,Math.floor(3000/15),'a 3000 px scroll becomes 200 clicks');
  assert.ok(f.clicks().length<=WHEEL_BACKLOG_CLICKS);
});
test('A huge flick is delayed, not dropped, and the backlog is bounded',()=>{
  const f=scrollFixture();f.wheel(30*500);   // 500 clicks of travel; only 200 may wait
  assert.equal(f.clicks().length,WHEEL_BURST,'burst first');assert.equal(f.timers.size,1,'remainder is scheduled');
  for(let n=0;n<2000&&f.timers.size;n++){f.tick(4);f.runTimers();}
  assert.equal(f.clicks().length,WHEEL_BACKLOG_CLICKS,'backlog drains completely, capped at 200 clicks');
  assert.equal(f.timers.size,0);
  const before=f.sent.length;f.tick(1000);f.runTimers();assert.equal(f.sent.length,before,'nothing is replayed later');
  f.sent.length=0;f.tick(1000);f.wheel(30*100);assert.ok(f.clicks().length>0);f.input.pause();assert.equal(f.timers.size,0,'pause cancels the pending backlog');
  const after=f.sent.length;f.tick(1000);f.runTimers();assert.equal(f.sent.length,after,'a paused surface never replays scroll');
});
test('Wheel and touch reach Guacamole only from the active controller; otherwise the browser keeps its local scroll',()=>{
  const f=scrollFixture();
  const fires=(type,cancelable=true)=>{const event=f.wheelEvent(100,0,type);let stopped=false;event.stopPropagation=()=>{stopped=true;};f.surface.dispatchEvent(event);return {stopped,prevented:event.defaultPrevented};};
  for(const type of ['wheel','mousewheel','DOMMouseScroll']){
    assert.deepEqual(fires(type),{stopped:true,prevented:true},type+' active: handled here, Guacamole never sees it');
    f.input.enabled=false;assert.deepEqual(fires(type),{stopped:true,prevented:false},type+' paused: local scroll');f.input.enabled=true;
  }
  f.sent.length=0;f.input.enabled=false;f.wheel(500);f.input.enabled=true;f.tick(1000);f.runTimers();assert.equal(f.sent.length,0,'paused wheel sends nothing');
  document.activeElement=null;assert.equal(fires('wheel').prevented,false,'unfocused');document.activeElement=f.surface;
  const touch=type=>{const event=new Event(type,{cancelable:true});let stopped=false;event.stopPropagation=()=>{stopped=true;};f.surface.dispatchEvent(event);return stopped;};
  for(const type of ['touchstart','touchmove','touchend','touchcancel'])assert.equal(touch(type),false,type+' control');
  f.input.start('view');f.input.enabled=true;assert.equal(f.attributes['data-mode'],'view');
  for(const type of ['touchstart','touchmove','touchend','touchcancel'])assert.equal(touch(type),true,type+' view-only');
  assert.deepEqual(fires('wheel'),{stopped:true,prevented:false},'view-only wheel scrolls locally');
});

test('The Command key code can be trialed per page: chords use it, held keys release with the old code, server value restores',()=>{
  const f=fixture('windows-native');
  f.input.chord('paste');assert.deepEqual(f.transitions,[[0xffe7,1],[118,1],[118,0],[0xffe7,0]],'server setting by default');
  for(const [name,[left]] of Object.entries(COMMAND_KEY_CANDIDATES).filter(([,pair])=>pair)){
    f.transitions.length=0;f.input.setCommandKey(name);f.input.enabled=true;f.input.chord('paste');
    assert.deepEqual(f.transitions,[[left,1],[118,1],[118,0],[left,0]],name);
  }
  f.transitions.length=0;f.input.toggle('CommandLeft');   // latch held with the last candidate (Meta)
  f.input.setCommandKey('super');assert.deepEqual(f.transitions,[[0xffe7,1],[0xffe7,0]],'a held Command is released with the code it was pressed with');
  f.transitions.length=0;f.input.setCommandKey('bogus');f.input.setCommandKey('server');f.input.enabled=true;f.input.chord('paste');
  assert.deepEqual(f.transitions,[[0xffe7,1],[118,1],[118,0],[0xffe7,0]],'server setting restored; unknown names ignored');
});
