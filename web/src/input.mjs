import {t} from './i18n.mjs';
import {KeyboardState} from '../../reference/keyboard-state.mjs';

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
export const CHORDS=Object.freeze({copy:['CommandLeft','keysym:99'],paste:['CommandLeft','keysym:118'],
  cut:['CommandLeft','keysym:120'],undo:['CommandLeft','keysym:122'],select:['CommandLeft','keysym:97'],
  save:['CommandLeft','keysym:115'],switch:['CommandLeft','keysym:65289'],search:['CommandLeft','keysym:32']});

/** Touch scrolling: clicks per window (40/s). Far below the gateway's 1000 messages/s hard limit (two messages per click). */
export const SCROLL_WINDOW_MS=250,SCROLL_MAX_CLICKS=10;
/** Wheel travel per remote wheel click. Guacamole's own value is 53 and it discards the remainder after every click. */
export const SCROLL_SPEEDS=Object.freeze({slow:53,normal:30,fast:15});
/** Wheel clicks: 100/s sustained after a burst of 20 (200 messages/s); excess distance waits, capped at 40 clicks. */
export const WHEEL_BURST=20,WHEEL_CLICKS_PER_SECOND=100,WHEEL_BACKLOG_CLICKS=40,PIXELS_PER_LINE=18,PIXELS_PER_PAGE=288;

/** One normalized engine stream attached only to the focused remote surface. */
export class RemoteInput {
  constructor({surface,pointerSurface=surface,client,Guacamole,profile,keysyms,onPause,onFailure,clock=()=>performance.now(),schedule=(fn,ms)=>setTimeout(fn,ms),cancel=id=>clearTimeout(id)}) {
    this.surface=surface;this.client=client;this.Guacamole=Guacamole;this.onPause=onPause;this.onFailure=onFailure;
    this.clock=clock;this.schedule=schedule;this.cancel=cancel;this.pointerSurface=pointerSurface;this.scrollWindowStart=-Infinity;this.scrollClicks=0;this.droppedWheelPress=false;
    this.pixelsPerClick=SCROLL_SPEEDS.normal;this.wheelPixels=0;this.wheelTokens=WHEEL_BURST;this.wheelStamp=-Infinity;this.wheelTimer=null;this.wheelPoint={x:0,y:0};
    this.enabled=false;this.mode='view';this.altGraph=false;this.leftAltPhysical=false;this.latches=new Set();this.disposers=[];
    this.pointer=new Guacamole.Mouse.State(0,0,false,false,false,false,false);this.protocolCounts=new Map();
    this.keys=new KeyboardState({profile,onTransition:({key,down})=>{
      if(this.mode!=='control')return;
      const keysym=encodeKey(key,keysyms),count=this.protocolCounts.get(keysym)??0;
      if(down){this.protocolCounts.set(keysym,count+1);if(count===0)client.sendKeyEvent(1,keysym);}
      else if(count===1){this.protocolCounts.delete(keysym);client.sendKeyEvent(0,keysym);}
      else if(count>1)this.protocolCounts.set(keysym,count-1);
    }});
    const listen=(node,event,fn,capture=false)=>{node.addEventListener(event,fn,capture);this.disposers.push(()=>node.removeEventListener(event,fn,capture));};
    listen(surface,'keydown',e=>{
      this.altGraph=e.getModifierState('AltGraph');
      if(e.code==='AltLeft')this.leftAltPhysical=true;
      // Keep a usable browser keyboard escape, without forwarding a half-owned chord.
      if(e.code==='Escape' && e.shiftKey){e.stopImmediatePropagation();e.preventDefault();this.pause();surface.blur();}
    },true);
    listen(surface,'keyup',e=>{if(e.code==='AltLeft')this.leftAltPhysical=false;},true);
    // Guacamole.Mouse/Touchpad always cancel wheel and touch defaults on the display. Wheel is converted here instead (its own
    // conversion drops the remainder); an inactive surface lets the browser scroll the local viewport (Actual size, view-only).
    listen(surface,'wheel',e=>{e.stopPropagation();if(!this.active())return;e.preventDefault();this.wheel(e);},true);
    for(const type of ['mousewheel','DOMMouseScroll'])listen(surface,type,e=>{e.stopPropagation();if(this.active())e.preventDefault();},true);
    for(const type of ['touchstart','touchmove','touchend','touchcancel'])listen(surface,type,e=>{if(this.mode!=='control')e.stopPropagation();},true);
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
      this.sendPointer(event.state);
    });
    this.touch=new Guacamole.Mouse.Touchpad(pointerSurface);
    this.touch.onEach(['mousedown','mouseup','mousemove'],event=>{
      if(!this.active())return;this.sendPointer(event.state,true);
    });
    listen(surface,'pointerdown',()=>{if(this.mode==='control'){surface.focus({preventScroll:true});this.enabled=true;onPause(t('input.active'));}});
    listen(surface,'focus',()=>{if(this.mode==='control'){this.enabled=true;onPause(t('input.active'));}});
    listen(surface,'blur',()=>this.pause());
    listen(surface,'compositionstart',()=>this.pause(t('input.localIme')),true);
    listen(window,'blur',()=>this.pause());
    listen(document,'visibilitychange',()=>{if(document.hidden)this.pause();});
    listen(window,'pagehide',()=>this.pause());
  }
  active(){return this.enabled&&this.mode==='control'&&document.activeElement===this.surface&&!document.hidden;}
  run(fn){if(this.failed)return;try{fn();}catch{this.failed=true;this.protocolCounts.clear();this.enabled=false;this.onFailure('INPUT_FAILURE');}}
  setScrollSpeed(speed){if(Object.hasOwn(SCROLL_SPEEDS,speed))this.pixelsPerClick=SCROLL_SPEEDS[speed];}
  /** Pixels (lines and pages normalized) accumulate with their remainder; clicks leave at a bounded rate and excess waits. */
  wheel(event) {
    const unit=event.deltaMode===1?PIXELS_PER_LINE:event.deltaMode===2?PIXELS_PER_PAGE:1,limit=WHEEL_BACKLOG_CLICKS*this.pixelsPerClick;
    this.wheelPixels=Math.max(-limit,Math.min(limit,this.wheelPixels+(Number.isFinite(event.deltaY)?event.deltaY:0)*unit));
    const box=this.pointerSurface.getBoundingClientRect?.();
    this.wheelPoint=box?{x:event.clientX-box.left,y:event.clientY-box.top}:{x:this.pointer.x,y:this.pointer.y};
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
  sendPointer(state,limitScroll=false){if(limitScroll&&!this.scrollAllowed(state))return;const display=this.client.getDisplay(),scale=display.getScale();const x=Math.max(0,Math.min(state.x,Math.max(0,display.getWidth()*scale-1))),y=Math.max(0,Math.min(state.y,Math.max(0,display.getHeight()*scale-1)));this.pointer=new this.Guacamole.Mouse.State(x,y,state.left,state.middle,state.right,state.up,state.down);this.run(()=>this.client.sendMouseState(this.pointer,true));}
  start(mode){this.mode=mode;this.enabled=false;this.surface.setAttribute?.('data-mode',mode);this.onPause(mode==='view'?t('input.viewOnly'):t('input.clickToControl'));}
  release(){
    this.cancel(this.wheelTimer);this.wheelTimer=null;this.wheelPixels=0;
    this.run(()=>this.keys.releaseAll());this.latches.clear();this.leftAltPhysical=false;this.altGraph=false;this.keyboard.reset();
    if(this.mode==='control')this.run(()=>{
      const s=this.pointer;this.client.sendMouseState(new this.Guacamole.Mouse.State(s.x,s.y,false,false,false,false,false),true);
    });
    this.pointer=new this.Guacamole.Mouse.State(0,0,false,false,false,false,false);
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
  dispose(){this.pause();this.keyboard.onkeydown=null;this.keyboard.onkeyup=null;for(const fn of this.disposers)fn();}
}
