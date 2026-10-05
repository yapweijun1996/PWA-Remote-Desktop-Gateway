/**
 * Stage 2 S4(a): proves, before anything is deployed, that the candidate gateway image starts with the agent token mounted the
 * way deployment/compose.agent.yaml mounts it, and that every bad token setup makes the gateway refuse to start. It never
 * touches the running gateway, its volumes, its network or any other container: it uses throwaway volumes, no network, and removes
 * everything it created. It never prints the token or any identity value; only modes, owners, sizes, booleans and exit codes.
 */
import {execFileSync,spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdtempSync,rmSync,statSync,chmodSync} from 'node:fs';
import {tmpdir,homedir} from 'node:os';import path from 'node:path';import {randomBytes} from 'node:crypto';
import {writeArtifact} from '../../../scripts/atomic-artifact.mjs';

const live='rdg-current-mac-pilot-gateway-1',candidate='rdg-gateway-agent-candidate:s4a',tokenPath=path.join(homedir(),'Library/Application Support/RDG/agent.token');
const envPath=path.join(homedir(),'.cloudflared/rdg-current-mac-pilot/owner-setup.env'),project='rdg-current-mac-pilot';
const names={state:'rdg-s4a-check-state',key:'rdg-s4a-check-key',ok:'rdg-s4a-check-ok'};
const refused=(condition,code)=>{if(!condition)throw new Error(code);};
const docker=(args,options={})=>execFileSync('docker',args,{encoding:'utf8',maxBuffer:8*1024*1024,timeout:120000,stdio:['ignore','pipe','pipe'],...options}).trim();
const tryDocker=(args)=>{try{return {code:0,out:docker(args)};}catch(error){return {code:error.status??1,out:String(error.stdout??'')+String(error.stderr??'')};}};
const inspect=name=>JSON.parse(docker(['inspect',name]))[0];
// `docker logs` replays the container's stderr on its own stderr, and the startup refusal is written there.
const logsOf=name=>{const result=spawnSync('docker',['logs',name],{encoding:'utf8',maxBuffer:8*1024*1024});return (result.stdout??'')+(result.stderr??'');};
const fingerprint=container=>({id:container.Id,image:container.Image,startedAt:container.State.StartedAt,status:container.State.Status});
const results=[],dir=mkdtempSync(path.join(tmpdir(),'rdg-s4a-')),cleanups=[];
const record=(name,ok,detail={})=>{results.push({name,ok,...detail});console.log(`${ok?'PASS':'FAIL'}  ${name}${Object.keys(detail).length?'  '+JSON.stringify(detail):''}`);};

try {
  // ---- the running deployment must not change -----------------------------------------------------------------------
  const before=inspect(live);
  const others=docker(['ps','--format','{{.Names}}']).split('\n').filter(name=>name!==live);
  const preserved=Object.fromEntries(others.map(name=>[name,fingerprint(inspect(name))]));
  const liveEnv=Object.fromEntries(before.Config.Env.map(row=>{const at=row.indexOf('=');return [row.slice(0,at),row.slice(at+1)];}));
  const deviceMount=before.Mounts.find(mount=>mount.Destination==='/app/config/device.json');
  refused(deviceMount&&liveEnv.RDG_DESKTOP_POLICY==='OWNER_SETUP','LIVE_GATEWAY_SHAPE_UNEXPECTED');
  const deviceConfig=deviceMount.Source.replace(/^\/host_mnt(?=\/)/,'');

  // ---- the token file on this Mac ---------------------------------------------------------------------------------------
  const info=statSync(tokenPath),text=readFileSync(tokenPath,'utf8');
  record('host token file is regular, owner-only, 43 base64url characters',info.isFile()&&(info.mode&0o777)===0o600&&info.uid===process.getuid()&&/^[A-Za-z0-9_-]{43}$/.test(text.trim()),{mode:(info.mode&0o777).toString(8),bytes:info.size});

  // ---- compose merge: the override adds exactly the agent settings ------------------------------------------------------
  const composeFiles=['-f','deployment/compose.owner-setup.yaml','-f','deployment/compose.agent.yaml'];
  const composeEnv={...process.env,GATEWAY_IMAGE:candidate,RDG_AGENT_TOKEN_SOURCE:tokenPath};delete composeEnv.DOCKER_CONTEXT;
  const render=files=>JSON.parse(docker(['compose','--project-name',project,'--env-file',envPath,...files,'config','--format','json'],{env:composeEnv})).services.gateway;
  const base=render(['-f','deployment/compose.owner-setup.yaml']),merged=render(composeFiles);
  const added=Object.keys(merged.environment).filter(key=>!(key in base.environment)).sort();
  const tokenMount=merged.volumes.find(volume=>volume.target==='/run/secrets/rdg_agent_token');
  record('override adds only the four agent variables and one read-only token bind that must exist',
    JSON.stringify(added)===JSON.stringify(['RDG_AGENT_ENABLED','RDG_AGENT_HOST','RDG_AGENT_PORT','RDG_AGENT_TOKEN_FILE'])&&merged.volumes.length===base.volumes.length+1
    &&tokenMount?.type==='bind'&&tokenMount.read_only===true&&tokenMount.bind?.create_host_path!==true&&tokenMount.source===tokenPath,{added,mounts:merged.volumes.length,tokenMount:tokenMount&&{type:tokenMount.type,read_only:tokenMount.read_only,bind:tokenMount.bind,sourceMatches:tokenMount.source===tokenPath}});
  record('every other service setting is identical with and without the override',
    JSON.stringify({...merged,environment:null,volumes:null})===JSON.stringify({...base,environment:null,volumes:null})
    &&JSON.stringify(base.volumes)===JSON.stringify(merged.volumes.filter(volume=>volume.target!=='/run/secrets/rdg_agent_token')));

  // The rendered config drops `create_host_path: false` (it is the zero value), so prove the behaviour itself in a throwaway project:
  // a missing token source must stop container creation and must not create anything on the host.
  const probeDir=path.join(dir,'compose-probe'),missing=path.join(probeDir,'absent','token');
  execFileSync('mkdir',['-p',probeDir]);
  writeFileSync(path.join(probeDir,'compose.yaml'),`name: rdg-s4a-compose-probe\nservices:\n  probe:\n    image: ${candidate}\n    entrypoint: ["true"]\n    volumes:\n      - type: bind\n        source: ${missing}\n        target: /run/secrets/rdg_agent_token\n        read_only: true\n        bind:\n          create_host_path: false\n`);
  cleanups.push(()=>tryDocker(['compose','-f',path.join(probeDir,'compose.yaml'),'down','-v']));
  const probe=tryDocker(['compose','-f',path.join(probeDir,'compose.yaml'),'up','--no-start']);
  let created=true;try{statSync(path.dirname(missing));}catch{created=false;}
  record('compose refuses to create the container when the token file is missing and creates nothing on the host',probe.code!==0&&/bind source path does not exist/.test(probe.out)&&!created,{exitCode:probe.code});

  // ---- run the candidate the way the compose file would, on throwaway state ------------------------------------------------
  for(const volume of [names.state,names.key])docker(['volume','create',volume]),cleanups.push(()=>tryDocker(['volume','rm','-f',volume]));
  // A private env file keeps identity values out of process arguments and out of this output.
  const envFile=path.join(dir,'candidate.env');
  const candidateEnv={...Object.fromEntries(Object.entries(liveEnv).filter(([key])=>key.startsWith('RDG_'))),RDG_STATE_DIR:'/var/lib/rdg',RDG_VNC_KEY_FILE:'/var/lib/rdg-key/vnc.key'};
  writeFileSync(envFile,Object.entries(candidateEnv).map(([key,value])=>`${key}=${value}`).join('\n')+'\n',{mode:0o600});
  const isolation=['--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--user','10001:10001','--tmpfs','/tmp:size=64m,uid=10001,gid=10001,mode=0700,noexec,nosuid','--pids-limit','128','--memory','512m'];
  const stateMounts=['--mount',`type=volume,source=${names.state},target=/var/lib/rdg`,'--mount',`type=volume,source=${names.key},target=/var/lib/rdg-key`,'--mount',`type=bind,source=${deviceConfig},target=/app/config/device.json,readonly`];
  const init=tryDocker(['run','--rm',...isolation,'--env-file',envFile,...stateMounts,candidate,'--init-vnc-key']);
  refused(init.code===0,'THROWAWAY_KEY_INIT_FAILED');
  const start=(name,agentEnv,tokenSource)=>{
    const extra=['-e','RDG_AGENT_ENABLED='+agentEnv.RDG_AGENT_ENABLED];
    for(const [key,value] of Object.entries(agentEnv))if(key!=='RDG_AGENT_ENABLED')extra.push('-e',`${key}=${value}`);
    const mount=tokenSource?['--mount',`type=bind,source=${tokenSource},target=/run/secrets/rdg_agent_token,readonly`]:[];
    docker(['rm','-f',name].filter(Boolean),{stdio:['ignore','pipe','pipe']}).toString();
    return tryDocker(['run','-d','--name',name,...isolation,'--env-file',envFile,...extra,...stateMounts,...mount,candidate]);
  };
  const settle=async(name)=>{for(let i=0;i<60;i++){const state=inspect(name).State;if(!state.Running)return state;if(logsOf(name).includes('RDG gateway ready'))return state;await new Promise(r=>setTimeout(r,500));}return inspect(name).State;};
  const enabled={RDG_AGENT_ENABLED:'true',RDG_AGENT_HOST:'host.docker.internal',RDG_AGENT_PORT:'5960',RDG_AGENT_TOKEN_FILE:'/run/secrets/rdg_agent_token'};
  const classify=(name)=>{const log=logsOf(name);return {ready:log.includes('RDG gateway ready'),refused:log.includes('RDG startup refused: CONFIGURATION_OR_RUNTIME_INVALID'),leakedToken:log.includes(text.trim())};};

  // positive: the real token, mounted as the override mounts it
  cleanups.push(()=>tryDocker(['rm','-f',names.ok]));
  const started=start(names.ok,enabled,tokenPath);refused(started.code===0,'CANDIDATE_DID_NOT_START: '+started.out.slice(0,200));
  const state=await settle(names.ok),logs=classify(names.ok),health=tryDocker(['exec',names.ok,'java','-Xmx32m','-jar','/app/rdg-gateway.jar','--health']);
  record('candidate with the agent enabled and the real token mounted starts and reports healthy',state.Running&&logs.ready&&!logs.refused&&health.code===0,{running:state.Running,ready:logs.ready,healthExit:health.code});
  record('the token never appears in the gateway output',logs.leakedToken===false);
  const config=inspect(names.ok).Config;
  record('it runs as 10001:10001 with a read-only root and no network',config.User==='10001:10001'&&inspect(names.ok).HostConfig.ReadonlyRootfs===true&&inspect(names.ok).HostConfig.NetworkMode==='none');
  docker(['rm','-f',names.ok]);

  // control: flag off and no token mounted is today's behaviour and must still start
  const control='rdg-s4a-check-off';cleanups.push(()=>tryDocker(['rm','-f',control]));
  const off=start(control,{RDG_AGENT_ENABLED:'false'},null);refused(off.code===0,'CONTROL_DID_NOT_START');
  const offState=await settle(control);record('with the flag off and no token the gateway starts exactly as before (VNC only)',offState.Running&&classify(control).ready);docker(['rm','-f',control]);

  // negative: each bad setup must stop the gateway from starting (which is also why the rollback must cover it)
  const bad=(label,tokenSource,agentEnv=enabled)=>async()=>{
    const name='rdg-s4a-check-bad';cleanups.push(()=>tryDocker(['rm','-f',name]));
    const run=start(name,agentEnv,tokenSource);const state=run.code===0?await settle(name):{Running:false,ExitCode:-1};
    const log=run.code===0?classify(name):{refused:false,ready:false};
    record(`refuses to start: ${label}`,run.code===0&&!state.Running&&state.ExitCode!==0&&log.refused&&!log.ready,{exitCode:state.ExitCode});
    tryDocker(['rm','-f',name]);
  };
  const group=path.join(dir,'group-readable');writeFileSync(group,randomBytes(32).toString('base64url'));chmodSync(group,0o644);
  const short=path.join(dir,'short');writeFileSync(short,randomBytes(16).toString('base64url'),{mode:0o600});
  const junk=path.join(dir,'junk');writeFileSync(junk,'not a token '.repeat(5),{mode:0o600});
  await bad('token readable by group and others',group)();
  await bad('token of the wrong length',short)();
  await bad('token that is not base64url',junk)();
  await bad('no token mounted at all',null)();
  await bad('token path outside /run/secrets',tokenPath,{...enabled,RDG_AGENT_TOKEN_FILE:'/tmp/token'})();
  await bad('agent host outside the local boundary',tokenPath,{...enabled,RDG_AGENT_HOST:'192.0.2.7'})();

  // ---- nothing else moved ---------------------------------------------------------------------------------------------------
  const after=inspect(live);
  record('the running gateway is the same container, image and start time',JSON.stringify(fingerprint(after))===JSON.stringify(fingerprint(before))&&after.State.Health?.Status==='healthy');
  record('no other container changed',others.every(name=>JSON.stringify(fingerprint(inspect(name)))===JSON.stringify(preserved[name])));
}catch(error){
  record('check ran to completion',false,{error:String(error.message).slice(0,300)});
}finally{
  for(const cleanup of cleanups.reverse())cleanup();
  rmSync(dir,{recursive:true,force:true});
  const leftovers=tryDocker(['ps','-a','--filter','name=rdg-s4a','--format','{{.Names}}']).out+tryDocker(['network','ls','--filter','name=rdg-s4a','--format','{{.Name}}']).out+tryDocker(['volume','ls','--filter','name=rdg-s4a-check','--format','{{.Name}}']).out;
  record('every throwaway container and volume is removed',leftovers.trim()==='');
  await writeArtifact('qa/implementation/stage2-s4a-20261005/agent-startup-check.json',JSON.stringify({recordedAt:new Date().toISOString(),candidate:{image:candidate,id:inspectId()},results},null,2)+'\n');
  console.log(`${results.filter(r=>r.ok).length}/${results.length} passed`);
  process.exit(results.every(r=>r.ok)?0:1);
}
function inspectId(){try{return docker(['image','inspect',candidate,'--format','{{.Id}}']);}catch{return null;}}
