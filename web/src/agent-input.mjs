import {keyMessage,moveMessage,wheelMessage,RELEASE_MESSAGE} from './agent-protocol.mjs';

/** Pixels one touchpad scroll "click" is worth; the agent's own wheel-click size (Input.pixelsPerWheelClick). */
export const TOUCH_CLICK_PIXELS=15;
/** Gateway limits are fatal (120 wheel messages/s, 1000 messages/s): stay well below them regardless of display refresh rate. */
export const MIN_WHEEL_INTERVAL_MS=16,MIN_MOVE_INTERVAL_MS=8,MAX_BUFFERED_BYTES=16*1024;

/**
 * The client RemoteInput drives for the agent backend. It turns Guacamole-style pointer states into protocol messages and
 * enforces the sending rules: nothing is ever queued or replayed (a closed or busy socket drops moves and wheel input),
 * pointer moves and wheel travel are coalesced to at most one message per interval, key and button changes are never
 * delayed or dropped while the socket is open, and releasing everything also discards whatever was pending.
 */
export class AgentInputSink {
  constructor({send,isOpen,bufferedAmount=()=>0,video,frame=fn=>requestAnimationFrame(fn),cancelFrame=id=>cancelAnimationFrame(id),now=()=>performance.now(),onSent=()=>{}}) {
    this.sendText=send;this.isOpen=isOpen;this.bufferedAmount=bufferedAmount;this.video=video;this.frame=frame;this.cancelFrame=cancelFrame;this.now=now;this.onSent=onSent;
    this.mask=0;this.lastMask=0;this.pointerUp=false;this.pointerDown=false;this.pendingMove=null;this.pendingWheel=0;this.wheelPoint={x:0,y:0};
    this.lastMoveAt=-Infinity;this.lastWheelAt=-Infinity;this.frameId=null;this.closed=false;
  }
  // ---- what RemoteInput calls (Guacamole.Client subset) --------------------------------------------------------------
  getDisplay(){
    const {width,height,scale}=this.video();
    return {getWidth:()=>width,getHeight:()=>height,getScale:()=>scale};
  }
  sendKeyEvent(down,keysym){this.emit(keyMessage(keysym,down));}
  sendMouseState(state){
    const mask=(state.left?1:0)|(state.middle?2:0)|(state.right?4:0),point=this.toVideo(state.x,state.y);
    // Scroll presses (touchpad) become pixel scrolling; only the press edge counts, the release is ignored.
    if(state.up&&!this.pointerUp)this.addWheel(point.x,point.y,-TOUCH_CLICK_PIXELS,true);
    if(state.down&&!this.pointerDown)this.addWheel(point.x,point.y,TOUCH_CLICK_PIXELS,true);
    this.pointerUp=Boolean(state.up);this.pointerDown=Boolean(state.down);
    if(mask!==this.lastMask) {
      // A button change is an event, not a position: never coalesced, and it carries the latest position.
      // lastMask mirrors what the Mac was actually told, so a dropped press is never answered by a stray release.
      this.pendingMove=null;this.lastMoveAt=this.now();if(this.emit(moveMessage(point.x,point.y,mask)))this.lastMask=mask;return;
    }
    this.pendingMove={x:point.x,y:point.y,mask};this.schedule();
  }
  /** RemoteInput's `onWheel` hook: `x`,`y` in element pixels, `dy` in remote pixels (positive scrolls down). */
  wheel(x,y,dy){const point=this.toVideo(x,y);this.addWheel(point.x,point.y,dy,false);}
  /** Called after RemoteInput released keys and buttons (pause, blur, hide, disconnect, profile change). */
  releaseAll(){
    this.pendingMove=null;this.pendingWheel=0;this.lastMask=0;this.pointerUp=this.pointerDown=false;
    this.emit(RELEASE_MESSAGE);
  }
  dispose(){this.closed=true;this.pendingMove=null;this.pendingWheel=0;if(this.frameId!==null)this.cancelFrame(this.frameId);this.frameId=null;}

  // ---- internals -----------------------------------------------------------------------------------------------------
  toVideo(x,y){
    const {width,height,scale}=this.video(),factor=scale>0?scale:1;
    return {x:Math.max(0,Math.min(Math.round(x/factor),Math.max(0,width-1))),y:Math.max(0,Math.min(Math.round(y/factor),Math.max(0,height-1)))};
  }
  addWheel(x,y,dy,immediate){
    if(!Number.isFinite(dy)||dy===0||this.closed)return;
    this.wheelPoint={x,y};this.pendingWheel+=dy;
    // Keep travel bounded while waiting for a frame: more than one message's worth is never useful to replay later.
    this.pendingWheel=Math.max(-4000,Math.min(4000,this.pendingWheel));
    if(immediate)this.flushWheel();else this.schedule();
  }
  schedule(){if(this.frameId===null&&!this.closed)this.frameId=this.frame(()=>{this.frameId=null;this.flush();});}
  flush(){
    if(this.closed)return;
    const now=this.now();
    if(this.pendingMove&&now-this.lastMoveAt>=MIN_MOVE_INTERVAL_MS) {
      const move=this.pendingMove;this.pendingMove=null;this.lastMoveAt=now;
      if(this.bufferedAmount()<=MAX_BUFFERED_BYTES)this.emit(moveMessage(move.x,move.y,move.mask));
    }
    this.flushWheel();
    if(this.pendingMove||Math.abs(this.pendingWheel)>=1)this.schedule();
  }
  flushWheel(){
    if(Math.abs(this.pendingWheel)<1)return;
    const now=this.now();
    if(now-this.lastWheelAt<MIN_WHEEL_INTERVAL_MS){this.schedule();return;}
    const dy=Math.round(this.pendingWheel);
    this.pendingWheel-=dy;this.lastWheelAt=now;
    if(this.bufferedAmount()>MAX_BUFFERED_BYTES){this.pendingWheel=0;return;}   // a slow link drops travel instead of replaying it later
    const message=wheelMessage(this.wheelPoint.x,this.wheelPoint.y,dy);
    if(message)this.emit(message);
  }
  emit(message){
    if(this.closed||!this.isOpen())return false;
    this.sendText(message);this.onSent(message);return true;
  }
}
