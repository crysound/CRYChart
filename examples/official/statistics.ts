import {ColorRGBA,LinearGradientFill,SolidFill,SolidLine} from '../../src/index';
import {histogram,random} from '../signals';
import {createXY} from './helpers';
import {legend,type Trace} from './controls';
import type {OfficialEntry} from './types';

const yellow=ColorRGBA(255,255,85),gold=ColorRGBA(255,210,102),orange=ColorRGBA(255,156,89);
const fill=(color:any)=>new SolidFill({color}),line=(color:any,thickness=1.3)=>new SolidLine({fillStyle:fill(color),thickness});
export function normalSamples(count:number,seed:number){const rng=random(seed),out=new Float64Array(count);for(let i=0;i<count;i+=2){const radius=Math.sqrt(-2*Math.log(Math.max(Number.MIN_VALUE,rng()))),angle=2*Math.PI*rng();out[i]=radius*Math.cos(angle);if(i+1<count)out[i+1]=radius*Math.sin(angle);}return out;}
/** Match the rectangles' half-open bins, with the final right endpoint included. */
export function histogramHitIndex(counts:readonly number[],x:number,y:number,visible:boolean,start:number,end:number):number|undefined{
  if(!visible||!counts.length||!Number.isFinite(x)||!Number.isFinite(y)||!Number.isFinite(start)||!Number.isFinite(end)||!(end>start)||x<start||x>end||y<0)return;
  const step=(end-start)/counts.length;let lower=0,upper=counts.length;
  // Compare actual rectangle boundaries, avoiding division rounding at an exact edge.
  while(lower+1<upper){const middle=(lower+upper)>>>1;if(x<start+middle*step)upper=middle;else lower=middle;}
  return y<=counts[lower]?lower:undefined;
}
export function normalDistribution(count=801,start=-4,end=4){
  const step=(end-start)/(count-1),pdf=Float64Array.from({length:count},(_,i)=>Math.exp(-((start+i*step)**2)/2)/Math.sqrt(2*Math.PI)),cdf=new Float64Array(count);
  for(let i=1;i<count;i++)cdf[i]=cdf[i-1]+(pdf[i-1]+pdf[i])*step/2;
  const total=cdf[count-1];for(let i=0;i<count;i++)cdf[i]/=total;
  const quantile=(probability:number)=>{let i=1;while(i<count&&cdf[i]<probability)i++;return start+(i-1+(probability-cdf[i-1])/(cdf[i]-cdf[i-1]))*step;};
  return{count,start,end,step,pdf,cdf,q1:quantile(.25),median:quantile(.5),q3:quantile(.75)};
}
function hover(chart:any,select:(x:number,y:number)=>string|undefined){const tooltip=document.createElement('div');tooltip.className='shared-cursor-table';const tooltipRow=document.createElement('div');tooltipRow.className='cursor-row';tooltipRow.style.display='block';tooltip.append(tooltipRow);tooltip.hidden=true;chart.root.append(tooltip);const controller=new AbortController();let current:string|undefined;
  chart.overlay.addEventListener('pointermove',(event:PointerEvent)=>{const box=chart.overlay.getBoundingClientRect(),px=event.clientX-box.left,py=event.clientY-box.top;current=select(chart.getDefaultAxisX().fractionToValue((px-chart.plot.left)/chart.plot.width),chart.getDefaultAxisY().fractionToValue(1-(py-chart.plot.top)/chart.plot.height));tooltip.hidden=!current;if(!current)return;tooltipRow.textContent=current;tooltip.style.left=`${Math.min(px+10,chart.width-tooltip.offsetWidth-5)}px`;tooltip.style.top=`${Math.max(30,py-tooltip.offsetHeight-10)}px`;},{signal:controller.signal});chart.overlay.addEventListener('pointerleave',()=>{tooltip.hidden=true;current=undefined;},{signal:controller.signal});return{read:()=>current,dispose:()=>{controller.abort();tooltip.remove();}};
}

export const statisticsEntries:OfficialEntry[]=[
  {
    id:'crychart-example-0600-boxPlot',title:'职业年龄箱线图 · 0600',description:'三个职业的四分位箱体、中位线、上下须和独立离群点。悬停显示各个统计量。',
    observed:["三个职业的四分位箱体、中位线、上下须和独立离群点。悬停显示各个统计量。"],
    gaps:["本库场景的功能、交互和资源占用需在目标运行环境验证。"],
    mount(context){const {chart}=createXY(context,'Age distribution across professions'),names=['Software developer','Cashier','Janitor'],summaries=[{lowerExtreme:17.5,lowerQuartile:19.5,median:21.2,upperQuartile:28.5,upperExtreme:48},{lowerExtreme:14,lowerQuartile:19.5,median:20.1,upperQuartile:26.8,upperExtreme:41.5},{lowerExtreme:15.2,lowerQuartile:18.5,median:22.7,upperQuartile:34,upperExtreme:41}];
      const boxes=chart.addBoxSeries().setName('Age distribution').setFillStyle(fill(yellow)).setStrokeStyle(line(ColorRGBA(130,130,30),1));boxes.add(summaries.map((summary,index)=>({x:index+1,width:.7,...summary})));
      const outliers=[chart.addPointSeries().setName('Software developer outlier').setPointSize(14).setPointFillStyle(fill(gold)).setPointStrokeStyle(line(ColorRGBA(255,255,230))).add([{x:1,y:50}]),chart.addPointSeries().setName('Cashier outliers').setPointSize(14).setPointFillStyle(fill(ColorRGBA(255,199,192))).setPointStrokeStyle(line(ColorRGBA(255,255,230))).add([{x:2,y:52},{x:2,y:60}])];
      chart.getDefaultAxisX().setInterval({start:.45,end:3.55}).setTitle('Profession').setTickStrategy('numeric',(strategy:any)=>strategy.setMajorTickPlacement(()=>names.map((label,i)=>({position:i+1,label}))));chart.getDefaultAxisY().setInterval({start:10,end:63}).setTitle('Age');chart.getCursor().setVisible(false);
      const cursor=hover(chart,(x,y)=>{const i=Math.round(x)-1;if(i<0||i>2||Math.abs(x-i-1)>.4||y<10||y>63)return;const s=summaries[i];return`${names[i]} · min ${s.lowerExtreme}, Q1 ${s.lowerQuartile}, median ${s.median}, Q3 ${s.upperQuartile}, max ${s.upperExtreme}`;});
      return{charts:[chart],dispose:cursor.dispose,snapshot:()=>({referenceValues:true,boxes:boxes.getSampleCount(),summaries,outlierCounts:outliers.map(series=>series.getSampleCount()),hover:cursor.read()})};
    }
  },
  {
    id:'crychart-example-0601-boxPlotAndViolin',title:'分布、小提琴与横向箱线 · 0601',description:'正态密度、数值积分累积分布和镜像小提琴形状同步逐步绘制。完成后显示由同一累积分布求得的四分位箱线。',
    observed:["正态密度、数值积分累积分布和镜像小提琴形状同步逐步绘制。完成后显示由同一累积分布求得的四分位箱线。"],
    gaps:["采用原创梯形数值积分，量化步长0.01，非原版实现。","本库场景的功能、交互和资源占用需在目标运行环境验证。"],
    mount(context){const {chart}=createXY(context,'Probability distribution + Simulated accumulation and BoxSeries'),distribution=normalDistribution(),axisCDF=chart.addAxisY().setTitle('Accumulated distribution (%)').setInterval({start:0,end:1});chart.setPadding({left:55,right:0,top:12,bottom:0});chart.getDefaultAxisX().setInterval({start:-4,end:4});chart.getDefaultAxisY().setInterval({start:0,end:1.22}).setTitle('Distribution function');
      const cdf=chart.addAreaSeries({axisY:axisCDF}).setName('Simulated Cumulative Distribution').setStrokeStyle(line(yellow)).setAreaFillStyle(new LinearGradientFill({angle:0,stops:[{offset:0,color:yellow.setA(10)},{offset:1,color:yellow.setA(165)}]})),pdf=chart.addAreaSeries().setName('Probability Distribution').setStrokeStyle(line(gold)).setAreaFillStyle(new LinearGradientFill({angle:0,stops:[{offset:0,color:gold.setA(5)},{offset:1,color:gold.setA(100)}]})),violin=chart.addAreaRangeSeries().setName('Violin').setFillStyle(fill(orange.setA(190))).setStrokeStyle(line(orange)),box=chart.addBoxSeries().setHorizontal(true).setName('Box').setFillStyle(fill(yellow)).setStrokeStyle(line(ColorRGBA(135,135,32)));
      let count=0,boxAdded=false;const update=(elapsed:number)=>{const target=Math.min(distribution.count,Math.floor(elapsed/8*(distribution.count-1))+1);if(target>count){const density=[],cumulative=[],band=[];for(let i=count;i<target;i++){const x=distribution.start+i*distribution.step,p=distribution.pdf[i];density.push({x,y:p});cumulative.push({x,y:distribution.cdf[i]});band.push({x,low:1-p*.5,high:1+p*.5});}pdf.add(density);cdf.add(cumulative);violin.add(band);count=target;}if(count===distribution.count&&!boxAdded){const iqr=distribution.q3-distribution.q1;box.add({start:.9,end:1.1,lowerExtreme:distribution.q1-1.5*iqr,lowerQuartile:distribution.q1,median:distribution.median,upperQuartile:distribution.q3,upperExtreme:distribution.q3+1.5*iqr});boxAdded=true;}};update(0);
      const traces:Trace[]=[{name:cdf.getName(),series:cdf,color:yellow.toCSS(),points:[]},{name:pdf.getName(),series:pdf,color:gold.toCSS(),points:[]},{name:'Violin',series:violin,color:orange.toCSS(),points:[]},{name:'Box',series:box,color:yellow.toCSS(),points:[]}],clearLegend=legend(chart.root,traces),cursor=hover(chart,(x)=>{if(x<distribution.start||x>distribution.end)return;const i=Math.min(count-1,Math.round((x-distribution.start)/distribution.step));if(i<0)return;return`x ${(distribution.start+i*distribution.step).toFixed(2)} · PDF ${distribution.pdf[i].toFixed(5)} · CDF ${distribution.cdf[i].toFixed(5)}`;});chart.getCursor().setVisible(false);const legendBar=chart.root.querySelector('.official-legend') as HTMLElement;legendBar.style.cssText='position:absolute;top:28px;left:155px;right:8px;z-index:3;justify-content:flex-end;background:transparent';
      return{charts:[chart],traces,update,dispose:()=>{clearLegend();cursor.dispose();},snapshot:()=>({count,target:distribution.count,boxAdded,quartiles:[distribution.q1,distribution.median,distribution.q3],normalization:distribution.cdf.at(-1),hover:cursor.read()})};
    }
  },
  {
    id:'crychart-example-1402-histogram',title:'真实样本计数直方图 · 1402',description:'由50000个确定性正态样本计算20个区间的实际计数，保留区间端点和被范围排除的样本数。',
    observed:["由50000个确定性正态样本计算20个区间的实际计数，保留区间端点和被范围排除的样本数。"],
    gaps:["本库场景的功能、交互和资源占用需在目标运行环境验证。"],
    mount(context){const {chart}=createXY(context,'Histogram chart'),samples=normalSamples(50000,21402),bins=histogram(samples,20,-4,4),counts=bins.map(bin=>bin.value),series=chart.addRectangleSeries().setName('Histogram series').setFillStyle(fill(yellow)).setStrokeStyle(line(ColorRGBA(105,105,20),1));series.add(bins.map((bin,i)=>({x1:-4+i*.4,x2:-4+(i+1)*.4,y1:0,y2:bin.value,value:bin.value,name:bin.category})));
      chart.legend.setOptions({visible:false});
      chart.getDefaultAxisX().setInterval({start:-4,end:4}).setTitle('Standardized value (z)');chart.getDefaultAxisY().setInterval({start:0,end:Math.ceil(Math.max(...bins.map(bin=>bin.value))/1000)*1000}).setTitle('Count');chart.getCursor().setVisible(false);const traces:Trace[]=[{name:series.getName(),series,color:yellow.toCSS(),points:[]}],clearLegend=legend(context.host,traces),cursor=hover(chart,(x,y)=>{const i=histogramHitIndex(counts,x,y,series.getVisible(),-4,4);if(i===undefined)return;return`[${(-4+i*.4).toFixed(1)}, ${(-4+(i+1)*.4).toFixed(1)}${i===19?']':')'} · Count ${bins[i].value}`;});
      return{charts:[chart],traces,dispose:()=>{clearLegend();cursor.dispose();},snapshot:()=>({inputSamples:samples.length,bins:bins.map(bin=>bin.value),counted:bins.reduce((sum,bin)=>sum+bin.value,0),excluded:samples.length-bins.reduce((sum,bin)=>sum+bin.value,0),rectangles:series.getSampleCount(),hover:cursor.read()})};
    }
  }
];
