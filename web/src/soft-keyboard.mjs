import {t} from './i18n.mjs';

const BACKSPACE='keysym:65288',ENTER='keysym:65293';
const ROW_KEYS=Object.freeze([
  ['keyboard.escape','keysym:65307'],['keyboard.tab','keysym:65289'],
  ['keyboard.control','ControlLeft',true],['keyboard.alt','OptionLeft',true],
  ['keyboard.command','CommandLeft',true],['keyboard.left','keysym:65361'],
  ['keyboard.up','keysym:65362'],['keyboard.down','keysym:65364'],['keyboard.right','keysym:65363']
]);
const ARROW_PATHS=Object.freeze({
  'keyboard.left':'M19 12H5m6-6-6 6 6 6',
  'keyboard.up':'M12 19V5m-6 6 6-6 6 6',
  'keyboard.down':'M12 5v14m-6-6 6 6 6-6',
  'keyboard.right':'M5 12h14m-6-6 6 6-6 6'
});

/** A whole commit is accepted or rejected; never send a Latin-1 prefix of unsupported text. */
export function translateSoftInput(inputType,data=null,value='') {
  if(inputType==='deleteContentBackward')return {key:BACKSPACE};
  if(inputType==='insertLineBreak'||inputType==='insertParagraph')return {key:ENTER};
  if(!['insertText','insertFromComposition','insertCompositionText'].includes(inputType))return null;
  const text=data??value;
  if(!text)return null;
  for(const character of text)if(character.codePointAt(0)>255)return {unsupported:true};
  return {text};
}

/**
 * Browser-event translator. State contains only transaction flags, never typed text.
 * resetBoundary() ends one synchronous browser edit transaction; the DOM binding calls it in a microtask.
 */
export function createSoftInputTranslator({onText,onKey,onUnsupported}) {
  let composing=false,beforeHandled=false,keyHandled=false,compositionCommitted=false;
  const resetBoundary=()=>{beforeHandled=false;keyHandled=false;compositionCommitted=false;};
  const send=edit=>{
    if(edit?.unsupported){onUnsupported();return;}
    if(edit?.key){onKey(edit.key);return;}
    if(!edit?.text)return;
    // A textarea can report an entire Latin-1 commit, including a line break, as insertText.
    const pieces=edit.text.split(/\r\n|\r|\n/);
    pieces.forEach((piece,index)=>{if(index)onKey(ENTER);if(piece)onText(piece);});
  };
  return {
    reset(){composing=false;resetBoundary();},resetBoundary,
    handle(event,value='') {
      if(event.type==='compositionstart'){resetBoundary();composing=true;return;}
      if(event.type==='compositionend'){
        composing=false;compositionCommitted=true;
        send(translateSoftInput('insertFromComposition',event.data));return;
      }
      if(event.type==='keydown'){
        resetBoundary();
        // iOS keyCode 229 / Unidentified is not a character: beforeinput/input owns the text.
        if(composing||event.isComposing||event.keyCode===229)return;
        const key=event.key==='Backspace'?BACKSPACE:event.key==='Enter'?ENTER:null;
        if(key){event.preventDefault?.();keyHandled=true;onKey(key);}return;
      }
      if(event.type!=='beforeinput'&&event.type!=='input')return;
      if(composing||event.isComposing)return;
      if(event.type==='input'&&(beforeHandled||keyHandled||compositionCommitted)){
        resetBoundary();return;
      }
      if(event.type==='beforeinput'){
        beforeHandled=true;
        if(event.cancelable)event.preventDefault();
        if(keyHandled||compositionCommitted)return;
      }
      send(translateSoftInput(event.inputType,event.data,value));
    }
  };
}

/**
 * Off-screen textarea bridge. open() MUST be called directly from a user gesture.
 * The adapter retains ownership: no input is buffered, retried, persisted, or logged here.
 */
export function setupSoftKeyboard({textarea,row,getInput,onNotice=()=>{},onResize=()=>{},getProfile=()=>''}) {
  const doc=textarea.ownerDocument??document,win=doc.defaultView??window;
  const root=doc.documentElement,disposers=[],buttons=[];
  let opened=false,disposed=false,owner=null,boundaryScheduled=false;
  const listen=(node,type,fn,options)=>{
    node.addEventListener(type,fn,options);disposers.push(()=>node.removeEventListener(type,fn,options));
  };
  const clear=()=>{textarea.value='';};
  const current=()=>opened&&owner===getInput()&&doc.activeElement===textarea&&!doc.hidden&&owner?.active()?owner:null;
  const translator=createSoftInputTranslator({
    onText:text=>current()?.text(text),onKey:key=>current()?.textKey(key),
    onUnsupported:()=>{if(current())onNotice(t('input.composedText'));}
  });
  const updateButtons=()=>{
    for(const {button,label,key,latch} of buttons){
      const name=t(label==='keyboard.command'&&!String(getProfile()).startsWith('mac')?'keyboard.super':label);
      if(!ARROW_PATHS[label])button.textContent=name;
      button.setAttribute('aria-label',name);button.title=name;
      button.disabled=!opened;
      if(latch)button.setAttribute('aria-pressed',String(Boolean(opened&&owner?.latches?.has(key))));
    }
    textarea.setAttribute('aria-label',t('keyboard.inputLabel'));
    row.setAttribute('aria-label',t('keyboard.extraKeys'));
  };
  const updateViewport=()=>{
    const viewport=win.visualViewport,height=opened?(viewport?.height??win.innerHeight):win.innerHeight;
    const top=opened?(viewport?.offsetTop??0):0;
    const bottom=opened?Math.max(0,win.innerHeight-height-top):0;
    root.style.setProperty('--soft-viewport-height',`${height}px`);
    root.style.setProperty('--soft-viewport-top',`${top}px`);
    root.style.setProperty('--soft-keyboard-bottom',`${bottom}px`);
    root.style.setProperty('--soft-keyboard-height',`${opened?row.getBoundingClientRect().height:0}px`);
    onResize();
  };
  function close() {
    const previous=owner,wasOpen=opened;opened=false;owner=null;translator.reset();clear();
    row.hidden=true;doc.body.classList.remove('soft-keyboard-open');
    if(previous)previous.setKeyboardSurface(null);
    if(doc.activeElement===textarea)textarea.blur();
    updateButtons();if(wasOpen)updateViewport();
  }
  function refresh() {
    if(opened&&(owner!==getInput()||owner?.mode!=='control'||doc.hidden)){close();return;}
    updateButtons();updateViewport();
  }
  function open() {
    if(disposed||doc.hidden)return false;
    const input=getInput();if(!input||input.mode!=='control')return false;
    if(opened&&owner!==input)close();
    clear();translator.reset();owner=input;opened=true;
    row.hidden=false;doc.body.classList.add('soft-keyboard-open');
    // Register before focus: RemoteInput must recognize the surface -> textarea ownership transfer.
    input.setKeyboardSurface(textarea);
    textarea.focus({preventScroll:true});
    if(doc.activeElement!==textarea){close();return false;}
    updateButtons();updateViewport();return true;
  }
  for(const [name,value] of Object.entries({autocomplete:'off',autocorrect:'off',autocapitalize:'off',spellcheck:'false',enterkeyhint:'enter',inputmode:'text'}))textarea.setAttribute(name,value);
  textarea.spellcheck=false;textarea.tabIndex=-1;
  row.setAttribute('role','toolbar');
  for(const [label,key,latch=false] of ROW_KEYS){
    const button=doc.createElement('button');button.type='button';button.dataset.softKey=key;
    if(ARROW_PATHS[label])button.innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ARROW_PATHS[label]}"/></svg>`;
    row.append(button);buttons.push({button,label,key,latch});
    // Keep the hidden text sink focused while touching an extra key.
    listen(button,'pointerdown',event=>event.preventDefault());
    listen(button,'mousedown',event=>event.preventDefault());
    listen(button,'click',()=>{
      const input=current();if(!input){close();return;}
      if(latch)input.toggle(key);else input.textKey(key);
      clear();updateButtons();
    });
  }
  const onEdit=event=>{
    if(!current()){clear();translator.reset();return;}
    translator.handle(event,textarea.value);clear();updateButtons();
    if(!boundaryScheduled){boundaryScheduled=true;queueMicrotask(()=>{boundaryScheduled=false;translator.resetBoundary();});}
  };
  for(const type of ['beforeinput','input','compositionstart','compositionend','keydown'])listen(textarea,type,onEdit);
  listen(textarea,'blur',()=>close());
  listen(win,'blur',()=>close());listen(win,'pagehide',()=>close());
  listen(doc,'visibilitychange',()=>{if(doc.hidden)close();});
  listen(win,'resize',()=>updateViewport());
  if(win.visualViewport)for(const type of ['resize','scroll'])listen(win.visualViewport,type,()=>updateViewport());
  const observer=win.ResizeObserver?new win.ResizeObserver(()=>{if(opened)updateViewport();}):null;
  observer?.observe(row);
  clear();row.hidden=true;updateButtons();updateViewport();
  return {open,close,refresh,dispose(){
    if(disposed)return;disposed=true;close();observer?.disconnect();
    for(const dispose of disposers)dispose();
    for(const {button} of buttons)button.remove();
  }};
}
