import {HeatmapSeries} from '../../src/series';
import {DataRendererHeatmap,type DrawPacketHeatmap} from '../../src/render-heatmap';
import {ChartXY} from '../../src/chart';
// The runner supplies an isolated pre-change HeatmapSeries, with the same dependencies.
// @ts-ignore virtual test-only module
import {HeatmapSeries as BeforeHeatmapSeries} from 'virtual:before-heatmap';

const columns=250,rows=1000,palette=new Uint8Array([15,25,220,255,245,210,55,255]),rect={left:0,top:0,width:590,height:550};
const host:any={getDefaultAxisX:()=>({}),getDefaultAxisY:()=>({}),invalidate:()=>{},removeSeries:()=>{}};
type PairItem={heat:any;canvas:HTMLCanvasElement;gl:WebGL2RenderingContext;renderer:DataRendererHeatmap};
const make=(id:string,Series:any,scrolling=false):PairItem=>{const canvas=document.querySelector<HTMLCanvasElement>(id)!,gl=canvas.getContext('webgl2',{antialias:false,preserveDrawingBuffer:true})!;if(!gl)throw new Error('WebGL2 unavailable');return{canvas,gl,heat:new Series(host,{dataOrder: 'rows', columns,rows,scrollDimension:'columns'},scrolling),renderer:new DataRendererHeatmap(gl,canvas)};};
let pair=[make('#before',BeforeHeatmapSeries),make('#after',HeatmapSeries)];
const initialize=()=>Float32Array.from({length:columns*rows},(_,index)=>index%997===0?NaN:.5+.45*Math.sin((index%columns)*.04)*Math.cos(Math.floor(index/columns)*.018));
const packet=(item:PairItem):DrawPacketHeatmap=>({id:item.heat.id,revision:item.heat.dataRevision,values:item.heat.data,columns,rows,extent:[0,1,0,1],intensityRange:{start:0,end:1},palette,paletteRevision:item.heat.paletteRevision,scrollOffset:item.heat.getScrollOffset(),update:item.heat.dataUpdate});
const draw=(item:PairItem)=>{const data=packet(item);item.renderer.render([data],rect,1);if(item.renderer.getUploadedRevision(item.heat.id)===data.revision)item.heat.acknowledgeDataRevision?.(data.revision);};
const apply=(fn:(heat:any)=>void)=>pair.forEach(item=>fn(item.heat));
const patch=(x:number,y:number,width:number,height:number,value:number)=>apply(heat=>heat.invalidateIntensityValues({iColumn:x,iRow:y,values:Array.from({length:height},()=>Array.from({length:width},()=>value))}));
let integration:ChartXY|undefined,integrationHeat:any;
function compare(name:string,beforeBytes:number[],extra:Record<string,unknown>={}){
  pair.forEach(draw);const outputs=pair.map(({gl,canvas})=>{const data=new Uint8Array(canvas.width*canvas.height*4);gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,data);const error=gl.getError();if(error)throw new Error(`WebGL error ${error}`);return data;});let changed=0,maximumDifference=0,colored=0;
  for(let i=0;i<outputs[0].length;i++){const difference=Math.abs(outputs[0][i]-outputs[1][i]);if(difference)changed++;maximumDifference=Math.max(maximumDifference,difference);if(i%4===0&&outputs[1][i+3]>100&&Math.max(outputs[1][i],outputs[1][i+1],outputs[1][i+2])-Math.min(outputs[1][i],outputs[1][i+1],outputs[1][i+2])>45)colored++;}
  if(changed)throw new Error(`${name}: ${changed} RGBA bytes differ, max ${maximumDifference}`);if(colored<100)throw new Error(`${name}: missing visible colored cells`);
  const uploaded=pair.map((item,index)=>item.renderer.stats.uploadedBytes-beforeBytes[index]);return{name,rgbaBytes:outputs[0].length,differingBytes:changed,maximumDifference,coloredPixels:colored,uploadedBytesBefore:uploaded[0],uploadedBytesAfter:uploaded[1],...extra};
}
const counters=()=>pair.map(item=>item.renderer.stats.uploadedBytes);
const waitFrames=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
const run=async(name:string)=>{
  const bytes=counters();
  if(name==='initial'){apply(heat=>heat.invalidateIntensityValues(initialize()));return compare(name,bytes);}
  if(name==='two-columns'){patch(101,0,1,rows,.12);patch(102,0,1,rows,.88);const result=compare(name,bytes);if(result.uploadedBytesAfter!==8000||result.uploadedBytesBefore!==1000000)throw new Error(JSON.stringify(result));return result;}
  if(name==='disjoint-patches'){patch(55,260,3,40,.25);patch(65,285,2,35,.9);const result=compare(name,bytes);if(result.uploadedBytesAfter!==12*60*4)throw new Error(JSON.stringify(result));return result;}
  if(name==='full-then-patch'){apply(heat=>heat.invalidateIntensityValues(initialize().map(value=>1-value)));patch(151,200,12,300,.75);const result=compare(name,bytes);if(result.uploadedBytesAfter!==1000000)throw new Error(JSON.stringify(result));return result;}
  if(name==='stale-ack'){const stale=pair[1].heat.dataRevision;patch(111,100,1,800,.35);pair[1].heat.acknowledgeDataRevision(stale);patch(112,100,1,800,.8);const result=compare(name,bytes);if(result.uploadedBytesAfter!==2*800*4)throw new Error(JSON.stringify(result));return result;}
  if(name==='hide-show'){pair.forEach(item=>item.renderer.render([],rect,1));patch(20,150,8,600,.63);patch(35,200,5,500,.19);const result=compare(name,bytes);if(result.uploadedBytesAfter!==1000000+palette.length)throw new Error(JSON.stringify(result));return result;}
  if(name==='clear-then-patch'){apply(heat=>heat.clear());patch(110,400,25,200,.8);return compare(name,bytes);}
  if(name==='scroll-initialize'){pair.forEach(item=>item.renderer.dispose());pair=[make('#before',BeforeHeatmapSeries,true),make('#after',HeatmapSeries,true)];const values=Array.from({length:249},(_,col)=>Float32Array.from({length:rows},(_,row)=>.5+.45*Math.sin(col*.04)*Math.cos(row*.018)));apply(heat=>heat.addIntensityValues(values));return compare(name,[0,0]);}
  if(name==='scroll-wrap'){apply(heat=>heat.addIntensityValues([new Float32Array(rows).fill(.1),new Float32Array(rows).fill(.9),new Float32Array(rows).fill(.5)]));apply(heat=>heat.addIntensityValues(new Float32Array(rows).fill(.7)));return compare(name,bytes);}
  if(name==='scroll-two-vectors'){apply(heat=>heat.addIntensityValues(new Float32Array(rows).fill(.2)));apply(heat=>heat.addIntensityValues(new Float32Array(rows).fill(.8)));const result=compare(name,bytes);if(result.uploadedBytesAfter!==8000)throw new Error(JSON.stringify(result));return result;}
  if(name==='context-restore'){
    const extensions=pair.map(item=>item.gl.getExtension('WEBGL_lose_context'));if(extensions.some(ext=>!ext))throw new Error('Context loss extension unavailable');
    const lost=pair.map(item=>new Promise<void>(resolve=>item.canvas.addEventListener('webglcontextlost',()=>resolve(),{once:true})));extensions.forEach(ext=>ext!.loseContext());await Promise.all(lost);
    if(pair.some(item=>item.renderer.getUploadedRevision(item.heat.id)!==undefined))throw new Error('Lost contexts must not acknowledge data');
    apply(heat=>heat.addIntensityValues(new Float32Array(rows).fill(.42)));pair.forEach(draw);const pending=pair[1].heat.dataUpdate;if(!pending)throw new Error('Unuploaded changes were incorrectly acknowledged');
    await new Promise(resolve=>setTimeout(resolve,150));const restored=pair.map(item=>new Promise<void>(resolve=>item.canvas.addEventListener('webglcontextrestored',()=>resolve(),{once:true})));extensions.forEach(ext=>ext!.restoreContext());await Promise.all(restored);await waitFrames();return compare(name,bytes,{pendingPreservedWhileLost:true});
  }
  if(name==='chart-integration'){
    const container=document.querySelector<HTMLElement>('#integration')!;container.hidden=false;integration=new ChartXY({container});integration.getDefaultAxisX().setInterval({start:0,end:columns});integration.getDefaultAxisY().setInterval({start:0,end:rows});integrationHeat=integration.addHeatmapGridSeries({dataOrder: 'rows', columns,rows}).invalidateIntensityValues(initialize());await waitFrames();if(integrationHeat.dataUpdate!==undefined)throw new Error('Chart did not acknowledge initial upload');
    const before=integration.getRenderStats().heatmapStats!.uploadedBytes;integrationHeat.invalidateIntensityValues({iColumn:100,iRow:0,values:Array.from({length:rows},()=>[.18])});integrationHeat.invalidateIntensityValues({iColumn:101,iRow:0,values:Array.from({length:rows},()=>[.82])});await waitFrames();const after=integration.getRenderStats().heatmapStats!.uploadedBytes;if(after-before!==8000)throw new Error(`Chart uploaded ${after-before} instead of 8000 bytes`);if(integrationHeat.dataUpdate!==undefined)throw new Error('Chart did not acknowledge merged upload');
    integrationHeat.setVisible(false);await waitFrames();integrationHeat.invalidateIntensityValues({iColumn:40,iRow:100,values:[[.3],[.7]]});await waitFrames();if(!integrationHeat.dataUpdate)throw new Error('Hidden data incorrectly acknowledged');integrationHeat.setVisible(true);await waitFrames();if(integrationHeat.dataUpdate!==undefined)throw new Error('Shown data was not acknowledged');return{name,mergedUploadBytes:after-before,hiddenChangePreserved:true,shownRevisionAcknowledged:true};
  }
  throw new Error(`Unknown case ${name}`);
};
(window as any).__heatmapDirtyProbe={run,dispose:()=>{pair.forEach(item=>item.renderer.dispose());integration?.dispose();}};
