import test from 'node:test';
import assert from 'node:assert/strict';
import {ChartXY} from '../src/chart.js';
import {measureAxisCanvasLayout} from '../src/axis-canvas.js';
import {AxisTickStrategies,FontSettings,SolidLine,emptyFill} from '../src/core/styles.js';

// These are local layout regressions, not new Native pixel observations.
function fixture() {
  const chart=new ChartXY({legend:{visible:false}}).setTitle('');
  chart.resize(680,420);
  const axis=chart.getDefaultAxisY().setTickStrategy(AxisTickStrategies.Empty)
    .setTitle('Actual horizontal channel title').setTitleRotation(0)
    .setTitleFont(new FontSettings({size:14,weight:600}));
  return {chart,axis};
}
function metrics(chart:ChartXY,axis:ChartXY['axisY']) {
  const axes=chart.getAxes();
  return measureAxisCanvasLayout(undefined,axes.filter(a=>a.direction==='x'),axes.filter(a=>a.direction==='y')).axes.get(axis)!;
}

test('Empty title-only axes measure real title content without automatic tick or label budgets',()=>{
  const {chart,axis}=fixture();
  try {
    const series=chart.addLineSeries({axisY:axis}).add([{x:0,y:0},{x:1,y:1}]);
    const m=metrics(chart,axis);
    assert.equal(m.measured,true);
    assert.equal(m.tickLength,0);
    assert.equal(m.labelOffset,0);
    assert.equal(m.labelWidth,0);
    assert.ok(m.titleWidth>0);
    assert.ok(m.titleOffset>=m.titleWidth/2,'The actual horizontal title stays outside its axis');
    assert.ok(m.laneSize>=54,'Existing vertical lane floor remains');
    chart.renderNow();
    assert.equal(axis.getVisible(),true);
    assert.ok(chart.getAxes().includes(axis));
    assert.equal(series.getAxisY(),axis);
    assert.equal(series.getSampleCount(),2);
  } finally {chart.dispose();}
});

test('default-font Empty titles also use measured title-only metrics instead of the Numeric fast-path budget',()=>{
  const chart=new ChartXY();
  try {
    const axis=chart.getDefaultAxisY().setTickStrategy(AxisTickStrategies.Empty).setTitle('Channel');
    const m=metrics(chart,axis);
    assert.equal(m.measured,true);
    assert.ok(m.titleWidth>0);
    assert.equal(m.labelOffset,0);
    assert.equal(m.tickLength,0);
  } finally {chart.dispose();}
});

test('live CustomTicks retain the existing branch and hide/dispose restores only the title-only budget',()=>{
  const {chart,axis}=fixture();
  try {
    const onlyTitle=metrics(chart,axis);
    const tick=axis.addCustomTick().setValue(.5).setTextFormatter(()=> 'Threshold');
    const withTick=metrics(chart,axis);
    assert.ok(withTick.labelOffset>0);
    assert.ok(withTick.tickLength>0);
    assert.ok(withTick.laneSize>onlyTitle.laneSize);
    tick.setVisible(false);
    assert.deepEqual(metrics(chart,axis),onlyTitle);
    tick.setVisible(true);
    assert.deepEqual(metrics(chart,axis),withTick);
    tick.dispose();
    assert.deepEqual(metrics(chart,axis),onlyTitle);
  } finally {chart.dispose();}
});

test('Numeric metrics restore exactly after a temporary Empty title-only strategy',()=>{
  const {chart,axis}=fixture();
  try {
    axis.setTickStrategy(AxisTickStrategies.Numeric);
    const numeric=metrics(chart,axis);
    assert.ok(numeric.tickLength>0);
    assert.ok(numeric.labelOffset>0);
    axis.setTickStrategy(AxisTickStrategies.Empty);
    assert.equal(metrics(chart,axis).labelOffset,0);
    axis.setTickStrategy(AxisTickStrategies.Numeric);
    assert.deepEqual(metrics(chart,axis),numeric);
  } finally {chart.dispose();}
});

test('two Empty titled stacks retain visible stroke, axis identity and unchanged physical stack allocation',()=>{
  const {chart,axis}=fixture();
  try {
    const lower=chart.addAxisY({iStack:-1}).setTickStrategy(AxisTickStrategies.Empty)
      .setTitle('Actual lower channel title').setTitleRotation(0)
      .setTitleFont(new FontSettings({size:14,weight:600}));
    axis.setStrokeStyle(new SolidLine({thickness:2}));
    const upperSeries=chart.addLineSeries({axisY:axis}).add([{x:0,y:0},{x:1,y:1}]);
    const lowerSeries=chart.addLineSeries({axisY:lower}).add([{x:0,y:0},{x:1,y:1}]);
    chart.renderNow();
    const ranges=[axis.getScreenRange(),lower.getScreenRange()];
    for(const a of[axis,lower]) {
      assert.equal(metrics(chart,a).tickLength,0);
      assert.equal(metrics(chart,a).labelOffset,0);
      assert.ok(metrics(chart,a).titleWidth>0);
      assert.equal(a.getVisible(),true);
    }
    axis.setTickStrategy(AxisTickStrategies.Numeric);
    lower.setTickStrategy(AxisTickStrategies.Numeric);
    chart.renderNow();
    assert.deepEqual([axis.getScreenRange(),lower.getScreenRange()],ranges);
    assert.equal(upperSeries.getAxisY(),axis);
    assert.equal(lowerSeries.getAxisY(),lower);
  } finally {chart.dispose();}
});

test('empty or invisible titles do not enter the new title-only branch',()=>{
  const chart=new ChartXY();
  try {
    const axis=chart.getDefaultAxisY().setTickStrategy(AxisTickStrategies.Empty).setTitle('');
    const noTitle=metrics(chart,axis);
    assert.equal(noTitle.measured,false);
    assert.ok(noTitle.labelOffset>0);
    axis.setTitle('Invisible channel').setTitleFillStyle(emptyFill);
    assert.equal(metrics(chart,axis).measured,false);
    assert.equal(metrics(chart,axis).labelOffset,noTitle.labelOffset);
  } finally {chart.dispose();}
});
