/**
 * Browser side of the host agent protocol v1 (docs/19). Pure functions: message builders that stay inside the gateway's
 * allowlist and ranges, and the video frame header parser. The gateway validates everything again and ends the session on
 * any violation, so these helpers refuse before anything is sent.
 */
export const AGENT_SUBPROTOCOL='rdg-agent.v1';
export const VIDEO_HEADER_BYTES=14;
export const LIMITS=Object.freeze({coordinate:32767,wheelPixels:4000,clipboardBytes:16384,typeBytes:4096,rawJson:40*1024,minKbps:500,maxKbps:12000});
/** Fixed codes the UI can show (agent, gateway and adapter). Anything else is displayed as a generic failure. */
export const FAILURE_CODES=Object.freeze(['PROTOCOL_UNSUPPORTED','SCREEN_RECORDING_NOT_PERMITTED','NO_DISPLAY','CAPTURE_FAILED','ENCODER_UNAVAILABLE',
  'AGENT_UNAVAILABLE','AGENT_AUTH_FAILED','AGENT_PROTOCOL','AGENT_DISABLED','TRANSPORT_FAILED','INPUT_DENIED','READ_ONLY','RATE_LIMITED','INVALID_PROTOCOL',
  'DECODER_UNSUPPORTED','VIDEO_DECODE_FAILED','VIDEO_UNAVAILABLE','TARGET_UNAVAILABLE','DISCONNECTED','TRANSPORT_ERROR']);
export function failureCode(code){return FAILURE_CODES.includes(code)?code:'TRANSPORT_ERROR';}

const integer=(value,min,max)=>{
  if(!Number.isFinite(value))throw new RangeError('NOT_A_NUMBER');
  return Math.max(min,Math.min(max,Math.round(value)));
};
export const KEYFRAME_MESSAGE=JSON.stringify({t:'kf'});
export const RELEASE_MESSAGE=JSON.stringify({t:'release'});
export const keyMessage=(keysym,down)=>JSON.stringify({t:'k',s:integer(keysym,1,0x1fffffff),d:Boolean(down)});
export const moveMessage=(x,y,mask)=>JSON.stringify({t:'m',x:integer(x,0,LIMITS.coordinate),y:integer(y,0,LIMITS.coordinate),b:integer(mask,0,7)});
/** `dy` in pixels, positive scrolls down. Zero is not a valid wheel message. */
export function wheelMessage(x,y,dy){
  const pixels=integer(dy,-LIMITS.wheelPixels,LIMITS.wheelPixels);
  if(pixels===0)return null;
  return JSON.stringify({t:'w',x:integer(x,0,LIMITS.coordinate),y:integer(y,0,LIMITS.coordinate),dy:pixels});
}
export const rateMessage=kbps=>JSON.stringify({t:'rate',kbps:integer(kbps,LIMITS.minKbps,LIMITS.maxKbps)});
const utf8=text=>new TextEncoder().encode(text).length;
function textMessage(type,text,maxBytes){
  if(typeof text!=='string'||text===''||text.includes('\0')||utf8(text)>maxBytes)throw new RangeError('TEXT_REFUSED');
  const json=JSON.stringify({t:type,text});
  // JSON escaping can grow the message; the gateway ends the session above its raw limit, so refuse here instead.
  if(json.length>LIMITS.rawJson)throw new RangeError('TEXT_REFUSED');
  return json;
}
export const clipboardMessage=text=>textMessage('clip',text,LIMITS.clipboardBytes);
export const typeMessage=text=>textMessage('type',text,LIMITS.typeBytes);

/** Header of a video binary message; null when it is not a frame this client can use. */
export function parseVideoFrame(buffer){
  if(!(buffer instanceof ArrayBuffer)||buffer.byteLength<=VIDEO_HEADER_BYTES)return null;
  const view=new DataView(buffer);
  if(view.getUint8(0)!==1||view.getUint8(1)>1)return null;
  return {key:view.getUint8(1)===1,captureMs:view.getFloat64(2,false),sequence:view.getUint32(10,false),data:new Uint8Array(buffer,VIDEO_HEADER_BYTES)};
}
export function avccBytes(base64){
  if(typeof base64!=='string'||!/^[A-Za-z0-9+/]+={0,2}$/.test(base64))return null;
  return Uint8Array.from(atob(base64),character=>character.charCodeAt(0));
}
