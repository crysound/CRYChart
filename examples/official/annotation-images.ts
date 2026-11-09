import {ColorRGBA,emptyFill,emptyLine,LUT,PalettedFill,SolidFill,SolidLine} from '../../src/index';
import {createXY} from './helpers';
import {rangeHandles,xNavigation,type Trace} from './controls';
import {dropCoordinate,eventSignal,imageHit,officeGrid,officeRooms,reviewDay,reviewEpoch,reviewRecords,type ImageDatum,type ImageRect} from './annotation-images-data';
import type {OfficialEntry,OfficialMountContext} from './types';

/** Original raster artwork. These assets do not reuse the reference images. */
function sprite(kind:string):HTMLCanvasElement{
  const canvas=document.createElement('canvas');canvas.width=canvas.height=64;const ctx=canvas.getContext('2d')!;
  ctx.lineJoin='round';ctx.lineCap='round';
  if(['red','green','blue'].includes(kind)){
    ctx.strokeStyle='#f6f2d7';ctx.lineWidth=5;ctx.beginPath();ctx.moveTo(12,58);ctx.lineTo(12,7);ctx.stroke();ctx.fillStyle={red:'#f45758',green:'#53d58c',blue:'#5498fa'}[kind]!;
    ctx.beginPath();ctx.moveTo(15,8);ctx.lineTo(55,8);ctx.lineTo(44,23);ctx.lineTo(55,37);ctx.lineTo(15,37);ctx.closePath();ctx.fill();ctx.strokeStyle='#172b34';ctx.lineWidth=2;ctx.stroke();
  }else if(kind==='router'){
    ctx.strokeStyle='#dce8eb';ctx.lineWidth=5;for(const x of[16,48]){ctx.beginPath();ctx.moveTo(x,37);ctx.lineTo(x,18);ctx.stroke();}
    ctx.fillStyle='#52656d';ctx.fillRect(7,37,50,18);ctx.strokeStyle='#e2edf0';ctx.lineWidth=2;ctx.strokeRect(7,37,50,18);ctx.fillStyle='#76edb0';for(const x of[16,25,34]){ctx.beginPath();ctx.arc(x,46,2,0,Math.PI*2);ctx.fill();}
    ctx.strokeStyle='#5edfa7';ctx.lineWidth=3;for(const radius of[9,16]){ctx.beginPath();ctx.arc(32,23,radius,Math.PI*1.17,Math.PI*1.83);ctx.stroke();}
  }else if(kind==='event'){
    ctx.fillStyle='#ffcd58';ctx.strokeStyle='#6c4613';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(32,5);ctx.lineTo(60,55);ctx.lineTo(4,55);ctx.closePath();ctx.fill();ctx.stroke();ctx.strokeStyle='#392612';ctx.lineWidth=6;ctx.beginPath();ctx.moveTo(32,22);ctx.lineTo(32,36);ctx.stroke();ctx.beginPath();ctx.arc(32,46,3,0,Math.PI*2);ctx.fillStyle='#392612';ctx.fill();
  }else{
    ctx.fillStyle={unhappy:'#ff626b',neutral:'#ffcf60',happy:'#a3e0c0'}[kind]??'#a3e0c0';ctx.beginPath();ctx.arc(32,32,29,0,Math.PI*2);ctx.fill();ctx.fillStyle='#24413b';for(const x of[22,42]){ctx.beginPath();ctx.arc(x,25,3,0,Math.PI*2);ctx.fill();}
    ctx.strokeStyle='#24413b';ctx.lineWidth=4;ctx.beginPath();if(kind==='neutral'){ctx.moveTo(22,43);ctx.lineTo(42,43);}else if(kind==='unhappy')ctx.arc(32,49,12,Math.PI*1.15,Math.PI*1.85);else ctx.arc(32,34,13,.15*Math.PI,.85*Math.PI);ctx.stroke();
  }
  return canvas;
}
function floorPlan():HTMLCanvasElement{
  const image=document.createElement('canvas');image.width=1000;image.height=750;const c=image.getContext('2d')!;
  c.scale(10,10);c.font='2px sans-serif';c.textAlign='center';c.textBaseline='middle';
  for(const room of officeRooms){const y=75-room.y-room.height;c.fillStyle='#e2e0d8';c.fillRect(room.x,y,room.width,room.height);c.strokeStyle='#606b6b';c.lineWidth=.6;c.strokeRect(room.x,y,room.width,room.height);c.fillStyle='#536161';c.fillText(room.name,room.x+room.width/2,y+3);}
  c.fillStyle='#b0b9b6';c.beginPath();c.ellipse(22.5,19,11,6,0,0,Math.PI*2);c.fill();
  for(const x of[14,22,30])for(const y of[10,27]){c.fillStyle='#869897';c.fillRect(x-2,y-1,4,3);}
  for(const x of[48,62,76])for(const y of[21,34,47]){c.fillStyle='#aebbb7';c.fillRect(x,y,10,5);c.fillStyle='#7f9390';c.beginPath();c.arc(x+5,y+7,2,0,Math.PI*2);c.fill();}
  c.strokeStyle='#8d9996';c.lineWidth=.3;for(const y of[48,61]){c.beginPath();c.moveTo(5,y);c.lineTo(40,y);c.stroke();}
  for(const[index,label]of['No measurement','Weak','Medium','Good'].entries()){const x=5+index*23;c.fillStyle=['#7b8584','#e67746','#f6d452','#4ac7a0'][index];c.fillRect(x,72,2,2);c.fillStyle='#dce6e1';c.textAlign='left';c.font='1.6px sans-serif';c.fillText(label,x+3,73);}
  return image;
}
function imageSeries(chart:any,name:string,points:readonly ImageDatum[],axisY?:any):any{
  return chart.addPointSeries({axisY}).setName(name).setPointSize(0).setPointFillStyle(emptyFill).setPointStrokeStyle(emptyLine).add(points.map(p=>({x:p.x,y:p.y})));
}
interface MarkerGroup{series:any;records:ImageDatum[];size:number;anchor?:{x:number;y:number}}
interface LayerOptions{background?:HTMLCanvasElement;onMove?:(datum:ImageDatum,point:{x:number;y:number})=>void;describe?:(datum:ImageDatum)=>string[]}

/** The example layer uses the chart's own composited canvases, never a floating DOM image. */
function imageLayer(chart:any,groups:MarkerGroup[],options:LayerOptions={}){
  const sprites=new Map<string,HTMLCanvasElement>(),controller=new AbortController();let rectangles:Array<{datum:ImageDatum;bounds:ImageRect;clip:ImageRect}>=[],pointer:{x:number;y:number}|undefined,hit:ImageDatum|undefined,drag:{datum:ImageDatum;dx:number;dy:number}|undefined,disposed=false,frames=0;
  const bitmap=(kind:string)=>{let image=sprites.get(kind);if(!image){image=sprite(kind);sprites.set(kind,image);}return image;};
  const project=(datum:ImageDatum,series:any)=>chart.translatePoint({x:datum.x,y:datum.y},{x:series.getAxisX(),y:series.getAxisY()},chart.coordsPixel);
  const local=(event:MouseEvent)=>{const box=chart.overlay.getBoundingClientRect();return{x:event.clientX-box.left,y:event.clientY-box.top};};
  const draw=()=>{
    if(disposed)return;frames++;rectangles=[];
    if(options.background){const ctx=chart.underlay.getContext('2d')!,p=chart.plot,x=chart.getDefaultAxisX(),y=chart.getDefaultAxisY(),left=p.left+x.valueToFraction(0)*p.width,right=p.left+x.valueToFraction(100)*p.width,top=p.top+(1-y.valueToFraction(75))*p.height,bottom=p.top+(1-y.valueToFraction(0))*p.height;
      ctx.save();ctx.setTransform(chart.dpr,0,0,chart.dpr,0,0);ctx.beginPath();ctx.rect(p.left,p.top,p.width,p.height);ctx.clip();ctx.drawImage(options.background,left,top,right-left,bottom-top);ctx.restore();
    }
    const ctx=chart.overlay.getContext('2d')!;ctx.save();ctx.setTransform(chart.dpr,0,0,chart.dpr,0,0);
    for(const group of groups){if(!group.series.getVisible())continue;const clip=chart.getSeriesScreenRect(group.series);ctx.save();ctx.beginPath();ctx.rect(clip.left,clip.top,clip.width,clip.height);ctx.clip();
      for(const datum of group.records){const pixel=project(datum,group.series),anchor=group.anchor??{x:.5,y:.5},bounds={left:pixel.x-group.size*anchor.x,top:pixel.y-group.size*anchor.y,width:group.size,height:group.size};
        if(bounds.left+bounds.width<clip.left||bounds.left>clip.left+clip.width||bounds.top+bounds.height<clip.top||bounds.top>clip.top+clip.height)continue;
        ctx.drawImage(bitmap(datum.kind),bounds.left,bounds.top,bounds.width,bounds.height);rectangles.push({datum,bounds,clip:{...clip}});
      }ctx.restore();
    }
    const clientBounds=chart.overlay.getBoundingClientRect(),pixel=pointer?{x:pointer.x-clientBounds.left,y:pointer.y-clientBounds.top}:undefined;
    hit=pixel?imageHit(pixel,rectangles):undefined;
    if(hit){const marker=rectangles.find(r=>r.datum===hit)!;ctx.strokeStyle='#ffffff';ctx.lineWidth=1.5;ctx.strokeRect(marker.bounds.left-1,marker.bounds.top-1,marker.bounds.width+2,marker.bounds.height+2);
      const lines=options.describe?.(hit)??[hit.label??hit.kind,`X ${hit.x.toFixed(2)}`,`Y ${hit.y.toFixed(2)}`];ctx.font='12px sans-serif';const width=Math.max(...lines.map(line=>ctx.measureText(line).width))+16,height=lines.length*18+10,x=Math.max(2,Math.min(pixel!.x+15,chart.width-width-2)),y=Math.max(2,pixel!.y-height-10);ctx.fillStyle='#102b32f5';ctx.fillRect(x,y,width,height);ctx.strokeStyle='#b4d0c3';ctx.strokeRect(x,y,width,height);ctx.fillStyle='#f3f8e7';ctx.textBaseline='top';lines.forEach((line,index)=>ctx.fillText(line,x+8,y+5+index*18));
    }ctx.restore();
  };
  const token=chart.on('render',draw),eventOptions={signal:controller.signal,capture:true};
  chart.overlay.addEventListener('pointermove',(event:PointerEvent)=>{pointer={x:event.clientX,y:event.clientY};if(drag&&options.onMove){const group=groups.find(group=>group.records.includes(drag!.datum));if(group){const localPixel=local(event),pixel={x:localPixel.x+drag.dx,y:localPixel.y+drag.dy},p=chart.translatePoint(pixel,chart.coordsPixel,{x:group.series.getAxisX(),y:group.series.getAxisY()}),rect=chart.getSeriesScreenRect(group.series);if(dropCoordinate(pixel,rect,group.series.getAxisX().getInterval(),group.series.getAxisY().getInterval()))options.onMove(drag.datum,p);}event.stopImmediatePropagation();}chart.invalidate();},eventOptions);
  chart.overlay.addEventListener('pointerleave',()=>{if(!drag){pointer=undefined;hit=undefined;chart.invalidate();}},{signal:controller.signal});
  chart.overlay.addEventListener('pointerdown',(event:PointerEvent)=>{if(!options.onMove||event.button!==0)return;const p=local(event),target=imageHit(p,rectangles),group=target&&groups.find(group=>group.records.includes(target));if(!target||!group)return;const anchor=project(target,group.series);drag={datum:target,dx:anchor.x-p.x,dy:anchor.y-p.y};pointer={x:event.clientX,y:event.clientY};chart.overlay.setPointerCapture(event.pointerId);event.preventDefault();event.stopImmediatePropagation();},eventOptions);
  const cancel=(event:PointerEvent)=>{if(!drag)return;drag=undefined;if(chart.overlay.hasPointerCapture(event.pointerId))chart.overlay.releasePointerCapture(event.pointerId);event.stopImmediatePropagation();chart.invalidate();};
  for(const name of['pointerup','pointercancel','lostpointercapture'])chart.overlay.addEventListener(name,cancel,eventOptions);
  chart.invalidate();
  return{snapshot:()=>({disposed,frames,images:sprites.size+(options.background?1:0),rendered:rectangles.map(({datum,bounds,clip})=>({id:datum.id,kind:datum.kind,x:datum.x,y:datum.y,bounds:{...bounds},clip:{...clip}})),hover:hit?{...hit}:undefined}),dispose:()=>{if(disposed)return;disposed=true;controller.abort();chart.off(token);sprites.forEach(image=>{image.width=image.height=0;});sprites.clear();if(options.background)options.background.width=options.background.height=0;options.background=undefined;rectangles=[];pointer=undefined;hit=undefined;drag=undefined;}};
}
function timeAxis(axis:any){axis.setTickStrategy('numeric',(ticks:any)=>ticks.setFormattingFunction((value:number)=>`${(value/1000).toFixed(1)} s`)).setTitle('Time');}
const colors=['#f1e957','#ffc55a','#ef9851'];
function line(chart:any,points:{x:number;y:number}[],index=0,axisY?:any):Trace{
  const color=colors[index%colors.length],rgb=index===0?ColorRGBA(241,233,87):index===1?ColorRGBA(255,197,90):ColorRGBA(239,152,81),series=chart.addLineSeries({axisY}).setName(`Channel ${index+1}`).setStrokeStyle(new SolidLine({thickness:1.5,fillStyle:new SolidFill({color:rgb})})).setMaxSampleCount(3000).add(points);return{name:`Channel ${index+1}`,color,points,series};
}
function imageLegend(host:HTMLElement,groups:MarkerGroup[]){
  const bar=document.createElement('div');bar.className='official-legend';const icons:HTMLCanvasElement[]=[];
  groups.forEach(group=>{const button=document.createElement('button'),icon=sprite(group.records[0]?.kind??'happy');icons.push(icon);icon.style.cssText='width:24px;height:24px';button.append(icon,document.createTextNode(group.series.getName()));button.setAttribute('aria-pressed','true');button.onclick=()=>{const visible=!group.series.getVisible();group.series.setVisible(visible);button.setAttribute('aria-pressed',String(visible));};bar.append(button);});host.append(bar);
  return()=>{icons.forEach(icon=>{icon.width=icon.height=0;});bar.remove();};
}

export const annotationImageEntries:OfficialEntry[]=[
  {id:'crychart-example-0025-officeDataVisualizationLayer',title:'办公室布局与 Wi‑Fi 测量 · 0025',description:'原创平面图作为数据底图，6300 个网格单元分为无测量、弱、中、强四类；路由器图片绑定真实轴坐标。',
    observed:["原创平面图作为数据底图，6300 个网格单元分为无测量、弱、中、强四类；路由器图片绑定真实轴坐标。"],gaps:["本库场景的功能、交互和资源占用需在目标运行环境验证。","采用图表自身画布的示例图片层；不宣称通用 ImageFill API 兼容。"],
    mount(context){const{chart,caption}=createXY(context,'Office layout data visualization layer');caption.remove();chart.setTitle('Office layout data visualization layer');chart.legend.setOptions({visible:false});chart.getCursor().setVisible(false);chart.setUserInteractions(false);chart.getDefaultAxisX().setInterval({start:0,end:100}).setTickStrategy('empty');chart.getDefaultAxisY().setInterval({start:0,end:75}).setTickStrategy('empty');
      const values=officeGrid(),heat=chart.addHeatmapGridSeries({dataOrder: 'rows', columns:90,rows:70,start:{x:0,y:0},step:{x:100/90,y:75/70}}).setName('Wi-Fi strength').setFillStyle(new PalettedFill({lut:new LUT({interpolate:false,steps:[{value:0,color:ColorRGBA(0,0,0,0)},{value:1,color:ColorRGBA(230,119,70,90)},{value:2,color:ColorRGBA(246,212,82,90)},{value:3,color:ColorRGBA(74,199,160,90)}]})})).invalidateIntensityValues(values);
      const records:ImageDatum[]=[{id:0,x:61,y:14,kind:'router',label:'Wi-Fi router'}],series=imageSeries(chart,'Router',records),layer=imageLayer(chart,[{series,records,size:48}],{background:floorPlan(),describe:datum=>[datum.label!,`Location ${datum.x}, ${datum.y}`]});
      return{charts:[chart],traces:[{name:'Router',color:'#76edb0',points:records,series}],dispose:()=>layer.dispose(),snapshot:()=>({family:'annotation-images',kind:'office',source:'original categorized distance model',categories:[0,1,2,3].map(value=>({value,count:values.reduce((n,item)=>n+(item===value?1:0),0)})),columns:90,rows:70,samples:heat.getSampleCount(),imageLayer:layer.snapshot(),rawData:Array.from(values)})};}
  },
  {id:'crychart-example-0054-scatterImageFill',title:'实时事件图片与概览 · 0054',description:'在真实采样值向上越过 70 时添加图片事件。主图与概览共享原始数据，图片受轴区裁切并随时间移动。',
    observed:["在真实采样值向上越过 70 时添加图片事件。主图与概览共享原始数据，图片受轴区裁切并随时间移动。"],gaps:["本库场景的功能、交互和资源占用需在目标运行环境验证。","采用原生图表画布上的示例图片层，不宣称散点 ImageFill API 兼容。"],
    mount(context){const layout=document.createElement('div');layout.style.cssText='display:grid;grid-template-rows:minmax(0,1fr) 180px;flex:1;min-height:0';context.host.append(layout);const hosts=[0,1].map(()=>{const h=document.createElement('div');h.style.cssText='display:flex;min-height:0';layout.append(h);return h;}),chart=createXY({...context,host:hosts[0]},'Custom image events').chart,overview=createXY({...context,host:hosts[1]},'Zoom Band Chart').chart,points=Array.from({length:1500},(_,i)=>({x:i*20,y:eventSignal(i)})),mainTrace=line(chart,points),overviewTrace=line(overview,points),records:ImageDatum[]=[];
      for(let i=1;i<points.length;i++)if(points[i-1].y<70&&points[i].y>=70)records.push({id:i,x:points[i].x,y:points[i].y,kind:'event',label:'Upward crossing of 70'});
      const markers=[chart,overview].map(c=>imageSeries(c,'Threshold events',records)),layers=[imageLayer(chart,[{series:markers[0],records,size:28}]),imageLayer(overview,[{series:markers[1],records,size:12}])];let next=points.length,following=true,setting=false;
      for(const c of[chart,overview]){c.legend.setOptions({visible:false});c.getCursor().setVisible(false);c.getDefaultAxisY().setInterval({start:0,end:100});timeAxis(c.getDefaultAxisX());}overview.setUserInteractions(false);chart.getDefaultAxisY().addConstantLine().setValue(70).setStrokeStyle(new SolidLine({thickness:1,fillStyle:new SolidFill({color:ColorRGBA(180,190,180,160)})}));
      const bounds={start:0,end:points.at(-1)!.x},follow=()=>{setting=true;chart.getDefaultAxisX().setInterval({start:bounds.end-15000,end:bounds.end});setting=false;};overview.getDefaultAxisX().setInterval(bounds);follow();
      const manual=chart.getDefaultAxisX().onIntervalChange(()=>{if(!setting)following=false;}),controls=[rangeHandles(overview,chart,bounds,{minimumWidth:200,formatValue:v=>`${(v/1000).toFixed(2)} s`}),xNavigation(chart,()=>{following=true;follow();},()=>{following=false;})];
      const refreshMarkers=()=>markers.forEach(series=>series.clear().add(records.map(({x,y})=>({x,y}))));
      return{charts:[chart,overview],traces:[mainTrace],update:elapsed=>{const target=1500+Math.floor(elapsed*50);if(target<=next)return;const batch=[];let changed=false;for(;next<target;next++){const p={x:next*20,y:eventSignal(next)},previous=points.at(-1)!;batch.push(p);points.push(p);if(previous.y<70&&p.y>=70){records.push({id:next,x:p.x,y:p.y,kind:'event',label:'Upward crossing of 70'});changed=true;}}if(points.length>3000)points.splice(0,points.length-3000);while(records.length&&records[0].x<points[0].x){records.shift();changed=true;}mainTrace.series.add(batch);overviewTrace.series.add(batch);if(changed)refreshMarkers();bounds.start=points[0].x;bounds.end=points.at(-1)!.x;overview.getDefaultAxisX().setInterval(bounds);if(following)follow();},dispose:()=>{controls.forEach(fn=>fn());chart.getDefaultAxisX().offIntervalChange(manual);layers.forEach(layer=>layer.dispose());layout.remove();},snapshot:()=>({family:'annotation-images',kind:'events',sampleRate:50,nextSample:next,retained:points.length,following,threshold:70,events:records.map(record=>({...record})),imageLayers:layers.map(layer=>layer.snapshot())})};}
  },
  {id:'crychart-example-0055-scatterIcons',title:'拖放图片旗标 · 0055',description:'从三色图标拖放到任一波形分区，再拖动已有旗标。每个旗标保存源时间与分区坐标，随轴滚动、缩放和导出。',
    observed:["从三色图标拖放到任一波形分区，再拖动已有旗标。每个旗标保存源时间与分区坐标，随轴滚动、缩放和导出。"],gaps:["波形和旗标位图均为原创。","实际使用图表画布图片层与原始坐标集合，不宣称自定义 point-shape API 全面兼容。"],
    mount(context){const{chart,caption}=createXY(context,'Drag colored annotations from the palette');caption.remove();chart.setTitle('Drag colored annotations from the palette').setTitleMargin({left:50});chart.legend.setOptions({visible:false});chart.getCursor().setVisible(false);const axes=[chart.getDefaultAxisY(),chart.addAxisY({iStack:1}),chart.addAxisY({iStack:2})],traces:Trace[]=[],groups:MarkerGroup[]=[];
      for(let channel=0;channel<3;channel++){const points=Array.from({length:750},(_,i)=>({x:i*20,y:.5+.35*Math.sin(i*.071+channel)+.1*Math.sin(i*.23+channel*2)}));axes[channel].setInterval({start:0,end:1});traces.push(line(chart,points,channel,axes[channel]));groups.push({series:imageSeries(chart,`Flags ${channel+1}`,[],axes[channel]),records:[],size:32,anchor:{x:.18,y:.92}});}
      timeAxis(chart.getDefaultAxisX());let next=750,nextFlag=1,following=true,setting=false;
      const follow=()=>{setting=true;chart.getDefaultAxisX().setInterval({start:next*20-15000,end:next*20});setting=false;};follow();
      const token=chart.getDefaultAxisX().onIntervalChange(()=>{if(!setting)following=false;});
      const updateGroup=(group:MarkerGroup)=>group.series.clear().add(group.records.map(({x,y})=>({x,y})));
      const layer=imageLayer(chart,groups,{onMove:(datum,p)=>{datum.x=p.x;datum.y=p.y;updateGroup(groups[datum.channel!]);},describe:datum=>[`Flag ${datum.id} · ${datum.kind}`,`Time ${(datum.x/1000).toFixed(3)} s`,`Channel ${datum.channel!+1} · ${datum.y.toFixed(3)}`]});
      // Image dragging claims a hit before the generic box-selection listener.
      // Empty plot space still reaches the normal navigation controls.
      const stopNavigation=xNavigation(chart,()=>{following=true;follow();},()=>{following=false;});
      const palette=document.createElement('div');palette.className='annotation-palette';palette.style.cssText='position:absolute;left:14px;top:8px;z-index:6;display:flex;gap:5px';chart.root.append(palette);const controller=new AbortController(),icons:HTMLCanvasElement[]=[];
      for(const kind of['red','green','blue']){const button=document.createElement('button');button.dataset.kind=kind;button.title=`Drag ${kind} flag`;button.draggable=true;button.style.cssText='border:1px solid #819d92;border-radius:4px;background:#15302e;padding:1px;cursor:grab';const icon=sprite(kind);icons.push(icon);icon.style.cssText='width:22px;height:22px;pointer-events:none';button.append(icon);button.addEventListener('dragstart',event=>{event.dataTransfer!.setData('text/plain',`cry-flag:${kind}`);event.dataTransfer!.effectAllowed='copy';},{signal:controller.signal});palette.append(button);}
      chart.overlay.addEventListener('dragover',(event:DragEvent)=>{if(event.dataTransfer?.types.includes('text/plain')){event.preventDefault();event.dataTransfer.dropEffect='copy';}},{signal:controller.signal});
      chart.overlay.addEventListener('drop',(event:DragEvent)=>{const kind=event.dataTransfer?.getData('text/plain').replace(/^cry-flag:/,'');if(!kind||!['red','green','blue'].includes(kind))return;const box=chart.overlay.getBoundingClientRect(),pixel={x:event.clientX-box.left,y:event.clientY-box.top};for(let channel=0;channel<3;channel++){const group=groups[channel],point=dropCoordinate(pixel,chart.getSeriesScreenRect(group.series),chart.getDefaultAxisX().getInterval(),axes[channel].getInterval());if(!point)continue;group.records.push({id:nextFlag++,...point,kind,channel,label:`${kind} flag`});updateGroup(group);break;}event.preventDefault();},{signal:controller.signal});
      return{charts:[chart],traces,update:elapsed=>{const target=750+Math.floor(elapsed*50);if(target<=next)return;for(let channel=0;channel<3;channel++){const trace=traces[channel],batch=Array.from({length:target-next},(_,offset)=>{const index=next+offset;return{x:index*20,y:.5+.35*Math.sin(index*.071+channel)+.1*Math.sin(index*.23+channel*2)};});trace.points.push(...batch);if(trace.points.length>3000)trace.points.splice(0,trace.points.length-3000);trace.series.add(batch);}next=target;if(following)follow();},dispose:()=>{controller.abort();stopNavigation();chart.getDefaultAxisX().offIntervalChange(token);layer.dispose();icons.forEach(icon=>{icon.width=icon.height=0;});palette.remove();},snapshot:()=>({family:'annotation-images',kind:'annotations',nextSample:next,sampleRate:50,following,flags:groups.flatMap(group=>group.records.map(record=>({...record}))),imageLayer:layer.snapshot()})};}
  },
  {id:'crychart-example-0056-scatterImageFill2',title:'图片散点评论分析 · 0056',description:'360 条原创评论按时间与日期排列，以三种原创表情位图区分评价。隐藏某一类别后，其图片与命中同时消失。',
    observed:["360 条原创评论按时间与日期排列，以三种原创表情位图区分评价。隐藏某一类别后，其图片与命中同时消失。"],gaps:["本库场景的功能、交互和资源占用需在目标运行环境验证。","图片由示例画布层绘制；通用散点 ImageFill API 仍未声明兼容。"],
    mount(context){const{chart}=createXY(context,'Visitor reviews by date and time of day');chart.legend.setOptions({visible:false});chart.getCursor().setVisible(false);const records=reviewRecords(),groups=['unhappy','neutral','happy'].map(kind=>{const points=records.filter(record=>record.kind===kind);return{series:imageSeries(chart,kind[0].toUpperCase()+kind.slice(1),points),records:points,size:17};});chart.getDefaultAxisX().setInterval({start:6,end:23}).setTitle('Time of day');chart.getDefaultAxisY().setInterval({start:reviewEpoch,end:reviewEpoch+30*reviewDay}).setTitle('Date').setTickStrategy('numeric',(ticks:any)=>ticks.setFormattingFunction((value:number)=>{const date=new Date(value);return`${date.getUTCMonth()+1}/${date.getUTCDate()}`;}));
      const layer=imageLayer(chart,groups,{describe:datum=>[datum.label!,datum.kind,`${datum.x.toFixed(2)} h · ${new Date(datum.y).toISOString().slice(0,10)}`]}),removeLegend=imageLegend(context.host,groups);const traces=groups.map(group=>({name:group.series.getName(),color:'#b1ddc5',points:group.records,series:group.series}));
      return{charts:[chart],traces,dispose:()=>{layer.dispose();removeLegend();},snapshot:()=>({family:'annotation-images',kind:'reviews',samples:records.length,categories:groups.map(group=>({kind:group.records[0].kind,count:group.records.length,visible:group.series.getVisible()})),rawData:records.map(record=>({...record})),imageLayer:layer.snapshot()})};}
  }
];
