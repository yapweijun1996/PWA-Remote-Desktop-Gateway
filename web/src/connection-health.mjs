/** Bounded HTTP RTT samples, local only. This cannot identify a failing network hop. */
export class NetworkHealth {
  #now;#samples=[];#at=null;#failed=false;
  constructor({now=()=>performance.now()}={}){this.#now=now;}
  record(ms){
    if(!Number.isFinite(ms)||ms<0)return;
    if(this.#failed||this.#at!==null&&this.#now()-this.#at>15000)this.#samples=[];
    this.#samples.push(ms);if(this.#samples.length>9)this.#samples.shift();
    this.#at=this.#now();this.#failed=false;
  }
  fail(){this.#at=this.#now();this.#failed=true;}
  snapshot(){
    const ageMs=this.#at===null?null:Math.max(0,this.#now()-this.#at);
    if(ageMs===null||ageMs>15000)return {state:'unknown',count:0,averageMs:null,jitterMs:null,ageMs};
    if(this.#failed)return {state:'unreachable',count:0,averageMs:null,jitterMs:null,ageMs};
    const count=this.#samples.length,averageMs=this.#samples.reduce((a,b)=>a+b,0)/count;
    const jitterMs=count>1?this.#samples.slice(1).reduce((sum,value,index)=>sum+Math.abs(value-this.#samples[index]),0)/(count-1):null;
    // UI heuristics describe recent gateway HTTP requests, not measured packet loss.
    const state=count<3?'sampling':averageMs>800?'slow':jitterMs>100?'variable':averageMs>300?'slow':'stable';
    return {state,count,averageMs,jitterMs,ageMs};
  }
  clear(){this.#samples=[];this.#at=null;this.#failed=false;}
}

/** Numeric observations support suggestions, never definitive host attribution. */
export function connectionAssessment({online=true,hidden=false,tunnelState='unknown',network,stats}={}){
  if(!online)return 'offline';
  if(hidden)return 'background';
  if(tunnelState==='unstable')return 'transport';
  if(network?.state==='unreachable')return 'unreachable';
  if(stats?.processingLagMs>=50)return 'client';
  if(['slow','variable'].includes(network?.state))return 'network';
  if(network?.state==='stable')return 'observed';
  return 'unknown';
}
