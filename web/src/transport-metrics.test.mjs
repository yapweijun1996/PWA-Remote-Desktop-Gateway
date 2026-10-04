import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {TransportMetrics,instructionBytes,observeTunnelTransfer} from './transport-metrics.mjs';

function fixture(){let time=0;return {metrics:new TransportMetrics({now:()=>time}),at:value=>{time=value;}};}

test('Canonical payload byte count matches pinned official serialization for Unicode and framing boundaries',()=>{
  const context=vm.createContext({});
  vm.runInContext(readFileSync(new URL('../vendor/all.min.js',import.meta.url),'utf8'),context);
  const cases=[['sync',1234567890],['blob','12','a'.repeat(100000)],['clipboard','0','text/plain'],['name','你好，🙂','\uD800','\uDC00'],['argv','','a'.repeat(9),'b'.repeat(10)],['key',0x0101F642,1]];
  for(const elements of cases)assert.equal(instructionBytes(elements),new TextEncoder().encode(context.Guacamole.Parser.toInstruction(elements)).length);
});

test('Rates count both directions, use elapsed time and decay to zero without a timer',()=>{
  const f=fixture();assert.equal(f.metrics.snapshot().inboundBytesPerSecond,null);
  f.at(500);f.metrics.record('inbound',1000);f.metrics.record('outbound',20);
  f.at(1000);const first=f.metrics.snapshot();
  assert.equal(first.inboundBytes,1000);assert.equal(first.outboundBytes,20);
  assert.equal(first.inboundBytesPerSecond,1000);assert.equal(first.outboundBytesPerSecond,20);assert.equal(first.rateWindowMs,1000);
  f.at(10000);const idle=f.metrics.snapshot();
  assert.equal(idle.inboundBytes,1000);assert.equal(idle.inboundBytesPerSecond,0);assert.equal(idle.outboundBytesPerSecond,0);assert.equal(idle.rateWindowMs,5000);
});

test('Long high-frequency streams aggregate numerically with bounded quarter-second buckets',()=>{
  const f=fixture();
  for(let index=1;index<=100000;index++){f.at(index);f.metrics.record('inbound',100);}
  const stats=f.metrics.snapshot();
  assert.equal(stats.inboundBytes,10000000);assert.equal(stats.outboundBytes,0);
  assert.ok(stats.inboundBytesPerSecond>=100000&&stats.inboundBytesPerSecond<=105000);
  assert.deepEqual(Object.keys(stats).sort(),['display','elapsedMs','firstDisplayMs','inboundBytes','inboundBytesPerSecond','outboundBytes','outboundBytesPerSecond','processingLagMs','rateWindowMs'].sort());
});

test('Official display FPS values are nullable, finite, fresh and clear on idle',()=>{
  const f=fixture();f.at(1000);f.metrics.displayStatistics({processingLag:4,clientFps:12,serverFps:13,desktopFps:null,dropRate:Infinity});
  assert.deepEqual(f.metrics.snapshot().display,{clientFps:12,serverFps:13,desktopFps:null,dropRate:null});
  f.at(6001);assert.equal(f.metrics.snapshot().display,null);assert.equal(f.metrics.snapshot().processingLagMs,null);
  f.metrics.displayStatistics({clientFps:0,serverFps:-1,desktopFps:'30'});
  assert.deepEqual(f.metrics.snapshot().display,{clientFps:0,serverFps:null,desktopFps:null,dropRate:null});
});

test('Unknown/invalid render statistics remain unknown and first display records only once',()=>{
  const f=fixture();f.at(75);f.metrics.firstDisplay();f.at(200);f.metrics.firstDisplay();
  assert.equal(f.metrics.snapshot().firstDisplayMs,75);
  for(const processingLag of [undefined,null,-1,Infinity,'30']){f.metrics.displayStatistics({processingLag});assert.equal(f.metrics.snapshot().processingLagMs,null);}
  f.metrics.displayStatistics({processingLag:2.5});assert.equal(f.metrics.snapshot().processingLagMs,2.5);
});

test('Observers preserve instruction order, argument identity, receiver and return value without retaining payload',()=>{
  const f=fixture(),calls=[],parameters=['0','private test text'];
  const tunnel={isConnected:()=>true,oninstruction(opcode,args){calls.push(['receive',this===tunnel,opcode,args===parameters]);return 7;},sendMessage(...args){calls.push(['send',this===tunnel,...args]);return 9;}};
  const stop=observeTunnelTransfer(tunnel,f.metrics);
  assert.equal(tunnel.oninstruction('name',parameters),7);assert.equal(tunnel.sendMessage('key',99,1),9);
  assert.deepEqual(calls,[['receive',true,'name',true],['send',true,'key',99,1]]);
  const stats=f.metrics.snapshot();assert.equal(stats.inboundBytes,instructionBytes(['name',...parameters]));assert.equal(stats.outboundBytes,instructionBytes(['key',99,1]));
  assert.equal(JSON.stringify(stats).includes('private test text'),false);stop();
});

test('Official sync ACK is sent unchanged and only a flushed, sized display marks first display',()=>{
  const f=fixture();let width=0;const messages=[];
  const tunnel={isConnected:()=>true,oninstruction(){},sendMessage(...elements){messages.push(elements);}};
  const stop=observeTunnelTransfer(tunnel,f.metrics,{display:{getWidth:()=>width,getHeight:()=>100}});
  f.at(5);tunnel.sendMessage('sync',123);assert.equal(f.metrics.snapshot().firstDisplayMs,null);
  width=100;f.at(25);tunnel.sendMessage('sync',456);
  assert.equal(f.metrics.snapshot().firstDisplayMs,25);assert.deepEqual(messages,[['sync',123],['sync',456]]);stop();
});

test('Disconnected sends, empty internal tunnel messages and failed sends do not inflate counters',()=>{
  const f=fixture();let connected=false,fail=false;
  const tunnel={isConnected:()=>connected,oninstruction(){},sendMessage(){if(fail)throw new Error('send failed');}};
  const stop=observeTunnelTransfer(tunnel,f.metrics);
  tunnel.sendMessage('key',99,1);connected=true;tunnel.sendMessage();tunnel.sendMessage('','ping',123);tunnel.oninstruction('',['identifier']);
  assert.equal(f.metrics.snapshot().outboundBytes,0);assert.equal(f.metrics.snapshot().inboundBytes,0);
  fail=true;assert.throws(()=>tunnel.sendMessage('sync',123),/send failed/);assert.equal(f.metrics.snapshot().outboundBytes,0);stop();
});

test('Disposal restores owned hooks, clears metrics and ignores late callbacks without overwriting replacement hooks',()=>{
  const f=fixture(),originalReceive=()=>{},originalSend=()=>{};
  const tunnel={isConnected:()=>true,oninstruction:originalReceive,sendMessage:originalSend};
  const stop=observeTunnelTransfer(tunnel,f.metrics),lateReceive=tunnel.oninstruction,lateSend=tunnel.sendMessage;
  f.metrics.record('inbound',100);stop();assert.equal(tunnel.oninstruction,originalReceive);assert.equal(tunnel.sendMessage,originalSend);
  lateReceive('blob',['0','discarded']);lateSend('key',99,1);assert.equal(f.metrics.snapshot().inboundBytes,100);assert.equal(f.metrics.snapshot().outboundBytes,0);
  const stopAgain=observeTunnelTransfer(tunnel,f.metrics),replacement=()=>{};tunnel.oninstruction=replacement;stopAgain();assert.equal(tunnel.oninstruction,replacement);
  f.metrics.dispose();f.metrics.record('inbound',100);f.metrics.firstDisplay();f.metrics.displayStatistics({processingLag:2});assert.equal(f.metrics.snapshot(),null);
});
