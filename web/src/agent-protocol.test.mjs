import test from 'node:test';import assert from 'node:assert/strict';
import {AGENT_SUBPROTOCOL,FAILURE_CODES,LIMITS,failureCode,keyMessage,moveMessage,wheelMessage,rateMessage,clipboardMessage,typeMessage,parseVideoFrame,avccBytes,KEYFRAME_MESSAGE,RELEASE_MESSAGE} from './agent-protocol.mjs';
import {TRANSLATIONS} from './i18n.mjs';

test('messages have exactly the shapes the gateway accepts (the literals AgentPolicyTest feeds the relay)',()=>{
  assert.equal(AGENT_SUBPROTOCOL,'rdg-agent.v1');
  assert.equal(keyMessage(99,true),'{"t":"k","s":99,"d":true}');
  assert.equal(keyMessage(0xffe7,0),'{"t":"k","s":65511,"d":false}');
  assert.equal(moveMessage(10,20,1),'{"t":"m","x":10,"y":20,"b":1}');
  assert.equal(wheelMessage(5,6,-120),'{"t":"w","x":5,"y":6,"dy":-120}');
  assert.equal(rateMessage(4000),'{"t":"rate","kbps":4000}');
  assert.equal(KEYFRAME_MESSAGE,'{"t":"kf"}');assert.equal(RELEASE_MESSAGE,'{"t":"release"}');
  assert.equal(clipboardMessage('héllo "q" 你好'),'{"t":"clip","text":"héllo \\"q\\" 你好"}');
  assert.equal(typeMessage('你好'),'{"t":"type","text":"你好"}');
});

test('values are rounded and clamped into the protocol ranges; never a wheel bit and never a zero scroll',()=>{
  assert.equal(moveMessage(-5,99999,31),'{"t":"m","x":0,"y":32767,"b":7}','buttons 8 and 16 (agent wheel clicks) are never produced');
  assert.equal(moveMessage(1.6,2.4,0),'{"t":"m","x":2,"y":2,"b":0}');
  assert.equal(wheelMessage(0,0,99999),'{"t":"w","x":0,"y":0,"dy":4000}');assert.equal(wheelMessage(0,0,-99999),'{"t":"w","x":0,"y":0,"dy":-4000}');
  assert.equal(wheelMessage(0,0,0),null);assert.equal(wheelMessage(0,0,0.4),null,'rounds to zero');
  assert.equal(rateMessage(1),'{"t":"rate","kbps":500}');assert.equal(rateMessage(1e9),'{"t":"rate","kbps":12000}');
  assert.equal(keyMessage(0,true),'{"t":"k","s":1,"d":true}');assert.equal(keyMessage(0x7fffffff,true),'{"t":"k","s":536870911,"d":true}');
  for(const bad of [NaN,Infinity,undefined])assert.throws(()=>moveMessage(bad,0,0),RangeError);
});

test('clipboard and typed text are refused when the gateway would end the session',()=>{
  assert.equal(JSON.parse(clipboardMessage('a'.repeat(LIMITS.clipboardBytes))).text.length,LIMITS.clipboardBytes);
  for(const bad of ['',null,5,'a\0b','a'.repeat(LIMITS.clipboardBytes+1),'é'.repeat(LIMITS.clipboardBytes/2+1)])assert.throws(()=>clipboardMessage(bad),RangeError,String(bad).slice(0,12));
  assert.throws(()=>typeMessage('b'.repeat(LIMITS.typeBytes+1)),RangeError);
  // 16 KiB of control characters is within the byte cap but escapes to ~6 bytes each: over the raw JSON limit, so refused here.
  assert.throws(()=>clipboardMessage('\u0001'.repeat(LIMITS.clipboardBytes)),RangeError);
  assert.ok(clipboardMessage('\n'.repeat(LIMITS.clipboardBytes)).length<=LIMITS.rawJson,'newlines escape to two characters and still fit');
});

test('video frame header: version 1, key flag 0 or 1, big-endian time and sequence, payload after 14 bytes',()=>{
  const bytes=new Uint8Array(14+3),view=new DataView(bytes.buffer);bytes[0]=1;bytes[1]=1;view.setFloat64(2,1234.5,false);view.setUint32(10,77,false);bytes.set([9,8,7],14);
  const parsed=parseVideoFrame(bytes.buffer);
  assert.deepEqual([parsed.key,parsed.captureMs,parsed.sequence,[...parsed.data]],[true,1234.5,77,[9,8,7]]);
  bytes[1]=0;assert.equal(parseVideoFrame(bytes.buffer).key,false);
  for(const [index,value] of [[0,2],[1,2]]){const copy=bytes.slice();copy[index]=value;assert.equal(parseVideoFrame(copy.buffer),null);}
  assert.equal(parseVideoFrame(new ArrayBuffer(14)),null,'header only is not a frame');assert.equal(parseVideoFrame(new ArrayBuffer(0)),null);
  assert.equal(parseVideoFrame('text'),null);assert.equal(parseVideoFrame(bytes),null,'a typed array is not an ArrayBuffer');
});

test('avcC description decodes only strict base64',()=>{
  assert.deepEqual([...avccBytes('AQID')],[1,2,3]);assert.deepEqual([...avccBytes('AQI=')],[1,2]);
  for(const bad of ['','not base64!','AQID\n',null,5,'AQ ID'])assert.equal(avccBytes(bad),null,String(bad));
});

test('every failure code the adapter can raise has fixed text in both languages and unknown codes degrade safely',()=>{
  for(const code of FAILURE_CODES) {
    assert.ok(Object.hasOwn(TRANSLATIONS.en,'connection.'+code),'en '+code);assert.ok(Object.hasOwn(TRANSLATIONS['zh-CN'],'connection.'+code),'zh '+code);
    assert.equal(failureCode(code),code);
  }
  for(const free of ['free text from a peer','','__proto__',undefined,{}])assert.equal(failureCode(free),'TRANSPORT_ERROR');
  // Every code the Java agent and gateway can send is known to the UI (docs/19).
  for(const code of ['PROTOCOL_UNSUPPORTED','SCREEN_RECORDING_NOT_PERMITTED','NO_DISPLAY','CAPTURE_FAILED','ENCODER_UNAVAILABLE','AGENT_UNAVAILABLE','AGENT_AUTH_FAILED','AGENT_PROTOCOL','TRANSPORT_FAILED','INPUT_DENIED','READ_ONLY','RATE_LIMITED','AGENT_DISABLED'])
    assert.ok(FAILURE_CODES.includes(code),code);
});
