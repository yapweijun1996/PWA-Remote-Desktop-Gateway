import http from 'node:http';import {readFile} from 'node:fs/promises';import {createRequire} from 'node:module';import path from 'node:path';
const root=process.cwd(),scratch=path.dirname(new URL(import.meta.url).pathname);
const types={'.mjs':'text/javascript','.js':'text/javascript','.html':'text/html'};
const server=http.createServer(async(req,res)=>{try{
  const file=req.url==='/page.html'?path.join(scratch,'page.html'):path.join(root,decodeURIComponent(req.url.split('?')[0]));
  if(!file.startsWith(root)&&!file.startsWith(scratch))throw 0;
  res.setHeader('content-type',types[path.extname(file)]??'text/plain');res.end(await readFile(file));}catch{res.statusCode=404;res.end();}}).listen(0);
await new Promise(r=>server.on('listening',r));
const {chromium}=createRequire(import.meta.url)(process.env.RDG_PLAYWRIGHT_MODULE);
const browser=await chromium.launch({headless:true,executablePath:process.env.RDG_TEST_CHROMIUM});
const page=await browser.newPage({viewport:{width:500,height:400}});const errors=[];page.on('pageerror',e=>errors.push(String(e)));
await page.goto(`http://127.0.0.1:${server.address().port}/page.html`);await page.waitForFunction(()=>window.ready);
const box={x:100,y:100};const scrollTop=()=>page.evaluate(()=>window.capture.scrollTop);
const out={};
// 1) Paused (not focused / not active): native scrolling must work and nothing may be sent.
await page.mouse.move(box.x,box.y);await page.mouse.wheel(0,300);await page.waitForTimeout(150);
out.pausedScrollTop=await scrollTop();out.pausedSent=await page.evaluate(()=>window.sent.length);
// 2) Active controller: wheel goes to the remote, local view must not scroll.
await page.evaluate(()=>{window.input.start('control');window.capture.focus();window.input.enabled=true;});
await page.mouse.move(box.x+5,box.y+5);await page.waitForTimeout(50);
const before=await page.evaluate(()=>window.sent.length);const top0=await scrollTop();
await page.mouse.wheel(0,106);await page.waitForTimeout(150);
const after=await page.evaluate(()=>window.sent.slice());
out.activeScrollTopDelta=(await scrollTop())-top0;out.activeWheelMessages=after.slice(before).filter(s=>s.down||s.up).length;
// 3) View-only: native scrolling again, nothing sent.
await page.evaluate(()=>{window.input.start('view');window.capture.scrollTop=0;});
const sentView=await page.evaluate(()=>window.sent.length);
await page.mouse.move(box.x,box.y);await page.mouse.wheel(0,200);await page.waitForTimeout(150);
out.viewScrollTop=await scrollTop();out.viewSentDelta=(await page.evaluate(()=>window.sent.length))-sentView;
// 4) Burst: 60 events of 530px (10 clicks each) in ~one window must be capped.
await page.evaluate(()=>{window.input.start('control');window.capture.focus();window.input.enabled=true;window.sent.length=0;});
await page.mouse.move(box.x,box.y);
for(let i=0;i<60;i++)await page.mouse.wheel(0,530);
await page.waitForTimeout(100);
const burst=await page.evaluate(()=>window.sent.slice());
out.burstWheelMessages=burst.filter(s=>s.down||s.up).length;out.burstTotalMessages=burst.length;
out.dangling=burst.reduce((n,s,i)=>n+((s.down||s.up)&&!(burst[i+1]&&!burst[i+1].down&&!burst[i+1].up)?1:0),0);
out.pageErrors=errors;out.failure=await page.evaluate(()=>window.failure??null);
console.log(JSON.stringify(out,null,1));await browser.close();server.close();
