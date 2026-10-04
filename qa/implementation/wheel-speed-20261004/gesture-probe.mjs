import http from 'node:http';import {readFile} from 'node:fs/promises';import {createRequire} from 'node:module';import path from 'node:path';
const root=process.cwd(),scratch=path.dirname(new URL(import.meta.url).pathname);
const server=http.createServer(async(req,res)=>{try{const file=req.url==='/page.html'?path.join(scratch,'page.html'):path.join(root,req.url.split('?')[0]);
  res.setHeader('content-type',file.endsWith('.html')?'text/html':'text/javascript');res.end(await readFile(file));}catch{res.statusCode=404;res.end();}}).listen(0);
await new Promise(r=>server.on('listening',r));
const {chromium}=createRequire(import.meta.url)(process.env.RDG_PLAYWRIGHT_MODULE);
const browser=await chromium.launch({headless:true,executablePath:process.env.RDG_TEST_CHROMIUM});
const page=await browser.newPage({viewport:{width:500,height:400}});
await page.goto(`http://127.0.0.1:${server.address().port}/page.html`);await page.waitForFunction(()=>window.ready);
const gestures={
 'mouse wheel, 10 notches (100px each, 50ms apart)':Array(10).fill([100,50]),
 'mouse wheel, fast spin 30 notches (100px, 20ms)':Array(30).fill([100,20]),
 'trackpad slow drag (8px/event, 60Hz, 1s)':Array(60).fill([8,16]),
 'trackpad medium swipe (30px/event, 60Hz, 1s)':Array(60).fill([30,16]),
 'trackpad flick (ramp to 300px then decay, 60Hz)':[...[20,60,120,200,300,300,280,250,220,190,160,130,100,80,60,40,30,20,10,5]].map(d=>[d,16]),
};
const out={};
for(const [name,events] of Object.entries(gestures)){
  await page.evaluate(()=>{window.input.start('control');window.capture.focus();window.input.enabled=true;window.sent.length=0;});
  await page.mouse.move(100,100);await page.waitForTimeout(300); // let the window reset
  let px=0;for(const [d,gap] of events){px+=d;await page.mouse.wheel(0,d);await page.waitForTimeout(gap);}
  await page.waitForTimeout(100);
  const clicks=await page.evaluate(()=>window.sent.filter(s=>s.down||s.up).length);
  out[name]={inputPx:px,clicksSent:clicks,idealClicksAt30px:Math.floor(px/30)};
}
console.log(JSON.stringify(out,null,1));await browser.close();server.close();
