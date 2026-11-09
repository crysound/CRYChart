// 白盒状态/布局检查读取保留的策略对象；公开类型getter由独立四型回归验证。
import test from 'node:test';
import assert from 'node:assert/strict';
import {layoutAxis3DTicks, type Axis3DTickRequest} from '../src/axis3d-label-layout';
import {Chart3D} from '../src/chart';

const measure = (value: string) => ({width: value.length * 6.4, actualBoundingBoxLeft: value.length * 3.2,
  actualBoundingBoxRight: value.length * 3.2, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2}) as TextMetrics;
const context = {measureText: measure};
const area = {left: 0, top: 32, width: 1060, height: 588};
const overlap = (a: {left: number; right: number; top: number; bottom: number}, b: typeof a) =>
  Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

test('shared negative endpoint labels retain both values and use available canvas margin without overlap', () => {
  const requests: Axis3DTickRequest[] = [
    {axis: 0, order: -1, text: '-10', preferred: {x: 520, y: 574}, tangent: {x: 200, y: -70}, outward: {x: 80, y: 200}},
    {axis: 1, order: -1, text: '-10', preferred: {x: 502, y: 563}, tangent: {x: 0, y: -300}, outward: {x: -180, y: 0}},
  ];
  const result = layoutAxis3DTicks(context, requests, area);
  assert.equal(result.labels.length, 2); assert.deepEqual(result.labels.map(label => label.text), ['-10', '-10']);
  assert.equal(result.unresolvedCount, 0); assert.equal(overlap(result.labels[0], result.labels[1]), 0);
  assert.ok(result.labels.every(label => label.left >= 2 && label.right <= 1058 && label.top >= 34 && label.bottom <= 618 && label.displacement <= 64));
  assert.ok(result.labels.some(label => label.bottom > 567), 'Canvas margin must not be clamped back into the old plot bottom.');
});

test('actual glyph overhang and zero descent are measured without replacing them by advance width or fallback descent', () => {
  let measurements = 0;
  const glyph = {measureText: () => {measurements++; return {width: 20, actualBoundingBoxLeft: 18, actualBoundingBoxRight: 6, actualBoundingBoxAscent: 11, actualBoundingBoxDescent: 0} as TextMetrics;}};
  const request: Axis3DTickRequest = {axis: 0, order: 0, text: 'italic', preferred: {x: 10, y: 30}, tangent: {x: 1, y: 0}, outward: {x: 0, y: 1}};
  const result = layoutAxis3DTicks(glyph, [request], {left: 0, top: 0, width: 120, height: 60});
  assert.equal(measurements, 1); assert.equal(result.labels[0].x, 20); assert.equal(result.labels[0].left, 2);
  assert.equal(result.labels[0].right, 26); assert.equal(result.labels[0].top, 19); assert.equal(result.labels[0].bottom, 30);
  assert.equal(result.labels[0].resolved, true);
});

test('axis order is retained for reverse projected directions and input order is preserved in returned labels', () => {
  const requests: Axis3DTickRequest[] = [4, 1, 3, 0, 2].map(order => ({axis: 0, order, text: String(order), preferred: {x: 220 - order * 40, y: 100 - order * 12}, tangent: {x: -40, y: -12}, outward: {x: 12, y: -40}}));
  requests.push({axis: 1, order: 0, text: '-100', preferred: {x: 140, y: 76}, tangent: {x: 0, y: -1}, outward: {x: -1, y: 0}});
  const before = JSON.stringify(requests), result = layoutAxis3DTicks(context, requests, {left: 0, top: 0, width: 300, height: 160});
  assert.equal(JSON.stringify(requests), before); assert.deepEqual(result.labels.map(label => label.text), requests.map(label => label.text));
  assert.equal(result.unresolvedCount, 0);
  const ordered = result.labels.filter(label => label.axis === 0).sort((a, b) => a.order - b.order);
  for (let i = 1; i < ordered.length; i++) {
    assert.ok(ordered[i].x * -40 + ordered[i].y * -12 > ordered[i - 1].x * -40 + ordered[i - 1].y * -12);
  }
  assert.deepEqual(layoutAxis3DTicks(context, requests, {left: 0, top: 0, width: 300, height: 160}), result);
});

test('unfittable labels remain present with an explicit unresolved result instead of omission or numeric changes', () => {
  const requests: Axis3DTickRequest[] = [0, 1].map(axis => ({axis, order: 0, text: '-123456789.125', preferred: {x: 10, y: 10}, tangent: {x: 1, y: 0}, outward: {x: 0, y: 1}}));
  const result = layoutAxis3DTicks(context, requests, {left: 0, top: 0, width: 20, height: 18});
  assert.equal(result.labels.length, requests.length); assert.equal(result.unresolvedCount, requests.length);
  assert.deepEqual(result.labels.map(label => label.text), requests.map(label => label.text));
  assert.ok(result.labels.every(label => [label.x, label.y, label.left, label.right, label.top, label.bottom].every(Number.isFinite)));
  assert.ok(result.labels.every(label => label.withinBounds === false));
});

test('a canvas clamp beyond the displacement budget is reported rather than certified as a resolved layout', () => {
  const result = layoutAxis3DTicks(context, [{axis: 0, order: 0, text: '-10', preferred: {x: -500, y: -500}, tangent: {x: 1, y: 0}, outward: {x: 0, y: 1}}], area);
  assert.equal(result.labels.length, 1); assert.equal(result.labels[0].withinBounds, true);
  assert.equal(result.labels[0].withinDisplacement, false); assert.equal(result.unresolvedCount, 1);
});

test('Chart3D keeps all signed endpoint ticks and titles legible at the default camera', () => {
  class Probe extends Chart3D {paint(context: CanvasRenderingContext2D) {this.drawSpecial(context);}}
  const labels: Array<{text: string; left: number; right: number; top: number; bottom: number}> = [];
  const canvas = new Proxy({measureText: measure, fillText: (text: string, x: number, y: number) => {const m = measure(text); labels.push({text, left: x - m.actualBoundingBoxLeft, right: x + m.actualBoundingBoxRight, top: y - m.actualBoundingBoxAscent, bottom: y + m.actualBoundingBoxDescent});}}, {
    get: (target, key) => key in target ? (target as any)[key] : () => {},
    set: (target, key, value) => {(target as any)[key] = value; return true;},
  }) as unknown as CanvasRenderingContext2D;
  const chart = new Probe({legend: {visible: false}}); chart.resize(1060, 620);
  const axes = [chart.axisX, chart.axisY, chart.axisZ];
  axes[0].setTitle('Trajectory X').setInterval({start: -10, end: 10});
  axes[1].setTitle('Trajectory Y').setInterval({start: -10, end: 10});
  axes[2].setTitle('Trajectory Z').setInterval({start: -5, end: 5});
  const values=[[-10,-5,0,5,10],[-10,-5,0,5,10],[-5,-2.5,0,2.5,5]];
  for(const[axisIndex,axis]of axes.entries())axis.tickStrategy.setCustomTickPlacement({major:()=>values[axisIndex].map(position=>({position,label:position.toFixed(1)})),minor:()=>[]});
  chart.renderNow(); chart.paint(canvas);
  const texts = values.flatMap(values=>values.map(value=>value.toFixed(1)));
  assert.deepEqual(labels.slice(0, texts.length).map(label => label.text), texts);
  assert.deepEqual(labels.slice(texts.length).map(label => label.text), ['Trajectory X', 'Trajectory Y', 'Trajectory Z']);
  assert.ok(labels.every(label => label.left >= 0 && label.right <= 1060 && label.top >= 32 && label.bottom <= 620));
  for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) {
    assert.equal(overlap(labels[i], labels[j]), 0, JSON.stringify({first: labels[i], second: labels[j]}));
  }
  assert.deepEqual(axes.map(axis => axis.getInterval()), [{start: -10, end: 10}, {start: -10, end: 10}, {start: -5, end: 5}]);
  chart.dispose();
});
