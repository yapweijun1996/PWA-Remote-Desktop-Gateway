import test from 'node:test';
import assert from 'node:assert/strict';
import {GatewayAPI} from './api.mjs';

function mockFetch(t,handler){const original=globalThis.fetch;globalThis.fetch=handler;t.after(()=>{globalThis.fetch=original;});}
const response=(status=200,body={activeDesktop:true})=>({ok:status>=200&&status<300,status,json:async()=>body});

test('Authorization heartbeat retries one transient failure, preserving request privacy and identity options',async t=>{
  let calls=0;mockFetch(t,async(path,options)=>{
    assert.equal(path,'/api/session');assert.equal(options.credentials,'same-origin');assert.equal(options.cache,'no-store');assert.equal(options.redirect,'error');assert.equal(options.method,'GET');
    if(++calls===1)throw new TypeError('fixture network failure');return response();
  });
  assert.equal((await new GatewayAPI().request('/api/session',{retryNetwork:true})).activeDesktop,true);assert.equal(calls,2);
});
test('Persistent transport failure is bounded to two attempts',async t=>{
  let calls=0;mockFetch(t,async()=>{calls++;throw new TypeError('fixture failure');});
  await assert.rejects(new GatewayAPI().request('/api/session',{retryNetwork:true}),{message:'NETWORK_UNAVAILABLE'});assert.equal(calls,2);
});
test('Authentication, conflict and server HTTP responses are never retried',async t=>{
  let calls=0,status=401;mockFetch(t,async()=>{calls++;return response(status,{code:status===401?'AUTH_REQUIRED':status===403?'ACCESS_DENIED':status===409?'UPDATE_IN_PROGRESS':'INTERNAL_ERROR'});});
  for(const value of [401,403,409,500]){status=value;calls=0;await assert.rejects(new GatewayAPI().request('/api/session',{retryNetwork:true}));assert.equal(calls,1);}
});
test('Connection, clipboard, cleanup and other GET requests never replay even when retry is requested',async t=>{
  let calls=0;mockFetch(t,async()=>{calls++;throw new TypeError('fixture failure');});
  for(const [path,method] of [['/api/connect-intents','POST'],['/api/clipboard-consent','POST'],['/api/desktop-session','DELETE'],['/api/devices','GET'],['/api/session','GET']]){
    calls=0;await assert.rejects(new GatewayAPI().request(path,{method,retryNetwork:path!=='/api/session'}),{message:'NETWORK_UNAVAILABLE'});assert.equal(calls,1);
  }
});
test('Malformed successful JSON is not treated as transient network failure',async t=>{
  let calls=0;mockFetch(t,async()=>{calls++;return {ok:true,status:200,json:async()=>{throw new SyntaxError('fixture invalid JSON');}};});
  await assert.rejects(new GatewayAPI().request('/api/session',{retryNetwork:true}),SyntaxError);assert.equal(calls,1);
});
test('Heartbeat timeout aborts both attempts within the original ten-second budget',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});let calls=0;
  mockFetch(t,async(_path,{signal})=>{calls++;return await new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('fixture timeout','AbortError')),{once:true}));});
  const pending=new GatewayAPI().request('/api/session',{retryNetwork:true});const rejected=assert.rejects(pending,{message:'NETWORK_UNAVAILABLE'});
  const settle=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
  t.mock.timers.tick(4500);await settle();t.mock.timers.tick(250);await settle();assert.equal(calls,2);
  t.mock.timers.tick(4500);await rejected;
});
