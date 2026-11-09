import test from 'node:test';
import assert from 'node:assert/strict';
import {ChartXY,Chart3D,Polar} from '../src/chart.js';

const fixture=()=>{const chart=new ChartXY(),axis=chart.getDefaultAxisX();axis.setScrollStrategy(undefined);return{chart,axis};};
test('restriction setter is deferred; manual interval caps around the requested midpoint',()=>{
 const {chart,axis}=fixture();try{
  axis.setInterval({start:0,end:10000,stopAxisAfter:true});let changes=0;axis.on('intervalchange',()=>changes++);
  const restrictions={intervalMax:5000};assert.equal(axis.setIntervalRestrictions(restrictions),axis);chart.renderNow();
  assert.deepEqual(axis.getInterval(),{start:0,end:10000});assert.equal(changes,0);
  assert.equal(axis.setInterval({start:-1000,end:7000,stopAxisAfter:true}),axis);
  assert.deepEqual(axis.getInterval(),{start:500,end:5500});assert.equal(changes,1);assert.equal(axis.getStopped(),true);
 }finally{chart.dispose();}
});
test('equal and smaller spans stay exact; numeric overload uses the same cap',()=>{
 const {chart,axis}=fixture();try{
  axis.setIntervalRestrictions({intervalMax:5000});
  axis.setInterval({start:125,end:5125});assert.deepEqual(axis.getInterval(),{start:125,end:5125});
  axis.setInterval(100,1100);assert.deepEqual(axis.getInterval(),{start:100,end:1100});
  axis.setInterval(-1000,7000);assert.deepEqual(axis.getInterval(),{start:500,end:5500});
 }finally{chart.dispose();}
});
test('reversed manual interval preserves direction and center',()=>{
 const {chart,axis}=fixture();try{axis.setIntervalRestrictions({intervalMax:5000}).setInterval({start:7000,end:-1000});assert.deepEqual(axis.getInterval(),{start:5500,end:500});}finally{chart.dispose();}
});
test('wheel policy caps scale before anchor arithmetic and repeated cap stays exact',()=>{
 const {chart,axis}=fixture();try{
  axis.setIntervalRestrictions({intervalMax:5000}).setInterval({start:0,end:4000});
  const factor=axis.limitIntervalZoomFactor(2),fraction=.25,iv=axis.getInterval(),anchor=iv.start+(iv.end-iv.start)*fraction;
  assert.equal(factor,1.25);axis.setInterval({start:anchor+(iv.start-anchor)*factor,end:anchor+(iv.end-anchor)*factor});
  assert.deepEqual(axis.getInterval(),{start:-250,end:4750});
  for(let i=0;i<50;i++){assert.equal(axis.limitIntervalZoomFactor(2),1);axis.setInterval(axis.getInterval());}
  assert.deepEqual(axis.getInterval(),{start:-250,end:4750});assert.equal(axis.limitIntervalZoomFactor(.5),.5);
 }finally{chart.dispose();}
});
test('deferred oversized current span is reduced by the next wheel scale',()=>{
 const {chart,axis}=fixture();try{axis.setInterval({start:0,end:10000}).setIntervalRestrictions({intervalMax:5000});assert.equal(axis.limitIntervalZoomFactor(2),.5);}finally{chart.dispose();}
});
test('clear and mutable constant object are read on each subsequent commit',()=>{
 const {chart,axis}=fixture();try{
  const limits={intervalMax:5000};axis.setIntervalRestrictions(limits);limits.intervalMax=2000;
  axis.setInterval({start:0,end:10000});assert.deepEqual(axis.getInterval(),{start:4000,end:6000});
  axis.setIntervalRestrictions(undefined).setInterval({start:0,end:10000});assert.deepEqual(axis.getInterval(),{start:0,end:10000});assert.equal(axis.getIntervalRestrictions(),undefined);
 }finally{chart.dispose();}
});
test('other limits and callbacks are not silently executed as an intervalMax policy',()=>{
 const {chart,axis}=fixture();try{
  for(const limits of [{intervalMin:5000},{startMin:100},{intervalMax:NaN},{intervalMax:Infinity},{intervalMax:0},{intervalMax:-1},{intervalMax:'5000'},[{intervalMax:5000}]]){axis.setIntervalRestrictions(limits).setInterval({start:0,end:10000});assert.deepEqual(axis.getInterval(),{start:0,end:10000});}
  let calls=0;axis.setIntervalRestrictions(()=>{calls++;return{intervalMax:5000};}).setInterval({start:0,end:10000});
  assert.equal(calls,0);assert.deepEqual(axis.getInterval(),{start:0,end:10000});assert.deepEqual(axis.getIntervalRestrictions(),{intervalMax:5000});assert.equal(calls,1);
 }finally{chart.dispose();}
});
test('logarithmic, Polar and 3D retain existing interval policies',()=>{
 const chart=new ChartXY(),polar=new Polar(),three=new Chart3D();try{
  const axes=[chart.addAxisX({type:'logarithmic'}),polar.getDefaultAxisX(),three.getDefaultAxisX()];
  for(const axis of axes){axis.setScrollStrategy(undefined).setIntervalRestrictions({intervalMax:5}).setInterval({start:1,end:100});assert.deepEqual(axis.getInterval(),{start:1,end:100});assert.equal(axis.limitIntervalZoomFactor(2),2);}
 }finally{chart.dispose();polar.dispose();three.dispose();}
});
test('invalid requested interval does not mutate interval or stop state',()=>{
 const {chart,axis}=fixture();try{
  axis.setIntervalRestrictions({intervalMax:5000}).setInterval({start:0,end:4000,stopAxisAfter:false});
  for(const value of [{start:NaN,end:1},{start:0,end:Infinity},{start:2,end:2}])assert.throws(()=>axis.setInterval(value),RangeError);
  assert.deepEqual(axis.getInterval(),{start:0,end:4000});assert.equal(axis.getStopped(),false);
 }finally{chart.dispose();}
});
test('existing immediate auto-scroll observes intervalMax without changing stored samples',()=>{
 const {chart,axis}=fixture();try{
  const series=chart.addLineSeries();axis.setAnimationScroll(false).setScrollMargins(false).setScrollStrategy('progressive').setIntervalRestrictions({intervalMax:5000}).setInterval({start:0,end:5000,stopAxisAfter:false});
  series.appendSamples({x:[0,6000,11000],y:[1,2,3]});chart.renderNow();assert.deepEqual(axis.getInterval(),{start:6000,end:11000});
  assert.deepEqual(Array.from(series.readBack().data.x as ArrayLike<number>),[0,6000,11000]);
  axis.setStopped(true);series.appendSamples({x:[16000],y:[4]});chart.renderNow();assert.deepEqual(axis.getInterval(),{start:6000,end:11000});
  axis.setStopped(false);chart.renderNow();assert.deepEqual(axis.getInterval(),{start:11000,end:16000});
 }finally{chart.dispose();}
});
