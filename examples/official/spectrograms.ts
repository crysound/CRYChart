import {ColorRGBA,LUT,PalettedFill,SolidFill,SolidLine} from '../../src/index';
import {random} from '../signals';
import {createXY} from './helpers';
import {matrixProjection,shortTimeSpectrum,spectralColumn} from './spectrogram-data';
import type {OfficialEntry,OfficialMountContext} from './types';

function thermalLUT(min=0,max=75){return new LUT({steps:[{value:min,color:ColorRGBA(0,0,0)},{value:min+(max-min)*.33,color:ColorRGBA(110,0,48)},{value:min+(max-min)*.67,color:ColorRGBA(255,0,0)},{value:max,color:ColorRGBA(255,250,175)}],interpolate:true});}
function colorScale(host:HTMLElement,min:number,max:number,vertical=false,units='dB'){
  const scale=document.createElement('div');scale.style.cssText='display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;color:#eeeecc;font:12px sans-serif;padding:5px;flex:none';
  const bar=document.createElement('div');bar.style.cssText=`border-radius:5px;background:linear-gradient(to ${vertical?'top':'right'},#000,#6e0030 33%,#ff0000 67%,#fffaaf);width:${vertical?'23px':'220px'};height:${vertical?'220px':'16px'}`;
  const labels=document.createElement('div');labels.style.cssText=`display:flex;flex-direction:${vertical?'column-reverse':'row'};justify-content:space-between;gap:8px;${vertical?'height:220px':'width:220px'}`;
  for(let i=0;i<4;i++){const text=document.createElement('span');text.textContent=(min+(max-min)*i/3).toFixed(Math.max(Math.abs(min),Math.abs(max))<=1?2:0);labels.append(text);}const unit=document.createElement('span');unit.textContent=units;if(vertical){const row=document.createElement('div');row.style.cssText='display:flex;gap:8px;align-items:center';row.append(bar,labels);scale.append(row,unit);}else scale.append(bar,labels,unit);host.append(scale);return scale;
}
function regularTicks(axis:any,step:number){axis.setTickStrategy('numeric',(strategy:any)=>strategy.setMajorTickPlacement(({interval:{start,end}}:{interval:{start:number;end:number}})=>Array.from({length:Math.max(0,Math.floor(end/step)-Math.ceil(start/step)+1)},(_,i)=>({position:(Math.ceil(start/step)+i)*step}))));}
function chartHost(context:OfficialMountContext,host:HTMLElement,title='',options?:{defaultAxisX?:{type:string}}){
  const result=createXY({...context,host},title,options);if(!title)result.caption.remove();result.chart.getCursor().setVisible(false);return result;
}
type HeatHit={column:number;row:number;x:number;y:number;value:number};
function heatCursor(chart:any,sample:(x:number,y:number)=>HeatHit|undefined,onHit?:(hit:HeatHit)=>void,units='dB'){
  const tooltip=document.createElement('div'),horizontal=document.createElement('div'),vertical=document.createElement('div'),controller=new AbortController();let hit:HeatHit|undefined,pointer:{x:number;y:number}|undefined;
  tooltip.className='shared-cursor-table';const tooltipRow=document.createElement('div');tooltipRow.className='cursor-row';tooltipRow.style.display='block';tooltip.append(tooltipRow);horizontal.style.cssText='position:absolute;pointer-events:none;border-top:1px dashed #ffffbb99;z-index:4';vertical.style.cssText='position:absolute;pointer-events:none;border-left:1px dashed #ffffbb99;z-index:4';chart.root.append(tooltip,horizontal,vertical);tooltip.hidden=horizontal.hidden=vertical.hidden=true;
  const draw=()=>{if(!pointer)return;const previous=hit,bounds=chart.overlay.getBoundingClientRect(),px=pointer.x-bounds.left,py=pointer.y-bounds.top,rect=chart.plot;hit=px<rect.left||px>rect.left+rect.width||py<rect.top||py>rect.top+rect.height?undefined:sample(chart.getDefaultAxisX().fractionToValue((px-rect.left)/rect.width),chart.getDefaultAxisY().fractionToValue(1-(py-rect.top)/rect.height));tooltip.hidden=horizontal.hidden=vertical.hidden=!hit;if(!hit)return;
    // A projection callback may invalidate this chart. Notify only on a new
    // cell/value so the render listener does not create a feedback loop.
    if(!previous||previous.column!==hit.column||previous.row!==hit.row||!Object.is(previous.value,hit.value))onHit?.(hit);
    tooltipRow.textContent=`Heatmap Grid Series · X ${hit.x.toFixed(2)} · Frequency ${hit.y.toFixed(1)} Hz · Value ${hit.value.toFixed(3)} ${units}`;tooltip.style.maxWidth='240px';tooltip.style.left=`${Math.max(2,Math.min(px+12,chart.width-tooltip.offsetWidth-5))}px`;tooltip.style.top=`${Math.max(rect.top,py-tooltip.offsetHeight-12)}px`;
    horizontal.style.left=`${rect.left}px`;horizontal.style.top=`${py}px`;horizontal.style.width=`${rect.width}px`;vertical.style.left=`${px}px`;vertical.style.top=`${rect.top}px`;vertical.style.height=`${rect.height}px`;
  };const renderToken=chart.on('render',draw);
  chart.overlay.addEventListener('pointermove',(event:PointerEvent)=>{pointer={x:event.clientX,y:event.clientY};draw();},{signal:controller.signal});chart.overlay.addEventListener('pointerleave',()=>{tooltip.hidden=horizontal.hidden=vertical.hidden=true;hit=undefined;pointer=undefined;},{signal:controller.signal});
  return{read:()=>hit,dispose:()=>{controller.abort();chart.off(renderToken);pointer=undefined;hit=undefined;tooltip.remove();horizontal.remove();vertical.remove();}};
}

export const spectrogramEntries:OfficialEntry[]=[
  {
    id:'crychart-example-0802-spectrogram',title:'双声道音频频谱 · 0802',description:'加载本地原创立体声 WAV，由浏览器解码，再对两个声道分别进行 Hann 窗短时傅里叶变换。上下图共享时间范围。',
    observed:["加载本地原创立体声 WAV，由浏览器解码，再对两个声道分别进行 Hann 窗短时傅里叶变换。上下图共享时间范围。"],
    gaps:["本库场景的功能、交互和资源占用需在目标运行环境验证。","解码和STFT的耗时另行记录，不据此宣称与原版性能相等。"],
    mount(context){
      const root=document.createElement('div');root.style.cssText='display:grid;grid-template-columns:minmax(0,1fr) 85px;flex:1;min-height:0';context.host.append(root);const panels=document.createElement('div');panels.style.cssText='display:grid;grid-template-rows:repeat(2,minmax(0,1fr));min-height:0';root.append(panels);const side=document.createElement('div');side.style.cssText='display:flex;align-items:center';root.append(side);colorScale(side,-100,-30,true);
      const charts=[0,1].map(index=>{const host=document.createElement('div');host.style.cssText='display:flex;min-height:0;min-width:0';panels.append(host);const {chart}=chartHost(context,host,index?'':'Spectrogram chart 2 channels');chart.setPadding({left:10,right:0,top:index?-44:-18,bottom:index?0:-18});chart.getDefaultAxisX().setInterval({start:0,end:13}).setTitle(index?'Duration (s)':'');chart.getDefaultAxisY().setInterval({start:0,end:12000}).setTitle(`Channel ${index+1} (Hz)`);return chart;});
      charts[0].getDefaultAxisX().setTickStrategy('empty');charts[0].setPadding({left:10,right:0,top:-18,bottom:-40});regularTicks(charts[1].getDefaultAxisX(),1);for(const chart of charts)regularTicks(chart.getDefaultAxisY(),2000);
      let syncing=false;const tokens=charts.map((chart,index)=>chart.getDefaultAxisX().onIntervalChange(()=>{if(syncing)return;syncing=true;charts[1-index].getDefaultAxisX().setInterval(chart.getDefaultAxisX().getInterval());syncing=false;}));
      const controller=new AbortController(),cursors:ReturnType<typeof heatCursor>[]=[];let disposed=false,status='loading',error='',decodedChannels=0,decodedSamples=0,elapsedMS=0,metadata:any[]=[];
      const message=document.createElement('div');message.textContent='正在解码音频并计算频谱…';message.style.cssText='position:absolute;left:90px;top:40px;color:#eeeecc;z-index:6';context.host.append(message);
      void(async()=>{const start=performance.now();try{const response=await fetch('/examples/data/crychart-stereo.wav',{signal:controller.signal});if(!response.ok)throw new Error(`WAV HTTP ${response.status}`);const decoder=new OfflineAudioContext(2,1,24000),audio=await decoder.decodeAudioData(await response.arrayBuffer());if(disposed)return;decodedChannels=audio.numberOfChannels;decodedSamples=audio.length;
        for(let channel=0;channel<2;channel++){const result=shortTimeSpectrum(audio.getChannelData(channel),audio.sampleRate),chart=charts[channel],heat=chart.addHeatmapGridSeries({dataOrder: 'rows', columns:result.columns,rows:result.rows,start:{x:0,y:0},step:{x:result.timeStep,y:result.frequencyStep}}).setName(`Channel ${channel+1}`).setFillStyle(new PalettedFill({lut:thermalLUT(-100,-30)})).invalidateIntensityValues(result.values);
          cursors.push(heatCursor(chart,(x,y)=>{const col=Math.floor(x/result.timeStep),row=Math.floor(y/result.frequencyStep);return col>=0&&col<result.columns&&row>=0&&row<result.rows?{column:col,row,x:col*result.timeStep,y:row*result.frequencyStep,value:result.values[row*result.columns+col]}:undefined;}));metadata.push({columns:result.columns,rows:result.rows,samples:heat.getSampleCount(),fftSize:result.fftSize,hop:result.hop,window:result.window,timeStep:result.timeStep,frequencyStep:result.frequencyStep});
        }elapsedMS=performance.now()-start;status='ready';message.remove();
      }catch(cause){if(disposed)return;status='failed';error=String(cause);message.textContent=`音频处理失败：${error}`;}})();
      return{charts,dispose:()=>{disposed=true;controller.abort();cursors.forEach(cursor=>cursor.dispose());charts.forEach((chart,i)=>chart.getDefaultAxisX().offIntervalChange(tokens[i]));message.remove();root.remove();},snapshot:()=>({status,error,decodedChannels,decodedSamples,sampleRate:24000,duration:13,audioFixture:'/examples/data/crychart-stereo.wav',processing:'browser decodeAudioData + original radix-two FFT',elapsedMS,channels:metadata,hover:cursors.map(cursor=>cursor.read())})};
    }
  },
  {
    id:'crychart-example-0803-scrollingHeatmap',title:'滚动频谱热力图 · 0803',description:'每个新向量包含500个频率值，按30Hz时钟追加到循环网格。横轴随时间滚动，纹理只更新本次改动的区域。',
    observed:["每个新向量包含500个频率值，按30Hz时钟追加到循环网格。横轴随时间滚动，纹理只更新本次改动的区域。"],
    gaps:["信号由独立频带模型生成，此例展示流式矩阵接口；音频FFT见0802。","当前保留固定300列，与原版延迟清理策略不同，未声称内存行为兼容。"],
    mount(context){
      const root=document.createElement('div');root.style.cssText='display:grid;grid-template-columns:minmax(0,1fr) 85px;flex:1;min-height:0';context.host.append(root);const host=document.createElement('div');host.style.cssText='display:flex;min-width:0;min-height:0';root.append(host);const side=document.createElement('div');side.style.cssText='display:flex;align-items:center';root.append(side);colorScale(side,0,75,true);const {chart}=chartHost(context,host,'Scrolling Heatmap Spectrogram',{defaultAxisX:{type:'linear-highPrecision'}}),columns=300,rows=500,rate=30,step=1000/rate,epoch=Date.UTC(2026,0,1,12),rng=random(20803);
      chart.legend.setOptions({visible:false});
      const heat=chart.addHeatmapScrollingGridSeries({columns,rows,scrollDimension:'columns',start:{x:epoch,y:0},step:{x:step,y:1}}).setName('Heatmap Grid Series').setFillStyle(new PalettedFill({lut:thermalLUT()}));let vectors=0;
      chart.getDefaultAxisY().setInterval({start:0,end:500}).setTitle('Frequency (Hz)');chart.getDefaultAxisX().setTickStrategy('numeric',(strategy:any)=>strategy.setFormattingFunction((value:number)=>new Date(value).toISOString().slice(11,23)));
      const append=()=>{heat.addIntensityValues(spectralColumn(rows,vectors/rate,rng));vectors++;};for(let i=0;i<30;i++)append();
      const follow=()=>chart.getDefaultAxisX().setInterval({start:epoch+(vectors-columns)*step,end:epoch+vectors*step});follow();
      const cursor=heatCursor(chart,(x,y)=>{const absolute=Math.floor((x-epoch)/step),row=Math.floor(y);if(absolute<Math.max(0,vectors-columns)||absolute>=vectors||row<0||row>=rows)return;return{column:absolute,row,x:(x-epoch)/1000,y:row,value:heat.data[row*columns+absolute%columns]};});
      return{charts:[chart],update:elapsed=>{const target=30+Math.floor(elapsed*rate);while(vectors<target)append();follow();},dispose:()=>{cursor.dispose();root.remove();},snapshot:()=>({columns,rows,capacity:columns*rows,vectors,samplesWritten:vectors*rows,sampleClockHz:rate,retainedVectors:Math.min(vectors,columns),scrollOffset:heat.getScrollOffset(),texture:chart.getRenderStats().heatmapStats,hover:cursor.read()})};
    }
  },
  {
    id:'crychart-example-0805-spectrogramProjection',title:'百万频谱与双向剖面 · 0805',description:'1024×1024强度矩阵，悬停时直接读取所选行和列。右侧和底部曲线各含1024个真实单元值。',
    observed:["1024×1024强度矩阵，悬停时直接读取所选行和列。右侧和底部曲线各含1024个真实单元值。"],
    gaps:["本库场景的功能、交互和资源占用需在目标运行环境验证。","样式、剖面面板比例和原版轴同步的全部手势尚未逐项对照。"],
    mount(context){
      const root=document.createElement('div');root.style.cssText='display:grid;grid-template-columns:minmax(0,1fr) 170px;grid-template-rows:80px minmax(0,1fr) 145px;flex:1;min-height:0';context.host.append(root);const header=document.createElement('div');header.style.cssText='grid-column:1 / -1;text-align:center;color:#eeeecc;font:16px sans-serif;padding-top:8px';header.textContent='2D Spectrogram with X & Y projection on mouse hover';root.append(header);colorScale(header,0,1,false,'');
      const hosts=[0,1,2].map(index=>{const host=document.createElement('div');host.style.cssText=`display:flex;min-width:0;min-height:0;border:${index?'1px solid #343933':'none'}`;if(index===2)host.style.gridColumn='1';root.append(host);return host;}),charts=hosts.map(host=>chartHost(context,host).chart),[chart,vertical,horizontal]=charts,size=1024,data=new Float32Array(size*size),rng=random(20805);
      for(let col=0;col<size;col++){const column=spectralColumn(size,col/30,rng,1);for(let row=0;row<size;row++)data[row*size+col]=column[row];}
      const heat=chart.addHeatmapGridSeries({dataOrder: 'rows', columns:size,rows:size}).setName('Heatmap Grid Series').setFillStyle(new PalettedFill({lut:thermalLUT(0,1)})).invalidateIntensityValues(data),lineStyle=new SolidLine({thickness:1.3,fillStyle:new SolidFill({color:ColorRGBA(245,245,100)})}),hLine=horizontal.addLineSeries().setName('Row projection').setStrokeStyle(lineStyle),vLine=vertical.addLineSeries().setName('Column projection').setStrokeStyle(lineStyle);
      for(const c of charts)c.setPadding({left:-12,right:0,top:-44,bottom:-8});chart.getDefaultAxisX().setInterval({start:0,end:size});chart.getDefaultAxisY().setInterval({start:0,end:size});vertical.getDefaultAxisX().setInterval({start:0,end:1});vertical.getDefaultAxisY().setInterval({start:0,end:size});horizontal.getDefaultAxisX().setInterval({start:0,end:size});horizontal.getDefaultAxisY().setInterval({start:0,end:1});
      let selection:any,revision=0;const select=(col:number,row:number)=>{const result=matrixProjection(data,size,size,col,row);hLine.clear().add(Array.from(result.horizontal,(value,index)=>({x:index+.5,y:value})));vLine.clear().add(Array.from(result.vertical,(value,index)=>({x:value,y:index+.5})));selection={column:col,row,value:result.value,horizontalValue:result.horizontal[col],verticalValue:result.vertical[row]};revision++;};select(512,512);
      const cursor=heatCursor(chart,(x,y)=>{const col=Math.floor(x),row=Math.floor(y);return col>=0&&col<size&&row>=0&&row<size?{column:col,row,x:col+.5,y:row+.5,value:data[row*size+col]}:undefined;},hit=>select(hit.column,hit.row),'');
      const tx=chart.getDefaultAxisX().onIntervalChange(()=>horizontal.getDefaultAxisX().setInterval(chart.getDefaultAxisX().getInterval())),ty=chart.getDefaultAxisY().onIntervalChange(()=>vertical.getDefaultAxisY().setInterval(chart.getDefaultAxisY().getInterval()));
      return{charts,dispose:()=>{cursor.dispose();chart.getDefaultAxisX().offIntervalChange(tx);chart.getDefaultAxisY().offIntervalChange(ty);root.remove();},snapshot:()=>({columns:size,rows:size,samples:heat.getSampleCount(),horizontalSamples:hLine.getSampleCount(),verticalSamples:vLine.getSampleCount(),selection,revision,hover:cursor.read()})};
    }
  },
  {
    id:'crychart-example-0806-sweepingHeatmapGrid',title:'循环覆盖频谱网格 · 0806',description:'固定250列横轴，按30Hz依次覆盖一个1000点频率向量，满一圈后回到第一列。悬停可读取尚未写入的零值单元。',
    observed:["固定250列横轴，按30Hz依次覆盖一个1000点频率向量，满一圈后回到第一列。悬停可读取尚未写入的零值单元。"],
    gaps:["频谱为独立模型，非原版随机数据。","本库场景的功能、交互和资源占用需在目标运行环境验证。"],
    mount(context){const {chart,caption}=createXY(context,'Sweeping Heatmap Spectrogram'),columns=250,rows=1000,rng=random(20806),heat=chart.addHeatmapGridSeries({dataOrder: 'rows', columns,rows}).setName('Heatmap Grid Series').setFillStyle(new PalettedFill({lut:thermalLUT()})).invalidateIntensityValues(new Float32Array(columns*rows));colorScale(context.host,0,75);chart.getCursor().setVisible(false);chart.getDefaultAxisX().setInterval({start:0,end:columns});chart.getDefaultAxisY().setInterval({start:0,end:rows}).setTitle('Frequency (Hz)');let vectors=0;
      const append=()=>{const col=vectors%columns,values=spectralColumn(rows,vectors/30,rng);heat.invalidateIntensityValues({iColumn:col,iRow:0,values:Array.from(values,value=>[value])});vectors++;};for(let i=0;i<25;i++)append();
      const cursor=heatCursor(chart,(x,y)=>{const col=Math.floor(x),row=Math.floor(y);return col>=0&&col<columns&&row>=0&&row<rows?{column:col,row,x:col,y:row,value:heat.data[row*columns+col]}:undefined;});
      return{charts:[chart],update:elapsed=>{const target=25+Math.floor(elapsed*30);while(vectors<target)append();caption.textContent='Sweeping Heatmap Spectrogram (30000 input values / s)';},dispose:()=>cursor.dispose(),snapshot:()=>({columns,rows,samples:heat.getSampleCount(),vectors,nextColumn:vectors%columns,sampleClockHz:30,samplesPerVector:rows,texture:chart.getRenderStats().heatmapStats,hover:cursor.read()})};
    }
  }
];
