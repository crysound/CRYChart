import test from 'node:test';
import assert from 'node:assert/strict';
import {Chart3D, Polar} from '../src/chart.js';
import {Pie} from '../src/specialty.js';

function context():CanvasRenderingContext2D {
  return new Proxy({measureText:(value:string)=>({width:value.length*7})},{get:(target,key)=>key in target?(target as any)[key]:()=>{},set:(target,key,value)=>{(target as any)[key]=value;return true;}}) as unknown as CanvasRenderingContext2D;
}

test('Pie public radius is a percentage, including fractional percent and completely hollow endpoint',()=>{
  const pie=new Pie({headless:true,width:500,height:320});pie.addSlice('A',2);pie.addSlice('B',3);
  for(const value of[0,.5,35,62,100]){assert.equal(pie.setInnerRadius(value),pie);assert.equal(pie.getInnerRadius(),value);assert.equal(pie.innerRadius,value/100);}
  pie.render(context());assert.equal(pie.activateAt({x:250,y:160}),undefined);
  assert.throws(()=>pie.setInnerRadius(NaN),/percentage/);assert.equal(pie.getInnerRadius(),100);
  assert.deepEqual(pie.getSlices().map(slice=>slice.getValue()),[2,3]);pie.dispose();
});

test('Pie explosion has explicit boolean state and default mutual exclusion without changing values',()=>{
  const pie=new Pie({headless:true}),a=pie.addSlice('A',2),b=pie.addSlice('B',3);
  assert.equal(pie.getMultipleSliceExplosion(),false);assert.equal(pie.getSliceExplosionOffset(),20);
  a.setExploded(true);b.setExploded(true);assert.deepEqual([a.getExploded(),b.getExploded()],[false,true]);
  a.setExploded(false);assert.deepEqual([a.getExploded(),b.getExploded()],[false,true]);
  pie.setMultipleSliceExplosion(true);a.setExploded(true);assert.deepEqual([a.getExploded(),b.getExploded()],[true,true]);
  b.setExploded(false).setExploded(false);assert.deepEqual([a.getExploded(),b.getExploded()],[true,false]);
  assert.deepEqual([a.getValue(),b.getValue()],[2,3]);pie.dispose();
});

test('Pie chart disposal owns every live slice and the native cursor exactly once',()=>{
  const pie=new Pie({headless:true}),slices=[pie.addSlice('A',2),pie.addSlice('B',3)],cursor=pie.getCursor();let count=0;
  pie.onDispose(()=>count++);pie.dispose().dispose();assert.equal(count,1);
  assert.ok(slices.every(slice=>slice.isDisposed()));assert.equal(cursor.isDisposed(),true);assert.equal(pie.getSeries().length,0);
});

test('Pie native hit reports source category, value and relative value; undefined mode disables it',()=>{
  class Probe extends Pie {hover(index:number){this.render(context());this.hovered=this.hits[index];this.onHoverResolved(this.hovered);}}
  const pie=new Probe({headless:true});pie.addSlice('Alpha',2);pie.addSlice('Beta',3);pie.addSlice('Gamma',5);const calls:any[]=[];
  pie.setCustomCursor(event=>calls.push(event));pie.hover(1);
  const hit=calls.at(-1).hits[0];assert.equal(hit.category,'Beta');assert.equal(hit.value,3);assert.equal(hit.relativeValue,.3);assert.equal(hit.slice,pie.getSlices()[1]);
  assert.equal(pie.getCursor().getVisible(),false);pie.setCursorMode(undefined);pie.hover(1);assert.deepEqual(calls.at(-1).hits,[]);
  pie.setCustomCursor(undefined);assert.equal(pie.getCursor().getVisible(),true);pie.dispose();
});

test('Surface public start/step/end distinguish extent from final retained sample and remember an overridden step',()=>{
  const chart=new Chart3D(),surface=chart.addSurfaceGridSeries({columns:5,rows:4});
  surface.setStart({x:2,z:3}).setStep({x:2,z:3});
  assert.deepEqual(surface.getStart(),{x:2,z:3});assert.deepEqual(surface.getStep(),{x:2,z:3});assert.deepEqual(surface.getEnd(),{x:12,z:15});
  assert.deepEqual([surface.getXMin(),surface.getXMax(),surface.getZMin(),surface.getZMax()],[2,10,3,12]);
  surface.setEnd({x:22,z:23}).setStep({x:7,z:9});assert.deepEqual(surface.getStep(),{x:4,z:5});
  surface.setEnd(undefined);assert.deepEqual(surface.getStep(),{x:7,z:9});
  const copy=surface.getStart();copy.x=999;assert.equal(surface.getStart().x,2);chart.dispose();
});

test('Surface partial update preserves untouched values, independent extrema and NaN holes',()=>{
  const chart=new Chart3D(),surface=chart.addSurfaceGridSeries({columns:5,rows:4});
  const values=Array.from({length:4},(_,row)=>Array.from({length:5},(_,col)=>row*2+col));surface.invalidateHeightMap(values);
  surface.invalidateHeightMap({iColumn:2,iRow:1,values:[[18,19],[NaN,-0]]});
  assert.deepEqual([surface.getYMin(),surface.getYMax()],[-0,19]);
  const actual=surface.getGeometry().positions;
  for(let row=0;row<4;row++)for(let col=0;col<5;col++){
    const expected=row===1&&col===2?18:row===1&&col===3?19:row===2&&col===2?NaN:row===2&&col===3?-0:row*2+col;
    assert.ok(Object.is(actual[(row*5+col)*3+1],expected));
  }
  assert.deepEqual(values[1],[2,3,4,5,6]);chart.dispose();
});

test('Surface chart cursor solves retained XYZ in the actual camera projection and respects enable/clear',()=>{
  const chart=new Chart3D();chart.resize(700,600);chart.setCameraAutomaticFittingEnabled(false).setCameraLocation({x:2,y:1.5,z:3});
  for(const axis of[chart.axisX,chart.axisY,chart.axisZ])axis.setInterval({start:0,end:10});
  const surface=chart.addSurfaceGridSeries({columns:5,rows:4}).setStep({x:2,z:2});surface.invalidateHeightMap(Array.from({length:4},(_,row)=>Array.from({length:5},(_,col)=>row*2+col)));
  const point=chart.translateCoordinate({x:4,y:4,z:2},chart.coordsAxis,chart.coordsClient),hit=chart.solveNearest(point)[0];
  assert.deepEqual([hit.x,hit.y,hit.z,hit.column,hit.row],[4,4,2,2,1]);assert.equal(hit.series,surface);
  surface.setCursorEnabled(false);assert.deepEqual(chart.solveNearest(point),[]);surface.setCursorEnabled(true).clear();assert.deepEqual(chart.solveNearest(point),[]);chart.dispose();
});

test('Polar heatmap public hit uses angular/radial nearest nodes and returns valid zero and NaN distinctly',()=>{
  const chart=new Polar();chart.resize(700,600);chart.getRadialAxis().setNorth(0).setClockwise(true);chart.getAmplitudeAxis().setInterval({start:0,end:35});
  const surface=chart.addHeatmapSeries({sectors:8,annuli:3,amplitudeStart:5,amplitudeStep:10,dataOrder:'annuli'});
  surface.invalidateIntensityValues(Array.from({length:3},(_,row)=>Array.from({length:8},(_,col)=>row*20+col)));
  const query=(angle:number,amplitude:number)=>surface.solveNearest(chart.translateCoordinate({angle,amplitude},chart.coordsClient));
  const low=query(22.499,9.999),high=query(22.501,10.001);assert.deepEqual([low.sector,low.annulus,low.intensity],[0,0,0]);assert.deepEqual([high.sector,high.annulus,high.intensity],[1,1,21]);
  assert.equal(chart.solveNearest(chart.translateCoordinate({angle:90,amplitude:15},chart.coordsClient))[0]?.series,surface);
  surface.invalidateIntensityValues({iSector:2,iAnnulus:1,values:[[NaN]]});assert.ok(Number.isNaN(query(90,15).intensity));
  surface.clear();assert.ok(Number.isNaN(query(90,15).intensity));assert.ok([...surface.data].every(Number.isNaN));chart.dispose();
});
