import test from 'node:test';
import assert from 'node:assert/strict';
import {ChartXY} from '../src/chart.js';
class Overlay extends EventTarget {
 captured:number[]=[];released:number[]=[];
 getBoundingClientRect(){return{left:0,top:0};}
 setPointerCapture(id:number){this.captured.push(id);}
 releasePointerCapture(id:number){this.released.push(id);}
}
const context=new Proxy({},{get:()=>()=>{}}) as CanvasRenderingContext2D;
class Probe extends ChartXY {
 attach(overlay:Overlay){Object.defineProperty(this,'overlay',{value:overlay});this.attachInteractions();}
 drawCursorNow(){this.drawCursor(context);}
}
function fixture(){
 const chart=new Probe({legend:{visible:false}}),overlay=new Overlay();chart.resize(800,500);chart.axisX.setInterval({start:0,end:100});chart.axisY.setInterval({start:0,end:10});
 const series=chart.addLineSeries().add([{x:0,y:0},{x:100,y:10}]);const line=chart.axisX.addConstantLine({onTop:true}).setValue(25).setDraggable(true);
 chart.attach(overlay);const callbacks:any[]=[];chart.setCustomCursor(event=>callbacks.push(event));
 const send=(type:string,fraction:number,buttons=1)=>{overlay.dispatchEvent(Object.assign(new Event(type,{cancelable:true}),{clientX:chart.plot.left+chart.plot.width*fraction,clientY:chart.plot.top+chart.plot.height/2,button:0,buttons,pointerId:7}));};
 return{chart,overlay,series,line,callbacks,send};
}
test('annotation capture moves the actual value while holding custom cursor through release and redraws',()=>{
 const f=fixture();try{
  f.send('pointermove',.25,0);f.chart.drawCursorNow();assert.ok(f.callbacks.length>0);const before=f.callbacks.length;let actualValueChanges=0;f.line.addEventListener('valuechange',()=>actualValueChanges++);
  f.send('pointerdown',.25);for(let i=1;i<=6;i++){f.send('pointermove',.25+i/60);f.chart.drawCursorNow();}
  assert.notEqual(f.line.getValue(),25);assert.ok(actualValueChanges>=6);f.send('pointerup',.35,0);
  for(let i=0;i<5;i++)f.chart.drawCursorNow();
  assert.equal(f.callbacks.length,before,'Native actual callback trace has no new custom callback during annotation capture or release without a fresh hover');
  assert.ok(f.overlay.captured.includes(7));assert.ok(f.overlay.released.includes(7));
 }finally{f.chart.dispose();}
});
test('fresh unpressed hover after annotation release resumes real custom cursor coordinates',()=>{
 const f=fixture();try{
  f.send('pointermove',.25,0);f.chart.drawCursorNow();f.send('pointerdown',.25);f.send('pointermove',.35);f.send('pointerup',.35,0);f.chart.drawCursorNow();const before=f.callbacks.length;
  f.send('pointermove',.5,0);f.chart.drawCursorNow();assert.ok(f.callbacks.length>before);const event=f.callbacks.at(-1);assert.equal(event.mouseLocation.clientX,f.chart.plot.left+f.chart.plot.width*.5);
 }finally{f.chart.dispose();}
});
test('normal data update without an annotation gesture still publishes custom cursor hits',()=>{
 const f=fixture();try{
  f.send('pointermove',.6,0);f.chart.drawCursorNow();const before=f.callbacks.length;
  f.series.clear().add([{x:0,y:10},{x:100,y:0}]);f.chart.drawCursorNow();assert.ok(f.callbacks.length>before);assert.equal(f.callbacks.at(-1).hit.series,f.series);
 }finally{f.chart.dispose();}
});
test('a reconfigured custom handler receives a new ordinary hover after annotation release',()=>{
 const f=fixture();try{
  f.send('pointermove',.25,0);f.send('pointerdown',.25);f.send('pointermove',.35);f.send('pointerup',.35,0);let calls=0;f.chart.setCustomCursor(()=>calls++);f.send('pointermove',.6,0);f.chart.drawCursorNow();assert.ok(calls>0);
 }finally{f.chart.dispose();}
});

test('post-annotation data accepts real changed samples without dispatch until ordinary hover',()=>{
 const f=fixture();try{
  f.send('pointermove',.25,0);f.chart.drawCursorNow();const before=f.callbacks.length;f.send('pointerdown',.25);f.send('pointermove',.35);f.send('pointerup',.35,0);
  f.series.clear().add([{x:0,y:1},{x:100,y:11}]);f.chart.drawCursorNow();f.chart.drawCursorNow();assert.equal(f.callbacks.length,before);
  const mapping=f.series.getDataMapping(),data=f.series.getDataSet().readBack().data;assert.equal(f.series.getSampleCount(),2);assert.deepEqual(Array.from(data[mapping.y]!),[1,11]);
  f.send('pointermove',.6,0);f.chart.drawCursorNow();assert.ok(f.callbacks.length>before);
 }finally{f.chart.dispose();}
});

test('a movable band also holds custom cursor while actual native bounds move and then resumes hover',()=>{
 const f=fixture();try{
  const band=f.chart.axisX.addBand({onTop:true}).setValueStart(25).setValueEnd(45).setDraggable(true);
  f.send('pointermove',.35,0);f.chart.drawCursorNow();const before=f.callbacks.length;
  f.send('pointerdown',.35);for(let i=1;i<=6;i++){f.send('pointermove',.35+i/60);f.chart.drawCursorNow();}
  f.send('pointerup',.45,0);f.chart.drawCursorNow();assert.notEqual(band.getValueStart(),25);assert.ok(band.getValueEnd()>band.getValueStart());assert.equal(f.callbacks.length,before);
  f.send('pointermove',.7,0);f.chart.drawCursorNow();assert.ok(f.callbacks.length>before);
 }finally{f.chart.dispose();}
});
