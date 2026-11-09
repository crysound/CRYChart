import test from 'node:test';
import assert from 'node:assert/strict';
import {ChartXY} from '../src/chart';
import {beginAnnotationDrag,updateAnnotationDrag} from '../src/annotation-interaction';

test('playback progress drag updates the original constant line and emits the native value-change contract without zooming axes',()=>{
  class Overlay extends EventTarget{getBoundingClientRect(){return{left:0,top:0};}setPointerCapture(){} }
  class Probe extends ChartXY{attach(overlay:Overlay){Object.defineProperty(this,'overlay',{value:overlay});this.attachInteractions();}}
  const chart=new Probe(),overlay=new Overlay();chart.axisX.setInterval({start:0,end:10});chart.axisY.setInterval({start:0,end:1});chart.resize(800,500);chart.attach(overlay);
  const line=chart.axisX.addConstantLine(true).setValue(3);line.draggable=true;const values:number[]=[],listener=()=>values.push(line.getValue());line.addEventListener('valuechange',listener);
  const event=(type:string,x:number)=>Object.assign(new Event(type),{clientX:chart.plot.left+x/10*chart.plot.width,clientY:chart.plot.top+20,button:0,pointerId:1});
  overlay.dispatchEvent(event('pointerdown',3));overlay.dispatchEvent(event('pointermove',7));overlay.dispatchEvent(event('pointerup',7));assert.ok(Math.abs(line.getValue()-7)<1e-12);assert.equal(values.length,1);assert.deepEqual(chart.axisX.getInterval(),{start:0,end:10});
  // Pixel-to-axis conversion has the precision checked above. Disabling drag
  // must preserve that exact stored value, not replace it with a rounded target.
  const movedValue=line.getValue();
  line.removeEventListener('valuechange',listener);line.draggable=false;overlay.dispatchEvent(event('pointerdown',7));overlay.dispatchEvent(event('pointermove',5));overlay.dispatchEvent(event('pointerup',5));assert.equal(line.getValue(),movedValue);assert.equal(values.length,1);chart.dispose();
});

test('difference bands move as one range and resize either boundary without crossing, including inverted axes',()=>{
  const chart=new ChartXY();chart.axisX.setInterval({start:0,end:10}).setInverted(true);chart.renderNow();const band=chart.axisX.addBand({onTop:true}).setBounds({start:2,end:4}).setUserInteractions({move:{drag:true},scale:{drag:true}}),changes:any[]=[];
  band.addEventListener('valuechange',event=>changes.push({start:event.start,end:event.end}));
  const point=(x:number)=>chart.translatePoint({x,y:.5},chart.coordsAxis,chart.coordsPixel);
  const move=beginAnnotationDrag([chart.axisX],point(3),chart.plot)!;assert.equal(move.mode,'move-band');updateAnnotationDrag(move,point(5),chart.plot);assert.ok(Math.abs(band.getValueStart()-4)<1e-12&&Math.abs(band.getValueEnd()-6)<1e-12);assert.equal(changes.length,1);
  // Crossing clamps exactly to the existing opposite endpoint. Its original
  // movement accuracy remains independently checked above.
  const movedEnd=band.getValueEnd();
  const start=beginAnnotationDrag([chart.axisX],point(4),chart.plot)!;assert.equal(start.mode,'start');updateAnnotationDrag(start,point(9),chart.plot);assert.equal(band.getValueStart(),movedEnd);assert.equal(band.getValueEnd(),movedEnd);
  assert.throws(()=>band.setBounds({start:NaN}),RangeError);assert.equal(band.getValueStart(),movedEnd);band.dispose();assert.equal(updateAnnotationDrag(start,point(3),chart.plot),false);chart.dispose();
});

test('logarithmic progress drag preserves the original grab offset multiplicatively',()=>{
  const chart=new ChartXY({defaultAxisX:{type:'logarithmic'}});chart.axisX.setInterval({start:1,end:1000});chart.renderNow();const line=chart.axisX.addConstantLine().setValue(10).setDraggable(true),point=(x:number)=>chart.translatePoint({x,y:.5},chart.coordsAxis,chart.coordsPixel);
  const drag=beginAnnotationDrag([chart.axisX],point(10.1),chart.plot)!;updateAnnotationDrag(drag,point(101),chart.plot);assert.ok(Math.abs(line.getValue()-100)<1e-10);chart.dispose();
});
