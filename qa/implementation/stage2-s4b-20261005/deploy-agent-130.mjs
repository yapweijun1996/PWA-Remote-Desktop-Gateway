/**
 * Stage 2 S4(b): replaces only the gateway container with release 1.3.0 (host agent engine). The agent stays OFF
 * (RDG_AGENT_ENABLED=false): the token is mounted read-only and the settings are present, but the gateway still serves VNC
 * only. If anything fails after the private environment file is touched, the previous image and environment are restored
 * automatically and the attempt is recorded as ROLLED_BACK. Access policy, the Tunnel, guacd, volumes and every other container
 * are never touched. Nothing secret is printed: only modes, owners, sizes, hashes, booleans and fixed codes.
 */
import {execFileSync,spawnSync} from 'node:child_process';
import {readFile,writeFile,lstat,open,rename,unlink} from 'node:fs/promises';
import {createHash,randomBytes} from 'node:crypto';
import {homedir} from 'node:os';
import {writeArtifact} from '../../../scripts/atomic-artifact.mjs';

const docker=['--host','unix:///Users/yapweijun/.docker/run/docker.sock'];
const image='sha256:0ace2d4884d28fabb9da82ccb9bad3c28ffd1c0a63af0f95c3cd5abb1b9d43c4';
const previousImage='sha256:2f011cf8747b87a93d1e47997169d402cf4b21168770446af98cfff69d8ef913';
const gateway='rdg-current-mac-pilot-gateway-1',guacd='rdg-current-mac-pilot-guacd-1',project='rdg-current-mac-pilot';
const envPath=homedir()+'/.cloudflared/rdg-current-mac-pilot/owner-setup.env';
// Attempt 1 (13:25) was rolled back automatically because of a bug in this script's environment comparison (it compared objects by
// key order); its backup is kept untouched as evidence, and this attempt gets its own.
const firstAttemptBackup=envPath+'.before-agent-1.3.0-20261005';
const rollbackPath=envPath+'.before-agent-1.3.0-20261005-attempt2';
const tokenSource=homedir()+'/Library/Application Support/RDG/agent.token';
const branch='codex/host-agent-stage2-20261004',receiptPath='qa/implementation/stage2-s4b-20261005/deployment.json';
const expected={version:'1.3.0',build:'045b4c19eb27f440'};
const agentKeys=['RDG_AGENT_ENABLED','RDG_AGENT_HOST','RDG_AGENT_PORT','RDG_AGENT_TOKEN_FILE'];

function refused(condition,code){if(!condition)throw new Error(code);}
function run(command,args,options={}){
  try{return execFileSync(command,args,{encoding:'utf8',maxBuffer:8*1024*1024,timeout:120000,stdio:['ignore','pipe','pipe'],...options}).trim();}
  catch{throw new Error('BOUNDED_LOCAL_COMMAND_FAILED');}
}
const d=(args,options)=>run('docker',[...docker,...args],options);
const inspect=name=>JSON.parse(d(['inspect',name]))[0];
const envMap=container=>Object.fromEntries([...container.Config.Env].sort().map(value=>{const at=value.indexOf('=');return [value.slice(0,at),value.slice(at+1)];}));
const fingerprint=container=>({id:container.Id,image:container.Image,startedAt:container.State.StartedAt});
const mounts=container=>container.Mounts.map(({Type,Name,Source,Destination,RW})=>({Type,Destination,RW,Identity:Type==='volume'?Name:Source.replace(/^\/host_mnt(?=\/)/,'')})).sort((a,b)=>a.Destination.localeCompare(b.Destination));
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const byKey=object=>Object.fromEntries(Object.entries(object).sort(([a],[b])=>a<b?-1:a>b?1:0));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function atomicPrivate(target,data){
  const temp=target+'.pwa-'+randomBytes(12).toString('hex');let handle;
  try{handle=await open(temp,'wx',0o600);await handle.writeFile(data);await handle.sync();await handle.close();handle=null;await rename(temp,target);const folder=await open(target.slice(0,target.lastIndexOf('/')),'r');try{await folder.sync();}finally{await folder.close();}}
  finally{await handle?.close();await unlink(temp).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
async function healthy(name,wanted,seconds=60){
  let container;const until=Date.now()+seconds*1000;
  do{container=inspect(name);if(container.State.Running&&container.State.Health?.Status==='healthy'&&container.Image===wanted)return container;await sleep(1000);}while(Date.now()<until);
  return null;
}
const composeBase=['compose','--project-name',project,'--env-file',envPath,'-f','deployment/compose.owner-setup.yaml'];
const composeAgent=[...composeBase,'-f','deployment/compose.agent.yaml'];
const composeEnvironment=wanted=>{const environment={...process.env,GATEWAY_IMAGE:wanted};delete environment.DOCKER_CONTEXT;return environment;};

// ---- preflight: nothing is changed until every check passes -------------------------------------------------------------
const hashes={};const paths={'/app/rdg-gateway.jar':'gateway/target/rdg-gateway.jar','/app/web/sw.js':'web/dist/sw.js','/app/web/index.html':'web/dist/index.html','/app/web/build.json':'web/dist/build.json'};
for(const [target,local] of Object.entries(paths))hashes[target]=createHash('sha256').update(await readFile(local)).digest('hex');
const release=JSON.parse(await readFile('web/dist/build.json','utf8'));
refused(release.version===expected.version&&release.build===expected.build,'BUILD_IDENTITY_CHANGED');
const sourceCommit=run('git',['rev-parse','HEAD']);
refused(run('git',['branch','--show-current'])===branch,'DEDICATED_BRANCH_REQUIRED');
refused(run('git',['status','--porcelain'])==='','WORKING_TREE_NOT_CLEAN');
const before=inspect(gateway),environment=envMap(before);
const approvedMounts=[
  {Type:'bind',Destination:'/app/config/device.json',RW:false,Identity:homedir()+'/.cloudflared/rdg-current-mac-pilot/device.owner-setup.json'},
  {Type:'volume',Destination:'/var/lib/rdg',RW:true,Identity:'rdg-current-mac-pilot_rdg-metadata'},
  {Type:'volume',Destination:'/var/lib/rdg-key',RW:false,Identity:'rdg-current-mac-pilot_rdg-vnc-key'}];
const tokenMount={Type:'bind',Destination:'/run/secrets/rdg_agent_token',RW:false,Identity:tokenSource};
const sortedMounts=list=>[...list].sort((a,b)=>a.Destination.localeCompare(b.Destination));
refused(same(mounts(before),sortedMounts(approvedMounts)),'PRIOR_MOUNTS_NOT_THE_APPROVED_SET');
refused(before.Image===previousImage&&before.State.Health?.Status==='healthy','EXISTING_GATEWAY_CHANGED');
refused(environment.RDG_DESKTOP_POLICY==='OWNER_SETUP'&&environment.RDG_TRUSTED_DEVICES_ENABLED==='true'&&agentKeys.every(key=>!(key in environment)),'INHERITED_POLICY_CHANGED');
const priorPorts=before.HostConfig.PortBindings;
refused(same(priorPorts,{'8080/tcp':[{HostIp:'127.0.0.1',HostPort:'32120'}]}),'GATEWAY_LOOPBACK_REQUIRED');
const imageInfo=JSON.parse(d(['image','inspect',image]))[0];
refused(imageInfo.Id===image&&imageInfo.Architecture==='arm64'&&imageInfo.Os==='linux','IMAGE_IDENTITY_REFUSED');
const imageHashes=Object.fromEntries(d(['run','--rm','--network','none','--entrypoint','sha256sum',image,...Object.keys(paths)]).split('\n').map(row=>{const [hash,path]=row.split(/\s+/);return [path,hash];}));
refused(same(imageHashes,hashes),'EXACT_IMAGE_ARTIFACT_MISMATCH');
const otherNames=d(['ps','--format','{{.Names}}']).split('\n').filter(name=>name&&name!==gateway);
refused(otherNames.includes(guacd),'GUACD_MISSING');
const preserved=Object.fromEntries(otherNames.map(name=>[name,fingerprint(inspect(name))]));
const rawNet=d(['exec',gateway,'sh','-c','cat /proc/net/tcp /proc/net/tcp6']);
const activeUpstream=rawNet.split('\n').filter(row=>{const fields=row.trim().split(/\s+/);return fields[3]==='01'&&fields[2]?.endsWith(':12D6');}).length;
refused(activeUpstream===0,'ACTIVE_DESKTOP_UPSTREAM_BLOCKS_REPLACEMENT');
// The token source: a regular, owner-only file with the expected shape. The value is never printed.
const tokenInfo=await lstat(tokenSource);
refused(tokenInfo.isFile()&&!tokenInfo.isSymbolicLink()&&tokenInfo.uid===process.getuid()&&(tokenInfo.mode&0o777)===0o600&&/^[A-Za-z0-9_-]{43}$/.test((await readFile(tokenSource,'utf8')).trim()),'AGENT_TOKEN_FILE_REFUSED');
const metadata=await lstat(envPath);refused(metadata.isFile()&&!metadata.isSymbolicLink()&&metadata.uid===process.getuid()&&(metadata.mode&0o777)===0o600,'PRIVATE_ENV_FILE_REQUIRED');
const original=await readFile(envPath,'utf8');
refused((await readFile(firstAttemptBackup,'utf8'))===original,'FIRST_ATTEMPT_ROLLBACK_NOT_RESTORED');
refused(original.split('\n').filter(row=>row.startsWith('GATEWAY_IMAGE=')).length===1,'IMAGE_ASSIGNMENT_AMBIGUOUS');
refused(!/^RDG_AGENT_/m.test(original),'AGENT_SETTINGS_ALREADY_PRESENT');
const updated=original.replace(/^GATEWAY_IMAGE=.*$/m,'GATEWAY_IMAGE='+image).replace(/\n*$/,'\n')+`RDG_AGENT_ENABLED=false\nRDG_AGENT_TOKEN_SOURCE="${tokenSource}"\n`;
// Render the proposed configuration from a temporary copy of the private file before touching the real one.
const probeEnv=envPath+'.render-'+randomBytes(6).toString('hex');
await writeFile(probeEnv,updated,{mode:0o600,flag:'wx'});
let rendered;
try{rendered=JSON.parse(d(['compose','--project-name',project,'--env-file',probeEnv,'-f','deployment/compose.owner-setup.yaml','-f','deployment/compose.agent.yaml','config','--format','json'],{env:composeEnvironment(image)}));}
finally{await unlink(probeEnv).catch(()=>{});}
const service=rendered.services.gateway;
refused(service.image===image&&service.read_only===true,'COMPOSE_IMAGE_OR_ISOLATION_CHANGED');
refused(Object.entries(environment).every(([key,value])=>String(service.environment[key])===value||!key.startsWith('RDG_')),'COMPOSE_ENVIRONMENT_CHANGED');
refused(agentKeys.every(key=>key in service.environment)&&service.environment.RDG_AGENT_ENABLED==='false','COMPOSE_AGENT_SETTINGS_WRONG');
refused(Object.keys(service.environment).filter(key=>key.startsWith('RDG_')&&!agentKeys.includes(key)).every(key=>key in environment),'COMPOSE_UNEXPECTED_VARIABLE');
const renderedToken=service.volumes.find(volume=>volume.target==='/run/secrets/rdg_agent_token');
refused(renderedToken?.type==='bind'&&renderedToken.read_only===true&&renderedToken.source===tokenSource&&service.volumes.length===4,'COMPOSE_TOKEN_MOUNT_WRONG');
refused(JSON.parse(d(['image','inspect',rendered.services.guacd.image]))[0].Id===inspect(guacd).Image,'GUACD_IMAGE_CHANGED');
if(process.argv.includes('--preflight-only')){console.log(JSON.stringify({status:'PREFLIGHT_OK',image,previousImage,activeUpstreamConnections:activeUpstream,otherContainers:otherNames.length,webVersion:release.version,webBuild:release.build,sourceCommit}));process.exit(0);}
const backup=await open(rollbackPath,'wx',0o600);try{await backup.writeFile(original);await backup.sync();}finally{await backup.close();}

// ---- apply, verify, and roll back automatically on any failure ---------------------------------------------------------------
async function rollBack(reason){
  console.log(JSON.stringify({status:'ROLLING_BACK',failure:reason}));
  await writeArtifact(receiptPath,JSON.stringify({status:'ROLLING_BACK',failure:reason,recordedAt:new Date().toISOString(),sourceCommit,attemptedImage:image,previousImage,rollbackEnvironmentPath:rollbackPath},null,2)+'\n').catch(()=>{});
  const outcome={status:'ROLLED_BACK',failure:reason,recordedAt:new Date().toISOString(),sourceCommit,attemptedImage:image,previousImage,rollbackEnvironmentPath:rollbackPath};
  try{
    await atomicPrivate(envPath,original);
    d([...composeBase,'up','-d','--no-deps','--pull','never','gateway'],{env:composeEnvironment(previousImage)});
    const restored=await healthy(gateway,previousImage,90);
    outcome.previousGatewayHealthy=Boolean(restored);outcome.previousEnvironmentRestored=(await readFile(envPath,'utf8'))===original;
    if(!restored)outcome.status='ROLLBACK_FAILED';
  }catch(error){outcome.status='ROLLBACK_FAILED';outcome.rollbackError=String(error.message).slice(0,200);}
  await writeArtifact(receiptPath,JSON.stringify(outcome,null,2)+'\n');
  console.log(JSON.stringify({status:outcome.status,failure:reason}));
  process.exit(1);
}
let after;
try{
  await atomicPrivate(envPath,updated);
  const composeResult=d([...composeAgent,'up','-d','--no-deps','--pull','never','gateway'],{env:composeEnvironment(image)});
  refused(!composeResult.includes('Error'),'COMPOSE_REPLACEMENT_FAILED');
  after=await healthy(gateway,image,60);
  refused(after,'DEPLOYED_GATEWAY_NOT_HEALTHY');
  refused(same(byKey(envMap(after)),byKey({...environment,...Object.fromEntries(agentKeys.map(key=>[key,service.environment[key]]))})),'GATEWAY_ENVIRONMENT_UNEXPECTED');
  refused(after.Config.Env.includes('RDG_AGENT_ENABLED=false'),'AGENT_NOT_OFF');
  refused(same(mounts(after),sortedMounts([...approvedMounts,tokenMount]))&&same(after.HostConfig.PortBindings,priorPorts),'MOUNTS_OR_PORTS_CHANGED');
  refused(after.Config.User==='10001:10001'&&after.HostConfig.ReadonlyRootfs===true,'NONROOT_READONLY_REQUIRED');
  refused(otherNames.every(name=>same(fingerprint(inspect(name)),preserved[name])),'UNRELATED_CONTAINER_CHANGED');
  const runtimeHashes=Object.fromEntries(d(['exec',gateway,'sha256sum',...Object.keys(paths)]).split('\n').map(row=>{const [hash,path]=row.split(/\s+/);return [path,hash];}));
  refused(same(runtimeHashes,hashes),'DEPLOYED_ARTIFACT_MISMATCH');
  // The container's stderr (where a startup refusal is written) comes back on docker's stderr, so read both.
  const logs=spawnSync('docker',[...docker,'logs',gateway],{encoding:'utf8',maxBuffer:8*1024*1024}),log=(logs.stdout??'')+(logs.stderr??'');
  const tokenView=d(['exec',gateway,'stat','-c','%a %u:%g %s',tokenMount.Destination]);
  refused(tokenView==='600 10001:10001 43','TOKEN_INSIDE_GATEWAY_UNEXPECTED');
  refused(await fetch('http://127.0.0.1:32120/health').then(response=>response.status===200,()=>false),'LOOPBACK_HEALTH_FAILED');
  // Informational: the public edge still answers with the Access login, same as before. Not a gate (it depends on the network).
  const edge=await fetch('https://remote.gmb01.xyz/',{redirect:'manual'}).then(response=>({status:response.status,locationHost:response.headers.get('location')?new URL(response.headers.get('location')).host:null}),()=>({status:null,locationHost:null}));
  const receipt={status:'DEPLOYED_AGENT_OFF_LOCAL_RUNTIME_VERIFIED',recordedAt:new Date().toISOString(),sourceCommit,branch,webVersion:release.version,webBuild:release.build,url:'https://remote.gmb01.xyz',image,previousImage,containerId:after.Id,health:after.State.Health.Status,architecture:'linux/arm64',
    activeUpstreamConnectionsBeforeReplacement:activeUpstream,agentEnabled:false,agentSettingsAdded:agentKeys,tokenMountedReadOnly:true,tokenInsideGateway:{mode:'600',owner:'10001:10001',bytes:43},tokenValueRecorded:false,
    gatewayStartedReady:log.includes('RDG gateway ready'),gatewayRefusedStartup:log.includes('RDG startup refused'),onlyPrivateEnvironmentChange:['GATEWAY_IMAGE','RDG_AGENT_ENABLED','RDG_AGENT_TOKEN_SOURCE'],
    stateAndKeyMountsPreserved:true,unrelatedContainersPreserved:true,preservedContainerCount:otherNames.length,rollbackEnvironmentSaved:true,rollbackEnvironmentPath:rollbackPath,gatewayLoopbackOnly:true,
    publicEdgeAfterDeploy:edge,artifactHashes:hashes,accessPolicyChanged:false,tunnelConfigChanged:false,realDesktopVerified:false,agentExercised:false,newVulnerabilityScanPerformed:false};
  refused(receipt.gatewayStartedReady&&!receipt.gatewayRefusedStartup,'GATEWAY_LOG_UNEXPECTED');
  await writeArtifact(receiptPath,JSON.stringify(receipt,null,2)+'\n');
  console.log(JSON.stringify({status:receipt.status,webVersion:release.version,webBuild:release.build,image,containerId:after.Id,health:after.State.Health.Status,preservedContainers:otherNames.length,agentEnabled:false,publicEdgeAfterDeploy:edge}));
}catch(error){await rollBack(String(error.message).slice(0,120));}
