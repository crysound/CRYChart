// 白盒状态/布局检查读取保留的策略对象；公开类型getter由独立四型回归验证。
import test from 'node:test';
import assert from 'node:assert/strict';
import {ChartXY, Polar} from '../src/chart';
import {Cursor} from '../src/ui';

// Canvas command oracle only. Browser tests independently inspect the actual
// marker text pixels and exported PNGs using the same public call sequence.
function drawing() {
  const labels: string[] = [];
  const context = new Proxy({
    measureText: (text: string) => ({width: String(text).length * 7}),
    fillText: (text: string) => labels.push(String(text)),
  }, {
    get: (target, key) => key in target ? (target as any)[key] : () => {},
    set: (target, key, value) => {(target as any)[key] = value; return true;},
  }) as unknown as CanvasRenderingContext2D;
  return {context, labels};
}
class Probe extends ChartXY {
  drawAt(point: {x: number; y: number}, context: CanvasRenderingContext2D) {
    this.pointer = this.translatePoint(point, this.coordsAxis, this.coordsPixel);
    this.drawCursor(context);
  }
}
function histogram() {
  const chart = new Probe({legend: {visible: false}}).setCursorMode('show-all');
  chart.axisX.setInterval({start: 0, end: 10}).setUnits('Hz');
  chart.axisY.setInterval({start: 0, end: 100}).setUnits('Pa');
  const voltage = chart.addAxisY({opposite: true}).setInterval({start: 0, end: 1000}).setUnits('mV');
  chart.addRectangleSeries().setName('Pressure').add([{x1: 4, x2: 5, y1: 0, y2: 40}]);
  chart.addRectangleSeries({axisY: voltage}).setName('Voltage').add([{x1: 4, x2: 5, y1: 0, y2: 600}]);
  chart.renderNow();
  return {chart, voltage};
}

test('default show-all marker formats use each position axis: 20 Pa and 300 mV', () => {
  const {chart, voltage} = histogram(), capture = drawing();
  chart.drawAt({x: 4.5, y: 80}, capture.context);
  const positions = chart.getCursor().getPositions();
  assert.deepEqual(positions.map(position => position.pointMarker), [{x: 4.5, y: 20}, {x: 4.5, y: 300}]);
  assert.equal(positions[0].pointMarkerScale.y, chart.axisY);
  assert.equal(positions[1].pointMarkerScale.y, voltage);
  assert.ok(capture.labels.includes('20 Pa'));
  assert.ok(capture.labels.includes('300 mV'));
  assert.ok(!capture.labels.includes('300 Pa'));
  chart.dispose();
});

test('independent X/Y cursor formatters transform original values and obey per-axis units visibility', () => {
  const chart = new Probe({legend: {visible: false}}).setCursorMode('show-all');
  chart.axisX.setInterval({start: 0, end: 10}).setUnits('Hz');
  chart.axisY.setInterval({start: 0, end: 100}).setUnits('Pa');
  chart.axisX.tickStrategy.setCursorFormatter((value: number) => `frequency:${value.toFixed(2)}`);
  chart.axisY.tickStrategy.setCursorFormatter((value: number) => `pressure:${value.toFixed(1)}`);
  const time = chart.addAxisX({opposite: true}).setInterval({start: 0, end: 10000}).setUnits('ms');
  time.tickStrategy.setCursorFormatter((value: number) => `seconds:${(value / 1000).toFixed(3)}`);
  const voltage = chart.addAxisY({opposite: true}).setInterval({start: 0, end: 1000}).setUnits('mV');
  voltage.tickStrategy.setCursorFormatter((value: number) => `volts:${(value / 1000).toFixed(4)}`);
  chart.addRectangleSeries().add([{x1: 4, x2: 5, y1: 0, y2: 40}]);
  chart.addRectangleSeries({axisX: time, axisY: voltage}).add([{x1: 4000, x2: 5000, y1: 0, y2: 600}]);
  chart.renderNow();
  const first = drawing(); chart.drawAt({x: 4.5, y: 80}, first.context);
  for (const label of ['frequency:4.50 Hz', 'pressure:20.0 Pa', 'seconds:4.500 ms', 'volts:0.3000 mV']) {
    assert.ok(first.labels.includes(label), JSON.stringify(first.labels));
  }
  voltage.setUnits('mV', {displayOnAxis: true, displayInCursor: false});
  const hidden = drawing(); chart.drawAt({x: 4.5, y: 80}, hidden.context);
  assert.ok(hidden.labels.includes('volts:0.3000'));
  assert.ok(!hidden.labels.some(label => label.includes('mV')));
  assert.deepEqual(chart.getCursor().getPositions()[1].pointMarker, {x: 4500, y: 300});
  chart.dispose();
});

test('detaching and restoring a custom handler does not replace native per-position formatters', () => {
  const {chart} = histogram(); let calls = 0;
  const handler = () => {calls++;};
  chart.setCustomCursor(handler);
  const custom = drawing(); chart.drawAt({x: 4.5, y: 80}, custom.context);
  assert.equal(calls, 1); assert.deepEqual(custom.labels, []);
  chart.setCustomCursor(undefined);
  const native = drawing(); chart.drawAt({x: 4.5, y: 80}, native.context);
  assert.ok(native.labels.includes('20 Pa')); assert.ok(native.labels.includes('300 mV'));
  const positions = chart.getCursor().getPositions();
  chart.getCursor().setVisible(false); const hidden = drawing(); chart.drawAt({x: 4.5, y: 80}, hidden.context);
  assert.deepEqual(hidden.labels, []); assert.deepEqual(chart.getCursor().getPositions(), positions);
  chart.getCursor().setVisible(true); const restored = drawing(); chart.drawAt({x: 4.5, y: 80}, restored.context);
  assert.ok(restored.labels.includes('300 mV'));
  chart.setCustomCursor(handler); const customAgain = drawing(); chart.drawAt({x: 4.5, y: 80}, customAgain.context);
  assert.equal(calls, 2); assert.deepEqual(customAgain.labels, []);
  chart.dispose();
});

test('explicit chart result-table formatting takes precedence; restoring default invokes each series independently', () => {
  const chart = new Probe({legend: {visible: false}}).setCursorMode('show-all');
  chart.axisX.setInterval({start: 0, end: 10}); chart.axisY.setInterval({start: 0, end: 100}).setUnits('Pa');
  const voltage = chart.addAxisY({opposite: true}).setInterval({start: 0, end: 1000}).setUnits('mV');
  const pressure = chart.addLineSeries().add([{x: 4.5, y: 20}]);
  chart.addLineSeries({axisY: voltage}).add([{x: 4.5, y: 300}]);
  chart.setCursorFormatting((_chart, _hit, hits) => [['consumer chart row', String(hits.length)]]);
  let seriesCalls = 0;
  pressure.setCursorFormattingOverride((hit, before) => {seriesCalls++; return [...before, ['consumer series row', String(hit.y)]];});
  chart.renderNow(); const capture = drawing(); chart.drawAt({x: 4.5, y: 80}, capture.context);
  // The explicit chart callback takes precedence over per-series callbacks.
  assert.deepEqual(chart.getCursor().getResultTable().getContent(), [['consumer chart row', '2']]);
  assert.equal(seriesCalls, 0);
  assert.ok(capture.labels.includes('20 Pa')); assert.ok(capture.labels.includes('300 mV'));
  pressure.setCursorFormattingOverride(() => undefined);
  chart.drawAt({x: 4.5, y: 80}, drawing().context);
  assert.deepEqual(chart.getCursor().getResultTable().getContent(), [['consumer chart row', '2']]);
  chart.setCursorFormatting(undefined);
  chart.drawAt({x: 4.5, y: 80}, drawing().context);
  const remaining = chart.getCursor().getResultTable().getContent();
  // Suppressing one series keeps the other hit's component/X/Y rows.
  assert.equal(remaining.length, 3); assert.equal(remaining[0][0].component.axisY,voltage);
  assert.equal(remaining[1].length,1);assert.equal(remaining[2].length,1);assert.equal(remaining[2][0].text, '300 mV');
  chart.dispose();
});

test('explicit Cursor.draw callbacks retain precedence and receive the original opaque position scale', () => {
  const token = Object.freeze({}), seen: unknown[] = [], cursor = new Cursor().setResultTableVisible(false);
  cursor.setPosition({pointMarker: {x: 15, y: 25}, pointMarkerScale: token});
  const capture = drawing();
  cursor.draw(capture.context, {left: 0, top: 0, width: 200, height: 100}, point => point, {
    x: value => `custom angle ${value / 3}`,
    y: (value, position) => {seen.push(position.pointMarkerScale); return `custom amplitude ${value - 40}`;},
  });
  assert.deepEqual(capture.labels, ['custom angle 5', 'custom amplitude -15']);
  assert.deepEqual(seen, [token]);
  cursor.dispose();
});

test('Polar bespoke direction and negative-amplitude formatting survives XY marker formatter changes', () => {
  class PolarProbe extends Polar {
    drawAt(context: CanvasRenderingContext2D) {this.pointer = this.projectPolarPoint({angle: 90, amplitude: -12.3456}); this.drawCursor(context);}
  }
  const chart = new PolarProbe({legend: {visible: false}});
  chart.getRadialAxis().setNorth(0).setClockwise(true).setUnits('deg');
  chart.getAmplitudeAxis().setInterval({start: -40, end: 0}).setUnits('dB');
  chart.getAmplitudeAxis().tickStrategy.setCursorFormatter((value: number) => value.toFixed(3));
  const series = chart.addPointSeries().setData([{angle: 90, amplitude: -12.3456}]);
  chart.renderNow(); chart.drawAt(drawing().context);
  const rows = chart.getCursor().getResultTable().getContent();
  assert.equal(rows[1][2].text, '90 deg'); assert.equal(rows[2][2].text, '-12.346 dB');
  series.setCursorFormattingOverride((_hit, before) => {before[2][2].text = 'consumer polar value'; return before;});
  const capture = drawing(); chart.drawAt(capture.context);
  assert.ok(capture.labels.some(label => label.includes('consumer polar value')));
  assert.equal(series.getData()[0].amplitude, -12.3456);
  chart.dispose();
});

test('Polar default cursor rounds degrees independently of the fitted Numeric interval and preserves explicit formatters', () => {
  // Cursor angles use degrees; radial formatValue accepts radians.
  class PolarProbe extends Polar {
    drawAt(angle:number) {this.pointer=this.projectPolarPoint({angle,amplitude:-12.3456});this.drawCursor(drawing().context);return this.getCursor().getResultTable().getContent();}
  }
  const chart=new PolarProbe({legend:{visible:false}});
  chart.getRadialAxis().setNorth(0).setClockwise(true).setUnits('deg');
  chart.getAmplitudeAxis().setInterval({start:-40,end:0}).setUnits('dB');
  const series=chart.addPointLineSeries();
  for(const [angle,expected] of [[40.1256789,'40 deg'],[90.25,'90 deg'],[135.000001,'135 deg'],[90.5,'91 deg'],[90.75,'91 deg'],[359.75,'360 deg']] as const){
    const original=[{angle:Math.max(0,angle-5),amplitude:-20},{angle,amplitude:-12.3456},{angle:Math.min(360,angle+5),amplitude:-24}];
    series.setData(original);chart.renderNow();
    assert.equal(chart.drawAt(angle)[1][2].text,expected);
    assert.deepEqual(series.getData(),original);
  }
  const observed:number[]=[];
  chart.getRadialAxis().tickStrategy.setCursorFormatter((value:number)=>{observed.push(value);return `raw:${value.toFixed(3)}`;});
  assert.equal(chart.drawAt(359.75)[1][2].text,'raw:359.750 deg');assert.ok(observed.length>0&&observed.every(value=>value===359.75));
  chart.getRadialAxis().tickStrategy.setCursorFormatter(undefined);
  assert.equal(chart.drawAt(359.75)[1][2].text,'360 deg');
  assert.equal(series.getData()[1].angle,359.75);chart.dispose();
});
