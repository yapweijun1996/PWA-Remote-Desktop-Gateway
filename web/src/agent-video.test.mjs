import test from 'node:test';import assert from 'node:assert/strict';
import {VideoPipeline,MAX_DECODE_QUEUE,KEYFRAME_REQUEST_MS,MAX_DECODER_ERRORS,MAX_HELD_FRAMES} from './agent-video.mjs';

const avcc='AU1EKP/hABRnTQAo2oBQAW5AtQYGhoAAAAMAgA==';
const config={t:'config',codec:'avc1.4D0028',avcc,width:640,height:360};
function packet(key,sequence){const bytes=new Uint8Array(14+4),view=new DataView(bytes.buffer);bytes[0]=1;bytes[1]=key?1:0;view.setFloat64(2,1000+sequence,false);view.setUint32(10,sequence,false);bytes.set([1,2,3,4],14);return bytes.buffer;}

function rig({supported=true,supportedLater=null}={}) {
  const log={decoders:[],chunks:[],keyframes:0,frames:[],drawn:[],failures:[],first:0,timers:new Map()};let time=0,id=0,configChecks=0;
  class FakeFrame{constructor(name){this.name=name;this.closed=false;}close(){this.closed=true;}}
  class FakeDecoder{
    static async isConfigSupported(config){configChecks++;log.checked=config;return {supported:configChecks>1&&supportedLater!==null?supportedLater:supported};}
    constructor(init){this.init=init;this.state='unconfigured';this.decodeQueueSize=0;this.closedByUs=false;log.decoders.push(this);}
    configure(config){this.state='configured';this.config=config;}
    decode(chunk){log.chunks.push({type:chunk.type,timestamp:chunk.timestamp,size:chunk.data.length});}
    close(){if(this.state==='closed')throw new DOMException('closed','InvalidStateError');this.state='closed';this.closedByUs=true;}
    // test helpers
    emit(name='f'){const frame=new FakeFrame(name);log.frames.push(frame);this.init.output(frame);return frame;}
    fail(){this.state='closed';this.init.error(new Error('decode'));}
  }
  class FakeChunk{constructor(init){Object.assign(this,init);}}
  const canvas={width:0,height:0,getContext:()=>({drawImage:frame=>log.drawn.push(frame.name)})};
  const pipeline=new VideoPipeline({canvas,VideoDecoderImpl:FakeDecoder,EncodedVideoChunkImpl:FakeChunk,frame:fn=>{log.timers.set(++id,fn);return id;},cancelFrame:i=>log.timers.delete(i),
    now:()=>time,requestKeyframe:()=>log.keyframes++,onFirstFrame:()=>log.first++,onFailure:code=>log.failures.push(code)});
  return {pipeline,log,canvas,FakeDecoder,advance:ms=>{time+=ms;},runFrame:()=>{for(const [key,fn] of [...log.timers]){log.timers.delete(key);fn();}}};
}

test('config is checked with isConfigSupported before the decoder is configured, and the canvas takes the encoded size',async()=>{
  const r=rig();await r.pipeline.configure(config);
  assert.equal(r.log.checked.codec,'avc1.4D0028');assert.ok(r.log.checked.description instanceof Uint8Array&&r.log.checked.optimizeForLatency===true);
  assert.equal(r.log.decoders.length,1);assert.equal(r.log.decoders[0].state,'configured');assert.deepEqual([r.canvas.width,r.canvas.height],[640,360]);
});

test('an unsupported config fails with a fixed code and never creates a decoder',async()=>{
  const r=rig({supported:false});await r.pipeline.configure(config);
  assert.deepEqual(r.log.failures,['DECODER_UNSUPPORTED']);assert.equal(r.log.decoders.length,0);
  for(const bad of [{...config,avcc:'not base64!'},{...config,width:'640'}]){const q=rig();await q.pipeline.configure(bad);assert.deepEqual(q.log.failures,['VIDEO_DECODE_FAILED']);}
});

test('frames that arrive while support is being checked are decoded afterwards, in order, starting at the keyframe',async()=>{
  const r=rig();const pending=r.pipeline.configure(config);
  r.pipeline.push(packet(true,1));r.pipeline.push(packet(false,2));
  assert.equal(r.log.chunks.length,0,'nothing is decoded before the decoder exists');
  await pending;assert.deepEqual(r.log.chunks.map(c=>[c.type,c.timestamp]),[['key',1],['delta',2]]);assert.equal(r.log.keyframes,0,'no extra keyframe round trip');
  const q=rig();const slow=q.pipeline.configure(config);for(let n=0;n<MAX_HELD_FRAMES+3;n++)q.pipeline.push(packet(n===0,n));await slow;
  assert.ok(q.log.chunks.length<=MAX_HELD_FRAMES,'the holding area is bounded');
});

test('deltas are dropped until a keyframe, and the keyframe request is rate limited',async()=>{
  const r=rig();await r.pipeline.configure(config);
  r.pipeline.push(packet(false,1));r.pipeline.push(packet(false,2));assert.equal(r.log.chunks.length,0);assert.equal(r.log.keyframes,1,'one request, the second inside the interval is suppressed');
  r.advance(KEYFRAME_REQUEST_MS);r.pipeline.push(packet(false,3));assert.equal(r.log.keyframes,2);
  r.pipeline.push(packet(true,4));r.pipeline.push(packet(false,5));assert.deepEqual(r.log.chunks.map(c=>c.type),['key','delta']);
});

test('a growing decode queue drops deltas, asks for a keyframe and resumes at the next keyframe',async()=>{
  const r=rig();await r.pipeline.configure(config);r.pipeline.push(packet(true,1));
  r.log.decoders[0].decodeQueueSize=MAX_DECODE_QUEUE+1;
  r.pipeline.push(packet(false,2));assert.equal(r.log.chunks.length,1);assert.equal(r.log.keyframes,1);
  r.pipeline.push(packet(true,3));assert.equal(r.log.chunks.length,2,'a keyframe is still decoded: it resets the stream');
  r.log.decoders[0].decodeQueueSize=0;r.pipeline.push(packet(false,4));assert.equal(r.log.chunks.length,3);
});

test('a decode error recreates the decoder with the same configuration, waits for a keyframe and asks for one',async()=>{
  const r=rig();await r.pipeline.configure(config);r.pipeline.push(packet(true,1));
  r.log.decoders[0].fail();
  assert.equal(r.log.decoders.length,2);assert.equal(r.log.decoders[1].state,'configured');assert.equal(r.log.decoders[1].config.codec,'avc1.4D0028');assert.equal(r.log.keyframes,1);
  r.pipeline.push(packet(false,2));assert.equal(r.log.chunks.length,1,'deltas are not fed to the fresh decoder');
  r.pipeline.push(packet(true,3));assert.equal(r.log.chunks.at(-1).type,'key');assert.deepEqual(r.log.failures,[]);
});

test('repeated decode errors end the session instead of looping',async()=>{
  const r=rig();await r.pipeline.configure(config);
  for(let n=0;n<=MAX_DECODER_ERRORS;n++)r.log.decoders.at(-1).fail();
  assert.deepEqual(r.log.failures,['VIDEO_DECODE_FAILED']);
  const q=rig();await q.pipeline.configure(config);
  for(let n=0;n<MAX_DECODER_ERRORS;n++){q.log.decoders.at(-1).fail();q.advance(11000);}   // spread out: each is isolated
  assert.deepEqual(q.log.failures,[]);
});

test('a new config mid-stream reconfigures and waits for a keyframe',async()=>{
  const r=rig();await r.pipeline.configure(config);r.pipeline.push(packet(true,1));
  await r.pipeline.configure({...config,width:800,height:450});
  assert.equal(r.log.decoders.length,2);assert.ok(r.log.decoders[0].closedByUs);assert.deepEqual([r.canvas.width,r.canvas.height],[800,450]);
  r.pipeline.push(packet(false,2));assert.equal(r.log.chunks.length,1);r.pipeline.push(packet(true,3));assert.equal(r.log.chunks.length,2);
});

test('only the newest decoded frame is drawn, every frame is closed, and the first drawn frame is reported once',async()=>{
  const r=rig();await r.pipeline.configure(config);const decoder=r.log.decoders[0];
  const a=decoder.emit('a'),b=decoder.emit('b'),c=decoder.emit('c');
  assert.deepEqual([a.closed,b.closed,c.closed],[true,true,false],'superseded frames are closed at once');
  r.runFrame();assert.deepEqual(r.log.drawn,['c']);assert.ok(c.closed);assert.equal(r.log.first,1);
  decoder.emit('d');r.runFrame();assert.equal(r.log.first,1);assert.deepEqual(r.log.drawn,['c','d']);
  assert.ok(r.log.frames.every(frame=>frame.closed||frame===undefined),'no VideoFrame is left open');
});

test('closing closes the pending frame, the decoder and the animation frame; late frames are closed too; closing twice is safe',async()=>{
  const r=rig();await r.pipeline.configure(config);const decoder=r.log.decoders[0];const frame=decoder.emit('x');
  r.pipeline.close();assert.ok(frame.closed);assert.equal(r.log.timers.size,0);assert.equal(decoder.state,'closed');
  const late=new (class{constructor(){this.closed=false;}close(){this.closed=true;}})();decoder.init.output(late);assert.ok(late.closed);
  r.pipeline.push(packet(true,9));assert.equal(r.log.chunks.length,0);r.pipeline.close();
  await r.pipeline.configure(config);assert.equal(r.log.decoders.length,1,'a closed pipeline never reopens');
});

test('a malformed binary message fails the pipeline with a fixed code',async()=>{
  const r=rig();await r.pipeline.configure(config);r.pipeline.push(new ArrayBuffer(5));assert.deepEqual(r.log.failures,['VIDEO_DECODE_FAILED']);
});
