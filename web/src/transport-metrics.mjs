const BUCKET_MS=250;
const WINDOW_MS=5000;
const BUCKET_COUNT=WINDOW_MS/BUCKET_MS+1;
const PEAK_BUCKETS=1000/BUCKET_MS;

/** Size of canonical Guacamole UTF-8 instruction framing, without serialization. */
const ASCII_ONLY=/^[\x00-\x7f]*$/;
export function instructionBytes(elements){
  let total=0;
  for(const element of elements){
    const value=String(element);
    // Base64 image blobs dominate traffic and are ASCII: one native scan instead of a per-character loop.
    if(ASCII_ONLY.test(value)){total+=String(value.length).length+2+value.length;continue;}
    let points=0,bytes=0;
    for(let index=0;index<value.length;index++){
      const unit=value.charCodeAt(index);points++;
      if(unit<0x80)bytes++;
      else if(unit<0x800)bytes+=2;
      else if(unit>=0xD800&&unit<=0xDBFF&&index+1<value.length&&value.charCodeAt(index+1)>=0xDC00&&value.charCodeAt(index+1)<=0xDFFF){bytes+=4;index++;}
      else bytes+=3;
    }
    // A decimal code-point count, dot and comma/semicolon accompany each element.
    total+=String(points).length+2+bytes;
  }
  return total;
}

/** Connection-local numeric aggregates; no screen, clipboard, key or token data. */
export class TransportMetrics {
  #clock;#started;#inbound=0;#outbound=0;#peakInbound=0;#buckets;#firstDisplay=null;#processingLag=null;#active=true;
  #display=null;#displayAt=null;
  constructor({now=()=>performance.now()}={}){
    this.#clock=now;this.#started=now();
    this.#buckets=Array.from({length:BUCKET_COUNT},()=>({index:-1,inbound:0,outbound:0}));
  }
  #elapsed(){return Math.max(0,this.#clock()-this.#started);}
  record(direction,bytes){
    if(!this.#active||!Number.isSafeInteger(bytes)||bytes<0||(direction!=='inbound'&&direction!=='outbound'))return;
    const index=Math.floor(this.#elapsed()/BUCKET_MS),bucket=this.#buckets[index%BUCKET_COUNT];
    if(bucket.index!==index){bucket.index=index;bucket.inbound=0;bucket.outbound=0;}
    bucket[direction]=Math.min(Number.MAX_SAFE_INTEGER,bucket[direction]+bytes);
    if(direction==='inbound'){
      this.#inbound=Math.min(Number.MAX_SAFE_INTEGER,this.#inbound+bytes);
      // Highest download in any one second since connecting: the 5 s average hides a short scroll burst.
      let second=0;for(let back=0;back<PEAK_BUCKETS;back++){const earlier=this.#buckets[(index-back+BUCKET_COUNT*PEAK_BUCKETS)%BUCKET_COUNT];if(earlier.index===index-back)second+=earlier.inbound;}
      if(second>this.#peakInbound)this.#peakInbound=second;
    }else this.#outbound=Math.min(Number.MAX_SAFE_INTEGER,this.#outbound+bytes);
  }
  firstDisplay(){if(this.#active&&this.#firstDisplay===null)this.#firstDisplay=this.#elapsed();}
  displayStatistics(statistics){
    if(!this.#active)return;
    const lag=statistics?.processingLag;
    this.#processingLag=typeof lag==='number'&&Number.isFinite(lag)&&lag>=0?lag:null;
    this.#display=Object.fromEntries(['clientFps','serverFps','desktopFps','dropRate'].map(key=>[key,
      typeof statistics?.[key]==='number'&&Number.isFinite(statistics[key])&&statistics[key]>=0?statistics[key]:null]));
    this.#displayAt=this.#elapsed();
  }
  snapshot(){
    if(!this.#active)return null;
    const elapsedMs=this.#elapsed(),rateWindowMs=Math.min(WINDOW_MS,elapsedMs);
    // Quarter-second buckets bound memory independently of instruction/frame rate.
    const firstIndex=Math.floor(Math.max(0,elapsedMs-WINDOW_MS)/BUCKET_MS),lastIndex=Math.floor(elapsedMs/BUCKET_MS);
    let inbound=0,outbound=0;
    for(const bucket of this.#buckets)if(bucket.index>=firstIndex&&bucket.index<=lastIndex){inbound+=bucket.inbound;outbound+=bucket.outbound;}
    return {elapsedMs,inboundBytes:this.#inbound,outboundBytes:this.#outbound,peakInboundBytesPerSecond:this.#peakInbound,
      inboundBytesPerSecond:rateWindowMs?inbound*1000/rateWindowMs:null,
      outboundBytesPerSecond:rateWindowMs?outbound*1000/rateWindowMs:null,
      rateWindowMs,firstDisplayMs:this.#firstDisplay,processingLagMs:this.#displayAt!==null&&elapsedMs-this.#displayAt<=WINDOW_MS?this.#processingLag:null,
      display:this.#displayAt!==null&&elapsedMs-this.#displayAt<=WINDOW_MS?this.#display:null};
  }
  dispose(){this.#active=false;this.#peakInbound=0;this.#inbound=0;this.#outbound=0;this.#buckets=[];this.#firstDisplay=null;this.#processingLag=null;this.#display=null;this.#displayAt=null;}
}

/** Observe documented tunnel hooks while preserving the official client and ACKs. */
export function observeTunnelTransfer(tunnel,metrics,{display}={}){
  const originalInstruction=tunnel.oninstruction,originalSend=tunnel.sendMessage;
  let active=true;
  const receive=function(opcode,parameters){
    if(active&&opcode!=='')metrics.record('inbound',instructionBytes([opcode,...parameters]));
    return originalInstruction?.call(this,opcode,parameters);
  };
  const send=function(...elements){
    const connected=active&&tunnel.isConnected(),result=originalSend.apply(this,elements);
    if(connected&&elements.length&&elements[0]!==''){
      metrics.record('outbound',instructionBytes(elements));
      // Client sends this only after its queued display operations finish flushing.
      if(elements[0]==='sync'&&display?.getWidth()>0&&display?.getHeight()>0)metrics.firstDisplay();
    }
    return result;
  };
  tunnel.oninstruction=receive;tunnel.sendMessage=send;
  return ()=>{
    active=false;
    if(tunnel.oninstruction===receive)tunnel.oninstruction=originalInstruction;
    if(tunnel.sendMessage===send)tunnel.sendMessage=originalSend;
  };
}
