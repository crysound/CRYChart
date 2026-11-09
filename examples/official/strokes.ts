import { ColorRGBA, DashedLine, SolidFill, SolidLine, StipplePatterns, emptyLine } from '../../src/index';
import { random } from '../signals';
import { configureDates, dateLabel, day, legend, sharedCursor, xNavigation, type Trace } from './controls';
import { createXY } from './helpers';
import type { OfficialEntry } from './types';

const yellow = ColorRGBA(236, 239, 77), gold = ColorRGBA(249, 202, 91), pink = ColorRGBA(232, 133, 173), orange = ColorRGBA(237, 145, 88);
const fill = (color: ReturnType<typeof ColorRGBA>) => new SolidFill({ color });
const solid = (color: ReturnType<typeof ColorRGBA>, thickness = 1.7) => new SolidLine({ fillStyle: fill(color), thickness });
const dashed = (color: ReturnType<typeof ColorRGBA>, thickness = 1.7) => new DashedLine({ fillStyle: fill(color), thickness, pattern: StipplePatterns.Dashed });
const visualGap = "本库场景的功能、交互和资源占用需在目标运行环境验证。";

/** Deterministic independent samples guided by the visible scenario, not vendor arrays. */
function wanderingTrend(count: number, anchors: Array<[number, number]>, seed: number, noise: number): number[] {
  const rng = random(seed); let walk = 0, segment = 0;
  return Array.from({ length: count }, (_, i) => {
    while (segment < anchors.length - 2 && i > anchors[segment + 1][0]) segment++;
    const [xa, ya] = anchors[segment], [xb, yb] = anchors[segment + 1], t = Math.max(0, Math.min(1, (i - xa) / (xb - xa)));
    walk = walk * .82 + (rng() - .5) * noise;
    return ya + (yb - ya) * t + walk + Math.sin(i * .13) * noise * .55;
  });
}

export const strokeEntries: OfficialEntry[] = [
  {
    id: 'crychart-example-0034-dashedProjection', title: '历史收入与预测带 · 0034',
    description: '实线显示历史收入，Today 后切换为同色虚线。半透明区间随预测跨度扩张，日期分界和虚线会跟随缩放。',
    observed: ["实线显示历史收入，Today 后切换为同色虚线。半透明区间随预测跨度扩张，日期分界和虚线会跟随缩放。"],
    gaps: ["收入与预测上下界由独立确定性模型生成，不复制原始历史或预测数据。","本库场景的功能、交互和资源占用需在目标运行环境验证。"],
    mount(context) {
      const { chart } = createXY(context, 'Historical and projected revenue'), start = Date.UTC(2020, 11, 1), count = 1010, todayIndex = 669, end = start + (count - 1) * day, today = start + todayIndex * day;
      const values = wanderingTrend(count, [[0,600000],[270,485000],[430,620000],[520,630000],[669,730000],[770,770000],[860,715000],[1009,845000]], 3400, 18000);
      const all = values.map((y, i) => ({ x: start + i * day, y })), history = all.slice(0, todayIndex + 1), projection = all.slice(todayIndex);
      const envelope = projection.map((point, i) => {const width = i === 0 ? 0 : 4000 + i / (projection.length - 1) * 102000; return { x: point.x, yLow: point.y - width, yHigh: point.y + width };});
      chart.getDefaultAxisX().addBand().setStart(today).setEnd(end).setFillStyle(fill(ColorRGBA(255,255,255,16))).setStrokeStyle(emptyLine);
      const range = chart.addAreaRangeSeries().setName('Projection interval').setFillStyle(fill(ColorRGBA(236,239,77,85))).setStrokeStyle(emptyLine).add(envelope);
      const historySeries = chart.addLineSeries().setName('Historical revenue').setStrokeStyle(solid(yellow)).add(history), projectionSeries = chart.addLineSeries().setName('Projected revenue').setStrokeStyle(dashed(yellow)).add(projection);
      chart.getDefaultAxisX().addConstantLine().setValue(today).setStrokeStyle(solid(ColorRGBA(224,227,187,100),1)).setMouseInteractions(false);
      configureDates(chart); chart.getDefaultAxisY().setTickStrategy('numeric',(strategy:any)=>strategy.setFormattingFunction((value:number)=>`${(value/1000).toFixed(0)} k€`));
      const reset = () => {chart.getDefaultAxisX().setInterval({start,end});chart.getDefaultAxisY().setInterval({start:470000,end:980000});};reset();
      const traces:Trace[]=[{name:'Historical revenue',color:yellow.toCSS(),points:history,series:historySeries,unit:'€'},{name:'Projected revenue',color:yellow.toCSS(),points:projection,series:projectionSeries,unit:'€'}];
      const label=document.createElement('div');label.textContent='Today';label.dataset.projectionBoundary='true';label.style.cssText='position:absolute;font:11px sans-serif;color:#f1f2d2;transform:translateX(-50%);pointer-events:none';chart.root.append(label);
      let placedLeft:number|undefined,placedTop:number|undefined,placedHidden:boolean|undefined;
      const place=()=>{const fraction=chart.getDefaultAxisX().valueToFraction(today),left=chart.plot.left+fraction*chart.plot.width,top=chart.plot.top+chart.plot.height+22,hidden=fraction<0||fraction>1;if(left!==placedLeft){placedLeft=left;label.style.left=`${left}px`;}if(top!==placedTop){placedTop=top;label.style.top=`${top}px`;}if(hidden!==placedHidden){placedHidden=hidden;label.hidden=hidden;}};
      const token=chart.getDefaultAxisX().onIntervalChange(place),renderToken=chart.on('render',place),resize=new ResizeObserver(place);resize.observe(chart.root);place();
      const dispose=[sharedCursor(chart,traces,dateLabel),xNavigation(chart,reset,()=>{},true)];
      return{charts:[chart],traces,dispose:()=>{dispose.forEach(fn=>fn());resize.disconnect();chart.getDefaultAxisX().offIntervalChange(token);chart.off('render',renderToken);},snapshot:()=>({today,todayISO:new Date(today).toISOString(),historySamples:history.length,projectionSamples:projection.length,joinContinuous:history.at(-1)!.x===projection[0].x&&history.at(-1)!.y===projection[0].y,intervalSamples:range.getSampleCount(),intervalWidths:[envelope[0].yHigh-envelope[0].yLow,envelope.at(-1)!.yHigh-envelope.at(-1)!.yLow],pattern:projectionSeries.getStrokeStyle().getPattern(),forecastBandSamples:envelope.length,dashProbeSamples:projection.filter((_,i)=>i%4===0),referenceValues:false})};
    },
  },
  {
    id:'crychart-example-0035-dashedSupplementaryTrends',title:'月度样条与续费趋势 · 0035',
    description:'九个月的总收入以粉色样条显示，续费收入以金色虚线样条显示；每个输入月份都保留独立圆点。',
    observed:["九个月的总收入以粉色样条显示，续费收入以金色虚线样条显示；每个输入月份都保留独立圆点。"],
    gaps:["本库场景的功能、交互和资源占用需在目标运行环境验证。"],
    mount(context){
      const{chart}=createXY(context,'Total revenue and renewal revenue'),months=Array.from({length:9},(_,i)=>Date.UTC(2022,5+i,1));
      const specs=[{name:'Total revenue',color:pink,values:[80,102,96,99,69.5,73,94,72.5,88.5],dashed:false},{name:'Renewal revenue',color:gold,values:[36.5,40.3,44.7,41.3,50.2,51.8,55,56.3,63],dashed:true}];
      const traces:Trace[]=specs.map(spec=>{const points=spec.values.map((value,i)=>({x:months[i],y:value*1000})),series=chart.addSplineSeries().setName(spec.name).setStrokeStyle(spec.dashed?dashed(spec.color):solid(spec.color)).add(points);chart.addPointSeries().setName(`${spec.name} monthly nodes`).setPointSize(7).setPointFillStyle(fill(spec.color)).add(points);return{name:spec.name,color:spec.color.toCSS(),points,series,unit:'€'};});
      configureDates(chart);chart.getDefaultAxisX().setTickStrategy('datetime',(strategy:any)=>strategy.setMajorTickPlacement(({interval:{start,end}}:{interval:{start:number;end:number}})=>(end-start>60*day?months.filter(value=>value>=start&&value<=end):Array.from({length:8},(_,i)=>start+i*(end-start)/7)).map(position=>({position}))).setFormattingFunction((value:number)=>{const d=new Date(value),interval=chart.getDefaultAxisX().getInterval();return interval.end-interval.start>60*day?`${d.getUTCMonth()+1}月`:`${d.getUTCMonth()+1}/${d.getUTCDate()}`;}));
      chart.getDefaultAxisY().setTickStrategy('numeric',(strategy:any)=>strategy.setFormattingFunction((value:number)=>`${(value/1000).toFixed(0)} k€`));
      const reset=()=>{chart.getDefaultAxisX().setInterval({start:months[0]-9*day,end:months.at(-1)!+9*day});chart.getDefaultAxisY().setInterval({start:34000,end:105000});};reset();
      const dispose=[sharedCursor(chart,traces,dateLabel),xNavigation(chart,reset)];
      return{charts:[chart],traces,dispose:()=>dispose.forEach(fn=>fn()),snapshot:()=>({months:months.map(value=>new Date(value).toISOString()),inputNodes:traces.map(trace=>trace.series.getSampleCount()),renderedSplineVertices:traces.map(trace=>trace.series.drawPacket().count),patterns:traces.map(trace=>trace.series.getStrokeStyle().getPattern?.()??[]),markerSeries:2,splineAlgorithm:'independent uniform Catmull–Rom',hoverTarget:traces[0].points[3]})};
    },
  },
  {
    id:'crychart-example-0036-dashedThresholds',title:'双机温度与阈值 · 0036',
    description:'两台机器的温度记录使用独立信号，120°C 红色虚线标出阈值；滚轮缩放时间，左拖框同时选择时间与温度。',
    observed:["两台机器的温度记录使用独立信号，120°C 红色虚线标出阈值；滚轮缩放时间，左拖框同时选择时间与温度。"],
    gaps:["本库场景的功能、交互和资源占用需在目标运行环境验证。"],
    mount(context){
      const{chart}=createXY(context,'Machine temperatures'),count=1201,rng=random(3600),times=Array.from({length:count},(_,i)=>i*50);
      const traces:Trace[]=[yellow,orange].map((color,channel)=>{let noise=0;const points=times.map((x,i)=>{noise=noise*.76+(rng()-.5)*(channel?2.2:7);const t=i/(count-1),y=channel?25+25*Math.exp(-(((t-.52)/.18)**2))+5*Math.sin(t*36)+noise:24+103*Math.exp(-(((t-.105)/.065)**2))+49*Math.exp(-(((t-.32)/.12)**2))+31*Math.sin(t*13)**2+noise;return{x,y:Math.max(20,y)};});const name=`Machine ${channel+1} temperature`,series=chart.addLineSeries().setName(name).setStrokeStyle(solid(color,1.6)).add(points);return{name,color:color.toCSS(),points,series,unit:'°C'};});
      const threshold=chart.getDefaultAxisY().addConstantLine().setValue(120).setStrokeStyle(dashed(ColorRGBA(255,0,0),3)).setMouseInteractions(false);
      chart.getDefaultAxisY().setTitle('Temperature (°C)').setTickStrategy('numeric',(strategy:any)=>strategy.setFormattingFunction((value:number)=>value.toFixed(1)));
      const time=(value:number)=>{const millis=Math.max(0,Math.round(value)),seconds=Math.floor(millis/1000);return`00:${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}${millis%1000?'.'+String(millis%1000).padStart(3,'0'):''}`;};
      chart.getDefaultAxisX().setTickStrategy('numeric',(strategy:any)=>strategy.setFormattingFunction(time));
      const reset=()=>{chart.getDefaultAxisX().setInterval({start:0,end:60000});chart.getDefaultAxisY().setInterval({start:20,end:151});};reset();
      const dispose=[legend(context.host,traces),sharedCursor(chart,traces,time),xNavigation(chart,reset,()=>{},true)];
      return{charts:[chart],traces,dispose:()=>dispose.forEach(fn=>fn()),snapshot:()=>({samples:count,spanMilliseconds:60000,threshold:threshold.getValue(),thresholdPattern:threshold.getStrokeStyle().getPattern(),exceedances:traces.map(trace=>trace.points.filter(point=>point.y>120).length),inputInterval:50,gesturePolicy:'wheel-x; left-box-xy; right-pan-xy'})};
    },
  },
];
