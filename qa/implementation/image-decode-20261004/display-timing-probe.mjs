import http from 'node:http';import {readFile} from 'node:fs/promises';import {createRequire} from 'node:module';import path from 'node:path';
const root=process.cwd(),scratch=path.dirname(new URL(import.meta.url).pathname);
const server=http.createServer(async(req,res)=>{try{const file=req.url==='/page.html'?path.join(scratch,'page.html'):path.join(root,req.url.split('?')[0]);
  res.setHeader('content-type',file.endsWith('.html')?'text/html':'text/javascript');res.end(await readFile(file));}catch{res.statusCode=404;res.end();}}).listen(0);
await new Promise(r=>server.on('listening',r));
const {chromium}=createRequire(import.meta.url)(process.env.RDG_PLAYWRIGHT_MODULE);
const browser=await chromium.launch({headless:true,executablePath:process.env.RDG_TEST_CHROMIUM});
const page=await browser.newPage();
await page.goto(`http://127.0.0.1:${server.address().port}/page.html`);await page.waitForFunction(()=>window.ready);
const result=await page.evaluate(async()=>{
  const W=1280,H=800,N=40,G=window.G;
  const png=async seed=>{const c=new OffscreenCanvas(W,H),g=c.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,W,H);g.fillStyle='#222';g.font='14px monospace';
    for(let y=14;y<H;y+=18)g.fillText(('line '+(y+seed)+' lorem ipsum dolor sit amet ').repeat(4),8,y);
    const px=g.getImageData(0,0,W,H);for(let i=0;i<px.data.length;i+=4*97)px.data[i]^=(seed*7+1)&255;g.putImageData(px,0,0);
    const buf=new Uint8Array(await (await c.convertToBlob({type:'image/png'})).arrayBuffer());let s='';for(let i=0;i<buf.length;i+=0x8000)s+=String.fromCharCode.apply(null,buf.subarray(i,i+0x8000));return btoa(s);};
  const uniq=()=>{const a=[];return (async()=>{for(let i=0;i<N;i++)a.push(await png(i+Math.floor(Math.random()*1e6)));return a;})();};
  const hasNativeBase64=typeof Uint8Array.fromBase64==='function';
  const feed=(display,layer,b64)=>{const stream=new G.InputStream({sendAck(){}},0);display.drawStream(layer,0,0,stream,'image/png');
    for(let i=0;i<b64.length;i+=4096)stream.onblob(b64.slice(i,i+4096));stream.onend();};
  const modes={
    'library ImageDecoder (1.2.3, leaks VideoFrame)':d=>{},
    'data-URI + Image (1.2.5)':d=>{d.drawStream=(l,x,y,s,m)=>{const r=new G.DataURIReader(s,m);r.onend=()=>d.draw(l,x,y,r.getURI());};},
    'helper useFastImageStreams (new, native base64)':d=>window.useFastImageStreams(d,G,true),
    'helper useFastImageStreams (new, fallback)':d=>window.useFastImageStreams(d,G,false),
    
  };
  const out={hasNativeBase64,runs:{}};
  for(const [name,setup] of Object.entries(modes)) {
    const samples=[];
    for(let rep=0;rep<3;rep++){
      const frames=await uniq();const display=new G.Display(),layer=display.getDefaultLayer();display.resize(layer,W,H);setup(display);
      feed(display,layer,frames[0]);await new Promise(r=>display.flush(r)); // warm-up
      const t0=performance.now();for(let i=1;i<N;i++){feed(display,layer,frames[i]);display.flush();}
      await new Promise(r=>display.flush(r));samples.push((performance.now()-t0)/(N-1));
    }
    out.runs[name]=samples.map(x=>+x.toFixed(2));
  }
  return out;
});
console.log(JSON.stringify(result));await browser.close();server.close();
