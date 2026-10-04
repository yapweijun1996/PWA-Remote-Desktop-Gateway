import {execFileSync} from 'node:child_process';
import {readFile,lstat,open,rename,unlink} from 'node:fs/promises';
import {createHash,randomBytes} from 'node:crypto';
import {writeArtifact} from '../../../scripts/atomic-artifact.mjs';

const docker=['--host','unix:///Users/yapweijun/.docker/run/docker.sock'];
const image='sha256:d9ccc9b0daa7f816c4c4578db74637cdee7ce9369b646b29f7959328841a584b';
const previousImage='sha256:513fe8ebfbd6c71dd4578e8e7919d7fdf386138b74217f321448c9f401ab7c7b';
const gateway='rdg-current-mac-pilot-gateway-1',project='rdg-current-mac-pilot';
const envPath='/Users/yapweijun/.cloudflared/rdg-current-mac-pilot/owner-setup.env';
const rollback=envPath+'.before-pwa-1.1.0-20261004';
const receiptPath='qa/implementation/pwa-20261004/deployment.json';
function refused(condition,code){if(!condition)throw new Error(code);}
function run(command,args,options={}){
  try{return execFileSync(command,args,{encoding:'utf8',maxBuffer:8*1024*1024,timeout:120000,stdio:['ignore','pipe','pipe'],...options}).trim();}
  catch{throw new Error('BOUNDED_LOCAL_COMMAND_FAILED');}
}
const d=(args,options)=>run('docker',[...docker,...args],options);
const inspect=name=>JSON.parse(d(['inspect',name]))[0];
const envMap=container=>Object.fromEntries([...container.Config.Env].sort().map(value=>{const at=value.indexOf('=');return [value.slice(0,at),value.slice(at+1)];}));
const fingerprint=container=>({id:container.Id,image:container.Image,startedAt:container.State.StartedAt});
const mounts=container=>container.Mounts.map(({Type,Source,Destination,RW})=>({Type,Source,Destination,RW})).sort((a,b)=>a.Destination.localeCompare(b.Destination));
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
async function atomicPrivate(target,data){
  const temp=target+'.pwa-'+randomBytes(12).toString('hex');let handle;
  try{handle=await open(temp,'wx',0o600);await handle.writeFile(data);await handle.sync();await handle.close();handle=null;await rename(temp,target);const folder=await open(target.slice(0,target.lastIndexOf('/')),'r');try{await folder.sync();}finally{await folder.close();}}
  finally{await handle?.close();await unlink(temp).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
const paths={'/app/rdg-gateway.jar':'gateway/target/rdg-gateway.jar','/app/web/sw.js':'web/dist/sw.js','/app/web/index.html':'web/dist/index.html','/app/web/build.json':'web/dist/build.json'};
const hashes=Object.fromEntries(await Promise.all(Object.entries(paths).map(async([target,local])=>[target,createHash('sha256').update(await readFile(local)).digest('hex')])));
const release=JSON.parse(await readFile('web/dist/build.json','utf8'));
refused(release.version==='1.1.0'&&release.build==='083af71ae2cdaf38','BUILD_IDENTITY_CHANGED');
const sourceCommit=run('git',['rev-parse','HEAD']);
refused(run('git',['branch','--show-current'])==='codex/deploy-current-pc-20261004','DEDICATED_BRANCH_REQUIRED');
refused(run('git',['diff','--name-only'])==='','TRACKED_SOURCE_CHANGED');
const before=inspect(gateway),environment=envMap(before);
refused(before.Image===previousImage&&before.State.Health?.Status==='healthy','EXISTING_GATEWAY_CHANGED');
refused(environment.RDG_DESKTOP_POLICY==='OWNER_SETUP'&&environment.RDG_TRUSTED_DEVICES_ENABLED==='true','INHERITED_POLICY_CHANGED');
const priorPorts=before.HostConfig.PortBindings;
refused(same(priorPorts,{'8080/tcp':[{HostIp:'127.0.0.1',HostPort:'32120'}]}),'GATEWAY_LOOPBACK_REQUIRED');
const imageInfo=JSON.parse(d(['image','inspect',image]))[0];
refused(imageInfo.Id===image&&imageInfo.Architecture==='arm64'&&imageInfo.Os==='linux','IMAGE_IDENTITY_REFUSED');
const imageHashes=Object.fromEntries(d(['run','--rm','--network','none','--entrypoint','sha256sum',image,...Object.keys(paths)]).split('\n').map(row=>{const [hash,path]=row.split(/\s+/);return [path,hash];}));
refused(same(imageHashes,hashes),'EXACT_IMAGE_ARTIFACT_MISMATCH');
const otherNames=d(['ps','--format','{{.Names}}']).split('\n').filter(name=>name!==gateway);
refused(otherNames.includes('rdg-current-mac-pilot-guacd-1')&&otherNames.length===9,'PRESERVED_SERVICE_INVENTORY_CHANGED');
const preserved=Object.fromEntries(otherNames.map(name=>[name,fingerprint(inspect(name))]));
const rawNet=d(['exec',gateway,'sh','-c','cat /proc/net/tcp /proc/net/tcp6']);
const activeUpstream=rawNet.split('\n').filter(row=>{const fields=row.trim().split(/\s+/);return fields[3]==='01'&&fields[2]?.endsWith(':12D6');}).length;
refused(activeUpstream===0,'ACTIVE_DESKTOP_UPSTREAM_BLOCKS_REPLACEMENT');
const metadata=await lstat(envPath);refused(metadata.isFile()&&!metadata.isSymbolicLink()&&metadata.uid===process.getuid()&&(metadata.mode&0o777)===0o600,'PRIVATE_ENV_FILE_REQUIRED');
const original=await readFile(envPath,'utf8');
refused(original.split('\n').filter(row=>row.startsWith('GATEWAY_IMAGE=')).length===1,'IMAGE_ASSIGNMENT_AMBIGUOUS');
const updated=original.replace(/^GATEWAY_IMAGE=.*$/m,'GATEWAY_IMAGE='+image);
const compose=['compose','--project-name',project,'--env-file',envPath,'-f','deployment/compose.owner-setup.yaml'];
const composeEnvironment={...process.env,GATEWAY_IMAGE:image};delete composeEnvironment.DOCKER_CONTEXT;
const config=JSON.parse(d([...compose,'config','--format','json'],{env:composeEnvironment}));
const service=config.services.gateway;
refused(service.image===image&&service.read_only===true,'COMPOSE_IMAGE_OR_ISOLATION_CHANGED');
refused(Object.entries(service.environment).every(([key,value])=>String(value)===environment[key]),'COMPOSE_ENVIRONMENT_CHANGED');
refused(Object.keys(environment).filter(key=>key.startsWith('RDG_')).every(key=>Object.hasOwn(service.environment,key)),'COMPOSE_RDG_ENVIRONMENT_MISSING');
refused(JSON.parse(d(['image','inspect',config.services.guacd.image]))[0].Id===inspect('rdg-current-mac-pilot-guacd-1').Image,'GUACD_IMAGE_CHANGED');
const backup=await open(rollback,'wx',0o600);try{await backup.writeFile(original);await backup.sync();}finally{await backup.close();}
refused((await readFile(envPath,'utf8'))===original,'PRIVATE_ENV_CHANGED_DURING_PREFLIGHT');
await atomicPrivate(envPath,updated);
const composeResult=d([...compose,'up','-d','--no-deps','--pull','never','gateway'],{env:composeEnvironment});
refused(!composeResult.includes('Error'),'COMPOSE_REPLACEMENT_FAILED');
let after;
const until=Date.now()+60000;
do{after=inspect(gateway);if(after.State.Health?.Status==='healthy')break;await new Promise(resolve=>setTimeout(resolve,1000));}while(Date.now()<until);
refused(after.Image===image&&after.State.Health?.Status==='healthy','DEPLOYED_GATEWAY_NOT_HEALTHY');
refused(same(envMap(after),environment),'GATEWAY_ENVIRONMENT_CHANGED');
refused(same(mounts(after),mounts(before))&&same(after.HostConfig.PortBindings,priorPorts),'MOUNTS_OR_PORTS_CHANGED');
refused(after.Config.User==='10001:10001'&&after.HostConfig.ReadonlyRootfs===true,'NONROOT_READONLY_REQUIRED');
refused(otherNames.every(name=>same(fingerprint(inspect(name)),preserved[name])),'UNRELATED_CONTAINER_CHANGED');
const runtimeHashes=Object.fromEntries(d(['exec',gateway,'sha256sum',...Object.keys(paths)]).split('\n').map(row=>{const [hash,path]=row.split(/\s+/);return [path,hash];}));
refused(same(runtimeHashes,hashes),'DEPLOYED_ARTIFACT_MISMATCH');
const receipt={status:'DEPLOYED_LOCAL_RUNTIME_VERIFIED',recordedAt:new Date().toISOString(),sourceCommit,webVersion:release.version,webBuild:release.build,url:'https://remote.gmb01.xyz',image,previousImage,containerId:after.Id,health:after.State.Health.Status,architecture:'linux/arm64',activeUpstreamConnectionsBeforeReplacement:activeUpstream,gatewayEnvironmentUnchanged:true,onlyPrivateEnvironmentChange:'GATEWAY_IMAGE',stateAndKeyMountsPreserved:true,unrelatedContainersPreserved:true,preservedContainerCount:otherNames.length,rollbackEnvironmentSaved:true,rollbackEnvironmentPath:rollback,gatewayLoopbackOnly:true,artifactHashes:hashes,accessPolicyChanged:false,tunnelConfigChanged:false,realDesktopVerified:false,newVulnerabilityScanPerformed:false};
await writeArtifact(receiptPath,JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify({status:receipt.status,webVersion:release.version,webBuild:release.build,image,containerId:after.Id,health:after.State.Health.Status,preservedContainers:otherNames.length}));
