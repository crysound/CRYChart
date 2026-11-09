import test from 'node:test';
import assert from 'node:assert/strict';
import {ChartXY,Chart3D,Polar} from '../src/chart.js';
import {DataSetXY} from '../src/core/data.js';
function sourceSeries(chart:ChartXY,axisY=chart.axisY){
 return chart.addLineSeries({axisY}).setDataSet(new DataSetXY({schema:{
  xValues:{storage:Float64Array,pattern:'progressive'},
  yValues:{storage:Float32Array,pattern:null},renderYValues:{storage:Float32Array,pattern:null},
 }})).setDataMapping({x:'xValues',y:'renderYValues'});
}
test('internal XY omitted-fit default reads actual empty bound Source mapping and schema',()=>{
 const chart=new ChartXY();try{
  assert.equal(chart.getAxisDefaultFitStop(chart.axisX),true);
  assert.equal(chart.getAxisDefaultFitStop(chart.axisY),true);
  const series=sourceSeries(chart);assert.equal(series.getSampleCount(),0);
  assert.equal(chart.getAxisDefaultFitStop(chart.axisX),false);
  assert.equal(chart.getAxisDefaultFitStop(chart.axisY),true);
 }finally{chart.dispose();}
});
test('the mapped progressive dimension can be Y without an axis-direction default',()=>{
 const chart=new ChartXY();try{
  chart.addLineSeries().setDataSet(new DataSetXY({schema:{
   signal:{storage:Float32Array,pattern:null},clock:{storage:Float64Array,pattern:'progressive'},
  }})).setDataMapping({x:'signal',y:'clock'});
  assert.equal(chart.getAxisDefaultFitStop(chart.axisX),true);
  assert.equal(chart.getAxisDefaultFitStop(chart.axisY),false);
 }finally{chart.dispose();}
});
test('actual secondary binding and disposal decide the participating schema',()=>{
 const chart=new ChartXY();try{
  const other=chart.addAxisY({opposite:true});const series=sourceSeries(chart,other).setDataMapping({x:'yValues',y:'xValues'});
  assert.equal(chart.getAxisDefaultFitStop(chart.axisY),true);
  assert.equal(chart.getAxisDefaultFitStop(other),false);
  series.dispose();assert.equal(chart.getAxisDefaultFitStop(other),true);
 }finally{chart.dispose();}
});
test('empty and hidden but still bound non-disposed series keep actual schema metadata',()=>{
 const chart=new ChartXY();try{
  const series=sourceSeries(chart).setVisible(false);assert.equal(series.getSampleCount(),0);
  assert.equal(chart.getAxisDefaultFitStop(chart.axisX),false);
  series.clear();assert.equal(chart.getAxisDefaultFitStop(chart.axisX),false);
  series.setDataMapping({x:'yValues',y:'renderYValues'});assert.equal(chart.getAxisDefaultFitStop(chart.axisX),true);
 }finally{chart.dispose();}
});
test('mixed and unsupported pattern contracts explicitly opt out rather than guessing',()=>{
 const chart=new ChartXY();try{
  sourceSeries(chart);const generic=chart.addLineSeries().setDataSet(new DataSetXY({schema:{u:{pattern:null},v:{pattern:null}}})).setDataMapping({x:'u',y:'v'});
  assert.equal(chart.getAxisDefaultFitStop(chart.axisX),undefined);
  generic.dispose();assert.equal(chart.getAxisDefaultFitStop(chart.axisX),false);
  const reverse=chart.addLineSeries().setDataSet(new DataSetXY({schema:{u:{pattern:'regressive'},v:{pattern:null}}})).setDataMapping({x:'u',y:'v'});
  assert.equal(chart.getAxisDefaultFitStop(chart.axisX),undefined);reverse.dispose();
 }finally{chart.dispose();}
});
test('the policy does not replace independent3D Polar or foreign-axis semantics',()=>{
 const xy=new ChartXY(),foreign=new ChartXY(),three=new Chart3D(),polar=new Polar();try{
  assert.equal(xy.getAxisDefaultFitStop(foreign.axisX),undefined);
  assert.equal(three.getAxisDefaultFitStop(three.axisX),undefined);
  assert.equal(polar.getAxisDefaultFitStop(polar.axisX),undefined);
 }finally{xy.dispose();foreign.dispose();three.dispose();polar.dispose();}
});
