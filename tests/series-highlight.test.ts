import test from 'node:test';
import assert from 'node:assert/strict';
import {ChartXY,Chart3D,Polar} from '../src/chart.js';
import {ColorRGBA,SolidFill,SolidLine,Themes,emptyFill,emptyLine,transparentFill} from '../src/core/styles.js';
import {highlightColor} from '../src/component-highlight.js';

class Probe extends ChartXY{
  tick(time:number){this.beforeScheduledAnimationFrame(time);}
  pending(){return this.hasPendingAnimationFrame();}
  cancel(){this.cancelScheduledAnimation();}
}
class Probe3D extends Chart3D{
  tick(time:number){this.beforeScheduledAnimationFrame(time);}
  pending(){return this.hasPendingAnimationFrame();}
  wheel(delta:number){this.zoom3DCamera(delta);}
  packets(){let result:any[]=[];(this as any).gpu3d={render(p:any[]){result=p;},dispose(){},stats:{}};this.renderData([]);return result;}
}
const points=[{x:0,y:.2,z:.3},{x:1,y:.4,z:.4},{x:2,y:NaN,z:.5},{x:3,y:.6,z:.6}];
const theme=(dark:boolean)=>({...Themes[dark?'dark':'light'],isDark:dark});
const color=(r=80,g=130,b=180,a=255)=>new SolidFill({color:ColorRGBA(r,g,b,a)});
const snapshot=(series:any)=>Array.from({length:series.getSampleCount()},(_,i)=>series.getSample(i));

test('Public highlight normalization and custom theme offset preserve original styles and empty alpha',()=>{
  const chart=new Probe(),line=chart.addLineSeries().appendJSON(points);
  for(const [value,expected] of [[true,1],[false,0],[.5,.5],[2,1],[-1,0],[Infinity,1],[-Infinity,0]] as const){line.setHighlight(value);assert.equal(line.getHighlight(),expected);}
  line.setHighlight(NaN);assert.ok(Number.isNaN(line.getHighlight()));assert.equal(line.hasPendingHighlight(),false);assert.equal(line.getHighlightStrength(),0);
  const original=ColorRGBA(80,130,180,100),custom={...Themes.dark,highlightColorOffset:{getR:()=>40,getG:()=>-20,getB:()=>5,getA:()=>20}};
  const result=highlightColor(original,.5,custom);assert.deepEqual([result.getR(),result.getG(),result.getB(),result.getA()],[100,120,182.5,110]);
  assert.equal(highlightColor(original,0,custom),original);const empty=transparentFill.getColor();assert.equal(highlightColor(empty,1,custom),empty);assert.equal(original.getA(),100);chart.dispose();
});

for(const Factory of [ChartXY,Chart3D,Polar])test(`${Factory.name}: explicit global state seeds existing/new series and permits later individual override`,()=>{
  const chart=new Factory(),first=chart.addLineSeries();assert.equal(first.getAnimationHighlight(),true);
  chart.setAnimationsEnabled(false);assert.equal(first.getAnimationHighlight(),false);const second=chart.addLineSeries();assert.equal(second.getAnimationHighlight(),false);
  first.setAnimationHighlight(true);assert.equal(first.getAnimationHighlight(),true);assert.equal(second.getAnimationHighlight(),false);assert.equal(chart.addLineSeries().getAnimationHighlight(),false);
  chart.setAnimationsEnabled(true);assert.ok(chart.series.every(s=>s.getAnimationHighlight()));first.setAnimationHighlight(false);assert.equal(chart.addLineSeries().getAnimationHighlight(),true);assert.equal(first.getAnimationHighlight(),false);chart.dispose();
  const disabled=new Factory({animationsEnabled:false});assert.equal(disabled.addLineSeries().getAnimationHighlight(),false);disabled.dispose();
});

for(const dark of [true,false])test(`XY ${dark?'dark':'light'} line/point colors change without positions, revisions, NaN topology or styles changing`,()=>{
  const chart=new Probe({theme:theme(dark)}),fill=color(),stroke=new SolidLine({fillStyle:fill,thickness:2}),line=chart.addLineSeries().appendJSON(points).setStrokeStyle(stroke).setAnimationHighlight(false);
  const raw=snapshot(line),data=line.getDataSet(),revision=data.revision,styleRevision=line.getStyleRevision(),base=line.drawPacket(),baseColor=[...base.color],positions=base.positions,bytes=new Uint8Array(positions.buffer,positions.byteOffset,positions.byteLength).slice(),packetRevision=base.revision;
  line.setHighlight(.5);const active=line.drawPacket();assert.equal(active,base);assert.equal(active.positions,positions);assert.equal(active.revision,packetRevision);assert.deepEqual(active.color,[80,130,180].map(x=>(x+(dark?30:-30))/255).concat(1));
  assert.deepEqual(new Uint8Array(active.positions.buffer,active.positions.byteOffset,active.positions.byteLength),bytes);assert.deepEqual(snapshot(line),raw);assert.equal(data.revision,revision);assert.equal(line.getStyleRevision(),styleRevision);assert.equal(line.getStrokeStyle(),stroke);
  line.setHighlight(false);assert.deepEqual(line.drawPacket().color,baseColor);assert.equal(line.drawPacket().positions,positions);
  const point=chart.addPointSeries().appendJSON([points[0]!]).setPointFillStyle(fill).setAnimationHighlight(false);const p=point.drawPacket('points'),pRevision=p.revision,pPositions=p.positions;point.setHighlight(true);assert.deepEqual(point.drawPacket('points').color,[80,130,180].map(x=>(x+(dark?60:-60))/255).concat(1));assert.equal(p.revision,pRevision);assert.equal(p.positions,pPositions);assert.equal(point.getPointFillStyle(),fill);chart.dispose();
});

test('Block/display highlights derive only uniform color and high=0 returns cached packets',()=>{
  const chart=new Probe({theme:theme(true)});chart.axisX.setInterval({start:0,end:5000});chart.axisY.setInterval({start:-2,end:2});
  const line=chart.addLineSeries().setStrokeStyle(new SolidLine({fillStyle:color(),thickness:2})).setAnimationHighlight(false);line.appendJSON(Array.from({length:5000},(_,i)=>({x:i,y:i===2600?NaN:Math.sin(i*.02)})));
  const rect={left:0,top:0,width:800,height:300},data=line.getDataSet(),revision=data.revision;
  for(const [key,read] of [['lineBlocks',()=>line.drawLinePackets(rect)],['lineDisplay',()=>line.drawLineDisplayPackets(rect,rect,1,1)]] as const){
    line.setHighlight(false);const before=read(),saved=before.map(p=>({positions:p.positions,color:[...p.color],bytes:new Uint8Array(p.positions.buffer,p.positions.byteOffset,p.positions.byteLength).slice()}));assert.equal((line as any).highlightedLinePackets(before),before);
    const cache=(line as any)[key],update=cache.update.bind(cache);let output:any,updateCount=0;
    cache.update=(request:any)=>{updateCount++;assert.deepEqual(request.style.color,[80/255,130/255,180/255,1]);output=update(request);return output;};
    const basePackets=()=>output.packets??[output.packet],styleRevision=line.getStyleRevision();
    // Ordinary repeated calls also execute the existing cache protocol. The
    // companion baseline diagnostic records its revision sequence separately.
    for(let i=0;i<2;i++){const ordinary=read();assert.equal(ordinary[0]!.revision,basePackets()[0].revision);assert.equal(ordinary[0]!.positions,basePackets()[0].positions);}
    line.setHighlight(true);const active=read();assert.equal(updateCount,3);assert.equal(active.length,before.length);for(let i=0;i<active.length;i++){assert.equal(active[i]!.positions,basePackets()[i].positions);assert.equal(active[i]!.revision,basePackets()[i].revision);assert.equal(active[i]!.positions.buffer,saved[i]!.positions.buffer);assert.deepEqual(active[i]!.color,[140/255,190/255,240/255,1]);assert.deepEqual(new Uint8Array(active[i]!.positions.buffer,active[i]!.positions.byteOffset,active[i]!.positions.byteLength),saved[i]!.bytes);assert.deepEqual(basePackets()[i].color,saved[i]!.color);}
    line.setHighlight(false);const restored=read();assert.equal(updateCount,4);assert.equal((line as any).highlightedLinePackets(restored),restored);restored.forEach((p,i)=>{assert.equal(p.positions,basePackets()[i].positions);assert.equal(p.revision,basePackets()[i].revision);assert.deepEqual(p.color,saved[i]!.color);});assert.equal(line.getStyleRevision(),styleRevision);
  }
  assert.equal(data.revision,revision);chart.dispose();
});

test('Unimplemented geometry highlight rendering cannot start an invisible animation loop',()=>{
  const chart=new Probe(),polygon=chart.addPolygonSeries(),segment=chart.addSegmentSeries();
  polygon.add([{x:0,y:0},{x:1,y:0},{x:1,y:1}]);segment.add({startX:0,startY:0,endX:1,endY:1});
  for(const series of [polygon,segment]){series.setHighlight(true);assert.equal(series.getHighlight(),1);assert.equal(series.hasPendingHighlight(),false);}
  assert.equal(chart.pending(),false);chart.dispose();
});

function canvas(){const state:any={fillStyle:'old-fill',strokeStyle:'old-stroke',lineWidth:4},stack:any[]=[],path:any[]=[],calls:any[]=[];const target:any={save(){stack.push({...state});},restore(){Object.assign(state,stack.pop());},beginPath(){path.length=0;},rect(...r:any[]){path.push(r);},clip(){},fill(){calls.push({kind:'fill',style:state.fillStyle,path:structuredClone(path)});},stroke(){calls.push({kind:'stroke',style:state.strokeStyle,path:structuredClone(path)});},setLineDash(){}};return{ctx:new Proxy(target,{get:(o,k)=>k in o?o[k]:state[k],set:(_o,k,v)=>{state[k]=v;return true;}}) as CanvasRenderingContext2D,calls,state};}
test('Histogram rectangle Canvas highlight preserves geometry, per-item fill, transparent gaps and exact restore',()=>{
  const chart=new Probe({theme:theme(true)});chart.axisX.setInterval({start:0,end:4});chart.axisY.setInterval({start:0,end:1});const fill=color(),stroke=new SolidLine({fillStyle:fill,thickness:2}),bars=chart.addRectangleSeries().setFillStyle(fill).setStrokeStyle(stroke).setAnimationHighlight(false);bars.add([{x1:0,x2:1,y1:0,y2:.6},{x1:2,x2:3,y1:0,y2:.4}]);const raw=bars.getFigures().map(x=>x.getDimensionsTwoPoints()),revision=bars.revision;
  const rect={left:0,top:0,width:400,height:100},base=canvas();bars.draw(base.ctx,rect);bars.setHighlight(1);const active=canvas();bars.draw(active.ctx,rect);assert.deepEqual(active.calls.map(({style,...v})=>v),base.calls.map(({style,...v})=>v));assert.ok(active.calls.every(c=>c.style===ColorRGBA(140,190,240).toCSS()));assert.equal(bars.revision,revision);assert.equal(bars.getFillStyle(),fill);assert.equal(bars.getStrokeStyle(),stroke);assert.deepEqual(bars.getFigures().map(x=>x.getDimensionsTwoPoints()),raw);
  bars.setHighlight(0);const restored=canvas();bars.draw(restored.ctx,rect);assert.deepEqual(restored.calls,base.calls);assert.deepEqual(restored.state,base.state);bars.setFillStyle(emptyFill).setStrokeStyle(emptyLine).setHighlight(1);const empty=canvas();bars.draw(empty.ctx,rect);assert.ok(empty.calls.every(c=>c.style===ColorRGBA(0,0,0,0).toCSS()));chart.dispose();
});

test('3D line, endpoint and integrated markers retain GPU coordinate bits/cache revisions while changing only uniform colors',()=>{
  const chart=new Probe3D({theme:theme(true)}),line=chart.addPointLineSeries().appendJSON(points).setStrokeStyle(new SolidLine({fillStyle:color(),thickness:2})).setPointFillStyle(color()).setAnimationHighlight(false),end=chart.addPointSeries().appendJSON([points[3]!]).setPointFillStyle(color()).setAnimationHighlight(false);
  const original=chart.packets(),saved=original.map(p=>({id:p.id,positions:p.positions,revision:p.revision,colors:[...p.color],bytes:new Uint8Array(p.positions.buffer,p.positions.byteOffset,p.positions.byteLength).slice()})),raw=snapshot(line),dataRevision=line.getDataSet().revision;
  line.setHighlight(1);end.setHighlight(1);const active=chart.packets();assert.equal(active.length,3);active.forEach((p,i)=>{assert.equal(p.positions.buffer,saved[i]!.positions.buffer);assert.equal(p.positions.byteOffset,saved[i]!.positions.byteOffset);assert.equal(p.revision,saved[i]!.revision);assert.deepEqual(p.color,[140/255,190/255,240/255,1]);assert.deepEqual(new Uint8Array(p.positions.buffer,p.positions.byteOffset,p.positions.byteLength),saved[i]!.bytes);});assert.equal(line.getDataSet().revision,dataRevision);assert.deepEqual(snapshot(line),raw);
  line.setHighlight(0);end.setHighlight(0);const restored=chart.packets();assert.deepEqual(restored.map(p=>p.color),saved.map(p=>p.colors));chart.dispose();
});

test('3D animation hooks advance highlight and existing wheel pending together without dropping either',()=>{
  const chart=new Probe3D(),line=chart.addLineSeries().appendJSON(points).setHighlight(true);chart.setCameraLocation({x:1,y:1,z:1});chart.wheel(120);assert.notEqual(chart.getWorldZoomDiagnostics().pending,0);chart.tick(0);assert.ok(chart.pending());const radius=()=>{const p=chart.getCameraLocation();return Math.hypot(p.x,p.y,p.z);},r=radius();chart.tick(16.6667);assert.notEqual(radius(),r);assert.ok(line.getHighlightStrength()>0);line.setHighlight(false);assert.ok(chart.pending(),'Existing zoom remains pending after highlight false');for(let i=2;i<30;i++)chart.tick(i*16.6667);assert.equal(chart.getWorldZoomDiagnostics().pending,0);assert.equal(chart.pending(),false);chart.dispose();
  const legacy=new Probe3D({experimental3DCameraModel:'legacy'});legacy.addLineSeries().appendJSON(points).setHighlight(true);legacy.tick(0);legacy.tick(600);assert.equal(legacy.series[0].getHighlightStrength(),1);assert.ok(legacy.pending());legacy.dispose();
});

test('Single chart RAF stops for false, explicit global false, empty data, hidden, dispose and rendering exception',()=>{
  const prevRAF=globalThis.requestAnimationFrame,prevCancel=globalThis.cancelAnimationFrame;let next=1;const queue=new Map<number,FrameRequestCallback>();globalThis.requestAnimationFrame=fn=>{const id=next++;queue.set(id,fn);return id;};globalThis.cancelAnimationFrame=id=>{queue.delete(id);};const flush=(t:number)=>{const batch=[...queue.values()];queue.clear();batch.forEach(fn=>fn(t));};
  try{const chart=new Probe();(chart as any).root={hidden:false,style:{},remove(){}};const line=chart.addLineSeries().appendJSON(points).setHighlight(true);assert.equal(queue.size,1);flush(0);flush(300);assert.equal(queue.size,1);line.setHighlight(false);flush(310);assert.equal(queue.size,0);line.setHighlight(true);chart.setAnimationsEnabled(false);flush(320);assert.equal(queue.size,0);assert.equal(line.getHighlightStrength(),1);line.setAnimationHighlight(true);flush(330);assert.equal(queue.size,1);line.clear();flush(340);assert.equal(queue.size,0);line.appendJSON(points);flush(350);assert.equal(queue.size,1);chart.setVisible(false);flush(360);assert.equal(queue.size,0);chart.setVisible(true);flush(370);assert.equal(queue.size,1);line.setVisible(false);flush(380);assert.equal(queue.size,0);line.setVisible(true);flush(390);
    const layout=(chart as any).layout;(chart as any).layout=()=>{throw Error('paint failed');};assert.throws(()=>flush(400),/paint failed/);assert.equal(queue.size,0);assert.equal(chart.pending(),false);(chart as any).layout=layout;line.setHighlight(true);assert.equal(queue.size,1);chart.dispose();assert.equal(queue.size,0);
    const histogram=new Probe();(histogram as any).root={hidden:false,style:{},remove(){}};const bars=histogram.addRectangleSeries().setHighlight(true);bars.add({x:0,y:0,width:1,height:1});flush(500);assert.equal(queue.size,1);bars.clear();flush(520);assert.equal(queue.size,0);histogram.dispose();
  }finally{if(prevRAF)globalThis.requestAnimationFrame=prevRAF;else delete (globalThis as any).requestAnimationFrame;if(prevCancel)globalThis.cancelAnimationFrame=prevCancel;else delete (globalThis as any).cancelAnimationFrame;}
});
