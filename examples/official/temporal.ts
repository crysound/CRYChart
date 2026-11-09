import { ColorRGBA, SolidFill, SolidLine, LinearGradientFill, PointShape } from '../../src/index';
import { random } from '../signals';
import { legend, sharedCursor, xNavigation, dateLabel, type Trace } from './controls';
import { createXY } from './helpers';
import { calendarTicks, durationTicks, elapsedLabel, millisecondsPerDay, visibleExtent } from './temporal-data';
import type { OfficialEntry, OfficialMountContext } from './types';

const colors=[ColorRGBA(238,241,73),ColorRGBA(231,147,90),ColorRGBA(221,135,173)];
const stroke=(color=colors[0])=>new SolidLine({fillStyle:new SolidFill({color}),thickness:1.6});
const gap="本库场景的功能、交互和资源占用需在目标运行环境验证。";
const provenance={kind:'independent-synthetic',description:'Independent deterministic signals; no upstream arrays or implementation were copied.'};
function timeAxis(chart:any) { chart.setPadding({left:6,right:30,top:-18,bottom:0});const axis=chart.getDefaultAxisX();axis.setTickStrategy('time',(strategy:any)=>strategy.setMajorTickPlacement(({interval:{start,end}}:{interval:{start:number;end:number}})=>durationTicks(start,end))); }
function calendarAxis(chart:any,origin=0) { const axis=chart.getDefaultAxisX();axis.setTickStrategy('datetime',(strategy:any)=>strategy.setDateOrigin(origin).setMajorTickPlacement(({interval:{start,end}}:{interval:{start:number;end:number}})=>calendarTicks(start+origin,end+origin).map(tick=>({...tick,position:tick.position-origin})))); }
function panelStack(context:OfficialMountContext,count:number){const wrapper=document.createElement('div');wrapper.style.cssText=`display:grid;grid-template-rows:repeat(${count},minmax(0,1fr));flex:1;min-height:0`;context.host.append(wrapper);return Array.from({length:count},()=>{const host=document.createElement('div');host.style.cssText='display:flex;min-width:0;min-height:0';wrapper.append(host);return{...context,host};});}

export const temporalEntries:OfficialEntry[]=[
  {
    id:'crychart-example-0011-customTicksScrolling',title:'滚动轴的自定义刻度 · 0011',
    description:'实时追加独立随机轨迹，X 轴刻度由应用创建和回收。主刻度每 1000 点，次刻度每 200 点，历史窗口保持有界。',
    observed:["实时追加独立随机轨迹，X 轴刻度由应用创建和回收。主刻度每 1000 点，次刻度每 200 点，历史窗口保持有界。"],
    gaps:["本库场景的功能、交互和资源占用需在目标运行环境验证。"],
    mount(context){
      const{chart}=createXY(context,'Custom X ticks with scrolling Axis'),rng=random(1100),points:Array<{x:number;y:number}>=[],series=chart.addLineSeries().setName('Series').setStrokeStyle(stroke());
      chart.getDefaultAxisX().setTitle('X Axis (custom ticks)');chart.getDefaultAxisY().setTitle('Y Axis');
      const activeTicks=new Map<number,'major'|'minor'>();let created=0,removed=0,last=0,manual=false,walk=0;
      const tickCanvas=document.createElement('canvas');tickCanvas.style.cssText='position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:3';chart.root.append(tickCanvas);
      const manageTicks=()=>{const interval=chart.getDefaultAxisX().getInterval();for(const position of [...activeTicks.keys()])if(position<interval.start||position>interval.end){activeTicks.delete(position);removed++;}for(let position=Math.max(0,Math.ceil(interval.start/200)*200);position<=interval.end;position+=200)if(!activeTicks.has(position)){activeTicks.set(position,position%1000===0?'major':'minor');created++;}};
      chart.getDefaultAxisX().setTickStrategy('numeric',(strategy:any)=>strategy.setMajorTickPlacement(()=>[...activeTicks].filter(([,kind])=>kind==='major').map(([position])=>({position,label:String(position)}))));
      const drawMinor=()=>{manageTicks();tickCanvas.width=Math.round(chart.width*chart.dpr);tickCanvas.height=Math.round(chart.height*chart.dpr);const ctx=tickCanvas.getContext('2d')!;ctx.scale(chart.dpr,chart.dpr);ctx.strokeStyle='#8a8a78';ctx.lineWidth=1;for(const[position,kind]of activeTicks){if(kind==='major')continue;const x=chart.plot.left+chart.getDefaultAxisX().valueToFraction(position)*chart.plot.width;ctx.beginPath();ctx.moveTo(x,chart.plot.top+chart.plot.height);ctx.lineTo(x,chart.plot.top+chart.plot.height+3);ctx.stroke();}};
      const token=chart.on('render',drawMinor),append=(target:number)=>{const batch=[];while(points.length<target){walk+=(rng()-.5)*1.8;const point={x:points.length,y:walk};points.push(point);batch.push(point);}if(batch.length)series.add(batch);if(!manual){chart.getDefaultAxisX().setInterval({start:Math.max(0,points.length-1)-500,end:Math.max(0,points.length-1)});const bounds=visibleExtent(points.length,index=>points[index],0,points.length-1);if(bounds)chart.getDefaultAxisY().setInterval(bounds);}manageTicks();};
      append(12);const trace:Trace={name:'Series',color:colors[0].toCSS(),points,series},reset=()=>{manual=false;append(points.length);};const dispose=[sharedCursor(chart,[trace],value=>String(Math.round(value))),xNavigation(chart,reset,()=>{manual=true;},true)];
      return{charts:[chart],traces:[trace],update:(elapsed)=>{const target=Math.floor(elapsed*60)+12;if(target!==last){last=target;append(target);}},dispose:()=>{dispose.forEach(fn=>fn());chart.off('render',token);tickCanvas.remove();},snapshot:()=>({dataProvenance:provenance,rate:60,window:500,samples:points.length,customTicks:[...activeTicks].map(([position,kind])=>({position,kind})),ticksCreated:created,ticksDisposed:removed,manual})};
    },
  },
  {
    id:'crychart-example-0012-timeTickStrategy',title:'多精度时间刻度 · 0012',
    description:'八小时的静态轨迹使用动态时间刻度。缩放后刻度逐级显示分钟、秒和小数秒，左键框选同时缩小两轴。',
    observed:["八小时的静态轨迹使用动态时间刻度。缩放后刻度逐级显示分钟、秒和小数秒，左键框选同时缩小两轴。"],
    gaps:["本库场景的功能、交互和资源占用需在目标运行环境验证。","微秒格式通过原创刻度模块实现，当前示例的数据采样间距仍为600ms。"],
    mount(context){
      const{chart}=createXY(context,'TimeTickStrategy example'),rng=random(1200),points:Array<{x:number;y:number}>=[];let noise=0;
      for(let i=0;i<=48000;i++){noise=noise*.985+(rng()-.5)*1.7;const t=i/48000;points.push({x:i*600,y:-90+55*Math.cos(t*9)+35*Math.sin(t*29)+noise-45*t});}
      const series=chart.addLineSeries().setName('Series').setStrokeStyle(stroke()).add(points),trace:Trace={name:'Series',color:colors[0].toCSS(),points,series};timeAxis(chart);
      const reset=()=>{chart.getDefaultAxisX().setInterval({start:0,end:8*3600000});const bounds=visibleExtent(points.length,i=>points[i],0,8*3600000);if(bounds)chart.getDefaultAxisY().setInterval(bounds);};reset();const dispose=[sharedCursor(chart,[trace],x=>elapsedLabel(x,3)),xNavigation(chart,reset,()=>{},true)];
      return{charts:[chart],traces:[trace],dispose:()=>dispose.forEach(fn=>fn()),snapshot:()=>({dataProvenance:provenance,samples:points.length,sampleMilliseconds:600,initialSpanMilliseconds:8*3600000,tickLabels:chart.getDefaultAxisX().ticks().map((tick:any)=>tick.label)})};
    },
  },
  {
    id:'crychart-example-0013-timeTickStrategyScrolling',title:'三通道滚动时间轴 · 0013',
    description:'三条实时轨迹使用相同时间原点。X 轴显示相对启动时刻的毫秒值，并持续移动一分钟视窗。',
    observed:["三条实时轨迹使用相同时间原点。X 轴显示相对启动时刻的毫秒值，并持续移动一分钟视窗。"],
    gaps:["本库场景的功能、交互和资源占用需在目标运行环境验证。"],
    mount(context){
      const{chart}=createXY(context,'Scrolling TimeTickStrategy example'),rng=random(1300),walks=[0,0,0],origin=Date.now();let index=0,manual=false;
      const traces:Trace[]=colors.map((color,i)=>({name:`Series ${i+1}`,color:color.toCSS(),points:[],series:chart.addLineSeries().setName(`Series ${i+1}`).setStrokeStyle(stroke(color))}));timeAxis(chart);
      const append=(target:number)=>{const batches=traces.map(()=>[] as Array<{x:number;y:number}>);while(index<target){traces.forEach((trace,i)=>{walks[i]+=(rng()-.5)*.8;const point={x:index*1000/60,y:walks[i]};trace.points.push(point);batches[i].push(point);});index++;}traces.forEach((trace,i)=>{if(batches[i].length)trace.series.add(batches[i]);});if(!manual){const latest=Math.max(0,index-1)*1000/60;chart.getDefaultAxisX().setInterval({start:latest-60000,end:latest});let low=Infinity,high=-Infinity;for(const trace of traces){const extent=visibleExtent(trace.points.length,i=>trace.points[i],latest-60000,latest);if(extent){low=Math.min(low,extent.start);high=Math.max(high,extent.end);}}chart.getDefaultAxisY().setInterval({start:low,end:high});}};
      append(20);const reset=()=>{manual=false;append(index);},dispose=[legend(context.host,traces),sharedCursor(chart,traces,x=>elapsedLabel(x,3)),xNavigation(chart,reset,()=>{manual=true;},true)];
      return{charts:[chart],traces,update:elapsed=>append(20+Math.floor(elapsed*60)),dispose:()=>dispose.forEach(fn=>fn()),snapshot:()=>({dataProvenance:provenance,originMilliseconds:origin,relativeTime:true,samplesPerChannel:index,rate:60,windowMilliseconds:60000,tickLabels:chart.getDefaultAxisX().ticks().map((tick:any)=>tick.label),manual})};
    },
  },
  {
    id:'crychart-example-0020-dateTimeAxis',title:'客户满意度日期轴 · 0020',
    description:'十年月度记录使用日期横轴，纵轴固定为0–100%。日期刻度随缩放从年份切换到月份，黄色连线与白边圆点表示每次记录。',
    observed:["十年月度记录使用日期横轴，纵轴固定为0–100%。日期刻度随缩放从年份切换到月份，黄色连线与白边圆点表示每次记录。"],
    gaps:["本库场景的功能、交互和资源占用需在目标运行环境验证。"],
    mount(context){
      const{chart}=createXY(context,'Customer Satisfaction'),rng=random(2000),points=Array.from({length:121},(_,i)=>({x:Date.UTC(2008, i,1),y:i<12?i*70/12:62+4*Math.sin(i/4.5)+2*Math.cos(i/2)+(rng()-.5)*3}));
      const series=chart.addLineSeries().setName('Satisfaction').setStrokeStyle(stroke()).add(points);chart.addPointSeries().setPointShape(PointShape.Circle).setPointSize(7).setPointFillStyle(new SolidFill({color:colors[0]})).setPointStrokeStyle(new SolidLine({fillStyle:new SolidFill({color:ColorRGBA(255,255,213)}),thickness:1})).add(points);
      const trace:Trace={name:'Satisfaction',color:colors[0].toCSS(),points,series,unit:'%'};calendarAxis(chart);chart.getDefaultAxisY().setTitle('Satisfaction (%)');const reset=()=>{chart.getDefaultAxisX().setInterval({start:Date.UTC(2008,0,1),end:Date.UTC(2018,0,1)});chart.getDefaultAxisY().setInterval({start:0,end:100});};reset();const dispose=[sharedCursor(chart,[trace],dateLabel),xNavigation(chart,reset)];
      return{charts:[chart],traces:[trace],dispose:()=>dispose.forEach(fn=>fn()),snapshot:()=>({dataProvenance:provenance,samples:points.length,firstDate:new Date(points[0].x).toISOString(),lastDate:new Date(points.at(-1)!.x).toISOString(),fixedPercentAxis:true,tickLabels:chart.getDefaultAxisX().ticks().map((tick:any)=>tick.label)})};
    },
  },
  {
    id:'crychart-example-0021-dateTimeAxisOrigin',title:'日期时间原点对照 · 0021',
    description:'上下两张渐变面积图使用完全相同的相对坐标，分别绑定1970年与今天零点的日期原点；悬停能看到相同相对值对应的不同绝对日期。',
    observed:["上下两张渐变面积图使用完全相同的相对坐标，分别绑定1970年与今天零点的日期原点；悬停能看到相同相对值对应的不同绝对日期。"],
    gaps:["本库场景的功能、交互和资源占用需在目标运行环境验证。"],
    mount(context){
      const panels=panelStack(context,2),now=new Date(),origin=Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()),origins=[0,origin],rng=random(2100);let noise=0;const points=Array.from({length:1001},(_,x)=>{noise=noise*.96+(rng()-.5)*.65;return{x,y:40*x/1000+5*Math.sin(x/57)+noise};});
      const charts:any[]=[],traces:Trace[]=[],dispose:Array<()=>void>=[];panels.forEach((panel,i)=>{const{chart}=createXY(panel,i?'Modified origin':'Default origin'),color=i?colors[1]:ColorRGBA(245,195,77);charts.push(chart);chart.setPadding({left:6,right:30,top:-18,bottom:-8});const series=chart.addAreaSeries().setName(i?'Modified origin':'Default origin').setStrokeStyle(stroke(color)).setFillStyle(new LinearGradientFill({angle:0,stops:[{offset:0,color:color.setA(15)},{offset:1,color:color.setA(195)}]})).add(points);const trace:Trace={name:i?'Modified origin':'Default origin',color:color.toCSS(),points,series};traces.push(trace);chart.getDefaultAxisY().setTitle('Value');calendarAxis(chart,origins[i]);const reset=()=>{chart.getDefaultAxisX().setInterval({start:0,end:1000});chart.getDefaultAxisY().setInterval({start:-5,end:45});};reset();dispose.push(sharedCursor(chart,[trace],x=>`${new Date(origins[i]+x).toISOString()} · offset ${x.toFixed(3)} ms`),xNavigation(chart,reset,()=>{},true));});
      return{charts,traces,dispose:()=>dispose.forEach(fn=>fn()),snapshot:()=>({dataProvenance:provenance,origins,originDates:origins.map(value=>new Date(value).toISOString()),sameRelativeData:true,samplesPerPanel:points.length,relativeSpanMilliseconds:1000,tickLabels:charts.map(chart=>chart.getDefaultAxisX().ticks().map((tick:any)=>tick.label))})};
    },
  },
  {
    id:'crychart-example-0027-visibleFitYAxis',title:'只适配可见样本的纵轴 · 0027',
    description:'流式信号使用500点视窗。每次视窗移动或缩放时，Y范围只统计当前可见样本及边界线段；历史极值不会持续撑大纵轴。',
    observed:["流式信号使用500点视窗。每次视窗移动或缩放时，Y范围只统计当前可见样本及边界线段；历史极值不会持续撑大纵轴。"],
    gaps:["本库场景的功能、交互和资源占用需在目标运行环境验证。","信号使用原创变幅波形与噪声；实际滚动恢复手势尚需专项对照。"],
    mount(context){
      const{chart}=createXY(context,'Axis Y Fitting to visible data'),rng=random(2700),points:Array<{x:number;y:number}>=[],series=chart.addLineSeries().setName('Series').setStrokeStyle(stroke());let manual=false,extent:ReturnType<typeof visibleExtent>;
      const fit=()=>{const interval=chart.getDefaultAxisX().getInterval();extent=visibleExtent(points.length,i=>points[i],interval.start,interval.end);if(extent)chart.getDefaultAxisY().setInterval(extent);};
      const append=(target:number)=>{const batch=[];while(points.length<target){const x=points.length,amplitude=5+3*Math.sin(x/170),point={x,y:amplitude*Math.sin(x/38)+2*Math.sin(x/9)+(rng()-.5)*.9+x*.006};points.push(point);batch.push(point);}if(batch.length)series.add(batch);if(!manual)chart.getDefaultAxisX().setInterval({start:points.length-1-500,end:points.length-1});fit();};
      const token=chart.getDefaultAxisX().onIntervalChange(fit);append(36);const trace:Trace={name:'Series',color:colors[0].toCSS(),points,series},reset=()=>{manual=false;append(points.length);},dispose=[sharedCursor(chart,[trace],x=>String(Math.round(x))),xNavigation(chart,reset,()=>{manual=true;fit();})];
      return{charts:[chart],traces:[trace],update:elapsed=>append(36+Math.floor(elapsed*30)),dispose:()=>{dispose.forEach(fn=>fn());chart.getDefaultAxisX().offIntervalChange(token);},snapshot:()=>({dataProvenance:provenance,samples:points.length,rate:30,window:500,visibleExtent:extent,manual,globalExtent:visibleExtent(points.length,i=>points[i],0,points.length-1)})};
    },
  },
  {
    id:'crychart-example-0048-simpleTimeSeriesChart',title:'双通道多年时间序列 · 0048',
    description:'两条独立长期趋势使用UTC日期坐标和同一结果游标。缩放从年/月切换到月/日，图例控制曲线可见性。',
    observed:["两条独立长期趋势使用UTC日期坐标和同一结果游标。缩放从年/月切换到月/日，图例控制曲线可见性。"],
    gaps:["本库场景的功能、交互和资源占用需在目标运行环境验证。"],
    mount(context){
      const{chart}=createXY(context,'Time-series chart'),start=Date.UTC(2024,0,1),span=912*millisecondsPerDay,rng=random(4800);let noises=[0,0];
      const traces:Trace[]=colors.slice(0,2).map((color,channel)=>{const points=Array.from({length:2001},(_,i)=>{const t=i/2000;noises[channel]=noises[channel]*.965+(rng()-.5)*27;const y=channel===0?1300*t+1600*Math.exp(-(((t-.58)/.17)**2))-620*Math.exp(-(((t-.19)/.13)**2))+110*Math.sin(t*80)+noises[channel]:-1500*t-950*Math.sin(t*Math.PI)+140*Math.sin(t*48)+noises[channel];return{x:start+t*span,y};});const series=chart.addLineSeries().setName(`Trend ${channel+1}`).setStrokeStyle(stroke(color)).add(points);return{name:`Trend ${channel+1}`,color:color.toCSS(),points,series};});calendarAxis(chart);const reset=()=>{chart.getDefaultAxisX().setInterval({start,end:start+span});chart.getDefaultAxisY().setInterval({start:-2500,end:2500});};reset();const dispose=[legend(context.host,traces),sharedCursor(chart,traces,dateLabel),xNavigation(chart,reset)];
      return{charts:[chart],traces,dispose:()=>dispose.forEach(fn=>fn()),snapshot:()=>({dataProvenance:provenance,samplesPerChannel:2001,firstDate:new Date(start).toISOString(),lastDate:new Date(start+span).toISOString(),tickLabels:chart.getDefaultAxisX().ticks().map((tick:any)=>tick.label),fixedYAfterZoom:true})};
    },
  },
];
