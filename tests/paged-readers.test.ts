import test from 'node:test';
import assert from 'node:assert/strict';
import {PagedColumns} from '../src/core/paged-columns.js';
import type {DataSetXY,DataColumnRuns} from '../src/core/data.js';
import {boundsFromRuns,firstRunValue,projectRuns,projectXYRuns} from '../src/data-runs.js';
import {getColumnBounds,getColumnBoundsStats} from '../src/data-bounds.js';
import {getColumnOrder} from '../src/data-order.js';

// This adapter isolates the readers from DataSet's storage-selection policy. The
// page backend and range/revision contracts are the actual implementation.
function fixture(capacity:number,pageSize:number){
  const store=new PagedColumns({schema:{x:{storage:Float64Array},y:{storage:Float64Array}},capacity,pageSize});
  let pageReads=0;
  const view=(name:string):DataColumnRuns=>{const source=store.getColumnView(name);return {...source,getPage(index:number){pageReads++;return source.getPage(index);}};};
  const data={schema:store.schema,get revision(){return store.revision;},getSampleCount:()=>store.getSampleCount(),
    getNextSampleIndex:()=>store.getNextSampleIndex(),getContentEpoch:()=>store.getContentEpoch(),isDisposed:()=>store.isDisposed(),
    getColumnRuns:view,getValue:(name:string,index:number)=>store.getValue(name,index),onChange:()=>{}} as unknown as DataSetXY;
  return {store,data,view,reads:()=>pageReads,resetReads:()=>{pageReads=0;}};
}
function bounds(values:ArrayLike<number>){let start=Infinity,end=-Infinity;for(let i=0;i<values.length;i++){const value=values[i]!;if(Number.isFinite(value)){start=Math.min(start,value);end=Math.max(end,value);}}return start===Infinity?undefined:{start,end};}
function order(values:ArrayLike<number>){let finite=true,monotonic=true,strict=true;for(let i=0;i<values.length;i++){if(!Number.isFinite(values[i]))finite=false;if(i&&values[i]<values[i-1])monotonic=false;if(i&&values[i]<=values[i-1])strict=false;}return {finite,monotonic:finite&&monotonic,strict:finite&&strict};}

test('paged projection preserves partial-page boundaries, raw nonfinite values and large Float64 origins',()=>{
  const {store,view}=fixture(601,257),xs=Float64Array.from({length:1000},(_,i)=>1e12+i*.125),ys=Float64Array.from({length:1000},(_,i)=>i%17===0?NaN:i%31===0?Infinity:i%43===0?-Infinity:Math.cos(i)*20);
  store.appendSamples({x:xs,y:ys});const retainedX=xs.slice(399),retainedY=ys.slice(399),positions=new Float32Array(1202);
  assert.equal(firstRunValue(view('x')),retainedX[0]);assert.deepEqual(boundsFromRuns(view('y')),bounds(retainedY));
  assert.deepEqual(projectXYRuns(view('x'),view('y'),positions,0,{x:1e12,y:-3},false,false),{monotonic:true,strict:true});
  for(let i=0;i<601;i++){assert.ok(Object.is(positions[2*i],Math.fround(retainedX[i]-1e12)));assert.ok(Object.is(positions[2*i+1],Math.fround(retainedY[i]+3)));}
  positions.fill(999);projectRuns(view('x'),positions,0,598,1e12,false);
  assert.equal(positions[1194],999);assert.equal(positions[1195],999);for(let i=598;i<601;i++)assert.equal(positions[2*i],Math.fround(retainedX[i]-1e12));
  store.dispose();
});

test('paged range scans jump directly to new tail pages without revisiting long history',()=>{
  const f=fixture(200000,256),x=Float64Array.from({length:200000},(_,i)=>i),y=Float64Array.from(x,i=>Math.sin(i));f.store.appendSamples({x,y});
  assert.deepEqual(getColumnBounds(f.data,'y'),bounds(y));assert.equal(getColumnOrder(f.data,'x').strict,true);
  f.store.appendSamples({x:[200000,200001,200002],y:[-25,NaN,30]});f.resetReads();
  assert.deepEqual(getColumnBounds(f.data,'y'),{start:-25,end:30});const boundsReads=f.reads();
  assert.ok(boundsReads<=8,`only changed head/tail pages should be read, got ${boundsReads}`);
  assert.ok(getColumnBoundsStats(f.data,'y')!.lastScannedSamples<=1026);
  f.resetReads();const result=getColumnOrder(f.data,'x');assert.equal(result.strict,true);assert.equal(result.lastScannedSamples,3);assert.equal(f.reads(),1);
  f.resetReads();getColumnBounds(f.data,'y');getColumnOrder(f.data,'x');assert.equal(f.reads(),0);f.store.dispose();
});

test('paged bounds and ordering remain exact through rolling eviction, resizing, clearing and violations',()=>{
  const f=fixture(5000,257);let seed=35612;
  const random=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed>>>0;};
  for(let step=0;step<180;step++){
    if(step%23===0)f.store.clear();if(step%11===0)f.store.resize(1+random()%7000);
    const count=1+random()%600,next=f.store.getNextSampleIndex();
    const x=Float64Array.from({length:count},(_,i)=>random()%101===0?NaN:random()%137===0?next+i-100:next+i);
    const y=Float64Array.from({length:count},()=>{const v=random();return v%23===0?NaN:v%29===0?Infinity:v%31===0?-Infinity:v%37===0?-0:(v%10000-5000)/3;});
    f.store.appendSamples({x,y});const rx=f.store.readColumn('x'),ry=f.store.readColumn('y');
    assert.deepEqual(getColumnBounds(f.data,'y'),bounds(ry),`bounds step ${step}`);
    const {finite,monotonic,strict}=getColumnOrder(f.data,'x');assert.deepEqual({finite,monotonic,strict},order(rx),`order step ${step}`);
  }
  f.store.dispose();
});

test('a paged tail projection and bounds query never read unused edge bytes',()=>{
  const f=fixture(17,256);f.store.appendSamples({x:Float64Array.from({length:300},(_,i)=>i+1),y:Float64Array.from({length:300},(_,i)=>i+1)});
  const view=f.view('x'),page=(view as any).getPage(1);page[0]=-1e99;page[255]=1e99;
  assert.deepEqual(boundsFromRuns(view),{start:284,end:300});assert.equal(firstRunValue(view),284);
  const positions=new Float32Array(34);projectRuns(view,positions,0,0,0,true);
  for(let i=0;i<17;i++)assert.equal(positions[i*2],Math.fround(Math.log10(i+284)));
  f.resetReads();assert.equal(boundsFromRuns(f.view('x'),17),undefined);assert.equal(f.reads(),0);f.store.dispose();
});
