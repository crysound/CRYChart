import { ColorRGBA, SolidFill, SolidLine } from '../../src/index';
import { random } from '../signals';
import { createXY } from './helpers';
import { legend, rangeHandles, sharedCursor, xNavigation, type Trace } from './controls';
import { durationTicks, elapsedLabel, formatNanosecondTimestamp, visibleExtent } from './temporal-data';
import type { OfficialEntry } from './types';

const colors=[ColorRGBA(237,240,75),ColorRGBA(230,143,86),ColorRGBA(226,132,178)];
const stroke=(index=0)=>new SolidLine({fillStyle:new SolidFill({color:colors[index]}),thickness:1.3});
const provenance={kind:'independent-synthetic',description:'Full-size independently generated typed columns; counts are derived from actual retained samples.'};
export const precisionEntries:OfficialEntry[]=[
  {
    id:'crychart-example-0024-ultraPrecisionTradingChart',title:'750万点微秒趋势 · 0024',
    description:'三个纵向面板各保留250万个样本，间隔1微秒，合计750万点。横轴联动，纵轴独立适配当前可见数据。',
    observed:["三个纵向面板各保留250万个样本，间隔1微秒，合计750万点。横轴联动，纵轴独立适配当前可见数据。"],
    gaps:["本库场景的功能、交互和资源占用需在目标运行环境验证。","完整数据由Float64列保留；GPU相对原点Float32的末端亚微秒误差仍须深缩放像素检查。","共享X游标每面板各自显示，本地跨面板游标联动仍未实现。"],
    mount(context){
      const count=2_500_000,step=.001,x=new Float64Array(count),columns:Float64Array[]=[],charts:any[]=[],traces:Trace[]=[],dispose:Array<()=>void>=[],wrapper=document.createElement('div');wrapper.style.cssText='display:grid;grid-template-rows:repeat(3,minmax(0,1fr));flex:1;min-height:0';context.host.append(wrapper);
      const begin=performance.now();for(let i=0;i<count;i++)x[i]=i*step;
      const bases=[715,1445,55.4],amplitudes=[30,60,1.4];
      for(let channel=0;channel<3;channel++){
        const y=new Float64Array(count),rng=random(2400+channel);let walk=0,target=0;
        for(let i=0;i<count;i++){if(i%1000===0)target=(rng()-.5)*amplitudes[channel]*.14;walk+=(target-walk)*.004;const t=i/(count-1),trend=channel===0?36*t:channel===1?-54*t:0;y[i]=bases[channel]+trend+amplitudes[channel]*(.18*Math.sin(t*17+channel)+.11*Math.sin(t*51))+walk+(rng()-.5)*amplitudes[channel]*.008;}
        columns.push(y);const host=document.createElement('div');host.style.cssText='display:flex;min-width:0;min-height:0';wrapper.append(host);const{chart,caption}=createXY({...context,host},channel===0?'3 stock price trends with 1 microsecond data resolution (total 7500000 values)':'');if(channel)caption.remove();chart.setPadding({left:6,right:0,top:channel?-46:-18,bottom:channel===2?-6:-34});charts.push(chart);
        const series=chart.addLineSeries().setName(`Stock ${channel+1}`).setStrokeStyle(stroke(channel)).addArraysXY(x,y),trace:Trace={name:`Stock ${channel+1}`,color:colors[channel].toCSS(),points:[],pointCount:count,pointAt:index=>({x:x[index],y:y[index]}),series};traces.push(trace);
        chart.getDefaultAxisX().setTickStrategy('time',(strategy:any)=>strategy.setMajorTickPlacement(({interval:{start,end}}:{interval:{start:number;end:number}})=>durationTicks(start,end).map(tick=>({...tick,label:channel===2?tick.label:''}))));
        dispose.push(sharedCursor(chart,[trace],value=>elapsedLabel(value,6)));
      }
      let sync=false;const extents:Array<ReturnType<typeof visibleExtent>>=[];
      const synchronize=(source:number,start:number,end:number)=>{if(sync)return;sync=true;try{charts.forEach((chart,index)=>{if(index!==source)chart.getDefaultAxisX().setInterval({start,end});const extent=visibleExtent(count,traces[index].pointAt!,start,end);extents[index]=extent;if(extent)chart.getDefaultAxisY().setInterval(extent);});}finally{sync=false;}};
      charts.forEach((chart,index)=>{const token=chart.getDefaultAxisX().onIntervalChange((_axis:any,start:number,end:number)=>synchronize(index,start,end));dispose.push(()=>chart.getDefaultAxisX().offIntervalChange(token));});
      const reset=()=>synchronize(-1,0,x[count-1]);reset();charts.forEach(chart=>dispose.push(xNavigation(chart,reset)));
      const generatedMilliseconds=performance.now()-begin;
      return{charts,traces,dispose:()=>dispose.forEach(fn=>fn()),snapshot:()=>({dataProvenance:provenance,inputCount:count*3,samplesPerChannel:traces.map(trace=>trace.series.getSampleCount()),sampleMicroseconds:1,lastMilliseconds:x[count-1],inputBytes:x.byteLength+columns.reduce((sum,column)=>sum+column.byteLength,0),generatedMilliseconds,synchronizedIntervals:charts.map(chart=>chart.getDefaultAxisX().getInterval()),visibleExtents:extents,lazyCursor:true,lastTenMicroseconds:Array.from(x.subarray(count-10)).map(value=>Math.round(value*1000))})};
    },
  },
  {
    id:'crychart-example-0046-nanosecondTimestampsChart',title:'百万点纳秒时间戳 · 0046',
    description:'保留100万个BigInt纳秒时间戳，分布在一天中的100个连续数据段。主图默认50ns范围，概览保留全天并显示极窄选区。',
    observed:["保留100万个BigInt纳秒时间戳，分布在一天中的100个连续数据段。主图默认50ns范围，概览保留全天并显示极窄选区。"],
    gaps:["本库场景的功能、交互和资源占用需在目标运行环境验证。","初始50ns窗口必须独立检查真实GPU点位与相邻标签；仅格式正确不算精度通过。"],
    mount(context){
      const total=1_000_000,blocks=100,blockSize=total/blocks,dayNs=86_400_000_000_000,epoch=BigInt(Date.UTC(2026,10,2,18))*1_000_000n,timestamps=new BigInt64Array(total),values=new Float64Array(total),rng=random(4600);
      const wrapper=document.createElement('div');wrapper.style.cssText='display:flex;flex-direction:column;flex:1;min-height:0';context.host.append(wrapper);const mainHost=document.createElement('div'),overviewHost=document.createElement('div');mainHost.style.cssText='display:flex;flex-direction:column;flex:1;min-height:0';overviewHost.style.cssText='display:flex;height:120px;flex:none';wrapper.append(mainHost,overviewHost);
      const{chart:main}=createXY({...context,host:mainHost},'Nanosecond timestamp chart'),{chart:overview}=createXY({...context,host:overviewHost},'Zoom Band Chart');overview.setPadding({left:6,right:0,top:-20,bottom:-12});overview.getDefaultAxisY().setVisible(false);overview.setUserInteractions(false);main.getDefaultAxisY().setInterval({start:0,end:1});overview.getDefaultAxisY().setInterval({start:0,end:1});
      const mainSeries:any[]=[],overviewSeries:any[]=[],blockStarts:number[]=[];
      for(let block=0;block<blocks;block++){
        const start=Math.round(block*(dayNs-blockSize)/(blocks-1)),x=new Float64Array(blockSize),y=new Float64Array(blockSize);blockStarts.push(start);
        for(let i=0;i<blockSize;i++){const index=block*blockSize+i;timestamps[index]=epoch+BigInt(start+i);x[i]=Number(timestamps[index]-epoch);values[index]=y[i]=rng();}
        mainSeries.push(main.addLineSeries().setName('Series').setStrokeStyle(stroke()).addArraysXY(x,y));overviewSeries.push(overview.addLineSeries().setName('Series').setStrokeStyle(stroke()).addArraysXY(x,y));
      }
      let visible=true;const facade={getSampleCount:()=>mainSeries.reduce((sum,series)=>sum+series.getSampleCount(),0),getVisible:()=>visible,setVisible:(next:boolean)=>{visible=next;for(const series of [...mainSeries,...overviewSeries])series.setVisible(next);},getAxisY:()=>main.getDefaultAxisY()};
      const trace:Trace={name:'Series',color:colors[0].toCSS(),points:[],pointCount:total,pointAt:index=>({x:Number(timestamps[index]-epoch),y:values[index]}),series:facade};
      const format=(value:number)=>formatNanosecondTimestamp(epoch+BigInt(Math.round(value)));
      main.getDefaultAxisX().setTickStrategy('numeric',(strategy:any)=>strategy.setMajorTickPlacement(({interval:{start,end}}:{interval:{start:number;end:number}})=>{
        const span=end-start;if(span>1_000_000_000)return durationTicks(start/1e6,end/1e6,5).map(tick=>({position:tick.position*1e6,label:format(tick.position*1e6).slice(0,8)}));
        const raw=span/4,power=10**Math.floor(Math.log10(Math.max(1,raw))),step=Math.max(1,(raw/power<=1?1:raw/power<=2?2:raw/power<=5?5:10)*power),ticks=[];
        for(let index=Math.ceil(start/step),guard=0;index*step<=end&&guard<10;index++,guard++)ticks.push({position:index*step,label:format(index*step)});return ticks;
      }));
      overview.getDefaultAxisX().setTickStrategy('numeric',(strategy:any)=>strategy.setMajorTickPlacement(()=>Array.from({length:9},(_,i)=>({position:i*dayNs/8,label:format(i*dayNs/8).slice(0,5)}))));overview.getDefaultAxisX().setInterval({start:0,end:dayNs});
      const initialStart=blockStarts[50]+3200,reset=()=>{main.getDefaultAxisX().setInterval({start:initialStart,end:initialStart+50});main.getDefaultAxisY().setInterval({start:0,end:1});};reset();
      const dispose=[legend(mainHost,[trace]),sharedCursor(main,[trace],format),xNavigation(main,reset),rangeHandles(overview,main,{start:0,end:dayNs},{minimumWidth:1,formatValue:format})];
      return{charts:[main,overview],traces:[trace],dispose:()=>dispose.forEach(fn=>fn()),snapshot:()=>{const interval=main.getDefaultAxisX().getInterval(),activeBlocks=blockStarts.map((start,index)=>({index,start,end:start+blockSize-1})).filter(block=>block.end>=interval.start&&block.start<=interval.end),probeIndex=50*blockSize+3225;return{dataProvenance:provenance,inputCount:total,retainedSamples:facade.getSampleCount(),overviewSamples:overviewSeries.reduce((sum,series)=>sum+series.getSampleCount(),0),blocks,blockSize,activeBlocks,epoch:epoch.toString(),firstTimestamp:timestamps[0].toString(),lastTimestamp:timestamps[total-1].toString(),inputBytes:timestamps.byteLength+values.byteLength,stepNanoseconds:'1',initialWindowNanoseconds:50,currentSpanNanoseconds:interval.end-interval.start,tickLabels:main.getDefaultAxisX().ticks().map((tick:any)=>tick.label),adjacentLabels:[format(Number(timestamps[probeIndex]-epoch)),format(Number(timestamps[probeIndex+1]-epoch))],probe:trace.pointAt!(probeIndex),projectedLocalX:Array.from(mainSeries[50].drawPacket().positions.subarray(3200*2,3210*2)).filter((_,i)=>i%2===0),initialStart,blockStarts};}};
    },
  },
];
