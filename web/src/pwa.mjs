/** Explicit activation: the waiting worker obtains a server reservation itself. */
export async function setupUpdates({api,onAvailable,onState,beforeUpdate}) {
  if(!('serviceWorker' in navigator))return null;
  let observedController=navigator.serviceWorker.controller;
  const registration=await navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'});
  const channel='BroadcastChannel' in globalThis?new BroadcastChannel('rdg-lifecycle'):null;
  const notify=()=>{if(navigator.serviceWorker.controller && registration.waiting)onAvailable();};
  registration.addEventListener('updatefound',()=>{const installing=registration.installing;
    installing?.addEventListener('statechange',()=>{if(installing.state==='installed')notify();});});
  notify();
  let accepted=false,refreshRequired=false;
  navigator.serviceWorker.addEventListener('controllerchange',()=>{
    // Other/suspended tabs never silently reload after a different tab accepts an update.
    const next=navigator.serviceWorker.controller;
    if(!observedController){observedController=next;return;}
    if(next===observedController)return;observedController=next;
    if(accepted){onState('RELOADING');location.reload();}else{refreshRequired=true;onAvailable();}
  });
  channel?.addEventListener('message',e=>{if(e.data==='update-available')onAvailable();});
  return async()=>{
    try {
      const status=await api.request('/api/session');
      if(status.nodeActiveDesktops>0){onState('UPDATE_DEFERRED');return;}
      await beforeUpdate();
      if(!registration.waiting){if(refreshRequired){await api.request('/api/update-boundary',{method:'POST',body:{}});onState('RELOADING');location.reload();}else onState('READY');return;}
      onState('UPDATING');
      const pipe=new MessageChannel();
      const result=await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>reject(new Error('UPDATE_FAILED')),8000);
        pipe.port1.onmessage=e=>{clearTimeout(timer);resolve(e.data);};
        accepted=true;registration.waiting.postMessage({type:'ACCEPT_UPDATE',csrf:api.csrf},[pipe.port2]);
      });
      if(result!=='ACTIVATING'){accepted=false;onState(result==='UPDATE_DEFERRED'?'UPDATE_DEFERRED':'UPDATE_FAILED');}
      else {channel?.postMessage('update-available');setTimeout(()=>{if(accepted){accepted=false;onState('UPDATE_FAILED');}},8000);}
    }catch {accepted=false;onState('UPDATE_FAILED');}
  };
}
