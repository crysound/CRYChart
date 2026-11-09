import test from 'node:test';
import assert from 'node:assert/strict';
import {DataSetXY} from '../src/core/data';
import {visibleSourceSegments} from '../src/viewport';

test('source visibility retains every intersecting segment at inverted, exact and empty viewport edges',()=>{
  const data=new DataSetXY().appendSamples({x:[-10,-4,0,3,9,14],y:[1,2,3,4,5,6]});
  const range=(start:number,end:number)=>visibleSourceSegments(data,'x',{start,end},1e12,0);
  assert.deepEqual(range(1,2),{first:2,end:3});assert.deepEqual(range(2,1),{first:2,end:3});
  assert.deepEqual(range(0,3),{first:1,end:4});assert.deepEqual(range(20,30),{first:5,end:5});assert.deepEqual(range(-30,-20),{first:0,end:0});
  for(let left=-15;left<=17;left+=.7){const right=left+2.9,result=range(left,right)!;for(let i=0;i<5;i++){const intersects=data.getValue('x',i+1)!>=left&&data.getValue('x',i)!<=right;if(intersects)assert.ok(i>=result.first&&i<result.end);}}
});

test('visibility uses absolute ring indices and exact affine time without materializing X',()=>{
  const data=new DataSetXY({schema:{x:{storage:Float64Array,auto:true},y:{}}}).setMaxSampleCount(1000);
  for(let batch=0;batch<10;batch++)data.appendSamples({y:new Float64Array(170)},{start:1e12+batch*170,step:1});
  const result=visibleSourceSegments(data,'x',{start:1e12+1500.1,end:1e12+1510.1},1000,1)!;
  assert.deepEqual(result,{first:1500,end:1511});assert.equal(data.getColumnRuns('x').kind,'affine');assert.equal(data.getStorageStats().snapshotBytes,0);
});

test('nonmonotonic or nonfinite hidden X prevents source visibility optimization',()=>{
  const data=new DataSetXY().appendSamples({x:[NaN,1,2,3,4,5],y:[1,2,3,4,5,6]});
  assert.equal(visibleSourceSegments(data,'x',{start:3,end:4},800,1),undefined);
  data.clear().appendSamples({x:[0,1,1,3],y:[1,2,3,4]});assert.equal(visibleSourceSegments(data,'x',{start:2,end:3},800,1),undefined);
  data.clear().appendSamples({x:[0,3,2,4],y:[1,2,3,4]});assert.equal(visibleSourceSegments(data,'x',{start:3,end:4},800,1),undefined);
});
