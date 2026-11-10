import type {Axis,NumericTickStrategy,TimeTickStrategy,TickStyle} from './axis';
import type {Rect} from './contracts';
import {ColorRGBA,type Color,type FillStyle,type FontSettings,type LineStyle} from './core/styles';
import {formatNumeric} from './formatting-functions.js';

export interface AxisCanvasMetrics {
  measured:boolean;
  labelFont:FontSettings;
  titleFont:FontSettings;
  lane:number;
  laneOffset:number;
  laneSize:number;
  labelOffset:number;
  titleOffset:number;
  tickLength:number;
  labelWidth:number;
  labelAscent:number;
  labelDescent:number;
  titleWidth:number;
  titleAscent:number;
  titleDescent:number;
  rotation:number;
}
export interface AxisCanvasLayout {
  contentMargins?:{left:number;right:number;top:number;bottom:number};
  extraMargins:{left:number;right:number;top:number;bottom:number};
  axes:Map<Axis,AxisCanvasMetrics>;
}
export interface AxisCanvasOptions {
  plot:Rect;
  axesX:readonly Axis[];
  axesY:readonly Axis[];
  light?:boolean;
  width?:number;
  height?:number;
  layout?:AxisCanvasLayout;
  theme?:AxisCanvasTheme;
  resolveFont?:(font:FontSettings)=>FontSettings;
}
export interface AxisCanvasTheme {
  font?:FontSettings;
  tickLabelFillStyle?:FillStyle;
  tickGridStrokeStyle?:LineStyle;
  minorTickGridStrokeStyle?:LineStyle;
  axisTitleFillStyle?:FillStyle;
  xAxisTitleFillStyle?:FillStyle;
  yAxisTitleFillStyle?:FillStyle;
  zAxisTitleFillStyle?:FillStyle;
}
const color=(fill:any,fallback:Color)=>fill?.kind==='empty'?ColorRGBA(0,0,0,0):fill?.getColor?.()??fallback;
const validFont=(font:FontSettings)=>font.toCSS?.()??`${font.getSize()}px sans-serif`;
const isDefaultFont=(font:FontSettings)=>font.getSize()===12&&font.family==='sans-serif'&&font.weight==='normal'&&font.style==='normal'&&font.variant==='normal';
type MeasuredText={width:number;ascent:number;descent:number};
function textMetrics(ctx:CanvasRenderingContext2D|undefined,text:string,font:FontSettings,cache?:Map<string,MeasuredText>){
  const key=validFont(font)+'\0'+text,cached=cache?.get(key);if(cached)return cached;
  const previous=ctx?.font,previousBaseline=ctx?.textBaseline;if(ctx){ctx.font=validFont(font);ctx.textBaseline='alphabetic';}
  let measured:TextMetrics|undefined;
  try{measured=ctx?.measureText(text);}finally{if(ctx){if(previous!==undefined)ctx.font=previous;if(previousBaseline!==undefined)ctx.textBaseline=previousBaseline;}}
  const result={width:measured?.width??text.length*font.getSize()*.6,ascent:measured?.actualBoundingBoxAscent??font.getSize()*.75,descent:measured?.actualBoundingBoxDescent??font.getSize()*.25};cache?.set(key,result);return result;
}
/** Content occupied by a one-line title, measured independently of axis labels.
 * Canvas glyph bounds include the baseline row in a positive descent; count it
 * once when converting that raster extent back to CSS pixels. Four CSS pixels
 * above and below keep the title's content box separate from its outer margin.
 */
export function measureChartTitleContent(ctx:CanvasRenderingContext2D|undefined,text:string,font:FontSettings,dpr=1):number{
  if(!text)return 0;
  const scale=Number.isFinite(dpr)&&dpr>0?dpr:1,m=textMetrics(ctx,text,font.setSize(font.getSize()*scale));
  const glyphHeight=Math.max(0,m.ascent+m.descent-(m.descent>0?1:0));
  return glyphHeight/scale+8;
}
function rotatedBounds(width:number,ascent:number,descent:number,angle:number){
  const c=Math.cos(angle),s=Math.sin(angle),corners=[[-width/2,-ascent],[width/2,-ascent],[-width/2,descent],[width/2,descent]].map(([x,y])=>({x:x!*c-y!*s,y:x!*s+y!*c}));
  return {left:Math.min(...corners.map(p=>p.x)),right:Math.max(...corners.map(p=>p.x)),top:Math.min(...corners.map(p=>p.y)),bottom:Math.max(...corners.map(p=>p.y))};
}
type TickLevel='great'|'major'|'minor';
function tickStyle(strategy:NumericTickStrategy,level:TickLevel):TickStyle|undefined{
  return level==='great'?(strategy as NumericTickStrategy&{getGreatTickStyle?():TickStyle}).getGreatTickStyle?.():level==='major'?strategy.getMajorTickStyle():strategy.getMinorTickStyle();
}
function resolvedTickFont(axis:Axis,level:TickLevel,style:TickStyle,theme?:AxisCanvasTheme,resolveFont?:(font:FontSettings)=>FontSettings){
  const current=theme?.font??style.getLabelFont();
  const font=style.hasLabelFontOverride()?style.getLabelFont():level==='minor'&&axis.tickStrategy.kind==='time'?(axis.tickStrategy as TimeTickStrategy).resolveDefaultMinorFont?.(theme?.font)??current:current;
  return resolveFont?.(font)??font;
}
function resolvedTickFill(axis:Axis,level:TickLevel,style:TickStyle,theme?:AxisCanvasTheme,forDrawing=false){
  if(style.hasLabelFillStyleOverride())return style.getLabelFillStyle();
  if(level==='major')return theme?.tickLabelFillStyle??(forDrawing?undefined:style.getLabelFillStyle());
  if(level==='minor'&&axis.tickStrategy.kind==='time'&&(axis.tickStrategy as TimeTickStrategy).usesBoundedMinor?.())return theme?.tickLabelFillStyle??style.getLabelFillStyle();
  return style.getLabelFillStyle();
}
function measuredTickLayout(axis:Axis,ctx:CanvasRenderingContext2D|undefined,axisSizePixels=axis.getPixelLength(),cache?:Map<string,MeasuredText>,theme?:AxisCanvasTheme,resolveFont?:(font:FontSettings)=>FontSettings){
  const strategy=axis.tickStrategy;
  // Numeric axes retain their measurement-free placement path. Time and calendar axes
  // choose their stride using the same configured font that Canvas will paint.
  if(strategy.kind!=='datetime'&&strategy.kind!=='time')return axis.tickLayout(axisSizePixels);
  return axis.tickLayout(axisSizePixels,undefined,(label,level)=>{
    const style=tickStyle(strategy,level)??strategy.major;
    const font=resolvedTickFont(axis,level,style,theme,resolveFont);
    const measured=textMetrics(ctx,label,font,cache);
    return axis.direction==='x'?measured.width:measured.ascent+measured.descent;
  });
}
function metrics(axis:Axis,ctx:CanvasRenderingContext2D|undefined,cache?:Map<string,MeasuredText>,theme?:AxisCanvasTheme,resolveFont?:(font:FontSettings)=>FontSettings,contentLayout=false):AxisCanvasMetrics{
  const horizontal=axis.direction==='x',strategy=axis.tickStrategy,tick=strategy.getMajorTickStyle();
  const titleText=axis.getDisplayTitle(),titleVisible=titleText.length>0&&color(axis.titleFill,ColorRGBA(190,200,215)).a>0;
  // Empty automatic ticks contribute no labels or tick marks. A title-only
  // coordinate axis still needs its real title measured, without phantom ink.
  const titleOnly=!strategy.visible&&titleVisible&&!axis.annotations.some(annotation=>annotation.kind==='tick'&&annotation.visible&&!annotation.disposed);
  // An explicit FontSettings object wins even when its size is the default 12.
  // Retain the resolved object in the layout so drawing uses what was measured.
  const baseFont=tick.hasLabelFontOverride()?tick.getLabelFont():theme?.font??tick.getLabelFont();
  const labelFont=resolveFont?.(baseFont)??baseFont,titleFont=resolveFont?.(axis.titleFont)??axis.titleFont;
  const visibleLevels=(['major','minor','great'] as const).flatMap(level=>{
    const style=tickStyle(strategy,level);if(!style)return[];
    const font=resolvedTickFont(axis,level,style,theme,resolveFont);
    const fill=resolvedTickFill(axis,level,style,theme);
    return [{level,style,font,visible:color(fill,ColorRGBA(0,0,0,0)).a>0}];
  });
  const margin=axis.getMarginAfterTicks(),tickLength=titleOnly?0:Math.max(0,...visibleLevels.map(({style})=>style.getTickStyle()?.getThickness?.()>0?style.getTickLength():0));
  const rotation=(axis.titleRotation??(horizontal?0:-90))*Math.PI/180;
  const customLabels=visibleLevels.some(({level,style,visible})=>visible&&(typeof style.formatter==='function'||typeof(level==='major'?strategy.getMajorFormattingFunction():strategy.getMinorFormattingFunction())==='function'))||strategy.getFormattingOffset()!==undefined||strategy.customMajor!==undefined||strategy.customMinor!==undefined||(strategy as any).hasDateTimeFormatting?.()===true;
  // Long default numeric endpoints also need room, but the usual short labels
  // are checked without enumerating ticks or calling Canvas.measureText.
  const interval=axis.getInterval(),longDefault=!horizontal&&strategy.kind==='numeric'&&!customLabels&&
    [interval.start,interval.end].some(value=>formatNumeric(value,interval).length*labelFont.getSize()*.6+17>54);
  const changedLayout=contentLayout||titleOnly||margin>0||visibleLevels.some(({font,visible})=>visible&&!isDefaultFont(font))||!isDefaultFont(titleFont)||axis.titleRotation!==undefined||tickLength>7||customLabels||longDefault||strategy.kind==='datetime';
  // Default lanes require no text measurement or tick enumeration. This matters
  // for the 128-pane waveform case: draw performs the sole tick enumeration.
  if(!changedLayout)return {measured:false,labelFont,titleFont,lane:0,laneOffset:0,laneSize:horizontal?44:54,labelOffset:horizontal?(axis.opposite?10:20):9,titleOffset:horizontal?(axis.opposite?32:43):48,tickLength,labelWidth:0,labelAscent:9,labelDescent:3,titleWidth:0,titleAscent:9,titleDescent:3,rotation};
  const layout=measuredTickLayout(axis,ctx,undefined,cache,theme,resolveFont),labels=visibleLevels.flatMap(({level,font,visible})=>visible?(layout[level]??[]).filter(t=>t.label.length).map(t=>textMetrics(ctx,t.label,font,cache)):[]);
  const labelWidth=Math.max(0,...labels.map(m=>m.width)),labelAscent=Math.max(labelFont.getSize()*.75,...labels.map(m=>m.ascent)),labelDescent=Math.max(labelFont.getSize()*.25,...labels.map(m=>m.descent));
  const title=textMetrics(ctx,titleText,titleFont,cache);
  const titleBox=rotatedBounds(title.width,title.ascent,title.descent,rotation);
  const labelOffset=titleOnly?0:horizontal?(axis.opposite?Math.max(10,tickLength+labelDescent+3):Math.max(20,tickLength+labelAscent+3)):Math.max(9,tickLength+(contentLayout?5:2));
  const labelOuter=titleOnly?0:horizontal?labelOffset+(axis.opposite?labelAscent:labelDescent):labelOffset+labelWidth;
  const titleInner=horizontal?(axis.opposite?titleBox.bottom:-titleBox.top):(axis.opposite?-titleBox.left:titleBox.right);
  const titleOuter=horizontal?(axis.opposite?-titleBox.top:titleBox.bottom):(axis.opposite?titleBox.right:-titleBox.left);
  const defaultTitleOffset=horizontal?(axis.opposite?32:43):48;
  const titleOffset=contentLayout?labelOuter+margin+titleInner+2:changedLayout?Math.max(defaultTitleOffset+margin,labelOuter+margin+titleInner+5):defaultTitleOffset;
  const extent=Math.max(labelOuter,titleVisible?titleOffset+titleOuter:0,tickLength);
  const baseline=horizontal?44:54,laneSize=contentLayout?Math.ceil(extent+(horizontal?2:0)):changedLayout?Math.max(baseline,Math.ceil(extent+8)):baseline;
  return {measured:true,labelFont,titleFont,lane:0,laneOffset:0,laneSize,labelOffset,titleOffset,tickLength,labelWidth,labelAscent,labelDescent,titleWidth:title.width,titleAscent:title.ascent,titleDescent:title.descent,rotation};
}

/** Additional space only; callers retain their existing default 44/54px lanes. */
export function measureAxisCanvasLayout(ctx:CanvasRenderingContext2D|undefined,axesX:readonly Axis[],axesY:readonly Axis[],theme?:AxisCanvasTheme,resolveFont?:(font:FontSettings)=>FontSettings,contentLayout=false):AxisCanvasLayout{
  const result:AxisCanvasLayout={extraMargins:{left:0,right:0,top:0,bottom:0},axes:new Map(),...(contentLayout?{contentMargins:{left:0,right:0,top:0,bottom:0}}:{})};
  // Reuse repeated channel labels within this layout pass, without retaining
  // user formatter output or font metrics across later frames/font changes.
  const textCache=new Map<string,MeasuredText>();
  for(const [horizontal,list]of[[true,axesX],[false,axesY]] as const)for(const opposite of[false,true]){
    const groups=new Map<number,Axis[]>();
    for(const axis of list)if(axis.visible&&!axis.disposed&&axis.opposite===opposite){const group=groups.get(axis.iParallel)??[];group.push(axis);groups.set(axis.iParallel,group);}
    let offset=0,lane=0;
    for(const [,axes]of[...groups].sort((a,b)=>a[0]-b[0])){
      const values=axes.map(axis=>[axis,metrics(axis,ctx,textCache,theme,resolveFont,contentLayout)] as const),size=Math.max(contentLayout?0:horizontal?44:54,...values.map(([,m])=>m.laneSize));
      for(const [axis,value]of values)result.axes.set(axis,{...value,lane,laneOffset:offset,laneSize:size});
      offset+=size;lane++;
    }
    const side=horizontal?(opposite?'top':'bottom'):(opposite?'right':'left');
    result.extraMargins[side]=Math.max(0,offset-lane*(horizontal?44:54));
    if(result.contentMargins)result.contentMargins[side]=offset;
  }
  return result;
}

export function axisCanvasLaneOffset(layout:AxisCanvasLayout,axis:Axis){return layout.axes.get(axis)?.laneOffset??axis.parallelLane*(axis.direction==='x'?44:54);}
function paintStroke(ctx:CanvasRenderingContext2D,style:any,from:{x:number;y:number},to:{x:number;y:number}){
  paintStrokes(ctx,style,[[from,to]]);
}
type StrokeSegment=readonly [{x:number;y:number},{x:number;y:number}];
function paintStrokes(ctx:CanvasRenderingContext2D,style:any,segments:readonly StrokeSegment[]){
  const thickness=style?.getThickness?.()??0,ink=color(style?.getFillStyle?.(),ColorRGBA(0,0,0,0));
  if(!(thickness>0)||ink.a<=0||segments.length===0)return;
  ctx.strokeStyle=ink.toCSS();ctx.lineWidth=thickness;
  ctx.setLineDash(style?.getPattern?.().map((part:number)=>part*(style.getPatternScale?.()??1))??[]);ctx.lineDashOffset=0;
  ctx.beginPath();for(const[from,to]of segments){ctx.moveTo(from.x,from.y);ctx.lineTo(to.x,to.y);}ctx.stroke();ctx.setLineDash([]);
}

/** Keep the actual ink inside the physical axis range, without changing text.
 * A label wider than that range cannot fit: align its nearer end and retain
 * normal Canvas clipping. This deliberately does not remove or shrink ticks.
 */
export function boundAxisLabelX(ctx:CanvasRenderingContext2D,text:string,anchor:number,start:number,end:number,measured=ctx.measureText(text)){
  const width=Number.isFinite(measured.width)?measured.width:0;
  const fallbackLeft=ctx.textAlign==='left'||ctx.textAlign==='start'?0:ctx.textAlign==='right'||ctx.textAlign==='end'?width:width/2;
  const left=Number.isFinite(measured.actualBoundingBoxLeft)?measured.actualBoundingBoxLeft:fallbackLeft;
  const right=Number.isFinite(measured.actualBoundingBoxRight)?measured.actualBoundingBoxRight:width-fallbackLeft;
  const low=Math.min(start,end),high=Math.max(start,end),first=low+left,last=high-right;
  if(first<=last)return Math.max(first,Math.min(last,anchor));
  return anchor<=(low+high)/2?first:last;
}

type AxisLabel={text:string;x:number;y:number;font:string;fill:string;align:CanvasTextAlign;level:TickLevel;low:number;high:number};
/** Label admission is independent of tick/grid placement. Prefer major labels,
 * retain both ends when they fit, then use the remaining gaps for other labels.
 * Bounds are measured from the actual configured text; values are never rounded
 * or abbreviated to make an axis fit.
 */
function paintAxisLabels(ctx:CanvasRenderingContext2D,labels:AxisLabel[],axisLength:number,selectedTimeMinor=false){
  const accepted:AxisLabel[]=[],gap=4;
  const accept=(label:AxisLabel,preserveMinor=false)=>{
    if(label.high-label.low>axisLength)return;
    if(!preserveMinor&&accepted.some(other=>label.low<other.high+gap&&label.high>other.low-gap))return;
    accepted.push(label);
  };
  for(const level of ['great','major','minor'] as const){
    const candidates=labels.filter(label=>label.level===level).sort((a,b)=>a.low-b.low);
    if(candidates.length){accept(candidates[0]!,selectedTimeMinor&&level==='minor');if(candidates.length>1)accept(candidates[candidates.length-1]!,selectedTimeMinor&&level==='minor');}
    for(let i=1;i<candidates.length-1;i++)accept(candidates[i]!,selectedTimeMinor&&level==='minor');
  }
  const visible=new Set(accepted);
  for(const label of labels)if(visible.has(label)){
    ctx.font=label.font;ctx.fillStyle=label.fill;ctx.textAlign=label.align;ctx.fillText(label.text,label.x,label.y);
  }
}

/** Original XY axis renderer; keeps axis painting separate from chart lifetime. */
export function drawAxisCanvas(ctx:CanvasRenderingContext2D,options:AxisCanvasOptions){
  const {plot:r,axesX,axesY,light=false,theme,resolveFont}=options,layout=options.layout??measureAxisCanvasLayout(ctx,axesX,axesY,theme,resolveFont);
  ctx.save();try{ctx.textBaseline='alphabetic';
  for(const axis of[...axesX,...axesY]){
    if(!axis.visible||axis.disposed)continue;
    const m=layout.axes.get(axis)??metrics(axis,ctx,undefined,theme,resolveFont),horizontal=axis.direction==='x',outward=axis.opposite?(horizontal?-1:1):(horizontal?1:-1);
    const linePosition=horizontal?(axis.opposite?r.top-m.laneOffset:r.top+r.height+m.laneOffset):(axis.opposite?r.left+r.width+m.laneOffset:r.left-m.laneOffset);
    const range=axis.getScreenRange(),axisLength=Math.abs(range.end-range.start)*(horizontal?r.width:r.height),strategy=axis.tickStrategy;
    const lineFrom=horizontal?{x:r.left+range.start*r.width,y:linePosition}:{x:linePosition,y:r.top+(1-range.start)*r.height};
    const lineTo=horizontal?{x:r.left+range.end*r.width,y:linePosition}:{x:linePosition,y:r.top+(1-range.end)*r.height};
    const highlight=axis.getEffectiveHighlight();
    if(highlight>0){
      // Tint only this physical axis lane, never its plot or adjacent stack.
      // Resolve contrast from the current theme without changing saved styles.
      const ink=color(axis.hasTitleFillStyleOverride()?axis.titleFill:theme?.tickLabelFillStyle??theme?.axisTitleFillStyle,light?ColorRGBA(52,65,86):ColorRGBA(190,200,215));
      ctx.fillStyle=ink.setA(255*.16*highlight).toCSS();
      if(horizontal)ctx.fillRect(Math.min(lineFrom.x,lineTo.x),linePosition+(outward<0?-m.laneSize:0),axisLength,m.laneSize);
      else ctx.fillRect(linePosition+(outward<0?-m.laneSize:0),Math.min(lineFrom.y,lineTo.y),m.laneSize,axisLength);
    }
    paintStroke(ctx,axis.stroke,lineFrom,lineTo);
    const ticks=measuredTickLayout(axis,ctx,axisLength,strategy.kind==='datetime'||strategy.kind==='time'?new Map():undefined,theme,resolveFont),labels:AxisLabel[]=[],interval=axis.getInterval();
    for(const level of ['minor','major','great'] as const){
      const style=tickStyle(strategy,level);if(!style)continue;
      const gridSegments:StrokeSegment[]=[],tickSegments:StrokeSegment[]=[];
      const labelFont=level==='major'?(style.hasLabelFontOverride()?(resolveFont?.(style.getLabelFont())??style.getLabelFont()):m.labelFont):resolvedTickFont(axis,level,style,theme,resolveFont);
      const length=Math.max(0,Math.min(1,style.getGridStrokeLength())),tickLength=Math.max(0,style.getTickLength());
      for(const tick of ticks[level]??[]){
      const fraction=axis.valueToScreenFraction(tick.value),x=horizontal?r.left+fraction*r.width:linePosition,y=horizontal?linePosition:r.top+r.height-fraction*r.height;
      const onAxis=level!=='great'||tick.value>=Math.min(interval.start,interval.end)&&tick.value<=Math.max(interval.start,interval.end);
      if(length>0&&onAxis)gridSegments.push(horizontal
        ?[{x,y:axis.opposite?r.top:r.top+r.height},{x,y:axis.opposite?r.top+r.height*length:r.top+r.height*(1-length)}]
        :[{x:axis.opposite?r.left+r.width:r.left,y},{x:axis.opposite?r.left+r.width*(1-length):r.left+r.width*length,y}]);
      if(onAxis)tickSegments.push([{x,y},horizontal?{x,y:y+outward*tickLength}:{x:x+outward*tickLength,y}]);
      const labelFill=resolvedTickFill(axis,level,style,theme,true);
      const labelColor=labelFill!==undefined?color(labelFill,ColorRGBA(0,0,0,0)):light?ColorRGBA(82,97,118):color(style.getLabelFillStyle(),ColorRGBA(150,164,185));
      if(labelColor.a>0&&tick.label.length){
        ctx.font=validFont(labelFont);ctx.fillStyle=labelColor.toCSS();ctx.textAlign=horizontal?(level==='great'?'left':'center'):axis.opposite?'left':'right';
        const measured=ctx.measureText(tick.label),width=Number.isFinite(measured.width)?measured.width:0;
        const anchor=level==='great'&&'anchor'in tick?axis.valueToScreenFraction(tick.anchor as number):fraction;
        const anchorX=horizontal?r.left+anchor*r.width+(level==='great'?2:0):x;
        const anchorY=horizontal?y:r.top+r.height-anchor*r.height;
        const labelX=horizontal?boundAxisLabelX(ctx,tick.label,anchorX,lineFrom.x,lineTo.x,measured):x+outward*m.labelOffset;
        const labelY=anchorY+(horizontal?outward*m.labelOffset:4);
        const halfLeft=level==='great'?0:width/2,halfRight=level==='great'?width:width/2;
        const low=horizontal?labelX-(Number.isFinite(measured.actualBoundingBoxLeft)?Math.max(halfLeft,measured.actualBoundingBoxLeft):halfLeft):labelY-(measured.actualBoundingBoxAscent??labelFont.getSize()*.75);
        const high=horizontal?labelX+(Number.isFinite(measured.actualBoundingBoxRight)?Math.max(halfRight,measured.actualBoundingBoxRight):halfRight):labelY+(measured.actualBoundingBoxDescent??labelFont.getSize()*.25);
        labels.push({text:tick.label,x:labelX,y:labelY,font:ctx.font,fill:labelColor.toCSS(),align:ctx.textAlign,level,low,high});
      }
      }
      // One Canvas path per style/axis, including all minor ticks; no per-tick
      // state churn, and no change to data renderer or per-pane clipping.
      const themedGrid=level==='minor'?theme?.minorTickGridStrokeStyle??theme?.tickGridStrokeStyle:theme?.tickGridStrokeStyle;
      const grid=style.hasGridStrokeStyleOverride()?style.getGridStrokeStyle():themedGrid??style.getGridStrokeStyle();
      paintStrokes(ctx,grid,gridSegments);paintStrokes(ctx,style.getTickStyle(),tickSegments);
    }
    // Retain the observed default Time grid policy. Explicit fonts or custom
    // text must pass the same final measured-bound collision check as other
    // labels: endpoint clamping can move a major label into a minor label.
    const selectedTimeMinor=axis.type!=='logarithmic'&&strategy.kind==='time'&&!strategy.customMajor&&!strategy.customMinor&&!strategy.minor.hasLabelFontOverride()&&!strategy.getMajorFormattingFunction()&&!strategy.getMinorFormattingFunction()&&!strategy.major.formatter&&!strategy.minor.formatter&&Math.abs(interval.end-interval.start)>=15000&&Math.abs(interval.end-interval.start)<3600000;
    paintAxisLabels(ctx,labels,axisLength,selectedTimeMinor);
    const themedTitle=theme?.[`${axis.direction}AxisTitleFillStyle`]??theme?.axisTitleFillStyle;
    const title=axis.getDisplayTitle(),titleColor=light&&!axis.hasTitleFillStyleOverride()&&!themedTitle?ColorRGBA(52,65,86):color(axis.titleFill,ColorRGBA(190,200,215));
    if(!title||titleColor.a<=0||(!horizontal&&axisLength<m.titleFont.getSize()+2))continue;
    const position=axis.getTitlePosition(),fraction=position==='start'?range.start:position==='end'?range.end:(range.start+range.end)/2;
    const along=position==='center-chart'?(horizontal?(options.width??r.left*2+r.width)/2:(options.height??r.top*2+r.height)/2):horizontal?r.left+fraction*r.width:r.top+(1-fraction)*r.height;
    const natural=Math.abs(m.rotation-(horizontal?0:-Math.PI/2))<1e-10;
    const alignment:CanvasTextAlign=natural?(position==='start'?'left':position==='end'?'right':'center'):'center';
    ctx.save();try{ctx.font=validFont(m.titleFont);ctx.fillStyle=titleColor.toCSS();ctx.textAlign=alignment;
    ctx.translate(horizontal?along:linePosition+outward*m.titleOffset,horizontal?linePosition+outward*m.titleOffset:along);ctx.rotate(m.rotation);ctx.fillText(title,0,0);}finally{ctx.restore();}
  }
  return layout;}finally{ctx.restore();}
}
