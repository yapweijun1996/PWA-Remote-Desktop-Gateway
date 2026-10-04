/* Generic immutable assets only; never store APIs, identity, frames or clipboard. */
const BUILD='__BUILD__',CACHE=`rdg-static-${BUILD}`;
const RELEASE=__RELEASE__;
const SAFE=__SAFE_ASSETS__;
function safeResponse(request,response){
  const url=new URL(request.url);
  return request.method==='GET' && url.origin===self.location.origin && !url.search && !url.hash
    && Object.hasOwn(SAFE,url.pathname) && response.status===200 && !response.redirected
    && !(response.headers.get('Cache-Control')??'').match(/\b(no-store|private)\b/i)
    && (response.headers.get('Content-Type')??'').split(';')[0].trim()===SAFE[url.pathname];
}
self.addEventListener('install',event=>event.waitUntil((async()=>{
  const cache=await caches.open(CACHE);
  for(const path of Object.keys(SAFE)){
    const request=new Request(path,{cache:'reload',credentials:'same-origin',redirect:'error'});
    const response=await fetch(request);if(!safeResponse(request,response))throw new Error('STATIC_ASSET_INVALID');
    await cache.put(request,response);
  }
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  // Explicit server reservation preceded every update activation; first install has no old clients.
  for(const name of await caches.keys())if(name.startsWith('rdg-static-')&&name!==CACHE)await caches.delete(name);
  await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET' || url.origin!==self.location.origin)return;
  if(request.mode==='navigate'){
    event.respondWith(fetch(request).catch(async()=>await (await caches.open(CACHE)).match('/offline.html')));return;
  }
  if(!url.search&&!url.hash&&Object.hasOwn(SAFE,url.pathname))event.respondWith((async()=>{
    const cached=await (await caches.open(CACHE)).match(request);return cached??fetch(request);
  })());
});
self.addEventListener('message',event=>{
  if(event.data?.type==='GET_VERSION'){
    const source=event.source,port=event.ports[0];
    if(port && source?.url && new URL(source.url).origin===self.location.origin)port.postMessage(RELEASE);
    return;
  }
  if(event.data?.type!=='ACCEPT_UPDATE')return;
  event.waitUntil((async()=>{
    const port=event.ports[0];
    const source=event.source;
    if(!port || !source?.url || new URL(source.url).origin!==self.location.origin || typeof event.data.csrf!=='string')return;
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);
    try{
      const response=await fetch('/api/update-boundary',{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',
        headers:{'Content-Type':'application/json','X-RDG-CSRF':event.data.csrf},body:'{}',signal:controller.signal});
      if(!response.ok){port.postMessage(response.status===409?'UPDATE_DEFERRED':'UPDATE_FAILED');return;}
      const result=await response.json();if(result.safe!==true || Date.parse(result.reservedUntil)<=Date.now())throw new Error('INVALID_BOUNDARY');
      port.postMessage('ACTIVATING');await self.skipWaiting();
    }catch{port.postMessage('UPDATE_FAILED');}finally{clearTimeout(timer);}
  })());
});
