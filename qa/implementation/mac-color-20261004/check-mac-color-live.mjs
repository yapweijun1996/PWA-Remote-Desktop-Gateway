import http from 'node:http';import https from 'node:https';
import {readFile} from 'node:fs/promises';import {createHash} from 'node:crypto';
import {writeArtifact} from '../../../scripts/atomic-artifact.mjs';
const publicOrigin='https://remote.gmb01.xyz',host=new URL(publicOrigin).host;
const results=[];
function request(url,{method='GET',headers={},body}={}){
 return new Promise((resolve,reject)=>{const client=url.startsWith('https:')?https:http;const req=client.request(url,{method,headers:{'User-Agent':'Mozilla/5.0',...headers}},res=>{const chunks=[];let length=0;res.on('data',chunk=>{length+=chunk.length;if(length>512*1024){req.destroy(new Error('BOUNDED_RESPONSE_REQUIRED'));return;}chunks.push(chunk);});res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,bytes:Buffer.concat(chunks)}));});req.setTimeout(8000,()=>req.destroy(new Error('LIVE_REQUEST_DEADLINE')));req.on('error',reject);if(body)req.write(body);req.end();});
}
const local=(path,options={})=>request('http://127.0.0.1:32120'+path,{...options,headers:{Host:host,...options.headers}});
const add=(test,passed,details={})=>results.push({test,status:passed?'PASS':'FAIL',...details});
const identityAbsent={Host:host,Origin:publicOrigin,'Content-Type':'application/json'};
const checks=[
 ['Missing identity protected API',()=>local('/api/devices'),401],
 ['Forged JWT and email header protected API',()=>local('/api/devices',{headers:{'CF-Access-Jwt-Assertion':'e30.e30.invalid','CF-Access-Authenticated-User-Email':'owner@fixture.test'}}),401],
 ['Wrong Host protected API',()=>local('/api/devices',{headers:{Host:'invalid.fixture.test'}}),403],
 ['Wrong Origin bootstrap',()=>local('/api/session/bootstrap',{method:'POST',headers:{Origin:'https://invalid.fixture.test','Content-Type':'application/json'},body:'{}'}),403],
 ['Absent Origin bootstrap',()=>local('/api/session/bootstrap',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}),403],
 ['Unsigned WebSocket upgrade',()=>local('/ws/sessions/'+'F'.repeat(43),{headers:{Origin:publicOrigin,Upgrade:'websocket',Connection:'Upgrade','Sec-WebSocket-Key':'AAAAAAAAAAAAAAAAAAAAAA==','Sec-WebSocket-Version':'13'}}),401],
 ['Unsigned scoped cleanup',()=>local('/api/desktop-session',{method:'DELETE',headers:identityAbsent,body:JSON.stringify({intentId:'F'.repeat(43)})}),401],
 ['Wrong Origin scoped cleanup',()=>local('/api/desktop-session',{method:'DELETE',headers:{Origin:'https://invalid.fixture.test','Content-Type':'application/json'},body:JSON.stringify({intentId:'F'.repeat(43)})}),403],
];
await Promise.all(checks.map(async([name,task,expected])=>{try{const response=await task();add(name,response.status===expected,{httpStatus:response.status,expectedStatus:expected});}catch{add(name,false,{reason:'BOUNDED_REQUEST_FAILED'});}}));
const login=await local('/login');add('Unsigned login friendly HTML with no enrollment form',login.status===401&&(login.headers['content-type']??'').startsWith('text/html')&&!login.bytes.toString().includes('<form'),{httpStatus:login.status});
const worker=await local('/sw.js');const expectedWorker=createHash('sha256').update(await readFile('web/dist/sw.js')).digest('hex');
add('Deployed service worker matches reviewed source artifact',worker.status===200&&createHash('sha256').update(worker.bytes).digest('hex')===expectedWorker,{httpStatus:worker.status,workerDigest:expectedWorker});
const build=await local('/build.json'),identity=JSON.parse(build.bytes.toString());
add('Deployed generic version metadata is no-store',build.status===200&&identity.version==='1.2.2'&&identity.build==='1db76b487cb2834d'&&(build.headers['cache-control']??'').includes('no-store'),{httpStatus:build.status,version:identity.version,build:identity.build,noStore:(build.headers['cache-control']??'').includes('no-store')});
for(const path of ['/','/api/devices','/ws/sessions/'+'F'.repeat(43),'/manifest.webmanifest']){
 const response=await request(publicOrigin+path);let accessRedirect=false;
 try{const redirect=new URL(response.headers.location);accessRedirect=redirect.hostname.endsWith('.cloudflareaccess.com');}catch{}
 add('Public anonymous '+(path.startsWith('/ws/')?'WebSocket':path)+' retains Access redirect',response.status===302&&accessRedirect,{httpStatus:response.status,accessRedirect});
}
const health=await local('/health'),ready=await request('http://127.0.0.1:32124/ready'),metrics=await request('http://127.0.0.1:32124/metrics');
const match=metrics.bytes.toString().match(/^cloudflared_tunnel_ha_connections(?:\{[^\n]*\})?\s+(\d+(?:\.\d+)?)$/m);
const edgeConnections=match?Number(match[1]):null;
add('Gateway and dedicated unchanged Tunnel are healthy',health.status===200&&ready.status===200&&edgeConnections>0,{gatewayHealth:health.status,tunnelReady:ready.status,healthyEdgeConnections:edgeConnections});
const receipt={status:results.every(row=>row.status==='PASS')?'PASS':'FAIL',scope:'LOCAL_DEPLOYED_NEGATIVE_SECURITY_AND_ARTIFACT_CHECKS',recordedAt:new Date().toISOString(),userAgent:'Mozilla/5.0',webVersion:'1.2.2',webBuild:'1db76b487cb2834d',realOwnerPositiveLoginTested:false,realDesktopTested:false,results};
await writeArtifact('qa/implementation/mac-color-20261004/live-checks.json',JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify({status:receipt.status,passed:results.filter(row=>row.status==='PASS').length,total:results.length,failures:results.filter(row=>row.status!=='PASS')}));
if(receipt.status!=='PASS')process.exitCode=1;
