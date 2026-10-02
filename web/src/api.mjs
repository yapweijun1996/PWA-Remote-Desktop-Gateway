export class GatewayAPI {
  csrf=null;
  async request(path,{method='GET',body}={}) {
    const headers={};if(method!=='GET'){headers['Content-Type']='application/json';if(this.csrf)headers['X-RDG-CSRF']=this.csrf;}
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),10000);
    try{
      const res=await fetch(path,{method,credentials:'same-origin',cache:'no-store',redirect:'error',headers,
        body:body===undefined?undefined:JSON.stringify(body),signal:controller.signal});
      if(!res.ok){let code='REQUEST_FAILED';try{code=(await res.json()).code??code;}catch{}throw new Error(code);}
      return res.status===204?null:await res.json();
    }finally{clearTimeout(timer);}
  }
  async bootstrap(){const data=await this.request('/api/session/bootstrap',{method:'POST',body:{}});this.csrf=data.csrfToken;return data;}
}
