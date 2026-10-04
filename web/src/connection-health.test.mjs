import test from 'node:test';
import assert from 'node:assert/strict';
import {NetworkHealth,connectionAssessment} from './connection-health.mjs';

test('Network samples need evidence, expire, bound history and clear on disconnect',()=>{
  let now=0;const health=new NetworkHealth({now:()=>now});
  assert.equal(health.snapshot().state,'unknown');
  health.record(20);health.record(NaN);assert.equal(health.snapshot().state,'sampling');
  health.record(25);health.record(30);assert.equal(health.snapshot().state,'stable');
  assert.equal(health.snapshot().jitterMs,5);
  now=15001;assert.equal(health.snapshot().state,'unknown');
  for(let i=0;i<20;i++)health.record(900);
  assert.equal(health.snapshot().count,9);assert.equal(health.snapshot().state,'slow');
  health.fail();assert.equal(health.snapshot().state,'unreachable');
  health.clear();assert.equal(health.snapshot().count,0);assert.equal(health.snapshot().state,'unknown');
});
test('High variation is flagged without treating low or unavailable FPS as failure',()=>{
  const health=new NetworkHealth();for(const ms of [20,280,20])health.record(ms);
  assert.equal(health.snapshot().state,'variable');
  assert.equal(connectionAssessment({network:{state:'stable'},stats:{display:{clientFps:0,desktopFps:null}}}),'observed');
  assert.equal(connectionAssessment({network:{state:'slow'}}),'network');
  assert.equal(connectionAssessment({stats:{processingLagMs:80},network:{state:'stable'}}),'client');
  assert.equal(connectionAssessment({online:false}),'offline');
  assert.equal(connectionAssessment({hidden:true}),'background');
  assert.equal(connectionAssessment({tunnelState:'unstable'}),'transport');
  assert.equal(connectionAssessment({network:{state:'unreachable'}}),'unreachable');
  assert.equal(connectionAssessment({}),'unknown');
});
