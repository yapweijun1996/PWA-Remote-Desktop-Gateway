import {GatewayAPI} from './api.mjs';
import {DesktopAdapter} from './adapter.mjs';
import {setupUpdates} from './pwa.mjs';
import {release} from './release.mjs';
import {t,applyTranslations,onLocaleChange,formatDate,TRANSLATIONS} from './i18n.mjs';
import {setupPreferences} from './preferences.mjs';
import {NetworkHealth,connectionAssessment} from './connection-health.mjs';

const $=id=>document.getElementById(id),api=new GatewayAPI();
let adapter=null,desktopIntentId=null,recoveryIntentId=null,device=null,diag=null,nodeId='',epoch=0,busy=false,update=null,updateSetup=false;
let credentialSaving=false,trustedDevicesEnabled=false,trustedLoading=false,enrollmentRequired=false;
const desktopBlockedMessage='notice.desktopBlocked';
const platform=/Mac/.test(navigator.platform)?'mac':'windows';
const messages=new Map();
let diagnosticsRequest=0,clipboardActivity=0;
let activeDisplayQuality=null,metricsTimer=null,latencyRequest=0;
const networkHealth=new NetworkHealth();let nextNetworkProbe=0;
const displayQualities=['low','balanced','clear'];
function cancelNetworkProbe(){
  ++latencyRequest;if($('measureNetwork').disabled)setMessage('networkLatency','network.unavailable');$('measureNetwork').disabled=false;
}
function clearNetworkMeasurements(){
  clearInterval(metricsTimer);metricsTimer=null;++latencyRequest;activeDisplayQuality=null;
  networkHealth.clear();$('liveNetwork').checked=false;
  for(const id of ['transportMetrics','networkLatency','activeDisplayQuality','frameMetrics','connectionHealth','networkSummary','connectionAdvice']){messages.delete($(id));$(id).textContent='';}
  $('measureNetwork').disabled=false;$('applyDisplayQuality').disabled=true;
}
function renderNetworkMeasurements(){
  if(!adapter||!$('workspaceMenu').open)return;
  const stats=adapter.stats?.();
  setMessage('activeDisplayQuality','network.active',()=>({mode:t(activeDisplayQuality?'network.'+activeDisplayQuality:'network.unavailable')}));
  if(!stats){setMessage('transportMetrics','network.unavailable');return;}
  const number=(value,divisor=1)=>Number.isFinite(value)?(value/divisor).toFixed(1):t('network.unavailable');
  setMessage('transportMetrics','network.transfer',{down:number(stats.inboundBytesPerSecond,1024),up:number(stats.outboundBytesPerSecond,1024),window:number(stats.rateWindowMs,1000),elapsed:number(stats.elapsedMs,1000),received:number(stats.inboundBytes,1048576),sent:number(stats.outboundBytes,1024),first:number(stats.firstDisplayMs),lag:number(stats.processingLagMs)});
  const fps=value=>Number.isFinite(value)?value.toFixed(1):'—',network=networkHealth.snapshot();
  setMessage('frameMetrics','network.fps',{client:fps(stats.display?.clientFps),server:fps(stats.display?.serverFps),desktop:fps(stats.display?.desktopFps)});
  setMessage('connectionHealth','network.health',()=>({state:t('network.state.'+(!navigator.onLine?'offline':network.state)),transport:t('network.transport.'+(stats.tunnelState??'unknown'))}));
  setMessage('networkSummary','network.samples',{count:network.count,average:fps(network.averageMs),jitter:fps(network.jitterMs)});
  setMessage('connectionAdvice','network.advice.'+connectionAssessment({online:navigator.onLine,hidden:document.hidden,tunnelState:stats.tunnelState,network,stats}));
  if($('liveNetwork').checked&&!document.hidden&&!$('measureNetwork').disabled&&performance.now()>=nextNetworkProbe){nextNetworkProbe=performance.now()+5000;void measureNetwork();}
}
function loadDisplayQuality(){
  let value='balanced';try{const stored=localStorage.getItem(`rdg:quality:${nodeId}`);if(displayQualities.includes(stored))value=stored;}catch{}
  $('displayQuality').value=value;$('liveDisplayQuality').value=value;
}
function rememberDisplayQuality(){try{localStorage.setItem(`rdg:quality:${nodeId}`,$('displayQuality').value);}catch{}}
function pruneMessages(){for(const node of messages.keys())if(!node.isConnected)messages.delete(node);}
function setMessage(id,key,params={}){const node=typeof id==='string'?$(id):id;if(!node)return;messages.set(node,{key,params});node.textContent=t(key,typeof params==='function'?params():params);}
function state(value,message,params={}){const known=Object.hasOwn(TRANSLATIONS.en,'status.'+value)?value:'ERROR';$('status').dataset.state=known;setMessage('status','status.'+known);setMessage('notice',message??'status.'+known,params);}
function syncConnectButton(){$('connect').disabled=busy||!device||!$('consent').checked||diag?.desktopEnabled===false;}

let versionMetadata={current:release,target:null};
function renderVersion(metadata){
  versionMetadata=metadata;
  setMessage('versionLabel','version.full',()=>({version:metadata.current.version,build:metadata.current.build.slice(0,7)}));setMessage('preferencesVersion','version.full',()=>({version:metadata.current.version,build:metadata.current.build.slice(0,7)}));
  setMessage('updateVersion',metadata.target?'version.transition':'version.current',()=>({version:metadata.current.version,target:metadata.target?.version??'',build:metadata.target?.build.slice(0,7)??''}));
  setMessage('update',metadata.target?'update.buttonVersion':'update.button',()=>({version:metadata.target?.version??''}));
}
function updateState(value,quiet=false){
  $('updateBanner').dataset.state=value;
  const keys={CHECKING_UPDATE:'update.checking',UP_TO_DATE:'update.upToDate',UPDATE_AVAILABLE:'update.available',UPDATE_DEFERRED:'update.deferred',UPDATING:'update.updating',RELOADING:'update.reloading',UPDATE_FAILED:'update.failed',UPDATE_UNAVAILABLE:'update.unavailable'};
  setMessage('updateLabel',keys[value]??'update.failed');setMessage('updateCheckStatus',keys[value]??'update.failed');
  const working=['CHECKING_UPDATE','UPDATING','RELOADING'].includes(value);
  $('checkUpdates').disabled=working;$('update').disabled=working;
  $('loader').hidden=!['UPDATING','RELOADING'].includes(value);setMessage('loader',keys[value]??'update.updating');
  if(value!=='UP_TO_DATE'&&!quiet)$('updateBanner').hidden=false;else if(!versionMetadata.target)$('updateBanner').hidden=true;
  if($('updateBanner').hidden){delete $('moreBtn').dataset.updateDescription;$('moreBtn').removeAttribute('aria-description');}
  else{$('moreBtn').dataset.updateDescription=keys[value]??'update.available';$('moreBtn').setAttribute('aria-description',t($('moreBtn').dataset.updateDescription));}
}

function closeWorkspaceMenu(restoreFocus=false){
  clearInterval(metricsTimer);metricsTimer=null;cancelNetworkProbe();
  const wasOpen=$('workspaceMenu').open;if(wasOpen)$('workspaceMenu').close();$('moreBtn').setAttribute('aria-expanded','false');
  if(wasOpen&&restoreFocus&&document.body.classList.contains('viewing'))$('moreBtn').focus();
}
function workspaceLayout(viewing){
  closeWorkspaceMenu();document.body.classList.toggle('viewing',viewing);
  $(viewing?'workspaceAccount':'launcherAccount').append($('logout'));
  $(viewing?'workspaceStatus':'launcherStatus').append($('connectionSummary'));
  $(viewing?'workspacePreferences':'launcherPreferences').append($('preferencesBtn'));
  $(viewing?'workspaceUpdates':'launcherUpdates').append($('updateBanner'));
  $('workspace').hidden=!viewing;$('launcher').hidden=viewing;
}
function updateWorkspaceIdentity(){
  $('workspaceName').textContent=device?.label??t('workspace.desktop');$('workspaceName').title=device?.label??t('workspace.desktop');
  const profile=$('profile').selectedOptions[0].textContent;$('workspaceProfile').textContent=profile;$('workspaceProfile').title=profile;
}
function clearCredentialInput(){$('desktopPassword').value='';}
function clearPrivate(){
  clearNetworkMeasurements();
  clearCredentialInput();desktopIntentId=null;recoveryIntentId=null;$('recoverConnection').hidden=true;diag=null;$('credentialSetup').hidden=true;$('changeCredential').hidden=true;
  messages.delete($('credentialStatus'));$('credentialStatus').textContent='';$('trustedDevicesBtn').hidden=true;$('workspaceTrustedDevices').hidden=true;$('trustedDevicesList').replaceChildren();messages.delete($('trustedDevicesStatus'));$('trustedDevicesStatus').textContent='';
  workspaceLayout(false);
  adapter?.disconnect();adapter=null;device=null;$('localText').value='';$('remoteText').value='';setMessage('clipboardStatus','app.clipboardStatus.clipboard_cleared');
  $('surface').replaceChildren();$('deviceList').replaceChildren();messages.delete($('diagnostics'));$('diagnostics').textContent='';$('history').replaceChildren();
  for(const d of document.querySelectorAll('dialog[open]'))d.close();
  $('workspace').hidden=true;$('launcher').hidden=false;$('prepare').hidden=true;pruneMessages();
}
function trustedLoginRequired(error){
  if(error?.message!=='TRUSTED_DEVICE_REQUIRED')return false;
  trustedDevicesEnabled=true;enrollmentRequired=true;++epoch;clearPrivate();busy=false;
  state('AUTH_REQUIRED','app.notice.sign_in_to_trust_this_browser');$('reauth').hidden=false;return true;
}
function rememberProfile(){try{localStorage.setItem(`rdg:profile:${nodeId}:${platform}`,$('profile').value);}catch{}}
function loadProfile(){let p=platform==='mac'?'mac-native':'windows-native';try{const stored=localStorage.getItem(`rdg:profile:${nodeId}:${platform}`);if(['mac-native','windows-native','windows-alt-command'].includes(stored))p=stored;}catch{}$('profile').value=p;$('liveProfile').value=p;updateProfileHelp();loadDisplayQuality();}
function ownerSetup(){return diag?.desktopPolicy==='OWNER_SETUP';}
function credentialSetupAllowed(){return ownerSetup()&&diag?.credentialSetupEnabled===true;}
function updateProfileHelp(){
  const semantics=t($('profile').value==='windows-alt-command'?'profile.altHelp':'profile.nativeHelp');
  $('profileHelp').textContent=(ownerSetup()?t('profile.standard'):'')+semantics;
}
function prepareDevice(item){
  device=item;$('prepare').hidden=false;$('consent').checked=false;syncConnectButton();
}
function renderCredentialSetup(){
  const allowed=credentialSetupAllowed(),configured=diag?.credentialConfigured===true;
  $('credentialSetup').hidden=!allowed||configured;$('changeCredential').hidden=!allowed||!configured;
  setMessage('credentialTitle',configured?'credential.changeTitle':'credential.setupTitle');
  $('cancelCredential').hidden=!configured;$('saveCredential').disabled=credentialSaving;
}
function sendCredential(){
  // GatewayAPI serializes synchronously; discard the extra password reference immediately.
  const body={password:$('desktopPassword').value};clearCredentialInput();
  const pending=api.request('/api/desktop/credential',{method:'POST',body});body.password='';return pending;
}
async function saveCredential(event){
  event.preventDefault();if(credentialSaving||busy||adapter||!credentialSetupAllowed()){clearCredentialInput();return;}
  if(!$('desktopPassword').value||$('desktopPassword').value.length>128||/[\r\n]/.test($('desktopPassword').value)){
    clearCredentialInput();setMessage('credentialStatus','app.credentialStatus.enter_a_valid_screen_sharing_vnc');return;
  }
  const request=epoch;credentialSaving=true;busy=true;$('saveCredential').disabled=true;setMessage('credentialStatus','app.credentialStatus.saving_desktop_password');
  try{
    const result=await sendCredential();if(request!==epoch)return;
    if(result?.credentialConfigured!==true)throw new Error('CREDENTIAL_STORE_UNAVAILABLE');
    await initialize();
  }catch(error){
    if(request!==epoch||trustedLoginRequired(error))return;
    const keys={INVALID_CREDENTIAL:'credential.invalid',CONTROL_BUSY:'credential.busy',CREDENTIAL_STORE_UNAVAILABLE:'credential.storeUnavailable'};
    setMessage('credentialStatus',keys[error.message]??'credential.storeFailed');
  }finally{clearCredentialInput();credentialSaving=false;$('saveCredential').disabled=false;if(request===epoch)busy=false;}
}
function displayExpiry(value){return formatDate(value);}
async function loadTrustedDevices(){
  if(trustedLoading||diag?.trustedDevicesEnabled!==true)return;
  const request=epoch;trustedLoading=true;setMessage('trustedDevicesStatus','app.trustedDevicesStatus.loading_trusted_devices');
  try{
    const result=await api.request('/api/trusted-devices');if(request!==epoch||!$('trustedDevicesDialog').open)return;
    if(!Array.isArray(result?.devices)||result.devices.length>100||result.devices.some(entry=>!entry||typeof entry.id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(entry.id)||typeof entry.expiresAt!=='string'||typeof entry.current!=='boolean'))throw new Error('INVALID_DEVICES');
    $('trustedDevicesList').replaceChildren();pruneMessages();
    for(const entry of result.devices){
      const item=document.createElement('li'),id=document.createElement('strong'),expiry=document.createElement('p'),button=document.createElement('button');
      setMessage(id,'trusted.entry',()=>({id:entry.id,current:entry.current?t('trusted.current'):''}));setMessage(expiry,'trusted.expires',()=>({date:displayExpiry(entry.expiresAt)}));
      button.type='button';button.className='danger';setMessage(button,'trusted.revoke');button.dataset.trustedId=entry.id;button.setAttribute('aria-label',t('trusted.revokeLabel',{id:entry.id}));
      button.onclick=()=>revokeTrustedDevice(entry,button);item.append(id,expiry,button);$('trustedDevicesList').append(item);
    }
    setMessage('trustedDevicesStatus',result.devices.length?'trusted.hint':'trusted.empty');
  }catch(error){if(request===epoch&&!trustedLoginRequired(error))setMessage('trustedDevicesStatus','app.trustedDevicesStatus.trusted_devices_are_unavailable_verify_access');}
  finally{trustedLoading=false;}
}
async function revokeTrustedDevice(entry,button){
  if(button.disabled||diag?.trustedDevicesEnabled!==true)return;
  const request=epoch;button.disabled=true;setMessage('trustedDevicesStatus','app.trustedDevicesStatus.revoking_trusted_device');
  try{
    await api.request('/api/trusted-devices/'+encodeURIComponent(entry.id),{method:'DELETE'});if(request!==epoch)return;
    if(entry.current){++epoch;api.csrf=null;clearPrivate();location.assign('/login');return;}
    await loadTrustedDevices();
  }catch(error){if(request===epoch&&!trustedLoginRequired(error)){button.disabled=false;setMessage('trustedDevicesStatus','app.trustedDevicesStatus.the_trusted_device_could_not_be');}}
}
async function initialize(){
  const request=++epoch;busy=true;clearPrivate();state(navigator.onLine?'AUTH_CHECK':'OFFLINE');$('reauth').hidden=true;
  try {
    const session=await api.bootstrap();if(request!==epoch)return;nodeId=session.nodeId;
    const [devices,diagnostics]=await Promise.all([api.request('/api/devices'),api.request('/api/diagnostics')]);
    if(request!==epoch)return;diag=diagnostics;trustedDevicesEnabled=diag.trustedDevicesEnabled===true;loadProfile();renderCredentialSetup();$('trustedDevicesBtn').hidden=!trustedDevicesEnabled;$('workspaceTrustedDevices').hidden=!trustedDevicesEnabled;
    for(const item of devices){
      const article=document.createElement('article');article.className='device';
      const title=document.createElement('h2');title.textContent=item.label;article.append(title);
      const blocked=item.kind==='local'&&(item.desktopEnabled===false||item.status==='BLOCKED');
      const needsCredential=credentialSetupAllowed()&&diag.credentialConfigured!==true;
      const info=document.createElement('p');setMessage(info,item.kind==='local'?(needsCredential?'device.passwordNeeded':blocked?'device.blocked':'device.reachable'):'device.unknown');article.append(info);
      if(item.kind==='local'){
        const time=document.createElement('small');setMessage(time,'device.checked',()=>({date:formatDate(item.checkedAt)}));article.append(time);
        const button=document.createElement('button');setMessage(button,'actions.prepare');button.className='primary';button.disabled=blocked;
        if(blocked){button.dataset.i18nTitle=needsCredential?'device.blockedPasswordTitle':desktopBlockedMessage;button.title=t(button.dataset.i18nTitle);const reason=document.createElement('p');setMessage(reason,needsCredential?'device.blockedPassword':'device.blockedReason');article.append(reason);}
        button.onclick=()=>{if(blocked)return;prepareDevice(item);};if(blocked)article.append(button);
        if(!blocked&&!device)prepareDevice(item);
      }else{const link=document.createElement('a');link.href=item.launchUrl;setMessage(link,'actions.openNode');link.rel='noreferrer';article.append(link);}
      $('deviceList').append(article);
    }
    enrollmentRequired=false;$('logout').hidden=false;
    const needsCredential=credentialSetupAllowed()&&diag.credentialConfigured!==true;
    state(needsCredential?'CREDENTIAL_REQUIRED':diag.desktopEnabled===false?'BLOCKED':'READY',needsCredential?'notice.passwordRequired':diag.desktopEnabled===false?desktopBlockedMessage:ownerSetup()?'notice.ownerReady':'notice.ready');
    if(!updateSetup){updateSetup=true;try{update=await setupUpdates({api,onVersion:renderVersion,onAvailable:metadata=>{renderVersion(metadata);$('updateBanner').hidden=false;updateState('UPDATE_AVAILABLE');},onState:updateState,beforeUpdate:async()=>{if(!await end())throw new Error('UPDATE_FAILED');}});}catch{updateSetup=false;updateState('UPDATE_UNAVAILABLE',true);}}
  }catch(error){if(request!==epoch)return;if(error.message==='TRUSTED_DEVICE_REQUIRED'){trustedDevicesEnabled=true;enrollmentRequired=true;}state(navigator.onLine?'AUTH_REQUIRED':'OFFLINE',navigator.onLine?(trustedDevicesEnabled?'notice.signIn':'notice.accessFailed'):'notice.offline');$('reauth').hidden=false;}
  finally{if(request===epoch){busy=false;syncConnectButton();}}
}
async function cancelIntent(intentId){
  await api.request('/api/desktop-session',{method:'DELETE',body:{intentId}});
}
async function end(reason='READY',message){
  clearNetworkMeasurements();
  const intentId=desktopIntentId;desktopIntentId=null;const request=++epoch;busy=true;
  clearCredentialInput();adapter?.disconnect();adapter=null;$('surface').replaceChildren();$('localText').value='';$('remoteText').value='';
  for(const d of document.querySelectorAll('dialog[open]'))d.close();
  setMessage('clipboardStatus','clipboard.cleared');
  messages.delete($('diagnostics'));$('diagnostics').textContent='';$('history').replaceChildren();pruneMessages();
  workspaceLayout(false);recoveryIntentId=null;$('recoverConnection').hidden=true;state(reason,message);
  try{if(intentId)await cancelIntent(intentId);}
  catch(error){if(request!==epoch)return false;if(trustedLoginRequired(error))return false;state(navigator.onLine?'REAUTH_REQUIRED':'OFFLINE','notice.cleanupFailed');$('reauth').hidden=false;return false;}
  finally{if(request===epoch){busy=false;syncConnectButton();}}
  if(request!==epoch)return false;
  if(['SESSION_EXPIRED','REAUTH_REQUIRED','AUTH_REQUIRED'].includes(reason))$('reauth').hidden=false;
  return true;
}
async function connectionFailure(error){
  const keys={CONTROL_BUSY:'connection.busy',UPDATE_IN_PROGRESS:'connection.updateInProgress'};
  if(!await end(error.message,keys[error.message]??'error.unavailable'))return;
  const request=epoch;
  if(error.message==='CONTROL_BUSY'){
    try{const status=await api.request('/api/session');if(request===epoch&&status.activeDesktop===true&&/^[A-Za-z0-9_-]{43}$/.test(status.activeDesktopIntentId??'')){recoveryIntentId=status.activeDesktopIntentId;$('recoverConnection').hidden=false;setMessage('notice','app.notice.this_browser_has_a_previous_connection');}}
    catch(failure){if(request===epoch)trustedLoginRequired(failure);}
  }
}
async function recoverConnection(){
  if(busy||adapter||!recoveryIntentId||$('recoverConnection').hidden)return;
  const request=epoch,intentId=recoveryIntentId;busy=true;$('recoverConnection').disabled=true;
  try{
    // Cancel the displayed snapshot, even if another tab replaces it while this request waits.
    await cancelIntent(intentId);if(request!==epoch)return;
    recoveryIntentId=null;$('recoverConnection').hidden=true;busy=false;await connect();
  }catch(error){if(request===epoch&&!trustedLoginRequired(error))state('ERROR','app.notice.the_previous_connection_could_not_be');}
  finally{if(request===epoch)busy=false;$('recoverConnection').disabled=false;}
}
async function connect(){
  if(busy||adapter||!device)return;if(diag?.desktopEnabled===false||device.desktopEnabled===false||device.status==='BLOCKED'){state('BLOCKED',desktopBlockedMessage);return;}if(!$('consent').checked){setMessage('notice','app.notice.confirm_shared_desktop_consent_before_connecting');return;}
  clearCredentialInput();recoveryIntentId=null;$('recoverConnection').hidden=true;const request=++epoch;busy=true;$('connect').disabled=true;state('CONNECTING');
  try{
    const clipboard=$('clipboardConsent').checked&&$('mode').value==='control';
    await api.request('/api/clipboard-consent',{method:'POST',body:{enabled:clipboard}});if(request!==epoch)return;
    const quality=$('displayQuality').value;
    const intent=await api.request('/api/connect-intents',{method:'POST',body:{deviceId:device.id,mode:$('mode').value,keyboardProfile:$('profile').value,displayQuality:quality}});
    if(request!==epoch){await cancelIntent(intent.intentId);return;}
    desktopIntentId=intent.intentId;
    activeDisplayQuality=displayQualities.includes(intent.displayQuality)?intent.displayQuality:null;
    $('liveDisplayQuality').value=activeDisplayQuality??quality;$('applyDisplayQuality').disabled=true;rememberDisplayQuality();setMessage('networkLatency','network.unavailable');
    rememberProfile();updateWorkspaceIdentity();
    $('liveProfile').value=$('profile').value;workspaceLayout(true);
    const connectingAdapter=new DesktopAdapter({surface:$('surface'),profile:$('profile').value,keysyms:diag.keysyms,clipboard,
      onState:value=>{if(request!==epoch||adapter!==connectingAdapter)return;state(value);if(value==='CONNECTED'){busy=false;syncConnectButton();}},onFailure:reason=>{if(request===epoch&&adapter===connectingAdapter)void end(reason,'connection.'+reason);},onInput:message=>{if(request!==epoch||adapter!==connectingAdapter)return;$('inputStatus').textContent=message;$('inputStatus').title=message;for(const b of document.querySelectorAll('[aria-pressed]'))b.setAttribute('aria-pressed','false');},
      onClipboard:text=>{if(request!==epoch||adapter!==connectingAdapter)return;$('remoteText').value=text;setMessage('clipboardStatus','app.clipboardStatus.received_text_held_in_memory_copy');}});
    adapter=connectingAdapter;adapter.connect(intent.intentId,$('mode').value);$('clipboardBtn').disabled=!clipboard;$('clipboardBtn').dataset.i18nTitle=clipboard?'clipboard.transferTitle':'clipboard.enableTitle';$('clipboardBtn').title=t($('clipboardBtn').dataset.i18nTitle);$('keysBtn').disabled=$('mode').value==='view';$('keysBtn').dataset.i18nTitle=$('mode').value==='view'?'workspace.viewInputUnavailable':'workspace.remoteKeys';$('keysBtn').title=t($('keysBtn').dataset.i18nTitle);
    setMessage('clipboardStatus',clipboard?'clipboard.enabled':'clipboard.disabled');
  }catch(error){if(request===epoch){if(trustedLoginRequired(error))return;await connectionFailure(error);}}
}
function dialog(id){
  const opener=document.activeElement;
  clearCredentialInput();adapter?.input?.pause();
  $(id).addEventListener('close',()=>{if(opener?.isConnected&&opener.getClientRects().length)opener.focus();},{once:true});
  $(id).showModal();
}
for(const button of document.querySelectorAll('[data-close]'))button.onclick=()=>button.closest('dialog').close();
$('reauth').onclick=()=>trustedDevicesEnabled&&enrollmentRequired?location.assign('/login'):initialize();$('connect').onclick=connect;$('end').onclick=()=>end();$('recoverConnection').onclick=recoverConnection;
$('credentialForm').onsubmit=saveCredential;
$('changeCredential').onclick=()=>{if(busy||adapter||!credentialSetupAllowed())return;clearCredentialInput();$('credentialSetup').hidden=false;messages.delete($('credentialStatus'));$('credentialStatus').textContent='';$('desktopPassword').focus();};
$('cancelCredential').onclick=()=>{clearCredentialInput();$('credentialSetup').hidden=true;messages.delete($('credentialStatus'));$('credentialStatus').textContent='';$('changeCredential').focus();};
$('trustedDevicesBtn').onclick=()=>{if(diag?.trustedDevicesEnabled!==true)return;dialog('trustedDevicesDialog');void loadTrustedDevices();};
$('workspaceTrustedDevices').onclick=()=>{if(diag?.trustedDevicesEnabled!==true)return;dialog('trustedDevicesDialog');void loadTrustedDevices();};
$('logout').onclick=async()=>{
  clearCredentialInput();await end();
  try{
    try{await api.request('/api/session',{method:'DELETE'});}
    catch(error){
      if(!trustedDevicesEnabled||!['AUTH_REQUIRED','SESSION_EXPIRED','CSRF_INVALID'].includes(error.message))throw error;
      await api.bootstrap();await api.request('/api/session',{method:'DELETE'});
    }
  }catch(error){if(!trustedLoginRequired(error)){state('REAUTH_REQUIRED','app.notice.sign_out_could_not_be_confirmed');$('reauth').hidden=false;}return;}
  api.csrf=null;clearPrivate();$('logout').hidden=true;
  if(trustedDevicesEnabled){location.assign('/login');return;}
  state('AUTH_REQUIRED','app.notice.node_signed_out_access_sign_out');$('reauth').hidden=false;
};
$('release').onclick=()=>{adapter?.input?.pause();for(const b of document.querySelectorAll('[aria-pressed]'))b.setAttribute('aria-pressed','false');};
$('pause').onclick=()=>{adapter?.input?.pause();closeWorkspaceMenu(true);};$('keysBtn').onclick=()=>dialog('keysDialog');$('clipboardBtn').onclick=()=>dialog('clipboardDialog');
$('moreBtn').onclick=()=>{
  if($('workspaceMenu').open){closeWorkspaceMenu(true);return;}
  clearCredentialInput();adapter?.input?.pause();$('workspaceMenu').showModal();$('moreBtn').setAttribute('aria-expanded','true');$('closeWorkspacePanel').focus();
  renderNetworkMeasurements();clearInterval(metricsTimer);metricsTimer=setInterval(renderNetworkMeasurements,1000);
};
$('displayQuality').onchange=rememberDisplayQuality;
$('liveDisplayQuality').onchange=()=>{$('applyDisplayQuality').disabled=busy||!adapter||$('liveDisplayQuality').value===activeDisplayQuality;};
$('applyDisplayQuality').onclick=async()=>{
  if(busy||!adapter||$('applyDisplayQuality').disabled)return;
  const quality=$('liveDisplayQuality').value;if(!displayQualities.includes(quality))return;
  $('applyDisplayQuality').disabled=true;
  if(!await end())return;
  $('displayQuality').value=quality;rememberDisplayQuality();await connect();
};
async function measureNetwork(){
  if(!adapter||document.hidden||!$('workspaceMenu').open||$('measureNetwork').disabled)return;
  const request=epoch,currentAdapter=adapter,generation=++latencyRequest;
  const current=()=>request===epoch&&currentAdapter===adapter&&generation===latencyRequest&&$('workspaceMenu').open&&!document.hidden;
  $('measureNetwork').disabled=true;setMessage('networkLatency','network.measuring');const started=performance.now();
  try{const session=await api.request('/api/session');if(!current())return;if(!session.activeDesktop){void end('SESSION_EXPIRED');return;}const ms=performance.now()-started;networkHealth.record(ms);setMessage('networkLatency','network.latency',{ms:ms.toFixed(1)});}
  catch(error){
    if(!current())return;
    if(trustedLoginRequired(error))return;
    if(['AUTH_REQUIRED','SESSION_EXPIRED','ACCESS_DENIED'].includes(error.message)){void end('REAUTH_REQUIRED');clearPrivate();$('reauth').hidden=false;return;}
    networkHealth.fail();setMessage('networkLatency','network.failed');
  }
  finally{if(current()){$('measureNetwork').disabled=false;renderNetworkMeasurements();}}
}
$('measureNetwork').onclick=measureNetwork;
$('liveNetwork').onchange=()=>{nextNetworkProbe=performance.now()+5000;if($('liveNetwork').checked)void measureNetwork();else cancelNetworkProbe();};
$('closeWorkspacePanel').onclick=()=>closeWorkspaceMenu(true);
$('workspaceMenu').addEventListener('cancel',event=>{event.preventDefault();closeWorkspaceMenu(true);});
$('workspaceMenu').addEventListener('keydown',event=>{
  if(event.key!=='Tab')return;
  const controls=[...$('workspaceMenu').querySelectorAll('button:not(:disabled),select:not(:disabled),a[href],[tabindex]:not([tabindex="-1"])')].filter(node=>node.getClientRects().length);
  const first=controls[0],last=controls.at(-1);
  if(first&&last&&((event.shiftKey&&document.activeElement===first)||(!event.shiftKey&&document.activeElement===last))){event.preventDefault();(event.shiftKey?last:first).focus();}
});
$('workspaceMenu').addEventListener('close',()=>{
  if($('workspaceMenu').open)return;
  clearInterval(metricsTimer);metricsTimer=null;cancelNetworkProbe();
  $('moreBtn').setAttribute('aria-expanded','false');
  if(document.body.classList.contains('viewing')&&!document.querySelector('dialog[open]'))$('moreBtn').focus();
});
$('workspaceMenu').addEventListener('click',event=>{
  const r=$('workspaceMenu').getBoundingClientRect();
  if(event.target===$('workspaceMenu')&&(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom))closeWorkspaceMenu(true);
});
$('workspaceProfileBtn').onclick=()=>dialog('keysDialog');
$('profile').onchange=()=>{rememberProfile();updateProfileHelp();};
$('liveProfile').onchange=()=>{adapter?.input?.setProfile($('liveProfile').value);$('profile').value=$('liveProfile').value;rememberProfile();updateProfileHelp();updateWorkspaceIdentity();};
$('scale').onchange=()=>adapter?.fit($('scale').value);window.addEventListener('resize',()=>adapter?.fit($('scale').value));
$('fullscreen').onclick=async()=>{closeWorkspaceMenu(true);try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{setMessage('inputStatus','app.inputStatus.fullscreen_unavailable_all_remote_controls_remain');}};
for(const [label,key] of [['Command','CommandLeft'],['Option','OptionLeft'],['Control','ControlLeft'],['Shift','ShiftLeft'],['Esc','keysym:65307'],['Tab','keysym:65289'],['←','keysym:65361'],['↑','keysym:65362'],['→','keysym:65363'],['↓','keysym:65364'],['Backspace','keysym:65288'],['Delete','keysym:65535'],['Enter','keysym:65293']]){
  const b=document.createElement('button');b.textContent=label;const keyNames={Command:'command',Option:'option',Control:'control',Shift:'shift',Esc:'escape',Tab:'tab',Backspace:'backspace',Delete:'delete',Enter:'enter'};if(keyNames[label])setMessage(b,'keys.'+keyNames[label]);
  if(!key.startsWith('keysym:')){b.setAttribute('aria-pressed','false');b.onclick=()=>{adapter?.input?.toggle(key);b.setAttribute('aria-pressed',String(adapter?.input?.latches.has(key)??false));};}
  else b.onclick=()=>{adapter?.input?.virtual(key);for(const latch of document.querySelectorAll('[aria-pressed]'))latch.setAttribute('aria-pressed','false');};
  $('keyPalette').append(b);
}
for(const [label,name] of [['Remote Copy','copy'],['Remote Paste','paste'],['Remote Cut','cut'],['Undo','undo'],['Select all','select'],['Save','save'],['Remote app switch','switch'],['Remote search','search']]){
  const b=document.createElement('button');setMessage(b,'chords.'+name);b.onclick=()=>adapter?.input?.chord(name);$('chordPalette').append(b);
}
$('remotePaste').onclick=()=>adapter?.input?.chord('paste');
function clipboardContext(){return {request:epoch,current:adapter,activity:clipboardActivity};}
function clipboardCurrent(context){return context.request===epoch&&context.current!==null&&context.current===adapter&&context.activity===clipboardActivity&&$('clipboardDialog').open;}
$('clipboardDialog').addEventListener('close',()=>{++clipboardActivity;});
$('readLocal').onclick=async()=>{const context=clipboardContext();if(!clipboardCurrent(context))return;try{const text=await navigator.clipboard.readText();if(!clipboardCurrent(context))return;if(new TextEncoder().encode(text).length>16384)throw new Error('TOO_LARGE');$('localText').value=text;setMessage('clipboardStatus','app.clipboardStatus.local_text_ready_click_send_to');}catch{if(clipboardCurrent(context))setMessage('clipboardStatus','app.clipboardStatus.clipboard_permission_unavailable_paste_manually_into');}};
$('sendText').onclick=async()=>{const context=clipboardContext();if(!clipboardCurrent(context))return;try{await context.current.sendClipboard($('localText').value);if(clipboardCurrent(context))setMessage('clipboardStatus','app.clipboardStatus.clipboard_stream_acknowledged_verify_the_remote');}catch(e){if(clipboardCurrent(context))setMessage('clipboardStatus',({CLIPBOARD_DISABLED:'clipboard.notEnabled',CLIPBOARD_TOO_LARGE:'clipboard.tooLarge',CLIPBOARD_TIMEOUT:'clipboard.timedOut',CLIPBOARD_UNAVAILABLE:'clipboard.unavailable'})[e.message]??'clipboard.unavailable');}};
$('copyRemote').onclick=async()=>{const context=clipboardContext();if(!clipboardCurrent(context))return;try{await navigator.clipboard.writeText($('remoteText').value);if(clipboardCurrent(context))setMessage('clipboardStatus','app.clipboardStatus.copied_received_text_locally');}catch{if(!clipboardCurrent(context))return;$('remoteText').focus();$('remoteText').select();setMessage('clipboardStatus','app.clipboardStatus.permission_unavailable_copy_the_selected_text');}};
$('diagnosticsDialog').addEventListener('close',()=>{++diagnosticsRequest;});
async function showDiagnostics(){dialog('diagnosticsDialog');const request=epoch,generation=++diagnosticsRequest,current=()=>request===epoch&&generation===diagnosticsRequest&&$('diagnosticsDialog').open;try{const [d,h]=await Promise.all([api.request('/api/diagnostics'),api.request('/api/history')]);if(!current())return;messages.delete($('diagnostics'));$('diagnostics').textContent=JSON.stringify(d,null,2);$('history').replaceChildren();pruneMessages();for(const entry of h){const li=document.createElement('li');setMessage(li,'diagnostics.historyEntry',()=>({date:formatDate(entry.at),event:entry.event,reason:entry.reason}));$('history').append(li);}}catch(error){if(current()&&!trustedLoginRequired(error))setMessage('diagnostics','app.diagnostics.diagnostics_unavailable_verify_access');}}
$('diagnosticsBtn').onclick=showDiagnostics;$('workspaceDiagnostics').onclick=showDiagnostics;
$('update').onclick=async()=>{if(!update||$('update').disabled)return;$('update').disabled=true;await update();if(!['UPDATING','RELOADING'].includes($('updateBanner').dataset.state))$('update').disabled=false;};
$('checkUpdates').onclick=async()=>{if(!update){updateState('UPDATE_UNAVAILABLE',true);return;}await update.check();};
$('preferencesBtn').onclick=()=>dialog('preferencesDialog');
$('consent').onchange=syncConnectButton;

window.addEventListener('offline',()=>{void end('OFFLINE');clearPrivate();$('reauth').hidden=false;});
window.addEventListener('blur',clearCredentialInput);
window.addEventListener('pagehide',()=>{++epoch;clearPrivate();});
window.addEventListener('pageshow',event=>{if(event.persisted)void initialize();});
function checkSession(){
  const request=epoch,currentAdapter=adapter;
  api.request('/api/session').then(session=>{
    if(request!==epoch||adapter!==currentAdapter)return;
    if(currentAdapter&&!session.activeDesktop)void end('SESSION_EXPIRED');
  }).catch(error=>{
    if(request!==epoch||adapter!==currentAdapter||trustedLoginRequired(error))return;
    void end('REAUTH_REQUIRED');clearPrivate();$('reauth').hidden=false;
  });
}
document.addEventListener('visibilitychange',()=>{if(document.hidden){clearCredentialInput();cancelNetworkProbe();}if(!document.hidden&&api.csrf)checkSession();});
setInterval(()=>{if(adapter&&api.csrf)checkSession();},10000);
onLocaleChange(()=>{
  applyTranslations();
  for(const [node,{key,params}] of messages){if(node.isConnected)node.textContent=t(key,typeof params==='function'?params():params);else messages.delete(node);}
  for(const button of document.querySelectorAll('[data-trusted-id]'))button.setAttribute('aria-label',t('trusted.revokeLabel',{id:button.dataset.trustedId}));
  updateProfileHelp();updateWorkspaceIdentity();adapter?.input?.pause();
  renderNetworkMeasurements();
  if($('moreBtn').dataset.updateDescription)$('moreBtn').setAttribute('aria-description',t($('moreBtn').dataset.updateDescription));
  if(adapter?.input?.surface)adapter.input.surface.setAttribute('aria-label',t('workspace.surfaceLabel'));
});
setupPreferences({onChange:()=>adapter?.input?.pause()});
applyTranslations();renderVersion({current:release,target:null});
void initialize();
