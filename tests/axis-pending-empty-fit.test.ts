import test from 'node:test';
import assert from 'node:assert/strict';
import {ChartXY} from '../src/chart.js';
import {DataSetXY} from '../src/core/data.js';

function fixture(){
  const chart=new ChartXY(),data=new DataSetXY({schema:{xValues:{storage:Float64Array,pattern:'progressive'},yValues:{storage:Float32Array,pattern:null}}});
  const series=chart.addLineSeries().setDataSet(data).setDataMapping({x:'xValues',y:'yValues'});
  const feed=(low:number,high:number)=>data.replaceSamples({xValues:new Float64Array([0,1,2]),yValues:new Float32Array([low,0,high])});
  return{chart,data,series,y:chart.axisY,feed};
}
const initial={start:0,end:10};
const range=(lo:number,hi:number)=>({start:Math.fround(lo),end:Math.fround(hi)});

// The native original-consumer trace proves empty fit stops synchronously and
// later drawing uses actual data bounds and omitted-stop returns to following.
// First eligible render is our deterministic scheduling policy, not a measured
// native RAF index or a fabricated animation duration.
test('omitted empty fit stops transiently, fits first rendered data and then follows the second feed',()=>{
  const{chart,data,y,feed}=fixture();try{
    y.setInterval({stopAxisAfter:false}).fit();
    assert.equal(y.getStopped(),true);assert.deepEqual(y.getInterval(),initial);
    chart.renderNow();assert.deepEqual(y.getInterval(),initial);
    feed(-.8,.8);assert.deepEqual(y.getInterval(),initial);assert.equal(y.getStopped(),true);
    chart.renderNow();assert.deepEqual(y.getInterval(),range(-.8,.8));assert.equal(y.getStopped(),false);assert.equal(y.hasPendingFit(),false);
    feed(-2,3);chart.renderNow();assert.deepEqual(y.getInterval(),range(-2,3));assert.equal(y.getStopped(),false);
    assert.deepEqual(Array.from(data.readBack().data.yValues),[-2,0,3]);
  }finally{chart.dispose();}
});

test('explicit true empty fit still stops after first rendered fit and ignores the second feed',()=>{
  const{chart,y,feed}=fixture();try{
    y.fit(false,true);assert.equal(y.getStopped(),true);assert.deepEqual(y.getInterval(),initial);
    feed(-1,2);assert.deepEqual(y.getInterval(),initial);chart.renderNow();assert.deepEqual(y.getInterval(),range(-1,2));assert.equal(y.getStopped(),true);assert.equal(y.hasPendingFit(),false);
    feed(-3,4);chart.renderNow();assert.deepEqual(y.getInterval(),range(-1,2));assert.equal(y.getStopped(),true);
  }finally{chart.dispose();}
});

test('a new explicit false empty fit replaces pending stop and continues real data following',()=>{
  const{chart,y,feed}=fixture();try{
    y.fit(false,true);y.fit(false,false);assert.equal(y.getStopped(),false);
    feed(-1,2);assert.deepEqual(y.getInterval(),initial);chart.renderNow();assert.deepEqual(y.getInterval(),range(-1,2));assert.equal(y.getStopped(),false);
    feed(-3,4);chart.renderNow();assert.deepEqual(y.getInterval(),range(-3,4));assert.equal(y.getStopped(),false);
  }finally{chart.dispose();}
});

test('external interval cancels deferred fit without an obsolete first-data overwrite',()=>{
  const{chart,y,feed}=fixture();try{
    y.fit(false,true);y.setInterval({start:50,end:60,stopAxisAfter:true});
    assert.equal(y.hasPendingFit(),false);feed(-1,2);chart.renderNow();assert.deepEqual(y.getInterval(),{start:50,end:60});assert.equal(y.getStopped(),true);
  }finally{chart.dispose();}
});

test('a newly configured default interval cancels the old deferred fit',()=>{
  const{chart,y,feed}=fixture();try{
    y.fit(false,true);y.setDefaultInterval({start:30,end:40,stopAxisAfter:true});
    assert.equal(y.hasPendingFit(),false);feed(-1,2);chart.renderNow();assert.deepEqual(y.getInterval(),{start:30,end:40});assert.equal(y.getStopped(),true);
  }finally{chart.dispose();}
});

test('another fit with actual data replaces an old pending request and does not run twice',()=>{
  const{chart,y,feed}=fixture();try{
    y.fit(false,false);feed(-1,2);y.fit(false,true);
    assert.deepEqual(y.getInterval(),range(-1,2));assert.equal(y.hasPendingFit(),false);
    feed(-5,6);chart.renderNow();assert.deepEqual(y.getInterval(),range(-1,2));assert.equal(y.getStopped(),true);
  }finally{chart.dispose();}
});

test('disposing an empty axis clears its pending request and leaves another chart independent',()=>{
  const first=fixture(),second=fixture();try{
    first.y.fit(false,true);assert.equal(first.y.hasPendingFit(),true);first.y.dispose();assert.equal(first.y.hasPendingFit(),false);
    second.feed(-1,2);second.chart.renderNow();assert.deepEqual(second.y.getInterval(),range(-1,2));assert.equal(second.y.getStopped(),false);
  }finally{first.chart.dispose();second.chart.dispose();}
});
