/** Native dialog focus boundary shared by the desktop drawer and mobile bottom sheet. */
export function setupMobileControls({button,panel,closeButton,launcherSettings,workspaceSettings,fullscreen,getInput,beforeOpen,onOpen,onClose,window=globalThis.window,document=globalThis.document}) {
  const query=window.matchMedia('(max-width: 680px), (pointer: coarse)');
  let restoreFocus=true,resumeOnClose=true;
  const mobile=()=>query.matches;
  function layout(){
    launcherSettings.open=!mobile();workspaceSettings.open=!mobile();
    fullscreen.hidden=/iPhone/.test(window.navigator?.userAgent??'')||typeof document.documentElement.requestFullscreen!=='function'||document.fullscreenEnabled!==true;
  }
  function close({restoreFocus:restore=true,resume=true}={}){
    restoreFocus=restore;resumeOnClose=resume;
    if(panel.open)panel.close();
    button.setAttribute('aria-expanded','false');
  }
  function open(){
    beforeOpen?.();getInput()?.pause();restoreFocus=true;resumeOnClose=true;
    panel.showModal();button.setAttribute('aria-expanded','true');closeButton.focus();onOpen?.();
  }
  // Keep the keyboard sink focused until click: blurring on pointerdown hides its row and moves the floating target mid-tap.
  button.addEventListener('pointerdown',event=>{if(mobile()&&document.body.classList.contains('soft-keyboard-open'))event.preventDefault();});
  button.onclick=()=>panel.open?close():open();
  closeButton.onclick=()=>close();
  panel.addEventListener('cancel',event=>{event.preventDefault();close();});
  panel.addEventListener('click',event=>{
    const r=panel.getBoundingClientRect();
    if(event.target===panel&&(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom))close();
  });
  panel.addEventListener('keydown',event=>{
    if(event.key!=='Tab')return;
    const controls=[...panel.querySelectorAll('button:not(:disabled),select:not(:disabled),a[href],summary,[tabindex]:not([tabindex="-1"])')].filter(node=>node.getClientRects().length);
    const first=controls[0],last=controls.at(-1);
    if(first&&last&&((event.shiftKey&&document.activeElement===first)||(!event.shiftKey&&document.activeElement===last))){event.preventDefault();(event.shiftKey?last:first).focus();}
  });
  panel.addEventListener('close',()=>{
    if(panel.open)return;
    button.setAttribute('aria-expanded','false');onClose?.();
    if(!document.body.classList.contains('viewing')||document.hidden||document.querySelector('dialog[open]'))return;
    // A Keyboard action focuses synchronously in the click handler. Never steal that focus in the later close event.
    if(resumeOnClose&&mobile())getInput()?.resume();
    else if(restoreFocus)button.focus();
  });
  query.addEventListener('change',layout);layout();
  return {mobile,open,close};
}
