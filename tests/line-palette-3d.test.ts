import test from 'node:test';
import assert from 'node:assert/strict';
import {ColorRGBA,LUT} from '../src/core/styles.js';
import {colorMappedLine3D} from '../src/line-palette-3d.js';
import {ChartXY} from '../src/chart.js';

test('3D palette transitions interpolate all three coordinates without changing raw value boundaries',()=>{
  const lut=new LUT({steps:[{value:0,color:ColorRGBA(255,0,0)},{value:5,color:ColorRGBA(0,255,0)},{value:10,color:ColorRGBA(0,0,255)}]});
  const p=colorMappedLine3D(new Float32Array([0,0,0,10,20,30]),new Float64Array([0,10]),lut);assert.deepEqual([...p.positions],[0,0,0,5,10,15,5,10,15,10,20,30]);assert.deepEqual([...p.colors.slice(4,12)],[0,1,0,1,0,1,0,1]);
  const step=colorMappedLine3D(new Float32Array([0,0,0,10,20,30]),new Float64Array([0,10]),lut.setInterpolation(false));assert.deepEqual([...step.colors.slice(0,8)],[1,0,0,1,1,0,0,1]);assert.deepEqual([...step.colors.slice(8)],[0,1,0,1,0,1,0,1]);
});

test('3D palette data gaps remain gaps and inconsistent lengths fail explicitly',()=>{
  const lut=new LUT({steps:[{value:0,color:ColorRGBA(255,0,0)}]}),p=colorMappedLine3D(new Float32Array([0,0,0,1,NaN,2,3,4,5,6,7,8]),[0,1,2,3],lut);assert.ok(Number.isNaN(p.positions[0]));assert.deepEqual([...p.positions.slice(-6)],[3,4,5,6,7,8]);assert.throws(()=>colorMappedLine3D(new Float32Array(6),[1],lut),/match/);
});

test('public XY extrema and last point reflect retained raw samples including a final extreme',()=>{
  const c=new ChartXY(),s=c.addLineSeries().setMaxSampleCount(3).add([{x:0,y:7},{x:1,y:NaN},{x:2,y:-3},{x:3,y:11}]);assert.equal(s.getXMin(),1);assert.equal(s.getXMax(),3);assert.equal(s.getYMin(),-3);assert.equal(s.getYMax(),11);assert.deepEqual(s.getLastPoint(),{x:3,y:11});s.clear();assert.equal(s.getLastPoint(),undefined);assert.equal(s.getXMax(),undefined);c.dispose();
});
