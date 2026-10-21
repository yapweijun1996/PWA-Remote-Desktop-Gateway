export const TAP_MS=300,HOLD_MS=450,MOVE_PX=8,PINCH_PX=8;
const point=touch=>({id:touch.identifier??touch.id,x:touch.clientX??touch.x,y:touch.clientY??touch.y});
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const center=points=>({x:(points[0].x+points[1].x)/2,y:(points[0].y+points[1].y)/2});
/** No DOM, timers or remote writes. Tentative fingers emit nothing; pan/scroll may promote to local-only pinch (already sent scroll is not undone). */
export class TouchGestures {
  constructor(){this.reset();}
  reset(){this.kind='idle';this.points=[];this.multi=false;this.blocked=false;this.drag=false;}
  cancel(){const dragging=this.drag;this.reset();return dragging?[{type:'release'}]:[];}
  update(type,touches,time,{mode='trackpad',zoomed=false}={}){
    const points=Array.from(touches??[],point),actions=[];
    if(type==='cancel'){actions.push(...this.cancel());this.blocked=points.length>0;return actions;}
    if(this.blocked){if(!points.length)this.reset();return actions;}
    if(points.length>2){actions.push(...this.cancel());this.blocked=true;return actions;}
    if(this.kind==='idle'){
      if(!points.length)return actions;
      this.started=time;this.start=points;this.points=points;this.kind='pending';this.mode=mode;
      if(points.length===2)this.beginMulti(points,time,actions);
      return actions;
    }
    if(points.length===2&&!this.multi){this.beginMulti(points,time,actions);return actions;}
    if(this.multi){
      if(points.length<2){
        if(this.kind==='multi-pending'&&time-this.started<=TAP_MS)actions.push({type:'tap',button:'right',point:this.startCenter});
        this.blocked=points.length>0;if(!points.length)this.reset();return actions;
      }
      if(points.some(current=>!this.multiIds.includes(current.id))){actions.push(...this.cancel());this.blocked=true;return actions;}
      const current=center(points),span=distance(...points),travel=distance(current,this.startCenter),spread=Math.abs(span-this.startSpan);
      if(spread>=PINCH_PX)this.kind='pinch';
      else if(this.kind==='multi-pending'&&travel>=MOVE_PX)this.kind=zoomed?'pan':'scroll';
      if(this.kind==='pinch')actions.push({type:'pinch',point:current,origin:this.lastCenter,ratio:this.lastSpan>0?span/this.lastSpan:1});
      else if(this.kind==='pan')actions.push({type:'pan',dx:current.x-this.lastCenter.x,dy:current.y-this.lastCenter.y});
      else if(this.kind==='scroll')actions.push({type:'scroll',point:current,dy:this.lastCenter.y-current.y});
      this.lastCenter=current;this.lastSpan=span;this.points=points;return actions;
    }
    if(!points.length){
      if(this.drag)actions.push({type:'release'});
      else if(this.kind==='pending'&&time-this.started<=TAP_MS)actions.push({type:'tap',button:'left',point:this.start[0]});
      this.reset();return actions;
    }
    if(points[0].id!==this.start[0].id){actions.push(...this.cancel());this.blocked=true;return actions;}
    const current=points[0],travel=distance(current,this.start[0]);
    if(this.kind==='pending'&&mode==='touch'&&time-this.started>=HOLD_MS){this.kind='single';this.drag=true;actions.push({type:'hold',point:current});}
    if(this.kind==='pending'&&travel>=MOVE_PX)this.kind='single';
    if(this.kind==='single'&&type==='move')actions.push({type:'move',point:current,previous:this.points[0],start:this.start[0],drag:this.drag});
    this.points=points;return actions;
  }
  beginMulti(points,time,actions){
    if(this.drag)actions.push({type:'release'});
    this.drag=false;this.multi=true;this.kind='multi-pending';this.started=time;this.startCenter=center(points);this.startSpan=distance(...points);
    this.multiIds=points.map(current=>current.id);
    this.lastCenter=this.startCenter;this.lastSpan=this.startSpan;this.points=points;
    actions.push({type:'local-start'});
  }
}
