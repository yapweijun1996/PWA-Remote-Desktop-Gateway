import {GatewayAPI} from './api.mjs';
import {DesktopAdapter} from './adapter.mjs';
import {setupUpdates} from './pwa.mjs';

const $=id=>document.getElementById(id),api=new GatewayAPI();
let adapter=null,device=null,diag=null,nodeId='',epoch=0,busy=false,update=null,updateSetup=false;
const platform=/Mac/.test(navigator.platform)?'mac':'windows';
function state(value,message=value.replaceAll('_',' ')){$('status').textContent=value;$('notice').textContent=message;$('loader').hidden=!['UPDATING','RELOADING'].includes(value);}
function clearPrivate(){
  document.body.classList.remove('viewing');
  adapter?.disconnect();adapter=null;$('localText').value='';$('remoteText').value='';$('clipboardStatus').textContent='Clipboard cleared.';
  $('surface').replaceChildren();$('deviceList').replaceChildren();$('diagnostics').textContent='';$('history').replaceChildren();
  for(const d of document.querySelectorAll('dialog[open]'))d.close();
  $('workspace').hidden=true;$('launcher').hidden=false;$('prepare').hidden=true;
}
function rememberProfile(){try{localStorage.setItem(`rdg:profile:${nodeId}:${platform}`,$('profile').value);}catch{}}
function loadProfile(){let p=platform==='mac'?'mac-native':'windows-native';try{const stored=localStorage.getItem(`rdg:profile:${nodeId}:${platform}`);if(['mac-native','windows-native','windows-alt-command'].includes(stored))p=stored;}catch{}$('profile').value=p;$('liveProfile').value=p;}
async function initialize(){
  const request=++epoch;busy=true;clearPrivate();state(navigator.onLine?'AUTH_CHECK':'OFFLINE');$('reauth').hidden=true;
  try {
    const session=await api.bootstrap();if(request!==epoch)return;nodeId=session.nodeId;
    const [devices,diagnostics]=await Promise.all([api.request('/api/devices'),api.request('/api/diagnostics')]);
    if(request!==epoch)return;diag=diagnostics;loadProfile();
    for(const item of devices){
      const article=document.createElement('article');article.className='device';
      const title=document.createElement('h2');title.textContent=item.label;article.append(title);
      const info=document.createElement('p');info.textContent=item.kind==='local'?'Gateway reachable — desktop not tested':'UNKNOWN — check by opening this node';article.append(info);
      if(item.kind==='local'){
        const time=document.createElement('small');time.textContent=`Checked ${new Date(item.checkedAt).toLocaleString()}`;article.append(time);
        const button=document.createElement('button');button.textContent='Prepare connection';button.className='primary';
        button.onclick=()=>{device=item;$('targetName').textContent=item.label;$('prepare').hidden=false;$('consent').checked=false;};article.append(document.createElement('br'),button);
      }else{const link=document.createElement('a');link.href=item.launchUrl;link.textContent='Open independent node';link.rel='noreferrer';article.append(link);}
      $('deviceList').append(article);
    }
    $('logout').hidden=false;state('READY','Access verified. Choose the configured local desktop.');
    if(!updateSetup){updateSetup=true;try{update=await setupUpdates({api,onAvailable:()=>{$('updateBanner').hidden=false;},onState:value=>{state(value);$('updateLabel').textContent=value==='UPDATE_DEFERRED'?'Another node session or pending connection is active. End it and retry.':value.replaceAll('_',' ');},beforeUpdate:async()=>{++epoch;adapter?.disconnect();adapter=null;$('surface').replaceChildren();$('localText').value='';$('remoteText').value='';}});}catch{updateSetup=false;}}
  }catch(error){if(request!==epoch)return;state(navigator.onLine?'AUTH_REQUIRED':'OFFLINE',navigator.onLine?'Access verification failed. Reopen this node through Cloudflare Access.':'No offline remote control.');$('reauth').hidden=false;}
  finally{if(request===epoch){busy=false;$('connect').disabled=false;}}
}
async function end(reason='READY') {
  ++epoch;adapter?.disconnect();adapter=null;$('surface').replaceChildren();$('localText').value='';$('remoteText').value='';
  for(const d of document.querySelectorAll('dialog[open]'))d.close();
  document.body.classList.remove('viewing');$('workspace').hidden=true;$('launcher').hidden=false;state(reason);
  try{await api.request('/api/desktop-session',{method:'DELETE'});}catch{state(navigator.onLine?'REAUTH_REQUIRED':'OFFLINE','Local input stopped. Server cleanup could not be confirmed; retry access.');$('reauth').hidden=false;}
  if(['SESSION_EXPIRED','REAUTH_REQUIRED','AUTH_REQUIRED'].includes(reason))$('reauth').hidden=false;
  busy=false;$('connect').disabled=false;
}
async function connect(){
  if(busy||!device)return;if(!$('consent').checked){$('notice').textContent='Confirm shared desktop consent before connecting.';return;}
  const request=++epoch;busy=true;$('connect').disabled=true;state('CONNECTING');
  try{
    const clipboard=$('clipboardConsent').checked&&$('mode').value==='control';
    await api.request('/api/clipboard-consent',{method:'POST',body:{enabled:clipboard}});if(request!==epoch)return;
    const intent=await api.request('/api/connect-intents',{method:'POST',body:{deviceId:device.id,mode:$('mode').value,keyboardProfile:$('profile').value}});
    if(request!==epoch)return;
    rememberProfile();$('workspaceName').textContent=`${device.label} · ${$('profile').selectedOptions[0].textContent}`;
    $('liveProfile').value=$('profile').value;document.body.classList.add('viewing');$('launcher').hidden=true;$('workspace').hidden=false;
    adapter=new DesktopAdapter({surface:$('surface'),profile:$('profile').value,keysyms:diag.keysyms,clipboard,
      onState:state,onFailure:reason=>{if(request===epoch)void end(reason);},onInput:message=>{$('inputStatus').textContent=message;for(const b of document.querySelectorAll('[aria-pressed]'))b.setAttribute('aria-pressed','false');},
      onClipboard:text=>{$('remoteText').value=text;$('clipboardStatus').textContent='Received text held in memory. Copy locally only with an explicit click.';}});
    adapter.connect(intent.intentId,$('mode').value);$('clipboardBtn').disabled=!clipboard;$('clipboardBtn').title=clipboard?'Explicit plain text transfer':'Enable clipboard before starting a control session';$('keysBtn').disabled=$('mode').value==='view';$('keysBtn').title=$('mode').value==='view'?'View-only sessions cannot send input':'';
    $('clipboardStatus').textContent=clipboard?'Explicit clipboard enabled. Use native paste here if permission is denied.':'Clipboard not enabled for this connection.';
  }catch(error){if(request===epoch){await end('ERROR');$('notice').textContent=error.message.replaceAll('_',' ');}}
}
function dialog(id){adapter?.input?.pause();$(id).showModal();}
for(const button of document.querySelectorAll('[data-close]'))button.onclick=()=>button.closest('dialog').close();
$('reauth').onclick=initialize;$('connect').onclick=connect;$('end').onclick=()=>end();
$('logout').onclick=async()=>{await end();try{await api.request('/api/session',{method:'DELETE'});}catch{}api.csrf=null;clearPrivate();$('logout').hidden=true;state('AUTH_REQUIRED','Node signed out. Access sign-out is separate.');$('reauth').hidden=false;};
$('release').onclick=()=>{adapter?.input?.pause();for(const b of document.querySelectorAll('[aria-pressed]'))b.setAttribute('aria-pressed','false');};
$('pause').onclick=()=>adapter?.input?.pause();$('keysBtn').onclick=()=>dialog('keysDialog');$('clipboardBtn').onclick=()=>dialog('clipboardDialog');
$('profile').onchange=()=>{rememberProfile();$('profileHelp').textContent=$('profile').value==='windows-alt-command'?'Opt-in: only physical Left Alt becomes Command. Right Alt / AltGr and Control stay native.':'Native semantics. Control remains Control; browser/OS shortcuts may stay local.';};
$('liveProfile').onchange=()=>{adapter?.input?.setProfile($('liveProfile').value);$('profile').value=$('liveProfile').value;rememberProfile();$('workspaceName').textContent=`${device.label} · ${$('liveProfile').selectedOptions[0].textContent}`;};
$('scale').onchange=()=>adapter?.fit($('scale').value);window.addEventListener('resize',()=>adapter?.fit($('scale').value));
$('fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await $('workspace').requestFullscreen();}catch{$('inputStatus').textContent='Fullscreen unavailable. All remote controls remain available.';}};
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
$('diagnosticsBtn').onclick=async()=>{dialog('diagnosticsDialog');try{const [d,h]=await Promise.all([api.request('/api/diagnostics'),api.request('/api/history')]);$('diagnostics').textContent=JSON.stringify(d,null,2);$('history').replaceChildren();for(const entry of h){const li=document.createElement('li');li.textContent=`${entry.at} · ${entry.event} · ${entry.reason}`;$('history').append(li);}}catch{$('diagnostics').textContent='Diagnostics unavailable; verify access.';}};
$('update').onclick=async()=>{if(!update)return;await update();};
window.addEventListener('offline',()=>{void end('OFFLINE');clearPrivate();$('reauth').hidden=false;});
window.addEventListener('pagehide',()=>{++epoch;clearPrivate();});
window.addEventListener('pageshow',event=>{if(event.persisted)void initialize();});
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&api.csrf)api.request('/api/session').catch(()=>{void end('REAUTH_REQUIRED');clearPrivate();$('reauth').hidden=false;});});
setInterval(()=>{if(adapter&&api.csrf)api.request('/api/session').then(s=>{if(!s.activeDesktop)void end('SESSION_EXPIRED');}).catch(()=>{void end('REAUTH_REQUIRED');});},10000);
void initialize();
