export class GatewayAPI {
  csrf=null;
  async request(path,{method='GET',body,retryNetwork=false}={}) {
    const headers={};if(method!=='GET'){headers['Content-Type']='application/json';if(this.csrf)headers['X-RDG-CSRF']=this.csrf;}
    // Only the read-only authorization heartbeat tolerates a transient failure.
    // Two 4.5s attempts plus 250ms backoff stay within its previous 10s budget.
    const retry=retryNetwork&&method==='GET'&&path==='/api/session';
    for(let attempt=0;attempt<(retry?2:1);attempt++){
      const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),retry?4500:10000);
      try{
        let res;
        try{res=await fetch(path,{method,credentials:'same-origin',cache:'no-store',redirect:'error',headers,
          body:body===undefined?undefined:JSON.stringify(body),signal:controller.signal});}
        catch(error){
          if(!['TypeError','AbortError'].includes(error?.name))throw error;
          clearTimeout(timer);
          if(retry&&attempt===0){await new Promise(resolve=>setTimeout(resolve,250));continue;}
          throw new Error('NETWORK_UNAVAILABLE');
        }
        if(!res.ok){let code='REQUEST_FAILED';try{code=(await res.json()).code??code;}catch{}throw new Error(code);}
        return res.status===204?null:await res.json();
      }finally{clearTimeout(timer);}
    }
  }
  async bootstrap(){const data=await this.request('/api/session/bootstrap',{method:'POST',body:{}});this.csrf=data.csrfToken;return data;}
}
