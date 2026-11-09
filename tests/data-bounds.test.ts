import test from 'node:test';
import assert from 'node:assert/strict';
import {DataSetXY, type NumericStorage} from '../src/core/data.js';
import {getColumnBounds, getColumnBoundsStats, DATA_BOUNDS_BLOCK_SIZE as B} from '../src/data-bounds.js';
import {getColumnOrder} from '../src/data-order.js';

function makeData(capacity: number, storage: NumericStorage = Float64Array) {
  return new DataSetXY({schema: {x: {auto: true, storage: Float64Array}, y: {storage}}}).setMaxSampleCount(capacity);
}
function reference(data: DataSetXY, name = 'y') {
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < data.getSampleCount(); i++) {
    const value = data.getValue(name, i)!;
    if (Number.isFinite(value)) { min = Math.min(min, value); max = Math.max(max, value); }
  }
  return min === Infinity ? undefined : {start: min, end: max};
}

test('full rolling rings scan new points plus one partial first block across multiple appends per query', () => {
  const capacity = B * 64 + 137, data = makeData(capacity);
  data.appendSamples({y: Float64Array.from({length: capacity}, (_, i) => Math.sin(i / 107) * 300)});
  assert.deepEqual(getColumnBounds(data, 'y'), reference(data));
  assert.equal(getColumnBoundsStats(data, 'y')!.lastScannedSamples, capacity);
  for (let update = 0; update < 80; update++) {
    let appended = 0;
    for (const amount of [37, 211, 103]) {
      const next = data.getNextSampleIndex();
      data.appendSamples({y: Float64Array.from({length: amount}, (_, i) => (next + i) % 101 === 0 ? NaN : Math.cos((next + i) / 89) * 700)});
      appended += amount;
    }
    assert.deepEqual(getColumnBounds(data, 'y'), reference(data));
    const stats = getColumnBoundsStats(data, 'y')!;
    assert.ok(stats.lastScannedSamples <= appended + B - 1, JSON.stringify(stats));
    assert.equal(stats.rebuilds, 1);
  }
  const scans = getColumnBoundsStats(data, 'y')!.scannedSamples;
  for (let i = 0; i < 10; i++) getColumnBounds(data, 'y');
  const stats = getColumnBoundsStats(data, 'y')!;
  assert.equal(stats.lastScannedSamples, 0); assert.equal(stats.scannedSamples, scans); assert.equal(stats.cacheHits, 10);
  assert.equal(data.getStorageStats().snapshotBytes, 0);
});

test('random retention, resizing, sparse samples and skipped render frames match a direct numeric oracle', () => {
  let random = 0x4ab62;
  const next = () => { random ^= random << 13; random ^= random >>> 17; random ^= random << 5; return random >>> 0; };
  const data = makeData(B * 3 + 31, Float32Array);
  for (let operation = 0; operation < 600; operation++) {
    const action = next() % 11;
    if (action === 0) data.clear();
    else if (action === 1) data.setMaxSampleCount(1 + next() % (B * 8));
    else if (action === 2) data.setMaxSampleCount({mode: 'auto', initial: 1 + next() % 2048, max: 8192});
    for (let batch = 0, batches = 1 + next() % 4; batch < batches; batch++) {
      const amount = 1 + next() % (action === 3 ? B * 10 : 300);
      const values = Float64Array.from({length: amount}, () => {
        const value = next();
        return value % 31 === 0 ? NaN : value % 29 === 0 ? Infinity : value % 23 === 0 ? -Infinity : (value % 100000 - 50000) / 3.1;
      });
      data.appendSamples({y: values});
    }
    assert.deepEqual(getColumnBounds(data, 'y'), reference(data), `operation ${operation}`);
    assert.equal(data.getStorageStats().snapshotBytes, 0);
  }
});

test('content epochs invalidate clear-refill identities while additions and capacity changes retain cache', () => {
  const data = makeData(4096);
  const initialEpoch = data.getContentEpoch();
  data.appendSamples({y: [1, 5, 3]});
  assert.equal(data.getContentEpoch(), initialEpoch);
  assert.deepEqual(getColumnBounds(data, 'y'), {start: 1, end: 5});
  const before = getColumnBoundsStats(data, 'y')!;
  data.setMaxSampleCount(8192).setMaxSampleCount(Infinity).addColumns({extra: {storage: Float32Array}});
  assert.equal(data.getContentEpoch(), initialEpoch);
  assert.deepEqual(getColumnBounds(data, 'y'), {start: 1, end: 5});
  assert.equal(getColumnBoundsStats(data, 'y')!.lastScannedSamples, 0);
  assert.equal(getColumnBounds(data, 'extra'), undefined);
  data.clear().appendSamples({y: [-9, -8, -7], extra: [10, 20, 30]});
  assert.equal(data.getContentEpoch(), initialEpoch + 1);
  assert.deepEqual(getColumnBounds(data, 'y'), {start: -9, end: -7});
  assert.deepEqual(getColumnBounds(data, 'extra'), {start: 10, end: 30});
  assert.equal(getColumnBoundsStats(data, 'y')!.rebuilds, before.rebuilds + 1);
  const epoch = data.getContentEpoch();
  assert.throws(() => data.appendSamples({x: [1], y: [1, 2]}), /same length/);
  assert.equal(data.getContentEpoch(), epoch);
  data.dispose();
  assert.equal(data.getContentEpoch(), epoch + 1);
  assert.equal(getColumnBoundsStats(data, 'y'), undefined);
  assert.equal(getColumnBounds(data, 'y'), undefined);
  data.dispose(); assert.equal(data.getContentEpoch(), epoch + 1);
});

test('minima and maxima expire correctly inside a truncated block, including signed zero', () => {
  const capacity = B * 3 + 7, data = makeData(capacity);
  const values = new Float64Array(capacity); values[1] = -0; values[B + 2] = -100; values[B + 3] = 100;
  data.appendSamples({y: values});
  assert.deepEqual(getColumnBounds(data, 'y'), {start: -100, end: 100});
  data.appendSamples({y: new Float64Array(B + 3)});
  assert.deepEqual(getColumnBounds(data, 'y'), {start: 0, end: 100});
  data.appendSamples({y: [0]});
  assert.deepEqual(getColumnBounds(data, 'y'), {start: 0, end: 0});
  data.clear(); values.fill(0); values[1] = -0;
  data.appendSamples({y: values});
  const mixed = getColumnBounds(data, 'y')!;
  assert.ok(Object.is(mixed.start, -0)); assert.ok(Object.is(mixed.end, 0));
  data.appendSamples({y: [0, 0]});
  assert.ok(Object.is(getColumnBounds(data, 'y')!.start, 0));
  data.appendSamples({y: new Float64Array(capacity).fill(-0)});
  const negative = getColumnBounds(data, 'y')!;
  assert.ok(Object.is(negative.start, -0)); assert.ok(Object.is(negative.end, -0));
});

test('affine coordinates keep original finite endpoint precision without dense materialization', () => {
  const data = makeData(16_000);
  for (const options of [
    {start: 123456789.125, step: 1000 / 48000}, {start: 500, step: -.125},
    {start: -0, step: -0}, {start: Number.MAX_VALUE / 2, step: Number.MAX_VALUE / 4},
    {step: -Number.MAX_VALUE}, {start: 5, step: .1},
  ]) {
    data.appendSamples({y: new Float64Array(211)}, options);
    assert.deepEqual(getColumnBounds(data, 'x'), reference(data, 'x'));
    assert.equal(getColumnBoundsStats(data, 'x')!.lastScannedSamples, 0);
    assert.equal(data.getColumnRuns('x').kind, 'affine');
  }
  data.setMaxSampleCount(503);
  assert.deepEqual(getColumnBounds(data, 'x'), reference(data, 'x'));
  assert.equal(data.getStorageStats().denseTypedArrayBytes, 503 * 8);
  assert.equal(data.getStorageStats().snapshotBytes, 0);
  data.getColumnSlices('x');
  data.appendSamples({y: [1, 2, 3]}, {step: .2});
  assert.deepEqual(getColumnBounds(data, 'x'), reference(data, 'x'));
  assert.equal(getColumnBoundsStats(data, 'x')!.rebuilds, 2);
});

test('oversized appends read only retained rows and obsolete extrema queues stay bounded', () => {
  const capacity = B * 5 + 17, data = makeData(capacity);
  data.appendSamples({y: new Float64Array(33).fill(-1000)});
  getColumnBounds(data, 'y');
  for (let iteration = 0; iteration < 600; iteration++) {
    const amount = iteration % 113 === 0 ? capacity * 7 : B * 2;
    const index = data.getNextSampleIndex();
    data.appendSamples({y: Float64Array.from({length: amount}, (_, i) => index + i)});
    const bounds = getColumnBounds(data, 'y');
    assert.deepEqual(bounds, {start: data.getNextSampleIndex() - capacity, end: data.getNextSampleIndex() - 1});
    const stats = getColumnBoundsStats(data, 'y')!;
    assert.ok(stats.lastScannedSamples <= Math.min(capacity, amount + B - 1));
    assert.ok(stats.retainedExtremaEntries <= stats.fullBlocksInWindow * 4 + 514, JSON.stringify(stats));
  }
});

test('all-gap columns, independent datasets and caller mutations cannot poison cached bounds', () => {
  const a = makeData(3000), b = makeData(3000);
  a.appendSamples({y: new Float64Array(2500).fill(NaN)});
  b.appendSamples({y: new Float64Array(2500).fill(9)});
  assert.equal(getColumnBounds(a, 'y'), undefined);
  const first = getColumnBounds(b, 'y')!;
  first.start = -999;
  assert.deepEqual(getColumnBounds(b, 'y'), {start: 9, end: 9});
  a.appendSamples({y: [Infinity, -Infinity, -10]});
  assert.deepEqual(getColumnBounds(a, 'y'), {start: -10, end: -10});
  a.setMaxSampleCount(1).appendSamples({y: [NaN]});
  assert.equal(getColumnBounds(a, 'y'), undefined);
  assert.deepEqual(getColumnBounds(b, 'y'), {start: 9, end: 9});
  assert.equal(getColumnBoundsStats(b, 'never-read'), undefined);
  assert.throws(() => getColumnBounds(a, 'unknown'), /Unknown data column/);
});

test('three thousand affine batches use only global endpoints after incremental order validation', () => {
  const data = makeData(48_000 * 60, Float32Array), batch = new Float32Array(960);
  for (let i = 0; i < 3000; i++) data.appendSamples({y: batch}, {step: 1000 / 48_000});
  const initial = getColumnBounds(data, 'x')!, before = getColumnOrder(data, 'x');
  assert.equal(initial.start, data.getValue('x', 0)); assert.equal(initial.end, data.getValue('x', data.getSampleCount() - 1));
  assert.equal(before.affineEndpointEvaluations, 6000);
  assert.equal(getColumnBoundsStats(data, 'x')!.lastAffineRunVisits, 0);
  data.appendSamples({y: batch}, {step: 1000 / 48_000}).appendSamples({y: batch}, {step: 1000 / 48_000});
  const rolled = getColumnBounds(data, 'x')!, after = getColumnOrder(data, 'x'), stats = getColumnBoundsStats(data, 'x')!;
  assert.equal(rolled.start, data.getValue('x', 0)); assert.equal(rolled.end, data.getValue('x', data.getSampleCount() - 1));
  assert.equal(after.affineEndpointEvaluations - before.affineEndpointEvaluations, 4);
  assert.equal(after.scannedSamples, 0);
  assert.equal(stats.lastAffineEndpointReads, 2); assert.equal(stats.lastAffineRunVisits, 0); assert.equal(stats.affineRunVisits, 0);
  assert.equal(data.getColumnRuns('x').kind, 'affine'); assert.equal(data.getStorageStats().snapshotBytes, 0);
});

test('affine bounds retain exact signed-zero and reversal fallbacks then recover the endpoint path', () => {
  const data = makeData(300);
  data.appendSamples({y: [1, 2]}, {start: 0, step: 0});
  data.appendSamples({y: [3, 4]}, {start: -0, step: -0});
  data.appendSamples({y: [5, 6]}, {start: 0, step: 0});
  const zeros = getColumnBounds(data, 'x')!;
  assert.ok(Object.is(zeros.start, -0)); assert.ok(Object.is(zeros.end, 0));
  assert.equal(getColumnBoundsStats(data, 'x')!.lastAffineRunVisits, 3);
  data.clear().appendSamples({y: new Float32Array(100)}, {start: 0, step: 1});
  data.appendSamples({y: new Float32Array(10)}, {start: 40, step: -.5});
  assert.deepEqual(getColumnBounds(data, 'x'), reference(data, 'x'));
  assert.ok(getColumnBoundsStats(data, 'x')!.lastAffineRunVisits > 0);
  data.setMaxSampleCount(5).appendSamples({y: new Float32Array(5)}, {start: 10, step: .125});
  assert.deepEqual(getColumnBounds(data, 'x'), reference(data, 'x'));
  assert.equal(getColumnBoundsStats(data, 'x')!.lastAffineRunVisits, 0);
  assert.equal(getColumnBoundsStats(data, 'x')!.lastAffineEndpointReads, 2);
});

test('dense bounds do not add an ordering pass', () => {
  const data = new DataSetXY({schema: {x: {storage: Float64Array}}});
  data.appendSamples({x: Float64Array.from({length: 4096}, (_, i) => i)});
  assert.deepEqual(getColumnBounds(data, 'x'), {start: 0, end: 4095});
  assert.equal(getColumnBoundsStats(data, 'x')!.lastScannedSamples, 4096);
  const firstOrderRead = getColumnOrder(data, 'x');
  assert.equal(firstOrderRead.cacheHits, 0); assert.equal(firstOrderRead.lastScannedSamples, 4096);
});
