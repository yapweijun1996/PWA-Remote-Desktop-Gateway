import test from 'node:test';import assert from 'node:assert/strict';
import {TouchGestures,HOLD_MS} from './touch-gestures.mjs';
const p=(id,x,y)=>({identifier:id,clientX:x,clientY:y});
test('tentative first finger emits nothing; one and two finger taps use left and right',()=>{
  const g=new TouchGestures();assert.deepEqual(g.update('start',[p(1,20,30)],0),[]);
  assert.deepEqual(g.update('end',[],100),[{type:'tap',button:'left',point:{id:1,x:20,y:30}}]);
  g.update('start',[p(1,20,30)],200);assert.deepEqual(g.update('start',[p(1,20,30),p(2,60,30)],220),[{type:'local-start'}]);
  assert.equal(g.update('end',[p(2,60,30)],250)[0].button,'right');assert.deepEqual(g.update('move',[p(2,100,50)],280),[]);assert.deepEqual(g.update('end',[],300),[]);
});
test('pinch is entirely local including initial tentative finger and never replays a trailing tap',()=>{
  const g=new TouchGestures(),actions=[];actions.push(...g.update('start',[p(1,30,40)],0));actions.push(...g.update('start',[p(1,30,40),p(2,70,40)],30));
  actions.push(...g.update('move',[p(1,10,40),p(2,90,40)],60));assert.deepEqual(actions.map(a=>a.type),['local-start','pinch']);assert.equal(actions[1].ratio,2);
  assert.deepEqual(g.update('end',[p(1,10,40)],90),[]);assert.deepEqual(g.update('end',[],110),[]);
});
test('two finger translation scrolls at fit, pans above fit, and promotes to local pinch without reverting',()=>{
  for(const zoomed of [false,true]){
    const g=new TouchGestures();g.update('start',[p(1,20,20),p(2,60,20)],0,{zoomed});
    const actions=g.update('move',[p(1,20,40),p(2,60,40)],40,{zoomed});assert.equal(actions[0].type,zoomed?'pan':'scroll');
    if(zoomed)assert.equal(actions[0].dy,20);else assert.equal(actions[0].dy,-20);
    assert.equal(g.update('move',[p(1,0,50),p(2,100,50)],50,{zoomed})[0].type,'pinch');
    assert.equal(g.update('move',[p(1,20,60),p(2,60,60)],60,{zoomed})[0].type,'pinch');
  }
});
test('touch hold starts a left drag and cancellation releases exactly that drag',()=>{
  const g=new TouchGestures(),options={mode:'touch'};g.update('start',[p(1,20,20)],0,options);
  assert.deepEqual(g.update('hold',[p(1,20,20)],HOLD_MS-1,options),[]);
  assert.equal(g.update('hold',[p(1,20,20)],HOLD_MS,options)[0].type,'hold');
  const move=g.update('move',[p(1,40,40)],HOLD_MS+20,options)[0];assert.equal(move.type,'move');assert.equal(move.drag,true);
  assert.deepEqual(g.cancel(),[{type:'release'}]);assert.deepEqual(g.cancel(),[]);assert.deepEqual(g.update('end',[],1000,options),[]);
});
test('a second finger releases an owned drag; a third finger and changed identity cancel without replay',()=>{
  const g=new TouchGestures();g.update('start',[p(1,20,20)],0,{mode:'touch'});g.update('hold',[p(1,20,20)],HOLD_MS,{mode:'touch'});
  assert.deepEqual(g.update('start',[p(1,20,20),p(2,60,20)],500).map(a=>a.type),['release','local-start']);
  assert.deepEqual(g.update('start',[p(1,20,20),p(2,60,20),p(3,90,20)],520),[]);assert.deepEqual(g.update('end',[p(1,20,20)],530),[]);g.update('end',[],540);
  g.update('start',[p(4,20,20)],600);assert.deepEqual(g.update('move',[p(5,40,40)],620),[]);assert.deepEqual(g.update('end',[],650),[]);
});

test('partial cancellation and replacement of a multi-touch identifier suppress the entire remaining contact',()=>{
  const g=new TouchGestures();g.update('start',[p(1,20,20),p(2,60,20)],0);
  assert.deepEqual(g.update('cancel',[p(1,20,20)],10),[]);assert.deepEqual(g.update('move',[p(1,50,50)],20),[]);assert.deepEqual(g.update('end',[],30),[]);
  g.update('start',[p(3,20,20),p(4,60,20)],40);assert.deepEqual(g.update('move',[p(3,10,20),p(5,90,20)],50),[]);assert.deepEqual(g.update('end',[],60),[]);
});

test('first movement after a stationary hold begins dragging even without a separate timer tick',()=>{
  const g=new TouchGestures();g.update('start',[p(1,20,20)],0,{mode:'touch'});
  const actions=g.update('move',[p(1,50,50)],HOLD_MS+10,{mode:'touch'});assert.deepEqual(actions.map(a=>a.type),['hold','move']);assert.equal(actions[1].drag,true);
});
