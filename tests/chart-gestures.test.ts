import test from 'node:test';
import assert from 'node:assert/strict';
import {ChartXY} from '../src/chart.js';

class Overlay extends EventTarget {
  getBoundingClientRect(){return {left:10,top:20};}
  setPointerCapture(){}
}
class Probe extends ChartXY {
  attach(overlay:Overlay){Object.defineProperty(this,'overlay',{value:overlay});this.attachInteractions();}
}
const defaults={pan:{lmb:{drag:{x:true,y:false}},wheel:false,rmb:false},zoom:{wheel:false,y:false},
  xAxis:{zoom:{wheel:false}},yAxis:{zoom:{wheel:false}},rectangleZoom:false,restoreDefault:{doubleClick:false}};
function setup(config:any=defaults){
  const chart=new Probe(),overlay=new Overlay();chart.resize(800,500);chart.setUserInteractions(config);
  chart.axisX.setInterval({start:0,end:100});chart.axisY.setInterval({start:0,end:100});chart.attach(overlay);
  const point=(x:number,y:number)=>({x:chart.plot.left+chart.plot.width*x,y:chart.plot.top+chart.plot.height*y});
  const event=(type:string,p:{x:number;y:number},fields:any={})=>{
    const e=Object.assign(new Event(type,{cancelable:true}),{clientX:p.x+10,clientY:p.y+20,button:0,pointerId:1,deltaY:100,deltaMode:0,...fields});
    overlay.dispatchEvent(e);return e;
  };
  return {chart,overlay,point,event};
}
const near=(actual:number,expected:number)=>assert.ok(Math.abs(actual-expected)<1e-9,`${actual} != ${expected}`);

test('actual XY DOM handlers route OpenTest left drag to X pan and honor disabled gestures',()=>{
  const {chart,point,event}=setup();
  assert.equal(event('pointerdown',point(.4,.4)).defaultPrevented,true);
  event('pointermove',point(.5,.6));event('pointerup',point(.5,.6));
  near(chart.axisX.getInterval().start,-10);near(chart.axisX.getInterval().end,90);
  assert.deepEqual(chart.axisY.getInterval(),{start:0,end:100});
  const before=chart.axisX.getInterval();assert.equal(event('wheel',point(.5,.5)).defaultPrevented,false);
  event('pointerdown',point(.3,.5),{button:2});event('pointermove',point(.8,.5),{button:2});event('pointerup',point(.8,.5),{button:2});
  event('dblclick',point(.5,.5));assert.deepEqual(chart.axisX.getInterval(),before);chart.dispose();
});

test('plot wheel and axis-lane wheel have separate policies, axis opt-out and stopScroll semantics',()=>{
  const wheel={...defaults,zoom:{wheel:{x:true,y:false,sensitivity:.5,stopScroll:false},y:false}};
  const {chart,point,event}=setup(wheel);
  chart.axisX.setUserInteractions({pan:false,zoom:{wheel:false}});
  const first=event('wheel',point(.25,.5));assert.equal(first.defaultPrevented,true);
  // Sensitivity .5 and positive delta expand the span by 10%, keeping its 25% anchor.
  near(chart.axisX.getInterval().start,25-25*1.1);near(chart.axisX.getInterval().end,25+75*1.1);
  assert.equal(chart.axisX.stopped,false);assert.deepEqual(chart.axisY.getInterval(),{start:0,end:100});
  const before=chart.axisX.getInterval(),lane={x:point(.25,0).x,y:chart.plot.top+chart.plot.height+10};
  assert.equal(event('wheel',lane).defaultPrevented,false);assert.deepEqual(chart.axisX.getInterval(),before);
  chart.axisX.setUserInteractions({zoom:{wheel:{mode:'keep-end',stopScroll:true,sensitivity:1}}});
  assert.equal(event('wheel',lane).defaultPrevented,true);near(chart.axisX.getInterval().end,before.end);assert.equal(chart.axisX.stopped,true);
  chart.axisX.setUserInteractions({chartInteractions:{zoom:false}});const blocked=chart.axisX.getInterval();
  assert.equal(event('wheel',point(.5,.5)).defaultPrevented,false);assert.deepEqual(chart.axisX.getInterval(),blocked);chart.dispose();
});

test('XY rectangle selection, restore cancellation and independent cursor do not invoke implicit pan',()=>{
  const config={pan:false,zoom:{wheel:false},rectangleZoom:{lmb:{x:true,y:true}},restoreDefault:{doubleClick:false}};
  const {chart,point,event}=setup(config);
  event('pointerdown',point(.2,.2));event('pointermove',point(.8,.8));event('pointerup',point(.8,.8));
  for(const axis of [chart.axisX,chart.axisY]){near(axis.getInterval().start,20);near(axis.getInterval().end,80);}
  chart.addLineSeries().add([{x:-100,y:-50},{x:500,y:250}]);
  chart.setUserInteractions({});const before=chart.axisX.getInterval();
  const listener=(e:any)=>e.preventDefault();chart.addEventListener('dblclick',listener);
  event('dblclick',point(.5,.5));assert.deepEqual(chart.axisX.getInterval(),before);
  chart.removeEventListener('dblclick',listener);event('dblclick',point(.5,.5));assert.notDeepEqual(chart.axisX.getInterval(),before);chart.dispose();
});

test('axis lane anchors respect inversion/logarithms and invalid active settings leave old config intact',()=>{
  const {chart,point,event}=setup({pan:false,zoom:{wheel:{x:true,y:false,sensitivity:1}}});
  chart.axisX.type='logarithmic';chart.axisX.setInterval({start:1,end:1000});chart.axisX.setInverted(true);
  // Same public response report, sensitivity 1 / deltaY +100 -> 1.2 span.
  // The logarithmic/inverted anchor assertion is otherwise unchanged.
  event('wheel',point(.25,.5));const factor=1.2,anchor=1000**.75;
  near(chart.axisX.getInterval().start,anchor*(1/anchor)**factor);near(chart.axisX.getInterval().end,anchor*(1000/anchor)**factor);
  const old=chart.getUserInteractions();assert.throws(()=>chart.setUserInteractions({zoom:{pinch:{}}}),/Unsupported/);assert.equal(chart.getUserInteractions(),old);
  assert.throws(()=>chart.axisX.setUserInteractions({zoom:{drag:{}}}),/Unsupported/);chart.dispose();
});

test('actual pointer capture path drags an annotation without changing chart axes',()=>{
  const {chart,point,event}=setup(),line=chart.axisX.addConstantLine().setValue(40).setMouseInteractions(true).setDraggable(true);
  const changes:number[]=[];line.addEventListener('valuechange',e=>changes.push(e.value));
  event('pointerdown',point(.4,.5));event('pointermove',point(.6,.5));event('pointerup',point(.6,.5));
  near(line.getValue(),60);assert.equal(changes.length,1);assert.deepEqual(chart.axisX.getInterval(),{start:0,end:100});chart.dispose();
});
