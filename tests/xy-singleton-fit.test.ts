import test from 'node:test';
import assert from 'node:assert/strict';
import {ChartXY} from '../src/chart.js';

// Default linear XY singleton intervals used by the trajectory regression.
const observations = [
  {point: {x: 0, y: 0}, x: {start: -1, end: 1}, y: {start: -1, end: 1}},
  {point: {x: 1, y: 2}, x: {start: 0, end: 2}, y: {start: 1, end: 3}},
  {point: {x: 10, y: 20}, x: {start: 9, end: 11}, y: {start: 19, end: 21}},
] as const;

function fixture() {
  const chart = new ChartXY();
  // These are the real public constructors used by TrajectoryChart.createSeries.
  const line = chart.addLineSeries();
  const endpoint = chart.addPointSeries();
  chart.axisX.setAutoFit(true);
  chart.axisY.setAutoFit(true);
  return {chart, line, endpoint};
}

function assertPoint(
  series: ReturnType<ChartXY['addLineSeries']>,
  point: {readonly x: number; readonly y: number},
) {
  const dataSet = series.getDataSet();
  const data = dataSet.readBack().data;
  assert.equal(series.getSampleCount(), 1);
  assert.equal(dataSet.getSampleCount(), 1);
  assert.deepEqual(series.getDataMapping(), {x: 'xValues', y: 'yValues'});
  assert.ok(data.xValues instanceof Float64Array);
  assert.ok(data.yValues instanceof Float64Array);
  assert.deepEqual(Array.from(data.xValues), [point.x]);
  assert.deepEqual(Array.from(data.yValues), [point.y]);
}

for (const observed of observations) {
  test(`default XY singleton (${observed.point.x},${observed.point.y}) keeps Native bounds through automatic frames, fit and clear/reinput`, () => {
    const {chart, line, endpoint} = fixture();
    try {
      const expected = () => {
        assert.deepEqual(chart.axisX.getInterval(), observed.x);
        assert.deepEqual(chart.axisY.getInterval(), observed.y);
        assert.equal(chart.axisX.getStopped(), false);
        assert.equal(chart.axisY.getStopped(), false);
        assertPoint(line, observed.point);
        assertPoint(endpoint, observed.point);
      };

      line.appendJSON([observed.point]);
      endpoint.appendJSON([observed.point]);
      chart.renderNow(); // Actual updateAuto path, without an explicit fit.
      expected();

      // Original Trajectory.renderBuffer requests these fits after appendJSON.
      chart.axisX.fit(false, false);
      chart.axisY.fit(false, false);
      expected();
      chart.renderNow();
      expected();
      chart.renderNow(); // A second automatic update must not add another margin.
      expected();

      line.clear();
      endpoint.clear();
      chart.renderNow();
      assert.equal(line.getDataSet().getSampleCount(), 0);
      assert.equal(endpoint.getDataSet().getSampleCount(), 0);
      line.appendJSON([observed.point]);
      endpoint.appendJSON([observed.point]);
      chart.axisX.fit(false, false);
      chart.axisY.fit(false, false);
      chart.renderNow();
      chart.renderNow();
      expected();
    } finally {
      chart.dispose();
    }
  });
}

test('explicit XY fit margins retain the existing Core policy, including explicitly supplied 0.05', () => {
  // This is a local compatibility regression, not a new Native observation.
  const {chart, line, endpoint} = fixture();
  try {
    chart.axisX.setMargins(.05);
    chart.axisY.setMargins({start: .1, end: .2});
    line.appendJSON([{x: 1, y: 2}]);
    endpoint.appendJSON([{x: 1, y: 2}]);
    chart.axisX.fit(false, false);
    chart.axisY.fit(false, false);
    const near = (actual: number, expected: number) =>
      assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);
    near(chart.axisX.getInterval().start, .945);
    near(chart.axisX.getInterval().end, 1.055);
    near(chart.axisY.getInterval().start, 1.88);
    near(chart.axisY.getInterval().end, 2.14);
    const before = [chart.axisX.getInterval(), chart.axisY.getInterval()];
    chart.renderNow();
    assert.deepEqual([chart.axisX.getInterval(), chart.axisY.getInterval()], before);
  } finally {
    chart.dispose();
  }
});

test('an explicit XY default interval takes precedence over the singleton rule', () => {
  // Native singleton evidence does not cover user-supplied default intervals.
  // Logarithmic, Polar and 3D preservation remains in chart3d-fit-margin tests.
  const {chart, line, endpoint} = fixture();
  try {
    line.appendJSON([{x: 1, y: 2}]);
    endpoint.appendJSON([{x: 1, y: 2}]);
    chart.axisX.setDefaultInterval({start: 30, end: 40, stopAxisAfter: true});
    // Public Native evidence: explicit fit-stop overrides defaultInterval.stopAxisAfter.
    // This case keeps the default range stopped; explicit false is covered separately.
    chart.axisX.fit(false, true);
    chart.renderNow();
    assert.deepEqual(chart.axisX.getInterval(), {start: 30, end: 40});
    assert.equal(chart.axisX.getStopped(), true);
    assertPoint(line, {x: 1, y: 2});
    assertPoint(endpoint, {x: 1, y: 2});
  } finally {
    chart.dispose();
  }
});
