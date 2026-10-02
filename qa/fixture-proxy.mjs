/** Disposable loopback HTTPS test edge. Never distribute this as a deployment proxy. */
import https from 'node:https';import http from 'node:http';import {readFileSync} from 'node:fs';
const directory=process.argv[2],port=Number(process.argv[3]);
if(!directory||!Number.isInteger(port))throw new Error('Explicit fixture directory and port required');
const fixture=JSON.parse(readFileSync(`${directory}/proxy.json`));
const headers=incoming=>({...incoming,host:`127.0.0.1:${port}`,'cf-access-jwt-assertion':fixture.assertion});
const server=https.createServer({key:readFileSync(`${directory}/key.pem`),cert:readFileSync(`${directory}/cert.pem`)},(req,res)=>{
  const upstream=http.request({host:'127.0.0.1',port:fixture.port,path:req.url,method:req.method,headers:headers(req.headers)},reply=>{res.writeHead(reply.statusCode,reply.headers);reply.pipe(res);});
  upstream.on('error',()=>{res.writeHead(503);res.end('FIXTURE_UNAVAILABLE');});req.pipe(upstream);
});
server.on('upgrade',(req,socket,head)=>{
  const upstream=http.request({host:'127.0.0.1',port:fixture.port,path:req.url,method:'GET',headers:headers(req.headers)});
  upstream.on('upgrade',(reply,peer,upstreamHead)=>{
    socket.write(`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(reply.headers).map(([k,v])=>`${k}: ${v}`).join('\r\n')}\r\n\r\n`);
    if(head.length)peer.write(head);if(upstreamHead.length)socket.write(upstreamHead);peer.pipe(socket);socket.pipe(peer);
    socket.on('close',()=>peer.destroy());peer.on('close',()=>socket.destroy());
  });upstream.on('response',reply=>{socket.end(`HTTP/1.1 ${reply.statusCode} Denied\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);});upstream.on('error',()=>socket.destroy());upstream.end();
});
server.listen(port,'127.0.0.1',()=>console.log('Disposable HTTPS fixture edge ready.'));
