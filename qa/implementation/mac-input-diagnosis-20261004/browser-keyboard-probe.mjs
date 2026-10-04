import http from 'node:http';import {readFile} from 'node:fs/promises';import {createRequire} from 'node:module';import path from 'node:path';
const root=process.cwd(),scratch=path.dirname(new URL(import.meta.url).pathname);
const server=http.createServer(async(req,res)=>{try{const file=req.url==='/page.html'?path.join(scratch,'page.html'):path.join(root,req.url.split('?')[0]);
  res.setHeader('content-type',file.endsWith('.html')?'text/html':'text/javascript');res.end(await readFile(file));}catch{res.statusCode=404;res.end();}}).listen(0);
await new Promise(r=>server.on('listening',r));
const {chromium}=createRequire(import.meta.url)(process.env.RDG_PLAYWRIGHT_MODULE);
const browser=await chromium.launch({headless:true,executablePath:process.env.RDG_TEST_CHROMIUM});
for(const platform of ['Win32','MacIntel']){
  const ua=platform==='Win32'?'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36':undefined;
  const context=await browser.newContext(ua?{userAgent:ua}:{});
  await context.addInitScript(p=>{Object.defineProperty(navigator,'platform',{get:()=>p});},platform);
  const page=await context.newPage();await page.goto(`http://127.0.0.1:${server.address().port}/page.html`);await page.waitForFunction(()=>window.ready);
  const run=async(name,profile,modifier)=>{
    await page.evaluate(p=>window.make(p),profile);
    await page.keyboard.down(modifier);await page.waitForTimeout(500);await page.keyboard.press('a');await page.waitForTimeout(100);await page.keyboard.up(modifier);await page.waitForTimeout(100);
    const keys=await page.evaluate(()=>window.keys.slice());
    console.log(`${platform.padEnd(8)} ${name.padEnd(46)} ${keys.map(k=>`${k.t}ms ${k.sym}${k.down?'↓':'↑'}`).join('  ')}`);
  };
  await run('Ctrl hold + a (windows-native)','windows-native','Control');
  await run('Left Alt hold + a (windows-alt-command)','windows-alt-command','Alt');
  await run('Shift hold + a (windows-native)','windows-native','Shift');
  await context.close();
}
await browser.close();server.close();
