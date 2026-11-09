import type {Annotation,Axis} from './axis.js';
import type {Rect} from './contracts.js';

export interface AnnotationDrag {
  annotation:Annotation;mode:'line'|'move-band'|'start'|'end';
  pointerValue:number;value:number;start:number;end:number;
  interactionRevision:number;active:boolean;release?:()=>void;
}
function coordinate(axis:Axis,point:{x:number;y:number},plot:Rect){
  const range=axis.getScreenRange(),fraction=axis.direction==='x'?(point.x-plot.left)/plot.width:1-(point.y-plot.top)/plot.height;
  return axis.screenFractionToValue(Math.max(range.start,Math.min(range.end,fraction)));
}
/** Pointer-enabled annotations are ordered exactly like their painted layers.
 * Disabled covers are skipped, allowing the annotation underneath to be hit. */
export function pickAnnotation(axes:readonly Axis[],point:{x:number;y:number},plot:Rect):Annotation|undefined{
  if(point.x<plot.left||point.x>plot.left+plot.width||point.y<plot.top||point.y>plot.top+plot.height)return undefined;
  for(const onTop of [true,false])for(const axis of [...axes].reverse()){
    if(axis.disposed)continue;
    const horizontal=axis.direction==='x',cursor=horizontal?point.x:point.y,range=axis.getScreenRange(),fraction=horizontal?(point.x-plot.left)/plot.width:1-(point.y-plot.top)/plot.height;
    if(fraction<range.start||fraction>range.end)continue;
    const pixel=(value:number)=>horizontal?plot.left+axis.valueToScreenFraction(value)*plot.width:plot.top+(1-axis.valueToScreenFraction(value))*plot.height;
    for(const annotation of [...axis.annotations].reverse()){
      if(annotation.onTop!==onTop||annotation.disposed||!annotation.visible||!annotation.getPointerEvents())continue;
      const tolerance=Math.max(5,(annotation.stroke?.getThickness?.()??0)/2+2);
      if(annotation.kind==='line'&&Math.abs(pixel(annotation.value)-cursor)<=tolerance)return annotation;
      if(annotation.kind==='band'){
        const first=pixel(annotation.start),last=pixel(annotation.end);
        if(cursor>=Math.min(first,last)-tolerance&&cursor<=Math.max(first,last)+tolerance)return annotation;
      }
    }
  }
  return undefined;
}

export function updateAnnotationHover(axes:readonly Axis[],point:{x:number;y:number}|undefined,plot:Rect):Annotation|undefined{
  const hit=point?pickAnnotation(axes,point,plot):undefined;
  for(const axis of axes)for(const annotation of axis.annotations)annotation.setPointed(annotation===hit);
  return hit;
}

/** Stop the subscription on pointer-up/cancel as well as on configuration
 * changes. A disabled drag cannot resume from its stale initial grab position. */
export function finishAnnotationDrag(drag:AnnotationDrag):void{
  drag.active=false;drag.release?.();drag.release=undefined;
}

/** Pick draggable annotation geometry, after overlay UI but before chart gestures. */
export function beginAnnotationDrag(axes:readonly Axis[],point:{x:number;y:number},plot:Rect,onCancelled?:(drag:AnnotationDrag)=>void):AnnotationDrag|undefined{
  const annotation=pickAnnotation(axes,point,plot);
  if(!annotation||!annotation.draggable)return undefined;
  const axis=annotation.axis,horizontal=axis.direction==='x',cursor=horizontal?point.x:point.y;
  const pixel=(value:number)=>horizontal?plot.left+axis.valueToScreenFraction(value)*plot.width:plot.top+(1-axis.valueToScreenFraction(value))*plot.height;
  const capabilities=annotation.getDragCapabilities(),tolerance=Math.max(5,(annotation.stroke?.getThickness?.()??0)/2+2);let mode:AnnotationDrag['mode']|undefined;
  if(annotation.kind==='line'&&capabilities.move)mode='line';
  if(annotation.kind==='band'){
    const first=pixel(annotation.start),last=pixel(annotation.end);
    if(capabilities.scale&&Math.abs(first-cursor)<=tolerance)mode='start';
    else if(capabilities.scale&&Math.abs(last-cursor)<=tolerance)mode='end';
    else if(capabilities.move&&cursor>=Math.min(first,last)&&cursor<=Math.max(first,last))mode='move-band';
  }
  if(!mode)return undefined;
  const drag:AnnotationDrag={annotation,mode,pointerValue:coordinate(axis,point,plot),value:annotation.value,start:annotation.start,end:annotation.end,interactionRevision:annotation.getInteractionRevision(),active:true};
  const token=annotation.events.on('annotationinteractionchange',()=>{finishAnnotationDrag(drag);onCancelled?.(drag);});
  drag.release=()=>annotation.events.off(token);
  return drag;
}
/** Publish one value/bounds event per pointer update; data and axis intervals stay untouched. */
export function updateAnnotationDrag(drag:AnnotationDrag,point:{x:number;y:number},plot:Rect):boolean{
  const annotation=drag.annotation,capabilities=annotation.getDragCapabilities();
  if(!drag.active||annotation.getInteractionRevision()!==drag.interactionRevision||annotation.disposed||annotation.axis.disposed||!annotation.visible||!annotation.getPointerEvents()||!annotation.draggable||((drag.mode==='start'||drag.mode==='end')?!capabilities.scale:!capabilities.move)){finishAnnotationDrag(drag);return false;}
  const next=coordinate(annotation.axis,point,plot),log=annotation.axis.type==='logarithmic';
  if(!Number.isFinite(next))return false;
  if(drag.mode==='line'){const value=log?drag.value*next/drag.pointerValue:drag.value+next-drag.pointerValue;annotation.setValue(value);}
  else if(drag.mode==='start')annotation.setBounds({start:Math.min(next,drag.end),end:drag.end});
  else if(drag.mode==='end')annotation.setBounds({start:drag.start,end:Math.max(next,drag.start)});
  else{const convert=(value:number)=>log?value*next/drag.pointerValue:value+next-drag.pointerValue;annotation.setBounds({start:convert(drag.start),end:convert(drag.end)});}
  return true;
}
