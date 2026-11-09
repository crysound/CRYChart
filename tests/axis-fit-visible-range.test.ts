import test from 'node:test';
import assert from 'node:assert/strict';
import {ChartXY,Chart3D} from '../src/chart.js';
import {AxisScrollStrategies} from '../src/core/styles.js';
import {DataSetXY} from '../src/core/data.js';

function source(chart:ChartXY,x:number[],y:number[],options:{axisX?:any;axisY?:any;ordered?:boolean}={}){
 const data=new DataSetXY({includesNaN:true,schema:{t:{storage:Float64Array,...(options.ordered?{pattern:'progressive' as const}:{})},v:{storage:Float64Array}}});
 const series=chart.addLineSeries({dataSet:data,axisX:options.axisX,axisY:options.axisY}).setDataMapping({x:'t',y:'v'});
 data.appendSamples({t:x,v:y});return{data,series};
}
const visible=()=>AxisScrollStrategies.fitting({considerVisibleRangeOnly:true});

test('explicit visible fitting uses only original samples inside the other bound axis interval and leaves full source intact',()=>{
 const chart=new ChartXY(),s=source(chart,[0,20000,30000],[100,1,2],{ordered:true});try{
  chart.axisX.setInterval({start:20000,end:30000});chart.axisY.setScrollStrategy(visible()).fit(false,false);
  assert.deepEqual(chart.axisY.getInterval(),{start:1,end:2});assert.equal(s.data.getSampleCount(),3);assert.deepEqual([...s.data.readBack().data.v],[100,1,2]);
  chart.axisX.setInterval({start:30000,end:20000});chart.axisY.updateAuto();assert.deepEqual(chart.axisY.getInterval(),{start:1,end:2});
  chart.axisY.setScrollStrategy(AxisScrollStrategies.fitting({considerVisibleRangeOnly:false})).fit(false,false);
  assert.deepEqual(chart.axisY.getInterval(),{start:1,end:100});
 }finally{chart.dispose();s.data.dispose();}
});

test('visible fitting honors actual per-series mappings, independent other axes and hidden series',()=>{
 const chart=new ChartXY(),otherX=chart.addAxisX().setInterval({start:100,end:200});
 const a=source(chart,[0,1,2],[100,1,2],{ordered:true}),b=source(chart,[100,150,250],[3,4,999],{axisX:otherX,ordered:true}),hidden=source(chart,[1,2],[500,600]);try{
  hidden.series.setVisible(false);chart.axisX.setInterval({start:1,end:2});chart.axisY.setScrollStrategy(visible()).fit(false,false);
  assert.deepEqual(chart.axisY.getInterval(),{start:1,end:4});
  b.series.setVisible(false);chart.axisY.updateAuto();assert.deepEqual(chart.axisY.getInterval(),{start:1,end:2});
 }finally{chart.dispose();a.data.dispose();b.data.dispose();hidden.data.dispose();}
});

test('unordered and NaN sources filter actual finite sample pairs; empty windows keep the previous interval',()=>{
 const chart=new ChartXY(),s=source(chart,[4,NaN,1,3,2,2.5],[99,-999,1,3,2,NaN]);try{
  chart.axisX.setInterval({start:1,end:3});chart.axisY.setScrollStrategy(visible()).fit(false,false);assert.deepEqual(chart.axisY.getInterval(),{start:1,end:3});
  chart.axisX.setInterval({start:10,end:20});chart.axisY.updateAuto();assert.deepEqual(chart.axisY.getInterval(),{start:1,end:3});
  s.data.replaceSamples({t:[12,15],v:[-4,6]});chart.axisY.updateAuto();assert.deepEqual(chart.axisY.getInterval(),{start:-4,end:6});
 }finally{chart.dispose();s.data.dispose();}
});

test('X fitting filters against the actual Y interval rather than hardcoding time on X',()=>{
 const chart=new ChartXY(),s=source(chart,[0,2,4,999],[-100,1,2,100]);try{
  chart.axisY.setInterval({start:1,end:2});chart.axisX.setScrollStrategy(visible()).fit(false,false);assert.deepEqual(chart.axisX.getInterval(),{start:2,end:4});
 }finally{chart.dispose();s.data.dispose();}
});

test('monotonic histories reuse immutable extrema blocks without readBack or full-column copies on each append',()=>{
 const chart=new ChartXY(),xs=Array.from({length:16384},(_,i)=>i),ys=xs.map(i=>i%97),s=source(chart,xs,ys,{ordered:true});try{
  chart.axisX.setInterval({start:2000,end:16383});chart.axisY.setScrollStrategy(visible());
  let reads=0;const get=s.data.getValue.bind(s.data);s.data.getValue=(name,index)=>{reads++;return get(name,index);};
  s.data.readBack=()=>{throw Error('visible fitting must not copy source');};s.data.getColumn=()=>{throw Error('visible fitting must not materialize full columns');};
  chart.axisY.fit(false,false);assert.deepEqual(chart.axisY.getInterval(),{start:0,end:96});
  reads=0;chart.axisY.updateAuto();assert.equal(reads,0,'same source and viewport must reuse the exact result');
  s.data.appendSamples({t:[16384],v:[-5]});chart.axisX.setInterval({start:2001,end:16384});reads=0;chart.axisY.updateAuto();
  assert.deepEqual(chart.axisY.getInterval(),{start:-5,end:96});assert.ok(reads<4096,`incremental query performed ${reads} direct reads`);
  s.data.setMaxSampleCount(4096);chart.axisX.setInterval({start:14000,end:16384});chart.axisY.updateAuto();assert.deepEqual(chart.axisY.getInterval(),{start:-5,end:96});
 }finally{chart.dispose();s.data.dispose();}
});

test('explicit visible fitting rejects unsupported geometry and 3D routes without changing default fitting',()=>{
 const chart=new ChartXY();try{
  chart.addRectangleSeries().add({x:1,y:2,width:2,height:3});chart.axisY.setScrollStrategy(visible());
  assert.throws(()=>chart.axisY.updateAuto(),/visible.*(fitting|range)|not.*implemented/i);
  chart.axisY.setScrollStrategy(AxisScrollStrategies.fitting);assert.doesNotThrow(()=>chart.axisY.updateAuto());
 }finally{chart.dispose();}
 const world=new Chart3D();try{world.addLineSeries().add({x:1,y:2,z:3});world.axisY.setScrollStrategy(visible());assert.throws(()=>world.axisY.updateAuto(),/visible.*(fitting|range)|not.*implemented/i);}finally{world.dispose();}
});
