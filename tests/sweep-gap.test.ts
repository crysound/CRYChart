import test from 'node:test';
import assert from 'node:assert/strict';
import {sweepSegments} from '../examples/official/additional-dashboards.js';

function verifyMembership(next:number,capacity:number,gap:number) {
  const ranges=sweepSegments(next,capacity,gap),actual=new Uint8Array(capacity);
  for(const name of ['previous','current'] as const) {
    let previousSlot=-1;
    for(let index=ranges[name].start;index<ranges[name].end;index++) {
      const slot=index%capacity;
      assert.ok(slot>previousSlot,`segment must not cross wrap: ${next}/${name}/${index}`);
      previousSlot=slot;
      assert.equal(actual[slot],0,`duplicate slot ${slot}`);
      actual[slot]=1;
      const latest=slot+capacity*Math.floor((next-1-slot)/capacity);
      assert.equal(index,latest,`wrong source generation at slot ${slot}`);
    }
  }
  const phase=next%capacity;
  for(let slot=0;slot<capacity;slot++) {
    const latest=slot+capacity*Math.floor((next-1-slot)/capacity);
    const distance=(slot-phase+capacity)%capacity;
    assert.equal(actual[slot],Number(latest>=0&&distance>=gap),`membership ${next}/${capacity}/${gap}/${slot}`);
  }
  return actual;
}

test('sweep tail 9928 excludes the full cyclic 90-slot gap including slots 0 through 17',()=>{
  const actual=verifyMembership(9928,5000,90);
  const missing=Array.from(actual,(value,slot)=>value?-1:slot).filter(slot=>slot>=0);
  assert.deepEqual(missing,[...Array.from({length:18},(_,i)=>i),...Array.from({length:72},(_,i)=>4928+i)]);
  assert.equal(actual.reduce((a,b)=>a+b,0),4910);
});

test('all 5000 fully initialized heads preserve exact latest-source membership and the cyclic gap',()=>{
  for(let phase=0;phase<5000;phase++)verifyMembership(5000+phase,5000,90);
});

test('sweep gap membership covers startup, later wraps, no gap and full-capacity gap',()=>{
  for(const next of [0,1,89,90,1000,4909,4910,4911,4928,4999,10000,10001,14910,14911,14928,14999])verifyMembership(next,5000,90);
  for(const gap of [0,1,4,16,17])for(let next=0;next<=68;next++)verifyMembership(next,17,gap);
});
