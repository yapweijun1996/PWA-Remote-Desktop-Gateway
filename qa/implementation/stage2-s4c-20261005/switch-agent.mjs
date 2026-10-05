/**
 * Stage 2 S4(c): turns the host agent engine on (default) or off (--disable) by changing exactly one line of the private
 * environment file, RDG_AGENT_ENABLED, and recreating only the gateway with the same image. If the new gateway is not healthy or
 * any check fails, the previous environment is restored and the gateway recreated from it (ROLLED_BACK). Access policy, the
 * Tunnel, guacd, volumes and every other container are never touched; nothing secret is printed.
 *   node switch-agent.mjs [--disable] [--preflight-only]
 */
import {execFileSync,spawnSync} from 'node:child_process';
import {readFile,writeFile,lstat,open,rename,unlink} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {homedir} from 'node:os';
import {writeArtifact} from '../../../scripts/atomic-artifact.mjs';

const enable=!process.argv.includes('--disable'),preflightOnly=process.argv.includes('--preflight-only');
const wanted=enable?'true':'false',current=enable?'false':'true';
const docker=['--host','unix:///Users/yapweijun/.docker/run/docker.sock'];
const image='sha256:0ace2d4884d28fabb9da82ccb9bad3c28ffd1c0a63af0f95c3cd5abb1b9d43c4';
const gateway='rdg-current-mac-pilot-gateway-1',guacd='rdg-current-mac-pilot-guacd-1',project='rdg-current-mac-pilot';
const envPath=homedir()+'/.cloudflared/rdg-current-mac-pilot/owner-setup.env';
const stamp=new Date().toISOString().replace(/[-:T]/g,'').slice(0,12);
const backupPath=`${envPath}.before-agent-${enable?'on':'off'}-${stamp}`;
const receiptPath=`qa/implementation/stage2-s4c-20261005/switch-${enable?'on':'off'}-${stamp}.json`;
const tokenSource=homedir()+'/Library/Application Support/RDG/agent.token';
const branch='codex/host-agent-stage2-20261004';

function refused(condition,code){if(!condition)throw new Error(code);}
function run(command,args,options={}){
  try{return execFileSync(command,args,{encoding:'utf8',maxBuffer:8*1024*1024,timeout:120000,stdio:['ignore','pipe','pipe'],...options}).trim();}
  catch{throw new Error('BOUNDED_LOCAL_COMMAND_FAILED');}
}
const d=(args,options)=>run('docker',[...docker,...args],options);
const inspect=name=>JSON.parse(d(['inspect',name]))[0];
const envMap=container=>Object.fromEntries([...container.Config.Env].sort().map(value=>{const at=value.indexOf('=');return [value.slice(0,at),value.slice(at+1)];}));
const byKey=object=>Object.fromEntries(Object.entries(object).sort(([a],[b])=>a<b?-1:a>b?1:0));
const fingerprint=container=>({id:container.Id,image:container.Image,startedAt:container.State.StartedAt});
const mounts=container=>container.Mounts.map(({Type,Name,Source,Destination,RW})=>({Type,Destination,RW,Identity:Type==='volume'?Name:Source.replace(/^\/host_mnt(?=\/)/,'')})).sort((a,b)=>a.Destination.localeCompare(b.Destination));
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function atomicPrivate(target,data){
  const temp=target+'.pwa-'+randomBytes(12).toString('hex');let handle;
  try{handle=await open(temp,'wx',0o600);await handle.writeFile(data);await handle.sync();await handle.close();handle=null;await rename(temp,target);const folder=await open(target.slice(0,target.lastIndexOf('/')),'r');try{await folder.sync();}finally{await folder.close();}}
  finally{await handle?.close();await unlink(temp).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
async function healthy(name,seconds=60){
  let container;const until=Date.now()+seconds*1000;
  do{container=inspect(name);if(container.State.Running&&container.State.Health?.Status==='healthy'&&container.Image===image)return container;await sleep(1000);}while(Date.now()<until);
  return null;
}
const compose=['compose','--project-name',project,'--env-file',envPath,'-f','deployment/compose.owner-setup.yaml','-f','deployment/compose.agent.yaml'];
const composeEnvironment=()=>{const environment={...process.env,GATEWAY_IMAGE:image};delete environment.DOCKER_CONTEXT;return environment;};
const approvedMounts=[
  {Type:'bind',Destination:'/app/config/device.json',RW:false,Identity:homedir()+'/.cloudflared/rdg-current-mac-pilot/device.owner-setup.json'},
  {Type:'bind',Destination:'/run/secrets/rdg_agent_token',RW:false,Identity:tokenSource},
  {Type:'volume',Destination:'/var/lib/rdg',RW:true,Identity:'rdg-current-mac-pilot_rdg-metadata'},
  {Type:'volume',Destination:'/var/lib/rdg-key',RW:false,Identity:'rdg-current-mac-pilot_rdg-vnc-key'}].sort((a,b)=>a.Destination.localeCompare(b.Destination));

// ---- preflight -------------------------------------------------------------------------------------------------------------------
const sourceCommit=run('git',['rev-parse','HEAD']);
refused(run('git',['branch','--show-current'])===branch,'DEDICATED_BRANCH_REQUIRED');
refused(run('git',['status','--porcelain'])==='','WORKING_TREE_NOT_CLEAN');
const before=inspect(gateway),environment=envMap(before);
refused(before.Image===image&&before.State.Health?.Status==='healthy'&&before.State.Running,'GATEWAY_NOT_THE_DEPLOYED_RELEASE');
refused(environment.RDG_AGENT_ENABLED===current,'AGENT_FLAG_NOT_IN_THE_EXPECTED_STATE');
refused(same(mounts(before),approvedMounts)&&before.Config.User==='10001:10001'&&before.HostConfig.ReadonlyRootfs===true,'DEPLOYED_SHAPE_CHANGED');
refused(same(before.HostConfig.PortBindings,{'8080/tcp':[{HostIp:'127.0.0.1',HostPort:'32120'}]}),'GATEWAY_LOOPBACK_REQUIRED');
const otherNames=d(['ps','--format','{{.Names}}']).split('\n').filter(name=>name&&name!==gateway);
refused(otherNames.includes(guacd),'GUACD_MISSING');
const preserved=Object.fromEntries(otherNames.map(name=>[name,fingerprint(inspect(name))]));
// A restart ends any open desktop (VNC to guacd :4822 or the agent on :5960): refuse while one is open.
const rawNet=d(['exec',gateway,'sh','-c','cat /proc/net/tcp /proc/net/tcp6']);
const established=port=>rawNet.split('\n').filter(row=>{const fields=row.trim().split(/\s+/);return fields[3]==='01'&&fields[2]?.endsWith(':'+port.toString(16).toUpperCase().padStart(4,'0'));}).length;
const active={vnc:established(4822),agent:established(5960)};
refused(active.vnc===0&&active.agent===0,'ACTIVE_DESKTOP_BLOCKS_RESTART');
const metadata=await lstat(envPath);refused(metadata.isFile()&&!metadata.isSymbolicLink()&&metadata.uid===process.getuid()&&(metadata.mode&0o777)===0o600,'PRIVATE_ENV_FILE_REQUIRED');
const original=await readFile(envPath,'utf8');
refused(original.split('\n').filter(row=>row.startsWith('RDG_AGENT_ENABLED=')).length===1&&original.includes(`\nRDG_AGENT_ENABLED=${current}\n`),'FLAG_LINE_AMBIGUOUS');
const updated=original.replace(`\nRDG_AGENT_ENABLED=${current}\n`,`\nRDG_AGENT_ENABLED=${wanted}\n`);
if(enable) {
  // Turning it on makes the token a hard start dependency: check it exactly as the gateway will.
  const info=await lstat(tokenSource);
  refused(info.isFile()&&!info.isSymbolicLink()&&info.uid===process.getuid()&&(info.mode&0o777)===0o600&&/^[A-Za-z0-9_-]{43}$/.test((await readFile(tokenSource,'utf8')).trim()),'AGENT_TOKEN_FILE_REFUSED');
}
const probeEnv=envPath+'.render-'+randomBytes(6).toString('hex');
await writeFile(probeEnv,updated,{mode:0o600,flag:'wx'});
let service;
try{service=JSON.parse(d(['compose','--project-name',project,'--env-file',probeEnv,'-f','deployment/compose.owner-setup.yaml','-f','deployment/compose.agent.yaml','config','--format','json'],{env:composeEnvironment()})).services.gateway;}
finally{await unlink(probeEnv).catch(()=>{});}
refused(service.image===image&&service.environment.RDG_AGENT_ENABLED===wanted,'RENDERED_FLAG_WRONG');
refused(Object.entries(environment).every(([key,value])=>!key.startsWith('RDG_')||key==='RDG_AGENT_ENABLED'||String(service.environment[key])===value),'COMPOSE_ENVIRONMENT_CHANGED');
if(preflightOnly){console.log(JSON.stringify({status:'PREFLIGHT_OK',mode:enable?'enable':'disable',image,activeDesktops:active,otherContainers:otherNames.length,sourceCommit}));process.exit(0);}
const backup=await open(backupPath,'wx',0o600);try{await backup.writeFile(original);await backup.sync();}finally{await backup.close();}

// ---- apply, verify, roll back on any failure ---------------------------------------------------------------------------------
async function rollBack(reason){
  console.log(JSON.stringify({status:'ROLLING_BACK',failure:reason}));
  await writeArtifact(receiptPath,JSON.stringify({status:'ROLLING_BACK',failure:reason,recordedAt:new Date().toISOString(),sourceCommit},null,2)+'\n').catch(()=>{});
  const outcome={status:'ROLLED_BACK',failure:reason,recordedAt:new Date().toISOString(),sourceCommit,requested:wanted,backupPath};
  try{
    await atomicPrivate(envPath,original);
    d([...compose,'up','-d','--no-deps','--pull','never','gateway'],{env:composeEnvironment()});
    const restored=await healthy(gateway,90);
    outcome.previousStateHealthy=Boolean(restored);outcome.environmentRestored=(await readFile(envPath,'utf8'))===original;
    if(!restored)outcome.status='ROLLBACK_FAILED';
  }catch(error){outcome.status='ROLLBACK_FAILED';outcome.rollbackError=String(error.message).slice(0,200);}
  await writeArtifact(receiptPath,JSON.stringify(outcome,null,2)+'\n');
  console.log(JSON.stringify({status:outcome.status,failure:reason}));
  process.exit(1);
}
try{
  await atomicPrivate(envPath,updated);
  d([...compose,'up','-d','--no-deps','--pull','never','gateway'],{env:composeEnvironment()});
  const after=await healthy(gateway,60);
  refused(after,'GATEWAY_NOT_HEALTHY');
  refused(same(byKey(envMap(after)),byKey({...environment,RDG_AGENT_ENABLED:wanted})),'GATEWAY_ENVIRONMENT_UNEXPECTED');
  refused(same(mounts(after),approvedMounts)&&same(after.HostConfig.PortBindings,before.HostConfig.PortBindings),'MOUNTS_OR_PORTS_CHANGED');
  refused(after.Config.User==='10001:10001'&&after.HostConfig.ReadonlyRootfs===true,'NONROOT_READONLY_REQUIRED');
  refused(otherNames.every(name=>same(fingerprint(inspect(name)),preserved[name])),'UNRELATED_CONTAINER_CHANGED');
  const logs=spawnSync('docker',[...docker,'logs',gateway],{encoding:'utf8',maxBuffer:8*1024*1024}),log=(logs.stdout??'')+(logs.stderr??'');
  refused(log.includes('RDG gateway ready')&&!log.includes('RDG startup refused'),'GATEWAY_LOG_UNEXPECTED');
  refused(await fetch('http://127.0.0.1:32120/health').then(response=>response.status===200,()=>false),'LOOPBACK_HEALTH_FAILED');
  // Informational: can the gateway container reach the agent's port right now (is an agent listening)? Connect and close, no data.
  const reach=spawnSync('docker',[...docker,'exec',gateway,'bash','-c',"timeout 3 bash -c 'exec 3<>/dev/tcp/host.docker.internal/5960' && echo reachable || echo unreachable"],{encoding:'utf8'});
  const edge=await fetch('https://remote.gmb01.xyz/',{redirect:'manual'}).then(response=>({status:response.status,locationHost:response.headers.get('location')?new URL(response.headers.get('location')).host:null}),()=>({status:null,locationHost:null}));
  const receipt={status:enable?'AGENT_ENABLED_LOCAL_RUNTIME_VERIFIED':'AGENT_DISABLED_LOCAL_RUNTIME_VERIFIED',recordedAt:new Date().toISOString(),sourceCommit,image,containerId:after.Id,health:after.State.Health.Status,agentEnabled:enable,
    onlyPrivateEnvironmentChange:['RDG_AGENT_ENABLED'],activeDesktopsBeforeRestart:active,agentPortReachableFromGateway:(reach.stdout??'').trim()==='reachable',publicEdgeAfter:edge,
    unrelatedContainersPreserved:true,preservedContainerCount:otherNames.length,backupPath,accessPolicyChanged:false,tunnelConfigChanged:false};
  await writeArtifact(receiptPath,JSON.stringify(receipt,null,2)+'\n');
  console.log(JSON.stringify({status:receipt.status,containerId:after.Id,health:after.State.Health.Status,agentPortReachableFromGateway:receipt.agentPortReachableFromGateway,publicEdgeAfter:edge}));
}catch(error){await rollBack(String(error.message).slice(0,120));}
