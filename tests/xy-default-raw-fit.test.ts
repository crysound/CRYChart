import test from 'node:test';
import assert from 'node:assert/strict';
import {ChartXY} from '../src/chart.js';

// Native public interval + all 1,603,200 retained F64 extrema per channel:
// performance/actual-timewave-31s-v2-public-style-colors/
// actual-y-fit-margin-observation.json, SHA recorded in the regression receipt.
// These small extrema projections exercise the Axis policy; they do not replay
// or claim to replace the original full actual-consumer browser cohort.
const nativeY = [
  {channel: 'a', start: -0.8499949029142063, end: 0.8499948836452519},
  {channel: 'b', start: -0.8499985795643843, end: 0.8499987093567092},
] as const;

for (const observed of nativeY) {
  test(`default XY Y-fit matches observed Native TimeWave ${observed.channel} raw extrema and stays stable`, () => {
    const chart = new ChartXY();
    try {
      const y = chart.getDefaultAxisY().setAutoFit(true);
      const line = chart.addLineSeries();
      line.appendSamples({
        xValues: new Float64Array([0, 1, 2]),
        yValues: new Float64Array([observed.start, 0, observed.end]),
      });
      const expected = {start: observed.start, end: observed.end};
      for (let frame = 0; frame < 2; frame++) {
        chart.renderNow();
        assert.deepEqual(y.getInterval(), expected);
        assert.equal(y.getStopped(), false);
      }
      y.fit(false, false);
      for (let frame = 0; frame < 2; frame++) {
        chart.renderNow();
        assert.deepEqual(y.getInterval(), expected);
      }
      const data = line.getDataSet().readBack().data;
      assert.ok(data.yValues instanceof Float64Array);
      assert.deepEqual(Array.from(data.yValues), [observed.start, 0, observed.end]);
    } finally { chart.dispose(); }
  });
}

// Local regression of Root's default XY raw-bound policy. These deliberately
// simple exact values are not claimed to be a newly measured Native fixture.
// The actual TimeWave Native evidence remains in its original browser report.
test('default XY multiple points keep raw data bounds through automatic frames and fit requests', () => {
  const chart = new ChartXY();
  try {
    const axisX = chart.getDefaultAxisX().setAutoFit(true);
    const axisY = chart.getDefaultAxisY().setAutoFit(true);
    const line = chart.addLineSeries();
    line.appendSamples({xValues: new Float64Array([0, 1, 2]), yValues: new Float64Array([-2, 4, 1])});
    const check = () => {
      assert.deepEqual(axisX.getInterval(), {start: 0, end: 2});
      assert.deepEqual(axisY.getInterval(), {start: -2, end: 4});
      assert.equal(axisX.getStopped(), false);
      assert.equal(axisY.getStopped(), false);
      const data = line.getDataSet().readBack().data;
      assert.ok(data.xValues instanceof Float64Array);
      assert.ok(data.yValues instanceof Float64Array);
      assert.deepEqual(Array.from(data.xValues), [0, 1, 2]);
      assert.deepEqual(Array.from(data.yValues), [-2, 4, 1]);
    };
    chart.renderNow(); check();
    chart.renderNow(); check();
    axisX.fit(false, false); axisY.fit(false, false);
    chart.renderNow(); check();
    chart.renderNow(); check();
    line.appendSamples({xValues: new Float64Array([3]), yValues: new Float64Array([-4])});
    chart.renderNow();
    assert.deepEqual(axisX.getInterval(), {start: 0, end: 3});
    assert.deepEqual(axisY.getInterval(), {start: -4, end: 4});
    chart.renderNow();
    assert.deepEqual(axisX.getInterval(), {start: 0, end: 3});
    assert.deepEqual(axisY.getInterval(), {start: -4, end: 4});
  } finally { chart.dispose(); }
});

test('Legacy compatibility: explicit XY fit margins retain padding instead of using the new default policy', () => {
  // Explicit margins have not been added to the Native observation scope.
  const chart = new ChartXY();
  try {
    const x = chart.getDefaultAxisX().setAutoFit(true).setMargins(.05);
    const y = chart.getDefaultAxisY().setAutoFit(true).setMargins({start: .1, end: .2});
    chart.addLineSeries().appendSamples({xValues: new Float64Array([0, 10]), yValues: new Float64Array([0, 10])});
    for (let frame = 0; frame < 2; frame++) {
      chart.renderNow();
      assert.deepEqual(x.getInterval(), {start: -.5, end: 10.5});
      assert.deepEqual(y.getInterval(), {start: -1, end: 12});
    }
    x.fit(false, false); y.fit(false, false);
    chart.renderNow();
    assert.deepEqual(x.getInterval(), {start: -.5, end: 10.5});
    assert.deepEqual(y.getInterval(), {start: -1, end: 12});
  } finally { chart.dispose(); }
});
