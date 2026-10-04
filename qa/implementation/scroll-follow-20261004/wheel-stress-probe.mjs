import http from 'node:http';import {readFile} from 'node:fs/promises';import {createRequire} from 'node:module';import path from 'node:path';
const root=process.cwd(),scratch=path.dirname(new URL(import.meta.url).pathname);
const server=http.createServer(async(req,res)=>{try{const file=req.url==='/page.html'?path.join(scratch,'page.html'):path.join(root,req.url.split('?')[0]);
  res.setHeader('content-type',file.endsWith('.html')?'text/html':'text/javascript');res.end(await readFile(file));}catch{res.statusCode=404;res.end();}}).listen(0);
await new Promise(r=>server.on('listening',r));
const {chromium}=createRequire(import.meta.url)(process.env.RDG_PLAYWRIGHT_MODULE);
const browser=await chromium.launch({headless:true,executablePath:process.env.RDG_TEST_CHROMIUM});
const page=await browser.newPage({viewport:{width:500,height:400}});
await page.goto(`http://127.0.0.1:${server.address().port}/page.html`);await page.waitForFunction(()=>window.ready);
const out={};
const run=async(name,speed,events)=>{
  await page.evaluate(s=>{window.input.start('control');window.capture.focus();window.input.enabled=true;window.input.setScrollSpeed(s);window.sent.length=0;},speed);
  await page.mouse.move(100,100);await page.waitForTimeout(400);
  let px=0;const t0=Date.now();for(const [d,gap] of events){px+=d;await page.mouse.wheel(0,d);await page.waitForTimeout(gap);}
  await page.waitForTimeout(1500); // let the backlog drain
  const sent=await page.evaluate(()=>window.sent.slice());const clicks=sent.filter(s=>s.down||s.up).length;
  let peak=0;for(let i=0,j=0;i<sent.length;i++){while(sent[i].t-sent[j].t>1000)j++;peak=Math.max(peak,i-j+1);}
  out[name]={speed,inputPx:px,clicksSent:clicks,clicksIdeal:Math.floor(px/({fast:15,max:4,normal:30}[speed])),peakMessagesIn1s:peak};
};
await run('mouse 10 notches (fast default)','fast',Array(10).fill([100,50]));
await run('mouse spin 40 notches/1s','fast',Array(40).fill([100,25]));
await run('touchpad 3000px in ~1s (60Hz x 50px)','fast',Array(60).fill([50,16]));
await run('worst case: 12000px/s for 2s, MAX speed','max',Array(240).fill([100,8]));
console.log(JSON.stringify(out,null,1));await browser.close();server.close();
