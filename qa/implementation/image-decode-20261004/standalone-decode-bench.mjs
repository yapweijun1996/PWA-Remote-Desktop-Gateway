import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)(process.env.RDG_PLAYWRIGHT_MODULE);
import http from 'node:http';const server=http.createServer((q,r)=>{r.setHeader('content-type','text/html');r.end('<canvas id=c width=1280 height=800></canvas>');}).listen(0);await new Promise(r=>server.on('listening',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.RDG_TEST_CHROMIUM});
const page=await browser.newPage({viewport:{width:1400,height:900}});
await page.goto(`http://127.0.0.1:${server.address().port}/`);
const result=await page.evaluate(async()=>{
  const W=1280,H=800,N=40;
  // Realistic scroll repaint: text-like structure + noise, so PNG is neither trivial nor incompressible.
  const make=async seed=>{const c=new OffscreenCanvas(W,H),g=c.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,W,H);g.fillStyle='#222';g.font='14px monospace';
    for(let y=14;y<H;y+=18)g.fillText(('line '+(y+seed)+' lorem ipsum dolor sit amet consectetur ').repeat(3),8,y);
    const px=g.getImageData(0,0,W,H);for(let i=0;i<px.data.length;i+=4*97)px.data[i]^=(seed*7)&255;g.putImageData(px,0,0);
    return await c.convertToBlob({type:'image/png'});};
  const blobs=[];for(let i=0;i<N;i++)blobs.push(await make(i));
  const bytes=await Promise.all(blobs.map(b=>b.arrayBuffer()));
  const sizeKB=Math.round(bytes.reduce((n,b)=>n+b.byteLength,0)/N/1024);
  const ctx=document.getElementById('c').getContext('2d');
  const b64=u8=>{let s='';for(let i=0;i<u8.length;i+=0x8000)s+=String.fromCharCode.apply(null,u8.subarray(i,i+0x8000));return btoa(s);};
  // long-task accounting on the main thread
  let longMs=0;new PerformanceObserver(l=>{for(const e of l.getEntries())longMs+=e.duration;}).observe({entryTypes:['longtask']});
  const run=async(name,fn)=>{longMs=0;const t0=performance.now();for(let i=0;i<N;i++)await fn(i);const ms=performance.now()-t0;
    await new Promise(r=>setTimeout(r,60));return {name,msPerFrame:+(ms/N).toFixed(2),longTaskMsTotal:Math.round(longMs)};};
  const out=[];
  // A: 1.2.4/1.2.5 path: base64 chunks -> data URI -> Image -> drawImage
  out.push(await run('A data-URI + Image (current 1.2.5)',async i=>{const uri='data:image/png;base64,'+b64(new Uint8Array(bytes[i]));
    const img=new Image();await new Promise((res,rej)=>{img.onload=res;img.onerror=rej;img.src=uri;});ctx.drawImage(img,0,0);}));
  // B: Blob -> createImageBitmap -> drawImage (library's own blob path)
  out.push(await run('B Blob + createImageBitmap (proposed)',async i=>{const bmp=await createImageBitmap(new Blob([bytes[i]],{type:'image/png'}));ctx.drawImage(bmp,0,0);bmp.close();}));
  // C: original 1.2.3 path: ImageDecoder -> VideoFrame -> drawImage (frame left unclosed, as upstream does)
  if('ImageDecoder' in window)out.push(await run('C ImageDecoder + unclosed VideoFrame (1.2.3)',async i=>{const d=new ImageDecoder({type:'image/png',data:new Blob([bytes[i]]).stream()});const r=await d.decode({completeFramesOnly:true});ctx.drawImage(r.image,0,0);}));
  if('ImageDecoder' in window)out.push(await run('D ImageDecoder + frame.close()',async i=>{const d=new ImageDecoder({type:'image/png',data:new Blob([bytes[i]]).stream()});const r=await d.decode({completeFramesOnly:true});ctx.drawImage(r.image,0,0);r.image.close();}));
  return {frame:`${W}x${H} PNG ~${sizeKB} KB`,frames:N,results:out};
});
console.log(JSON.stringify(result,null,1));await browser.close();server.close();
