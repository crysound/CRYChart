import test from 'node:test';
import assert from 'node:assert/strict';
import {ChartXY,Chart3D,Polar} from '../src/chart.js';
import {ColorRGBA,SolidFill,SolidLine,emptyFill} from '../src/core/styles.js';
const fill=new SolidFill({color:ColorRGBA(23,45,67,255)});
const stroke=(thickness:number,fillStyle:any=fill)=>new SolidLine({thickness,fillStyle});
const addPoint=(chart:ChartXY,axisY=chart.axisY)=>chart.addPointSeries({axisY}).setPointSize(7).setPointFillStyle(fill).setPointStrokeStyle(stroke(1)).add([{x:1,y:1}]);
test('internal XY default footprint includes the actual marker outline and visible line halfwidth',()=>{
 const chart=new ChartXY();try{
  addPoint(chart);assert.deepEqual(chart.getAxisDefaultGeometryMargins(chart.axisX),{start:4,end:4});assert.deepEqual(chart.getAxisDefaultGeometryMargins(chart.axisY),{start:4,end:4});
  chart.addLineSeries().setStrokeStyle(stroke(12)).add([{x:0,y:0},{x:2,y:2}]);assert.deepEqual(chart.getAxisDefaultGeometryMargins(chart.axisX),{start:6,end:6});
 }finally{chart.dispose();}
});
test('empty and transparent styles do not reserve ghost margins but a visible outline still does',()=>{
 const chart=new ChartXY();try{
  const point=addPoint(chart).setPointSize(20).setPointFillStyle(emptyFill).setPointStrokeStyle(stroke(20,emptyFill));
  chart.addLineSeries().setStrokeStyle(stroke(30,emptyFill)).add([{x:0,y:0}]);assert.deepEqual(chart.getAxisDefaultGeometryMargins(chart.axisX),{start:0,end:0});
  point.setPointStrokeStyle(stroke(2));assert.deepEqual(chart.getAxisDefaultGeometryMargins(chart.axisX),{start:11,end:11});
 }finally{chart.dispose();}
});
test('hidden disposed and cleared series have no default footprint',()=>{
 const chart=new ChartXY();try{
  const point=addPoint(chart);point.setVisible(false);assert.deepEqual(chart.getAxisDefaultGeometryMargins(chart.axisX),{start:0,end:0});
  point.setVisible(true).clear();assert.deepEqual(chart.getAxisDefaultGeometryMargins(chart.axisX),{start:0,end:0});point.add([{x:1,y:1}]);assert.deepEqual(chart.getAxisDefaultGeometryMargins(chart.axisX),{start:4,end:4});
  point.dispose();assert.deepEqual(chart.getAxisDefaultGeometryMargins(chart.axisX),{start:0,end:0});
 }finally{chart.dispose();}
});
test('a secondary axis only receives the geometry of actual series bound to it',()=>{
 const chart=new ChartXY();try{
  const other=chart.addAxisY({opposite:true});addPoint(chart,other);assert.deepEqual(chart.getAxisDefaultGeometryMargins(chart.axisY),{start:0,end:0});assert.deepEqual(chart.getAxisDefaultGeometryMargins(other),{start:4,end:4});assert.deepEqual(chart.getAxisDefaultGeometryMargins(chart.axisX),{start:4,end:4});
 }finally{chart.dispose();}
});
test('unknown per-point sizes opt out instead of scanning or substituting constant size',()=>{
 const chart=new ChartXY();try{
  const point=addPoint(chart).setIndividualPointSizeEnabled(true);assert.equal(chart.getAxisDefaultGeometryMargins(chart.axisX),undefined);point.setIndividualPointSizeEnabled(false);assert.deepEqual(chart.getAxisDefaultGeometryMargins(chart.axisX),{start:4,end:4});
 }finally{chart.dispose();}
});
test('nonlinear axes and the independent3D/Polar coordinate systems are excluded',()=>{
 const xy=new ChartXY({defaultAxisX:{type:'logarithmic'}}),three=new Chart3D(),polar=new Polar();try{
  assert.equal(xy.getAxisDefaultGeometryMargins(xy.axisX),undefined);assert.equal(three.getAxisDefaultGeometryMargins(three.axisX),undefined);assert.equal(polar.getAxisDefaultGeometryMargins(polar.axisY),undefined);
 }finally{xy.dispose();three.dispose();polar.dispose();}
});
