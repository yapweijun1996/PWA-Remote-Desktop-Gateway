import {readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import path from 'node:path';import {createHash} from 'node:crypto';import {deflateSync} from 'node:zlib';
const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'web/dist');
await rm(out,{recursive:true,force:true});await mkdir(path.join(out,'assets'),{recursive:true});
const manifest={},safe={},built=new Map();
async function asset(source,mime){
  if(built.has(source))return built.get(source);
  let data=await readFile(source);
  if(source.endsWith('.mjs')){
    let text=data.toString();for(const match of [...text.matchAll(/from ['"]([^'"]+)['"]/g)]){
      if(!match[1].startsWith('.'))throw new Error('External import refused');
      const target=await asset(path.resolve(path.dirname(source),match[1]),'text/javascript');text=text.replace(match[0],`from '${target}'`);
    }data=Buffer.from(text);
  }
  const hash=createHash('sha256').update(data).digest('hex').slice(0,16),name=path.basename(source).replace(/\.(mjs|js|css)$/,'');
  const extension=mime==='text/javascript'?'js':mime==='text/css'?'css':'png';const url=`/assets/${name}.${hash}.${extension}`;
  await writeFile(path.join(out,url),data);manifest[url]={type:mime,immutable:true};safe[url]=mime;built.set(source,url);return url;
}
// Reproducible original geometric PNG icons. No external fonts, images or generation service.
function crc(b){let n=0xffffffff;for(const byte of b){n^=byte;for(let j=0;j<8;j++)n=n&1?0xedb88320^(n>>>1):n>>>1;}return(n^0xffffffff)>>>0;}
function chunk(type,data){const t=Buffer.from(type),len=Buffer.alloc(4),check=Buffer.alloc(4);len.writeUInt32BE(data.length);check.writeUInt32BE(crc(Buffer.concat([t,data])));return Buffer.concat([len,t,data,check]);}
function icon(n){const raw=Buffer.alloc((n*4+1)*n);for(let y=0;y<n;y++)for(let x=0;x<n;x++){
  const u=x/n,v=y/n,screen=u>.22&&u<.78&&v>.26&&v<.66,border=screen&&(u<.25||u>.75||v<.29||v>.63),stand=u>.46&&u<.54&&v>.65&&v<.76,base=u>.35&&u<.65&&v>.75&&v<.79;
  const rgba=border||stand||base?[230,250,245,255]:[15,118,110,255];const at=y*(n*4+1)+1+x*4;raw.set(rgba,at);
}const head=Buffer.alloc(13);head.writeUInt32BE(n);head.writeUInt32BE(n,4);head[8]=8;head[9]=6;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',head),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);}
const app=await asset(path.join(root,'web/src/app.mjs'),'text/javascript'),css=await asset(path.join(root,'web/public/styles.css'),'text/css'),guac=await asset(path.join(root,'web/vendor/all.min.js'),'text/javascript');
const icons=[];for(const n of [192,512]){const data=icon(n),hash=createHash('sha256').update(data).digest('hex').slice(0,16),url=`/assets/icon-${n}.${hash}.png`;await writeFile(path.join(out,url),data);manifest[url]={type:'image/png',immutable:true};safe[url]='image/png';icons.push({src:url,sizes:`${n}x${n}`,type:'image/png',purpose:'any maskable'});}
// Browsers may request this conventional URL before a login page has declared an icon.
const faviconData=icon(48),faviconHeader=Buffer.alloc(22);
faviconHeader.writeUInt16LE(1,2);faviconHeader.writeUInt16LE(1,4);
faviconHeader[6]=48;faviconHeader[7]=48;faviconHeader.writeUInt16LE(1,10);faviconHeader.writeUInt16LE(32,12);
faviconHeader.writeUInt32LE(faviconData.length,14);faviconHeader.writeUInt32LE(22,18);
await writeFile(path.join(out,'favicon.ico'),Buffer.concat([faviconHeader,faviconData]));
manifest['/favicon.ico']={type:'image/x-icon',immutable:false};
let html=await readFile(path.join(root,'web/public/index.html'),'utf8');for(const [marker,url]of Object.entries({__APP__:app,__STYLE__:css,__GUAC__:guac,__ICON192__:icons[0].src}))html=html.replaceAll(marker,url);
await writeFile(path.join(out,'index.html'),html);manifest['/index.html']={type:'text/html;charset=UTF-8',immutable:false};
await writeFile(path.join(out,'manifest.webmanifest'),JSON.stringify({id:'/',name:'Remote Desktop Gateway',short_name:'Remote Workspace',start_url:'/',scope:'/',display:'standalone',theme_color:'#101c22',background_color:'#101c22',icons}));manifest['/manifest.webmanifest']={type:'application/manifest+json',immutable:false};
const offline=await readFile(path.join(root,'web/public/offline.html'));await writeFile(path.join(out,'offline.html'),offline);manifest['/offline.html']={type:'text/html',immutable:true};safe['/offline.html']='text/html';
const build=createHash('sha256').update(JSON.stringify(manifest)).update(html).update(offline).update(await readFile(path.join(root,'web/public/sw.template.js'))).digest('hex').slice(0,16);
const worker=(await readFile(path.join(root,'web/public/sw.template.js'),'utf8')).replace('__BUILD__',build).replace('__SAFE_ASSETS__',JSON.stringify(safe));await writeFile(path.join(out,'sw.js'),worker);manifest['/sw.js']={type:'text/javascript',immutable:false};
await writeFile(path.join(out,'asset-manifest.json'),JSON.stringify(manifest,null,2));await writeFile(path.join(out,'build.json'),JSON.stringify({build,assets:Object.keys(manifest).length}));console.log(`Production assets built: ${build}`);
