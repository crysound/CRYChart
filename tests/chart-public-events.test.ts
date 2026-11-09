import test from 'node:test';
import assert from 'node:assert/strict';
import {ChartXY} from '../src/chart';
import {AxisPosition} from '../src/chart-events';

test('automatic chart dimensions follow the actual canvas root rather than the container border box',()=>{
  const chart=new ChartXY();Object.defineProperty(chart,'container',{value:{getBoundingClientRect:()=>({width:928,height:588})}});
  Object.defineProperty(chart,'root',{value:{getBoundingClientRect:()=>({width:900,height:560}),remove(){}}});
  chart.resize();assert.deepEqual(chart.getSizePixels(),{x:900,y:560});
  chart.resize(640,480);assert.deepEqual(chart.getSizePixels(),{x:640,y:480});chart.dispose();
});

test('Waterfall public resize and history-axis interval callbacks use exact payloads and same-function removal',()=>{
  const chart=new ChartXY(),sizes:any[]=[],intervals:any[]=[],resize=(event:any)=>sizes.push(event),interval=(event:any)=>intervals.push(event);
  chart.addEventListener('resize',resize);chart.axisX.addEventListener('intervalchange',interval);chart.resize(1234,567);chart.axisX.setInterval({start:2,end:10});
  assert.deepEqual(sizes,[{width:1234,height:567,engineWidth:1234,engineHeight:567}]);assert.deepEqual(chart.getSizePixels(),{x:1234,y:567});assert.deepEqual(intervals,[{start:2,end:10}]);
  chart.removeEventListener('resize',resize);chart.axisX.removeEventListener('intervalchange',interval);chart.resize(500,400);chart.axisX.setInterval({start:3,end:11});assert.equal(sizes.length,1);assert.equal(intervals.length,1);
  const upper=chart.addAxisX({opposite:true,iStack:2}),lower=chart.addAxisY({iStack:-1}).setVisible(false);assert.deepEqual(chart.getAxes(AxisPosition.Top),[upper]);assert.ok(chart.getAxes().includes(lower));lower.dispose();assert.ok(!chart.getAxes().includes(lower));chart.dispose();
});

test('public pointer events retain native identity and axis double-click reaches only the actual axis lane',()=>{
  class Overlay extends EventTarget{getBoundingClientRect(){return{left:10,top:20};}setPointerCapture(){} }
  class Probe extends ChartXY{attach(overlay:Overlay){Object.defineProperty(this,'overlay',{value:overlay});this.attachInteractions();}}
  const chart=new Probe(),overlay=new Overlay(),top=chart.addAxisX({opposite:true});chart.resize(800,500);chart.attach(overlay);
  const routed:string[]=[],pointer:Event[]=[],bottomEvent:Event[]=[];
  chart.axisX.addEventListener('dblclick',event=>{routed.push('bottom');bottomEvent.push(event);event.preventDefault();});top.addEventListener('dblclick',()=>routed.push('top'));
  chart.addEventListener('pointermove',event=>pointer.push(event));
  const event=(type:string,x:number,y:number)=>Object.assign(new Event(type,{cancelable:true}),{clientX:x+10,clientY:y+20,button:0,pointerId:1});
  const move=event('pointermove',chart.plot.left+20,chart.plot.top+20);overlay.dispatchEvent(move);assert.deepEqual(pointer,[move]);
  const click=event('dblclick',chart.plot.left+20,chart.plot.top+chart.plot.height+5);overlay.dispatchEvent(click);assert.deepEqual(routed,['bottom']);assert.equal(bottomEvent[0],click);assert.equal(click.defaultPrevented,true);
  chart.dispose();overlay.dispatchEvent(event('pointermove',100,100));assert.equal(pointer.length,1);
});

test('annotation public value changes and repeated dispose detach both subscription and axis-owned references',()=>{
  const chart=new ChartXY(),axis=chart.axisX;
  for(let i=0;i<100;i++){const line=axis.addConstantLine(),values:number[]=[],listener=(event:any)=>values.push(event.value);line.addEventListener('valuechange',listener);line.setValue(1);line.removeEventListener('valuechange',listener);line.setValue(2);assert.deepEqual(values,[1]);line.dispose();assert.equal(axis.annotations.length,0);}
  const first=axis.addConstantLine(),second=axis.addBand();first.addEventListener('dispose',()=>{throw new Error('consumer');});assert.throws(()=>axis.dispose(),AggregateError);assert.equal(second.disposed,true);assert.equal(axis.annotations.length,0);chart.dispose();
});
