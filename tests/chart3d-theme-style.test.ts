import test from 'node:test';
import assert from 'node:assert/strict';
import {Chart3D,ChartXY} from '../src/chart.js';
import {ColorRGBA,SolidFill,SolidLine,TriangulatedPoints3D} from '../src/core/styles.js';
// Observed through Native8.2 production Theme callbacks, not Native implementation.
const colors=[[111,97,151],[194,65,12],[22,101,52]] as const;
const fill=(i:number)=>{const c=colors[i%colors.length]!;return new SolidFill({color:ColorRGBA(c[0],c[1],c[2],255)});};
const rgba=(value:any)=>{const c=value.getColor();return[c.getR(),c.getG(),c.getB(),c.getA()];};
function observedTheme(calls:Array<[string,number]>){return{lineSeries3DStrokeStyle:(i:number)=>{calls.push(['line',i]);return new SolidLine({thickness:2,fillStyle:fill(i)});},pointSeries3DPointStyle:(i:number)=>{calls.push(['point',i]);return new TriangulatedPoints3D({size:10,fillStyle:fill(i)});}};}
test('actual Trajectory line0 and endpoint1 consume the separate observed3D theme palettes',()=>{
 const calls:Array<[string,number]>=[],chart=new Chart3D({legend:{visible:false},theme:observedTheme(calls)});try{
  const line=chart.addLineSeries(),endpoint=chart.addPointSeries();
  assert.equal(line.getStrokeStyle().getThickness(),2);assert.deepEqual(rgba(line.getStrokeStyle().getFillStyle()),[111,97,151,255]);
  assert.equal(endpoint.getPointStyle().getSize(),10);assert.deepEqual(rgba(endpoint.getPointStyle().getFillStyle()),[194,65,12,255]);assert.deepEqual(calls,[['line',0],['point',1]]);
 }finally{chart.dispose();}
});
test('public automaticColorIndex selects3D palette entries without changing series order',()=>{
 const calls:Array<[string,number]>=[],chart=new Chart3D({theme:observedTheme(calls)});try{
  const line=chart.addLineSeries({automaticColorIndex:2}),point=chart.addPointSeries({automaticColorIndex:0});
  assert.deepEqual(rgba(line.getStrokeStyle().getFillStyle()),[22,101,52,255]);assert.deepEqual(rgba(point.getPointStyle().getFillStyle()),[111,97,151,255]);assert.deepEqual(calls,[['line',2],['point',0]]);
 }finally{chart.dispose();}
});
test('documented concrete3D theme styles also reach actual public series styles',()=>{
 const stroke=new SolidLine({thickness:3.5,fillStyle:fill(2)}),pointStyle=new TriangulatedPoints3D({size:12,fillStyle:fill(0)}),chart=new Chart3D({theme:{lineSeries3DStrokeStyle:stroke,pointSeries3DPointStyle:pointStyle}});try{
  assert.equal(chart.addLineSeries().getStrokeStyle(),stroke);const point=chart.addPointSeries();assert.equal(point.getPointStyle().getSize(),12);assert.deepEqual(rgba(point.getPointStyle().getFillStyle()),[111,97,151,255]);
 }finally{chart.dispose();}
});
test('XY series keep existing2D theme fields and never invoke3D factories',()=>{
 const stroke=new SolidLine({thickness:7,fillStyle:fill(1)}),chart=new ChartXY({theme:{lineSeriesStrokeStyle:stroke,pointSeriesFillStyle:fill(2),lineSeries3DStrokeStyle:()=>{throw Error('3D line style invoked by XY');},pointSeries3DPointStyle:()=>{throw Error('3D point style invoked by XY');}}});try{
  assert.equal(chart.addLineSeries().getStrokeStyle(),stroke);const point=chart.addPointSeries();assert.equal(point.getPointSize(),7);assert.deepEqual(rgba(point.getPointFillStyle()),[22,101,52,255]);
 }finally{chart.dispose();}
});
