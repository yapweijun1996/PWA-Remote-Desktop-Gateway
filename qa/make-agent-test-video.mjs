/**
 * Builds the synthetic H.264 clip the agent browser check streams (gateway/src/test/resources/agent-test-video.json).
 * ffmpeg's built-in test pattern, never a capture of any screen. Output matches the host agent's stream: Main profile, no
 * B-frames, one keyframe per clip, AVCC access units plus an avcC description. Usage: node qa/make-agent-test-video.mjs
 */
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import path from 'node:path';

const WIDTH=640,HEIGHT=360,FRAMES=30,FPS=15;
const dir=mkdtempSync(path.join(tmpdir(),'rdg-test-video-')),file=path.join(dir,'clip.h264');
const args=['-hide_banner','-loglevel','error','-f','lavfi','-i',`testsrc2=size=${WIDTH}x${HEIGHT}:rate=${FPS}`,'-frames:v',String(FRAMES),'-c:v','libx264','-profile:v','main','-level','4.0','-pix_fmt','yuv420p',
  '-bf','0','-b:v','500k','-maxrate','800k','-bufsize','800k','-x264-params',`keyint=${FRAMES}:min-keyint=${FRAMES}:scenecut=0:aud=1:repeat-headers=1`,'-f','h264',file];
execFileSync('ffmpeg',args);
const version=execFileSync('ffmpeg',['-version']).toString().split('\n')[0];
const stream=readFileSync(file);rmSync(dir,{recursive:true,force:true});

// Annex B: split on start codes, then group NAL units into access units at each access unit delimiter (type 9).
const nals=[];let start=-1;
for(let i=0;i+3<=stream.length;i++){
  if(stream[i]===0&&stream[i+1]===0&&(stream[i+2]===1||(stream[i+2]===0&&stream[i+3]===1))){
    if(start>=0)nals.push(stream.subarray(start,i));
    const length=stream[i+2]===1?3:4;i+=length-1;start=i+1;
  }
}
nals.push(stream.subarray(start));
let sps=null,pps=null;const units=[];
for(const nal of nals) {
  const type=nal[0]&0x1f;
  if(type===9)units.push({key:false,parts:[]});
  else if(type===7)sps??=nal;
  else if(type===8)pps??=nal;
  else if(type===1||type===5){const unit=units.at(-1);if(type===5)unit.key=true;unit.parts.push(nal);}
}
if(!sps||!pps||units.length!==FRAMES||!units[0].key||units.slice(1).some(unit=>unit.key))throw new Error('Unexpected clip structure');
const avcc=Buffer.concat([Buffer.from([1,sps[1],sps[2],sps[3],0xff,0xe1,sps.length>>8,sps.length&255]),sps,Buffer.from([1,pps.length>>8,pps.length&255]),pps]);
const frames=units.map(unit=>({key:unit.key,data:Buffer.concat(unit.parts.map(nal=>Buffer.concat([Buffer.from([nal.length>>>24,(nal.length>>16)&255,(nal.length>>8)&255,nal.length&255]),nal]))).toString('base64')}));
const codec='avc1.'+[sps[1],sps[2],sps[3]].map(byte=>byte.toString(16).padStart(2,'0')).join('').toUpperCase();
const out={generator:'qa/make-agent-test-video.mjs',ffmpeg:version,command:'ffmpeg '+args.join(' '),width:WIDTH,height:HEIGHT,fps:FPS,codec,avcc:avcc.toString('base64'),frames};
writeFileSync(new URL('../gateway/src/test/resources/agent-test-video.json',import.meta.url),JSON.stringify(out));
console.log(`${FRAMES} frames, ${codec}, ${frames.reduce((sum,frame)=>sum+Buffer.from(frame.data,'base64').length,0)} bytes`);
