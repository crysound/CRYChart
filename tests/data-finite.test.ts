import test from 'node:test';
import assert from 'node:assert/strict';
import {DataSetXY} from '../src/core/data.js';
import {getColumnFinite, getColumnOrder} from '../src/data-order.js';
import {proveExtremaPair} from '../src/line-extrema-pair-proof.js';
import {readSourceCertificate} from '../src/core/line-delta-certificate.js';

function oracle(data:DataSetXY,key:string){
  const first=data.getNextSampleIndex()-data.getSampleCount();let invalid=-1;
  for(let i=0;i<data.getSampleCount();i++)if(!Number.isFinite(data.getValue(key,i)))invalid=first+i;
  return{finite:invalid<first,invalid,first,next:data.getNextSampleIndex(),count:data.getSampleCount()};
}
function verify(data:DataSetXY,key='y'){
  const actual=getColumnFinite(data,key),expected=oracle(data,key);
  assert.equal(actual.verifiedCurrent,true);assert.equal(actual.finite,expected.finite);assert.equal(actual.lastInvalidPointIndex,expected.invalid);
  assert.equal(actual.firstIndex,expected.first);assert.equal(actual.nextIndex,expected.next);assert.equal(actual.sampleCount,expected.count);
  return actual;
}
function make(storage:Float64ArrayConstructor|Float32ArrayConstructor=Float64Array,paged=false){
  return new DataSetXY({schema:{x:{storage:Float64Array,auto:true},y:{storage},other:{storage}},...(paged?{columnStorage:{mode:'paged' as const,pageSize:16}}:{})}).setMaxSampleCount(64);
}

test('finite-only checks every dense F32/F64 value and leaves ordinary ordering flags and counters independent',()=>{
  for(const storage of [Float32Array,Float64Array]){
    const data=make(storage);
    try{
      data.appendSamples({y:storage.from([3,1,-0,0,9,-4]),other:storage.from([1,2,3,4,5,6])},{start:0,step:.25});
      const finite=verify(data);assert.equal(finite.lastScannedSamples,6);assert.equal(finite.fullScans,1);
      assert.equal(getColumnFinite(data,'y').lastScannedSamples,0);
      const ordered=getColumnOrder(data,'y');assert.equal(ordered.finite,true);assert.equal(ordered.strict,false);assert.equal(ordered.monotonic,false);assert.equal(ordered.lastScannedSamples,6);
      data.appendSamples({y:storage.from([1,NaN,Infinity,-Infinity,1e40]),other:new storage(5)},{start:1.5,step:.25});
      const next=verify(data);assert.equal(next.lastScannedSamples,5);assert.equal(next.incrementalScans,1);assert.equal(next.finite,false);
      assert.equal(getColumnOrder(data,'y').lastScannedSamples,5);
    }finally{data.dispose();}
  }
});

test('finite-only retains the latest invalid absolute index and expires it only after the real ring drops it',()=>{
  const data=make().setMaxSampleCount(8);
  try{
    data.appendSamples({y:Float64Array.from([1,NaN,2,3,4,Infinity,5,6])});verify(data);
    for(const n of [2,1,3,2,15]){
      data.appendSamples({y:new Float64Array(n).fill(1)});
      const result=getColumnFinite(data,'y'),expected=oracle(data,'y');
      assert.equal(result.finite,expected.finite);assert.ok(result.lastInvalidPointIndex===expected.invalid||result.lastInvalidPointIndex<expected.first&&expected.invalid===-1);
      assert.equal(result.lastScannedSamples,Math.min(n,8));
    }
  }finally{data.dispose();}
});

test('finite-only full-scan oracle agrees through deterministic append, resize, clear, replacement and remapping properties',()=>{
  for(const storage of [Float32Array,Float64Array])for(const paged of [false,true]){
    const data=make(storage,paged);let seed=0x10203040;
    const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
    const values=(n:number)=>storage.from({length:n},()=>{const x=random();return x%17===0?NaN:x%19===0?Infinity:x%23===0?-Infinity:x%13===0?-0:x%11===0?0:(x%10000-5000)/37;});
    try{
      for(let step=0;step<160;step++){
        const operation=random()%8,n=1+random()%37;
        if(operation===4)data.setMaxSampleCount(1+random()%96);
        else if(operation===5)data.clear();
        else if(operation===6)data.replaceSamples({y:values(n),other:values(n)},{start:1000,step:.25});
        else data.appendSamples({y:values(n),other:values(n)},{start:data.getNextSampleIndex()*.25,step:.25});
        for(const key of ['y','other']){
          const actual=getColumnFinite(data,key),expected=oracle(data,key);
          assert.equal(actual.verifiedCurrent,true);assert.equal(actual.finite,expected.finite);
          assert.ok(actual.lastInvalidPointIndex===expected.invalid||actual.lastInvalidPointIndex<expected.first&&expected.invalid===-1);
          assert.equal(actual.sampleCount,expected.count);assert.equal(actual.firstIndex,expected.first);assert.equal(actual.nextIndex,expected.next);
          const again=getColumnFinite(data,key);if(!readSourceCertificate(data)?.tainted)assert.equal(again.lastScannedSamples,0);
        }
      }
      assert.equal(data.getStorageStats().snapshotBytes,0);
    }finally{data.dispose();}
  }
});

test('failed dense writes taint same-header cached finite evidence and require complete rescans until a new epoch',()=>{
  const data=make().setMaxSampleCount(4);
  try{
    data.appendSamples({y:new Float64Array(4).fill(1)});assert.equal(verify(data).finite,true);
    const revision=data.revision,broken={length:4,0:NaN,get 1():number{throw Error('input getter failed');},2:1,3:1};
    assert.throws(()=>data.appendSamples({y:broken}),/input getter failed/);assert.equal(data.revision,revision);assert.equal(readSourceCertificate(data)!.tainted,true);
    const first=verify(data);assert.equal(first.finite,false);assert.equal(first.lastScannedSamples,4);assert.equal(verify(data).lastScannedSamples,4);
    data.appendSamples({y:new Float64Array(4).fill(2)});assert.equal(verify(data).finite,true);assert.equal(verify(data).lastScannedSamples,4);
    data.clear();data.appendSamples({y:new Float64Array(4).fill(3)});assert.equal(verify(data).finite,true);assert.equal(verify(data).lastScannedSamples,0);
  }finally{data.dispose();}
});

test('reentrant writes and listener exceptions never authorize finite prefix reuse',()=>{
  const data=make().setMaxSampleCount(8);
  try{
    data.appendSamples({y:new Float64Array(8).fill(1)});verify(data);
    let reentered=false;
    const values={length:2,get 0(){if(!reentered){reentered=true;data.appendSamples({y:Float64Array.of(Infinity)});}return 2;},1:3};
    data.appendSamples({y:values});assert.equal(readSourceCertificate(data)!.tainted,true);
    const check=verify(data);assert.equal(check.lastScannedSamples,data.getSampleCount());assert.equal(verify(data).lastScannedSamples,data.getSampleCount());
  }finally{data.dispose();}
  const listener=make();listener.appendSamples({y:Float64Array.of(1)});verify(listener);
  listener.onChange(()=>{throw Error('listener failed');});assert.throws(()=>listener.appendSamples({y:Float64Array.of(NaN)}),/listener failed/);
  assert.equal(verify(listener).finite,false);assert.equal(verify(listener).lastScannedSamples,2);assert.throws(()=>listener.dispose(),/listener failed/);
});

test('finite-only handles affine columns, source rebinding, new columns and disposal without owning source snapshots',()=>{
  const a=make(),b=make();
  try{
    a.appendSamples({y:Float64Array.of(1,2,3)},{start:1e308,step:1e308});assert.equal(verify(a,'x').finite,false);
    b.appendSamples({y:Float64Array.of(3,2,1)});assert.equal(verify(b).finite,true);assert.equal(verify(b).lastScannedSamples,0);
    a.addColumns({extra:{storage:Float64Array}});assert.equal(verify(a,'extra').finite,false);
    assert.equal(a.getStorageStats().snapshotBytes,0);assert.equal(b.getStorageStats().snapshotBytes,0);
    assert.throws(()=>getColumnFinite(a,'absent'),/Unknown data column/);
  }finally{a.dispose();b.dispose();}
  assert.equal(getColumnFinite(a,'y').sampleCount,0);assert.equal(getColumnFinite(a,'y').finite,true);
});

test('extrema admission uses real finite-only Y evidence while retaining X order and nonfinite fallback',()=>{
  const data=make().setMaxSampleCount(64);
  try{
    data.appendSamples({y:Float64Array.from({length:64},(_,i)=>Math.sin(i*.7))},{start:0,step:.25});
    assert.equal(proveExtremaPair(data,'x','y').enabled,true);
    const order=getColumnOrder(data,'y');assert.equal(order.lastScannedSamples,64);assert.equal(order.strict,false);
    data.appendSamples({y:Float64Array.of(NaN)},{start:16,step:.25});assert.equal(proveExtremaPair(data,'x','y').enabled,false);
    data.clear();data.appendSamples({y:new Float64Array(64).fill(1)},{start:0,step:.25});assert.equal(proveExtremaPair(data,'x','y').enabled,true);
  }finally{data.dispose();}
});
