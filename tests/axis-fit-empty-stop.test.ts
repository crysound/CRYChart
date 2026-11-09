import test from 'node:test';
import assert from 'node:assert/strict';
import {ChartXY} from '../src/chart.js';
import {DataSetXY} from '../src/core/data.js';
function boundGeneric(chart:ChartXY){
 return chart.addLineSeries().setDataSet(new DataSetXY({schema:{
  u:{storage:Float64Array,pattern:null},v:{storage:Float32Array,pattern:null},
 }})).setDataMapping({x:'u',y:'v'});
}
const interval={start:0,end:10};
test('public fit with omitted stop on empty generic bound dimensions stops without changing interval',()=>{
 const chart=new ChartXY();try{
  const series=boundGeneric(chart);assert.equal(series.getSampleCount(),0);
  for(const axis of[chart.axisX,chart.axisY]){
   axis.setStopped(false);assert.deepEqual(axis.getInterval(),interval);
   axis.fit();assert.equal(axis.getStopped(),true);assert.deepEqual(axis.getInterval(),interval);
  }
 }finally{chart.dispose();}
});
test('explicit true on empty axes applies even when no bounds exist and strategy is undefined',()=>{
 const chart=new ChartXY();try{
  boundGeneric(chart);
  for(const axis of[chart.axisX,chart.axisY]){
   axis.setScrollStrategy(undefined);axis.setStopped(false);axis.fit(false,true);
   assert.equal(axis.getStopped(),true);assert.deepEqual(axis.getInterval(),interval);
  }
 }finally{chart.dispose();}
});
test('explicit false resumes an already stopped empty axis and preserves the requested interval',()=>{
 const chart=new ChartXY();try{
  boundGeneric(chart);
  for(const axis of[chart.axisX,chart.axisY]){
   axis.setInterval({start:-5,end:15,stopAxisAfter:true});assert.equal(axis.getStopped(),true);
   axis.fit(false,false);assert.equal(axis.getStopped(),false);assert.deepEqual(axis.getInterval(),{start:-5,end:15});
  }
 }finally{chart.dispose();}
});
test('the original empty Source schema observes transient Y stop then deferred auto following',()=>{
 const chart=new ChartXY();try{
  const series=chart.addLineSeries().setDataSet(new DataSetXY({schema:{
   xValues:{storage:Float64Array,pattern:'progressive'},yValues:{storage:Float32Array,pattern:null},
   renderYValues:{storage:Float32Array,pattern:null},
  }})).setDataMapping({x:'xValues',y:'renderYValues'});
  assert.equal(series.getSampleCount(),0);
  chart.axisX.setInterval({stopAxisAfter:false}).fit();chart.axisY.fit();
  assert.equal(chart.axisX.getStopped(),false);assert.equal(chart.axisY.getStopped(),true);
  assert.deepEqual(chart.axisX.getInterval(),interval);assert.deepEqual(chart.axisY.getInterval(),interval);
  series.getDataSet().replaceSamples({xValues:new Float64Array([1,2]),yValues:new Float32Array([3,4]),renderYValues:new Float32Array([3,4])});
  chart.axisX.updateAuto();chart.axisY.updateAuto();
  // Native traces prove transient stop and later auto release; first-bounds dispatch is the bounded implementation candidate, not a claimed Native timing constant.
  assert.deepEqual(chart.axisX.getInterval(),{start:1,end:2});assert.deepEqual(chart.axisY.getInterval(),{start:3,end:4});
  assert.equal(chart.axisY.getStopped(),false);
  series.getDataSet().replaceSamples({xValues:new Float64Array([2,4]),yValues:new Float32Array([-7,8]),renderYValues:new Float32Array([-7,8])});
  chart.axisX.updateAuto();chart.axisY.updateAuto();
  assert.deepEqual(chart.axisX.getInterval(),{start:2,end:4});assert.deepEqual(chart.axisY.getInterval(),{start:-7,end:8});
  assert.equal(chart.axisY.getStopped(),false);
 }finally{chart.dispose();}
});
test('fit explicit stop overrides a defaultInterval stop flag and omitted generic fit stops',()=>{
 const chart=new ChartXY();try{
  const series=boundGeneric(chart);
  chart.axisY.setDefaultInterval({start:-2,end:12,stopAxisAfter:false});chart.axisY.fit(false,true);
  assert.equal(chart.axisY.getStopped(),true);assert.deepEqual(chart.axisY.getInterval(),{start:-2,end:12});
  chart.axisY.setDefaultInterval({start:-2,end:12,stopAxisAfter:true});chart.axisY.fit(false,false);
  assert.equal(chart.axisY.getStopped(),false);assert.deepEqual(chart.axisY.getInterval(),{start:-2,end:12});
  series.getDataSet().replaceSamples({u:new Float64Array([1,2]),v:new Float32Array([3,4])});
  chart.axisY.updateAuto();assert.deepEqual(chart.axisY.getInterval(),{start:3,end:4});assert.equal(chart.axisY.getStopped(),false);
  chart.axisY.setDefaultInterval({start:-2,end:12,stopAxisAfter:false});chart.axisY.fit();
  assert.equal(chart.axisY.getStopped(),true);assert.deepEqual(chart.axisY.getInterval(),{start:-2,end:12});
 }finally{chart.dispose();}
});
test('existing nonempty raw bounds and explicit fit-stop paths stay independent of empty-stop handling',()=>{
 const chart=new ChartXY();try{
  boundGeneric(chart).getDataSet().replaceSamples({u:new Float64Array([1,2]),v:new Float32Array([3,4])});
  chart.axisX.fit(false,false);chart.axisY.fit(false,true);
  assert.equal(chart.axisX.getStopped(),false);assert.equal(chart.axisY.getStopped(),true);
  assert.deepEqual(chart.axisX.getInterval(),{start:1,end:2});assert.deepEqual(chart.axisY.getInterval(),{start:3,end:4});
  chart.axisX.fit(false,true);chart.axisY.fit(false,false);
  assert.equal(chart.axisX.getStopped(),true);assert.equal(chart.axisY.getStopped(),false);
 }finally{chart.dispose();}
});
