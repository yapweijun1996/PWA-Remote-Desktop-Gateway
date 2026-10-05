import test from 'node:test';import assert from 'node:assert/strict';
import {AgentInputSink,MIN_WHEEL_INTERVAL_MS,MIN_MOVE_INTERVAL_MS,MAX_BUFFERED_BYTES,TOUCH_CLICK_PIXELS} from './agent-input.mjs';

function rig({open=true,buffered=0,scale=1,width=1000,height=800}={}) {
  const sent=[],frames=new Map();let time=0,id=0,isOpen=open,bufferedAmount=buffered,factor=scale;
  const sink=new AgentInputSink({send:text=>sent.push(JSON.parse(text)),isOpen:()=>isOpen,bufferedAmount:()=>bufferedAmount,video:()=>({width,height,scale:factor}),
    frame:fn=>{frames.set(++id,fn);return id;},cancelFrame:i=>frames.delete(i),now:()=>time});
  const State=class{constructor(x,y,left=false,middle=false,right=false,up=false,down=false){Object.assign(this,{x,y,left,middle,right,up,down});}};
  return {sink,sent,State,
    advance:ms=>{time+=ms;},
    frame:ms=>{time+=ms;for(const [key,fn] of [...frames]){frames.delete(key);fn();}},
    pending:()=>frames.size,
    set open(value){isOpen=value;},set buffered(value){bufferedAmount=value;},set scale(value){factor=value;}};
}
const kinds=sent=>sent.map(m=>m.t).join('');

test('a 1000 Hz wheel flood becomes at most one wheel message per interval and the travel adds up',()=>{
  const r=rig();let total=0;
  for(let ms=0;ms<1000;ms++){r.sink.wheel(10,10,3);total+=3;r.advance(1);if(ms%16===15)r.frame(0);}
  r.frame(MIN_WHEEL_INTERVAL_MS);r.frame(MIN_WHEEL_INTERVAL_MS);
  const wheels=r.sent.filter(m=>m.t==='w');
  assert.ok(wheels.length<=Math.ceil(1000/MIN_WHEEL_INTERVAL_MS)+2,`${wheels.length} wheel messages in 1 s`);
  assert.ok(wheels.length<120,'below the gateway limit of 120 per second');
  assert.ok(Math.abs(wheels.reduce((sum,m)=>sum+m.dy,0)-total)<=1,'no travel is lost to coalescing');
  assert.ok(wheels.every(m=>m.dy!==0&&Math.abs(m.dy)<=4000));
});

test('a display refresh rate above the wheel interval still cannot exceed it',()=>{
  const r=rig();
  for(let n=0;n<240;n++){r.sink.wheel(1,1,5);r.frame(1000/240);}   // 240 Hz frames, wheel event every frame
  assert.ok(r.sent.filter(m=>m.t==='w').length<=Math.ceil(1000/MIN_WHEEL_INTERVAL_MS)+1);
});

test('wheel travel is clamped to one message and the bounded remainder is not replayed after a stall',()=>{
  const r=rig();r.sink.wheel(1,1,100000);r.frame(MIN_WHEEL_INTERVAL_MS);
  assert.deepEqual(r.sent.map(m=>m.dy),[4000]);r.frame(100);r.frame(100);assert.equal(r.sent.length,1,'nothing left over to replay');
});

test('a slow link drops pointer moves and wheel travel instead of queueing them; keys and buttons still go out',()=>{
  const r=rig({buffered:MAX_BUFFERED_BYTES+1});
  r.sink.sendMouseState(new r.State(10,10));r.sink.wheel(10,10,60);r.frame(MIN_WHEEL_INTERVAL_MS);
  assert.equal(r.sent.length,0);
  r.sink.sendKeyEvent(1,99);r.sink.sendKeyEvent(0,99);r.sink.sendMouseState(new r.State(10,10,true));r.sink.sendMouseState(new r.State(10,10,false));
  assert.equal(kinds(r.sent),'kkmm');
  r.buffered=0;r.frame(MIN_WHEEL_INTERVAL_MS);r.frame(MIN_WHEEL_INTERVAL_MS);assert.equal(kinds(r.sent),'kkmm','what was dropped is never replayed later');
});

test('pointer moves are coalesced to the newest position, one per frame, and a button change is never coalesced away',()=>{
  const r=rig();
  for(let n=0;n<50;n++)r.sink.sendMouseState(new r.State(n,n));
  assert.equal(r.sent.length,0,'moves wait for the frame');
  r.frame(16);assert.deepEqual(r.sent,[{t:'m',x:49,y:49,b:0}]);
  r.sink.sendMouseState(new r.State(60,70,true));
  assert.deepEqual(r.sent.at(-1),{t:'m',x:60,y:70,b:1},'press goes out immediately with the latest position');
  r.sink.sendMouseState(new r.State(61,71,true));r.sink.sendMouseState(new r.State(62,72,true,false,false));r.frame(16);
  assert.deepEqual(r.sent.at(-1),{t:'m',x:62,y:72,b:1},'drag position follows with the button still held');
  r.sink.sendMouseState(new r.State(62,72,false));assert.deepEqual(r.sent.at(-1),{t:'m',x:62,y:72,b:0},'release is immediate');
  let t=0;for(let n=0;n<1000;n++){r.sink.sendMouseState(new r.State(n%900,5));if(n%16===0){r.frame(MIN_MOVE_INTERVAL_MS);t++;}}
  assert.ok(r.sent.filter(m=>m.t==='m').length<=t+4,'a 1000 Hz mouse produces at most one move per frame');
});

test('button chords map to the 1/2/4 mask and never to the wheel bits',()=>{
  const r=rig();
  r.sink.sendMouseState(new r.State(1,1,true,true,true));assert.equal(r.sent.at(-1).b,7);
  r.sink.sendMouseState(new r.State(1,1,false,false,true));assert.equal(r.sent.at(-1).b,4);
  r.sink.sendMouseState(new r.State(1,1,false,false,false,true,false));   // wheel-up press state is not a button
  assert.ok(r.sent.every(m=>m.t!=='m'||m.b<=7));
});

test('touchpad scroll presses become pixel scrolling on the press edge only',()=>{
  const r=rig();
  r.sink.sendMouseState(new r.State(100,100,false,false,false,false,true));
  assert.deepEqual(r.sent.filter(m=>m.t==='w'),[{t:'w',x:100,y:100,dy:TOUCH_CLICK_PIXELS}],'down press scrolls content up');
  r.sink.sendMouseState(new r.State(100,100));   // release: ignored
  r.advance(MIN_WHEEL_INTERVAL_MS);r.sink.sendMouseState(new r.State(100,100,false,false,false,true,false));
  assert.deepEqual(r.sent.filter(m=>m.t==='w').at(-1),{t:'w',x:100,y:100,dy:-TOUCH_CLICK_PIXELS});
  assert.equal(r.sent.filter(m=>m.t==='w').length,2);
});

test('coordinates are divided by the display scale, rounded and kept inside the video',()=>{
  const r=rig({scale:0.5,width:1000,height:800});
  r.sink.sendMouseState(new r.State(100,200,true));assert.deepEqual(r.sent.at(-1),{t:'m',x:200,y:400,b:1});
  r.sink.sendMouseState(new r.State(9999,9999,false));assert.deepEqual(r.sent.at(-1),{t:'m',x:999,y:799,b:0});
  r.sink.sendMouseState(new r.State(-30,-1,true));assert.deepEqual(r.sent.at(-1),{t:'m',x:0,y:0,b:1});
  r.scale=0;r.sink.sendMouseState(new r.State(10,10,false));assert.deepEqual(r.sent.at(-1),{t:'m',x:10,y:10,b:0},'an unlaid-out canvas (scale 0) does not divide by zero');
  assert.deepEqual(Object.keys(r.sink.getDisplay()).sort(),['getHeight','getScale','getWidth']);
});

test('nothing is queued or replayed: a closed socket drops input, and releasing discards what was pending',()=>{
  const r=rig({open:false});
  r.sink.sendKeyEvent(1,99);r.sink.sendMouseState(new r.State(1,1,true));r.sink.wheel(1,1,50);r.frame(100);assert.equal(r.sent.length,0);
  r.open=true;r.frame(100);r.frame(100);assert.equal(r.sent.length,0,'opening the socket later does not flush anything');
  r.sink.sendMouseState(new r.State(5,5));r.sink.wheel(5,5,80);r.sink.releaseAll();r.frame(100);r.frame(100);
  assert.deepEqual(r.sent,[{t:'release'}],'pending move and wheel are discarded by release');
  r.sink.sendMouseState(new r.State(6,6,true));assert.equal(r.sent.at(-1).b,1,'the press edge works again after a release');
});

test('dispose cancels the frame callback and ignores later input',()=>{
  const r=rig();r.sink.sendMouseState(new r.State(1,1));assert.equal(r.pending(),1);
  r.sink.dispose();assert.equal(r.pending(),0);r.sink.sendKeyEvent(1,99);r.sink.wheel(1,1,5);r.frame(100);assert.equal(r.sent.length,0);
});
