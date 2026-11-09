import test from 'node:test';
import assert from 'node:assert/strict';
import {DataSetXY, type AppendSamplesOptions, type NumericArray} from '../src/core/data.js';
import type {EventHub} from '../src/core/events.js';

function makeWaveform(capacity: number, doubleY = false) {
  return new DataSetXY({schema: {
    xValues: {storage: Float64Array, auto: true, pattern: 'progressive'},
    yValues: {storage: doubleY ? Float64Array : Float32Array},
    renderYValues: {storage: doubleY ? Float64Array : Float32Array},
  }}).setMaxSampleCount(capacity);
}
function assertBits(actual: NumericArray, expected: number[]) {
  const wanted = Float64Array.from(expected);
  assert.deepEqual(new Uint8Array(actual.buffer, actual.byteOffset, actual.byteLength), new Uint8Array(wanted.buffer));
}

test('affine X preserves original per-batch IEEE results through wrap, resize, jumps and overflow', () => {
  const data = makeWaveform(131), expected: number[] = [];
  let capacity = 131, last: number | undefined, previousStep = 1, next = 0;
  const batches: [number, AppendSamplesOptions][] = [
    [7, {start: 123.456789, step: 1000 / 48000}], [11, {}], [23, {}],
    [173, {step: 1000 / 192000}], [5, {start: 1e12 + .125, step: .001}],
    [3, {start: -0, step: -0}], [21, {start: 400, step: -.1}],
    [17, {start: Number.MAX_VALUE / 2, step: Number.MAX_VALUE / 2}],
    [2, {}], [3, {step: -Number.MAX_VALUE}], [8, {start: 12.125, step: .1}],
  ];
  for (let b = 0; b < batches.length; b++) {
    const [amount, options] = batches[b]!;
    const step = options.step ?? previousStep;
    const start = options.start ?? (last === undefined ? 0 : last + step);
    for (let i = 0; i < amount; i++) expected.push(start + i * step);
    last = start + (amount - 1) * step; previousStep = step; next += amount;
    expected.splice(0, Math.max(0, expected.length - capacity));
    const y = new Float32Array(amount);
    data.appendSamples({xValues: new Float64Array(amount).fill(999), yValues: y, renderYValues: y}, options);
    assert.equal(data.getColumnRuns('xValues').kind, 'affine');
    assertBits(data.readBack().data.xValues!, expected);
    for (let i = 0; i < expected.length; i++) assert.ok(Object.is(data.getValue('xValues', i), expected[i]));
    assert.equal(data.getNextSampleIndex(), next);
    if (b === 4) {
      capacity = 211; data.setMaxSampleCount(capacity);
    } else if (b === 7) {
      capacity = 71; expected.splice(0, Math.max(0, expected.length - capacity)); data.setMaxSampleCount(capacity);
      assertBits(data.readBack().data.xValues!, expected);
    }
  }
});

test('X slices promote to an aligned dense ring once; value, runs and owned snapshots do not', () => {
  const data = makeWaveform(7);
  data.appendSamples({yValues: [0, 1, 2, 3, 4], renderYValues: [0, 1, 2, 3, 4]}, {start: 10, step: .1});
  data.appendSamples({yValues: [5, 6, 7, 8], renderYValues: [5, 6, 7, 8]}, {step: .1});
  const before = data.getStorageStats(), revision = data.revision;
  const x = data.getColumn('xValues');
  assert.equal(data.getStorageStats().snapshotBytes, 7 * 8);
  assert.equal(data.getStorageStats().denseTypedArrayBytes, before.denseTypedArrayBytes);
  assert.equal(data.getColumnRuns('xValues').kind, 'affine');
  assert.equal(data.getValue('xValues', 0), x[0]);
  const slices = data.getColumnSlices('xValues'), ys = data.getColumnSlices('yValues');
  assert.deepEqual(slices.map(s => s.length), ys.map(s => s.length));
  assert.deepEqual(slices.flatMap(s => Array.from(s)), Array.from(x));
  assert.equal(slices[0]!.buffer, slices[1]!.buffer);
  assert.equal(data.getColumnRuns('xValues').kind, 'dense');
  assert.equal(data.getStorageStats().denseTypedArrayBytes, before.denseTypedArrayBytes + 7 * 8);
  assert.equal(data.getStorageStats().affineRunCount, 0);
  assert.equal(data.revision, revision);
  assert.equal(data.getColumn('xValues'), x);
  const buffer = slices[0]!.buffer;
  data.appendSamples({yValues: [9], renderYValues: [9]});
  assert.equal(data.getColumnSlices('xValues')[0]!.buffer, buffer);
  assert.equal(data.getStorageStats().snapshotBytes, 0);
  assert.equal(x[0], 10 + 2 * .1);
  data.clear();
  assert.equal(data.getColumnRuns('xValues').kind, 'affine');
  assert.equal(data.getStorageStats().denseTypedArrayBytes, 7 * 8);
  assert.deepEqual(data.getColumnSlices('xValues'), []);
});

test('readBack allocates only the selected owned output and preserves unordered range envelope semantics', () => {
  const allocations: number[] = [];
  class MeasuredFloat32 extends Float32Array {
    static get [Symbol.species]() { return Float32Array; }
    constructor(length: number) { super(length); allocations.push(length); }
  }
  const data = new DataSetXY({schema: {
    x: {auto: true, storage: Float64Array, pattern: 'progressive'},
    y: {storage: MeasuredFloat32},
  }}).setMaxSampleCount(20_000);
  data.appendSamples({y: new Float32Array(10_000)}, {start: 100, step: .25});
  const revision = data.revision;
  allocations.length = 0;
  const subset = data.readBack({onlyInRange: {key: 'x', start: 200, end: 200.5}});
  assert.deepEqual(allocations, [3]);
  assert.equal(subset.iSampleFirst, 400);
  assert.deepEqual(Array.from(subset.data.x!), [200, 200.25, 200.5]);
  assert.equal(data.getStorageStats().snapshotBytes, 0);
  assert.equal(data.getColumnRuns('x').kind, 'affine');
  assert.equal(data.revision, revision);
  subset.data.y![0] = 999;
  assert.equal(data.getValue('y', 400), 0);

  const explicit = new DataSetXY({schema: {x: {pattern: 'progressive'}, y: {}}});
  explicit.appendSamples({x: [0, 10, 5, NaN, 3, 20], y: [0, 1, 2, 3, 4, 5]});
  const result = explicit.readBack({onlyInRange: {key: 'x', start: 3, end: 5}});
  assert.deepEqual(Array.from(result.data.x!), [5, NaN, 3]);
  assert.equal(result.iSampleFirst, 2);
  assert.equal(explicit.getColumnRuns('x').kind, 'dense');
});

test('affine range reads match a linear oracle across reversals, constants, infinities and empty ranges', () => {
  const data = makeWaveform(1000);
  for (const options of [{start: 10, step: .1}, {start: 200, step: -2}, {start: 7, step: 0},
    {start: Number.MAX_VALUE / 2, step: Number.MAX_VALUE / 2}, {step: -Number.MAX_VALUE}]) {
    data.appendSamples({yValues: new Float32Array(20)}, options);
  }
  const values = Array.from(data.readBack().data.xValues!);
  for (const [start, end] of [[10.3, 10.6], [197, 163], [7, 7], [11.9, 12], [-Infinity, Infinity],
    [Infinity, Infinity], [-Infinity, -Infinity], [NaN, 2], [1000, 1010]]) {
    let first = values.length, last = values.length;
    const min = Math.min(start!, end!), max = Math.max(start!, end!);
    for (let i = 0; i < values.length; i++) if (values[i]! >= min && values[i]! <= max) { first = Math.min(first, i); last = i + 1; }
    const result = data.readBack({onlyInRange: {key: 'xValues', start: start!, end: end!}});
    assertBits(result.data.xValues!, values.slice(first, last));
    assert.equal(result.iSampleFirst, first);
  }
  assert.equal(data.getStorageStats().snapshotBytes, 0);
});

test('multi-column allocation failures leave ring values, capacity, indices and revisions intact', () => {
  let fail = false;
  class FallibleStorage extends Float64Array {
    static get [Symbol.species]() { return Float64Array; }
    constructor(length: number) { if (fail && length > 4) throw new Error('allocation denied'); super(length); }
  }
  const data = new DataSetXY({schema: {x: {storage: Float64Array, auto: true}, y: {storage: Float32Array}, z: {storage: FallibleStorage}}}).setMaxSampleCount(4);
  data.appendSamples({y: [0, 1, 2, 3], z: [0, 1, 2, 3]}, {step: .1}).appendSamples({y: [4, 5], z: [4, 5]});
  const before = data.readBack(), snapshot = data.getColumn('x'), revision = data.revision;
  let events = 0; data.onChange(() => events++); fail = true;
  assert.throws(() => data.setMaxSampleCount(9), /allocation denied/);
  assert.deepEqual(data.readBack(), before);
  assert.equal(data.getMaxSampleCount(), 4); assert.equal(data.getNextSampleIndex(), 6);
  assert.equal(data.revision, revision); assert.equal(events, 0); assert.equal(data.getColumn('x'), snapshot);
  data.setMaxSampleCount(Infinity);
  const revision2 = data.revision;
  assert.throws(() => data.appendSamples({y: [6, 7, 8], z: [6, 7, 8]}), /allocation denied/);
  assert.deepEqual(data.readBack(), before); assert.equal(data.revision, revision2);
  assert.equal(data.getStorageStats().capacity, 4); assert.equal(data.getMaxSampleCount(), undefined);
  fail = false; data.appendSamples({y: [6, 7, 8], z: [6, 7, 8]});
  assert.equal(data.getNextSampleIndex(), 9); assert.equal(data.getValue('x', 4), .6);
});

test('storage diagnostics report actual arrays, retain separate Y columns and release owned memory on dispose', () => {
  const capacity = 48_000 * 60;
  for (const doubleY of [false, true]) {
    const data = makeWaveform(capacity, doubleY), yBytes = doubleY ? 8 : 4;
    assert.equal(data.getStorageStats().denseTypedArrayBytes, capacity * yBytes * 2);
    data.appendSamples({yValues: [1, Infinity, -Infinity, NaN], renderYValues: [1, NaN, NaN, NaN]}, {step: 1000 / 48000});
    const stats = data.getStorageStats();
    assert.equal(stats.capacity, capacity); assert.equal(stats.sampleCount, 4);
    assert.equal(stats.autoColumnCount, 1); assert.equal(stats.affineColumnCount, 1); assert.equal(stats.denseColumnCount, 2);
    assert.equal(stats.affineRunCount, 1); assert.equal(stats.liveAffineRunCount, 1);
    assert.equal(stats.snapshotBytes, 0);
    assert.equal(data.getValue('yValues', 1), Infinity); assert.ok(Number.isNaN(data.getValue('renderYValues', 1)));
    const snapshot = data.getColumn('yValues');
    assert.equal(data.getStorageStats().snapshotBytes, 4 * yBytes);
    data.dispose();
    const disposed = data.getStorageStats();
    assert.equal(disposed.sampleCount, 0); assert.equal(disposed.capacity, 0);
    assert.equal(disposed.denseTypedArrayBytes, 0); assert.equal(disposed.snapshotBytes, 0); assert.equal(disposed.affineRunCount, 0);
    assert.equal(snapshot[1], Infinity);
  }
});

test('fragmented single-sample streams promote before run metadata dominates a dense column', () => {
  const data = makeWaveform(1024), expected: number[] = [];
  let last: number | undefined;
  for (let i = 0; i < 400; i++) {
    const x = last === undefined ? 0 : last + .1; expected.push(x); last = x;
    data.appendSamples({yValues: [i]}, {step: .1});
  }
  assert.equal(data.getColumnRuns('xValues').kind, 'dense');
  assert.equal(data.getStorageStats().affineRunCount, 0);
  assertBits(data.readBack().data.xValues!, expected);
});

test('non-Float64 automatic columns preserve typed coercion and added auto columns retain historical gaps', () => {
  const data = new DataSetXY({schema: {x: {storage: Float32Array, auto: true}, y: {}}}).setMaxSampleCount(9);
  data.appendSamples({y: [0, 1, 2]}, {start: .1, step: .1}).appendSamples({y: [3, 4]}, {step: .1});
  assert.equal(data.getColumnRuns('x').kind, 'dense');
  assert.deepEqual(Array.from(data.getColumn('x')), Array.from(new Float32Array([.1, .1 + .1, .1 + 2 * .1, .1 + 2 * .1 + .1, .1 + 2 * .1 + .1 + .1])));
  data.addColumns({autoLater: {storage: Float64Array, auto: true}});
  assert.equal(data.getColumnRuns('autoLater').kind, 'dense');
  data.appendSamples({y: [5, 6]}, {step: 2});
  assert.deepEqual(Array.from(data.getColumn('autoLater')), [NaN, NaN, NaN, NaN, NaN, 0, 2]);
  assert.throws(() => data.getColumnRuns('missing'), /Unknown data column/);
  assert.equal(data.getValue('autoLater', -1), undefined);
  data.clear().appendSamples({y: [7]}, {start: 100, step: 2});
  assert.equal(data.getColumnRuns('autoLater').kind, 'affine');
  assert.equal(data.getValue('autoLater', 0), 100);
});

test('dispose releases all subscriptions and owned storage even when a change listener throws', () => {
  const data = makeWaveform(1024).appendSamples({yValues: [1, 2], renderYValues: [1, 2]}, {step: .1});
  data.getColumn('yValues');
  const hub = (data as unknown as {events: EventHub}).events;
  const first = data.onChange(() => { throw new Error('consumer callback failed'); });
  const second = data.onChange(() => {}), epoch = data.getContentEpoch(), revision = data.revision;
  assert.equal(hub.listenerCount('change'), 2);
  assert.throws(() => data.dispose(), /consumer callback failed/);
  assert.equal(data.isDisposed(), true); assert.equal(data.getContentEpoch(), epoch + 1); assert.equal(data.revision, revision + 1);
  assert.equal(hub.listenerCount(), 0); assert.equal(data.offChange(first), false); assert.equal(data.offChange(second), false);
  assert.equal(data.getStorageStats().denseTypedArrayBytes, 0); assert.equal(data.getStorageStats().snapshotBytes, 0);
  assert.equal(data.dispose(), data);
});
