import test from 'node:test';
import assert from 'node:assert/strict';
import {DataSetXY, finiteExtent} from '../src/core/data.js';

function waveform(capacity?: number | {mode: 'auto'; initial?: number; max?: number}) {
  const dataset = new DataSetXY({schema: {
    xValues: {storage: Float64Array, pattern: 'progressive', auto: true},
    yValues: {storage: Float64Array}, renderYValues: {storage: Float32Array},
  }});
  if (capacity !== undefined) dataset.setMaxSampleCount(capacity);
  return dataset;
}
function append(dataset: DataSetXY, from: number, to: number, start?: number, step = .005) {
  const y = Float64Array.from({length: to - from}, (_, i) => from + i);
  dataset.appendSamples({yValues: y, renderYValues: y}, {step, ...(start === undefined ? {} : {start})});
}
function checkRows(dataset: DataSetXY, first: number, end: number, origin = 0, step = .005) {
  const {data, iSampleFirst} = dataset.readBack();
  assert.equal(dataset.getSampleCount(), end - first);
  assert.equal(dataset.getNextSampleIndex(), end);
  assert.equal(iSampleFirst, first);
  for (let i = 0; i < end - first; i++) {
    assert.ok(Math.abs(data.xValues[i] - (origin + (first + i) * step)) < 1e-8);
    assert.equal(data.yValues[i], first + i);
    assert.equal(data.renderYValues[i], first + i);
  }
}

test('automatic X ignores explicit input, continues across batches, and resets on clear', () => {
  const dataset = waveform();
  dataset.appendSamples({xValues: [7, 11, 19], yValues: [1, 2, 3], renderYValues: [1, 2, 3]});
  assert.deepEqual(Array.from(dataset.getColumn('xValues')), [0, 1, 2]);
  dataset.clear().appendSamples({yValues: [1, 2, 3]}, {start: 10, step: 2});
  dataset.setMaxSampleCount(3).appendSamples({yValues: [4, 5]}, {step: 2});
  assert.deepEqual(Array.from(dataset.readBack().data.xValues), [14, 16, 18]);
  dataset.clear().appendSamples({yValues: [1, 2]}, {start: 20, step: 2});
  assert.deepEqual(Array.from(dataset.getColumn('xValues')), [20, 22]);
  assert.equal(dataset.getNextSampleIndex(), 2);
});

test('unaligned wraps, oversized batches, and expansion preserve complete ordered rows', () => {
  const dataset = waveform(13);
  append(dataset, 0, 7, 0);
  append(dataset, 7, 100, .035);
  checkRows(dataset, 87, 100);
  append(dataset, 100, 104);
  checkRows(dataset, 91, 104);
  dataset.setMaxSampleCount(29);
  for (let start = 104; start < 180; start += 4) {
    append(dataset, start, start + 4);
    checkRows(dataset, Math.max(91, start + 4 - 29), start + 4);
  }
  assert.equal(dataset.getSample(0)?.yValues, 151);
  assert.equal(dataset.getSampleByIndex(151)?.yValues, 151);
  assert.equal(dataset.getSampleByIndex(150), undefined);
});

test('auto allocation grows within max while fixed capacity stays bounded', () => {
  const dataset = waveform(4);
  append(dataset, 0, 4, 0);
  dataset.setMaxSampleCount({mode: 'auto', max: 6});
  append(dataset, 4, 8);
  checkRows(dataset, 2, 8);
  assert.equal(dataset.getMaxSampleCount(), 6);
  append(dataset, 8, 10);
  checkRows(dataset, 4, 10);
  dataset.setMaxSampleCount(Infinity);
  append(dataset, 10, 100);
  assert.equal(dataset.getMaxSampleCount(), undefined);
  checkRows(dataset, 4, 100);
});

test('large sampling-origin coordinates retain double precision over ring boundaries', () => {
  const origin = 123.456, step = 1000 / 192000;
  const dataset = waveform(13);
  append(dataset, 0, 7, origin, step);
  for (let start = 7; start < 1000; start += 4) {
    append(dataset, start, start + 4, undefined, step);
    checkRows(dataset, Math.max(0, start + 4 - 13), start + 4, origin, step);
  }
});

test('non-finite raw samples and rendering gaps stay aligned without mutating input', () => {
  const dataset = waveform(4), raw = new Float64Array([1, Infinity, NaN, -Infinity, 5]);
  dataset.appendSamples({yValues: raw, renderYValues: [1, NaN, NaN, NaN, 5]}, {start: 10, step: 2});
  assert.deepEqual(Array.from(raw), [1, Infinity, NaN, -Infinity, 5]);
  assert.deepEqual(Array.from(dataset.readBack().data.yValues), [Infinity, NaN, -Infinity, 5]);
  assert.deepEqual(Array.from(dataset.readBack().data.renderYValues), [NaN, NaN, NaN, 5]);
  assert.deepEqual(Array.from(dataset.getColumn('xValues')), [12, 14, 16, 18]);
  assert.ok(dataset.getColumn('renderYValues') instanceof Float32Array);
  assert.deepEqual(finiteExtent(dataset.getColumn('yValues')), {min: 5, max: 5});
});

test('input validation is atomic; each batch emits once and invalidates cached columns', () => {
  const dataset = waveform(4);
  let calls = 0;
  const token = dataset.onChange(() => { calls++; });
  append(dataset, 0, 3, 0);
  const snapshot = dataset.getColumn('xValues'), revision = dataset.revision;
  assert.equal(dataset.getColumn('xValues'), snapshot);
  assert.throws(() => dataset.appendSamples({yValues: [1, 2], renderYValues: [1]}), /same length/);
  assert.equal(dataset.revision, revision);
  assert.equal(calls, 1);
  append(dataset, 3, 1000);
  assert.equal(calls, 2);
  assert.equal(dataset.revision, revision + 1);
  assert.notEqual(dataset.getColumn('xValues'), snapshot);
  assert.deepEqual(Array.from(snapshot), [0, .005, .01]);
  assert.ok(dataset.offChange(token));
  dataset.clear();
  assert.equal(calls, 2);
});

test('readBack range follows column values, returns owned typed storage and absolute first index', () => {
  const dataset = waveform(4);
  append(dataset, 0, 8, 100, 10);
  const result = dataset.readBack({onlyInRange: {key: 'xValues', start: 150, end: 160}});
  assert.deepEqual(Array.from(result.data.xValues), [150, 160]);
  assert.deepEqual(Array.from(result.data.yValues), [5, 6]);
  assert.equal(result.iSampleFirst, 5);
  result.data.yValues[0] = 999;
  assert.equal(dataset.getValue('yValues', 1), 5);
});

test('millions of discarded incoming rows need only bounded retained storage', () => {
  const dataset = waveform(17), count = 1_000_000;
  const input = Float64Array.from({length: count}, (_, i) => i);
  dataset.appendSamples({yValues: input, renderYValues: input}, {step: .5});
  assert.equal(dataset.getSampleCount(), 17);
  assert.equal(dataset.getNextSampleIndex(), count);
  assert.equal(dataset.getValue('xValues', 0), (count - 17) * .5);
  assert.equal(dataset.getValue('yValues', 16), count - 1);
});

test('addColumns preserves a wrapped ring, logical indices and automatic X continuation', () => {
  const dataset = waveform(3); dataset.appendSamples({yValues: [1, 2, 3]}, {start: 10, step: 2}).appendSamples({yValues: [4]});
  const oldSchema = dataset.schema, oldX = dataset.getColumn('xValues'), revision = dataset.revision; let events = 0;
  dataset.onChange(() => {events++;});
  const source = {size: {storage: Float32Array}, color: {storage: Uint32Array}};
  assert.equal(dataset.addColumns(source), dataset); assert.equal(dataset.revision, revision + 1); assert.equal(events, 1);
  assert.equal(dataset.getSampleCount(), 3); assert.equal(dataset.getNextSampleIndex(), 4); assert.equal(dataset.getMaxSampleCount(), 3);
  assert.deepEqual(Array.from(dataset.getColumn('xValues')), [12, 14, 16]); assert.deepEqual(Array.from(oldX), [12, 14, 16]);
  assert.ok(Array.from(dataset.getColumn('size')).every(Number.isNaN)); assert.deepEqual(Array.from(dataset.getColumn('color')), [0, 0, 0]);
  assert.equal(oldSchema.size, undefined); assert.notEqual(dataset.schema, oldSchema); assert.ok(Object.isFrozen(dataset.schema)); assert.ok(Object.isFrozen(dataset.schema.size)); assert.equal(Object.isFrozen(source.size), false);
  dataset.appendSamples({yValues: [5, 6], size: [8, 9], color: [0xff0000ff, 0x00ff00ff]}, {step: 2});
  assert.deepEqual(Array.from(dataset.getColumn('xValues')), [16, 18, 20]); assert.deepEqual(Array.from(dataset.getColumn('size')), [NaN, 8, 9]);
  assert.deepEqual(Array.from(dataset.getColumn('color')), [0, 0xff0000ff, 0x00ff00ff]); assert.equal(dataset.getNextSampleIndex(), 6);
});

test('addColumns is atomic, idempotent for existing columns and keeps floating and integer fills distinct', () => {
  const dataset = new DataSetXY().appendSamples({x: [1, 2], y: [3, 4]}), schema = dataset.schema, revision = dataset.revision;
  class Failure {constructor() {throw new Error('allocation unavailable');}}
  assert.throws(() => dataset.addColumns({first: {storage: Float32Array}, fail: {storage: Failure as any}}), /allocation unavailable/);
  assert.equal(dataset.schema, schema); assert.equal(dataset.revision, revision); assert.equal(dataset.getValue('first', 0), undefined);
  assert.equal(dataset.addColumns({x: {storage: Uint8Array}}), dataset); assert.equal(dataset.schema.x.storage, Float64Array); assert.equal(dataset.revision, revision);
  dataset.addColumns({rotation: {storage: Float64Array}, flag: {storage: Uint8Array}}).appendSamples({x: [3], y: [5]});
  assert.deepEqual(Array.from(dataset.getColumn('rotation')), [NaN, NaN, NaN]); assert.deepEqual(Array.from(dataset.getColumn('flag')), [0, 0, 0]);
  assert.equal(dataset.getMaxSampleCount(), undefined); dataset.clear().appendSamples({x: [10], y: [11], rotation: [90], flag: [1]});
  assert.deepEqual(dataset.getSample(0), {x: 10, y: 11, rotation: 90, flag: 1}); dataset.dispose(); assert.throws(() => dataset.addColumns({extra: {}}), /disposed/);
});

test('borrowed column slices expose at most two logical-order views without changing revision or owned snapshots', () => {
  const dataset = waveform(3); dataset.appendSamples({yValues: [1, 2, NaN]}).appendSamples({yValues: [4]});
  const revision = dataset.revision, snapshot = dataset.getColumn('yValues'), slices = dataset.getColumnSlices('yValues');
  assert.equal(slices.length, 2); assert.deepEqual(slices.map(view => Array.from(view)), [[2, NaN], [4]]); assert.equal(slices[0].buffer, slices[1].buffer); assert.notEqual(snapshot.buffer, slices[0].buffer);
  assert.equal(dataset.revision, revision); assert.equal(dataset.getColumn('yValues'), snapshot); assert.equal(dataset.getNextSampleIndex(), 4);
  const previousBuffer = slices[0].buffer; dataset.setMaxSampleCount(8); const expanded = dataset.getColumnSlices('yValues');
  assert.equal(expanded.length, 1); assert.deepEqual(Array.from(expanded[0]), [2, NaN, 4]); assert.notEqual(expanded[0].buffer, previousBuffer);
  dataset.appendSamples({yValues: [5, 6, 7]}); assert.deepEqual(dataset.getColumnSlices('yValues').flatMap(view => Array.from(view)), [2, NaN, 4, 5, 6, 7]);
  dataset.setMaxSampleCount(2); assert.deepEqual(dataset.getColumnSlices('yValues').flatMap(view => Array.from(view)), [6, 7]);
  assert.deepEqual(Array.from(snapshot), [2, NaN, 4]); dataset.clear(); assert.deepEqual(dataset.getColumnSlices('yValues'), []); assert.throws(() => dataset.getColumnSlices('unknown'), /Unknown data column/);
});
