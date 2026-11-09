import test from 'node:test';
import assert from 'node:assert/strict';
import { ChartXY } from '../src/chart.js';
import type { Axis } from '../src/axis.js';

class MouseInput extends Event {
  readonly button = 2;
  readonly buttons = 0;
  readonly pointerId = 1;
  propagationStopped = false;
  constructor(type: string, readonly clientX: number, readonly clientY: number) {
    super(type, { bubbles: true, cancelable: true });
  }
  override stopPropagation() { this.propagationStopped = true; super.stopPropagation(); }
}

/** Minimal host boundary; hit testing, listeners and their original Event are real. */
class Overlay extends EventTarget {
  readonly parent = new EventTarget();
  getBoundingClientRect() { return { left: 37, top: 91 }; }
  setPointerCapture() {}
  releasePointerCapture() {}
  override dispatchEvent(event: Event) {
    const result = super.dispatchEvent(event);
    // Node EventTarget has no DOM tree. Browser bubbling is checked separately.
    if (event instanceof MouseInput && !event.propagationStopped) this.parent.dispatchEvent(event);
    return result;
  }
}

class Probe extends ChartXY {
  attach(overlay: Overlay) { Object.defineProperty(this, 'overlay', { value: overlay }); this.attachInteractions(); }
}

function setup() {
  const chart = new Probe({ legend: { visible: false } }).setTitle('');
  const overlay = new Overlay();
  chart.resize(960, 600); chart.attach(overlay);
  const send = (type: string, point: { x: number; y: number }) => {
    const event = new MouseInput(type, point.x + 37, point.y + 91);
    overlay.dispatchEvent(event); return event;
  };
  return { chart, overlay, send };
}

async function lanePoint(chart: ChartXY, axis: Axis) {
  const layout = await chart.getLayout(), line = layout.axes.get(axis);
  assert.ok(line, 'visible axis has a real layout entry');
  return axis.direction === 'x'
    ? { x: line.left + line.width / 2, y: chart.height - line.bottom + (axis.opposite ? -3 : 3) }
    : { x: line.left + (axis.opposite ? 3 : -3), y: line.top + line.height / 2 };
}

test('DOM contextmenu routes once to the actual bottom, top, left and right axis with the original event', async () => {
  const { chart, send } = setup();
  try {
    const axes = [chart.axisX, chart.addAxisX({ opposite: true }), chart.axisY, chart.addAxisY({ opposite: true })];
    const received = new Map<Axis, Event[]>();
    for (const axis of axes) axis.addEventListener('contextmenu', event => {
      const list = received.get(axis) ?? []; list.push(event); received.set(axis, list);
    });
    chart.resize(960, 600);
    for (const axis of axes) {
      received.clear();
      const point = await lanePoint(chart, axis), event = send('contextmenu', point);
      assert.deepEqual([...received.keys()], [axis]);
      assert.deepEqual(received.get(axis), [event]);
      assert.equal(event.defaultPrevented, true);
      assert.equal(event.clientX, point.x + 37); assert.equal(event.clientY, point.y + 91);
    }
  } finally { chart.dispose(); }
});

test('parallel and stacked axis menus retain their exact runtime axis identity', async () => {
  const { chart, send } = setup();
  try {
    chart.axisY.dispose();
    const upper = chart.addAxisY({ iStack: 0 });
    const lower = chart.addAxisY({ iStack: -1 });
    const parallel = chart.addAxisY({ iParallel: 1 });
    const received: Axis[] = [];
    for (const axis of [upper, lower, parallel]) axis.addEventListener('contextmenu', () => received.push(axis));
    chart.resize(960, 600);
    for (const axis of [upper, lower, parallel]) {
      received.length = 0; send('contextmenu', await lanePoint(chart, axis));
      assert.deepEqual(received, [axis]);
    }
  } finally { chart.dispose(); }
});

test('axis listeners can stop the original event before it reaches the card host', async () => {
  const { chart, overlay, send } = setup();
  let cards = 0, axes = 0; overlay.parent.addEventListener('contextmenu', () => cards++);
  try {
    chart.axisY.addEventListener('contextmenu', event => { axes++; event.preventDefault(); event.stopPropagation(); });
    const event = send('contextmenu', await lanePoint(chart, chart.axisY));
    assert.equal(axes, 1); assert.equal(cards, 0);
    assert.equal(event.defaultPrevented, true); assert.equal(event.propagationStopped, true);
    send('contextmenu', { x: chart.plot.left + chart.plot.width / 2, y: chart.plot.top + chart.plot.height / 2 });
    assert.equal(axes, 1); assert.equal(cards, 1);
  } finally { chart.dispose(); }
});

test('hidden, disposed and non-axis regions do not emit axis menus and dispose detaches DOM routing', async () => {
  const { chart, send } = setup(); let calls = 0;
  const right = chart.addAxisY({ opposite: true }); chart.resize(960, 600);
  const rightPoint = await lanePoint(chart, right);
  right.addEventListener('contextmenu', () => calls++);
  try {
    right.setVisible(false); send('contextmenu', rightPoint); assert.equal(calls, 0);
    right.setVisible(true); send('contextmenu', rightPoint); assert.equal(calls, 1);
    right.dispose(); send('contextmenu', rightPoint); assert.equal(calls, 1);
    chart.dispose(); send('contextmenu', rightPoint); assert.equal(calls, 1);
  } finally { chart.dispose(); }
});

test('axis subscriptions remove by identity without creating a second contextmenu dispatch', async () => {
  const { chart, send } = setup(); let calls = 0;
  const handler = () => calls++;
  try {
    chart.axisX.addEventListener('contextmenu', handler); chart.axisX.addEventListener('contextmenu', handler);
    const point = await lanePoint(chart, chart.axisX);
    send('contextmenu', point); assert.equal(calls, 1);
    chart.axisX.removeEventListener('contextmenu', handler);
    send('contextmenu', point); assert.equal(calls, 1);
  } finally { chart.dispose(); }
});

test('DOM hover transfers to the uniquely hit axis and clears over the plot', async () => {
  const { chart, send } = setup();
  try {
    const right = chart.addAxisY({ opposite: true }); chart.resize(960, 600);
    send('pointerenter', await lanePoint(chart, chart.axisY));
    assert.equal(chart.axisY.getEffectiveHighlight(), 1);
    assert.equal(chart.axisY.getHighlight(), 0, 'hover does not overwrite manual highlight');
    assert.equal(right.getEffectiveHighlight(), 0);
    send('pointermove', await lanePoint(chart, right));
    assert.equal(chart.axisY.getEffectiveHighlight(), 0); assert.equal(right.getEffectiveHighlight(), 1);
    right.setHighlightOnHover(false); assert.equal(right.getEffectiveHighlight(), 0);
    right.setHighlightOnHover(true); assert.equal(right.getEffectiveHighlight(), 1);
    send('pointermove', { x: chart.plot.left + chart.plot.width / 2, y: chart.plot.top + chart.plot.height / 2 });
    assert.ok([...chart.axesX, ...chart.axesY].every(axis => axis.getEffectiveHighlight() === 0));
  } finally { chart.dispose(); }
});

test('leave, cancel and lost capture clear axis hover', async () => {
  const { chart, send } = setup();
  try {
    for (const type of ['pointerleave', 'pointercancel', 'lostpointercapture']) {
      const point = await lanePoint(chart, chart.axisY);
      send('pointermove', point); assert.equal(chart.axisY.getEffectiveHighlight(), 1);
      send(type, point); assert.equal(chart.axisY.getEffectiveHighlight(), 0, type);
    }
  } finally { chart.dispose(); }
});

test('a legend-consumed pointer move clears previous axis hover', async () => {
  const { chart, send } = setup();
  const original = chart.legend.handlePointer;
  try {
    const point = await lanePoint(chart, chart.axisY);
    send('pointermove', point); assert.equal(chart.axisY.getEffectiveHighlight(), 1);
    chart.legend.handlePointer = type => type === 'pointermove';
    send('pointermove', point); assert.equal(chart.axisY.getEffectiveHighlight(), 0);
  } finally { chart.legend.handlePointer = original; chart.dispose(); }
});
