import test from 'node:test';
import assert from 'node:assert/strict';
import {ChartXY} from '../src/chart.js';
import {AxisScrollStrategies} from '../src/core/styles.js';

const fixture=()=>{const chart=new ChartXY(),axis=chart.getDefaultAxisX(),series=chart.addLineSeries();return{chart,axis,series};};

test('consumer initialization disables zoom and scroll animation without changing auto-scroll target',()=>{
 const {chart,axis,series}=fixture();
 try{
  assert.equal(axis.setAnimationZoom(undefined).setScrollMargins(false).setAnimationScroll(false),axis);
  axis.setDefaultInterval({start:0,end:10,stopAxisAfter:false}).setScrollStrategy(AxisScrollStrategies.progressive);
  series.appendSamples({x:[1,14],y:[2,3]});chart.renderNow();
  assert.deepEqual(axis.getInterval(),{start:4,end:14});assert.equal(axis.getStopped(),false);
  series.appendSamples({x:[21],y:[4]});chart.renderNow();
  assert.deepEqual(axis.getInterval(),{start:11,end:21});
 }finally{chart.dispose();}
});

test('reapplying consumer configuration preserves a stopped manual interval',()=>{
 const {chart,axis,series}=fixture();
 try{
  axis.setScrollStrategy(AxisScrollStrategies.progressive).setInterval({start:-5,end:5,stopAxisAfter:true});
  axis.setAnimationZoom(undefined).setScrollMargins(false).setAnimationScroll(false);
  series.appendSamples({x:[0,25],y:[1,2]});chart.renderNow();
  assert.deepEqual(axis.getInterval(),{start:-5,end:5});assert.equal(axis.getStopped(),true);
 }finally{chart.dispose();}
});

test('stop/resume follows the latest data in one render and disabled strategy remains stopped in place',()=>{
 const {chart,axis,series}=fixture();
 try{
  axis.setAnimationScroll(false).setScrollMargins(false).setScrollStrategy(AxisScrollStrategies.progressive).setInterval({start:0,end:10,stopAxisAfter:false});
  series.appendSamples({x:[0,20],y:[1,2]});chart.renderNow();assert.deepEqual(axis.getInterval(),{start:10,end:20});
  axis.setStopped(true);series.appendSamples({x:[30],y:[3]});chart.renderNow();assert.deepEqual(axis.getInterval(),{start:10,end:20});
  axis.setStopped(false);chart.renderNow();assert.deepEqual(axis.getInterval(),{start:20,end:30});
  axis.setScrollStrategy(undefined);series.appendSamples({x:[50],y:[4]});chart.renderNow();assert.deepEqual(axis.getInterval(),{start:20,end:30});
 }finally{chart.dispose();}
});

test('finite-history fitting and chained interval updates remain immediate',()=>{
 const {chart,axis,series}=fixture();
 try{
  axis.setAnimationScroll(false).setScrollMargins(false).setScrollStrategy(AxisScrollStrategies.fitting);
  series.appendSamples({x:[3,19],y:[1,2]});chart.renderNow();assert.deepEqual(axis.getInterval(),{start:3,end:19});
  assert.equal(axis.setInterval({start:0,end:60,stopAxisAfter:true}).setAnimationScroll(false),axis);
  chart.renderNow();assert.deepEqual(axis.getInterval(),{start:0,end:60});
 }finally{chart.dispose();}
});

test('animated/default flags are accepted without changing a stopped interval and invalid flags still fail',()=>{
 const {chart,axis}=fixture();
 try{
  axis.setScrollStrategy(AxisScrollStrategies.progressive).setInterval({start:5,end:15,stopAxisAfter:true});
  for(const value of [true,undefined])assert.equal(axis.setAnimationScroll(value),axis);
  for(const value of [null,0,'false',{}])assert.throws(()=>axis.setAnimationScroll(value as any),TypeError);
  assert.deepEqual(axis.getInterval(),{start:5,end:15});assert.equal(axis.getStopped(),true);assert.equal(axis.getScrollStrategy(),AxisScrollStrategies.progressive);
  assert.equal(axis.setAnimationScroll(false),axis);
 }finally{chart.dispose();}
});

test('restrictions getter starts undefined, returns exact object and clears',()=>{
 const {chart,axis}=fixture();
 try{
  // A new axis has no restrictions until the caller assigns them.
  assert.equal(axis.getIntervalRestrictions(),undefined);
  const value={intervalMax:5000};assert.equal(axis.setIntervalRestrictions(value),axis);
  assert.equal(axis.getIntervalRestrictions(),value);assert.equal(axis.getIntervalRestrictions(),axis.getIntervalRestrictions());
  value.intervalMax=6000;assert.equal(axis.getIntervalRestrictions()?.intervalMax,6000);
  axis.setIntervalRestrictions(undefined);assert.equal(axis.getIntervalRestrictions(),undefined);
 }finally{chart.dispose();}
});

test('TimeWaveform recovery reads Preview intervalMax and restores an explicit zero-origin window',()=>{
 const {chart,axis,series}=fixture();
 try{
  axis.setAnimationZoom(undefined).setScrollMargins(false).setAnimationScroll(false).setScrollStrategy(undefined).setIntervalRestrictions({intervalMax:5000});
  series.appendSamples({x:[100,10000],y:[1,2]});axis.setInterval({start:100,end:10100,stopAxisAfter:true});
  const restriction=axis.getIntervalRestrictions();assert.equal(restriction?.intervalMax,5000);
  axis.setInterval({start:0,end:restriction!.intervalMax!,stopAxisAfter:true});chart.renderNow();
  assert.deepEqual(axis.getInterval(),{start:0,end:5000});assert.equal(axis.getStopped(),true);
 }finally{chart.dispose();}
});

test('single-Y recovery reads the same intervalMax and preserves the current start',()=>{
 const {chart,axis}=fixture();
 try{
  // Public setter is deferred: the preexisting manual interval remains unchanged.
  axis.setInterval({start:125,end:9000,stopAxisAfter:true}).setIntervalRestrictions({intervalMax:5000});
  const restriction=axis.getIntervalRestrictions(),start=axis.getInterval().start;
  axis.setInterval({start,end:start+restriction!.intervalMax!,stopAxisAfter:true});chart.renderNow();
  assert.deepEqual(axis.getInterval(),{start:125,end:5125});assert.equal(axis.getStopped(),true);
 }finally{chart.dispose();}
});

test('cleared restriction permits manual restore and auto fit without stale intervalMax',()=>{
 const {chart,axis,series}=fixture();
 try{
  axis.setScrollMargins(false).setIntervalRestrictions({intervalMax:5000});axis.setIntervalRestrictions(undefined);
  assert.equal(axis.getIntervalRestrictions(),undefined);
  axis.setInterval({start:-3,end:9,stopAxisAfter:true});series.appendSamples({x:[2,30],y:[1,2]});chart.renderNow();assert.deepEqual(axis.getInterval(),{start:-3,end:9});
  axis.setScrollStrategy(AxisScrollStrategies.fitting).setInterval({stopAxisAfter:false}).fit();chart.renderNow();assert.deepEqual(axis.getInterval(),{start:2,end:30});
 }finally{chart.dispose();}
});

test('callback restrictions are resolved on each get with current interval and original data bounds',()=>{
 const {chart,axis,series}=fixture();
 try{
  const states:any[]=[];axis.setInterval({start:2,end:12,stopAxisAfter:true});series.appendSamples({x:[3,19],y:[1,2]});
  axis.setIntervalRestrictions((state:any)=>{states.push(state);return{startMin:state.dataMin,intervalMax:state.curEnd-state.curStart+1};});
  assert.equal(states.length,0);
  assert.deepEqual(axis.getIntervalRestrictions(),{startMin:3,intervalMax:11});assert.deepEqual(states[0],{curStart:2,curEnd:12,dataMin:3,dataMax:19});
  axis.setInterval({start:4,end:34,stopAxisAfter:true});series.appendSamples({x:[42],y:[3]});
  assert.deepEqual(axis.getIntervalRestrictions(),{startMin:3,intervalMax:31});assert.deepEqual(states[1],{curStart:4,curEnd:34,dataMin:3,dataMax:42});
 }finally{chart.dispose();}
});

test('callback errors propagate without replacing stored restrictions or changing axis state',()=>{
 const {chart,axis}=fixture();
 try{
  const error=new Error('caller callback'),callback=()=>{throw error;};axis.setInterval({start:1,end:11,stopAxisAfter:true}).setIntervalRestrictions(callback);
  assert.throws(()=>axis.getIntervalRestrictions(),e=>e===error);assert.deepEqual(axis.getInterval(),{start:1,end:11});assert.equal(axis.getStopped(),true);
  axis.setIntervalRestrictions(undefined);assert.equal(axis.getIntervalRestrictions(),undefined);
 }finally{chart.dispose();}
});

test('regressive auto-scrolling keeps the existing immediate target arithmetic',()=>{
 const {chart,axis,series}=fixture();
 try{
  axis.setAnimationScroll(false).setScrollMargins(false).setScrollStrategy(AxisScrollStrategies.regressive).setInterval({start:0,end:10,stopAxisAfter:false});
  series.appendSamples({x:[-12,2],y:[1,2]});chart.renderNow();assert.deepEqual(axis.getInterval(),{start:-12,end:-2});
 }finally{chart.dispose();}
});
