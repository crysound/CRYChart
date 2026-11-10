import test from 'node:test';
import assert from 'node:assert/strict';
import {ChartXY} from '../src/chart.js';

// Saved-waveform Restore passes no endpoints: waking a stopped axis must
// schedule the fitting frame even when its current interval is unchanged.
test('resuming a saved interval notifies once and schedules an automatic-fit frame',()=>{
 const chart=new ChartXY(),axis=chart.axisX;
 try{
  axis.setAnimationScroll(false).setScrollMargins(false);
  chart.addLineSeries().add([{x:0,y:1},{x:4997.5,y:2}]);
  axis.setInterval({start:2000,end:7000,stopAxisAfter:true});chart.renderNow();
  const states:boolean[]=[];let invalidations=0;
  axis.on('stoppedchange',event=>states.push(event.isStopped));
  const invalidate=chart.invalidate.bind(chart);chart.invalidate=()=>{invalidations++;invalidate();};
  axis.setInterval({stopAxisAfter:false});
  assert.deepEqual(states,[false]);assert.ok(invalidations>0);
  chart.renderNow();assert.deepEqual(axis.getInterval(),{start:0,end:4997.5});
  axis.setInterval({stopAxisAfter:false});assert.deepEqual(states,[false]);
 }finally{chart.dispose();}
});

test('a stopped-state listener error does not prevent scheduling the new interval',()=>{
 const chart=new ChartXY(),axis=chart.axisX;
 try{
  axis.setInterval({start:1,end:2,stopAxisAfter:true});let invalidations=0;
  chart.invalidate=()=>{invalidations++;};
  axis.on('stoppedchange',()=>{throw new Error('listener failed');});
  assert.throws(()=>axis.setInterval({start:2,end:3,stopAxisAfter:false}),/listener failed/);
  assert.deepEqual(axis.getInterval(),{start:2,end:3});assert.equal(axis.getStopped(),false);
  assert.ok(invalidations>0);
 }finally{chart.dispose();}
});
