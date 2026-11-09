import test from 'node:test';
import assert from 'node:assert/strict';
import {ChartXY} from '../src/chart.js';

class Overlay extends EventTarget {
 getBoundingClientRect(){return{left:0,top:0};}
 setPointerCapture(){}
 releasePointerCapture(){}
}
class Probe extends ChartXY {
 attach(overlay:Overlay){Object.defineProperty(this,'overlay',{value:overlay});this.attachInteractions();}
}
function setup(){
 const chart=new Probe(),overlay=new Overlay();chart.resize(800,500);
 chart.axisX.setInterval({start:20,end:20000});chart.axisY.setInterval({start:-10,end:10});
 chart.setUserInteractions({pan:{lmb:{drag:{x:true,y:false}}},rectangleZoom:false});chart.attach(overlay);
 const send=(type:string,fraction:number,buttons=1,pointerId=1)=>{
  const event=Object.assign(new Event(type,{cancelable:true}),{clientX:chart.plot.left+chart.plot.width*fraction,clientY:chart.plot.top+chart.plot.height/2,button:0,buttons,pointerId});
  overlay.dispatchEvent(event);return event;
 };
 return{chart,send};
}
test('a new unpressed move cannot continue an old chart pan when the parent captured pointerup',()=>{
 const{chart,send}=setup();try{
  const before=chart.axisX.getInterval();send('pointerdown',.5);
  // The application captures the pointer on its ancestor. The overlay never
  // receives pointerup (or a lost event when its pending capture was replaced).
  send('pointermove',.6,0);assert.deepEqual(chart.axisX.getInterval(),before);
  send('pointermove',.7,0);assert.deepEqual(chart.axisX.getInterval(),before);
 }finally{chart.dispose();}
});
test('capture transfer cancels chart pan but a different pointer does not cancel the active gesture',()=>{
 const{chart,send}=setup();try{
  send('pointerdown',.5);send('lostpointercapture',.5,1,2);send('pointermove',.6);
  assert.notDeepEqual(chart.axisX.getInterval(),{start:20,end:20000});
  const after=chart.axisX.getInterval();send('lostpointercapture',.6);send('pointermove',.8);
  assert.deepEqual(chart.axisX.getInterval(),after);
 }finally{chart.dispose();}
});
test('lost capture discards rectangle selection without applying an interrupted zoom',()=>{
 const{chart,send}=setup();try{
  chart.setUserInteractions({pan:false,rectangleZoom:{lmb:{x:true,y:true}}});
  const before=chart.axisX.getInterval();send('pointerdown',.2);send('pointermove',.8);send('lostpointercapture',.8);send('pointerup',.8,0);
  assert.deepEqual(chart.axisX.getInterval(),before);
 }finally{chart.dispose();}
});
test('capture cancellation releases annotation drag subscriptions and permits a fresh gesture',()=>{
 const{chart,send}=setup();try{
  const line=chart.axisX.addConstantLine().setValue(10010).setDraggable(true);
  send('pointerdown',.5);send('pointermove',.6);const moved=line.getValue();
  assert.notEqual(moved,10010);send('lostpointercapture',.6);send('pointermove',.8);
  assert.equal(line.getValue(),moved);
  send('pointerdown',.6);send('pointermove',.7);send('pointerup',.7,0);assert.notEqual(line.getValue(),moved);
 }finally{chart.dispose();}
});
