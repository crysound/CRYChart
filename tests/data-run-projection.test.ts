import test from 'node:test';
import assert from 'node:assert/strict';
import {DataSetXY} from '../src/core/data';
import {ChartXY} from '../src/chart';
import {boundsFromRuns} from '../src/data-runs';

test('implicit timestamps produce identical projection bytes and bounds without materialization across append, wrap and discontinuities',()=>{
 const implicit=new DataSetXY({schema:{x:{storage:Float64Array,auto:true},y:{storage:Float64Array}}}),dense=new DataSetXY();implicit.setMaxSampleCount(47);dense.setMaxSampleCount(47);const chart=new ChartXY(),a=chart.addLineSeries({dataSet:implicit}),b=chart.addLineSeries({dataSet:dense});let last=0;
 for(let batch=0;batch<30;batch++){const count=3+(batch*7)%23,step=batch===13?-.13:batch===14?0:1000/48000,start=batch===0?1.7e12:batch===18?1.7e12+100:last+step,x=Float64Array.from({length:count},(_,i)=>start+i*step),y=Float64Array.from({length:count},(_,i)=>(i+batch)%17===0?NaN:Math.sin(i+batch));last=x[count-1];implicit.appendSamples({y},{start,step});dense.appendSamples({x,y});
  for(const dim of ['x','y'] as const)assert.deepEqual(a.bounds(dim),b.bounds(dim));const pa=a.drawPacket(),pb=b.drawPacket();assert.deepEqual(pa.origin,pb.origin);assert.deepEqual(new Uint8Array(pa.positions.buffer,pa.positions.byteOffset,pa.positions.byteLength),new Uint8Array(pb.positions.buffer,pb.positions.byteOffset,pb.positions.byteLength));assert.equal(pa.monotonicX,pb.monotonicX);assert.equal(pa.strictlyMonotonicX,pb.strictlyMonotonicX);assert.equal(implicit.getColumnRuns('x').kind,'affine');
 }
 chart.renderNow();assert.equal(implicit.getColumnRuns('x').kind,'affine');chart.dispose();
});
test('affine finite bounds include the last valid value before overflow and negative steps are not assumed progressive',()=>{
 const data=new DataSetXY({schema:{x:{auto:true},y:{}}});data.appendSamples({y:new Float64Array(10)},{start:1e308,step:2e307});const expected=Array.from({length:10},(_,i)=>1e308+i*2e307).filter(Number.isFinite);assert.deepEqual(boundsFromRuns(data.getColumnRuns('x')),{start:Math.min(...expected),end:Math.max(...expected)});
 data.clear().appendSamples({y:new Float64Array(12)},{start:4,step:-.1});assert.deepEqual(boundsFromRuns(data.getColumnRuns('x'),5),{start:4+11*(-.1),end:4+5*(-.1)});assert.equal(data.getColumnRuns('x').kind,'affine');
});
test('logarithmic rendering uses exact automatic values, retaining NaN gaps and zero crossings',()=>{
 const a=new DataSetXY({schema:{x:{auto:true},y:{}}}),b=new DataSetXY(),chart=new ChartXY({defaultAxisX:{type:'logarithmic'}}),s=chart.addLineSeries({dataSet:a}),t=chart.addLineSeries({dataSet:b});
 a.appendSamples({y:[1,2,3,4,NaN,6]},{start:-2,step:1});b.appendSamples({x:[-2,-1,0,1,2,3],y:[1,2,3,4,NaN,6]});assert.deepEqual([...s.drawPacket().positions],[...t.drawPacket().positions]);assert.equal(a.getColumnRuns('x').kind,'affine');chart.dispose();
});
