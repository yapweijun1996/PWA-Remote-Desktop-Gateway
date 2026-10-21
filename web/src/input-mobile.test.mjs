import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
import {RemoteInput} from './input.mjs';
function fixture(){
  class Node extends EventTarget{style={};offsetLeft=0;offsetTop=0;offsetParent=null;offsetWidth=500;offsetHeight=300;scrollLeft=0;scrollTop=0;setAttribute(){}getBoundingClientRect(){return {left:10,top:20};}focus(){document.activeElement=this;this.dispatchEvent(new Event('focus'));}blur(){document.activeElement=null;this.dispatchEvent(new Event('blur'));}}
  globalThis.window=Object.assign(new EventTarget(),{devicePixelRatio:1});globalThis.document=Object.assign(new EventTarget(),{hidden:false,createElement:()=>new Node(),body:new Node(),documentElement:{scrollLeft:0,scrollTop:0}});
  const context=vm.createContext({window,document});vm.runInContext(readFileSync(new URL('../vendor/all.min.js',import.meta.url),'utf8'),context);const G=context.Guacamole;G.Keyboard=class{reset(){}};
  const surface=new Node(),sent=[],keys=[],local=[],timers=new Map();let time=0,id=0;document.activeElement=surface;
  const view={zoomed:false,clientToDisplay:(x,y)=>({x:x-10,y:y-20}),localPoint:(x,y)=>({x:x-10,y:y-20}),snapshot:()=>({scale:0.5}),pinch:a=>local.push(['pinch',a]),pan:(...a)=>local.push(['pan',...a]),follow:(...a)=>local.push(['follow',...a])};
  const input=new RemoteInput({surface,client:{getDisplay:()=>({getScale:()=>0.5,getWidth:()=>1000,getHeight:()=>600}),sendMouseState:(s,scaled)=>sent.push({...s,scaled}),sendKeyEvent:(down,key)=>keys.push([key,down])},Guacamole:G,view,profile:'mac-native',keysyms:{ControlLeft:65507,CommandLeft:65511,OptionLeft:65513},onPause(){},onFailure:reason=>assert.fail(reason),clock:()=>time,schedule:(fn,delay)=>{timers.set(++id,{fn,at:time+delay});return id;},cancel:id=>timers.delete(id)});
  input.start('control');input.resume();
  const touch=(type,points)=>{const event=new Event(type,{cancelable:true});Object.assign(event,{touches:points,changedTouches:points});surface.dispatchEvent(event);return event;};
  const advance=ms=>{time+=ms;for(const [id,timer] of [...timers])if(timer.at<=time){timers.delete(id);timer.fn();}};
  const point=(id,x,y)=>({identifier:id,clientX:x,clientY:y});return {input,surface,sent,keys,local,timers,touch,advance,point,Node,view};
}
test('official touch engines produce tap buttons, while tentative/pinch fingers send no remote state or ghost click',()=>{
  const f=fixture(),p=f.point;f.touch('touchstart',[p(1,100,100)]);assert.deepEqual(f.sent,[]);
  f.advance(20);f.touch('touchstart',[p(1,100,100),p(2,200,100)]);f.advance(20);f.touch('touchmove',[p(1,70,100),p(2,230,100)]);
  f.touch('touchend',[p(1,70,100)]);f.touch('touchend',[]);assert.deepEqual(f.sent,[]);assert.equal(f.local[0][0],'pinch');assert.equal(f.timers.size,0);
  const ghost=Object.assign(new Event('mousedown',{cancelable:true}),{clientX:100,clientY:100});f.surface.dispatchEvent(ghost);assert.equal(ghost.defaultPrevented,true);assert.deepEqual(f.sent,[]);
  f.advance(1000);f.touch('touchstart',[p(1,100,100)]);f.advance(80);f.touch('touchend',[]);assert.deepEqual(f.sent.map(s=>s.left),[true,false]);assert.ok(f.sent.every(s=>s.scaled));f.input.dispose();
});
test('two-finger tap right-clicks once and fit scroll uses the bounded existing wheel without trailing click',()=>{
  const f=fixture(),p=f.point;f.touch('touchstart',[p(1,100,100),p(2,200,100)]);f.advance(60);f.touch('touchend',[p(1,100,100)]);f.touch('touchend',[]);assert.deepEqual(f.sent.map(s=>s.right),[true,false]);
  f.sent.length=0;f.touch('touchstart',[p(1,100,100),p(2,200,100)]);f.advance(40);f.touch('touchmove',[p(1,100,145),p(2,200,145)]);f.touch('touchend',[]);
  assert.equal(f.sent.filter(s=>s.up).length,3);assert.ok(f.sent.every(s=>!s.left&&!s.right));f.input.dispose();
});
test('touch mode maps absolute pixels once; hold-drag releases on cancel, blur and profile change',()=>{
  for(const end of ['cancel','blur','profile']){
    const f=fixture(),p=f.point;f.input.setTouchMode('touch');f.touch('touchstart',[p(1,100,100)]);assert.deepEqual(f.sent,[]);
    f.advance(450);assert.equal(f.sent.at(-1).left,true);assert.deepEqual([f.sent.at(-1).x,f.sent.at(-1).y],[90,80]);
    f.touch('touchmove',[p(1,120,110)]);assert.deepEqual([f.sent.at(-1).x,f.sent.at(-1).y],[110,90]);
    if(end==='cancel')f.touch('touchcancel',[]);else if(end==='blur')f.surface.blur();else f.input.setProfile('windows-native');
    assert.equal(f.sent.at(-1).left,false);const count=f.sent.length;f.advance(1000);assert.equal(f.sent.length,count);assert.equal(f.timers.size,0);f.input.dispose();
  }
});
test('zoomed pan is local; release sends nothing unless remote buttons are actually held',()=>{
  const f=fixture(),p=f.point;f.view.zoomed=true;f.touch('touchstart',[p(1,100,100),p(2,200,100)]);f.touch('touchmove',[p(1,110,120),p(2,210,120)]);f.touch('touchend',[]);
  assert.deepEqual(f.sent,[]);assert.equal(f.local[0][0],'pan');f.input.release();assert.deepEqual(f.sent,[]);f.input.dispose();
});
test('registered keyboard owns text only while focused and consumes latches once without Unicode partial dispatch',()=>{
  const f=fixture(),textarea=new f.Node();f.input.setKeyboardSurface(textarea);textarea.focus();assert.equal(f.input.active(),true);
  f.input.toggle('ControlLeft');assert.equal(f.input.text('ab'),true);assert.deepEqual(f.keys,[[65507,1],[97,1],[97,0],[65507,0],[98,1],[98,0]]);assert.equal(f.input.latches.size,0);
  const before=f.keys.length;assert.equal(f.input.text('a中'),false);assert.equal(f.keys.length,before);assert.equal(f.input.textKey('keysym:65288'),true);
  textarea.blur();assert.equal(f.input.text('c'),false);textarea.focus();f.input.toggle('CommandLeft');f.input.setKeyboardSurface(null);assert.equal(f.keys.at(-1)[1],0);assert.equal(f.input.active(),false);assert.equal(f.input.text('d'),false);f.input.dispose();
});
test('view-only and canceled tentative touches never acquire remote input or replay later',()=>{
  const f=fixture(),p=f.point;f.input.start('view');f.touch('touchstart',[p(1,100,100)]);f.touch('touchend',[]);assert.deepEqual(f.sent,[]);assert.equal(f.input.active(),false);
  f.input.start('control');f.touch('touchstart',[p(1,100,100)]);f.touch('touchcancel',[]);f.advance(1000);assert.deepEqual(f.sent,[]);f.input.dispose();
});

test('view-only pinch remains local and pointer scale updates do not send or move the native cursor',()=>{
  const f=fixture(),p=f.point;f.input.start('view');f.touch('touchstart',[p(1,100,100),p(2,200,100)]);f.touch('touchmove',[p(1,80,100),p(2,220,100)]);f.touch('touchend',[]);
  assert.deepEqual(f.sent,[]);assert.equal(f.local[0][0],'pinch');
  f.input.pointer.x=100;f.input.pointer.y=80;f.input.scalePointer(1,0.5);assert.deepEqual([f.input.pointer.x,f.input.pointer.y],[200,160]);assert.deepEqual(f.sent,[]);f.input.dispose();
});

test('scaled pointer clamps retain the last native pixel rather than subtracting a whole scaled pixel',()=>{
  const f=fixture();f.input.sendPointer({x:9999,y:9999,left:false,middle:false,right:false,up:false,down:false});
  assert.deepEqual([f.sent[0].x/0.5,f.sent[0].y/0.5],[999,599]);f.input.dispose();
});

test('fit scroll can promote to local pinch and immediately drops the unsent bounded wheel remainder',()=>{
  const f=fixture(),p=f.point;f.touch('touchstart',[p(1,100,100),p(2,200,100)]);f.touch('touchmove',[p(1,100,1000),p(2,200,1000)]);
  assert.ok(f.sent.length>0);assert.equal(f.timers.size,1);const alreadySent=f.sent.length;
  f.touch('touchmove',[p(1,80,1000),p(2,220,1000)]);assert.equal(f.local.at(-1)[0],'pinch');assert.equal(f.timers.size,0);assert.equal(f.sent.length,alreadySent);
  f.touch('touchend',[]);f.advance(1000);assert.equal(f.sent.length,alreadySent);f.input.dispose();
});
