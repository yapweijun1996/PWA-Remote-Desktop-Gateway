import test from 'node:test';
import assert from 'node:assert/strict';
import {translateSoftInput,createSoftInputTranslator,setupSoftKeyboard} from './soft-keyboard.mjs';

const edit=(type,inputType,data,extra={})=>({type,inputType,data,cancelable:true,preventDefault(){this.prevented=true;},...extra});
function translationFixture(){
  const sent=[],notices=[];
  const translator=createSoftInputTranslator({onText:text=>sent.push(['text',text]),onKey:key=>sent.push(['key',key]),onUnsupported:()=>notices.push('unsupported')});
  return {translator,sent,notices};
}

test('iOS Unidentified / 229 is not sent; beforeinput commits Latin-1 exactly once',()=>{
  const f=translationFixture();
  f.translator.handle(edit('keydown',undefined,undefined,{key:'Unidentified',keyCode:229}));
  const before=edit('beforeinput','insertText','é');f.translator.handle(before);
  f.translator.handle(edit('input','insertText','é'),'é');
  assert.equal(before.prevented,true);assert.deepEqual(f.sent,[['text','é']]);
  f.translator.resetBoundary();
  f.translator.handle(edit('beforeinput','insertText','é'));f.translator.handle(edit('input','insertText','é'));
  assert.deepEqual(f.sent,[['text','é'],['text','é']],'identical successive characters are distinct edits');
});

test('input-only and non-cancelable beforeinput paths clear duplicates without requiring key codes',()=>{
  const f=translationFixture();
  f.translator.handle(edit('input','insertText',null),'abc');
  const before=edit('beforeinput','insertText','z',{cancelable:false});f.translator.handle(before);
  f.translator.handle(edit('input','insertText','z'),'z');
  assert.equal(before.prevented,undefined);assert.deepEqual(f.sent,[['text','abc'],['text','z']]);
});

test('iOS backward deletion and line break use the existing press/release key path once',()=>{
  const f=translationFixture();
  for(const [type,key] of [['deleteContentBackward','keysym:65288'],['insertLineBreak','keysym:65293'],['insertParagraph','keysym:65293']]){
    f.translator.resetBoundary();f.translator.handle(edit('beforeinput',type,null));f.translator.handle(edit('input',type,null));
    assert.deepEqual(f.sent.at(-1),['key',key]);
  }
  assert.equal(f.sent.length,3);
});

test('hardware Backspace/Enter on the text sink are not duplicated by edit events',()=>{
  const f=translationFixture();
  for(const [key,inputType] of [['Backspace','deleteContentBackward'],['Enter','insertLineBreak']]){
    const event=edit('keydown',undefined,undefined,{key});f.translator.handle(event);
    f.translator.handle(edit('beforeinput',inputType,null));f.translator.handle(edit('input',inputType,null));
    assert.equal(event.prevented,true);
  }
  assert.deepEqual(f.sent,[['key','keysym:65288'],['key','keysym:65293']]);
});

test('composition previews never send and a Latin-1 composition commit sends once',()=>{
  const f=translationFixture();f.translator.handle({type:'compositionstart'});
  f.translator.handle(edit('beforeinput','insertCompositionText','e',{isComposing:true}));
  f.translator.handle(edit('input','insertCompositionText','e',{isComposing:true}));
  assert.deepEqual(f.sent,[]);
  f.translator.handle({type:'compositionend',data:'é'});
  f.translator.handle(edit('beforeinput','insertFromComposition','é'));
  f.translator.handle(edit('input','insertFromComposition','é'));
  assert.deepEqual(f.sent,[['text','é']]);
  f.translator.resetBoundary();f.translator.handle(edit('input','insertText','x'));
  assert.deepEqual(f.sent,[['text','é'],['text','x']]);
});

test('Unicode outside Latin-1 rejects the entire commit, including composition, without prefix send',()=>{
  const f=translationFixture();
  f.translator.handle(edit('beforeinput','insertText','ok你'));f.translator.handle(edit('input','insertText','ok你'));
  f.translator.handle({type:'compositionstart'});f.translator.handle({type:'compositionend',data:'🙂'});
  f.translator.handle(edit('input','insertFromComposition','🙂'));
  assert.deepEqual(f.sent,[]);assert.equal(f.notices.length,2);
  assert.deepEqual(translateSoftInput('insertText','ÿ'),{text:'ÿ'});
  assert.deepEqual(translateSoftInput('insertText','Ā'),{unsupported:true});
});

test('multiline insertText preserves Latin-1 order and translates CRLF to one Enter',()=>{
  const f=translationFixture();f.translator.handle(edit('input','insertText','a\r\nb\nc\rd'));
  assert.deepEqual(f.sent,[['text','a'],['key','keysym:65293'],['text','b'],['key','keysym:65293'],['text','c'],['key','keysym:65293'],['text','d']]);
  assert.equal(translateSoftInput('historyUndo','old text'),null);
});

test('reset discards a partial composition and does not queue or replay it',()=>{
  const f=translationFixture();f.translator.handle({type:'compositionstart'});
  f.translator.handle(edit('input','insertCompositionText','secret',{isComposing:true}));f.translator.reset();
  assert.deepEqual(f.sent,[]);f.translator.handle(edit('input','insertText','a'));assert.deepEqual(f.sent,[['text','a']]);
});

class Node extends EventTarget {
  constructor(doc){super();this.ownerDocument=doc;this.attributes=new Map();this.dataset={};this.children=[];this.hidden=false;this.value='';this.disabled=false;}
  setAttribute(name,value){this.attributes.set(name,value);}
  append(node){node.parent=this;this.children.push(node);}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(child=>child!==this);}
  getBoundingClientRect(){return {height:48};}
  focus(){
    const doc=this.ownerDocument,previous=doc.activeElement;if(previous===this)return;
    doc.activeElement=this;
    if(previous)previous.dispatchEvent(Object.assign(new Event('blur'),{relatedTarget:this}));
    this.dispatchEvent(new Event('focus'));
  }
  blur(){if(this.ownerDocument.activeElement===this){this.ownerDocument.activeElement=null;this.dispatchEvent(new Event('blur'));}}
}
function domFixture(){
  const doc=new EventTarget(),win=new EventTarget(),styles=new Map(),classes=new Set(),sent=[],notices=[];
  Object.assign(doc,{hidden:false,activeElement:null,createElement:()=>new Node(doc),documentElement:{style:{setProperty:(key,value)=>styles.set(key,value)}},body:{classList:{add:key=>classes.add(key),remove:key=>classes.delete(key)}}});
  doc.defaultView=win;win.innerHeight=800;win.visualViewport=new EventTarget();Object.assign(win.visualViewport,{height:800,offsetTop:0});
  const textarea=new Node(doc),row=new Node(doc);
  let input={mode:'control',latches:new Set(),setKeyboardSurface(node){this.surface=node;if(!node)this.latches.clear();},
    active(){return this.mode==='control'&&this.surface===textarea&&doc.activeElement===textarea&&!doc.hidden;},
    text(text){sent.push(['text',text,[...this.latches]]);this.latches.clear();},
    textKey(key){sent.push(['key',key,[...this.latches]]);this.latches.clear();},
    toggle(key){if(this.latches.has(key))this.latches.delete(key);else this.latches.add(key);}};
  let resizeCount=0,profile='mac-native';
  const keyboard=setupSoftKeyboard({textarea,row,getInput:()=>input,onNotice:notice=>notices.push(notice),onResize:()=>resizeCount++,getProfile:()=>profile});
  const dispatch=(event,value='')=>{const {type,...properties}=event;textarea.value=value;textarea.dispatchEvent(Object.assign(new Event(type,{cancelable:true}),properties));};
  const keyButton=key=>row.children.find(button=>button.dataset.softKey===key);
  return {doc,win,styles,classes,sent,notices,textarea,row,keyboard,dispatch,keyButton,getInput:()=>input,
    replaceInput:value=>{input=value;},setProfile:value=>{profile=value;},resizeCount:()=>resizeCount};
}

test('open focuses synchronously with private attributes; input/hide/blur/disconnect clear the sink',()=>{
  const f=domFixture();
  for(const name of ['autocomplete','autocorrect','autocapitalize'])assert.equal(f.textarea.attributes.get(name),'off');
  assert.equal(f.textarea.spellcheck,false);assert.equal(f.textarea.attributes.get('enterkeyhint'),'enter');
  assert.equal(f.keyboard.open(),true);assert.equal(f.doc.activeElement,f.textarea);assert.equal(f.row.hidden,false);
  f.dispatch({type:'input',inputType:'insertText',data:'private'},'private');
  assert.equal(f.textarea.value,'');assert.deepEqual(f.sent,[['text','private',[]]]);
  f.textarea.value='not committed';f.textarea.blur();assert.equal(f.textarea.value,'');assert.equal(f.row.hidden,true);
  f.keyboard.open();f.textarea.value='hidden';f.doc.hidden=true;f.doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(f.textarea.value,'');assert.equal(f.keyboard.open(),false);
  f.doc.hidden=false;f.keyboard.open();f.textarea.value='disconnected';f.replaceInput(null);f.keyboard.refresh();
  assert.equal(f.textarea.value,'');assert.equal(f.row.hidden,true);
  f.dispatch({type:'input',inputType:'insertText',data:'late'},'late');assert.equal(f.sent.length,1);
  f.keyboard.dispose();
});

test('extra modifier row uses existing toggle and text paths, updates one-shot pressed state',()=>{
  const f=domFixture();f.keyboard.open();
  const control=f.keyButton('ControlLeft');control.dispatchEvent(new Event('click'));
  assert.equal(f.getInput().latches.has('ControlLeft'),true);assert.equal(control.attributes.get('aria-pressed'),'true');
  f.dispatch({type:'input',inputType:'insertText',data:'c'},'c');
  assert.deepEqual(f.sent,[['text','c',['ControlLeft']]]);assert.equal(control.attributes.get('aria-pressed'),'false');
  f.keyButton('OptionLeft').dispatchEvent(new Event('click'));f.keyButton('OptionLeft').dispatchEvent(new Event('click'));
  assert.equal(f.getInput().latches.size,0,'second tap unlatches');
  f.keyButton('keysym:65361').dispatchEvent(new Event('click'));assert.deepEqual(f.sent.at(-1),['key','keysym:65361',[]]);
  const down=new Event('pointerdown',{cancelable:true});control.dispatchEvent(down);assert.equal(down.defaultPrevented,true);
  f.keyboard.close();assert.equal(f.getInput().latches.size,0);assert.equal(control.disabled,true);f.keyboard.dispose();
});

test('visual viewport updates layout variables and restores desktop space on close',()=>{
  const f=domFixture();f.keyboard.open();const before=f.resizeCount();
  Object.assign(f.win.visualViewport,{height:450,offsetTop:10});f.win.visualViewport.dispatchEvent(new Event('resize'));
  assert.equal(f.styles.get('--soft-viewport-height'),'450px');assert.equal(f.styles.get('--soft-viewport-top'),'10px');
  assert.equal(f.styles.get('--soft-keyboard-bottom'),'340px');assert.equal(f.styles.get('--soft-keyboard-height'),'48px');
  assert.ok(f.resizeCount()>before);assert.equal(f.classes.has('soft-keyboard-open'),true);
  f.keyboard.close();assert.equal(f.styles.get('--soft-viewport-height'),'800px');assert.equal(f.styles.get('--soft-keyboard-height'),'0px');
  assert.equal(f.classes.has('soft-keyboard-open'),false);f.keyboard.dispose();
});

test('view-only and lost ownership reject opening or sending, dispose removes event handlers',()=>{
  const f=domFixture();f.getInput().mode='view';assert.equal(f.keyboard.open(),false);
  f.getInput().mode='control';f.keyboard.open();f.getInput().mode='view';f.keyboard.refresh();assert.equal(f.row.hidden,true);
  f.getInput().mode='control';f.keyboard.open();f.win.dispatchEvent(new Event('blur'));assert.equal(f.row.hidden,true);
  f.keyboard.dispose();f.dispatch({type:'input',inputType:'insertText',data:'discarded'},'discarded');
  assert.deepEqual(f.sent,[]);assert.equal(f.keyboard.open(),false);assert.equal(f.row.children.length,0);
});
