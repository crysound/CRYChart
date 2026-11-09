import test from 'node:test';
import assert from 'node:assert/strict';
import {BoxSeries, OHLCSeries, PolygonSeries, RangeSeries, RectangleSeries, SegmentSeries} from '../src/geometry.js';
import {ColorHEX, SolidFill} from '../src/core/styles.js';

function host(start = 0, end = 10) {
  let invalidations = 0, removed = 0;
  const axis = {type: 'linear', inverted: false, getInterval: () => ({start, end}), valueToFraction: (value: number) => (value - start) / (end - start)};
  return {invalidate: () => {invalidations++;}, removeSeries: () => {removed++;}, getDefaultAxisX: () => axis, getDefaultAxisY: () => axis, get invalidations() {return invalidations;}, get removed() {return removed;}};
}
function context() {
  const calls = {rects: 0, fills: 0, strokes: 0, bodies: 0, largestFilledPath:0,filledRectangles:0, points: [] as number[][]};let pathRectangles=0;
  const check = (...values: number[]) => values.forEach(value => assert.ok(Number.isFinite(value)));
  const ctx = {
    save() {}, restore() {}, beginPath() {pathRectangles=0;}, closePath() {}, clip() {}, setLineDash() {},
    rect(...values: number[]) {check(...values); calls.rects++;pathRectangles++;},
    fillRect(...values: number[]) {check(...values); calls.bodies++;}, strokeRect(...values: number[]) {check(...values);},
    moveTo(...values: number[]) {check(...values); calls.points.push(values);}, lineTo(...values: number[]) {check(...values); calls.points.push(values);},
    fill() {calls.fills++;calls.largestFilledPath=Math.max(calls.largestFilledPath,pathRectangles);calls.filledRectangles+=pathRectangles;}, stroke() {calls.strokes++;},
  } as unknown as CanvasRenderingContext2D;
  return {ctx, calls};
}
const rect = {left: 0, top: 0, width: 100, height: 100};

test('rectangle dimensions, negative sizes and item mutation preserve correct bounds', () => {
  const series = new RectangleSeries(host());
  const figure = series.add({x: 5, y: 7, width: -3, height: -2});
  assert.deepEqual(figure.getBoundaries(), {start: {x: 2, y: 5}, end: {x: 5, y: 7}});
  assert.deepEqual(series.bounds('x'), {start: 2, end: 5});
  figure.setPosition({x: 8, y: 9}); assert.deepEqual(series.bounds('x'), {start: 5, end: 8});
  figure.setBounds({x1: 1, y1: 2, x2: 3, y2: 4});
  assert.deepEqual(figure.getDimensionsPositionAndSize(), {x: 1, y: 2, width: 2, height: 2});
  const {ctx, calls} = context(); series.draw(ctx, rect);
  assert.equal(calls.fills, 1);
  const hit = series.hitTest({x: 20, y: 70}, rect);
  assert.equal(hit.series, series); assert.equal(hit.figure.index, figure.index);
});

test('clear invalidates retained item handles instead of editing a new row at the same slot', () => {
  const series = new RectangleSeries(host()), stale = series.addRectangle({x: 0, y: 0, width: 1, height: 1});
  series.clear(); const current = series.addRectangle({x: 7, y: 7, width: 1, height: 1});
  assert.equal(stale.isDisposed(), true);
  assert.throws(() => stale.setDimensions({x: 2, y: 2, width: 1, height: 1}), /cleared/);
  stale.dispose(); assert.equal(series.getSampleCount(), 1); assert.equal(current.isDisposed(), false);
  current.dispose().dispose(); assert.equal(series.getSampleCount(), 0);
});

test('100k rectangles retain every input and bound Canvas path complexity without allocating per-item styles', () => {
  const parent = host(0, 100_000), series = new RectangleSeries(parent);
  const input = Array.from({length: 100_000}, (_, x) => ({x, y: 0, width: .8, height: 50_000}));
  series.add(input);
  assert.equal(series.getSampleCount(), 100_000); assert.equal(parent.invalidations, 1);
  assert.ok(series.rows.values instanceof Float64Array); assert.equal(series.itemStyles.size, 0);
  const {ctx, calls} = context(); series.draw(ctx, {left: 0, top: 0, width: 1000, height: 200});
  assert.ok(calls.largestFilledPath<=256);assert.equal(calls.filledRectangles,100_000);assert.equal(calls.strokes,calls.fills);assert.equal(calls.rects,100_001);
  assert.deepEqual(series.bounds('x'), {start: 0, end: 99_999.8});
});

test('rectangle batching respects individual style boundaries and visibility', () => {
  const series = new RectangleSeries(host());
  series.addRectangle({x: 0, y: 0, width: 1, height: 1});
  series.addRectangle({x: 1, y: 0, width: 1, height: 1}).setFillStyle(new SolidFill({color: ColorHEX('#ff0000')}));
  series.addRectangle({x: 2, y: 0, width: 1, height: 1});
  series.addRectangle({x: 3, y: 0, width: 1, height: 1}).setVisible(false);
  const {ctx, calls} = context(); series.draw(ctx, rect);
  assert.equal(calls.fills, 3); assert.equal(calls.rects, 4);
});

test('range gaps separate filled regions and support both public data shapes', () => {
  const range = new RangeSeries(host());
  range.add([{position: 0, low: 1, high: 3}, {position: 1, low: 2, high: 4}, {position: 2, low: NaN, high: 5}, {x: 3, yLow: 1, yHigh: 6}, {x: 4, yLow: 2, yHigh: 5}]);
  const {ctx, calls} = context(); range.draw(ctx, rect);
  assert.equal(calls.fills, 2); assert.equal(calls.strokes, 4);
  assert.deepEqual(range.bounds('y'), {start: 1, end: 6});
  assert.throws(() => range.addArraysHighLow([1, 2], [1]), /equal length/);
  assert.equal(range.getSampleCount(), 5);
});

test('polygon and segment hit tests follow their geometry rather than bounding rectangles', () => {
  const parent = host(), polygon = new PolygonSeries(parent);
  polygon.add({points: [{x: 0, y: 0}, {x: 4, y: 0}, {x: 0, y: 4}]});
  assert.ok(polygon.hitTest({x: 10, y: 90}, rect));
  assert.equal(polygon.hitTest({x: 35, y: 65}, rect), undefined);
  const segment = new SegmentSeries(parent);
  segment.add([{start: {x: 0, y: 0}, end: {x: 10, y: 10}}]);
  const hit = segment.hitTest({x: 50, y: 50}, rect);
  assert.equal(hit.x, 5); assert.equal(hit.y, 5);
  assert.equal(segment.hitTest({x: 50, y: 80}, rect), undefined);
});

test('OHLC packing preserves original row count and combines close screen-space samples', () => {
  const series = new OHLCSeries(host(0, 100));
  series.add(Array.from({length: 10}, (_, i) => ({x: i / 10, open: 2, high: 5 + i, low: 1, close: 4})));
  const a = context(); series.draw(a.ctx, rect); assert.equal(a.calls.bodies, 10);
  series.setPackData(true); const b = context(); series.draw(b.ctx, rect); assert.equal(b.calls.bodies, 1);
  assert.equal(series.getSampleCount(), 10); assert.deepEqual(series.bounds('y'), {start: 1, end: 14});
});

test('box statistics include extremes, draw the median and support explicit end points', () => {
  const series = new BoxSeries(host());
  const figure = series.add({start: 2, end: 4, lowerExtreme: 1, lowerQuartile: 3, median: 4, upperQuartile: 5, upperExtreme: 8});
  const {ctx, calls} = context(); series.draw(ctx, rect);
  assert.equal(calls.bodies, 1); assert.deepEqual(series.bounds('y'), {start: 1, end: 8});
  assert.ok(calls.points.some(([x, y]) => x === 20 && y === 60));
  figure.setDimensions({x: 5, min: 0, lowerQuartile: 2, median: 3, upperQuartile: 4, max: 9});
  assert.deepEqual(series.bounds('y'), {start: 0, end: 9});
});
