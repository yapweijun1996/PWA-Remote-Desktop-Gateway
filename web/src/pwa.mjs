import {release} from './release.mjs';

/** Accept only generic build identity, never render arbitrary worker/server strings. */
export function readRelease(value) {
  const version=typeof value?.version==='string'?value.version:'';
  const parts=/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(version);
  if(!value || typeof value.version!=='string' || typeof value.build!=='string'
    || !parts || parts[4]?.split('.').some(part=>/^0\d+$/.test(part))
    || value.version.length>64 || !/^[a-f0-9]{16}$/.test(value.build))return null;
  return Object.freeze({version:value.version,build:value.build});
}

function workerMessage(worker,message,timeoutMs) {
  return new Promise((resolve,reject)=>{
    const pipe=new MessageChannel();
    const finish=(error,value)=>{
      clearTimeout(timer);pipe.port1.onmessage=null;pipe.port1.onmessageerror=null;
      pipe.port1.close();pipe.port2.close();error?reject(error):resolve(value);
    };
    const timer=setTimeout(()=>finish(new Error('UPDATE_FAILED')),timeoutMs);
    pipe.port1.onmessage=event=>finish(null,event.data);
    pipe.port1.onmessageerror=()=>finish(new Error('UPDATE_FAILED'));
    try{worker.postMessage(message,[pipe.port2]);}catch{finish(new Error('UPDATE_FAILED'));}
  });
}

async function withinDeadline(task,timeoutMs=8000) {
  let timer;
  try{return await Promise.race([task,new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(new Error('UPDATE_FAILED')),timeoutMs);})]);}
  finally{clearTimeout(timer);}
}

function installationFinished(registration) {
  const worker=registration.installing;
  if(!worker || ['installed','activated','redundant'].includes(worker.state))return Promise.resolve();
  return new Promise((resolve,reject)=>{
    const finish=()=>{
      if(!['installed','activated','redundant'].includes(worker.state))return;
      clearTimeout(timer);worker.removeEventListener('statechange',finish);resolve();
    };
    const timer=setTimeout(()=>{worker.removeEventListener('statechange',finish);reject(new Error('UPDATE_FAILED'));},8000);
    worker.addEventListener('statechange',finish);finish();
  });
}

/** A waiting worker is the source of the version that will actually activate. */
export async function requestWorkerVersion(worker,timeoutMs=2500) {
  if(!worker)return null;
  try{return readRelease(await workerMessage(worker,{type:'GET_VERSION'},timeoutMs));}catch{return null;}
}

/** Explicit activation: the waiting worker obtains a server reservation itself. */
export async function setupUpdates({api,onAvailable=()=>{},onVersion=()=>{},onState=()=>{},beforeUpdate=async()=>{}}) {
  let metadata=Object.freeze({current:release,target:null});
  onVersion(metadata);
  if(!('serviceWorker' in navigator))return null;
  let observedController=navigator.serviceWorker.controller;
  const registration=await navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'});
  const channel='BroadcastChannel' in globalThis?new BroadcastChannel('rdg-lifecycle'):null;
  let accepted=false,refreshRequired=false,updating=false,checking=false,activationTimer=null,discovery=0;
  const setMetadata=target=>{metadata=Object.freeze({current:release,target});onVersion(metadata);};
  const notify=async()=>{
    const controller=navigator.serviceWorker.controller;
    // A suspended tab may discover a changed controller before its queued event arrives.
    if(observedController&&controller&&controller!==observedController&&!accepted){observedController=controller;refreshRequired=true;}
    const waiting=registration.waiting,generation=++discovery;
    if(!navigator.serviceWorker.controller || (!waiting&&!refreshRequired)){
      if(metadata.target && !accepted)setMetadata(null);
      return false;
    }
    const target=await requestWorkerVersion(waiting??navigator.serviceWorker.controller);
    if(generation!==discovery || (waiting&&waiting!==registration.waiting))return false;
    setMetadata(target);
    // Discovery may finish during a user action; keep its busy/failure UI authoritative.
    if(!updating&&!accepted&&!checking)onAvailable(metadata);
    return true;
  };
  registration.addEventListener('updatefound',()=>{const installing=registration.installing;
    installing?.addEventListener('statechange',()=>{if(installing.state==='installed')void notify();});});
  navigator.serviceWorker.addEventListener('controllerchange',()=>{
    // Other/suspended tabs never silently reload after a different tab accepts an update.
    const next=navigator.serviceWorker.controller;
    if(!observedController){observedController=next;return;}
    if(next===observedController)return;observedController=next;
    if(accepted){clearTimeout(activationTimer);accepted=false;onState('RELOADING');location.reload();}
    else{refreshRequired=true;void notify();}
  });
  channel?.addEventListener('message',event=>{if(event.data==='update-available')void notify();});
  await notify();
  const update=async()=>{
    if(updating||accepted||checking)return;updating=true;
    try {
      const status=await api.request('/api/session');
      if(!Number.isInteger(status?.nodeActiveDesktops) || status.nodeActiveDesktops<0)throw new Error('UPDATE_FAILED');
      if(status.nodeActiveDesktops>0){onState('UPDATE_DEFERRED');return;}
      await beforeUpdate();
      const waiting=registration.waiting;
      if(!waiting){
        if(refreshRequired){await api.request('/api/update-boundary',{method:'POST',body:{}});onState('RELOADING');location.reload();}
        else onState('UP_TO_DATE');return;
      }
      onState('UPDATING');accepted=true;
      const result=await workerMessage(waiting,{type:'ACCEPT_UPDATE',csrf:api.csrf},8000);
      if(result!=='ACTIVATING'){accepted=false;onState(result==='UPDATE_DEFERRED'?'UPDATE_DEFERRED':'UPDATE_FAILED');}
      else if(accepted){
        channel?.postMessage('update-available');
        activationTimer=setTimeout(()=>{if(accepted){accepted=false;onState('UPDATE_FAILED');}},8000);
      }
    }catch(error){accepted=false;onState(error?.message==='UPDATE_DEFERRED'?'UPDATE_DEFERRED':'UPDATE_FAILED');}
    finally{updating=false;}
  };
  update.check=async()=>{
    if(updating||accepted||checking)return metadata;
    checking=true;
    onState('CHECKING_UPDATE');
    try{await withinDeadline(registration.update());await installationFinished(registration);onState(await notify()?'UPDATE_AVAILABLE':'UP_TO_DATE');}
    catch{onState('UPDATE_FAILED');}
    finally{checking=false;}
    return metadata;
  };
  Object.defineProperty(update,'metadata',{get:()=>metadata});
  return update;
}
