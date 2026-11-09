import {ColorRGBA,IndividualPointFill,LUT,PalettedFill,SolidFill,SolidLine} from '../../src/index';
import {random} from '../signals';
import {legend,type Trace} from './controls';
import type {OfficialEntry,OfficialMountContext} from './types';

const tau=Math.PI*2;
function polarHost(context:OfficialMountContext,title:string,maximum:number,withSide=false){
  const wrapper=document.createElement('div');wrapper.style.cssText=`display:grid;grid-template-columns:minmax(0,1fr)${withSide?' 140px':''};flex:1;min-height:0`;context.host.append(wrapper);
  const host=document.createElement('div');host.style.cssText='position:relative;min-width:0;min-height:0';wrapper.append(host);const chart=context.engine.Polar({container:host,theme:context.theme}).setTitle(title).setAngleOrigin(0).setClockwise(false).setUserInteractions(false);
  chart.setPadding({left:-30,right:-15,top:-10,bottom:-10});chart.getAmplitudeAxis().setTitle('Amplitude').setInterval({start:0,end:maximum});chart.getAngularAxis().setTitle('Degrees').setInterval({start:0,end:360});
  const side=document.createElement('div');side.style.cssText='position:relative;z-index:1;min-width:0;display:flex;flex-direction:column;align-items:stretch;justify-content:center;gap:12px;color:#eeeecb;font:12px sans-serif;padding:8px';if(withSide)wrapper.append(side);
  return {chart,wrapper,side};
}
function sideLegend(side:HTMLElement,traces:Trace[]){
  const dispose=legend(side,traces),bar=side.lastElementChild as HTMLElement;
  bar.style.cssText='height:auto;min-width:0;display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:8px;overflow:visible';
  for(const button of bar.querySelectorAll('button'))button.style.cssText='max-width:100%;white-space:normal;text-align:left;line-height:1.4';
  return dispose;
}
function colorScale(side:HTMLElement,colors:string[],labels:string[],unit=''){
  const row=document.createElement('div');row.style.cssText='display:flex;justify-content:center;gap:12px';const bar=document.createElement('div');bar.style.cssText=`width:25px;height:175px;border-radius:5px;background:linear-gradient(to top,${colors.join(',')})`;const ticks=document.createElement('div');ticks.style.cssText='display:flex;flex-direction:column;justify-content:space-between';for(const text of [...labels].reverse()){const label=document.createElement('span');label.textContent=text;ticks.append(label);}row.append(bar,ticks);side.append(row);if(unit){const label=document.createElement('div');label.style.textAlign='center';label.textContent=unit;side.append(label);}
}
function heatCursor(chart:any,heat:any,unit=''){
  const table=document.createElement('div');table.className='shared-cursor-table';table.hidden=true;chart.root.append(table);const controller=new AbortController();
  let pointer:{clientX:number;clientY:number}|undefined;
  const draw=()=>{const result=pointer&&heat.solveNearestFromScreen(pointer);table.hidden=!result;if(!result)return;const row=document.createElement('div');row.className='cursor-row';row.textContent=`${result.angleDeg.toFixed(1)}° · ${result.amplitude.toFixed(2)} · ${result.intensity.toFixed(3)} ${unit}`;table.replaceChildren(row);const bounds=chart.overlay.getBoundingClientRect();table.style.left=`${Math.min(pointer!.clientX-bounds.left+12,chart.width-table.offsetWidth-7)}px`;table.style.top=`${Math.max(32,pointer!.clientY-bounds.top-table.offsetHeight-10)}px`;};
  // Retain client coordinates, not a stale polar cell: data, layout and axis
  // changes must resolve the current sample even without a pointer event.
  const token=chart.on('render',draw);
  chart.overlay.addEventListener('pointermove',(event:PointerEvent)=>{pointer={clientX:event.clientX,clientY:event.clientY};draw();},{signal:controller.signal});
  chart.overlay.addEventListener('pointerleave',()=>{pointer=undefined;table.hidden=true;},{signal:controller.signal});
  return()=>{controller.abort();chart.off(token);pointer=undefined;table.remove();};
}
function thermalField(angle:number,radius:number){return Math.max(0,Math.min(60,37+16*Math.sin(radius*16-1.2*Math.cos(angle*3))+7*Math.cos(angle*2+radius*5)));}
function thermalLUT(){return new LUT({steps:[{value:0,color:ColorRGBA(255,255,0)},{value:30,color:ColorRGBA(255,160,0)},{value:60,color:ColorRGBA(255,0,0)}],interpolate:true,units:'°C'});}
function heatTrace(series:any,color='#fff390'):Trace{return{name:series.getName(),points:[],series,color};}

export const polarHeatmapEntries:OfficialEntry[]=[
  {
    id:'crychart-example-1002-polarEMFieldStrength',title:'电磁场极坐标面积 · 1002',description:'两个频段的方向强度以半透明闭合面积叠加；圆形最大强度线与图例可分别切换。',
    observed:["两个频段的方向强度以半透明闭合面积叠加；圆形最大强度线与图例可分别切换。"],
    gaps:["本库场景的功能、交互和资源占用需在目标运行环境验证。"],
    mount(context){const {chart,wrapper}=polarHost(context,'Electromagnetic field strength',10);chart.getAmplitudeAxis().setTitle('Field strength H (A/m)');const rng=random(11002),traces:Trace[]=[];
      for(let channel=0;channel<2;channel++){const color=channel?ColorRGBA(255,205,90):ColorRGBA(239,244,85),points=Array.from({length:1441},(_,i)=>{const angle=i/4,a=angle*Math.PI/180,lobe=Math.max(0,Math.cos(a*3+(channel?.1:2.6)));return{x:angle,y:Math.min(9.8,.7+8.8*lobe**.65+(rng()-.5)*.3+1.2*Math.sin(a*7+channel)**2)};});points.at(-1)!.y=points[0].y;const series=chart.addAreaSeries().setName(channel?'Below 100MHz':'Above 100MHz').setAreaFillStyle(new SolidFill({color:color.setA(130)})).setStrokeStyle(new SolidLine({thickness:1.4,fillStyle:new SolidFill({color})})).add(points);traces.push({name:series.getName(),color:color.toCSS(),points,series});}
      const circle=Array.from({length:361},(_,angle)=>({x:angle,y:10})),limit=chart.addLineSeries().setName('Max Field Strength').setStrokeStyle(new SolidLine({thickness:1.4,fillStyle:new SolidFill({color:ColorRGBA(180,180,180)})})).add(circle);traces.push({name:limit.getName(),points:circle,series:limit,color:'#b4b4b4'});const clearLegend=legend(context.host,traces);return{charts:[chart],traces,dispose:()=>{clearLegend();wrapper.remove();},snapshot:()=>({rendering:'Canvas2D polar paths',seriesCount:3,areaCount:2,closed:traces.every(t=>t.points[0].y===t.points.at(-1)!.y),maximum:10})};}
  },
  {
    id:'crychart-example-1003-polarHeatmapBasic',title:'极坐标平滑热力图 · 1003',description:'二维强度矩阵映射到扇区和圆环。双线性插值在角度接缝连续，颜色按真实温度断点查表。',
    observed:["二维强度矩阵映射到扇区和圆环。双线性插值在角度接缝连续，颜色按真实温度断点查表。"],
    gaps:["本库场景的功能、交互和资源占用需在目标运行环境验证。"],
    mount(context){const {chart,wrapper,side}=polarHost(context,'Polar Chart',100,true),sectors=180,annuli=100,values=Float32Array.from({length:sectors*annuli},(_,i)=>thermalField((i%sectors+.5)/sectors*tau,(Math.floor(i/sectors)+.5)/annuli));const heat=chart.addHeatmapSeries({sectors,annuli,amplitudeEnd:100}).setName('Heatmap Series').setFillStyle(new PalettedFill({lut:thermalLUT()})).setIntensityInterpolation('bilinear').setCursorInterpolationEnabled(true).invalidateIntensityValues(values);const traces=[heatTrace(heat)],clearLegend=sideLegend(side,traces),clearCursor=heatCursor(chart,heat,'°C');colorScale(side,['#ffff00','#ffa000','#ff0000'],['0.0','20.0','40.0','60.0'],'°C');return{charts:[chart],traces,dispose:()=>{clearLegend();clearCursor();wrapper.remove();},snapshot:()=>({sectors,annuli,samples:values.length,interpolation:heat.getIntensityInterpolation(),hoverPixel:chart.projectPolarPoint({angle:45,amplitude:50}),intensity:heat.getIntensityAt(45,50),angularWrap:true,seamPixels:[chart.projectPolarPoint({angle:359.8,amplitude:50}),chart.projectPolarPoint({angle:.2,amplitude:50})]})};}
  },
  {
    id:'crychart-example-1004-polarHeatmapRadar',title:'雷达扇区增量更新 · 1004',description:'360×200 的极坐标热图持续保留72000个强度值。按60次/秒的采样时钟更新一个200点扇区，完成一周后继续覆盖。',
    observed:["360×200 的极坐标热图持续保留72000个强度值。按60次/秒的采样时钟更新一个200点扇区，完成一周后继续覆盖。"],
    gaps:["本库场景的功能、交互和资源占用需在目标运行环境验证。"],
    mount(context){const {chart,wrapper}=polarHost(context,'Polar Chart',200),sectors=360,annuli=200,values=Float32Array.from({length:sectors*annuli},(_,i)=>thermalField((i%sectors+.5)/sectors*tau,(Math.floor(i/sectors)+.5)/annuli)),heat=chart.addHeatmapSeries({sectors,annuli,amplitudeEnd:200,dataOrder:'sectors'}).setName('Radar').setFillStyle(new PalettedFill({lut:thermalLUT()})).setIntensityInterpolation('bilinear').invalidateIntensityValues(values),rng=random(11004);let vectors=0;const clearCursor=heatCursor(chart,heat,'°C');return{charts:[chart],traces:[heatTrace(heat)],update:(elapsed)=>{const target=Math.floor(elapsed*60);while(vectors<target){const sector=vectors%sectors,column=Array.from({length:annuli},(_,row)=>Math.max(0,Math.min(60,thermalField((sector+.5)/sectors*tau,(row+.5)/annuli)+(rng()-.5)*24)));heat.invalidateIntensityValues({iSector:sector,iAnnulus:0,values:[column]});vectors++;}},dispose:()=>{clearCursor();wrapper.remove();},snapshot:()=>({sectors,annuli,samples:heat.getSampleCount(),vectors,samplesUpdated:vectors*annuli,sampleClockHz:60,samplesPerVector:200,nextSector:vectors%sectors,textureUploads:chart.getRenderStats().heatmapStats,hoverPixel:chart.projectPolarPoint({angle:45,amplitude:80})})};}
  },
  {
    id:'crychart-example-1005-polarHeatmapSensors',title:'极坐标传感器插值 · 1005',description:'37个传感器随时间改变测量值。原创距离权重将离散测量插值到热图；传感器、热图和网格采样点可独立开关。',
    observed:["37个传感器随时间改变测量值。原创距离权重将离散测量插值到热图；传感器、热图和网格采样点可独立开关。"],
    gaps:["本库场景的功能、交互和资源占用需在目标运行环境验证。","37个传感器和12×10网格根据可见布局独立建模，仍需与原版公开读回数据核对。"],
    mount(context){const {chart,wrapper,side}=polarHost(context,'Polar Chart',10,true),lut=new LUT({steps:[{value:0,color:ColorRGBA(16,16,115)},{value:.35,color:ColorRGBA(20,95,115)},{value:.65,color:ColorRGBA(109,115,18)},{value:1,color:ColorRGBA(123,32,10)}],interpolate:true}),sensorPositions=[{angle:0,amplitude:0},...[3,7,10].flatMap(amplitude=>Array.from({length:12},(_,i)=>({angle:i*30,amplitude})))],sectors=12,annuli=10;
      const cells=Array.from({length:sectors*annuli},(_,i)=>({angle:(i%sectors)*360/sectors,amplitude:Math.floor(i/sectors)*10/(annuli-1)})),weights=new Float64Array(cells.length*sensorPositions.length),cartesian=(p:{angle:number;amplitude:number})=>({x:p.amplitude*Math.cos(p.angle*Math.PI/180),y:p.amplitude*Math.sin(p.angle*Math.PI/180)});
      cells.forEach((cell,i)=>{const a=cartesian(cell);let sum=0;sensorPositions.forEach((sensor,j)=>{const b=cartesian(sensor),w=1/(.02+(a.x-b.x)**2+(a.y-b.y)**2);weights[i*sensorPositions.length+j]=w;sum+=w;});for(let j=0;j<sensorPositions.length;j++)weights[i*sensorPositions.length+j]/=sum;});
      const heat=chart.addHeatmapSeries({sectors,annuli,amplitudeEnd:10}).setName('Heatmap').setFillStyle(new PalettedFill({lut})).setIntensityInterpolation('bilinear').setCursorInterpolationEnabled(true),sensors=chart.addPointSeries().setName('Sensor locations').setPointSize(9).setPointFillStyle(new IndividualPointFill()),cellPoints=chart.addPointSeries().setName('Cell locations').setPointSize(2).setPointFillStyle(new SolidFill({color:ColorRGBA(0,0,0,150)})).add(cells);
      const traces=[heatTrace(sensors),heatTrace(heat),heatTrace(cellPoints,'#000')],clearLegend=sideLegend(side,traces),clearCursor=heatCursor(chart,heat),values=new Float32Array(cells.length);let revision=0,lastTick=-1;
      const update=(elapsed:number)=>{const tick=Math.floor(elapsed*60);if(tick===lastTick)return;lastTick=tick;const readings=sensorPositions.map((sensor,i)=>.5+.25*Math.sin(elapsed*.7+i*.43)+.2*Math.cos(elapsed*.37+i*.71));for(let i=0;i<cells.length;i++){let value=0;for(let j=0;j<readings.length;j++)value+=weights[i*readings.length+j]*readings[j];values[i]=value;}heat.invalidateIntensityValues(values);sensors.clear().add(sensorPositions.map((p,i)=>({...p,color:ColorRGBA(210+readings[i]*45,235,100+readings[i]*110)})));revision++;};update(0);colorScale(side,['#101073','#145f73','#6d7312','#7b200a'],['0.00','0.33','0.67','1.00']);
      return{charts:[chart],traces,update,dispose:()=>{clearLegend();clearCursor();wrapper.remove();},snapshot:()=>({sensorCount:sensorPositions.length,cellCount:cells.length,sectors,annuli,revision,sampleClockHz:60,range:{min:Math.min(...values),max:Math.max(...values)},hoverPixel:chart.projectPolarPoint({angle:45,amplitude:5}),interpolation:'normalized inverse-square distance weights, then periodic bilinear intensities'})};}
  }
];
