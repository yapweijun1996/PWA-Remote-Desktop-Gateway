// Serves the PROTOTYPE viewer and the few repository modules it imports, on loopback only. Usage: node serve-viewer.mjs [port]
import http from 'node:http';import {readFile} from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const allowed=[/^\/agent\/macos\/test\/viewer\.(html|mjs)$/,/^\/web\/src\/[a-z0-9-]+\.mjs$/,/^\/reference\/[a-z0-9-]+\.mjs$/,/^\/web\/vendor\/all\.min\.js$/];
const types={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript'};
const port=Number(process.argv[2]||5961);
http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1');
  if(url.pathname==='/'){res.statusCode=302;res.setHeader('location','/agent/macos/test/viewer.html'+url.search);return res.end();}
  const p=url.pathname;
  if(!allowed.some(r=>r.test(p))||p.includes('..')){res.statusCode=404;return res.end();}
  try{res.setHeader('content-type',types[path.extname(p)]);res.setHeader('cache-control','no-store');res.end(await readFile(path.join(root,p)));}
  catch{res.statusCode=404;res.end();}
}).listen(port,'127.0.0.1',()=>console.log(`viewer: http://127.0.0.1:${port}/  (start the agent with --allow-origin http://127.0.0.1:${port})`));
