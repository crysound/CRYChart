import {ColorRGBA,ColorHEX,SolidFill,SolidLine,PalettedFill,LUT} from '../../src/index.js';
import {random} from '../signals.js';
import {configureDates,dateLabel,day,legend,sharedCursor,xNavigation,type Trace} from './controls.js';
import {createXY} from './helpers.js';
import {confidenceEllipse,correlatedCloud,cytometryCloud,lineWalk,spatialIndex,syncAxes,resizeAnnotation,type PointColumns,type TimeAnnotation} from './xy-data.js';
import type {OfficialEntry,OfficialMountContext,OfficialMounted} from './types.js';

const colors=['#eee340','#ee7973','#d28f5b','#ac88d2','#d95aac','#617fc5','#b4d73c','#8fba76','#e9bf63','#a8e2e4'];
const stroke=(color:string,width=1.7)=>new SolidLine({thickness:width,fillStyle:new SolidFill({color:ColorHEX(color)})});
// These examples provide their own DOM legends and coordinated cursor tables.
function customPresentation(chart:any){chart.legend.setOptions({visible:false});chart.setCursorMode(undefined);return chart;}
function trace(chart:any,name:string,color:string,data:PointColumns,options:any={}):Trace{
 const series=chart.addLineSeries(options).setName(name).setStrokeStyle(stroke(color)).addArraysXY(data.x,data.y);
 return{name,color,points:[],pointCount:data.x.length,pointAt:index=>({x:data.x[index],y:data.y[index]}),series};
}
function layout(context:OfficialMountContext,title:string,rows:number,columns=1){
 const root=document.createElement('div');root.style.cssText='display:flex;flex:1;min-height:0;flex-direction:column';context.host.append(root);
 const heading=document.createElement('div');heading.textContent=title;heading.style.cssText='height:28px;flex:none;text-align:center;color:#f2f2d0;font:16px/28px sans-serif';root.append(heading);
 const grid=document.createElement('div');grid.style.cssText=`display:grid;flex:1;min-height:0;grid-template-columns:repeat(${columns},minmax(0,1fr));grid-template-rows:repeat(${rows},minmax(0,1fr));gap:2px`;root.append(grid);
 const charts=Array.from({length:rows*columns},()=>{const cell=document.createElement('div');cell.style.cssText='min-width:0;min-height:0;display:flex;border:1px solid #383a30';grid.append(cell);const c=customPresentation(createXY({...context,host:cell},'').chart);c.root.querySelector('.plot-caption')?.remove();c.root.style.minHeight='0';c.getCursor().setVisible(false);return c;});
 return{root,heading,grid,charts};
}
function indexedCursor(chart:any,data:PointColumns,label:(index:number)=>string){
 customPresentation(chart);const index=spatialIndex(data),controller=new AbortController(),table=document.createElement('div'),dot=document.createElement('div'),row=document.createElement('div');
 table.className='shared-cursor-table';row.className='cursor-row';row.style.display='block';table.append(row);dot.style.cssText='position:absolute;width:10px;height:10px;border:1px solid #fff;border-radius:50%;pointer-events:none;z-index:5;transform:translate(-50%,-50%)';chart.root.append(table,dot);table.hidden=dot.hidden=true;let hit:number|undefined;
 chart.overlay.addEventListener('pointermove',(event:PointerEvent)=>{const bounds=chart.overlay.getBoundingClientRect(),r=chart.plot,px=event.clientX-bounds.left,py=event.clientY-bounds.top,ax=chart.getDefaultAxisX(),ay=chart.getDefaultAxisY();
  const x=ax.fractionToValue((px-r.left)/r.width),y=ay.fractionToValue(1-(py-r.top)/r.height),xi=ax.getInterval(),yi=ay.getInterval();
  hit=px>=r.left&&px<=r.left+r.width&&py>=r.top&&py<=r.top+r.height?index.nearest(x,y,Math.abs(xi.end-xi.start)/r.width*10,Math.abs(yi.end-yi.start)/r.height*10):undefined;
  table.hidden=dot.hidden=hit===undefined;if(hit===undefined)return;row.textContent=label(hit);const sx=r.left+ax.valueToFraction(data.x[hit])*r.width,sy=r.top+(1-ay.valueToFraction(data.y[hit]))*r.height;dot.style.left=`${sx}px`;dot.style.top=`${sy}px`;table.style.left=`${Math.max(r.left,Math.min(sx+18,chart.width-table.offsetWidth-5))}px`;table.style.top=`${Math.max(r.top,Math.min(sy-table.offsetHeight-12,chart.height-table.offsetHeight-5))}px`;
 },{signal:controller.signal});chart.overlay.addEventListener('pointerleave',()=>{hit=undefined;table.hidden=dot.hidden=true;},{signal:controller.signal});
 return{read:()=>hit===undefined?undefined:{index:hit,x:data.x[hit],y:data.y[hit]},size:index.size,dispose:()=>{controller.abort();table.remove();dot.remove();}};
}
function durationAxis(axis:any){axis.setTickStrategy('numeric',(strategy:any)=>strategy.setFormattingFunction((v:number)=>`${v<0?'−':''}${Math.floor(Math.abs(v)/60000)}:${String(Math.floor(Math.abs(v)/1000)%60).padStart(2,'0')}`));}

export const largeLinkedXYEntries:OfficialEntry[]=[
 {
  id:'crychart-example-0007-sharedAxis',title:'共用日期轴与独立产量轴 · 0007',description:'两条样条共用日期横轴，分别使用左侧两个独立量程的纵轴。图例、两行游标和日期缩放作用于实际序列。',
  observed:["两条样条共用日期横轴，分别使用左侧两个独立量程的纵轴。图例、两行游标和日期缩放作用于实际序列。"],
  gaps:["本库场景的功能、交互和资源占用需在目标运行环境验证。","轴背景由原创覆盖层实现；轴样式公共API尚未覆盖原版全部选项。"],
  mount(context){
   const {chart}=createXY(context,'Unit production comparison'),start=Date.UTC(2022,0,5),left=chart.getDefaultAxisY(),outer=chart.addAxisY(),axes=[left,outer],names=['TechComp','UniTek'],paints=['#b69bd1','#d59161'],traces:Trace[]=[];
   customPresentation(chart);axes.forEach((axis,i)=>axis.setTitle(names[i]+' (Units/day)').setInterval(i?{start:200,end:1400}:{start:350,end:600}));
   for(let k=0;k<2;k++){const points=Array.from({length:20},(_,i)=>({x:start+i*day,y:k?650+270*Math.sin(i*.65)+110*Math.cos(i*.27):470+67*Math.sin(i*.8)+25*Math.cos(i*.27)})),series=chart.addSplineSeries({axisY:axes[k]}).setName(names[k]).setStrokeStyle(stroke(paints[k],2)).setPointSize(7).setPointFillStyle(new SolidFill({color:ColorHEX(paints[k])})).setPointStrokeStyle(stroke('#ffffff',1.5)).add(points);traces.push({name:names[k],color:paints[k],points,series});}
   configureDates(chart);chart.getDefaultAxisX().setTitle('Date');const reset=()=>chart.getDefaultAxisX().setInterval({start:start-day/2,end:start+19.5*day});reset();
   const bands=paints.map(color=>{const band=document.createElement('div');band.style.cssText=`position:absolute;background:${color}22;pointer-events:none;z-index:0`;chart.root.insertBefore(band,chart.root.firstChild);return band;}),xBand=document.createElement('div');xBand.style.cssText='position:absolute;background:#e5d95b22;pointer-events:none;z-index:0';chart.root.insertBefore(xBand,chart.root.firstChild);
   const place=()=>{bands.forEach((band,i)=>{band.style.left=`${chart.plot.left-(i+1)*54}px`;band.style.top=`${chart.plot.top}px`;band.style.width='54px';band.style.height=`${chart.plot.height}px`;});xBand.style.left=`${chart.plot.left}px`;xBand.style.top=`${chart.plot.top+chart.plot.height}px`;xBand.style.width=`${chart.plot.width}px`;xBand.style.height='48px';};const token=chart.on('render',place);
   const disposers=[legend(context.host,traces),sharedCursor(chart,traces,dateLabel),xNavigation(chart,reset)];return{charts:[chart],traces,dispose:()=>{disposers.forEach(fn=>fn());chart.off('render',token);bands.forEach(band=>band.remove());xBand.remove();},snapshot:()=>({samples:traces.map(t=>t.series.getSampleCount()),independentY:axes.map(axis=>axis.getInterval()),sharedX:traces.every(t=>t.series.getAxisX()===chart.getDefaultAxisX())})};
  }
 },
 {
  id:'crychart-example-0016-largeScatterChartXY',title:'百万散点与样本置信椭圆 · 0016',description:'实际保留100万个二维样本，用全部样本计算协方差及95%置信椭圆。空间索引支持局部悬停，索引不删除或简化数据。',
  observed:["实际保留100万个二维样本，用全部样本计算协方差及95%置信椭圆。空间索引支持局部悬停，索引不删除或简化数据。"],
  gaps:["本库场景的功能、交互和资源占用需在目标运行环境验证。"],
  mount(context){
   const {chart}=createXY(context,'Scatter chart (1.0 million points) + confidence Ellipse'),started=performance.now(),data=correlatedCloud(1000000),ellipse=confidenceEllipse(data),series=chart.addPointSeries().setName('Samples').setPointSize(1.5).setPointFillStyle(new SolidFill({color:ColorRGBA(245,201,85,190)})).addArraysXY(data.x,data.y);
   const boundary=chart.addLineSeries().setName('95% confidence ellipse').setStrokeStyle(stroke('#f2f2df',1.8)).add(ellipse.points);const reset=()=>{chart.getDefaultAxisX().setInterval({start:-2.05,end:2.05});chart.getDefaultAxisY().setInterval({start:-1.45,end:1.45});};reset();
   const cursor=indexedCursor(chart,data,index=>`Sample ${index} · X ${data.x[index].toFixed(4)} · Y ${data.y[index].toFixed(4)}`),navigate=xNavigation(chart,reset,()=>{},true),setupMs=performance.now()-started;
   return{charts:[chart],dispose:()=>{cursor.dispose();navigate();},snapshot:()=>({samples:series.getSampleCount(),indexedSamples:cursor.size,ellipse:{count:ellipse.count,mean:ellipse.mean,covariance:ellipse.covariance,probability:ellipse.probability,threshold:ellipse.threshold,points:boundary.getSampleCount()},hover:cursor.read(),setupMs,hoverTarget:{x:data.x[0],y:data.y[0]}})};
  }
 },
 {
  id:'crychart-example-0017-largeLineChartXY',title:'五百万点折线 · 0017',description:'十条独立随机游走曲线，每条真实保留500000个样本。总计500万点，缩放仅剔除不可见区间，不替换为简化曲线。',
  observed:["十条独立随机游走曲线，每条真实保留500000个样本。总计500万点，缩放仅剔除不可见区间，不替换为简化曲线。"],
  gaps:["本库场景的功能、交互和资源占用需在目标运行环境验证。"],
  mount(context){
   const {chart}=createXY(context,'Line Chart (5M points)'),traces:Trace[]=[],started=performance.now();let minimum=Infinity,maximum=-Infinity;
   customPresentation(chart);for(let channel=0;channel<10;channel++){const data=lineWalk(500000,21700+channel);for(const value of data.y){minimum=Math.min(minimum,value);maximum=Math.max(maximum,value);}traces.push(trace(chart,`Channel ${channel+1}`,colors[channel],data));}
   const reset=()=>{chart.getDefaultAxisX().setInterval({start:0,end:499999});chart.getDefaultAxisY().setInterval({start:minimum-40,end:maximum+40});};reset();const disposers=[legend(context.host,traces),sharedCursor(chart,traces,value=>Math.round(value).toLocaleString()),xNavigation(chart,reset,()=>{},true)],setupMs=performance.now()-started;
   return{charts:[chart],traces,dispose:()=>disposers.forEach(fn=>fn()),snapshot:()=>({samples:traces.reduce((sum,t)=>sum+t.series.getSampleCount(),0),channels:10,perChannel:500000,setupMs,minimum,maximum,decimation:false})};
  }
 },
 {
  id:'crychart-example-0019-flowCytometryChart',title:'流式细胞密度散点 · 0019',description:'10万个原创FSC/SSC样本。颜色来自实际邻域计数，稀疏区域蓝色、密集区域红色；悬停读取原样本与密度。',
  observed:["10万个原创FSC/SSC样本。颜色来自实际邻域计数，稀疏区域蓝色、密集区域红色；悬停读取原样本与密度。"],
  gaps:["本库场景的功能、交互和资源占用需在目标运行环境验证。"],
  mount(context){
   const {chart}=createXY(context,'Flow Cytometry'),data=cytometryCloud(),lut=new LUT({interpolate:true,steps:[{value:0,color:ColorHEX('#001bdd')},{value:data.maximum*.09,color:ColorHEX('#00cbdf')},{value:data.maximum*.28,color:ColorHEX('#00ee41')},{value:data.maximum*.58,color:ColorHEX('#fff011')},{value:data.maximum,color:ColorHEX('#f51b00')}]}),series=chart.addPointSeries({individualPointValueEnabled:true}).setName('Cells').setPointSize(1.8).setPointFillStyle(new PalettedFill({lut,lookUpProperty:'value'})).appendSamples({x:data.x,y:data.y,value:data.value});
   chart.getDefaultAxisX().setTitle('FSC-A');chart.getDefaultAxisY().setTitle('SSC-A');const reset=()=>{chart.getDefaultAxisX().setInterval({start:0,end:10e6});chart.getDefaultAxisY().setInterval({start:-.2e6,end:1.8e6});};reset();const cursor=indexedCursor(chart,data,i=>`FSC-A ${data.x[i].toFixed(0)} · SSC-A ${data.y[i].toFixed(0)} · Density ${data.value[i]}`),navigate=xNavigation(chart,reset,()=>{},true);
   return{charts:[chart],dispose:()=>{cursor.dispose();navigate();},snapshot:()=>({samples:series.getSampleCount(),maximumDensity:data.maximum,densityMethod:data.densityMethod,cellSize:data.cellSize,hover:cursor.read(),hoverTarget:{x:data.x[0],y:data.y[0]}})};
  }
 },
 {
  id:'crychart-example-0028-multiChannelLineProgressiveOwnAxes',title:'五通道独立量程实时曲线 · 0028',description:'五个通道各以1000Hz真实追加，独立Y量程、共用30秒滚动时窗。暂停保留计数，手动缩放停止跟随，Reset view恢复。',
  observed:["五个通道各以1000Hz真实追加，独立Y量程、共用30秒滚动时窗。暂停保留计数，手动缩放停止跟随，Reset view恢复。"],
  gaps:["本库场景的功能、交互和资源占用需在目标运行环境验证。","当前采用五个独立ChartXY，需继续验证其资源和高通道数性能。"],
  mount(context){
   const {root,heading,charts}=layout(context,'Multi-channel real-time monitoring (5 chs, 1000 Hz)',5),scales=[1,10,100,2,5],traces:Trace[]=[],cleanups:(()=>void)[]=[];let samples=0,following=true,frames=0,lastMeter=0;
   charts.forEach((chart,index)=>{chart.setPadding({left:12,right:-10,top:-44,bottom:index===4?-10:-38});chart.getDefaultAxisY().setInterval({start:-scales[index],end:scales[index]}).setTitle(`Ch ${index+1}`);chart.getDefaultAxisX().setInterval({start:-30000,end:0});if(index!==4)chart.getDefaultAxisX().setVisible(false);else{chart.getDefaultAxisX().setTitle('Time');durationAxis(chart.getDefaultAxisX());}const t=trace(chart,`Channel ${index+1}`,colors[index],{x:new Float64Array(0),y:new Float64Array(0)});t.series.setMaxSampleCount(60000);t.pointAt=i=>t.series.getSample(i);traces.push(t);cleanups.push(sharedCursor(chart,[t],value=>(value/1000).toFixed(3)+' s'),xNavigation(chart,()=>follow(),()=>{following=false;}));});
   const follow=()=>{following=true;charts[0].getDefaultAxisX().setInterval({start:samples-30000,end:samples+1000});};cleanups.push(syncAxes(charts.map(chart=>chart.getDefaultAxisX())),legend(root,traces));follow();
   const button=document.createElement('button');button.textContent='Reset view';button.style.cssText='position:absolute;right:12px;bottom:3px;font:11px sans-serif;z-index:8';root.style.position='relative';root.append(button);button.onclick=follow;
   return{charts,traces,update:(elapsed)=>{const target=Math.floor(elapsed*1000),count=target-samples;if(count>0){const x=Float64Array.from({length:count},(_,i)=>samples+i);traces.forEach((t,channel)=>{const y=Float64Array.from(x,value=>{const t=value/1000;return scales[channel]*(.68*Math.sin(t*(channel+1)*2.3)+.12*Math.sin(t*(channel+2)*11.7));});t.series.addArraysXY(x,y);t.pointCount=t.series.getSampleCount();});samples=target;if(following)charts[0].getDefaultAxisX().setInterval({start:samples-30000,end:samples+1000});}frames++;if(elapsed-lastMeter>=.5){heading.textContent=`Multi-channel real-time monitoring (5 chs, 1000 Hz) (FPS: ${(frames/(elapsed-lastMeter)).toFixed(1)})`;lastMeter=elapsed;frames=0;}},dispose:()=>{cleanups.forEach(fn=>fn());root.remove();},snapshot:()=>({sampleRate:1000,channels:5,samplesWrittenPerChannel:samples,retained:traces.map(t=>t.series.getSampleCount()),historyCapacity:60000,following})};
  }
 },
 {
  id:'crychart-example-0042-multiAxisLayout',title:'分区多横轴与向下时间轴 · 0042',description:'左侧两通道、右侧四通道，各自使用独立顶部横轴；共用向下递增的Time纵轴。六条真实曲线随输入滚动。',
  observed:["左侧两通道、右侧四通道，各自使用独立顶部横轴；共用向下递增的Time纵轴。六条真实曲线随输入滚动。"],
  gaps:["使用两个并排ChartXY构造分区，尚未实现单ChartXY轴长度分配公共API。","本库场景的功能、交互和资源占用需在目标运行环境验证。"],
  mount(context){
   const {root,charts}=layout(context,'Multi-axis layout',1,2),traces:Trace[]=[],axes:any[]=[],counts=[2,4];let samples=0;
   charts.forEach((chart,panel)=>{chart.getDefaultAxisX().setVisible(false);chart.setPadding({left:panel?-48:10,right:-12,top:0,bottom:-38});chart.getDefaultAxisY().setInverted(true).setInterval({start:0,end:30000});if(panel)chart.getDefaultAxisY().setVisible(false);else{chart.getDefaultAxisY().setTitle('Time');durationAxis(chart.getDefaultAxisY());}for(let i=0;i<counts[panel];i++){const channel=traces.length,axis=chart.addAxisX({opposite:true,iStack:i,iParallel:0}).setTitle(`Ch ${channel+1}`).setInterval({start:0,end:300});axes.push(axis);const t=trace(chart,`Channel ${channel+1}`,colors[channel],{x:new Float64Array(0),y:new Float64Array(0)},{axisX:axis});t.series.setMaxSampleCount(6000);traces.push(t);}});
   const unlink=syncAxes(charts.map(chart=>chart.getDefaultAxisY()));return{charts,traces,update:elapsed=>{const target=Math.floor(elapsed*100),count=target-samples;if(count>0){const time=Float64Array.from({length:count},(_,i)=>(samples+i)*10);traces.forEach((t,c)=>t.series.addArraysXY(Float64Array.from(time,v=>150+85*Math.sin(v/1000*(1+c*.3))+18*Math.sin(v/1000*7+c)),time));samples=target;charts[0].getDefaultAxisY().setInterval({start:Math.max(0,samples*10-30000),end:Math.max(30000,samples*10)});}},dispose:()=>{unlink();root.remove();},snapshot:()=>({samplesWrittenPerChannel:samples,sampleRate:100,axisGroups:counts,axisTitles:axes.map(axis=>axis.getTitle()),axisRanges:axes.map(axis=>axis.getScreenRange()),retained:traces.map(t=>t.series.getSampleCount()),timeIncreasesDownward:charts[0].getDefaultAxisY().getInverted()})};
  }
 },
 {id:'crychart-example-0045-timeSeriesAnnotations',title:'可编辑时间区间标注 · 0045',description:'在任一曲线上按住左键拖动创建区间。拖动标注两端改变时间，双击标注文字删除；过短区间自动隐藏标签。',observed:["在任一曲线上按住左键拖动创建区间。拖动标注两端改变时间，双击标注文字删除；过短区间自动隐藏标签。"],gaps:["标注数据和曲线为独立生成。","采用原创DOM标注布局，未实现全部TextSeries与Figure交互公共API。"],mount:mountAnnotations},
 {id:'crychart-example-0047-syncedCursors',title:'四图同步游标与日期缩放 · 0047',description:'四个时间图各含两条曲线。移动鼠标时，四图显示相同时间的真实取样值；缩放、框选和平移会同步日期轴。',observed:["四个时间图各含两条曲线。移动鼠标时，四图显示相同时间的真实取样值；缩放、框选和平移会同步日期轴。"],gaps:["本库场景的功能、交互和资源占用需在目标运行环境验证。","跨图游标为原创控制器，尚未扩展为完整公共Cursor联动API。"],mount:mountSyncedCursors}
];

function mountAnnotations(context:OfficialMountContext):OfficialMounted{
 const {root,grid,charts}=layout(context,'Time Series Annotations',3),start=Date.UTC(2022,0,1),end=start+day,rng=random(20045),traces:Trace[]=[],annotations:TimeAnnotation[]=[{id:1,start:start+day*.06,end:start+day*.34,text:'Event 1',color:'#edc28a',lane:0},{id:2,start:start+day*.40,end:start+day*.67,text:'Event 2',color:'#d8da77',lane:1},{id:3,start:start+day*.72,end:start+day*.9,text:'Event 3',color:'#aecca5',lane:0}];let nextId=4,lastAction='initial',drag:{chart:any;begin:number;id?:number;side?:'start'|'end';pan?:{start:number;end:number};original?:TimeAnnotation;pointerId:number;target:HTMLElement}|undefined;
 const band=document.createElement('div');band.style.cssText='height:84px;flex:none;position:relative;touch-action:none';root.insertBefore(band,grid);const controller=new AbortController(),cleanups:(()=>void)[]=[];
 charts.forEach((chart,index)=>{chart.setPadding({left:8,right:-8,top:-40,bottom:index===2?-4:-34});let y=0;const data={x:Float64Array.from({length:1441},(_,i)=>start+i*60000),y:Float64Array.from({length:1441},()=>y+=(rng()-.5)*2)};traces.push(trace(chart,String.fromCharCode(65+index),colors[index],data));chart.getDefaultAxisY().setTitle(String.fromCharCode(65+index));chart.getDefaultAxisY().fit();configureDates(chart);chart.getDefaultAxisX().setInterval({start,end});if(index!==2)chart.getDefaultAxisX().setVisible(false);chart.setUserInteractions(false);
  const overlay=chart.overlay as HTMLCanvasElement;
  overlay.addEventListener('pointerdown',(event:PointerEvent)=>{const r=overlay.getBoundingClientRect(),x=event.clientX-r.left,y=event.clientY-r.top,p=chart.plot;if(x<p.left||x>p.left+p.width||y<p.top||y>p.top+p.height)return;const begin=timeAt(chart,event.clientX);drag={chart,begin,pointerId:event.pointerId,target:overlay,...(event.button!==0?{pan:chart.getDefaultAxisX().getInterval()}:{id:nextId++})};if(!drag.pan){annotations.push({id:drag.id!,start:begin,end:begin+1,text:`Event ${drag.id}`,color:colors[(drag.id!-1)%colors.length],lane:(drag.id!-1)%2});lastAction='create';}overlay.setPointerCapture(event.pointerId);event.preventDefault();event.stopImmediatePropagation();draw();},{capture:true,signal:controller.signal});
  overlay.addEventListener('wheel',(event:WheelEvent)=>{event.preventDefault();const axis=chart.getDefaultAxisX(),interval=axis.getInterval(),anchor=timeAt(chart,event.clientX),factor=Math.exp(Math.max(-1,Math.min(1,event.deltaY*.001)));axis.setInterval({start:anchor+(interval.start-anchor)*factor,end:anchor+(interval.end-anchor)*factor});},{passive:false,signal:controller.signal});overlay.addEventListener('contextmenu',event=>event.preventDefault(),{signal:controller.signal});
 });
 function timeAt(chart:any,clientX:number){const bounds=chart.overlay.getBoundingClientRect();return chart.getDefaultAxisX().fractionToValue((clientX-bounds.left-chart.plot.left)/chart.plot.width);}
 const nodes=new Map<number,HTMLElement>();
 function draw(){const chart=charts[0],p=chart.plot,axis=chart.getDefaultAxisX(),used=new Set<number>();for(const a of annotations){used.add(a.id);let node=nodes.get(a.id);if(!node){node=document.createElement('div');node.dataset.annotation=String(a.id);node.style.cssText='position:absolute;height:30px;pointer-events:none';const line=document.createElement('div');line.style.cssText='position:absolute;top:15px;left:0;right:0;border-top:1px solid #eee8bc';node.append(line);for(const side of ['start','end'] as const){const handle=document.createElement('button');handle.dataset.side=side;handle.setAttribute('aria-label',`Event ${a.id} ${side}`);handle.style.cssText=`position:absolute;${side==='start'?'left':'right'}:-5px;top:4px;width:10px;height:23px;padding:0;border:0;background:linear-gradient(to right,transparent 4px,#f0e7c4 4px,#f0e7c4 6px,transparent 6px);cursor:ew-resize;pointer-events:auto;touch-action:none`;handle.onpointerdown=event=>{drag={chart,begin:timeAt(chart,event.clientX),id:a.id,side,original:{...a},pointerId:event.pointerId,target:handle};handle.setPointerCapture(event.pointerId);event.preventDefault();event.stopPropagation();};node.append(handle);}const text=document.createElement('button');text.dataset.annotationLabel=String(a.id);text.textContent=a.text;text.style.cssText=`position:absolute;top:3px;left:50%;transform:translateX(-50%);white-space:nowrap;border:0;border-radius:2px;padding:3px 8px;color:#1b1c17;background:${a.color};font:12px sans-serif;pointer-events:auto`;text.ondblclick=event=>{const index=annotations.findIndex(item=>item.id===a.id);if(index>=0)annotations.splice(index,1);lastAction='delete';event.stopPropagation();draw();};node.append(text);nodes.set(a.id,node);band.append(node);}const x1=p.left+axis.valueToFraction(a.start)*p.width,x2=p.left+axis.valueToFraction(a.end)*p.width;node.style.left=`${x1}px`;node.style.top=`${a.lane*37+4}px`;node.style.width=`${Math.max(0,x2-x1)}px`;node.hidden=x2<p.left||x1>p.left+p.width;const text=node.querySelector<HTMLButtonElement>('[data-annotation-label]')!;text.hidden=x2-x1<a.text.length*7+20||x1<p.left||x2>p.left+p.width;}
  for(const[id,node]of nodes)if(!used.has(id)){node.remove();nodes.delete(id);}
 }
 document.addEventListener('pointermove',(event:PointerEvent)=>{if(!drag||event.pointerId!==drag.pointerId)return;const time=timeAt(drag.chart,event.clientX);if(drag.pan){const shift=drag.begin-time,interval=drag.chart.getDefaultAxisX().getInterval(),span=interval.end-interval.start;drag.chart.getDefaultAxisX().setInterval({start:interval.start+shift,end:interval.start+shift+span});return;}const item=annotations.find(a=>a.id===drag!.id);if(!item)return;if(drag.side){resizeAnnotation(item,drag.side,time,60000);lastAction='resize';}else{item.start=Math.min(drag.begin,time);item.end=Math.max(drag.begin,time);}draw();},{signal:controller.signal});
 function endDrag(event:PointerEvent,cancelled=false){
  if(!drag||event.pointerId!==drag.pointerId)return;const active=drag;drag=undefined;
  const index=annotations.findIndex(a=>a.id===active.id);
  if(cancelled){if(active.original&&index>=0)Object.assign(annotations[index],active.original);else if(!active.side&&!active.pan&&index>=0)annotations.splice(index,1);if(active.pan)active.chart.getDefaultAxisX().setInterval(active.pan);lastAction='cancel';}
  else if(!active.side&&!active.pan&&index>=0&&annotations[index].end-annotations[index].start<60000)annotations.splice(index,1);
  if(active.target.hasPointerCapture?.(event.pointerId))active.target.releasePointerCapture(event.pointerId);draw();
 }
 document.addEventListener('pointerup',event=>endDrag(event),{signal:controller.signal});
 document.addEventListener('pointercancel',event=>endDrag(event,true),{signal:controller.signal});
 document.addEventListener('lostpointercapture',event=>endDrag(event as PointerEvent,true),{signal:controller.signal});
 const token=charts[0].on('render',draw);cleanups.push(syncAxes(charts.map(chart=>chart.getDefaultAxisX())));draw();return{charts,traces,dispose:()=>{controller.abort();cleanups.forEach(fn=>fn());charts[0].off('render',token);root.remove();},snapshot:()=>({annotations:annotations.map(a=>({...a})),visibleLabels:[...nodes.values()].filter(node=>!node.hidden&&!node.querySelector<HTMLButtonElement>('[data-annotation-label]')!.hidden).length,lastAction,samples:traces.map(t=>t.series.getSampleCount())})};
}

function mountSyncedCursors(context:OfficialMountContext):OfficialMounted{
 const {root,charts}=layout(context,'Synchronized cursors',2,2),start=Date.UTC(2022,10,2),count=1000,step=day*.07,end=start+(count-1)*step,traces:Trace[]=[],cleanups:(()=>void)[]=[];let selected:number|undefined;const controller=new AbortController(),lastValues:any[]=[];
 const layers=charts.map((chart,panel)=>{chart.setPadding({left:4,right:-6,top:-30,bottom:-5});configureDates(chart);chart.getDefaultAxisX().setInterval({start,end});const rng=random(20470+panel);for(let line=0;line<2;line++){let y=line?7:0;const data={x:Float64Array.from({length:count},(_,i)=>start+i*step),y:Float64Array.from({length:count},()=>y+=(rng()-.5)*1.1)};traces.push(trace(chart,`Line ${line}`,line?'#d2ac65':'#e4dd40',data));}chart.getDefaultAxisY().fit();const canvas=document.createElement('canvas'),table=document.createElement('div');canvas.className='shared-cursor-canvas';table.className='shared-cursor-table';table.hidden=true;chart.root.append(canvas,table);cleanups.push(xNavigation(chart,()=>chart.getDefaultAxisX().setInterval({start,end})));chart.overlay.addEventListener('pointermove',(event:PointerEvent)=>{const bounds=chart.overlay.getBoundingClientRect(),p=chart.plot,px=event.clientX-bounds.left,py=event.clientY-bounds.top;if(px<p.left||px>p.left+p.width||py<p.top||py>p.top+p.height)selected=undefined;else selected=Math.max(0,Math.min(count-1,Math.round((chart.getDefaultAxisX().fractionToValue((px-p.left)/p.width)-start)/step)));draw();},{signal:controller.signal});chart.overlay.addEventListener('pointerleave',()=>{selected=undefined;draw();},{signal:controller.signal});return{canvas,table};});
 function draw(){lastValues.length=0;charts.forEach((chart,panel)=>{const {canvas,table}=layers[panel],dpr=chart.dpr;canvas.width=Math.round(chart.width*dpr);canvas.height=Math.round(chart.height*dpr);const ctx=canvas.getContext('2d')!;ctx.scale(dpr,dpr);table.hidden=selected===undefined;if(selected===undefined)return;const x=start+selected*step,p=chart.plot,px=p.left+chart.getDefaultAxisX().valueToFraction(x)*p.width;if(px<p.left||px>p.left+p.width){table.hidden=true;return;}ctx.strokeStyle='#f1edbaaa';ctx.setLineDash([4,3]);ctx.beginPath();ctx.moveTo(px,p.top);ctx.lineTo(px,p.top+p.height);ctx.stroke();table.replaceChildren();const date=document.createElement('div');date.className='cursor-date';date.textContent=dateLabel(x);table.append(date);const ys=[];for(let line=0;line<2;line++){const trace=traces[panel*2+line],point=trace.pointAt!(selected),py=p.top+(1-chart.getDefaultAxisY().valueToFraction(point.y))*p.height;ys.push(point.y);ctx.setLineDash([]);ctx.fillStyle=trace.color;ctx.beginPath();ctx.arc(px,py,4,0,Math.PI*2);ctx.fill();const row=document.createElement('div');row.className='cursor-row';const dot=document.createElement('i');dot.style.background=trace.color;const name=document.createElement('span');name.textContent=trace.name;const value=document.createElement('strong');value.textContent=point.y.toFixed(2);row.append(dot,name,value);table.append(row);}table.style.left=`${Math.max(p.left,Math.min(px+12,chart.width-table.offsetWidth-5))}px`;table.style.top=`${p.top+8}px`;lastValues.push({panel,x,index:selected,y:ys});});}
 cleanups.push(syncAxes(charts.map(chart=>chart.getDefaultAxisX())));const tokens=charts.map(chart=>chart.on('render',draw));return{charts,traces,dispose:()=>{controller.abort();cleanups.forEach(fn=>fn());charts.forEach((chart,index)=>chart.off('render',tokens[index]));root.remove();},snapshot:()=>({selected,syncedCursor:lastValues.map(value=>({...value,y:[...value.y]})),xIntervals:charts.map(chart=>chart.getDefaultAxisX().getInterval()),samplesPerSeries:count})};
}
