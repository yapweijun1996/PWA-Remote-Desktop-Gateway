import {t} from './i18n.mjs';
import {RemoteInput} from './input.mjs';

/** Official Guacamole display, keyboard, pointer, tunnel and clipboard objects. */
export class DesktopAdapter {
  constructor({surface,profile,keysyms,onState,onFailure,onInput,onClipboard,clipboard}) {
    this.surface=surface;this.clipboard=clipboard;this.onFailure=onFailure;
    this.tunnel=null;this.client=null;this.input=null;
    this.options={surface,profile,keysyms,onPause:onInput,onFailure};this.onState=onState;this.onClipboard=onClipboard;
  }
  connect(intentId,mode){
    const G=globalThis.Guacamole;
    this.tunnel=new G.WebSocketTunnel(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/ws/sessions/${intentId}`);
    this.client=new G.Client(this.tunnel);
    this.display=this.client.getDisplay();
    const capture=document.createElement('div');capture.className='capture';capture.tabIndex=0;capture.setAttribute('role','application');capture.setAttribute('aria-label',t('workspace.surfaceLabel'));
    capture.append(this.display.getElement());this.surface.replaceChildren(capture);
    this.input=new RemoteInput({...this.options,surface:capture,pointerSurface:this.display.getElement(),client:this.client,Guacamole:G});
    this.client.onerror=()=>this.onFailure('TARGET_UNAVAILABLE');
    this.tunnel.onerror=()=>this.onFailure('TRANSPORT_ERROR');
    this.client.onstatechange=state=>{
      if(state===3){this.input.start(mode);this.fit();this.onState('CONNECTED');}
      if(state===5)this.onFailure('DISCONNECTED');
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
    if(new TextEncoder().encode(text).length>16384)throw new Error('CLIPBOARD_TOO_LARGE');
    const writer=new globalThis.Guacamole.StringWriter(this.client.createClipboardStream('text/plain'));
    return new Promise((resolve,reject)=>{
      let timer=setTimeout(()=>{reject(new Error('CLIPBOARD_TIMEOUT'));},5000);
      writer.onack=status=>{if(status.isError()){clearTimeout(timer);reject(new Error('CLIPBOARD_UNAVAILABLE'));}else{clearTimeout(timer);resolve();}};
      writer.sendText(text);writer.sendEnd();
    });
  }
  disconnect(){
    this.input?.dispose();this.input=null;
    if(this.client){this.client.onerror=null;this.client.onstatechange=null;this.client.onclipboard=null;this.client.disconnect();}
    if(this.tunnel)this.tunnel.onerror=null;
    this.client=null;this.tunnel=null;this.display=null;this.surface.replaceChildren();
  }
}
