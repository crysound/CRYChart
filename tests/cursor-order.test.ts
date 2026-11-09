import test from 'node:test';
import assert from 'node:assert/strict';
import {ChartXY} from '../src/chart';
import {DataSetXY} from '../src/core/data';
import {getColumnOrder} from '../src/data-order';

test('cursor lookup in a full streaming ring examines only newly appended X values',()=>{
  const data=new DataSetXY().setMaxSampleCount(100_000),chart=new ChartXY(),line=chart.addLineSeries({dataSet:data});
  data.appendSamples({x:Float64Array.from({length:100_000},(_,i)=>i),y:Float64Array.from({length:100_000},(_,i)=>i*2)});
  assert.deepEqual(line.findNearestX(99_993.2),{x:99_993,y:199_986});
  let scans=getColumnOrder(data,'x').scannedSamples;
  for(let frame=0;frame<20;frame++){
    for(const count of [13,57,100]){const start=data.getNextSampleIndex();data.appendSamples({x:Float64Array.from({length:count},(_,i)=>start+i),y:Float64Array.from({length:count},(_,i)=>(start+i)*2)});}
    const expected=data.getNextSampleIndex()-5;
    assert.deepEqual(line.findNearestX(expected+.1),{x:expected,y:expected*2});
    const order=getColumnOrder(data,'x');assert.equal(order.scannedSamples-scans,170);assert.equal(order.rebuilds,1);scans=order.scannedSamples;
  }
  chart.dispose();data.dispose();
});

test('implicit time cursor does not materialize X and preserves exact batch arithmetic',()=>{
  const data=new DataSetXY({schema:{x:{storage:Float64Array,auto:true},y:{storage:Float64Array}}}).setMaxSampleCount(48_000),chart=new ChartXY(),line=chart.addLineSeries({dataSet:data});
  data.appendSamples({y:Float64Array.from({length:48_000},(_,i)=>i)},{start:1_000_000,step:1000/48_000});
  const expected=data.getValue('x',39_857)!;assert.deepEqual(line.findNearestX(expected),{x:expected,y:39_857});
  assert.equal(data.getColumnRuns('x').kind,'affine');assert.equal(data.getStorageStats().snapshotBytes,0);assert.equal(getColumnOrder(data,'x').scannedSamples,0);
  chart.dispose();data.dispose();
});

test('cursor refuses nonfinite targets and all-invalid X, while reversed finite data remains searchable',()=>{
  const chart=new ChartXY(),line=chart.addLineSeries();line.addArraysXY([NaN,Infinity,-Infinity],[1,2,3]);
  assert.equal(line.findNearestX(0),undefined);assert.equal(line.findNearestX(NaN),undefined);assert.equal(line.findNearestX(Infinity),undefined);
  line.clear().addArraysXY([10,4,8,NaN,3],[1,2,3,4,5]);assert.deepEqual(line.findNearestX(4.1),{x:4,y:2});
  chart.dispose();
});
