import test from 'node:test';
import assert from 'node:assert/strict';
import {ChartXY} from '../src/chart';

test('sparse absolute heatmap samples repeat the last vector and explicit NaN creates exact gaps',()=>{
  const chart=new ChartXY(),heat=chart.addHeatmapScrollingGridSeries({resolution:3}).setStart({x:10,y:0}).setStep({x:2,y:1});
  heat.addIntensityValues([[1,2,3]]).invalidateIntensityValues({iSample:3,values:[[4,5,6]]});
  assert.equal(heat.getSampleCount(),4);
  for(const sample of [0,1,2])assert.deepEqual([0,1,2].map(cell=>heat.getIntensityValue(sample,cell)),[1,2,3]);
  heat.invalidateIntensityValues({iSample:4,values:[[NaN,NaN,NaN]]}).invalidateIntensityValues({iSample:7,values:[[8,9,10]]});
  for(const sample of [4,5,6])assert.ok(Number.isNaN(heat.getIntensityValue(sample,1)));
  assert.deepEqual([0,1,2].map(cell=>heat.getIntensityValue(7,cell)),[8,9,10]);assert.equal(heat.getSampleCount(),8);assert.equal(heat.getXMax(),26);
  assert.equal(heat.rows,3);assert.ok(heat.columns>=8);assert.equal(heat.textureBounds('x').end,10+heat.columns*2);
  chart.dispose();
});

test('minimum cleaning preserves all visible history and releases only expired samples',()=>{
  const chart=new ChartXY();chart.getDefaultAxisX().setInterval({start:0,end:100});
  const heat=chart.addHeatmapScrollingGridSeries({resolution:2}).setDataCleaning({minDataPointCount:10});
  heat.addIntensityValues(Array.from({length:100},(_,i)=>[i,i*2]));
  assert.equal(heat.getFirstRetainedSampleIndex(),0);assert.equal(heat.getRetainedSampleCount(),100);const allocated=heat.data.byteLength;
  chart.getDefaultAxisX().setInterval({start:90,end:110});heat.addIntensityValues([[100,200]]);
  assert.equal(heat.getFirstRetainedSampleIndex(),90);assert.equal(heat.getRetainedSampleCount(),11);assert.ok(heat.data.byteLength<allocated);
  for(let i=90;i<=100;i++)assert.equal(heat.getIntensityValue(i,1),i*2);
  const count=heat.getSampleCount();heat.invalidateIntensityValues({iSample:5,values:[[9,9]]});assert.equal(heat.getSampleCount(),count);assert.equal(heat.getIntensityValue(5,0),undefined);
  chart.getDefaultAxisX().setInterval({start:0,end:120});heat.addIntensityValues(Array.from({length:20},(_,i)=>[101+i,202+i*2]));
  assert.equal(heat.getFirstRetainedSampleIndex(),90);assert.equal(heat.getRetainedSampleCount(),31);
  heat.setDataCleaning(undefined);assert.equal(heat.getDataCleaning(),undefined);heat.addIntensityValues(Array.from({length:200},(_,i)=>[121+i,242+i*2]));assert.equal(heat.getRetainedSampleCount(),231);
  chart.dispose();assert.equal(heat.data.byteLength,0);
});

test('hard maximum and sparse jumps retain exact newest absolute columns without iterating every skipped index',()=>{
  const chart=new ChartXY(),heat=chart.addHeatmapScrollingGridSeries({resolution:2}).setDataCleaning({maxDataPointCount:3});
  heat.addIntensityValues([[1,10],[2,20]]).invalidateIntensityValues({iSample:1_000_000,values:[[3,30]]});
  assert.equal(heat.getSampleCount(),1_000_001);assert.equal(heat.getFirstRetainedSampleIndex(),999_998);assert.equal(heat.getRetainedSampleCount(),3);assert.equal(heat.data.byteLength,24);
  assert.deepEqual([...heat.orderedData()],[2,2,3,20,20,30]);
  heat.invalidateIntensityValues({iSample:999_999,values:[[7,70]]});assert.deepEqual([...heat.orderedData()],[2,7,3,20,70,30]);
  const previous=[...heat.data],revision=heat.revision;assert.throws(()=>heat.invalidateIntensityValues({iSample:-1,values:[[1,2]]}),/sample index/);assert.throws(()=>heat.invalidateIntensityValues({iSample:1,values:[[1]]}),/resolution/);assert.deepEqual([...heat.data],previous);assert.equal(heat.revision,revision);
  heat.clear().addIntensityValues([[8,80]]);assert.equal(heat.getSampleCount(),1);assert.equal(heat.getIntensityValue(0,1),80);chart.dispose();
});

test('row-scrolling absolute updates, resizing and cleaning retain row-major geometry',()=>{
  const chart=new ChartXY(),heat=chart.addHeatmapScrollingGridSeries({resolution:2,scrollDimension:'rows'}).setDataCleaning({maxDataPointCount:4});
  heat.addIntensityValues([[1,10],[2,20],[3,30]]).invalidateIntensityValues({iSample:6,values:[[7,70]]});
  assert.equal(heat.columns,2);assert.equal(heat.rows,4);assert.equal(heat.getFirstRetainedSampleIndex(),3);assert.deepEqual([...heat.orderedData()],[3,30,3,30,3,30,7,70]);
  heat.invalidateIntensityValues({iSample:4,values:[[5,50],[6,60]]});assert.deepEqual([...heat.orderedData()],[3,30,5,50,6,60,7,70]);chart.dispose();
});
