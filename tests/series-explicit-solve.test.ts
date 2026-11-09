import test from 'node:test';
import assert from 'node:assert/strict';
import {ChartXY} from '../src/chart.js';

test('original curve preview can explicitly solve nodes while excluded from the automatic chart cursor',()=>{
  const chart=new ChartXY();
  try {
    chart.axisX.setInterval({start:0,end:480});
    chart.axisY.setInterval({start:-3,end:3});
    chart.renderNow();
    const series=chart.addPointLineAreaSeries({dataPattern:'ProgressiveX'})
      .setCursorEnabled(false)
      .appendSamples({xValues:[32,96,160,224],yValues:[1,1.125,1.25,1.375]});
    const client=chart.translateCoordinate({x:160,y:1.25},chart.coordsAxis,chart.coordsClient);
    for(const mode of ['show-nearest','show-all','show-pointed'] as const){
      const hit=series.solveNearest(client,mode);
      assert.ok(hit);
      assert.equal(hit.x,160);assert.equal(hit.y,1.25);assert.equal(hit.iSample,2);
    }
    assert.deepEqual(chart.solveNearest(client,'show-all'),[]);
    series.setCursorEnabled(true);
    assert.equal(chart.solveNearest(client,'show-all').length,1);
    series.setVisible(false);
    assert.equal(series.solveNearest(client),undefined);
    series.setVisible(true).clear();
    assert.equal(series.solveNearest(client),undefined);
    series.appendSamples({xValues:[160],yValues:[1.25]}).dispose();
    assert.equal(series.solveNearest(client),undefined);
  } finally {chart.dispose();}
});
