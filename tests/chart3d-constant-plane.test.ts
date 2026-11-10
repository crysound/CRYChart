import test from 'node:test';
import assert from 'node:assert/strict';
import {Chart3D} from '../src/chart.js';
class PacketProbe3D extends Chart3D {
  packets:any[]=[];
  constructor(){super();Object.defineProperty(this,'gpu3d',{value:{render:(packets:any[])=>{this.packets=packets;},dispose(){},stats:{}},writable:true});}
  flush(){this.renderData([]);return this.packets;}
}
function effectiveXYZ(packet:any){const values=packet.positions.slice();for(const [index,dimension]of ['x','y','z'].entries()){const fixed=packet.constantCoordinates?.[dimension];if(fixed!==undefined)for(let i=index;i<values.length;i+=3)values[i]=fixed;}return values;}
function planeFixture(uncached=false,zValues=[10,10,10]){
  const chart=new PacketProbe3D();if(uncached)(chart as any).getConstantCoordinates=()=>({});
  chart.resize(800,500);chart.axisX.setInterval({start:0,end:100});chart.axisY.setInterval({start:-10,end:10});chart.axisZ.setInterval({start:0,end:100});
  const line=chart.addPointLineAreaSeries({schema:{x:{storage:Float64Array},y:{storage:Float64Array},z:{storage:Float64Array}}}).setPointSize(0);
  line.appendSamples({x:[1,30,99],y:[-2,8,-1],z:zValues});return{chart,line};
}
test('waterfall planes preserve exact Float32 geometry while time-axis changes reuse XY projection',()=>{
 const fast=planeFixture(),control=planeFixture(true);
 try{
  const first=fast.chart.flush()[0],positions=first.positions,revision=first.revision;
  assert.deepEqual(effectiveXYZ(first),effectiveXYZ(control.chart.flush()[0]));
  for(const [start,end]of[[25,125],[100,1000],[-50,50]]){
   fast.chart.axisZ.setInterval({start,end});control.chart.axisZ.setInterval({start,end});
   const actual=fast.chart.flush()[0],expected=control.chart.flush()[0];
   assert.equal(actual.positions,positions,'An unchanged plane must reuse every cached XY vertex');assert.equal(actual.revision,revision);
   assert.deepEqual(effectiveXYZ(actual),expected.positions,'The shader must receive the same Float32 XYZ as full CPU normalization');
   assert.deepEqual(fast.line.getSample(1),{x:30,y:8,z:10});
  }
  fast.chart.axisZ.setInverted(true);control.chart.axisZ.setInverted(true);assert.deepEqual(effectiveXYZ(fast.chart.flush()[0]),control.chart.flush()[0].positions);
  fast.chart.axisY.setInterval({start:-20,end:20});control.chart.axisY.setInterval({start:-20,end:20});const rebuilt=fast.chart.flush()[0];assert.notEqual(rebuilt.positions,positions);assert.deepEqual(effectiveXYZ(rebuilt),control.chart.flush()[0].positions);
 }finally{fast.chart.dispose();control.chart.dispose();}
});
test('nonconstant and missing Z values keep the full normalization and preserve gaps',()=>{
 for(const z of[[10,10,11],[10,NaN,10]]){
  const {chart}=planeFixture(false,z);
  try{const before=chart.flush()[0];assert.deepEqual(before.constantCoordinates,{});chart.axisZ.setInterval({start:10,end:110});const after=chart.flush()[0];assert.notEqual(after.positions,before.positions);if(Number.isNaN(z[1]))assert(Number.isNaN(after.positions[5]));}finally{chart.dispose();}
 }
});

test('actual waterfall time-X planes reuse geometry and retain exact normalized XYZ',()=>{
 const fast=planeFixture(),control=planeFixture(true),source={x:[100,100,100],y:[-2,8,-1],z:[1,30,99]};
 try{
  for(const item of[fast,control])item.line.clear().appendSamples(source);
  const before=fast.chart.flush()[0],positions=before.positions;
  for(const interval of[{start:50,end:150},{start:1,end:1000}]){
   for(const item of[fast,control])item.chart.axisX.setInterval(interval);
   const after=fast.chart.flush()[0];assert.equal(after.positions,positions);assert.equal(after.revision,before.revision);assert.deepEqual(effectiveXYZ(after),control.chart.flush()[0].positions);
  }
  for(const item of[fast,control]){item.chart.axisX.type='logarithmic';item.chart.axisX.setInterval({start:1,end:1000});item.chart.axisX.setInverted(true);}
  assert.deepEqual(effectiveXYZ(fast.chart.flush()[0]),control.chart.flush()[0].positions);assert.deepEqual(fast.line.getSample(1),{x:100,y:8,z:30});
 }finally{fast.chart.dispose();control.chart.dispose();}
});
