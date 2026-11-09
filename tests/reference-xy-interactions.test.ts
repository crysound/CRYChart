import test from 'node:test';
import assert from 'node:assert/strict';
import { ChartXY } from '../src/chart.js';

class Overlay extends EventTarget {
  getBoundingClientRect() { return { left: 0, top: 0 }; }
  setPointerCapture() {}
  releasePointerCapture() {}
}
class PointerChart extends ChartXY {
  attach(overlay: Overlay) { Object.defineProperty(this, 'overlay', { value: overlay }); this.attachInteractions(); }
}
const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) <= 2 * Number.EPSILON * Math.max(1, Math.abs(expected)));
function fixture() {
  const chart = new PointerChart(), overlay = new Overlay();
  chart.legend.setVisible(false); chart.resize(800, 400);
  chart.axisX.setInterval({ start: 0, end: 1000, stopAxisAfter: true });
  chart.axisY.setInterval({ start: 0, end: 1, stopAxisAfter: true });
  chart.attach(overlay);
  const event = (type: string, x: number, deltaY?: number) => Object.assign(new Event(type, { cancelable: true }), {
    clientX: chart.plot.left + x / 1000 * chart.plot.width,
    clientY: chart.plot.top + chart.plot.height / 2, button: 0, pointerId: 1, deltaY, deltaMode: 0,
  });
  const drag = () => { for (const [type, x] of [['pointerdown', 300], ['pointermove', 400], ['pointerup', 400]] as const) overlay.dispatchEvent(event(type, x)); };
  return { chart, overlay, event, drag };
}

for (const kind of ['band-interactions-disabled', 'band-pointer-disabled', 'constant-line-disabled'] as const) {
  test(`public chart undefined prevents fallback rectangle zoom beneath ${kind}`, () => {
    const { chart, drag } = fixture();
    try {
      const annotation = kind === 'constant-line-disabled' ? chart.axisX.addConstantLine().setValue(300)
        : chart.axisX.addBand().setValueStart(200).setValueEnd(500);
      annotation.setUserInteractions({ move: { drag: true }, scale: false });
      if (kind === 'band-pointer-disabled') annotation.setPointerEvents(false); else annotation.setUserInteractions(undefined);
      chart.setUserInteractions(undefined); drag();
      assert.deepEqual(chart.axisX.getInterval(), { start: 0, end: 1000 });
      assert.deepEqual(chart.axisY.getInterval(), { start: 0, end: 1 });
      if (kind === 'constant-line-disabled') assert.equal(annotation.getValue(), 300);
      else assert.deepEqual(annotation.getBounds(), { start: 200, end: 500 });
    } finally { chart.dispose(); }
  });
}

test('undefined disables chart wheel and restore without disabling independently enabled annotation drag', () => {
  const { chart, overlay, event, drag } = fixture();
  try {
    const band = chart.axisX.addBand().setValueStart(200).setValueEnd(500).setUserInteractions({ move: { drag: true }, scale: false });
    chart.setUserInteractions(undefined);
    const wheel = event('wheel', 300, 100); overlay.dispatchEvent(wheel);
    assert.equal(wheel.defaultPrevented, false); assert.deepEqual(chart.axisX.getInterval(), { start: 0, end: 1000 });
    overlay.dispatchEvent(event('dblclick', 300)); assert.deepEqual(chart.axisX.getInterval(), { start: 0, end: 1000 });
    drag(); close(band.getValueStart(), 300); close(band.getValueEnd(), 600);
    assert.deepEqual(chart.axisX.getInterval(), { start: 0, end: 1000 });
  } finally { chart.dispose(); }
});

test('empty object explicitly restores default chart routing after disable', () => {
  const { chart, drag } = fixture();
  try {
    chart.setUserInteractions(undefined); drag(); assert.deepEqual(chart.axisX.getInterval(), { start: 0, end: 1000 });
    chart.setUserInteractions({}); drag(); close(chart.axisX.getInterval().start, 300); close(chart.axisX.getInterval().end, 400);
  } finally { chart.dispose(); }
});
