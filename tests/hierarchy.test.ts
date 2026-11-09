import test from 'node:test';
import assert from 'node:assert/strict';
import {Funnel, FunnelSliceModes, Pyramid, SunBurstChart, hierarchyWeight, layoutStages, layoutSunburst, type HierarchyNode} from '../src/hierarchy.js';
import {ColorHEX, SolidFill} from '../src/core/styles.js';

function context() {
  const calls = {fills: 0, text: [] as string[], arcs: 0, gradients: 0, strokes: 0};
  const check = (...values: number[]) => values.forEach(value => assert.ok(Number.isFinite(value)));
  const ctx = {
    save() {}, restore() {}, setLineDash() {}, beginPath() {}, closePath() {}, clip() {}, stroke() {},
    setTransform(...values: number[]) {check(...values);}, clearRect(...values: number[]) {check(...values);},
    fillRect(...values: number[]) {check(...values);}, strokeRect(...values: number[]) {check(...values);},
    moveTo(...values: number[]) {check(...values);}, lineTo(...values: number[]) {check(...values);}, rect(...values: number[]) {check(...values);},
    translate(...values: number[]) {check(...values);}, rotate(...values: number[]) {check(...values);},
    arc(...values: any[]) {check(...values.filter(value => typeof value === 'number')); calls.arcs++;},
    fill() {calls.fills++;}, measureText(value: string) {return {width: value.length * 6};},
    fillText(value: string, ...values: number[]) {check(...values); calls.text.push(value);},
    strokeText(_value: string, ...values: number[]) {check(...values); calls.strokes++;},
    createLinearGradient(...values: number[]) {check(...values); calls.gradients++; return {addColorStop(offset: number) {assert.ok(offset >= 0 && offset <= 1);}};},
  } as unknown as CanvasRenderingContext2D;
  return {ctx, calls};
}
const nodes: HierarchyNode[] = [{name: 'A', children: [{name: 'A1', value: 2}, {name: 'A2', value: 3}]}, {name: 'B', value: 5}, {name: 'Zero', value: 0}];
const options = {headless: true, width: 640, height: 400};

test('sunburst child angles partition their parent and root values close one complete turn', () => {
  const arcs = layoutSunburst(nodes), parent = arcs.find(arc => arc.node.name === 'A')!, child1 = arcs.find(arc => arc.node.name === 'A1')!, child2 = arcs.find(arc => arc.node.name === 'A2')!;
  assert.equal(hierarchyWeight(nodes[0]), 5);
  assert.ok(Math.abs(parent.end - parent.start - Math.PI) < 1e-12);
  assert.equal(child1.start, parent.start); assert.equal(child1.end, child2.start); assert.equal(child2.end, parent.end);
  assert.ok(Math.abs((child1.end - child1.start) / (parent.end - parent.start) - .4) < 1e-12);
  assert.equal(arcs.some(arc => arc.node.name === 'Zero'), false);
  assert.equal(layoutSunburst(nodes, {maxDepth: 1}).length, 2);
});

test('sunburst actual sector hit drills down and center hit returns without mutating source', () => {
  const chart = new SunBurstChart(options).setData(nodes), {ctx, calls} = context();
  let focusChanges = 0; chart.on('focuschange', () => {focusChanges++;});
  chart.render(ctx); assert.ok(calls.fills >= 4);
  chart.activateAt({x: 380, y: 200}); assert.deepEqual(chart.getPath(), ['A']);
  chart.render(ctx); chart.activateAt({x: 320, y: 200}); assert.deepEqual(chart.getPath(), []);
  assert.equal(focusChanges, 2); assert.equal(nodes[0].children![0].value, 2);
  const copy = chart.getData(); copy[0].children![0].value = 99;
  assert.equal(chart.getData()[0].children![0].value, 2);
});

test('hierarchy input rejects cycles and bad values while retaining the previous data', () => {
  const chart = new SunBurstChart(options).setData(nodes);
  const cyclic: HierarchyNode = {name: 'Cycle'}; cyclic.children = [cyclic];
  assert.throws(() => chart.setData(cyclic), /cycle/);
  assert.throws(() => chart.setData({name: 'Bad', value: Infinity}), /finite/);
  assert.deepEqual(chart.getData().map(node => node.name), ['A', 'B', 'Zero']);
});

test('focused sunburst retains the parent annulus, radial labels and an operable header return', () => {
  const chart = new SunBurstChart(options).setData(nodes).setTitle('Inventory').setLabelOrientation('radial').setCenterLabelVisible(false)
    .setHoleFillStyle(new SolidFill({color: ColorHEX('#333333')})).setLabelEffect(true).drillDown('A');
  const {ctx, calls} = context(); chart.render(ctx);
  assert.equal(calls.fills, 4); // Hole plus A, A1 and A2.
  for (const label of ['A', 'A1', 'A2']) assert.ok(calls.text.includes(label));
  assert.equal(calls.strokes, 3); assert.ok(calls.text.some(label => label.includes('Go Back')));
  chart.activateAt({x: 15, y: 15}); assert.deepEqual(chart.getPath(), []);
});

test('height mode encodes value as height while width mode uses equal-height stages', () => {
  const rect = {left: 0, top: 0, width: 200, height: 400};
  const height = layoutStages([1, 3], rect, {kind: 'funnel', mode: 0, headWidth: 100, neckWidth: 20});
  assert.equal(height[0].points[0].y, 0); assert.equal(height[0].points[2].y, 100); assert.equal(height[1].points[2].y, 400);
  assert.equal(height[0].points[1].x - height[0].points[0].x, 200);
  assert.ok(Math.abs(height[0].points[2].x - height[0].points[3].x - 160) < 1e-12);
  const width = layoutStages([1, 3], rect, {kind: 'pyramid', mode: 1});
  assert.equal(width[0].points[2].y, 200); assert.equal(width[1].points[2].y, 400);
  assert.ok(Math.abs((width[0].points[2].x - width[0].points[3].x) / 200 - 1 / 4) < 1e-12);
  const observed = layoutStages([3, 5, 10, 17], {left: 0, top: 0, width: 350, height: 400}, {kind: 'pyramid', mode: 1});
  assert.deepEqual(observed.map(stage => Math.round(stage.points[2].x - stage.points[3].x)), [30, 80, 180, 350]);
  assert.deepEqual(layoutStages([0, 0], rect, {kind: 'funnel'}), []);
});

test('funnel slice mutation, visibility and style affect actual drawing and stale handles expire', () => {
  const funnel = new Funnel(options), first = funnel.addSlice('First', 1), second = funnel.addSlice('Second', 3);
  first.setValue(2).setFillStyle(new SolidFill({color: ColorHEX('#ff0000')}));
  funnel.setSliceMode(FunnelSliceModes.VariableWidth).setHeadWidth(150).setNeckWidth(-1);
  assert.equal(funnel.getHeadWidth(), 100); assert.equal(funnel.getNeckWidth(), 0); assert.equal(funnel.getFunnelSliceMode(), 1);
  const a = context(); funnel.render(a.ctx); assert.equal(a.calls.fills, 2);
  second.setVisible(false); const b = context(); funnel.render(b.ctx); assert.equal(b.calls.fills, 1);
  assert.ok(b.calls.text.some(value => value.includes('100.0%')));
  funnel.setData([{name: 'New', value: 4}]); assert.equal(first.isDisposed(), true);
  assert.throws(() => first.setValue(8), /replaced/);
  assert.equal(funnel.getSlices()[0].getValue(), 4);
});

test('pyramid supports nested stage focus and copied records', () => {
  const chart = new Pyramid(options).setData(nodes);
  assert.equal(chart.getNeckWidth(), 0);
  chart.drillDown('A'); assert.deepEqual(chart.getPath(), ['A']);
  const {ctx, calls} = context(); chart.render(ctx);
  assert.equal(calls.fills, 2); assert.ok(calls.text.some(text => text.includes('A1')));
  chart.drillUp(); assert.deepEqual(chart.getPath(), []);
  const aggregate = chart.getSlices()[0]; assert.throws(() => aggregate.setValue(10), /derived/);
  chart.dispose(); assert.equal(aggregate.isDisposed(), true);
});

test('stage gradient and left label layout draw valid polygons with visible spacing', () => {
  const chart = new Funnel(options).setTitle('Contacts').setData([{name: 'Prospects', value: 2000}, {name: 'Customers', value: 549}])
    .setSliceMode('VariableWidth').setSliceGradient(true).setSliceSpacing(4).setLabelPosition('left').setSliceEffect(true);
  const {ctx, calls} = context(); chart.render(ctx);
  assert.equal(calls.fills, 2); assert.equal(calls.gradients, 2);
  assert.ok(calls.text.some(label => label.includes('Prospects')));
});
