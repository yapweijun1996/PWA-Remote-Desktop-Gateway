import {t} from './i18n.mjs';
import {KeyboardState} from '../../reference/keyboard-state.mjs';
import {TouchGestures,HOLD_MS} from './touch-gestures.mjs';

export function logicalKey(keysym) {
  return ({65507:'ControlLeft',65508:'ControlRight',65513:'OptionLeft',65514:'OptionRight',
    65511:'CommandLeft',65512:'CommandRight',65515:'CommandLeft',65516:'CommandRight',
    65505:'ShiftLeft',65506:'ShiftRight'})[keysym] ?? `keysym:${keysym}`;
}
export function encodeKey(key, calibrated) {
  if(Object.hasOwn(calibrated,key))return calibrated[key];
  if(key==='ShiftLeft')return 0xffe1;if(key==='ShiftRight')return 0xffe2;
  if(key.startsWith('keysym:'))return Number(key.slice(7));
  throw new Error('Key mapping unavailable');
}
/**
 * Candidate X11 keysyms for the Mac Command key (left, right). The server configuration is an unverified test profile
 * (Meta_L); which code a real Mac VNC server treats as Command must be found on the target. Session-only trial values.
 */
export const COMMAND_KEY_CANDIDATES=Object.freeze({server:null,super:[0xffeb,0xffec],alt:[0xffe9,0xffea],hyper:[0xffed,0xffee],meta:[0xffe7,0xffe8]});
export const CHORDS=Object.freeze({copy:['CommandLeft','keysym:99'],paste:['CommandLeft','keysym:118'],
  cut:['CommandLeft','keysym:120'],undo:['CommandLeft','keysym:122'],select:['CommandLeft','keysym:97'],
  save:['CommandLeft','keysym:115'],switch:['CommandLeft','keysym:65289'],search:['CommandLeft','keysym:32']});

/** How long a Command+V waits for the browser's paste event before it is forwarded as a plain key chord (browsers without the event). */
export const PASTE_WAIT_MS=150;

/** Touch scrolling: clicks per window (40/s). Far below the gateway's 1000 messages/s hard limit (two messages per click). */
export const SCROLL_WINDOW_MS=250,SCROLL_MAX_CLICKS=10;
/**
 * Wheel travel per remote wheel click. Guacamole's own value is 53 and it discards the remainder after every click. A VNC
 * click is usually one line on a Mac, so about 15 px keeps the remote close to the local scroll distance.
 */
export const SCROLL_SPEEDS=Object.freeze({slow:53,normal:30,fast:15,faster:8,max:4}),DEFAULT_SCROLL_SPEED='fast';
/** Wheel clicks: 250/s sustained after a burst of 40 (500 messages/s, under the gateway's 1000/s); excess waits, capped at 200 clicks. */
export const WHEEL_BURST=40,WHEEL_CLICKS_PER_SECOND=250,WHEEL_BACKLOG_CLICKS=200,PIXELS_PER_LINE=18,PIXELS_PER_PAGE=288;

/** One normalized engine stream attached only to the focused remote surface. */
export class RemoteInput {
  constructor({surface,pointerSurface=surface,client,Guacamole,profile,keysyms,onPause,onFailure,onWheel=null,onPasteText=null,view=null,clock=()=>performance.now(),schedule=(fn,ms)=>setTimeout(fn,ms),cancel=id=>clearTimeout(id)}) {
    this.onWheel=onWheel;this.onPasteText=onPasteText;this.pasteHold=null;this.pasteKeyHeld=false;this.metaHeld=false;this.surface=surface;this.client=client;this.Guacamole=Guacamole;this.onPause=onPause;this.onFailure=onFailure;
    this.serverKeysyms=Object.freeze({...keysyms});this.keysyms={...keysyms};
    this.clock=clock;this.schedule=schedule;this.cancel=cancel;this.pointerSurface=pointerSurface;this.scrollWindowStart=-Infinity;this.scrollClicks=0;this.droppedWheelPress=false;
    this.pixelsPerClick=SCROLL_SPEEDS[DEFAULT_SCROLL_SPEED];this.wheelPixels=0;this.wheelTokens=WHEEL_BURST;this.wheelStamp=-Infinity;this.wheelTimer=null;this.wheelPoint={x:0,y:0};
    this.enabled=false;this.mode='view';this.altGraph=false;this.leftAltPhysical=false;this.latches=new Set();this.disposers=[];
    this.view=view;this.touchMode='trackpad';this.gestures=new TouchGestures();this.touchTimer=null;this.touchPoints=[];this.keyboardSurface=null;this.keyboardDisposers=[];
    this.ghostUntil=-Infinity;this.mousePoint=null;this.touchBridge=null;this.touch=null;
    this.pointer=new Guacamole.Mouse.State(0,0,false,false,false,false,false);this.protocolCounts=new Map();
    this.keys=new KeyboardState({profile,onTransition:({key,down})=>{
      if(this.mode!=='control')return;
      const keysym=encodeKey(key,this.keysyms),count=this.protocolCounts.get(keysym)??0;
      if(down){this.protocolCounts.set(keysym,count+1);if(count===0)client.sendKeyEvent(1,keysym);}
      else if(count===1){this.protocolCounts.delete(keysym);client.sendKeyEvent(0,keysym);}
      else if(count>1)this.protocolCounts.set(keysym,count-1);
    }});
    const listen=(node,event,fn,capture=false)=>{node.addEventListener(event,fn,capture);this.disposers.push(()=>node.removeEventListener(event,fn,capture));};
    listen(surface,'keydown',e=>{
      this.altGraph=e.getModifierState('AltGraph');
      if(e.code==='AltLeft')this.leftAltPhysical=true;
      if(e.key==='Meta')this.metaHeld=true;
      // Automatic clipboard: Command+V is held back until the browser hands over the local text (paste event), which is sent to the
      // Mac first. Guacamole.Keyboard never sees this V, so it is not typed early and the browser's paste default is kept.
      if(this.onPasteText&&this.active()&&e.code==='KeyV'&&e.metaKey&&!e.ctrlKey&&!e.altKey&&!e.shiftKey&&!e.repeat&&!this.pasteHold) {
        e.stopImmediatePropagation();this.pasteKeyHeld=true;this.pasteHold={timer:this.schedule(()=>this.settlePaste(''),PASTE_WAIT_MS)};return;
      }
      // Keep a usable browser keyboard escape, without forwarding a half-owned chord.
      if(e.code==='Escape' && e.shiftKey){e.stopImmediatePropagation();e.preventDefault();this.pause();surface.blur();}
    },true);
    listen(surface,'keyup',e=>{
      if(e.code==='AltLeft')this.leftAltPhysical=false;
      if(e.key==='Meta')this.metaHeld=false;
      if(e.code==='KeyV'&&this.pasteKeyHeld){this.pasteKeyHeld=false;e.stopImmediatePropagation();}   // only the V whose keydown was held back
    },true);
    // The text is read only from this user-initiated paste, never in the background. Without a pending Command+V it is ignored.
    listen(document,'paste',e=>{
      if(!this.pasteHold)return;
      e.preventDefault();this.settlePaste(e.clipboardData?.getData('text/plain')??'');
    },true);
    // Guacamole.Mouse/Touchpad always cancel wheel and touch defaults on the display. Wheel is converted here instead (its own
    // conversion drops the remainder); an inactive surface lets the browser scroll the local viewport (Actual size, view-only).
    listen(surface,'wheel',e=>{e.stopPropagation();if(!this.active())return;e.preventDefault();this.wheel(e);},true);
    for(const type of ['mousewheel','DOMMouseScroll'])listen(surface,type,e=>{e.stopPropagation();if(this.active())e.preventDefault();},true);
    for(const type of ['touchstart','touchmove','touchend','touchcancel'])listen(surface,type,e=>this.handleTouch(type,e),{capture:true,passive:false});
    for(const type of ['mousedown','mouseup','mousemove','click'])listen(surface,type,e=>{
      if(this.clock()<this.ghostUntil){e.preventDefault();e.stopImmediatePropagation();return;}
      if(Number.isFinite(e.clientX))this.mousePoint=this.displayPoint(e.clientX,e.clientY);
    },true);
    this.keyboard=new Guacamole.Keyboard(surface);
    this.keyboard.onkeydown=keysym=>{
      if(!this.active())return true;
      if(this.altGraph && [0xffe3,0xffe4,0xffe9,0xffea,0xfe03].includes(keysym))return false;
      // Classic VNC Unicode/local composition is unverified. Text panel is the explicit fallback.
      if(keysym>=0x01000000){onPause(t('input.composedText'));return false;}
      this.run(()=>this.keys.down(`physical:${keysym}`,logicalKey(keysym),
        {code:keysym===0xffe9&&this.leftAltPhysical?'AltLeft':'',physical:true}));
      return false;
    };
    this.keyboard.onkeyup=keysym=>{this.run(()=>{this.keys.up(`physical:${keysym}`);if(logicalKey(keysym).startsWith('keysym:')){for(const key of this.latches)this.keys.up(`latch:${key}`);this.latches.clear();}});return !this.active();};
    this.mouse=new Guacamole.Mouse(pointerSurface);
    this.mouse.onEach(['mousedown','mouseup','mousemove'],event=>{
      if(!this.active())return;
      this.sendPointer(this.mousePoint?{...event.state,...this.mousePoint}:event.state);
    });
    this.resetTouchEngine();
    listen(surface,'pointerdown',e=>{if(e.pointerType==='touch')return;if(this.mode==='control')this.resume();});
    listen(surface,'focus',()=>{if(this.mode==='control'&&!document.hidden){this.enabled=true;onPause(t('input.active'));}});
    listen(surface,'blur',e=>{if(this.keyboardSurface&&e.relatedTarget===this.keyboardSurface){this.release();return;}this.pause();});
    listen(surface,'compositionstart',()=>this.pause(t('input.localIme')),true);
    listen(window,'blur',()=>this.pause());
    listen(document,'visibilitychange',()=>{if(document.hidden)this.pause();});
    listen(window,'pagehide',()=>this.pause());
  }
  active(){return !!(this.enabled&&this.mode==='control'&&(document.activeElement===this.surface||(this.keyboardSurface&&document.activeElement===this.keyboardSurface))&&!document.hidden);}
  resume(){if(this.mode!=='control'||document.hidden)return;this.surface.focus({preventScroll:true});this.enabled=true;this.onPause(t('input.active'));}
  displayPoint(x,y){if(this.view)return this.view.clientToDisplay(x,y);const box=this.pointerSurface.getBoundingClientRect?.();return box?{x:x-box.left,y:y-box.top}:{x:this.pointer.x,y:this.pointer.y};}
  scalePointer(scale,previous){
    if(!(previous>0&&scale>0)||scale===previous)return;
    const ratio=scale/previous;this.pointer.x*=ratio;this.pointer.y*=ratio;this.wheelPoint.x*=ratio;this.wheelPoint.y*=ratio;
    if(this.mousePoint){this.mousePoint.x*=ratio;this.mousePoint.y*=ratio;}
    if(this.touch?.currentState)Object.assign(this.touch.currentState,this.pointer);
  }
  setTouchMode(mode){if(!['trackpad','touch'].includes(mode)||mode===this.touchMode)return;this.pause();this.touchMode=mode;this.resetTouchEngine();}
  resetTouchEngine(){
    const bridge=new EventTarget(),owner=this;
    Object.defineProperties(bridge,{offsetWidth:{get:()=>owner.client.getDisplay?.().getWidth()*owner.client.getDisplay?.().getScale()||1},
      offsetHeight:{get:()=>owner.client.getDisplay?.().getHeight()*owner.client.getDisplay?.().getScale()||1}});
    this.touchBridge=bridge;
    const Engine=this.touchMode==='touch'?this.Guacamole.Mouse.Touchscreen:this.Guacamole.Mouse.Touchpad;
    this.touch=Engine?new Engine(bridge):null;
    if(!this.touch)return;
    if(this.touch.currentState)Object.assign(this.touch.currentState,this.pointer);
    this.touch.onEach(['mousedown','mouseup','mousemove'],event=>{
      if(!this.active())return;
      this.sendPointer(event.state,true);
      if(this.touchMode==='trackpad')this.view?.follow(this.pointer.x,this.pointer.y);
    });
  }
  bridgeTouch(type,points){
    const event=new Event(type,{cancelable:true});Object.assign(event,{touches:points,changedTouches:points});
    this.touchBridge.dispatchEvent(event);
  }
  handleTouch(type,event){
    if(!event.touches){if(this.mode!=='control')event.stopPropagation();return;}
    event.stopImmediatePropagation();event.stopPropagation();
    if(this.mode!=='control'&&(!this.view||(this.view.mode==='actual'&&event.touches.length<=1&&this.gestures.kind==='idle'&&!this.gestures.blocked)))return;
    event.preventDefault();this.ghostUntil=this.clock()+800;
    if(type==='touchstart'&&this.gestures.kind==='idle'){
      this.resume();this.resetTouchEngine();
      if(this.mode==='control'&&this.touchMode==='trackpad'&&event.touches.length===1)this.bridgeTouch('touchstart',Array.from(event.touches));
    }
    this.touchPoints=Array.from(event.touches);this.cancel(this.touchTimer);this.touchTimer=null;
    if(this.mode==='control'&&!this.active()){this.cancelTouch();return;}
    this.touchActions(this.gestures.update(type.slice(5),this.touchPoints,this.clock(),{mode:this.touchMode,zoomed:this.view?.zoomed??false}));
    if(this.mode==='control'&&this.gestures.kind==='pending'&&this.touchPoints.length===1&&this.touchMode==='touch')this.touchTimer=this.schedule(()=>{
      this.touchTimer=null;if(this.active())this.touchActions(this.gestures.update('hold',this.touchPoints,this.clock(),{mode:this.touchMode,zoomed:this.view?.zoomed??false}));
    },Math.max(0,HOLD_MS-(this.clock()-this.gestures.started)));
    if(!this.touchPoints.length)this.resetTouchEngine();
  }
  discardPending(){
    this.cancel(this.wheelTimer);this.wheelTimer=null;this.wheelPixels=0;this.client.discardPending?.();
  }
  touchActions(actions){
    for(const action of actions){
      if(action.type==='local-start'){this.discardPending();this.releasePointer();}
      else if(action.type==='pinch'&&this.view){
        this.discardPending();
        const anchor=this.view.localPoint(action.point.x,action.point.y),origin=this.view.localPoint(action.origin.x,action.origin.y);
        this.view.pinch({anchor,origin,scale:this.view.snapshot().scale*action.ratio});
      }
      else if(action.type==='pan')this.view?.pan(action.dx,action.dy);
      else if(!this.active())continue;
      else if(action.type==='scroll')this.wheel({deltaY:action.dy,clientX:action.point.x,clientY:action.point.y});
      else if(action.type==='release')this.releasePointer();
      else if(action.type==='tap'||action.type==='hold'){
        if(this.touchMode==='touch')this.touch?.move?.(this.displayPoint(action.point.x,action.point.y));
        if(action.type==='hold')this.touch?.press?.('left');else this.touch?.click?.(action.button);
      }
      else if(action.type==='move'){
        if(this.touchMode==='trackpad')this.bridgeTouch('touchmove',this.touchPoints);
        else this.touch?.move?.(this.displayPoint(action.point.x,action.point.y));
      }
    }
  }
  releasePointer(){
    const s=this.pointer;
    if(this.mode==='control'&&(s.left||s.middle||s.right||s.up||s.down))this.run(()=>this.client.sendMouseState(new this.Guacamole.Mouse.State(s.x,s.y,false,false,false,false,false),true));
    this.pointer=new this.Guacamole.Mouse.State(s.x,s.y,false,false,false,false,false);
    if(this.touch?.currentState)Object.assign(this.touch.currentState,this.pointer);
  }
  cancelTouch(){this.cancel(this.touchTimer);this.touchTimer=null;this.touchPoints=[];this.gestures.reset();this.resetTouchEngine();}
  setKeyboardSurface(node){
    if(node===this.keyboardSurface)return;
    this.release();for(const dispose of this.keyboardDisposers)dispose();this.keyboardDisposers=[];this.keyboardSurface=node;this.enabled=false;
    if(!node)return;
    const focus=()=>{if(this.mode==='control'&&!document.hidden){this.enabled=true;this.onPause(t('input.active'));}},blur=()=>this.pause();
    node.addEventListener('focus',focus);node.addEventListener('blur',blur);
    this.keyboardDisposers.push(()=>node.removeEventListener('focus',focus),()=>node.removeEventListener('blur',blur));
  }
  consumeLatches(){for(const key of this.latches)this.keys.up(`latch:${key}`);this.latches.clear();}
  text(value){
    if(!this.active()||this.keys.snapshot().sources.some(source=>source.physical)||typeof value!=='string'||![...value].every(char=>{const n=char.codePointAt(0);return n>=32&&n<=255&&!(n>=127&&n<160);}))return false;
    for(const char of value)this.textKey(`keysym:${char.codePointAt(0)}`);return true;
  }
  textKey(key){
    if(!this.active()||!/^keysym:\d+$/.test(key))return false;
    const keysym=Number(key.slice(7));if(!Number.isSafeInteger(keysym)||keysym<1||keysym>0xffff)return false;
    if(this.keys.snapshot().sources.some(source=>source.physical))return false;
    this.run(()=>{this.keys.down('soft:key',key,{physical:false});this.keys.up('soft:key');this.consumeLatches();});return !this.failed;
  }
  run(fn){if(this.failed)return;try{fn();}catch{this.failed=true;this.protocolCounts.clear();this.enabled=false;this.onFailure('INPUT_FAILURE');}}
  /** Replace the Command keysym for this page only; held keys are released with the old mapping first. */
  setCommandKey(name) {
    if(!Object.hasOwn(COMMAND_KEY_CANDIDATES,name))return;
    this.pause();this.keysyms={...this.serverKeysyms};
    const pair=COMMAND_KEY_CANDIDATES[name];if(pair){this.keysyms.CommandLeft=pair[0];this.keysyms.CommandRight=pair[1];}
  }
  setScrollSpeed(speed){if(Object.hasOwn(SCROLL_SPEEDS,speed))this.pixelsPerClick=SCROLL_SPEEDS[speed];}
  /** Pixels (lines and pages normalized) accumulate with their remainder; clicks leave at a bounded rate and excess waits. */
  wheel(event) {
    const unit=event.deltaMode===1?PIXELS_PER_LINE:event.deltaMode===2?PIXELS_PER_PAGE:1,limit=WHEEL_BACKLOG_CLICKS*this.pixelsPerClick;
    this.wheelPixels=Math.max(-limit,Math.min(limit,this.wheelPixels+(Number.isFinite(event.deltaY)?event.deltaY:0)*unit));
    const box=this.pointerSurface.getBoundingClientRect?.();
    this.wheelPoint=box?this.displayPoint(event.clientX,event.clientY):{x:this.pointer.x,y:this.pointer.y};
    if(this.onWheel){
      // Pixel scrolling (host agent): hand the travel over as pixels; the receiver paces it. The speed setting scales it around 1:1 at the default.
      const pixels=(Number.isFinite(event.deltaY)?event.deltaY:0)*unit*SCROLL_SPEEDS[DEFAULT_SCROLL_SPEED]/this.pixelsPerClick;
      this.wheelPixels=0;this.run(()=>this.onWheel(this.wheelPoint.x,this.wheelPoint.y,pixels));return;
    }
    this.flushWheel();
  }
  flushWheel() {
    this.cancel(this.wheelTimer);this.wheelTimer=null;
    if(!this.active()){this.wheelPixels=0;return;}
    const now=this.clock();
    this.wheelTokens=Math.min(WHEEL_BURST,this.wheelTokens+(now-this.wheelStamp)*WHEEL_CLICKS_PER_SECOND/1000);this.wheelStamp=now;
    while(Math.abs(this.wheelPixels)>=this.pixelsPerClick&&this.wheelTokens>=1) {
      const up=this.wheelPixels<0,{x,y}=this.wheelPoint,State=this.Guacamole.Mouse.State;
      this.wheelPixels+=up?this.pixelsPerClick:-this.pixelsPerClick;this.wheelTokens--;
      this.sendPointer(new State(x,y,this.pointer.left,this.pointer.middle,this.pointer.right,up,!up));
      this.sendPointer(new State(x,y,this.pointer.left,this.pointer.middle,this.pointer.right,false,false));
    }
    if(Math.abs(this.wheelPixels)>=this.pixelsPerClick)this.wheelTimer=this.schedule(()=>this.flushWheel(),Math.ceil(1000/WHEEL_CLICKS_PER_SECOND));
  }
  /** Bounds touch scroll clicks (press+release pairs from Guacamole.Mouse.Touchpad); a dropped press also drops its release. */
  scrollAllowed(state){
    const press=(state.up&&!this.pointer.up)||(state.down&&!this.pointer.down);
    if(!press){const releaseOfDropped=this.droppedWheelPress&&!state.up&&!state.down;if(releaseOfDropped)this.droppedWheelPress=false;return !releaseOfDropped;}
    const now=this.clock();
    if(now-this.scrollWindowStart>=SCROLL_WINDOW_MS){this.scrollWindowStart=now;this.scrollClicks=0;}
    if(++this.scrollClicks>SCROLL_MAX_CLICKS){this.droppedWheelPress=true;return false;}
    return true;
  }
  sendPointer(state,limitScroll=false){
    if(limitScroll&&!this.scrollAllowed(state))return;
    const display=this.client.getDisplay(),scale=display.getScale();
    const x=Math.max(0,Math.min(state.x,Math.max(0,(display.getWidth()-1)*scale))),y=Math.max(0,Math.min(state.y,Math.max(0,(display.getHeight()-1)*scale)));
    this.pointer=new this.Guacamole.Mouse.State(x,y,state.left,state.middle,state.right,state.up,state.down);
    this.run(()=>this.client.sendMouseState(this.pointer,true));
  }
  start(mode){this.mode=mode;this.enabled=false;this.surface.setAttribute?.('data-mode',mode);this.onPause(mode==='view'?t('input.viewOnly'):t('input.clickToControl'));}
  /** Ends a held Command+V: send the local text first (when there is any), then the V that pastes it. Nothing is queued or replayed. */
  settlePaste(text){
    const hold=this.pasteHold;if(!hold)return;
    this.pasteHold=null;this.cancel(hold.timer);
    const paste=()=>{if(this.active()&&this.metaHeld)this.run(()=>{this.keys.down('paste:v','keysym:118',{physical:false});this.keys.up('paste:v');});};
    if(text===''){paste();return;}   // nothing textual locally (or no paste event): behave like a plain Command+V on the Mac
    let sent;try{sent=this.onPasteText(text);}catch(error){sent=Promise.reject(error);}
    Promise.resolve(sent).then(paste,error=>this.onPause(t(error?.message==='CLIPBOARD_TOO_LARGE'?'clipboard.tooLarge':'input.pasteFailed')));
  }
  release(){
    this.cancelTouch();this.metaHeld=false;this.pasteKeyHeld=false;if(this.pasteHold){this.cancel(this.pasteHold.timer);this.pasteHold=null;}
    this.cancel(this.wheelTimer);this.wheelTimer=null;this.wheelPixels=0;
    this.run(()=>this.keys.releaseAll());this.latches.clear();this.leftAltPhysical=false;this.altGraph=false;this.keyboard.reset();
    this.releasePointer();
    this.client.releaseAll?.();   // host agent: also drop anything the sender still holds back
  }
  pause(message=this.mode==='view'?t('input.viewOnly'):t('input.paused')){this.release();this.enabled=false;this.onPause(message);}
  setProfile(profile){this.pause();this.run(()=>this.keys.setProfile(profile));}
  toggle(key){
    if(this.mode!=='control')return;
    this.run(()=>{const source=`latch:${key}`;if(this.latches.has(key)){this.keys.up(source);this.latches.delete(key);}else{this.keys.down(source,key,{physical:false});this.latches.add(key);}});
  }
  chord(name){if(this.mode!=='control'||!Object.hasOwn(CHORDS,name))return;
    if(this.keys.snapshot().sources.some(e=>e.physical)){this.onPause(t('input.releasePhysical'));return;}
    this.run(()=>this.keys.virtualChord(CHORDS[name]));this.release();}
  virtual(key){if(this.mode!=='control')return;this.run(()=>this.keys.virtualChord([key]));this.release();}
  dispose(){this.pause();for(const fn of this.keyboardDisposers)fn();this.keyboardDisposers=[];this.keyboardSurface=null;this.keyboard.onkeydown=null;this.keyboard.onkeyup=null;for(const fn of this.disposers)fn();}
}
