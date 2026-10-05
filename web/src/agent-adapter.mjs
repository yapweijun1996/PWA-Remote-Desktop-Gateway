import {t} from './i18n.mjs';
import {RemoteInput} from './input.mjs';
import {TransportMetrics} from './transport-metrics.mjs';
import {AGENT_SUBPROTOCOL,KEYFRAME_MESSAGE,clipboardMessage,failureCode,LIMITS} from './agent-protocol.mjs';
import {AgentInputSink} from './agent-input.mjs';
import {VideoPipeline} from './agent-video.mjs';

export const CLIPBOARD_RESULT_MS=3000,FIRST_FRAME_MS=10000,STATUS_STALE_MS=3500;

/**
 * Host agent backend (docs/19): H.264 over the gateway's validating relay. Same surface as DesktopAdapter so the app can use
 * either: connect, fit, sendClipboard, stats, disconnect and an `input` (RemoteInput through an AgentInputSink).
 * The agent's `ready` decides the effective capabilities, never the request: a missing Accessibility grant means view only.
 */
export class AgentAdapter {
  backend='agent';
  constructor({surface,profile,keysyms,onState,onFailure,onInput,onClipboard,onReady=()=>{},clipboard,scrollSpeed,deps={}}) {
    this.surface=surface;this.clipboard=clipboard;this.onFailure=onFailure;this.onState=onState;this.onClipboard=onClipboard;this.onReady=onReady;
    this.options={profile,keysyms,onPause:onInput,onFailure};this.onInput=onInput;this.scrollSpeed=scrollSpeed;
    this.deps={WebSocketImpl:globalThis.WebSocket,createCanvas:()=>document.createElement('canvas'),setTimer:(fn,ms)=>setTimeout(fn,ms),clearTimer:id=>clearTimeout(id),now:()=>performance.now(),
      frame:fn=>requestAnimationFrame(fn),cancelFrame:id=>cancelAnimationFrame(id),...deps};
    this.socket=null;this.input=null;this.sink=null;this.video=null;this.metrics=null;this.canvas=null;this.mode='view';this.effective={control:false,clipboard:false};
    this.failed=false;this.ended=false;this.scale=1;this.scaleMode='fit';this.dimensions={width:0,height:0};this.clipboardWait=null;this.firstFrameTimer=null;
    this.lastMessageAt=0;this.serverFps=null;this.clientFps=null;this.lastStatus=null;this.frames=0;this.fpsAt=0;this.secureInput=false;this.rateTimer=null;
  }
  connect(intentId,mode){
    const {WebSocketImpl,now}=this.deps;
    this.mode=mode;this.metrics=new TransportMetrics({now});
    const protocol=globalThis.location?.protocol==='https:'?'wss':'ws';
    const socket=new WebSocketImpl(`${protocol}://${globalThis.location.host}/ws/agent/${intentId}`,AGENT_SUBPROTOCOL);
    socket.binaryType='arraybuffer';this.socket=socket;this.lastMessageAt=now();
    socket.onmessage=event=>{if(this.socket===socket)this.receive(event.data);};
    // The browser reports no detail for a refused or dropped socket; fixed error text from the gateway arrives before the close.
    socket.onerror=()=>this.fail('TRANSPORT_ERROR');
    socket.onclose=()=>this.fail('DISCONNECTED');
    this.onState('CONNECTING');
    this.firstFrameTimer=this.deps.setTimer(()=>this.fail('VIDEO_UNAVAILABLE'),FIRST_FRAME_MS);
  }
  isOpen(){return this.socket?.readyState===1;}
  send(text){if(this.isOpen()){this.socket.send(text);this.metrics?.record('outbound',text.length);return true;}return false;}
  receive(data){
    this.lastMessageAt=this.deps.now();
    if(typeof data!=='string'){this.metrics?.record('inbound',data.byteLength);this.video?.push(data);return;}
    this.metrics?.record('inbound',data.length);
    let message;try{message=JSON.parse(data);}catch{this.fail('AGENT_PROTOCOL');return;}
    switch(message?.t) {
      case 'ready':this.ready(message);break;
      case 'config':this.video?.configure(message);break;
      case 'status':this.status(message);break;
      case 'clip':this.incomingClipboard(message);break;
      case 'clip-result':this.clipboardResult(message);break;
      case 'error':this.fail(failureCode(message.code));break;
      default:break;
    }
  }
  ready(message){
    if(this.video||this.failed)return;
    // Effective capabilities: what the agent actually granted, within what this connection asked for.
    const control=message.control===true&&this.mode==='control';
    this.effective={control,clipboard:control&&message.clipboard===true&&this.clipboard===true};
    this.dimensions={width:message.width,height:message.height};
    const capture=document.createElement('div');capture.className='capture';capture.tabIndex=0;capture.setAttribute('role','application');capture.setAttribute('aria-label',t('workspace.surfaceLabel'));
    const display=document.createElement('div'),canvas=this.deps.createCanvas();display.className='agent-display';canvas.width=message.width;canvas.height=message.height;
    display.append(canvas);capture.append(display);this.surface.replaceChildren(capture);this.canvas=canvas;
    this.video=new VideoPipeline({canvas,VideoDecoderImpl:this.deps.VideoDecoder,EncodedVideoChunkImpl:this.deps.EncodedVideoChunk,frame:this.deps.frame,cancelFrame:this.deps.cancelFrame,now:this.deps.now,
      requestKeyframe:()=>this.send(KEYFRAME_MESSAGE),onFirstFrame:()=>this.firstFrame(),onFrame:()=>{this.frames++;},onFailure:code=>this.fail(code)});
    this.sink=new AgentInputSink({send:text=>this.socket.send(text),isOpen:()=>this.isOpen(),bufferedAmount:()=>this.socket?.bufferedAmount??0,
      video:()=>({width:this.dimensions.width,height:this.dimensions.height,scale:this.scale}),frame:this.deps.frame,cancelFrame:this.deps.cancelFrame,now:this.deps.now,
      onSent:text=>this.metrics?.record('outbound',text.length)});
    this.input=new RemoteInput({...this.options,surface:capture,pointerSurface:canvas,client:this.sink,Guacamole:globalThis.Guacamole,onWheel:(x,y,dy)=>this.sink.wheel(x,y,dy)});
    if(this.scrollSpeed)this.input.setScrollSpeed(this.scrollSpeed);
    this.input.start(this.effective.control?'control':'view');
    this.fit();
    if(this.mode==='control'&&!this.effective.control)this.onInput(t(message.controlReason==='ACCESSIBILITY_NOT_PERMITTED'?'input.accessibilityMissing':'input.viewOnly'));
    this.onReady({...this.effective,controlReason:message.controlReason});
    this.fpsAt=this.deps.now();
  }
  firstFrame(){
    this.deps.clearTimer(this.firstFrameTimer);this.firstFrameTimer=null;this.metrics?.firstDisplay();
    this.onState('CONNECTED');
  }
  status(message){
    const now=this.deps.now(),elapsed=(now-this.fpsAt)/1000;
    if(this.lastStatus&&elapsed>0){
      this.serverFps=Math.max(0,(message.sent-this.lastStatus.sent)/elapsed);this.clientFps=this.frames/elapsed;
      this.metrics?.displayStatistics({clientFps:this.clientFps,serverFps:this.serverFps,desktopFps:null});
    }
    this.lastStatus={sent:message.sent};this.frames=0;this.fpsAt=now;
    if(message.secureInput!==this.secureInput){
      this.secureInput=message.secureInput===true;
      // macOS blocks synthetic key events while a password field has secure input on; say so instead of looking broken.
      this.onInput(this.secureInput?t('input.secureInput'):t(this.input?.active()?'input.active':'input.paused'));
    }
  }
  incomingClipboard(message){
    if(!this.effective.clipboard||typeof message.text!=='string'||new TextEncoder().encode(message.text).length>LIMITS.clipboardBytes)return;
    this.onClipboard(message.text);
  }
  clipboardResult(message){
    const wait=this.clipboardWait;if(!wait)return;
    this.clipboardWait=null;this.deps.clearTimer(wait.timer);
    if(message.ok===true)wait.resolve();else wait.reject(new Error('CLIPBOARD_UNAVAILABLE'));
  }
  fit(mode=this.scaleMode){
    this.scaleMode=mode;this.input?.pause();
    if(!this.canvas)return;
    const {width,height}=this.dimensions;if(!width||!height)return;
    this.scale=mode==='actual'?1:Math.min(this.surface.clientWidth/width,this.surface.clientHeight/height)||1;
    this.canvas.style.width=`${Math.round(width*this.scale)}px`;this.canvas.style.height=`${Math.round(height*this.scale)}px`;
  }
  sendClipboard(text){
    if(!this.effective.clipboard||!this.isOpen())throw new Error('CLIPBOARD_DISABLED');
    if(text==='')throw new Error('CLIPBOARD_EMPTY');   // an empty transfer would clear the Mac's clipboard
    if(this.clipboardWait)throw new Error('CLIPBOARD_UNAVAILABLE');
    let message;try{message=clipboardMessage(text);}catch{throw new Error('CLIPBOARD_TOO_LARGE');}
    // Unlike VNC, the agent confirms every transfer with clip-result, so a result is awaited rather than assumed.
    return new Promise((resolve,reject)=>{
      const timer=this.deps.setTimer(()=>{if(this.clipboardWait?.timer===timer){this.clipboardWait=null;reject(new Error('CLIPBOARD_TIMEOUT'));}},CLIPBOARD_RESULT_MS);
      this.clipboardWait={timer,resolve,reject};
      if(!this.send(message)){this.clipboardWait=null;this.deps.clearTimer(timer);reject(new Error('CLIPBOARD_UNAVAILABLE'));}
    });
  }
  stats(){
    const stats=this.metrics?.snapshot();if(!stats)return null;
    const quiet=this.deps.now()-this.lastMessageAt>STATUS_STALE_MS;
    return {...stats,tunnelState:!this.isOpen()?'closed':quiet?'unstable':'open',secureInput:this.secureInput};
  }
  fail(code){
    if(this.failed||this.ended)return;
    this.failed=true;
    // The app tears the adapter down through onFailure; run it after the current event finishes, as DesktopAdapter does.
    const socket=this.socket;queueMicrotask(()=>{if(this.socket===socket&&!this.ended)this.onFailure(code);});
  }
  disconnect(){
    this.ended=true;
    this.deps.clearTimer(this.firstFrameTimer);this.firstFrameTimer=null;
    const wait=this.clipboardWait;this.clipboardWait=null;if(wait){this.deps.clearTimer(wait.timer);wait.reject(new Error('CLIPBOARD_UNAVAILABLE'));}
    this.input?.dispose();this.input=null;   // releases keys and buttons first (and sends `release`) while the socket is still open
    this.sink?.dispose();this.sink=null;
    this.video?.close();this.video=null;
    this.metrics?.dispose();this.metrics=null;
    const socket=this.socket;this.socket=null;
    if(socket){socket.onmessage=socket.onerror=socket.onclose=null;try{socket.close(1000);}catch{/* already closing */}}
    this.canvas=null;this.surface.replaceChildren();
  }
}
