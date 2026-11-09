import { ColorRGBA, LUT, PalettedFill, PointShape, SolidFill, SolidLine } from '../../src/index';
import { random } from '../signals';
import { legend, pointCursor, sharedCursor, xNavigation, type Trace } from './controls';
import { createXY } from './helpers';
import type { OfficialEntry } from './types';

const yellow=ColorRGBA(239,241,77),green=ColorRGBA(0,240,0),red=ColorRGBA(255,0,0);
const fill=(color:ReturnType<typeof ColorRGBA>)=>new SolidFill({color});
const stroke=(color:ReturnType<typeof ColorRGBA>,thickness=1.6)=>new SolidLine({fillStyle:fill(color),thickness});
const visualGap='原始样本、光晕、字体和刻度密度不逐像素等同；当前实现保持独立数据与原创渲染。';
const timeLabel=(value:number)=>{const milliseconds=Math.max(0,Math.round(value)),seconds=Math.floor(milliseconds/1000);return`00:${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}${milliseconds%1000?'.'+String(milliseconds%1000).padStart(3,'0'):''}`;};

export const paletteEntries:OfficialEntry[]=[
  {
    id:'crychart-example-0022-2dPointsValuePalette',title:'散点离轨距离调色 · 0022',
    description:'连续轨迹以亮黄色显示；周围散点按与轨迹的纵向距离映射为黄色、橙色和暗红色。右侧色标与悬停结果使用同一距离值。',
    observed:["连续轨迹以亮黄色显示；周围散点按与轨迹的纵向距离映射为黄色、橙色和暗红色。右侧色标与悬停结果使用同一距离值。"],
    gaps:["轨迹和散点使用独立确定性随机模型；原始点数和噪声分布未知。","本库场景的功能、交互和资源占用需在目标运行环境验证。"],
    mount(context){
      const wrapper=document.createElement('div');wrapper.style.cssText='display:grid;grid-template-columns:minmax(0,1fr) 135px;min-height:0;flex:1';context.host.append(wrapper);
      const plotHost=document.createElement('div');plotHost.style.cssText='min-width:0;min-height:0;display:flex';wrapper.append(plotHost);const{chart}=createXY({...context,host:plotHost},'2D points value palette coloring');chart.setPadding({left:0,right:0,top:-18,bottom:0});
      const side=document.createElement('div');side.style.cssText='display:flex;flex-direction:column;justify-content:center;align-items:flex-start;gap:12px;font:12px sans-serif;color:#f3f3d2;padding:0 8px';wrapper.append(side);
      const lut=new LUT({steps:[{value:0,color:ColorRGBA(255,255,0)},{value:.33,color:ColorRGBA(255,213,0)},{value:.67,color:ColorRGBA(255,115,0)},{value:1,color:ColorRGBA(70,4,0)}],interpolate:true});
      const rng=random(2200),linePoints:Array<{x:number;y:number}>=[],outliers:Array<{x:number;y:number;value:number}>=[];let drift=0;
      for(let x=0;x<1000;x++){drift=drift*.96+(rng()-.5)*.75;const y=x*.035+4*Math.sin(x/65)+2*Math.sin(x/140)+drift;linePoints.push({x,y});for(let j=0;j<20;j++){const displacement=(rng()-.5)*24;outliers.push({x,y:y+displacement,value:Math.abs(displacement)/12});}}
      const pointSeries=chart.addPointSeries().setName('Outliers').setPointShape(PointShape.Circle).setPointSize(2).setIndividualPointValueEnabled(true).setPointFillStyle(new PalettedFill({lut,lookUpProperty:'value'})).add(outliers),lineSeries=chart.addLineSeries().setName('Trace stroke').setStrokeStyle(stroke(yellow,2.6)).add(linePoints);
      const traces:Trace[]=[{name:'Trace stroke',color:yellow.toCSS(),series:lineSeries,points:linePoints},{name:'Outliers',color:'#ffaa00',series:pointSeries,points:outliers,pointLabel:point=>`${point.y.toFixed(2)} · dist ${((point as typeof outliers[number]).value*100).toFixed(1)}%`}];
      const disposeLegend=legend(side,traces);side.querySelector<HTMLElement>('.official-legend')!.style.cssText='height:auto;display:flex;flex-direction:column;align-items:flex-start;background:transparent;gap:8px';
      const scale=document.createElement('div');scale.style.cssText='display:flex;gap:12px;margin:8px 0 0 16px';const bar=document.createElement('div');bar.style.cssText='width:25px;height:140px;border-radius:4px;background:linear-gradient(to top,#ffff00,#ffd500 33%,#ff7300 67%,#460400)';const ticks=document.createElement('div');ticks.style.cssText='display:flex;flex-direction:column;justify-content:space-between';for(const text of ['100%','67%','33%','0%']){const tick=document.createElement('span');tick.textContent=text;ticks.append(tick);}scale.append(bar,ticks);side.append(scale);const unit=document.createElement('div');unit.textContent='trace dist (y)';unit.style.marginLeft='47px';side.append(unit);
      const reset=()=>{chart.getDefaultAxisX().setInterval({start:0,end:1000});chart.getDefaultAxisY().setInterval({start:-14,end:47});};reset();
      const dispose=[disposeLegend,pointCursor(chart,traces,value=>`X ${value.toFixed(1)}`),xNavigation(chart,reset,()=>{},true)];
      return{charts:[chart],traces,dispose:()=>dispose.forEach(fn=>fn()),snapshot:()=>({traceSamples:1000,outlierSamples:outliers.length,paletteProperty:'value',distanceDenominator:12,distanceRange:[Math.min(...outliers.map(point=>point.value)),Math.max(...outliers.map(point=>point.value))],paletteSteps:lut.getSteps().map(step=>({value:step.value,color:step.color.toCSS()})),hoverTarget:outliers[10025],attributeColors:pointSeries.drawPacket('points').colors.length/4})};
    },
  },
  {
    id:'crychart-example-0037-bubbleChart',title:'三指标与分组气泡 · 0037',
    description:'三个分组使用独立颜色；气泡横纵位置表达 KPI X/Y，直径表达第三个 KPI，细描边保留重叠轮廓。',
    observed:["三个分组使用独立颜色；气泡横纵位置表达 KPI X/Y，直径表达第三个 KPI，细描边保留重叠轮廓。"],
    gaps:["本库场景的功能、交互和资源占用需在目标运行环境验证。"],
    mount(context){
      const{chart}=createXY(context,'Bubble Chart with 3 KPIs and data grouping'),rng=random(3700),colors=[ColorRGBA(239,241,77,95),ColorRGBA(249,202,91,95),ColorRGBA(233,150,100,95)];
      const traces:Trace[]=colors.map((color,index)=>{const points=Array.from({length:500},()=>{const value=rng()**2;return{x:rng(),y:rng(),value,size:2+16*value};}),name=`Group ${index+1}`,series=chart.addPointSeries().setName(name).setPointShape(PointShape.Circle).setPointFillStyle(fill(color)).setPointStrokeStyle(stroke(ColorRGBA(243,243,221,215),.8)).setIndividualPointSizeEnabled(true).add(points);return{name,color:color.setA(255).toCSS(),series,points,pointLabel:point=>`Y ${point.y.toFixed(3)} · KPI 3 ${(point as typeof points[number]).value.toFixed(3)}`};});
      chart.getDefaultAxisX().setTitle('KPI X').setTickStrategy('numeric',(strategy:any)=>strategy.setFormattingFunction((value:number)=>value.toFixed(chart.getDefaultAxisX().getInterval().end-chart.getDefaultAxisX().getInterval().start<.2?4:2)));chart.getDefaultAxisY().setTitle('KPI Y').setTickStrategy('numeric',(strategy:any)=>strategy.setFormattingFunction((value:number)=>value.toFixed(chart.getDefaultAxisY().getInterval().end-chart.getDefaultAxisY().getInterval().start<.2?4:2)));
      const reset=()=>{chart.getDefaultAxisX().setInterval({start:-.025,end:1.025});chart.getDefaultAxisY().setInterval({start:-.025,end:1.025});};reset();
      const dispose=[legend(context.host,traces),pointCursor(chart,traces,value=>`KPI X ${value.toFixed(3)}`),xNavigation(chart,reset,()=>{},true)];
      return{charts:[chart],traces,dispose:()=>dispose.forEach(fn=>fn()),snapshot:()=>({groups:3,samplesPerGroup:500,sizeRange:[2,18],individualSizes:traces.map(trace=>trace.series.getIndividualPointSizeEnabled()),distinctSizes:traces.map(trace=>new Set(Array.from(trace.series.drawPacket('points').pointSizes)).size),fillAlpha:95,strokeWidth:.8,hoverTarget:traces[0].points[180],sizeAttributeCount:traces.map(trace=>trace.series.drawPacket('points').pointSizes.length)})};
    },
  },
  {
    id:'crychart-example-0050-linePaletteX',title:'心搏时间区间着色 · 0050',
    description:'一条原创 ECG 型信号按 X 时间区间着色。心搏窗口使用绿色，其余部分使用黄色，缩放后仍保留完整波形和准确色界。',
    observed:["一条原创 ECG 型信号按 X 时间区间着色。心搏窗口使用绿色，其余部分使用黄色，缩放后仍保留完整波形和准确色界。"],
    gaps:["本库场景的功能、交互和资源占用需在目标运行环境验证。"],
    mount(context){
      const{chart}=createXY(context,'ECG chart with color highlighted heart beats'),rng=random(5000),centers=Array.from({length:12},(_,i)=>400+i*800),count=10001;
      const steps:Array<{value:number;color:ReturnType<typeof ColorRGBA>}>=[{value:0,color:yellow}];for(const center of centers){steps.push({value:center-50,color:green},{value:center+165,color:yellow});}
      const lut=new LUT({steps,interpolate:false}),gauss=(t:number,center:number,width:number)=>Math.exp(-.5*((t-center)/width)**2);
      const points=Array.from({length:count},(_,x)=>{const phase=x-centers[Math.max(0,Math.min(centers.length-1,Math.round((x-400)/800)))];const y=1050*gauss(phase,-17,8)-1620*gauss(phase,9,13)+420*gauss(phase,52,20)-300*gauss(phase,288,28)+105*gauss(phase,-185,17)+24*Math.sin(x*.12)+(rng()-.5)*35;return{x,y};});
      const series=chart.addLineSeries().setName('ECG').setStrokeStyle(new SolidLine({fillStyle:new PalettedFill({lut,lookUpProperty:'x'}),thickness:1.6})).add(points),trace:Trace={name:'ECG',color:yellow.toCSS(),series,points,unit:'mV'};
      chart.getDefaultAxisX().setTickStrategy('numeric',(strategy:any)=>strategy.setFormattingFunction(timeLabel));chart.getDefaultAxisY().setTitle('mV');
      const reset=()=>{chart.getDefaultAxisX().setInterval({start:0,end:10000});chart.getDefaultAxisY().setInterval({start:-1650,end:1050});};reset();const dispose=[sharedCursor(chart,[trace],timeLabel),xNavigation(chart,reset)];
      return{charts:[chart],traces:[trace],dispose:()=>dispose.forEach(fn=>fn()),snapshot:()=>({samples:count,paletteProperty:'x',heartbeatWindows:centers.map(center=>({start:center-50,end:center+165})),paletteSteps:lut.getSteps().length,interpolate:false,renderedColorValues:series.drawPacket().colors.length/4,inputYRange:[Math.min(...points.map(point=>point.y)),Math.max(...points.map(point=>point.y))]})};
    },
  },
  {
    id:'crychart-example-0051-linePaletteY',title:'按数值标记好坏区间 · 0051',
    description:'同一条折线在数值高于 10000 时变绿，低于 -30000 时变红，其他区间为黄色；两条对应水平线清楚标记阈值。',
    observed:["同一条折线在数值高于 10000 时变绿，低于 -30000 时变红，其他区间为黄色；两条对应水平线清楚标记阈值。"],
    gaps:["本库场景的功能、交互和资源占用需在目标运行环境验证。","阈值线是否可拖动与拖动后 LUT 更新规则尚未专项观察，本地先保持固定阈值。"],
    mount(context){
      const{chart}=createXY(context,'Line Chart with dynamic good/bad values highlighting'),rng=random(5100),low=-30000,high=10000,lut=new LUT({steps:[{value:-100000,color:red},{value:low,color:yellow},{value:high,color:green}],interpolate:false});let noise=0;
      const points=Array.from({length:10001},(_,x)=>{noise=noise*.92+(rng()-.5)*1900;const y=-15000+27000*Math.cos(x/1250)-11500*Math.exp(-(((x-3500)/1050)**2))+6500*Math.sin(x/220)+noise;return{x,y};});
      const series=chart.addLineSeries().setName('Value').setStrokeStyle(new SolidLine({fillStyle:new PalettedFill({lut,lookUpProperty:'y'}),thickness:1.6})).add(points),trace:Trace={name:'Value',color:yellow.toCSS(),series,points};
      chart.getDefaultAxisY().addConstantLine().setValue(low).setStrokeStyle(stroke(red.setA(105),1)).setMouseInteractions(false);chart.getDefaultAxisY().addConstantLine().setValue(high).setStrokeStyle(stroke(green.setA(105),1)).setMouseInteractions(false);
      const reset=()=>{chart.getDefaultAxisX().setInterval({start:0,end:10000});chart.getDefaultAxisY().setInterval({start:-58000,end:25000});};reset();const dispose=[sharedCursor(chart,[trace],value=>`X ${value.toFixed(0)}`),xNavigation(chart,reset,()=>{},true)];
      return{charts:[chart],traces:[trace],dispose:()=>dispose.forEach(fn=>fn()),snapshot:()=>({samples:points.length,paletteProperty:'y',thresholds:[low,high],interpolate:false,inputRegions:{red:points.filter(point=>point.y<low).length,yellow:points.filter(point=>point.y>=low&&point.y<high).length,green:points.filter(point=>point.y>=high).length},renderedColorValues:series.drawPacket().colors.length/4})};
    },
  },
];
