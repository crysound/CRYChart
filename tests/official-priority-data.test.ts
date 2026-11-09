import test from 'node:test';
import assert from 'node:assert/strict';
import {histogramHitIndex,normalSamples} from '../examples/official/statistics';
import {histogram} from '../examples/signals';

test('histogram hits use displayed bin boundaries, including the closed final edge',()=>{
  const counts=Array.from({length:20},(_,i)=>i+1);
  for(let i=0;i<20;i++){
    const left=-4+i*.4,right=-4+(i+1)*.4;
    assert.equal(histogramHitIndex(counts,left,.5,true,-4,4),i,`exact left edge ${i}`);
    assert.equal(histogramHitIndex(counts,(left+right)/2,counts[i],true,-4,4),i,`top edge ${i}`);
    assert.equal(histogramHitIndex(counts,(left+right)/2,counts[i]+.001,true,-4,4),undefined,`above ${i}`);
  }
  assert.equal(histogramHitIndex(counts,4,.5,true,-4,4),19);
  assert.equal(histogramHitIndex(counts,4.000001,.5,true,-4,4),undefined);
  assert.equal(histogramHitIndex(counts,-4.000001,.5,true,-4,4),undefined);
});
test('hidden histogram and nonfinite coordinates never produce a source hit',()=>{
  for(const x of [-4,-1,0,4])assert.equal(histogramHitIndex([3,7],x,1,false,-4,4),undefined);
  for(const x of [NaN,Infinity,-Infinity])assert.equal(histogramHitIndex([3,7],x,1,true,-4,4),undefined);
  for(const y of [NaN,Infinity,-Infinity,-.01])assert.equal(histogramHitIndex([3,7],1,y,true,-4,4),undefined);
  assert.equal(histogramHitIndex([],0,0,true,-4,4),undefined);
});
test('official 1402 hit counts match an independent range count of all finite samples',()=>{
  const samples=normalSamples(50000,21402),bins=histogram(samples,20,-4,4),counts=bins.map(x=>x.value);
  let total=0;
  for(let i=0;i<20;i++){
    const left=-4+i*.4,right=-4+(i+1)*.4;
    const expected=samples.reduce((count,x)=>count+Number(x>=left&&(i===19?x<=right:x<right)),0);
    assert.equal(counts[i],expected);total+=expected;
    const hit=histogramHitIndex(counts,(left+right)/2,expected/2,true,-4,4);
    assert.equal(hit,i);assert.equal(counts[hit!],expected);
  }
  assert.equal(total,49996);assert.equal(samples.length-total,4);
  assert.equal(counts[histogramHitIndex(counts,4,1,true,-4,4)!],7);
});
