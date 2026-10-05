// PROTOTYPE view-only measurement. Streams the agent's H.264 into a headless Chromium on loopback and records fps, bitrate,
// end-to-end latency (capture timestamp on a shared clock), drops and agent CPU. Frames are never saved or screenshotted.
// Usage: node measure.mjs <seconds> [label]   (agent must already be running: see README)
import {execFileSync} from 'node:child_process';import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';import path from 'node:path';import os from 'node:os';
import http from 'node:http';import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';
const seconds=Number(process.argv[2]||20),label=process.argv[3]||'run';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const token=readFileSync(path.join(os.homedir(),'Library/Application Support/RDG/agent.token'),'utf8').trim();
const pid=execFileSync('pgrep',['-f','RDGAgent.app/Contents/MacOS/rdg-agent --port']).toString().trim().split('\n')[0];
const cpuSeconds=()=>{const t=execFileSync('ps',['-o','cputime=','-p',pid]).toString().trim();const [m,s]=t.split(':');return Number(m)*60+Number(s);};
const rssMB=()=>Number(execFileSync('ps',['-o','rss=','-p',pid]).toString().trim())/1024;
const viewerPort=5971;
const files={'/v.html':'<!doctype html><title>m</title>'};
const server=http.createServer((q,r)=>{r.setHeader('content-type','text/html');r.end(files[q.url]||files['/v.html']);}).listen(viewerPort,'127.0.0.1');
await new Promise(r=>server.on('listening',r));
const {chromium}=createRequire(import.meta.url)(process.env.RDG_PLAYWRIGHT_MODULE);
const browser=await chromium.launch({headless:true,executablePath:process.env.RDG_TEST_CHROMIUM});
const page=await browser.newPage();await page.goto(`http://127.0.0.1:${viewerPort}/v.html`);
await page.evaluate(([port,tok])=>{
  const m=globalThis.m={t0:performance.now(),frames:0,bytes:0,keys:0,lat:[],series:[],status:null,err:null,decErrors:0,config:null,ready:null,secure:null};
  const ws=new WebSocket(`ws://127.0.0.1:${port}`);ws.binaryType='arraybuffer';let dec=null,need=true;
  const send=o=>ws.readyState===1&&ws.send(JSON.stringify(o));
  ws.onopen=()=>send({t:'hello',v:1,token:tok,control:false,clipboard:false});
  ws.onmessage=e=>{
    if(typeof e.data!=='string'){
      const v=new DataView(e.data),key=v.getUint8(1)===1,ms=v.getFloat64(2,false);m.bytes+=e.data.byteLength;if(key)m.keys++;
      if(!dec||dec.state!=='configured')return;if(need&&!key){send({t:'kf'});return;}need=false;
      dec.decode(new EncodedVideoChunk({type:key?'key':'delta',timestamp:Math.round(ms*1000),data:new Uint8Array(e.data,14)}));return;}
    const j=JSON.parse(e.data);
    if(j.t==='ready')m.ready=j;
    if(j.t==='error')m.err=j.code;
    if(j.t==='status'){m.status=j;m.secure=j.secureInput;}
    if(j.t==='config'){m.config={codec:j.codec,width:j.width,height:j.height};dec?.close();
      dec=new VideoDecoder({output:f=>{m.lat.push(Date.now()-f.timestamp/1000);m.frames++;f.close();},error:()=>{m.decErrors++;need=true;send({t:'kf'});}});
      dec.configure({codec:j.codec,description:Uint8Array.from(atob(j.avcc),c=>c.charCodeAt(0)),optimizeForLatency:true,hardwareAcceleration:'prefer-hardware'});need=true;}
  };
  setInterval(()=>{const l=m.lat.splice(0).sort((a,b)=>a-b),p=q=>l.length?l[Math.min(l.length-1,Math.floor(q*l.length))]:null;
    m.series.push({fps:m.frames,kbit:Math.round(m.bytes*8/1000),p50:p(.5),p95:p(.95),max:l.length?l[l.length-1]:null,dropped:m.status?.dropped??0});m.frames=0;m.bytes=0;},1000);
},[5960,token]);
await page.waitForFunction(()=>globalThis.m.ready||globalThis.m.err,null,{timeout:15000});
const early=await page.evaluate(()=>({ready:globalThis.m.ready,err:globalThis.m.err}));
if(early.err){console.log(JSON.stringify({label,error:early.err}));await browser.close();server.close();process.exit(1);}
await new Promise(r=>setTimeout(r,1500)); // let the first keyframe settle
const cpu0=cpuSeconds(),t0=Date.now();await page.evaluate(()=>{globalThis.m.series.length=0;});
await new Promise(r=>setTimeout(r,seconds*1000));
const cpu1=cpuSeconds(),elapsed=(Date.now()-t0)/1000;
const out=await page.evaluate(()=>({series:globalThis.m.series,config:globalThis.m.config,ready:globalThis.m.ready,secure:globalThis.m.secure,decErrors:globalThis.m.decErrors,status:globalThis.m.status}));
const kb=out.series.map(s=>s.kbit),fps=out.series.map(s=>s.fps),p50=out.series.map(s=>s.p50).filter(x=>x!=null),p95=out.series.map(s=>s.p95).filter(x=>x!=null);
const avg=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null,max=a=>a.length?Math.max(...a):null,med=a=>{const s=[...a].sort((x,y)=>x-y);return s.length?s[Math.floor(s.length/2)]:null;};
const summary={label,seconds:Math.round(elapsed),resolution:`${out.ready.width}x${out.ready.height}`,codec:out.config?.codec,
  fps:{avg:+avg(fps).toFixed(1),max:max(fps)},kbit_per_s:{avg:Math.round(avg(kb)),peak:max(kb)},
  latency_ms:{p50_median:med(p50),p95_median:med(p95),worst_second_max:max(out.series.map(s=>s.max).filter(x=>x!=null))},
  dropped_total:out.status?.dropped??0,decode_errors:out.decErrors,secureInput:out.secure,
  agent_cpu_percent_of_one_core:+((cpu1-cpu0)/elapsed*100).toFixed(1),agent_rss_mb:Math.round(rssMB())};
console.log(JSON.stringify(summary,null,1));
mkdirSync(path.join(root,'.tools/agent/measure'),{recursive:true});writeFileSync(path.join(root,`.tools/agent/measure/${label}.json`),JSON.stringify({summary,series:out.series},null,1));
await browser.close();server.close();
