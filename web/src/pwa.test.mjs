import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {readRelease,requestWorkerVersion,setupUpdates} from './pwa.mjs';
import {release} from './release.mjs';

const target={version:'1.1.1',build:'1234567890abcdef'};
function environment(t,{controlled=true,waiting=true,active=0,result='UPDATE_DEFERRED'}={}){
  const descriptors=new Map(['navigator','location','BroadcastChannel'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  const serviceWorker=new EventTarget(),registration=new EventTarget(),calls=[],states=[],available=[],versions=[];
  let cleanup=0,reloads=0,checks=0;
  const worker={postMessage(message,ports){
    calls.push(message.type);
    if(message.type==='GET_VERSION')ports[0].postMessage({...target,ignored:'not part of public metadata'});
    else{ports[0].postMessage(result);if(result==='ACTIVATING')queueMicrotask(()=>{
      registration.waiting=null;serviceWorker.controller=worker;serviceWorker.dispatchEvent(new Event('controllerchange'));
    });}
  }};
  serviceWorker.controller=controlled?{postMessage(){}}:null;
  registration.waiting=waiting?worker:null;registration.installing=null;
  registration.update=async()=>{checks++;};
  serviceWorker.register=async(path,options)=>{assert.equal(path,'/sw.js');assert.equal(options.updateViaCache,'none');return registration;};
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{serviceWorker}});
  Object.defineProperty(globalThis,'location',{configurable:true,value:{reload:()=>{reloads++;}}});
  Object.defineProperty(globalThis,'BroadcastChannel',{configurable:true,value:undefined});
  // Presence checks must accurately reflect an unavailable browser capability.
  delete globalThis.BroadcastChannel;
  t.after(()=>{for(const [key,descriptor]of descriptors)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];});
  const api={csrf:'fixture-csrf',request:async path=>{calls.push(path);return {nodeActiveDesktops:active};}};
  return {serviceWorker,registration,worker,calls,states,available,versions,api,
    options:{api,onState:value=>states.push(value),onAvailable:value=>available.push(value),onVersion:value=>versions.push(value),beforeUpdate:async()=>{cleanup++;}},
    get cleanup(){return cleanup;},get reloads(){return reloads;},get checks(){return checks;}};
}

test('Release messages accept bounded semantic version and build identity only',()=>{
  assert.deepEqual(readRelease({...target,email:'private@example.invalid'}),target);
  for(const value of [null,{},'1.1.0',{...target,version:'<img>'},{...target,version:'01.1.0'},{...target,version:'1.1.0-..'},{...target,version:'1.1.0-beta.01'},{...target,build:'__RDG_BUILD__'},{...target,build:'../secret'}])assert.equal(readRelease(value),null);
  assert.equal(readRelease({...target,version:'1.1.0-beta.1+build.7'}).version,'1.1.0-beta.1+build.7');
});

test('Waiting worker version query returns only metadata and closes on nonresponsive legacy worker',async()=>{
  let observed;
  const version=await requestWorkerVersion({postMessage(message,ports){observed=message;ports[0].postMessage(target);}},1000);   // generous: a loaded machine must not turn a prompt reply into a timeout
  assert.deepEqual(observed,{type:'GET_VERSION'});assert.deepEqual(version,target);
  assert.equal(await requestWorkerVersion({postMessage(){}},10),null);
  assert.equal(await requestWorkerVersion({postMessage(){throw new Error('fixture');}},10),null);
  assert.equal(await requestWorkerVersion({postMessage(message,ports){ports[0].postMessage({secret:'not metadata'});}},1000),null);
});

test('First installation exposes current release without claiming an available update',async t=>{
  const env=environment(t,{controlled:false});const update=await setupUpdates(env.options);
  assert.equal(typeof update,'function');assert.deepEqual(env.versions[0],{current:release,target:null});
  assert.equal(env.available.length,0);assert.deepEqual(env.calls,[]);
  env.serviceWorker.controller=env.worker;env.serviceWorker.dispatchEvent(new Event('controllerchange'));
  assert.equal(env.reloads,0);
});

test('An existing controller announces the actual waiting worker metadata',async t=>{
  const env=environment(t);const update=await setupUpdates(env.options);
  assert.deepEqual(update.metadata,{current:release,target});assert.equal(env.available.length,1);
  assert.equal(env.calls.includes('ACCEPT_UPDATE'),false);assert.equal(env.reloads,0);
});

test('Active node sessions defer before cleanup or activation',async t=>{
  const env=environment(t,{active:1});const update=await setupUpdates(env.options);await update();
  assert.deepEqual(env.states,['UPDATE_DEFERRED']);assert.equal(env.cleanup,0);
  assert.equal(env.calls.includes('ACCEPT_UPDATE'),false);assert.equal(env.reloads,0);
});

test('Unknown session count fails closed before cleanup or activation',async t=>{
  const env=environment(t);env.api.request=async()=>({});const update=await setupUpdates(env.options);await update();
  assert.deepEqual(env.states,['UPDATE_FAILED']);assert.equal(env.cleanup,0);assert.equal(env.calls.includes('ACCEPT_UPDATE'),false);
});

test('Worker reservation rejection remains deferred and can be retried',async t=>{
  const env=environment(t);const update=await setupUpdates(env.options);await update();await update();
  assert.deepEqual(env.states,['UPDATING','UPDATE_DEFERRED','UPDATING','UPDATE_DEFERRED']);
  assert.equal(env.cleanup,2);assert.equal(env.calls.filter(value=>value==='ACCEPT_UPDATE').length,2);assert.equal(env.reloads,0);
});

test('Only the accepting tab reloads after explicit worker activation',async t=>{
  const env=environment(t,{result:'ACTIVATING'});const update=await setupUpdates(env.options);await update();
  assert.equal(env.cleanup,1);assert.equal(env.reloads,1);assert.deepEqual(env.states,['UPDATING','RELOADING']);
});

test('Another tab activating the controller prompts a deliberate reserved refresh',async t=>{
  const env=environment(t,{waiting:false});const update=await setupUpdates(env.options);
  env.serviceWorker.controller=env.worker;env.serviceWorker.dispatchEvent(new Event('controllerchange'));
  await new Promise(resolve=>setTimeout(resolve,10));assert.equal(env.reloads,0);assert.equal(env.available.length,1);
  await update();assert.equal(env.reloads,1);assert.ok(env.calls.includes('/api/update-boundary'));
});

test('A suspended tab checking a changed controller keeps refresh explicit without needing its delayed event',async t=>{
  const env=environment(t,{waiting:false});const update=await setupUpdates(env.options);
  env.serviceWorker.controller=env.worker;await update.check();
  assert.equal(update.metadata.target.version,target.version);assert.equal(env.states.at(-1),'UPDATE_AVAILABLE');assert.equal(env.reloads,0);
  await update();assert.equal(env.reloads,1);assert.ok(env.calls.includes('/api/update-boundary'));
});

test('Explicit update check is retryable without a forced reload',async t=>{
  const env=environment(t,{waiting:false});const update=await setupUpdates(env.options);
  await update.check();assert.deepEqual(env.states,['CHECKING_UPDATE','UP_TO_DATE']);assert.equal(env.checks,1);
  env.registration.update=async()=>{throw new Error('fixture offline');};await update.check();
  assert.equal(env.states.at(-1),'UPDATE_FAILED');assert.equal(env.reloads,0);
});

test('A check waits for worker installation before announcing availability',async t=>{
  const env=environment(t,{waiting:false});const update=await setupUpdates(env.options);
  const installing=new EventTarget();installing.state='installing';env.registration.installing=installing;
  const checking=update.check();
  await new Promise(resolve=>setTimeout(resolve,10));assert.equal(env.available.length,0);
  env.registration.waiting=env.worker;installing.state='installed';installing.dispatchEvent(new Event('statechange'));
  await checking;assert.deepEqual(update.metadata.target,target);assert.equal(env.states.at(-1),'UPDATE_AVAILABLE');
});

test('Duplicate checks share the busy boundary and stale target metadata is cleared',async t=>{
  const env=environment(t);const update=await setupUpdates(env.options);
  let finish;env.registration.update=()=>new Promise(resolve=>{finish=resolve;});
  const checking=update.check();await update.check();await update();
  assert.equal(env.calls.includes('/api/session'),false);assert.deepEqual(env.states,['CHECKING_UPDATE']);
  env.registration.waiting=null;finish();await checking;
  assert.equal(update.metadata.target,null);assert.equal(env.states.at(-1),'UP_TO_DATE');
});

test('Concurrent worker discovery does not replace update progress or enable a duplicate activation',async t=>{
  const env=environment(t);const update=await setupUpdates(env.options);
  let releaseStatus;env.api.request=()=>new Promise(resolve=>{releaseStatus=resolve;});
  const updating=update();
  const installing=new EventTarget();installing.state='installed';env.registration.installing=installing;
  env.registration.dispatchEvent(new Event('updatefound'));installing.dispatchEvent(new Event('statechange'));
  await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(env.available.length,1);await update();releaseStatus({nodeActiveDesktops:0});await updating;
  assert.equal(env.calls.filter(value=>value==='ACCEPT_UPDATE').length,1);
  assert.deepEqual(env.states,['UPDATING','UPDATE_DEFERRED']);
});

test('Service worker discloses generic release only to same-origin clients without reserving activation',async()=>{
  let script=await readFile(new URL('../public/sw.template.js',import.meta.url),'utf8');
  script=script.replace('__BUILD__',target.build).replace('__RELEASE__',JSON.stringify(target)).replace('__SAFE_ASSETS__','{}');
  const handlers=new Map(),messages=[];
  vm.runInNewContext(script,{self:{location:{origin:'https://fixture.invalid'},addEventListener:(type,listener)=>handlers.set(type,listener)},URL});
  const version=handlers.get('message');
  version({data:{type:'GET_VERSION'},source:{url:'https://fixture.invalid/'},ports:[{postMessage:value=>messages.push(value)}]});
  assert.equal(JSON.stringify(messages),JSON.stringify([target]));
  for(const source of [{url:'https://other.invalid/'},null])version({data:{type:'GET_VERSION'},source,ports:[{postMessage:value=>messages.push(value)}]});
  assert.equal(messages.length,1);
});
