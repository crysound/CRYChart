import test from 'node:test';
import assert from 'node:assert/strict';
import {ChartXY} from '../src/chart';
import {AxisScrollStrategies} from '../src/core/styles';
import {AxisScrollAnimation} from '../src/axis-scroll-animation';

class AnimatedChart extends ChartXY {
  step(timestamp:number){this.beforeScheduledAnimationFrame(timestamp);this.renderNow();}
  pending(){return this.hasPendingAnimationFrame();}
}
function fixture(){
  const chart=new AnimatedChart(),axis=chart.getDefaultAxisX();
  axis.setAnimationScroll(true).setScrollMargins(false).setScrollStrategy(AxisScrollStrategies.progressive).setInterval({start:0,end:10,stopAxisAfter:false});
  const series=chart.addLineSeries().appendSamples({xValues:[0,10],yValues:[1,1]});chart.renderNow();
  return{chart,axis,series};
}
function settle(chart:AnimatedChart,start=0){for(let frame=0;frame<120&&chart.pending();frame++)chart.step(start+frame*1000/60);assert.equal(chart.pending(),false);}

test('enabled automatic scrolling paints intermediate intervals, retargets live data and terminates exactly',()=>{
  const {chart,axis,series}=fixture();
  try{
    series.appendSamples({xValues:[20],yValues:[1]});chart.renderNow();assert.deepEqual(axis.getInterval(),{start:0,end:10});assert.equal(chart.pending(),true);
    chart.step(0);const first=axis.getInterval();assert.ok(first.start>0&&first.end<20);assert.ok(Math.abs(first.end-first.start-10)<1e-12);
    series.appendSamples({xValues:[30],yValues:[2]});chart.step(16);assert.ok(axis.getInterval().end<30);
    settle(chart,32);assert.ok(Math.abs(axis.getInterval().start-20)<1e-10);assert.equal(axis.getInterval().end,30);
    assert.deepEqual(Array.from(series.getDataSet().readBack().data.xValues!),[0,10,20,30]);
  }finally{chart.dispose();}
});

test('manual interval, stopped axis and disabled animation cancel a pending automatic response',()=>{
  const {chart,axis,series}=fixture();
  try{
    series.appendSamples({xValues:[20],yValues:[1]});chart.renderNow();chart.step(0);
    axis.setInterval({start:-3,end:7,stopAxisAfter:true});assert.equal(chart.pending(),false);chart.step(16);assert.deepEqual(axis.getInterval(),{start:-3,end:7});
    axis.setStopped(false);chart.renderNow();assert.equal(chart.pending(),true);axis.setStopped(true);assert.equal(chart.pending(),false);
    axis.setStopped(false).setAnimationScroll(undefined);chart.renderNow();assert.deepEqual(axis.getInterval(),{start:10,end:20});assert.equal(chart.pending(),false);
    axis.setAnimationScroll(true);series.appendSamples({xValues:[30],yValues:[1]});chart.renderNow();assert.equal(chart.pending(),true);
    axis.setAnimationScroll(false);chart.renderNow();assert.deepEqual(axis.getInterval(),{start:20,end:30});assert.equal(chart.pending(),false);
  }finally{chart.dispose();}
});

test('hidden charts, empty source data, removed axes and disposed charts stop scheduling scrolling frames',()=>{
  const {chart,axis,series}=fixture();
  try{
    series.appendSamples({xValues:[20],yValues:[1]});chart.renderNow();assert.equal(chart.pending(),true);
    chart.setVisible(false);assert.equal(chart.pending(),false);chart.setVisible(true);chart.renderNow();assert.equal(chart.pending(),true);
    series.clear();chart.step(0);assert.equal(chart.pending(),false);
    series.appendSamples({xValues:[0,30],yValues:[1,1]});chart.renderNow();assert.equal(chart.pending(),true);
    axis.setVisible(false);chart.step(16);assert.equal(chart.pending(),false);assert.equal(axis.getInterval().end,30);
    axis.setVisible(true);series.appendSamples({xValues:[40],yValues:[1]});chart.renderNow();assert.equal(chart.pending(),true);
    axis.dispose();assert.equal(chart.pending(),false);chart.dispose();assert.equal(chart.pending(),false);chart.step(100);
  }finally{chart.dispose();}
});

test('a manual override inside an interval listener wins over the pending animation',()=>{
  const {chart,axis,series}=fixture();
  try{
    series.appendSamples({xValues:[20],yValues:[1]});chart.renderNow();let calls=0;
    axis.onIntervalChange(()=>{if(calls++===0)axis.setInterval({start:40,end:50,stopAxisAfter:true});});
    chart.step(0);assert.deepEqual(axis.getInterval(),{start:40,end:50});assert.equal(chart.pending(),false);
  }finally{chart.dispose();}
});

test('logarithmic and reversed responses preserve geometry and have a finite completion bound',()=>{
  for(const logarithmic of [false,true]){
    const animation=new AxisScrollAnimation();let current=logarithmic?{start:100,end:10}:{start:10,end:0};
    const target=logarithmic?{start:1000,end:100}:{start:-10,end:-20};animation.request(target);
    for(let frame=0;frame<120&&animation.pending();frame++){
      current=animation.advance(current,frame*16,500,logarithmic)!;assert.ok(current.start>current.end);
      if(logarithmic)assert.ok(Math.abs(current.start/current.end-10)<1e-11);
    }
    assert.deepEqual(current,target);assert.equal(animation.pending(),false);
  }
});

test('invalid targets and stale timestamps do not advance a pending response or leave an endless animation',()=>{
  const animation=new AxisScrollAnimation(),current={start:0,end:10};
  assert.throws(()=>animation.request({start:Infinity,end:1}),/finite/);assert.equal(animation.pending(),false);
  animation.request({start:10,end:20});assert.equal(animation.advance(current,NaN,500),undefined);
  const first=animation.advance(current,100,500)!;assert.equal(animation.advance(first,90,500),undefined);
  animation.cancel();assert.equal(animation.pending(),false);assert.equal(animation.advance(first,120,500),undefined);
  animation.request({start:10,end:20});let next=first;
  for(let frame=0;frame<90&&animation.pending();frame++)next=animation.advance(next,frame/1000,1e9)!;
  assert.deepEqual(next,{start:10,end:20});
});
