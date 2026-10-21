const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
export const MAX_ZOOM=4;
export function fitScale(width,height,viewportWidth,viewportHeight){
  return width>0&&height>0&&viewportWidth>0&&viewportHeight>0?Math.min(viewportWidth/width,viewportHeight/height):1;
}
export function boundOffset(offset,extent,viewport){return extent<=viewport?(viewport-extent)/2:clamp(offset,viewport-extent,0);}
/** Coordinates passed to sendMouseState(state,true) are already display-scaled pixels, never native desktop pixels. */
export function clientToDisplay(point,rect){return {x:point.x-rect.left,y:point.y-rect.top};}
export function anchoredZoom(state,scale,anchor,origin=anchor){
  scale=clamp(scale,state.fit,state.fit*MAX_ZOOM);
  const ratio=scale/state.scale;
  return {...state,scale,x:boundOffset(anchor.x-(origin.x-state.x)*ratio,state.width*scale,state.viewportWidth),
    y:boundOffset(anchor.y-(origin.y-state.y)*ratio,state.height*scale,state.viewportHeight)};
}
/** Owns only local presentation. Guacamole (or the agent sink) performs the one protocol scale division. */
export class ViewZoom {
  constructor({surface,capture,element,size,applyScale}){
    Object.assign(this,{surface,capture,element,size,applyScale});this.mode='fit';
    this.state={width:0,height:0,viewportWidth:0,viewportHeight:0,fit:1,scale:1,x:0,y:0};
  }
  get zoomed(){return this.mode!=='actual'&&this.state.scale>this.state.fit*1.001;}
  snapshot(){return {...this.state,mode:this.mode,zoom:this.state.scale/this.state.fit};}
  resize(){
    const old=this.state,{width,height}=this.size(),viewportWidth=this.surface.clientWidth,viewportHeight=this.surface.clientHeight;
    if(!width||!height||!viewportWidth||!viewportHeight)return;
    const fit=fitScale(width,height,viewportWidth,viewportHeight),scale=this.mode==='actual'?1:fit*clamp(old.scale/old.fit,1,MAX_ZOOM);
    const x=old.width?(viewportWidth/2-(old.viewportWidth/2-old.x)*scale/old.scale):(viewportWidth-width*scale)/2;
    const y=old.height?(viewportHeight/2-(old.viewportHeight/2-old.y)*scale/old.scale):(viewportHeight-height*scale)/2;
    this.state={width,height,viewportWidth,viewportHeight,fit,scale,x:boundOffset(x,width*scale,viewportWidth),y:boundOffset(y,height*scale,viewportHeight)};
    if(this.mode==='actual'){this.state.x=Math.max(0,(viewportWidth-width)/2);this.state.y=Math.max(0,(viewportHeight-height)/2);}
    this.render();
  }
  fit(mode='fit'){
    this.mode=mode==='actual'?'actual':'fit';this.state.scale=this.state.fit;this.resize();
    if(this.mode==='fit'){this.state.scale=this.state.fit;this.state.x=(this.state.viewportWidth-this.state.width*this.state.scale)/2;this.state.y=(this.state.viewportHeight-this.state.height*this.state.scale)/2;this.surface.scrollLeft=0;this.surface.scrollTop=0;this.render();}
  }
  reset(){this.fit('fit');}
  pinch({anchor,scale,origin=anchor}){
    if(this.mode==='actual'){this.state.x-=this.surface.scrollLeft??0;this.state.y-=this.surface.scrollTop??0;this.surface.scrollLeft=0;this.surface.scrollTop=0;}
    this.mode='fit';this.state=anchoredZoom(this.state,scale,anchor,origin);this.render();
  }
  pan(dx,dy){if(!this.zoomed||this.mode==='actual')return;const s=this.state;s.x=boundOffset(s.x+dx,s.width*s.scale,s.viewportWidth);s.y=boundOffset(s.y+dy,s.height*s.scale,s.viewportHeight);this.render();}
  follow(x,y){
    if(!this.zoomed||this.mode==='actual')return;const s=this.state,margin=Math.min(40,s.viewportWidth/4,s.viewportHeight/4);
    const px=s.x+x,py=s.y+y;this.pan(px<margin?margin-px:px>s.viewportWidth-margin?s.viewportWidth-margin-px:0,py<margin?margin-py:py>s.viewportHeight-margin?s.viewportHeight-margin-py:0);
  }
  clientToDisplay(x,y){return clientToDisplay({x,y},this.element.getBoundingClientRect());}
  localPoint(x,y){const rect=this.surface.getBoundingClientRect?.()??{left:0,top:0};return {x:x-rect.left,y:y-rect.top};}
  render(){
    const s=this.state;this.applyScale(s.scale);
    if(this.element.style)Object.assign(this.element.style,{position:this.mode==='actual'?'relative':'absolute',left:'0px',top:'0px',margin:'0px',transform:`translate(${s.x}px, ${s.y}px)`});
    if(this.capture.style)Object.assign(this.capture.style,{overflow:this.mode==='actual'?'visible':'hidden',minWidth:this.mode==='actual'?`${Math.max(s.viewportWidth,s.width*s.scale)}px`:'0px',minHeight:this.mode==='actual'?`${Math.max(s.viewportHeight,s.height*s.scale)}px`:'0px'});
    this.capture.setAttribute?.('data-scale-mode',this.mode);
  }
}
