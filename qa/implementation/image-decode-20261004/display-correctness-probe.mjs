import http from 'node:http';import {readFile} from 'node:fs/promises';import {createRequire} from 'node:module';import path from 'node:path';
const root=process.cwd(),scratch=path.dirname(new URL(import.meta.url).pathname);
const server=http.createServer(async(req,res)=>{try{const file=req.url==='/page.html'?path.join(scratch,'page.html'):path.join(root,req.url.split('?')[0]);
  res.setHeader('content-type',file.endsWith('.html')?'text/html':'text/javascript');res.end(await readFile(file));}catch{res.statusCode=404;res.end();}}).listen(0);
await new Promise(r=>server.on('listening',r));
const {chromium}=createRequire(import.meta.url)(process.env.RDG_PLAYWRIGHT_MODULE);
const browser=await chromium.launch({headless:true,executablePath:process.env.RDG_TEST_CHROMIUM,args:['--js-flags=--expose-gc']});
const page=await browser.newPage();const logs=[];page.on('console',m=>logs.push(m.text()));page.on('pageerror',e=>logs.push('PAGEERROR '+e));
await page.goto(`http://127.0.0.1:${server.address().port}/page.html`);await page.waitForFunction(()=>window.ready);
const result=await page.evaluate(async()=>{
  const W=1280,H=800,N=40,G=window.G;
  const png=async color=>{const c=new OffscreenCanvas(W,H),g=c.getContext('2d');g.fillStyle=color;g.fillRect(0,0,W,H);g.fillStyle='#222';g.font='14px monospace';
    for(let y=14;y<H;y+=18)g.fillText(('line '+y+' lorem ipsum dolor sit amet ').repeat(4),8,y);
    const buf=new Uint8Array(await (await c.convertToBlob({type:'image/png'})).arrayBuffer());let s='';for(let i=0;i<buf.length;i+=0x8000)s+=String.fromCharCode.apply(null,buf.subarray(i,i+0x8000));return btoa(s);};
  const red=await png('#ff0000'),green=await png('#00ff00');
  const feed=(display,layer,b64)=>{const stream=new G.InputStream({sendAck(){}},0);display.drawStream(layer,0,0,stream,'image/png');
    for(let i=0;i<b64.length;i+=4096)stream.onblob(b64.slice(i,i+4096));stream.onend();};
  const pixel=(layer,x,y)=>[...layer.getCanvas().getContext('2d').getImageData(x,y,1,1).data];
  const mode=(name)=>{const display=new G.Display();const layer=display.getDefaultLayer();display.resize(layer,W,H);
    if(name==='library(ImageDecoder, leaks)'){}
    else if(name==='1.2.5 data-URI')display.drawStream=(l,x,y,stream,mime)=>{const r=new G.DataURIReader(stream,mime);r.onend=()=>display.draw(l,x,y,r.getURI());};
    else window.useFastImageStreams(display,G);
    return {display,layer};};
  const out={};
  for(const name of ['library(ImageDecoder, leaks)','1.2.5 data-URI','new helper']) {
    const {display,layer}=mode(name);
    // correctness + ordering: red image, a later blue fill over a 10x10 corner, then green image (must win at pixel 500,500)
    feed(display,layer,red);display.rect?.call(display,layer,0,0,10,10);display.fillColor(layer,0,0,255,255);display.flush();
    await new Promise(r=>setTimeout(r,300));const a=pixel(layer,5,5),b=pixel(layer,500,500);
    feed(display,layer,green);display.flush();await new Promise(r=>setTimeout(r,300));const c=pixel(layer,500,500);
    // throughput: N frames fed back-to-back, wait until the last one is on the canvas
    const t0=performance.now();for(let i=0;i<N;i++){feed(display,layer,i%2?red:green);display.flush();}
    await new Promise(r=>display.flush(r));const ms=performance.now()-t0;const last=pixel(layer,640,3);
    out[name]={cornerAfterRedThenBlueFill:a,centerAfterRed:b,centerAfterGreen:c,lastFrameColor:last.slice(0,3),msPerFrameEndToEnd:+(ms/N).toFixed(2)};
  }
  return out;
});
// give Chrome time to GC unclosed frames and report the warning, if any
await page.evaluate(()=>{for(let i=0;i<5;i++)gc();});await page.waitForTimeout(1500);
const warnings=logs.filter(l=>/VideoFrame/.test(l)).length;
console.log(JSON.stringify({result,videoFrameWarnings:warnings,pageErrors:logs.filter(l=>/PAGEERROR/.test(l))}));
await browser.close();server.close();
