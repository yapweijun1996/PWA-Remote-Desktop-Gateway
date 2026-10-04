import {t} from './i18n.mjs';
import {RemoteInput} from './input.mjs';
import {TransportMetrics,observeTunnelTransfer} from './transport-metrics.mjs';

/** Official Guacamole display, keyboard, pointer, tunnel and clipboard objects. */
export class DesktopAdapter {
  constructor({surface,profile,keysyms,onState,onFailure,onInput,onClipboard,clipboard}) {
    this.surface=surface;this.clipboard=clipboard;this.onFailure=onFailure;
    this.tunnel=null;this.client=null;this.input=null;
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
    // Pinned Guacamole 1.6.0 decodes image streams with ImageDecoder and never closes the returned VideoFrame; unclosed
    // frames wait for GC and can stall the decoder. Use the library's own Image/data-URI path (its non-WebCodecs fallback).
    const display=this.display;
    display.drawStream=(layer,x,y,stream,mimetype)=>{
      const reader=new G.DataURIReader(stream,mimetype);
      reader.onend=()=>display.draw(layer,x,y,reader.getURI());
    };
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
    const writer=new globalThis.Guacamole.StringWriter(this.client.createClipboardStream('text/plain'));
    return new Promise((resolve,reject)=>{
      let timer=setTimeout(()=>{reject(new Error('CLIPBOARD_TIMEOUT'));},5000);
      writer.onack=status=>{if(status.isError()){clearTimeout(timer);reject(new Error('CLIPBOARD_UNAVAILABLE'));}else{clearTimeout(timer);resolve();}};
      writer.sendText(text);writer.sendEnd();
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
