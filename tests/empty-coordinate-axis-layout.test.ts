import test from 'node:test';
import assert from 'node:assert/strict';
import {ChartXY} from '../src/chart.js';
import {AxisTickStrategies, SolidLine, emptyLine} from '../src/core/styles.js';

// Three XY lane regressions; Native evidence concerns the original component
// coordinate-only axes, not arbitrary decoration sizes or non-XY layouts.
const SIZE = {width: 680, height: 420};
const PADDING = {left: 7, right: 7, top: 4, bottom: 7};
function fixture() {
  const chart = new ChartXY({legend: {visible: false}})
    .setTitle('').setPadding(PADDING);
  chart.resize(SIZE.width, SIZE.height);
  chart.getDefaultAxisX().setInterval({start: 0, end: 10, stopAxisAfter: true});
  chart.getDefaultAxisY().setInterval({start: 0, end: 1, stopAxisAfter: true});
  return chart;
}
function rightMargin(chart: ChartXY, series: Parameters<ChartXY['getSeriesScreenRect']>[0]) {
  chart.renderNow();
  const rect = chart.getSeriesScreenRect(series);
  return SIZE.width - PADDING.right - rect.left - rect.width;
}
function leftMargin(chart: ChartXY, series: Parameters<ChartXY['getSeriesScreenRect']>[0]) {
  chart.renderNow();
  return chart.getSeriesScreenRect(series).left - PADDING.left;
}
function bottomMargin(chart: ChartXY, series: Parameters<ChartXY['getSeriesScreenRect']>[0]) {
  chart.renderNow();
  const rect = chart.getSeriesScreenRect(series);
  return SIZE.height - PADDING.bottom - rect.top - rect.height;
}

test('right Empty coordinate axis removes the 60px lane and 22px blank margin without losing identity or binding', () => {
  const chart = fixture();
  try {
    const axis = chart.addAxisY({opposite: true})
      .setInterval({start: 0, end: 1, stopAxisAfter: true});
    const series = chart.addLineSeries({axisY: axis}).add([{x: 0, y: 0}, {x: 10, y: 1}]);
    const numeric = rightMargin(chart, series);
    const leftNumeric = leftMargin(chart, series);
    const bottomNumeric = bottomMargin(chart, series);
    assert.ok(numeric > 0 && numeric < 60, `Compact Numeric right-axis lane expected < 60, got ${numeric}`);
    axis.setTickStrategy(AxisTickStrategies.Empty).setTitle('').setStrokeStyle(emptyLine);
    assert.equal(rightMargin(chart, series), 0);
    assert.equal(leftMargin(chart, series), leftNumeric, 'Visible Numeric left-axis lane is unchanged');
    assert.equal(bottomMargin(chart, series), bottomNumeric, 'Visible Numeric bottom-axis lane is unchanged');
    assert.equal(axis.getVisible(), true);
    assert.ok(chart.getAxes().includes(axis));
    assert.equal(series.getAxisY(), axis);
    assert.deepEqual(axis.getInterval(), {start: 0, end: 1});
    axis.setTitle('Right channel');
    assert.ok(rightMargin(chart, series) >= 20);
    axis.setTitle('');
    const tick = axis.addCustomTick().setValue(0.5).setTextFormatter(() => 'Threshold');
    assert.ok(rightMargin(chart, series) >= 50);
    tick.setVisible(false);
    assert.equal(rightMargin(chart, series), 0);
    tick.setVisible(true);
    assert.ok(rightMargin(chart, series) >= 50);
    tick.dispose();
    assert.equal(rightMargin(chart, series), 0);
    axis.setStrokeStyle(new SolidLine({thickness: 1}));
    assert.ok(rightMargin(chart, series) >= 1, 'Visible axis stroke is real lane content');
    axis.setStrokeStyle(emptyLine).setTickStrategy(AxisTickStrategies.Numeric);
    assert.equal(rightMargin(chart, series), numeric);
  } finally { chart.dispose(); }
});

test('primary Empty Y removes only its blank 66px lane while titles, CustomTicks and strokes retain space', () => {
  const chart = fixture();
  try {
    const axis = chart.getDefaultAxisY();
    const series = chart.addLineSeries().add([{x: 0, y: 0}, {x: 10, y: 1}]);
    const numeric = leftMargin(chart, series);
    const bottomNumeric = bottomMargin(chart, series);
    assert.ok(numeric > 0 && numeric < 60, `Compact Numeric left-axis lane expected < 60, got ${numeric}`);
    axis.setTickStrategy(AxisTickStrategies.Empty).setTitle('').setStrokeStyle(emptyLine);
    assert.equal(leftMargin(chart, series), 0);
    assert.equal(bottomMargin(chart, series), bottomNumeric);
    assert.equal(axis.getVisible(), true);
    assert.ok(chart.getAxes().includes(axis));
    assert.equal(series.getAxisY(), axis);
    assert.deepEqual(axis.getInterval(), {start: 0, end: 1});
    axis.setTitle('Actual channel name');
    assert.ok(leftMargin(chart, series) >= 20, 'TimeWave channel-title Empty axes must remain');
    axis.setTitle('');
    const tick = axis.addCustomTick().setValue(0.5).setTextFormatter(() => 'Threshold');
    assert.ok(leftMargin(chart, series) >= 50);
    tick.dispose();
    assert.equal(leftMargin(chart, series), 0);
    axis.setStrokeStyle(new SolidLine({thickness: 1}));
    assert.ok(leftMargin(chart, series) >= 1);
    axis.setStrokeStyle(emptyLine).setTickStrategy(AxisTickStrategies.Numeric);
    assert.equal(leftMargin(chart, series), numeric);
  } finally { chart.dispose(); }
});

test('primary Empty bottom X removes its blank 53px lane and preserves the coordinate surface', () => {
  const chart = fixture();
  try {
    const axis = chart.getDefaultAxisX();
    const series = chart.addLineSeries().add([{x: 0, y: 0}, {x: 10, y: 1}]);
    const numeric = bottomMargin(chart, series);
    const leftNumeric = leftMargin(chart, series);
    assert.ok(numeric > 0 && numeric < 44, `Compact Numeric bottom-axis lane expected < 44, got ${numeric}`);
    axis.setTickStrategy(AxisTickStrategies.Empty).setTitle('').setStrokeStyle(emptyLine);
    assert.equal(bottomMargin(chart, series), 0);
    assert.equal(leftMargin(chart, series), leftNumeric);
    assert.equal(axis.getVisible(), true);
    assert.ok(chart.getAxes().includes(axis));
    assert.equal(series.getAxisX(), axis);
    assert.deepEqual(axis.getInterval(), {start: 0, end: 10});
    axis.setTitle('Actual time axis');
    assert.ok(bottomMargin(chart, series) >= 20);
    axis.setTitle('');
    const tick = axis.addCustomTick().setValue(5).setTextFormatter(() => 'Event');
    assert.ok(bottomMargin(chart, series) >= 25);
    tick.dispose();
    assert.equal(bottomMargin(chart, series), 0);
    axis.setStrokeStyle(new SolidLine({thickness: 1}));
    assert.ok(bottomMargin(chart, series) >= 1);
    axis.setStrokeStyle(emptyLine).setTickStrategy(AxisTickStrategies.Numeric);
    assert.equal(bottomMargin(chart, series), numeric);
  } finally { chart.dispose(); }
});
