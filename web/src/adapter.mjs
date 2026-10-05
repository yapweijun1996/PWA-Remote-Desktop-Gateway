import {t} from './i18n.mjs';
import {RemoteInput} from './input.mjs';
import {TransportMetrics,observeTunnelTransfer} from './transport-metrics.mjs';

/**
 * Pinned Guacamole 1.6.0 decodes image streams with ImageDecoder and never closes the returned VideoFrame: unclosed frames
 * wait for GC and can stall the decoder. Measured on real Display with distinct 1280x800 PNG frames: the library path takes
 * ~1.9 ms/frame, its Image + data-URI fallback ~5.3 ms, BlobReader ~10.8 ms (byte-wise JS base64) and ArrayBufferReader +
 * Blob + drawBlob ~1.0 ms, which needs native Uint8Array.fromBase64. Use that where available, else the data-URI fallback.
 * The draw task is queued when the stream ends, which still precedes every later drawing instruction.
 */
export function useFastImageStreams(display,G,nativeBase64=typeof Uint8Array.fromBase64==='function') {
  if(nativeBase64)display.drawStream=(layer,x,y,stream,mimetype)=>{
    const chunks=[],reader=new G.ArrayBufferReader(stream);
    reader.ondata=buffer=>chunks.push(buffer);
    reader.onend=()=>display.drawBlob(layer,x,y,new Blob(chunks,{type:mimetype}));
  };
  else display.drawStream=(layer,x,y,stream,mimetype)=>{
    const reader=new G.DataURIReader(stream,mimetype);
    reader.onend=()=>display.draw(layer,x,y,reader.getURI());
  };
}

/** Official Guacamole display, keyboard, pointer, tunnel and clipboard objects. */
export class DesktopAdapter {
  backend='vnc';
  constructor({surface,profile,keysyms,onState,onFailure,onInput,onClipboard,clipboard}) {
    this.surface=surface;this.clipboard=clipboard;this.onFailure=onFailure;
    this.tunnel=null;this.client=null;this.input=null;this.clipboardSettleMs=300;
    this.metrics=null;this.stopMetrics=null;
    this.options={surface,profile,keysyms,onPause:onInput,onFailure};this.onState=onState;this.onClipboard=onClipboard;
  }
  connect(intentId,mode){
    const G=globalThis.Guacamole;
    this.tunnel=new G.WebSocketTunnel(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/ws/sessions/${intentId}`);
    this.client=new G.Client(this.tunnel);
    const tunnel=this.tunnel,send=tunnel.sendMessage;
    // Official Client.disconnect() sends even after a transport close. Drop those
    // unusable sends, while still running official cleanup and its timer teardown.
    tunnel.sendMessage=function(...elements){if(tunnel.isConnected())return send.apply(this,elements);};
    this.display=this.client.getDisplay();
    useFastImageStreams(this.display,G);
    this.display.statisticWindow=5000;
    this.metrics=new TransportMetrics();
    this.stopMetrics=observeTunnelTransfer(this.tunnel,this.metrics,{display:this.display});
    const metrics=this.metrics;
    this.display.onstatistics=statistics=>metrics.displayStatistics(statistics);
    const capture=document.createElement('div');capture.className='capture';capture.tabIndex=0;capture.setAttribute('role','application');capture.setAttribute('aria-label',t('workspace.surfaceLabel'));
    capture.append(this.display.getElement());this.surface.replaceChildren(capture);
    this.input=new RemoteInput({...this.options,surface:capture,pointerSurface:this.display.getElement(),client:this.client,Guacamole:G});
    const failure=reason=>queueMicrotask(()=>{if(this.tunnel===tunnel)this.onFailure(reason);});
    this.client.onerror=()=>failure('TARGET_UNAVAILABLE');
    // Official tunnel invokes onerror before setting CLOSED. Defer app cleanup
    // until that state transition finishes, avoiding sends on a closing socket.
    this.tunnel.onerror=status=>failure(status?.message==='TARGET_UNAVAILABLE'?'TARGET_UNAVAILABLE':'TRANSPORT_ERROR');
    this.client.onstatechange=state=>{
      if(state===3){this.input.start(mode);this.fit();this.onState('CONNECTED');}
      if(state===5)failure('DISCONNECTED');
    };
    this.display.onresize=()=>this.fit();
    this.client.onclipboard=(stream,mimetype)=>{
      if(!this.clipboard || mode!=='control' || mimetype!=='text/plain'){stream.sendAck('UNSUPPORTED',0x0100);return;}
      let total=0,text='';const reader=new G.StringReader(stream);
      reader.ontext=value=>{total+=new TextEncoder().encode(value).length;if(total>16384){text='';stream.sendAck('TOO_LARGE',0x030D);return;}text+=value;};
      reader.onend=()=>{if(total<=16384)this.onClipboard(text);};
    };
    this.onState('CONNECTING');this.client.connect('');
  }
  fit(mode=this.scaleMode??'fit'){
    this.scaleMode=mode;this.input?.pause();
    if(!this.display)return;
    const width=this.display.getWidth(),height=this.display.getHeight();
    if(width&&height)this.display.scale(mode==='actual'?1:Math.min(this.surface.clientWidth/width,this.surface.clientHeight/height));
  }
  sendClipboard(text){
    if(!this.clipboard||!this.client||this.input.mode!=='control')throw new Error('CLIPBOARD_DISABLED');
    // An empty stream would clear the remote clipboard.
    if(text==='')throw new Error('CLIPBOARD_EMPTY');
    if(new TextEncoder().encode(text).length>16384)throw new Error('CLIPBOARD_TOO_LARGE');
    const writer=new globalThis.Guacamole.StringWriter(this.client.createClipboardStream('text/plain')),tunnel=this.tunnel;
    // Waiting for an ack always timed out: the official guacd never acknowledges clipboard streams on success (checked against
    // the reviewed daemon: no ack for clipboard, blob or end, and the text reaches the VNC server within milliseconds), and the
    // official Client frees the stream at sendEnd(), so no later ack could reach onack anyway. A delivered transfer was reported
    // as timed out. The send is complete once everything is written and the tunnel is still connected after a short settle.
    writer.sendText(text);writer.sendEnd();
    return new Promise((resolve,reject)=>{
      setTimeout(()=>{if(tunnel?.isConnected())resolve();else reject(new Error('CLIPBOARD_UNAVAILABLE'));},this.clipboardSettleMs);
    });
  }
  stats(){
    const stats=this.metrics?.snapshot();if(!stats)return null;
    const states=globalThis.Guacamole.Tunnel?.State;
    return {...stats,tunnelState:states&&this.tunnel?.state===states.UNSTABLE?'unstable':this.tunnel?.isConnected()?'open':'closed'};
  }
  disconnect(){
    if(this.client){this.client.onerror=null;this.client.onstatechange=null;this.client.onclipboard=null;}
    if(this.tunnel)this.tunnel.onerror=null;
    this.input?.dispose();this.input=null;
    this.stopMetrics?.();this.stopMetrics=null;
    this.metrics?.dispose();this.metrics=null;
    if(this.display)this.display.onstatistics=null;
    if(this.client)this.client.disconnect();
    this.client=null;this.tunnel=null;this.display=null;this.surface.replaceChildren();
  }
}
