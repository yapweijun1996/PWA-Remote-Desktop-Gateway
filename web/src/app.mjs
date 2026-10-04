import {GatewayAPI} from './api.mjs';
import {DesktopAdapter} from './adapter.mjs';
import {setupUpdates} from './pwa.mjs';

const $=id=>document.getElementById(id),api=new GatewayAPI();
let adapter=null,desktopIntentId=null,recoveryIntentId=null,device=null,diag=null,nodeId='',epoch=0,busy=false,update=null,updateSetup=false;
let credentialSaving=false,trustedDevicesEnabled=false,trustedLoading=false,enrollmentRequired=false;
const desktopBlockedMessage='Access verified. Desktop connections are disabled on this node until the Mac connection and keyboard calibration are verified.';
const platform=/Mac/.test(navigator.platform)?'mac':'windows';
function state(value,message=value.replaceAll('_',' ')){$('status').textContent=value;$('status').dataset.state=value;$('notice').textContent=message;$('loader').hidden=!['UPDATING','RELOADING'].includes(value);}
function closeWorkspaceMenu(restoreFocus=false){
  const wasOpen=!$('workspaceMenu').hidden;$('workspaceMenu').hidden=true;$('moreBtn').setAttribute('aria-expanded','false');
  if(wasOpen&&restoreFocus&&document.body.classList.contains('viewing'))$('moreBtn').focus();
}
function workspaceLayout(viewing){
  closeWorkspaceMenu();document.body.classList.toggle('viewing',viewing);
  $(viewing?'workspaceAccount':'launcherAccount').append($('logout'));
  $('workspace').hidden=!viewing;$('launcher').hidden=viewing;
}
function updateWorkspaceIdentity(){
  $('workspaceName').textContent=device?.label??'Desktop';$('workspaceName').title=device?.label??'Desktop';
  const profile=$('profile').selectedOptions[0].textContent;$('workspaceProfile').textContent=profile;$('workspaceProfile').title=profile;
}
function clearCredentialInput(){$('desktopPassword').value='';}
function clearPrivate(){
  clearCredentialInput();desktopIntentId=null;recoveryIntentId=null;$('recoverConnection').hidden=true;diag=null;$('credentialSetup').hidden=true;$('changeCredential').hidden=true;
  $('credentialStatus').textContent='';$('trustedDevicesBtn').hidden=true;$('workspaceTrustedDevices').hidden=true;$('trustedDevicesList').replaceChildren();$('trustedDevicesStatus').textContent='';
  workspaceLayout(false);
  adapter?.disconnect();adapter=null;device=null;$('localText').value='';$('remoteText').value='';$('clipboardStatus').textContent='Clipboard cleared.';
  $('surface').replaceChildren();$('deviceList').replaceChildren();$('diagnostics').textContent='';$('history').replaceChildren();
  for(const d of document.querySelectorAll('dialog[open]'))d.close();
  $('workspace').hidden=true;$('launcher').hidden=false;$('prepare').hidden=true;
}
function trustedLoginRequired(error){
  if(error?.message!=='TRUSTED_DEVICE_REQUIRED')return false;
  trustedDevicesEnabled=true;enrollmentRequired=true;++epoch;clearPrivate();busy=false;
  state('AUTH_REQUIRED','Sign in to trust this browser and continue.');$('reauth').hidden=false;return true;
}
function rememberProfile(){try{localStorage.setItem(`rdg:profile:${nodeId}:${platform}`,$('profile').value);}catch{}}
function loadProfile(){let p=platform==='mac'?'mac-native':'windows-native';try{const stored=localStorage.getItem(`rdg:profile:${nodeId}:${platform}`);if(['mac-native','windows-native','windows-alt-command'].includes(stored))p=stored;}catch{}$('profile').value=p;$('liveProfile').value=p;updateProfileHelp();}
function ownerSetup(){return diag?.desktopPolicy==='OWNER_SETUP';}
function credentialSetupAllowed(){return ownerSetup()&&diag?.credentialSetupEnabled===true;}
function updateProfileHelp(){
  const semantics=$('profile').value==='windows-alt-command'?'Opt-in: only physical Left Alt becomes Command. Right Alt / AltGr and Control stay native.':'Control remains Control. Browser and OS shortcuts may stay local; use remote buttons.';
  $('profileHelp').textContent=(ownerSetup()?'Standard profile — shortcuts awaiting your test. ':'')+semantics;
}
function prepareDevice(item){
  device=item;$('targetName').textContent=item.label;$('prepare').hidden=false;$('consent').checked=false;
}
function renderCredentialSetup(){
  const allowed=credentialSetupAllowed(),configured=diag?.credentialConfigured===true;
  $('credentialSetup').hidden=!allowed||configured;$('changeCredential').hidden=!allowed||!configured;
  $('credentialTitle').textContent=configured?'Change desktop password':'Set up desktop access';
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
    clearCredentialInput();$('credentialStatus').textContent='Enter a valid Screen Sharing VNC password.';return;
  }
  const request=epoch;credentialSaving=true;busy=true;$('saveCredential').disabled=true;$('credentialStatus').textContent='Saving desktop password…';
  try{
    const result=await sendCredential();if(request!==epoch)return;
    if(result?.credentialConfigured!==true)throw new Error('CREDENTIAL_STORE_UNAVAILABLE');
    await initialize();
  }catch(error){
    if(request!==epoch||trustedLoginRequired(error))return;
    const messages={INVALID_CREDENTIAL:'Enter a valid Screen Sharing VNC password.',CONTROL_BUSY:'End the active desktop session before changing its password.',CREDENTIAL_STORE_UNAVAILABLE:'The desktop password could not be saved. Try again.'};
    $('credentialStatus').textContent=messages[error.message]??'The desktop password could not be saved. Verify access and try again.';
  }finally{clearCredentialInput();credentialSaving=false;$('saveCredential').disabled=false;if(request===epoch)busy=false;}
}
function displayExpiry(value){const time=new Date(value);return Number.isNaN(time.valueOf())?'Unavailable':time.toLocaleString();}
async function loadTrustedDevices(){
  if(trustedLoading||diag?.trustedDevicesEnabled!==true)return;
  const request=epoch;trustedLoading=true;$('trustedDevicesStatus').textContent='Loading trusted devices…';
  try{
    const result=await api.request('/api/trusted-devices');if(request!==epoch||!$('trustedDevicesDialog').open)return;
    if(!Array.isArray(result?.devices)||result.devices.length>100||result.devices.some(entry=>!entry||typeof entry.id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(entry.id)||typeof entry.expiresAt!=='string'||typeof entry.current!=='boolean'))throw new Error('INVALID_DEVICES');
    $('trustedDevicesList').replaceChildren();
    for(const entry of result.devices){
      const item=document.createElement('li'),id=document.createElement('strong'),expiry=document.createElement('p'),button=document.createElement('button');
      id.textContent=entry.id+(entry.current?' · This browser':'');expiry.textContent='Expires '+displayExpiry(entry.expiresAt);
      button.type='button';button.className='danger';button.textContent='Revoke';button.setAttribute('aria-label','Revoke trusted device '+entry.id);
      button.onclick=()=>revokeTrustedDevice(entry,button);item.append(id,expiry,button);$('trustedDevicesList').append(item);
    }
    $('trustedDevicesStatus').textContent=result.devices.length?'Revoking this browser returns it to sign-in.':'No trusted devices.';
  }catch(error){if(request===epoch&&!trustedLoginRequired(error))$('trustedDevicesStatus').textContent='Trusted devices are unavailable. Verify access and try again.';}
  finally{trustedLoading=false;}
}
async function revokeTrustedDevice(entry,button){
  if(button.disabled||diag?.trustedDevicesEnabled!==true)return;
  const request=epoch;button.disabled=true;$('trustedDevicesStatus').textContent='Revoking trusted device…';
  try{
    await api.request('/api/trusted-devices/'+encodeURIComponent(entry.id),{method:'DELETE'});if(request!==epoch)return;
    if(entry.current){++epoch;api.csrf=null;clearPrivate();location.assign('/login');return;}
    await loadTrustedDevices();
  }catch(error){if(request===epoch&&!trustedLoginRequired(error)){button.disabled=false;$('trustedDevicesStatus').textContent='The trusted device could not be revoked. Verify access and try again.';}}
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
      const info=document.createElement('p');info.textContent=item.kind==='local'?(needsCredential?'Password needed — desktop not connected':blocked?'BLOCKED — desktop connection not verified':'Gateway reachable — desktop not tested'):'UNKNOWN — check by opening this node';article.append(info);
      if(item.kind==='local'){
        const time=document.createElement('small');time.textContent=`Checked ${new Date(item.checkedAt).toLocaleString()}`;article.append(time);
        const button=document.createElement('button');button.textContent='Prepare connection';button.className='primary';button.disabled=blocked;
        if(blocked){button.title=needsCredential?'Enter the Screen Sharing VNC password below.':desktopBlockedMessage;const reason=document.createElement('p');reason.textContent=needsCredential?'Enter the Screen Sharing VNC password below to use control, viewing and optional clipboard.':'Cloudflare Access login and gateway status are available. Remote viewing, input and clipboard are disabled.';article.append(reason);}
        button.onclick=()=>{if(blocked)return;prepareDevice(item);};article.append(document.createElement('br'),button);
        if(ownerSetup()&&diag.credentialConfigured===true&&!blocked&&!device)prepareDevice(item);
      }else{const link=document.createElement('a');link.href=item.launchUrl;link.textContent='Open independent node';link.rel='noreferrer';article.append(link);}
      $('deviceList').append(article);
    }
    enrollmentRequired=false;$('logout').hidden=false;
    const needsCredential=credentialSetupAllowed()&&diag.credentialConfigured!==true;
    state(needsCredential?'CREDENTIAL_REQUIRED':diag.desktopEnabled===false?'BLOCKED':'READY',needsCredential?'Enter the Screen Sharing VNC password once to open your desktop.':diag.desktopEnabled===false?desktopBlockedMessage:ownerSetup()?'Choose control or view, confirm consent, and open your desktop.':'Access verified. Choose the configured local desktop.');
    if(!updateSetup){updateSetup=true;try{update=await setupUpdates({api,onAvailable:()=>{$('updateBanner').hidden=false;},onState:value=>{state(value);$('updateLabel').textContent=value==='UPDATE_DEFERRED'?'Another node session or pending connection is active. End it and retry.':value.replaceAll('_',' ');},beforeUpdate:async()=>{++epoch;clearCredentialInput();adapter?.disconnect();adapter=null;$('surface').replaceChildren();$('localText').value='';$('remoteText').value='';}});}catch{updateSetup=false;}}
  }catch(error){if(request!==epoch)return;if(error.message==='TRUSTED_DEVICE_REQUIRED'){trustedDevicesEnabled=true;enrollmentRequired=true;}state(navigator.onLine?'AUTH_REQUIRED':'OFFLINE',navigator.onLine?(trustedDevicesEnabled?'Sign in to trust this browser and continue.':'Access verification failed. Reopen this node through Cloudflare Access.'):'No offline remote control.');$('reauth').hidden=false;}
  finally{if(request===epoch){busy=false;$('connect').disabled=false;}}
}
async function cancelIntent(intentId){
  await api.request('/api/desktop-session',{method:'DELETE',body:{intentId}});
}
async function end(reason='READY',message){
  const intentId=desktopIntentId;desktopIntentId=null;const request=++epoch;busy=true;
  clearCredentialInput();adapter?.disconnect();adapter=null;$('surface').replaceChildren();$('localText').value='';$('remoteText').value='';
  for(const d of document.querySelectorAll('dialog[open]'))d.close();
  workspaceLayout(false);recoveryIntentId=null;$('recoverConnection').hidden=true;state(reason,message);
  try{if(intentId)await cancelIntent(intentId);}
  catch(error){if(request!==epoch)return false;if(trustedLoginRequired(error))return false;state(navigator.onLine?'REAUTH_REQUIRED':'OFFLINE','Local input stopped. Server cleanup could not be confirmed; retry access.');$('reauth').hidden=false;return false;}
  finally{if(request===epoch){busy=false;$('connect').disabled=false;}}
  if(request!==epoch)return false;
  if(['SESSION_EXPIRED','REAUTH_REQUIRED','AUTH_REQUIRED'].includes(reason))$('reauth').hidden=false;
  return true;
}
async function connectionFailure(error){
  const messages={CONTROL_BUSY:'A desktop connection is already open. End the previous connection before trying again.',UPDATE_IN_PROGRESS:'A page update is finishing. Wait 20 seconds, then click Open desktop again.'};
  if(!await end(error.message,messages[error.message]??error.message.replaceAll('_',' ')))return;
  const request=epoch;
  if(error.message==='CONTROL_BUSY'){
    try{const status=await api.request('/api/session');if(request===epoch&&status.activeDesktop===true&&/^[A-Za-z0-9_-]{43}$/.test(status.activeDesktopIntentId??'')){recoveryIntentId=status.activeDesktopIntentId;$('recoverConnection').hidden=false;$('notice').textContent='This browser has a previous connection. Ending it here also closes it in any other tab.';}}
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
  }catch(error){if(request===epoch&&!trustedLoginRequired(error))state('ERROR','The previous connection could not be ended. Try again.');}
  finally{if(request===epoch)busy=false;$('recoverConnection').disabled=false;}
}
async function connect(){
  if(busy||!device)return;if(diag?.desktopEnabled===false||device.desktopEnabled===false||device.status==='BLOCKED'){state('BLOCKED',desktopBlockedMessage);return;}if(!$('consent').checked){$('notice').textContent='Confirm shared desktop consent before connecting.';return;}
  clearCredentialInput();recoveryIntentId=null;$('recoverConnection').hidden=true;const request=++epoch;busy=true;$('connect').disabled=true;state('CONNECTING');
  try{
    const clipboard=$('clipboardConsent').checked&&$('mode').value==='control';
    await api.request('/api/clipboard-consent',{method:'POST',body:{enabled:clipboard}});if(request!==epoch)return;
    const intent=await api.request('/api/connect-intents',{method:'POST',body:{deviceId:device.id,mode:$('mode').value,keyboardProfile:$('profile').value}});
    if(request!==epoch){await cancelIntent(intent.intentId);return;}
    desktopIntentId=intent.intentId;
    rememberProfile();updateWorkspaceIdentity();
    $('liveProfile').value=$('profile').value;workspaceLayout(true);
    adapter=new DesktopAdapter({surface:$('surface'),profile:$('profile').value,keysyms:diag.keysyms,clipboard,
      onState:state,onFailure:reason=>{if(request===epoch)void end(reason);},onInput:message=>{$('inputStatus').textContent=message;$('inputStatus').title=message;for(const b of document.querySelectorAll('[aria-pressed]'))b.setAttribute('aria-pressed','false');},
      onClipboard:text=>{$('remoteText').value=text;$('clipboardStatus').textContent='Received text held in memory. Copy locally only with an explicit click.';}});
    adapter.connect(intent.intentId,$('mode').value);$('clipboardBtn').disabled=!clipboard;$('clipboardBtn').title=clipboard?'Explicit plain text transfer':'Enable clipboard before starting a control session';$('keysBtn').disabled=$('mode').value==='view';$('keysBtn').title=$('mode').value==='view'?'View-only sessions cannot send input':'';
    $('clipboardStatus').textContent=clipboard?'Explicit clipboard enabled. Use native paste here if permission is denied.':'Clipboard not enabled for this connection.';
  }catch(error){if(request===epoch){if(trustedLoginRequired(error))return;await connectionFailure(error);}}
}
function dialog(id){
  const opener=$('workspaceMenu').contains(document.activeElement)?$('moreBtn'):document.activeElement;
  closeWorkspaceMenu();clearCredentialInput();adapter?.input?.pause();
  $(id).addEventListener('close',()=>{if(opener?.isConnected&&opener.getClientRects().length)opener.focus();},{once:true});
  $(id).showModal();
}
for(const button of document.querySelectorAll('[data-close]'))button.onclick=()=>button.closest('dialog').close();
$('reauth').onclick=()=>trustedDevicesEnabled&&enrollmentRequired?location.assign('/login'):initialize();$('connect').onclick=connect;$('end').onclick=()=>end();$('recoverConnection').onclick=recoverConnection;
$('credentialForm').onsubmit=saveCredential;
$('changeCredential').onclick=()=>{if(busy||adapter||!credentialSetupAllowed())return;clearCredentialInput();$('credentialSetup').hidden=false;$('credentialStatus').textContent='';$('desktopPassword').focus();};
$('cancelCredential').onclick=()=>{clearCredentialInput();$('credentialSetup').hidden=true;$('credentialStatus').textContent='';$('changeCredential').focus();};
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
  }catch(error){if(!trustedLoginRequired(error)){state('REAUTH_REQUIRED','Sign out could not be confirmed. Verify access and try again.');$('reauth').hidden=false;}return;}
  api.csrf=null;clearPrivate();$('logout').hidden=true;
  if(trustedDevicesEnabled){location.assign('/login');return;}
  state('AUTH_REQUIRED','Node signed out. Access sign-out is separate.');$('reauth').hidden=false;
};
$('release').onclick=()=>{adapter?.input?.pause();for(const b of document.querySelectorAll('[aria-pressed]'))b.setAttribute('aria-pressed','false');};
$('pause').onclick=()=>{adapter?.input?.pause();closeWorkspaceMenu(true);};$('keysBtn').onclick=()=>dialog('keysDialog');$('clipboardBtn').onclick=()=>dialog('clipboardDialog');
$('moreBtn').onclick=()=>{
  if(!$('workspaceMenu').hidden){closeWorkspaceMenu(true);return;}
  adapter?.input?.pause();$('workspaceMenu').hidden=false;$('moreBtn').setAttribute('aria-expanded','true');$('scale').focus();
};
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&!$('workspaceMenu').hidden){event.preventDefault();closeWorkspaceMenu(true);}
});
document.addEventListener('pointerdown',event=>{if(!$('workspaceMenu').contains(event.target)&&!$('moreBtn').contains(event.target))closeWorkspaceMenu();});
document.addEventListener('focusin',event=>{if(!$('workspaceMenu').contains(event.target)&&event.target!==$('moreBtn'))closeWorkspaceMenu();});
$('workspaceProfileBtn').onclick=()=>dialog('keysDialog');
$('profile').onchange=()=>{rememberProfile();updateProfileHelp();};
$('liveProfile').onchange=()=>{adapter?.input?.setProfile($('liveProfile').value);$('profile').value=$('liveProfile').value;rememberProfile();updateProfileHelp();updateWorkspaceIdentity();};
$('scale').onchange=()=>adapter?.fit($('scale').value);window.addEventListener('resize',()=>adapter?.fit($('scale').value));
$('fullscreen').onclick=async()=>{closeWorkspaceMenu(true);try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{$('inputStatus').textContent='Fullscreen unavailable. All remote controls remain available.';}};
for(const [label,key] of [['Command','CommandLeft'],['Option','OptionLeft'],['Control','ControlLeft'],['Shift','ShiftLeft'],['Esc','keysym:65307'],['Tab','keysym:65289'],['←','keysym:65361'],['↑','keysym:65362'],['→','keysym:65363'],['↓','keysym:65364'],['Backspace','keysym:65288'],['Delete','keysym:65535'],['Enter','keysym:65293']]){
  const b=document.createElement('button');b.textContent=label;
  if(!key.startsWith('keysym:')){b.setAttribute('aria-pressed','false');b.onclick=()=>{adapter?.input?.toggle(key);b.setAttribute('aria-pressed',String(adapter?.input?.latches.has(key)??false));};}
  else b.onclick=()=>{adapter?.input?.virtual(key);for(const latch of document.querySelectorAll('[aria-pressed]'))latch.setAttribute('aria-pressed','false');};
  $('keyPalette').append(b);
}
for(const [label,name] of [['Remote Copy','copy'],['Remote Paste','paste'],['Remote Cut','cut'],['Undo','undo'],['Select all','select'],['Save','save'],['Remote app switch','switch'],['Remote search','search']]){
  const b=document.createElement('button');b.textContent=label;b.onclick=()=>adapter?.input?.chord(name);$('chordPalette').append(b);
}
$('remotePaste').onclick=()=>adapter?.input?.chord('paste');
$('readLocal').onclick=async()=>{try{const text=await navigator.clipboard.readText();if(new TextEncoder().encode(text).length>16384)throw new Error('TOO_LARGE');$('localText').value=text;$('clipboardStatus').textContent='Local text ready. Click Send to transfer.';}catch{$('clipboardStatus').textContent='Clipboard permission unavailable. Paste manually into the text field.';}};
$('sendText').onclick=async()=>{try{await adapter?.sendClipboard($('localText').value);$('clipboardStatus').textContent='Clipboard stream acknowledged. Verify the remote text before using Remote Paste.';}catch(e){$('clipboardStatus').textContent=e.message;}};
$('copyRemote').onclick=async()=>{try{await navigator.clipboard.writeText($('remoteText').value);$('clipboardStatus').textContent='Copied received text locally.';}catch{$('remoteText').focus();$('remoteText').select();$('clipboardStatus').textContent='Permission unavailable. Copy the selected text manually.';}};
async function showDiagnostics(){dialog('diagnosticsDialog');try{const [d,h]=await Promise.all([api.request('/api/diagnostics'),api.request('/api/history')]);$('diagnostics').textContent=JSON.stringify(d,null,2);$('history').replaceChildren();for(const entry of h){const li=document.createElement('li');li.textContent=`${entry.at} · ${entry.event} · ${entry.reason}`;$('history').append(li);}}catch(error){if(!trustedLoginRequired(error))$('diagnostics').textContent='Diagnostics unavailable; verify access.';}}
$('diagnosticsBtn').onclick=showDiagnostics;$('workspaceDiagnostics').onclick=showDiagnostics;
$('update').onclick=async()=>{if(!update)return;await update();};
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
document.addEventListener('visibilitychange',()=>{if(document.hidden)clearCredentialInput();if(!document.hidden&&api.csrf)checkSession();});
setInterval(()=>{if(adapter&&api.csrf)checkSession();},10000);
void initialize();
