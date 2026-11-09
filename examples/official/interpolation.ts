import { ColorRGBA, LUT, PalettedFill } from '../../src/index';
import { createXY } from './helpers';
import type { OfficialEntry } from './types';

export function gridSample(rows:Float32Array[],x:number,y:number,bilinear:boolean){
  if(x<0||y<0||x>=rows[0].length||y>=rows.length)return undefined;
  if(!bilinear)return{x:Math.floor(x)+.5,y:Math.floor(y)+.5,value:rows[Math.floor(y)][Math.floor(x)]};
  const gx=Math.max(0,Math.min(rows[0].length-1,x-.5)),gy=Math.max(0,Math.min(rows.length-1,y-.5)),x0=Math.floor(gx),y0=Math.floor(gy),x1=Math.min(x0+1,rows[0].length-1),y1=Math.min(y0+1,rows.length-1),fx=gx-x0,fy=gy-y0;
  return{x,y,value:rows[y0][x0]*(1-fx)*(1-fy)+rows[y0][x1]*fx*(1-fy)+rows[y1][x0]*(1-fx)*fy+rows[y1][x1]*fx*fy};
}

/** Independent axis hit regions: axis gestures affect only that axis; plot gestures affect both. */
function navigation(chart:any,reset:()=>void){
  chart.setUserInteractions(false);const overlay=chart.overlay as HTMLCanvasElement,controller=new AbortController(),options={capture:true,signal:controller.signal},box=document.createElement('div');box.className='box-selection';box.hidden=true;chart.root.append(box);
  const local=(event:MouseEvent)=>{const rect=overlay.getBoundingClientRect();return{x:event.clientX-rect.left,y:event.clientY-rect.top};};
  const dimensions=(point:{x:number;y:number})=>point.x<chart.plot.left?['y']:point.y>chart.plot.top+chart.plot.height?['x']:['x','y'];
  const axis=(key:string)=>key==='x'?chart.getDefaultAxisX():chart.getDefaultAxisY();
  const fraction=(key:string,point:{x:number;y:number})=>key==='x'?(point.x-chart.plot.left)/chart.plot.width:1-(point.y-chart.plot.top)/chart.plot.height;
  let drag:any;
  overlay.addEventListener('pointerdown',event=>{const point=local(event);drag={point,dimensions:dimensions(point),pan:event.button!==0,intervals:{x:axis('x').getInterval(),y:axis('y').getInterval()}};overlay.setPointerCapture(event.pointerId);event.stopImmediatePropagation();event.preventDefault();},options);
  overlay.addEventListener('pointermove',event=>{if(!drag)return;const point=local(event);if(drag.pan){for(const key of drag.dimensions){const previous=drag.intervals[key],delta=(fraction(key,drag.point)-fraction(key,point))*(previous.end-previous.start);axis(key).setInterval({start:previous.start+delta,end:previous.end+delta});}}else{box.hidden=false;box.style.left=`${drag.dimensions.includes('x')?Math.max(chart.plot.left,Math.min(point.x,drag.point.x)):chart.plot.left}px`;box.style.top=`${drag.dimensions.includes('y')?Math.max(chart.plot.top,Math.min(point.y,drag.point.y)):chart.plot.top}px`;box.style.width=`${drag.dimensions.includes('x')?Math.min(chart.plot.width,Math.abs(point.x-drag.point.x)):chart.plot.width}px`;box.style.height=`${drag.dimensions.includes('y')?Math.min(chart.plot.height,Math.abs(point.y-drag.point.y)):chart.plot.height}px`;}event.stopImmediatePropagation();},options);
  overlay.addEventListener('pointerup',event=>{if(!drag)return;const point=local(event);if(!drag.pan)for(const key of drag.dimensions){const first=fraction(key,drag.point),last=fraction(key,point),previous=drag.intervals[key];if(Math.abs(first-last)>.004)axis(key).setInterval({start:previous.start+Math.min(first,last)*(previous.end-previous.start),end:previous.start+Math.max(first,last)*(previous.end-previous.start)});}drag=undefined;box.hidden=true;event.stopImmediatePropagation();},options);
  overlay.addEventListener('wheel',event=>{const point=local(event),factor=Math.exp(Math.max(-1,Math.min(1,event.deltaY*.001)));for(const key of dimensions(point)){const current=axis(key),interval=current.getInterval(),anchor=current.fractionToValue(fraction(key,point));current.setInterval({start:anchor+(interval.start-anchor)*factor,end:anchor+(interval.end-anchor)*factor});}event.stopImmediatePropagation();event.preventDefault();},{...options,passive:false});
  overlay.addEventListener('dblclick',event=>{reset();event.stopImmediatePropagation();},options);
  overlay.addEventListener('contextmenu',event=>event.preventDefault(),options);
  return()=>{controller.abort();box.remove();};
}

export const interpolationEntries:OfficialEntry[]=[{
  id:'crychart-example-0807-heatmapGridPixelInterpolation',title:'双线性插值与原始网格 · 0807',
  description:'并排显示同一份20×40强度矩阵。左侧先双线性插值强度再查色表，右侧保留原始单元格；两图可独立缩放和读取值。',
  observed:["并排显示同一份20×40强度矩阵。左侧先双线性插值强度再查色表，右侧保留原始单元格；两图可独立缩放和读取值。"],
  gaps:["本库场景的功能、交互和资源占用需在目标运行环境验证。"],
  mount(context){
    const wrapper=document.createElement('div');wrapper.style.cssText='display:grid;grid-template-columns:repeat(2,minmax(0,1fr));flex:1;min-height:0';context.host.append(wrapper);
    const columns=20,rowCount=40,data=new Float32Array(columns*rowCount),rows=Array.from({length:rowCount},(_,y)=>data.subarray(y*columns,(y+1)*columns));
    for(let y=0;y<rowCount;y++)for(let x=0;x<columns;x++){const radius=Math.hypot(x-10,y-20);rows[y][x]=Math.max(0,Math.min(100,30+24*Math.cos(radius*.7)*Math.exp(-radius/20)+46*Math.exp(-radius*radius/2.2)));}
    const lut=new LUT({steps:[{value:0,color:ColorRGBA(255,255,0)},{value:25,color:ColorRGBA(255,205,0)},{value:50,color:ColorRGBA(255,133,0)},{value:100,color:ColorRGBA(255,0,0)}],interpolate:true});
    const charts:any[]=[],heats:any[]=[],dispose:Array<()=>void>=[],hover:Array<ReturnType<typeof gridSample>|undefined>=[undefined,undefined];
    for(let index=0;index<2;index++){
      const host=document.createElement('div');host.style.cssText='display:flex;min-width:0;min-height:0';wrapper.append(host);const{chart,caption}=createXY({...context,host},'');caption.remove();chart.setPadding({left:-12,right:0,top:-46,bottom:-10});chart.getCursor().setVisible(false);charts.push(chart);
      const heat=chart.addHeatmapGridSeries({dataOrder: 'rows', columns,rows:rowCount,start:{x:0,y:0},step:{x:1,y:1}}).setName('Heatmap Grid Series').setFillStyle(new PalettedFill({lut})).setIntensityInterpolation(index===0?'bilinear':'disabled');heat.invalidateIntensityValues(rows);heats.push(heat);
      const reset=()=>{chart.getDefaultAxisX().setInterval({start:0,end:20});chart.getDefaultAxisY().setInterval({start:0,end:40});};reset();dispose.push(navigation(chart,reset));
      const tooltip=document.createElement('div');tooltip.className='shared-cursor-table';tooltip.hidden=true;const horizontal=document.createElement('div'),vertical=document.createElement('div');horizontal.style.cssText='position:absolute;border-top:1px dashed #fff6;pointer-events:none;z-index:5';vertical.style.cssText='position:absolute;border-left:1px dashed #fff6;pointer-events:none;z-index:5';horizontal.hidden=true;vertical.hidden=true;chart.root.append(tooltip,horizontal,vertical);const controller=new AbortController();
      chart.overlay.addEventListener('pointermove',(event:PointerEvent)=>{const rect=chart.overlay.getBoundingClientRect(),px=event.clientX-rect.left,py=event.clientY-rect.top,x=chart.getDefaultAxisX().fractionToValue((px-chart.plot.left)/chart.plot.width),y=chart.getDefaultAxisY().fractionToValue(1-(py-chart.plot.top)/chart.plot.height),sample=gridSample(rows,x,y,index===0);hover[index]=sample;tooltip.hidden=horizontal.hidden=vertical.hidden=!sample;if(!sample)return;const row=document.createElement('div');row.className='cursor-row';row.textContent=`Heatmap Grid Series · X ${sample.x.toFixed(index?1:4)} · Y ${sample.y.toFixed(index?1:4)} · Value ${sample.value.toFixed(index?2:5)}`;tooltip.replaceChildren(row);tooltip.style.maxWidth='235px';tooltip.style.whiteSpace='normal';tooltip.style.left=`${Math.min(px+12,chart.width-tooltip.offsetWidth-5)}px`;tooltip.style.top=`${Math.max(chart.plot.top,py-tooltip.offsetHeight-10)}px`;const hx=chart.plot.left+chart.getDefaultAxisX().valueToFraction(sample.x)*chart.plot.width,hy=chart.plot.top+(1-chart.getDefaultAxisY().valueToFraction(sample.y))*chart.plot.height;horizontal.style.left=`${chart.plot.left}px`;horizontal.style.top=`${hy}px`;horizontal.style.width=`${chart.plot.width}px`;vertical.style.left=`${hx}px`;vertical.style.top=`${chart.plot.top}px`;vertical.style.height=`${chart.plot.height}px`;},{signal:controller.signal});
      chart.overlay.addEventListener('pointerleave',()=>{hover[index]=undefined;tooltip.hidden=horizontal.hidden=vertical.hidden=true;},{signal:controller.signal});dispose.push(()=>{controller.abort();tooltip.remove();horizontal.remove();vertical.remove();});
    }
    return{charts,dispose:()=>dispose.forEach(fn=>fn()),snapshot:()=>({dataProvenance:{kind:'independent-synthetic',description:'One independently generated radial matrix used by both views.'},columns,rows:rowCount,samplesPerPanel:data.length,sharedInput:true,interpolationModes:heats.map(heat=>heat.getIntensityInterpolation()),hover,probe:{x:10.2,y:20.4,interpolated:gridSample(rows,10.2,20.4,true),discrete:gridSample(rows,10.2,20.4,false)},textureRevisions:heats.map(heat=>heat.drawPacket?.()?.revision)})};
  },
}];
