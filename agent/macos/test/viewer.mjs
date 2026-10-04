// PROTOTYPE viewer for the local feasibility test. Decodes the agent's H.264 with WebCodecs and drives the existing
// RemoteInput (profiles, latches, release on blur) through a small client shim. Nothing is stored.
import {RemoteInput} from '/web/src/input.mjs';
const $=id=>document.getElementById(id);
const port=Number(new URLSearchParams(location.search).get('port')||5960);
const keysyms={CommandLeft:0xffe7,CommandRight:0xffe8,OptionLeft:0xffe9,OptionRight:0xffea,ControlLeft:0xffe3,ControlRight:0xffe4};
let ws=null,decoder=null,input=null,canvas=null,ctx=null,video={width:0,height:0},needKey=true,lastKeyRequest=0;
const metrics={frames:0,bytes:0,latencies:[],errors:0,dropped:0,windowStart:performance.now(),fps:0,kbps:0};
globalThis.__agentMetrics=metrics;
const send=message=>{if(ws?.readyState===1)ws.send(JSON.stringify(message));};
const requestKeyframe=()=>{const now=performance.now();if(now-lastKeyRequest>300){lastKeyRequest=now;send({t:'kf'});}};
const state=text=>{$('state').textContent=text;};

function setupSurface(width,height){
  const stage=$('stage');stage.replaceChildren();
  const capture=document.createElement('div');capture.className='capture';capture.tabIndex=0;
  canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;capture.append(canvas);stage.append(capture);
  ctx=canvas.getContext('2d');
  const scale=()=>canvas.clientWidth/width;
  const client={
    getDisplay:()=>({getScale:scale,getWidth:()=>width,getHeight:()=>height}),
    sendKeyEvent:(down,keysym)=>send({t:'k',s:keysym,d:!!down}),
    sendMouseState:(s)=>send({t:'m',x:Math.round(s.x/scale()),y:Math.round(s.y/scale()),
      b:(s.left?1:0)|(s.middle?2:0)|(s.right?4:0)|(s.up?8:0)|(s.down?16:0)}),
  };
  input?.dispose();
  input=new RemoteInput({surface:capture,pointerSurface:canvas,client,Guacamole:globalThis.Guacamole,profile:$('profile').value,keysyms,
    onPause:()=>{},onFailure:()=>state('input failure')});
  input.start($('control').checked?'control':'view');
}

function configure(config){
  decoder?.close();
  decoder=new VideoDecoder({
    output:frame=>{
      ctx.drawImage(frame,0,0);
      metrics.latencies.push(Date.now()-frame.timestamp/1000);if(metrics.latencies.length>120)metrics.latencies.shift();
      metrics.frames++;frame.close();
    },
    error:()=>{metrics.errors++;needKey=true;requestKeyframe();},
  });
  const description=Uint8Array.from(atob(config.avcc),c=>c.charCodeAt(0));
  decoder.configure({codec:config.codec,description,optimizeForLatency:true,hardwareAcceleration:'prefer-hardware'});
  needKey=true;
}

function onVideo(buffer){
  const view=new DataView(buffer),key=view.getUint8(1)===1,captureMillis=view.getFloat64(2,false);
  metrics.bytes+=buffer.byteLength;
  if(!decoder||decoder.state!=='configured')return;
  if(needKey&&!key){requestKeyframe();return;}
  needKey=false;
  decoder.decode(new EncodedVideoChunk({type:key?'key':'delta',timestamp:Math.round(captureMillis*1000),data:new Uint8Array(buffer,14)}));
}

$('connect').onclick=()=>{
  const token=$('token').value.trim();if(!token)return;
  ws=new WebSocket(`ws://127.0.0.1:${port}`);ws.binaryType='arraybuffer';state('connecting');
  ws.onopen=()=>{send({t:'hello',token,control:$('control').checked,clipboard:$('clipboard').checked});$('token').value='';};
  ws.onmessage=e=>{
    if(typeof e.data!=='string')return onVideo(e.data);
    const m=JSON.parse(e.data);
    if(m.t==='ready'){video={width:m.width,height:m.height};setupSurface(m.width,m.height);
      state(`connected ${m.width}×${m.height} · control ${m.control?'on':'off ('+m.controlReason+')'} · clipboard ${m.clipboard?'on':'off'}`);}
    else if(m.t==='config')configure(m);
    else if(m.t==='status'){metrics.dropped=m.dropped;metrics.secureInput=m.secureInput;}
    else if(m.t==='clip')$('fromMac').value=m.text;
    else if(m.t==='error')state('error '+m.code);
  };
  ws.onclose=()=>{state('closed');input?.dispose();input=null;decoder?.close();decoder=null;$('connect').disabled=false;$('disconnect').disabled=true;};
  $('connect').disabled=true;$('disconnect').disabled=false;
};
$('disconnect').onclick=()=>{send({t:'release'});ws?.close();};
$('release').onclick=()=>send({t:'release'});
$('sendClip').onclick=()=>send({t:'clip',text:$('toMac').value});
$('typeText').onclick=()=>send({t:'type',text:$('toMac').value});
$('profile').onchange=()=>input?.setProfile($('profile').value);
setInterval(()=>{
  const now=performance.now(),seconds=(now-metrics.windowStart)/1000;
  metrics.fps=metrics.frames/seconds;metrics.kbps=metrics.bytes*8/1000/seconds;
  const sorted=[...metrics.latencies].sort((a,b)=>a-b),p=q=>sorted.length?sorted[Math.min(sorted.length-1,Math.floor(q*sorted.length))]:NaN;
  metrics.p50=p(.5);metrics.p95=p(.95);
  $('stats').textContent=`fps ${metrics.fps.toFixed(1)} · ${metrics.kbps.toFixed(0)} kbit/s · latency p50 ${metrics.p50?.toFixed(0)} ms p95 ${metrics.p95?.toFixed(0)} ms · dropped ${metrics.dropped} · decode errors ${metrics.errors}${metrics.secureInput?' · SECURE INPUT ACTIVE':''}`;
  metrics.frames=0;metrics.bytes=0;metrics.windowStart=now;
},1000);
