import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
import {ViewZoom,fitScale,boundOffset,anchoredZoom,clientToDisplay} from './view-zoom.mjs';
function fixture(){
  const surface={clientWidth:500,clientHeight:400,scrollLeft:0,scrollTop:0,getBoundingClientRect:()=>({left:10,top:20})},capture={style:{},setAttribute(){}},element={style:{},getBoundingClientRect:()=>({left:10+view.state.x,top:20+view.state.y})},scales=[];
  const view=new ViewZoom({surface,capture,element,size:()=>({width:1000,height:600}),applyScale:s=>scales.push(s)});view.fit();return {surface,capture,element,view,scales};
}
test('fit centers letterboxing; anchored pinch preserves native point and clamps at fit..4fit',()=>{
  assert.equal(fitScale(1000,600,500,400),0.5);const f=fixture();assert.deepEqual([f.view.state.scale,f.view.state.x,f.view.state.y],[0.5,0,50]);
  const anchor={x:200,y:200},before=f.view.state,native={x:(anchor.x-before.x)/before.scale,y:(anchor.y-before.y)/before.scale};
  f.view.pinch({anchor,scale:1});assert.equal((anchor.x-f.view.state.x)/f.view.state.scale,native.x);assert.equal((anchor.y-f.view.state.y)/f.view.state.scale,native.y);
  f.view.pinch({anchor,scale:99});assert.equal(f.view.state.scale,2);f.view.pinch({anchor,scale:0.01});assert.equal(f.view.state.scale,0.5);
  assert.equal(boundOffset(-900,1000,500),-500);assert.equal(boundOffset(100,1000,500),0);
});
test('moving pinch centroid anchors previous centroid while panning and fit reset discards local transform',()=>{
  const f=fixture();f.view.pinch({anchor:{x:200,y:200},scale:1});const old=f.view.snapshot();
  f.view.pinch({origin:{x:200,y:200},anchor:{x:220,y:230},scale:1.1});
  assert.ok(Math.abs((220-f.view.state.x)/1.1-(200-old.x)/old.scale)<1e-9);assert.ok(Math.abs((230-f.view.state.y)/1.1-(200-old.y)/old.scale)<1e-9);
  f.view.pan(-999,-999);assert.equal(f.view.state.x,500-1100);assert.equal(f.view.state.y,400-660);
  f.view.reset();assert.deepEqual([f.view.state.scale,f.view.state.x,f.view.state.y],[0.5,0,50]);assert.equal(f.view.zoomed,false);
});
test('viewport resize preserves zoom factor, follow keeps relative cursor visible, actual retains scroll extent',()=>{
  const f=fixture();f.view.pinch({anchor:{x:250,y:200},scale:1});f.surface.clientWidth=400;f.surface.clientHeight=300;f.view.resize();assert.equal(f.view.snapshot().zoom,2);assert.equal(f.view.state.scale,0.8);
  f.view.follow(790,470);assert.ok(f.view.state.x+790<=400);assert.ok(f.view.state.y+470<=300);
  f.view.fit('actual');assert.equal(f.view.state.scale,1);assert.equal(f.capture.style.minWidth,'1000px');assert.equal(f.capture.style.minHeight,'600px');assert.equal(f.element.style.position,'relative');assert.equal(f.view.state.x,0);
});
test('actual pinned Guacamole offset mapping and Client scale division establish scaled-coordinate boundary',()=>{
  const document={body:{offsetLeft:0,offsetTop:0,scrollLeft:0,scrollTop:0},documentElement:{scrollLeft:0,scrollTop:0}},context=vm.createContext({window:{},document});
  vm.runInContext(readFileSync(new URL('../vendor/all.min.js',import.meta.url),'utf8'),context);const G=context.Guacamole;
  const parent={offsetLeft:30,offsetTop:40,scrollLeft:5,scrollTop:7,offsetParent:document.body},element={offsetLeft:10,offsetTop:20,offsetParent:parent};
  const vendor=G.Position.fromClientPosition(element,235,153);assert.equal(vendor.x,200);assert.equal(vendor.y,100);
  // Offset traversal does not see a translated root: boundingClientRect must be the local presentation boundary.
  const point=clientToDisplay({x:235,y:153},{left:35-60,top:53-30});assert.deepEqual(point,{x:260,y:130});
  const sent=[],cursor=[];G.Display=class{getScale(){return 0.5;}moveCursor(x,y){cursor.push([x,y]);}cancel(){}flush(fn){fn?.();}};
  const client=new G.Client({sendMessage:(...args)=>sent.push(args)});client.importState({currentState:3,currentTimestamp:0,layers:{}});
  client.sendMouseState(new G.Mouse.State(point.x,point.y,false,false,false,false,false),true);
  assert.deepEqual(sent,[['mouse',520,260,0]]);assert.deepEqual(cursor,[[520,260]]);
  const state={width:1000,height:600,viewportWidth:500,viewportHeight:400,fit:0.5,scale:0.5,x:0,y:50};assert.equal(anchoredZoom(state,9,{x:200,y:200}).scale,2);
});

test('pinching from scrolled Actual preserves the anchor and switches to clipped local presentation',()=>{
  const f=fixture();f.view.fit('actual');f.surface.scrollLeft=200;f.surface.scrollTop=100;
  f.view.pinch({anchor:{x:250,y:200},scale:1.2});
  assert.equal(f.view.mode,'fit');assert.equal(f.surface.scrollLeft,0);assert.equal(f.surface.scrollTop,0);
  assert.equal((250-f.view.state.x)/1.2,450);assert.equal((200-f.view.state.y)/1.2,300);assert.equal(f.capture.style.overflow,'hidden');
});
