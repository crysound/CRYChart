import type {Rect} from './contracts.js';
import {FontSettings} from './core/styles.js';

export interface PolarInsets {left:number;right:number;top:number;bottom:number;}
export type PolarInsetsInput=number|Partial<PolarInsets>;
export interface PolarText {text:string;font?:FontSettings;}
export interface PolarAngularLabel {angleRadians:number;text:string;}
export interface PolarAmplitudeLabel {fraction:number;text:string;}
export interface PolarLayoutOptions {
  width:number;height:number;
  padding?:PolarInsetsInput;legendMargin?:PolarInsetsInput;
  chartTitle?:PolarText;chartTitleMargin?:PolarInsetsInput;
  angularLabels?:readonly PolarAngularLabel[];
  amplitudeTicks?:readonly PolarAmplitudeLabel[];
  angularFont?:FontSettings;amplitudeFont?:FontSettings;
  amplitudeTitle?:PolarText;angularTitle?:PolarText;
  radialAxisAngleRadians?:number;
  tickLength?:number;labelGap?:number;marginAfterAngularTicks?:number;marginAfterAmplitudeTicks?:number;
}
export interface PolarLabelPlacement {
  kind:'angle'|'amplitude'|'amplitude-title'|'angular-title';
  text:string;font:FontSettings;
  x:number;y:number;rotation:number;
  bounds:Rect;visible:boolean;
  reason?:'insufficient-space'|'overlap';
  angleRadians?:number;fraction?:number;
}
export interface PolarLayout {
  /** Square data viewport. Its center and half-size agree with every renderer. */
  plot:Rect;
  /** Remaining container space after explicit padding, title and legend. */
  content:Rect;
  center:{x:number;y:number};
  dataRadius:number;
  padding:PolarInsets;
  labelBand:number;
  labels:PolarLabelPlacement[];
}
interface TextSize {width:number;height:number;}
const family='Segoe UI, -apple-system, Verdana, Helvetica';
const defaultTickFont=new FontSettings({size:14,family});
const defaultTitleFont=new FontSettings({size:16,family});
const positive=(value:number|undefined,fallback=0)=>Number.isFinite(value)?Math.max(0,value!):fallback;
function insets(value:PolarInsetsInput|undefined,fallback=0):PolarInsets{
  if(typeof value==='number'){const n=positive(value,fallback);return{left:n,right:n,top:n,bottom:n};}
  return{left:positive(value?.left,fallback),right:positive(value?.right,fallback),top:positive(value?.top,fallback),bottom:positive(value?.bottom,fallback)};
}
function textSize(ctx:CanvasRenderingContext2D|undefined,text:string,font:FontSettings,cache:Map<string,TextSize>):TextSize{
  const key=font.toCSS()+'\0'+text,known=cache.get(key);if(known)return known;
  const old=ctx?.font;if(ctx)ctx.font=font.toCSS();const metric=ctx?.measureText(text);if(ctx&&old!==undefined)ctx.font=old;
  // Nominal font height reserves stable space across actual glyph combinations.
  const size={width:metric?.width??text.length*font.getSize()*.55,height:Math.max(font.getSize(),(metric?.actualBoundingBoxAscent??0)+(metric?.actualBoundingBoxDescent??0))};cache.set(key,size);return size;
}
function upright(rotation:number){let r=((rotation+Math.PI)%(2*Math.PI)+2*Math.PI)%(2*Math.PI)-Math.PI;if(r>Math.PI/2)r-=Math.PI;if(r< -Math.PI/2)r+=Math.PI;return r;}
function textBounds(x:number,y:number,size:TextSize,rotation:number):Rect{
  const c=Math.abs(Math.cos(rotation)),s=Math.abs(Math.sin(rotation)),width=size.width*c+size.height*s,height=size.width*s+size.height*c;
  return{left:x-width/2,top:y-height/2,width,height};
}
function intersection(a:Rect,b:Rect,gap=0){return a.left<b.left+b.width+gap&&a.left+a.width+gap>b.left&&a.top<b.top+b.height+gap&&a.top+a.height+gap>b.top;}
function fitLabel(label:PolarLabelPlacement,available:Rect):PolarLabelPlacement{
  const b=label.bounds;
  if(b.width>available.width||b.height>available.height)return{...label,visible:false,reason:'insufficient-space'};
  const dx=Math.max(available.left,Math.min(b.left,available.left+available.width-b.width))-b.left;
  const dy=Math.max(available.top,Math.min(b.top,available.top+available.height-b.height))-b.top;
  return{...label,x:label.x+dx,y:label.y+dy,bounds:{...b,left:b.left+dx,top:b.top+dy}};
}

/** Project normalized data with one shared geometry for CPU, GPU and cursors. */
export function polarPosition(layout:Pick<PolarLayout,'center'|'dataRadius'>,angleRadians:number,fraction:number){
  return{x:layout.center.x+layout.dataRadius*fraction*Math.cos(angleRadians),y:layout.center.y-layout.dataRadius*fraction*Math.sin(angleRadians)};
}
/** The caller applies its north/clockwise convention and amplitude axis mapping. */
export function polarInverseNormalized(layout:Pick<PolarLayout,'center'|'dataRadius'>,point:{x:number;y:number}){
  const x=point.x-layout.center.x,y=layout.center.y-point.y,length=Math.hypot(x,y);
  return{angleRadians:length===0?0:Math.atan2(y,x),fraction:layout.dataRadius>0?length/layout.dataRadius:0};
}
/** UV origin is top-left; X/Y scale converts UV offsets to radius fractions. */
export function polarViewportUniforms(layout:Pick<PolarLayout,'center'|'dataRadius'|'plot'>,viewport:Rect=layout.plot){
  return{center:{x:viewport.width>0?(layout.center.x-viewport.left)/viewport.width:.5,y:viewport.height>0?(layout.center.y-viewport.top)/viewport.height:.5},scale:{x:layout.dataRadius>0?viewport.width/layout.dataRadius:0,y:layout.dataRadius>0?viewport.height/layout.dataRadius:0}};
}

/** Original text placement. Collision handling changes labels only, never data. */
export function placePolarLabels(ctx:CanvasRenderingContext2D|undefined,layout:Pick<PolarLayout,'center'|'dataRadius'|'content'>,options:PolarLayoutOptions):PolarLabelPlacement[]{
  const labels:PolarLabelPlacement[]=[],cache=new Map<string,TextSize>();
  const angularFont=options.angularFont??defaultTickFont,amplitudeFont=options.amplitudeFont??defaultTickFont;
  const gap=positive(options.labelGap,3),tickLength=positive(options.tickLength,4),radial=options.radialAxisAngleRadians??0;
  const normal={x:Math.sin(radial),y:Math.cos(radial)},along={x:Math.cos(radial),y:-Math.sin(radial)};
  const make=(kind:PolarLabelPlacement['kind'],text:string,font:FontSettings,x:number,y:number,rotation:number,details:Partial<PolarLabelPlacement>={}):PolarLabelPlacement=>fitLabel({kind,text,font,x,y,rotation,bounds:textBounds(x,y,textSize(ctx,text,font,cache),rotation),visible:!!text&&layout.dataRadius>0,...details},layout.content);
  const insert=(label:PolarLabelPlacement)=>{
    if(label.visible&&labels.some(prior=>prior.visible&&intersection(prior.bounds,label.bounds,gap)))label={...label,visible:false,reason:'overlap'};
    labels.push(label);return label;
  };
  for(const label of options.angularLabels??[]){
    const rotation=upright(Math.PI/2-label.angleRadians),offset=tickLength+gap+angularFont.getSize()/2+positive(options.marginAfterAngularTicks),p=polarPosition(layout,label.angleRadians,layout.dataRadius>0?1+offset/layout.dataRadius:0);
    insert(make('angle',label.text,angularFont,p.x,p.y,rotation,{angleRadians:label.angleRadians}));
  }
  for(const tick of options.amplitudeTicks??[]){
    if(!Number.isFinite(tick.fraction)||tick.fraction<0||tick.fraction>1)continue;
    const size=textSize(ctx,tick.text,amplitudeFont,cache),rotation=upright(-radial);
    // End labels stay inside the circle along the amplitude axis, so the last
    // amplitude and the angular label at the same spoke cannot collide.
    const distance=Math.min(layout.dataRadius*tick.fraction,Math.max(0,layout.dataRadius-size.width/2-gap));
    const offset=tickLength+gap+size.height/2;
    let label=make('amplitude',tick.text,amplitudeFont,layout.center.x+along.x*distance+normal.x*offset,layout.center.y+along.y*distance+normal.y*offset,rotation,{fraction:tick.fraction});
    for(let attempt=0;attempt<3&&label.visible&&labels.some(prior=>prior.visible&&intersection(prior.bounds,label.bounds,gap));attempt++){
      const shift=(attempt+1)*(size.height+gap);
      label=make('amplitude',tick.text,amplitudeFont,layout.center.x+along.x*distance+normal.x*(offset+shift),layout.center.y+along.y*distance+normal.y*(offset+shift),rotation,{fraction:tick.fraction});
    }
    insert(label);
  }
  const amplitudeTitle=options.amplitudeTitle;
  if(amplitudeTitle?.text){
    const font=amplitudeTitle.font??defaultTitleFont,size=textSize(ctx,amplitudeTitle.text,font,cache),base=tickLength+gap+amplitudeFont.getSize()+gap+size.height/2+positive(options.marginAfterAmplitudeTicks);
    let title=make('amplitude-title',amplitudeTitle.text,font,layout.center.x+along.x*layout.dataRadius/2+normal.x*base,layout.center.y+along.y*layout.dataRadius/2+normal.y*base,upright(-radial));
    for(let attempt=0;attempt<3&&title.visible&&labels.some(prior=>prior.visible&&intersection(prior.bounds,title.bounds,gap));attempt++){
      const offset=base+(attempt+1)*(size.height+gap);title=make('amplitude-title',amplitudeTitle.text,font,layout.center.x+along.x*layout.dataRadius/2+normal.x*offset,layout.center.y+along.y*layout.dataRadius/2+normal.y*offset,upright(-radial));
    }
    insert(title);
  }
  const angularTitle=options.angularTitle;
  if(angularTitle?.text){
    const font=angularTitle.font??defaultTitleFont;
    const right=Math.max(layout.center.x+layout.dataRadius,...labels.filter(label=>label.visible&&label.kind==='angle').map(label=>label.bounds.left+label.bounds.width));
    insert(make('angular-title',angularTitle.text,font,right+gap+font.getSize()/2,layout.center.y,-Math.PI/2));
  }
  return labels;
}

/**
 * Responsive polar geometry based on public font/padding configuration.
 * No XY-axis gutters and no second percentage-based radius are applied.
 * Text width reserves an outer band, including the amplitude-label line height;
 * this also keeps longer degree formatters from clipping at rotated angles.
 */
export function computePolarLayout(ctx:CanvasRenderingContext2D|undefined,options:PolarLayoutOptions):PolarLayout{
  const width=positive(options.width),height=positive(options.height),padding=insets(options.padding,7),legend=insets(options.legendMargin),titleMargin=insets(options.chartTitleMargin);
  const titleHeight=options.chartTitle?.text?(options.chartTitle.font??defaultTitleFont).getSize()*1.25+6+titleMargin.top+titleMargin.bottom:0;
  const left=Math.min(width,padding.left+legend.left),top=Math.min(height,padding.top+legend.top+titleHeight);
  const content={left,top,width:Math.max(0,width-left-padding.right-legend.right),height:Math.max(0,height-top-padding.bottom-legend.bottom)};
  const angularFont=options.angularFont??defaultTickFont,amplitudeFont=options.amplitudeFont??defaultTickFont,cache=new Map<string,TextSize>();
  const angularWidth=Math.max(0,...(options.angularLabels??[]).map(label=>textSize(ctx,label.text,angularFont,cache).width));
  const labelBand=(angularWidth>0?angularWidth+amplitudeFont.getSize()+Math.max(positive(options.tickLength,4),positive(options.labelGap,3))+positive(options.marginAfterAngularTicks):0)+(options.angularTitle?.text?(options.angularTitle.font??defaultTitleFont).getSize()+positive(options.labelGap,3):0);
  const center={x:content.left+content.width/2,y:content.top+content.height/2},dataRadius=Math.max(0,Math.min(content.width,content.height)/2-labelBand);
  const result:PolarLayout={content,center,dataRadius,padding,labelBand,plot:{left:center.x-dataRadius,top:center.y-dataRadius,width:2*dataRadius,height:2*dataRadius},labels:[]};
  result.labels=placePolarLabels(ctx,result,options);return result;
}
