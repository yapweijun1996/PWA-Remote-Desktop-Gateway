/** Loopback-only static preview. No API, authentication or remote backend. */
import {createServer} from 'node:http';import {readFile} from 'node:fs/promises';import {fileURLToPath} from 'node:url';
const resources=new Map([
 ['/prototype/',['../prototype/index.html','text/html; charset=utf-8']],
 ['/prototype/styles.css',['../prototype/styles.css','text/css; charset=utf-8']],
 ['/prototype/app.mjs',['../prototype/app.mjs','text/javascript; charset=utf-8']],
 ['/reference/keyboard-state.mjs',['../reference/keyboard-state.mjs','text/javascript; charset=utf-8']]
]);
const port=Number(process.env.RDG_PREVIEW_PORT??4173);
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('RDG_PREVIEW_PORT must be 1024–65535');
const server=createServer(async(req,res)=>{
 const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"};
 try{if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,headers);res.end('Method not allowed');return;}
 if(req.headers.host!==`127.0.0.1:${port}`){res.writeHead(403,headers);res.end('Use printed loopback address');return;}
 if(req.url==='/'||req.url==='/prototype'){res.writeHead(302,{...headers,Location:'/prototype/'});res.end();return;}
 const entry=resources.get(req.url);if(!entry){res.writeHead(404,headers);res.end('Not in prototype allowlist');return;}
 const bytes=await readFile(fileURLToPath(new URL(entry[0],import.meta.url)));res.writeHead(200,{...headers,'Content-Type':entry[1],'Content-Length':bytes.length});res.end(req.method==='HEAD'?undefined:bytes);
 }catch{res.writeHead(500,headers);res.end('Preview resource unavailable');}
});
server.on('error',e=>{console.error(`Preview did not start: ${e.message}`);process.exitCode=1;});server.listen(port,'127.0.0.1',()=>console.log(`Design prototype only: http://127.0.0.1:${port}/prototype/\nNo remote backend, OTP or service worker is running.`));for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close());
