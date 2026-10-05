/**
 * Stage 2 S4(a): can a container reach a service bound to 127.0.0.1 on this Mac through host.docker.internal, the way the gateway
 * must reach the host agent on 127.0.0.1:5960? A stand-in listener (accept and close, no data) replaces the agent, which is not
 * running. Everything is removed afterwards. Not evidence about the agent itself.
 */
import net from 'node:net';
import {execFileSync,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {writeArtifact} from '../../../scripts/atomic-artifact.mjs';
const image='rdg-gateway-agent-candidate:s4a',network='rdg-s4a-topology-net';
const docker=args=>{try{return {code:0,out:execFileSync('docker',args,{encoding:'utf8',timeout:60000,stdio:['ignore','pipe','pipe']}).trim()};}catch(error){return {code:error.status??1,out:String(error.stdout??'')+String(error.stderr??'')};}};
const results=[];const record=(name,ok,detail={})=>{results.push({name,ok,...detail});console.log(`${ok?'PASS':'FAIL'}  ${name}  ${JSON.stringify(detail)}`);};
const peers=[];
// Asynchronous, so the stand-in listener can accept while the container connects.
const dockerAsync=async args=>{try{const {stdout}=await promisify(execFile)('docker',args,{encoding:'utf8',timeout:60000});return {code:0,out:stdout.trim()};}catch(error){return {code:error.code??1,out:String(error.stdout??'')+String(error.stderr??'')};}};
const probe=(host,port,extra=[])=>dockerAsync(['run','--rm','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--user','10001:10001','--entrypoint','bash',...extra,image,'-c',`timeout 5 bash -c 'exec 3<>/dev/tcp/${host}/${port}' && echo connected || echo refused`]);
const server=net.createServer(socket=>{peers.push(socket.remoteAddress);socket.end();});
try {
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(5960,'127.0.0.1',resolve);});
  record('stand-in listener is bound to 127.0.0.1 only',server.address().address==='127.0.0.1');
  const onDefault=await probe('host.docker.internal',5960);
  record('a container on the default bridge reaches host.docker.internal:5960 (listener bound to loopback)',onDefault.out.endsWith('connected'),{result:onDefault.out.split('\n').pop()});
  docker(['network','create',network]);
  const onUser=await probe('host.docker.internal',5960,['--network',network]);
  record('so does a container on a user-defined bridge network (like the compose backend network)',onUser.out.endsWith('connected'),{result:onUser.out.split('\n').pop()});
  const closed=await probe('host.docker.internal',5961);
  record('control: a port nobody listens on is refused (the probe can fail)',closed.out.endsWith('refused'),{result:closed.out.split('\n').pop()});
  record('the listener saw the connections arrive from the host loopback side',peers.length>=2,{connections:peers.length,sources:[...new Set(peers)]});
}catch(error){record('check ran to completion',false,{error:String(error.message).slice(0,200)});}
finally{
  server.close();docker(['network','rm',network]);
  const left=docker(['network','ls','--filter','name=rdg-s4a-topology','--format','{{.Name}}']).out;
  record('throwaway network removed and nothing listens on 5960 any more',left===''&&await new Promise(resolve=>{const s=net.connect(5960,'127.0.0.1');s.on('connect',()=>{s.destroy();resolve(false);});s.on('error',()=>resolve(true));}));
  await writeArtifact('qa/implementation/stage2-s4a-20261005/topology-check.json',JSON.stringify({recordedAt:new Date().toISOString(),results},null,2)+'\n');
  console.log(`${results.filter(r=>r.ok).length}/${results.length} passed`);process.exit(results.every(r=>r.ok)?0:1);
}
