import {parseVideoFrame,avccBytes} from './agent-protocol.mjs';

export const MAX_DECODE_QUEUE=6,MAX_HELD_FRAMES=8,KEYFRAME_REQUEST_MS=300,MAX_DECODER_ERRORS=5,ERROR_WINDOW_MS=10000;

/**
 * H.264 (AVCC + avcC) to a canvas with WebCodecs. Rules from docs/19: check isConfigSupported before configuring, never let the
 * decode queue grow (drop deltas and ask for a keyframe), reconfigure after any error or new config and wait for a keyframe,
 * keep only the newest decoded frame for the next animation frame, and close every VideoFrame.
 */
export class VideoPipeline {
  constructor({canvas,VideoDecoderImpl=globalThis.VideoDecoder,EncodedVideoChunkImpl=globalThis.EncodedVideoChunk,frame=fn=>requestAnimationFrame(fn),cancelFrame=id=>cancelAnimationFrame(id),
    now=()=>performance.now(),requestKeyframe,onFirstFrame,onFrame=()=>{},onFailure}) {
    this.canvas=canvas;this.context=canvas.getContext('2d');this.Decoder=VideoDecoderImpl;this.Chunk=EncodedVideoChunkImpl;this.frame=frame;this.cancelFrame=cancelFrame;this.now=now;
    this.requestKeyframe=requestKeyframe;this.onFirstFrame=onFirstFrame;this.onFrame=onFrame;this.onFailure=onFailure;
    this.config=null;this.decoder=null;this.configuring=false;this.held=[];this.waitKey=true;this.latest=null;this.frameId=null;this.closed=false;
    this.lastKeyRequest=-Infinity;this.errors=[];this.drawn=0;this.dropped=0;this.firstShown=false;this.generation=0;
  }
  /** New `config` from the agent: validate, (re)create the decoder and wait for the next keyframe. */
  async configure(config) {
    if(this.closed)return;
    const description=avccBytes(config.avcc),generation=++this.generation;
    if(!description||!Number.isInteger(config.width)||!Number.isInteger(config.height)){this.fail('VIDEO_DECODE_FAILED');return;}
    this.configuring=true;this.held=[];
    const decoderConfig={codec:config.codec,description,codedWidth:config.width,codedHeight:config.height,optimizeForLatency:true};
    let supported=false;
    try{supported=Boolean((await this.Decoder.isConfigSupported(decoderConfig)).supported);}catch{supported=false;}
    if(this.closed||generation!==this.generation)return;
    if(!supported){this.configuring=false;this.fail('DECODER_UNSUPPORTED');return;}
    this.config={...config,decoderConfig};
    this.canvas.width=config.width;this.canvas.height=config.height;
    this.open();this.configuring=false;
    const held=this.held;this.held=[];for(const buffer of held)this.push(buffer);
  }
  open() {
    this.closeDecoder();
    this.decoder=new this.Decoder({output:frame=>this.output(frame),error:()=>this.decoderError()});
    this.decoder.configure(this.config.decoderConfig);
    this.waitKey=true;
  }
  /** One binary message from the agent. */
  push(buffer) {
    if(this.closed)return;
    const parsed=parseVideoFrame(buffer);
    if(!parsed){this.fail('VIDEO_DECODE_FAILED');return;}
    if(this.configuring){
      // The keyframe that follows `config` arrives while support is being checked; keep a few instead of paying a round trip.
      if(this.held.length<MAX_HELD_FRAMES)this.held.push(buffer);else{this.held=[];this.dropped++;}
      return;
    }
    if(!this.decoder||this.decoder.state!=='configured')return;
    if(this.waitKey&&!parsed.key){this.dropped++;this.askKeyframe();return;}
    if(this.decoder.decodeQueueSize>MAX_DECODE_QUEUE&&!parsed.key){this.dropped++;this.waitKey=true;this.askKeyframe();return;}
    this.waitKey=false;
    try{this.decoder.decode(new this.Chunk({type:parsed.key?'key':'delta',timestamp:parsed.sequence,data:parsed.data}));}
    catch{this.decoderError();}
  }
  askKeyframe() {
    const now=this.now();
    if(now-this.lastKeyRequest<KEYFRAME_REQUEST_MS)return;
    this.lastKeyRequest=now;this.requestKeyframe();
  }
  decoderError() {
    if(this.closed||!this.config)return;
    const now=this.now();this.errors=this.errors.filter(at=>now-at<ERROR_WINDOW_MS);this.errors.push(now);
    if(this.errors.length>MAX_DECODER_ERRORS){this.fail('VIDEO_DECODE_FAILED');return;}
    // After an error the decoder is closed: start a new one with the same configuration and wait for a keyframe.
    this.open();this.lastKeyRequest=-Infinity;this.askKeyframe();
  }
  output(frame) {
    if(this.closed){frame.close();return;}
    this.latest?.close();this.latest=frame;
    if(this.frameId===null)this.frameId=this.frame(()=>this.draw());
  }
  draw() {
    this.frameId=null;
    const frame=this.latest;this.latest=null;
    if(!frame)return;
    try{this.context.drawImage(frame,0,0);}finally{frame.close();}
    this.drawn++;this.onFrame();
    if(!this.firstShown){this.firstShown=true;this.onFirstFrame();}
  }
  closeDecoder() {
    const decoder=this.decoder;this.decoder=null;
    if(decoder)try{if(decoder.state!=='closed')decoder.close();}catch{/* already closed */}
  }
  fail(code) {if(this.closed)return;this.close();this.onFailure(code);}
  close() {
    if(this.closed)return;
    this.closed=true;this.held=[];this.generation++;
    if(this.frameId!==null)this.cancelFrame(this.frameId);this.frameId=null;
    this.latest?.close();this.latest=null;
    this.closeDecoder();
  }
}
