import { ColorRGBA, SolidFill, SolidLine } from '../../src/index';
import { random } from '../signals';
import { legend, type Trace } from './controls';
import type { OfficialEntry } from './types';

const colors = [ColorRGBA(235,238,74),ColorRGBA(245,204,95),ColorRGBA(240,153,89),ColorRGBA(231,178,173),ColorRGBA(222,139,177),ColorRGBA(178,134,175)];

export const spatialEntries: OfficialEntry[] = [
  {
    id:'crychart-example-0901-3dLineSeries',title:'三维点线与相机 · 0901',
    description:'三条各含 50 个样本的三维点线放在同一个坐标盒中，右侧图例控制系列，拖动改变观察角度。',
    observed:["三条各含 50 个样本的三维点线放在同一个坐标盒中，右侧图例控制系列，拖动改变观察角度。"],
    gaps:["本库场景的功能、交互和资源占用需在目标运行环境验证。"],
    mount(context) {
      const wrapper=document.createElement('div');wrapper.style.cssText='display:grid;grid-template-columns:minmax(0,1fr) 105px;flex:1;min-height:0';context.host.append(wrapper);
      const host=document.createElement('div');host.style.cssText='min-width:0;min-height:0;position:relative';wrapper.append(host);const chart=context.engine.Chart3D({container:host,theme:context.theme});
      chart.legend.setOptions({visible:false});
      chart.setPadding({left:-26,right:-15,top:-18,bottom:-15}).setCameraLocation({azimuth:-.2,elevation:.2,zoom:1.17});
      const caption=document.createElement('div');caption.className='plot-caption';caption.textContent='3D Line Series (150 data points)';chart.root.append(caption);
      chart.getDefaultAxisX().setTitle('Axis X').setInterval({start:0,end:50});chart.getDefaultAxisY().setTitle('Axis Y').setInterval({start:-6,end:6});chart.getDefaultAxisZ().setTitle('Axis Z').setInterval({start:0,end:2});
      const rng=random(10901),traces:Trace[]=[];
      for(let channel=0;channel<3;channel++) {
        let value=0;const points=Array.from({length:50},(_,x)=>{value+=(rng()-.5)*1.3+(channel-1)*.015;return{x,y:value,z:channel};});
        const series=chart.addPointLineSeries().setName(`Series ${String.fromCharCode(65+channel)}`).setStrokeStyle(new SolidLine({fillStyle:new SolidFill({color:colors[channel]}),thickness:1.6})).setPointFillStyle(new SolidFill({color:colors[channel]})).setPointSize(5).add(points);
        traces.push({name:series.getName(),points,series,color:colors[channel].toCSS()});
      }
      const side=document.createElement('div');side.style.cssText='display:flex;justify-content:center;align-items:center';wrapper.append(side);const cleanup=legend(side,traces),bar=side.querySelector<HTMLElement>('.official-legend')!;bar.style.cssText='display:flex;flex-direction:column;align-items:flex-start;gap:7px;border:1px solid #94978b;border-radius:7px;padding:10px 8px;height:auto;background:#101112';
      return{charts:[chart],traces,dispose:()=>{cleanup();wrapper.remove();},snapshot:()=>({sampleCount:150,seriesSamples:traces.map(trace=>trace.series.getSampleCount()),camera:chart.getCameraLocation(),depthPolicy:'three independent parallel measurement planes',z:chart.getDefaultAxisZ().getInterval()})};
    },
  },
  {
    id:'crychart-example-1001-polarMicrophoneSensitivity',title:'麦克风极坐标灵敏度 · 1001',
    description:'六个频率的方向响应以分贝表示。0° 位于上方，角度顺时针增加，幅度由中心的 -40 dB 到外缘的 0 dB。',
    observed:["六个频率的方向响应以分贝表示。0° 位于上方，角度顺时针增加，幅度由中心的 -40 dB 到外缘的 0 dB。"],
    gaps:["本库场景的功能、交互和资源占用需在目标运行环境验证。"],
    mount(context) {
      const host=document.createElement('div');host.className='official-main-chart';context.host.append(host);const chart=context.engine.Polar({container:host,theme:context.theme});chart.setPadding({left:-38,right:-16,top:-16,bottom:-20}).setAngleOrigin(90).setClockwise(true).setUserInteractions(false);
      chart.legend.setOptions({visible:false});
      chart.setCursorMode(undefined);
      chart.setRadialAxisAngle?.(90);chart.getAmplitudeAxis().setInterval({start:-40,end:0}).setTitle('Sensitivity (dB)');chart.getAngularAxis().setTitle('Degrees').setInterval({start:0,end:360});
      const caption=document.createElement('div');caption.className='plot-caption';caption.textContent='Microphone sensitivity 360 degrees';chart.root.append(caption);
      const names=['150Hz','1KHz','4KHz','6KHz','8KHz','12.5KHz'],rng=random(11001),traces:Trace[]=names.map((name,index)=>{
        const points=Array.from({length:361},(_,angle)=>{const radians=angle*Math.PI/180,response=30*Math.log10(.065+.935*(1+Math.cos(radians))/2)+index*2*Math.sin(radians/2)**4+(rng()-.5)*.35;return{x:angle,y:Math.min(0,response-.3)};});points[360].y=points[0].y;
        const series=chart.addLineSeries().setName(name).setStrokeStyle(new SolidLine({fillStyle:new SolidFill({color:colors[index]}),thickness:1.6})).add(points);return{name,points,series,color:colors[index].toCSS(),unit:'dB'};
      });
      const cleanup=legend(context.host,traces),tooltip=document.createElement('div');tooltip.className='shared-cursor-table';tooltip.hidden=true;chart.root.append(tooltip);const controller=new AbortController();
      chart.overlay.addEventListener('pointermove',(event:PointerEvent)=>{
        const rect=chart.overlay.getBoundingClientRect(),pointer={x:event.clientX-rect.left,y:event.clientY-rect.top};let best=18**2,nearest:{trace:Trace;angle:number;amplitude:number;x:number;y:number}|undefined;
        for(const trace of traces)if(trace.series.getVisible())for(const point of trace.points){const pixel=chart.projectPolarPoint({angle:point.x,amplitude:point.y}),distance=(pixel.x-pointer.x)**2+(pixel.y-pointer.y)**2;if(distance<best){best=distance;nearest={trace,angle:point.x,amplitude:point.y,...pixel};}}
        tooltip.hidden=!nearest;if(!nearest)return;
        const row=document.createElement('div');row.className='cursor-row';row.style.gridTemplateColumns='minmax(0,1fr) auto';row.style.columnGap='12px';
        const heading=document.createElement('div');heading.className='cursor-date';heading.style.gridColumn='1 / -1';heading.style.textAlign='left';heading.textContent=nearest.trace.name;
        const cell=(tag:'span'|'strong',text:string)=>{const element=document.createElement(tag);element.textContent=text;return element;};
        row.append(heading,cell('span','Angle'),cell('strong',`${nearest.angle}°`),cell('span','Amplitude'),cell('strong',`${nearest.amplitude.toFixed(2)} dB`));
        tooltip.replaceChildren(row);tooltip.style.left=`${Math.max(5,Math.min(nearest.x+14,chart.width-tooltip.offsetWidth-5))}px`;tooltip.style.top=`${Math.max(35,nearest.y-tooltip.offsetHeight-12)}px`;
      },{signal:controller.signal});chart.overlay.addEventListener('pointerleave',()=>{tooltip.hidden=true;},{signal:controller.signal});
      return{charts:[chart],traces,dispose:()=>{cleanup();controller.abort();tooltip.remove();},snapshot:()=>({angleOrigin:chart.getAngleOrigin(),clockwise:chart.getClockwise(),amplitude:chart.getAmplitudeAxis().getInterval(),frequencies:names,closed:traces.every(trace=>trace.points[0].y===trace.points[360].y),hoverPixel:chart.projectPolarPoint({angle:60,amplitude:traces[0].points[60].y}),rendering:'Canvas2D polar paths'})};
    },
  },
];
