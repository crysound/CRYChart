import test from 'node:test';
import assert from 'node:assert/strict';
import {DataSetXY, type NumericArray, type SampleColumns} from '../src/core/data.js';
import {getColumnBounds} from '../src/data-bounds.js';
import {getColumnOrder} from '../src/data-order.js';

const bits = (value: NumericArray) => new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
function waveform() {
  return new DataSetXY({schema: {
    xValues: {storage: Float64Array, auto: true, pattern: 'progressive'},
    yValues: {storage: Float64Array}, renderYValues: {storage: Float32Array},
  }});
}

test('replace publishes one complete new sequence while retaining identity, schema and fixed policy', () => {
  const data = waveform().setMaxSampleCount(3).appendSamples({yValues: [10, 20, 30, 40, 50]}, {start: 40, step: 2});
  const schema = data.schema, alias = data, snapshot = data.getColumn('yValues');
  data.getColumnSlices('xValues');
  const epoch = data.getContentEpoch(), revision = data.revision;
  let calls = 0;
  data.onChange(received => {
    calls++; assert.equal(received, alias); assert.equal(received.schema, schema);
    assert.equal(received.getContentEpoch(), epoch + 1); assert.equal(received.revision, revision + 1);
    assert.equal(received.getSampleCount(), 3); assert.equal(received.getNextSampleIndex(), 5);
    assert.deepEqual(Array.from(received.getColumn('yValues')), [-0, NaN, 1.23456789012345]);
  });
  const raw = Float64Array.from([Infinity, -Infinity, -0, NaN, 1.23456789012345]);
  const render = Float64Array.from([NaN, NaN, -0, NaN, 1.23456789012345]);
  assert.equal(data.replaceSamples({yValues: raw, renderYValues: render}, {start: 100.25, step: .1}), data);
  assert.equal(calls, 1); assert.equal(data.getMaxSampleCount(), 3); assert.equal(data.getColumnRuns('xValues').kind, 'affine');
  assert.equal(data.readBack().iSampleFirst, 2);
  assert.deepEqual(Array.from(data.getColumn('xValues')), [100.25 + 2 * .1, 100.25 + 3 * .1, 100.25 + 4 * .1]);
  assert.deepEqual(bits(data.getColumn('yValues')), bits(raw.subarray(2)));
  assert.deepEqual(bits(data.getColumn('renderYValues')), bits(Float32Array.from(render.subarray(2))));
  assert.deepEqual(Array.from(snapshot), [30, 40, 50]);
});

test('auto and unbounded policies match clear-plus-append, including continuation and empty replacement', () => {
  for (const mode of ['fixed', 'auto', 'unbounded'] as const) {
    const create = () => {
      const value = waveform();
      if (mode === 'fixed') value.setMaxSampleCount(4);
      else if (mode === 'auto') value.setMaxSampleCount({mode: 'auto', initial: 2, max: 7});
      return value.appendSamples({yValues: [10, 11, 12, 13, 14]}, {start: 50, step: 7});
    };
    const data = create(), expected = create(), oldEpoch = data.getContentEpoch(), revision = data.revision;
    const input = {yValues: Float64Array.from({length: 11}, (_, i) => i + .123456789), renderYValues: Float64Array.from({length: 11}, (_, i) => i + .123456789)};
    data.replaceSamples(input, {step: .25}); expected.clear().appendSamples(input, {step: .25});
    assert.deepEqual(data.readBack(), expected.readBack()); assert.equal(data.getMaxSampleCount(), expected.getMaxSampleCount());
    assert.equal(data.getContentEpoch(), oldEpoch + 1); assert.equal(data.revision, revision + 1);
    data.appendSamples({yValues: [999]}); expected.appendSamples({yValues: [999]});
    assert.deepEqual(data.readBack(), expected.readBack());
    const capacity = data.getStorageStats().capacity, emptyEpoch = data.getContentEpoch(), emptyRevision = data.revision;
    let notifications = 0; const token = data.onChange(() => {notifications++;});
    data.replaceSamples({});
    assert.equal(notifications, 1); data.offChange(token);
    assert.equal(data.getSampleCount(), 0); assert.equal(data.getNextSampleIndex(), 0);
    assert.equal(data.getStorageStats().capacity, capacity); assert.equal(data.getMaxSampleCount(), expected.getMaxSampleCount());
    assert.equal(data.getContentEpoch(), emptyEpoch + 1); assert.equal(data.revision, emptyRevision + 1);
    data.appendSamples({yValues: [2, 3]}); assert.deepEqual(Array.from(data.getColumn('xValues')), [0, 1]);
  }
});

test('validation, property getters and sample getters cannot publish any part of a failed replacement', () => {
  const data = waveform().setMaxSampleCount(4).appendSamples({yValues: [1, 2, 3, 4, 5], renderYValues: [10, 20, 30, 40, 50]}, {start: 90, step: .2});
  const cached = data.getColumn('yValues'), original = data.readBack(), stats = data.getStorageStats();
  const revision = data.revision, epoch = data.getContentEpoch(), schema = data.schema;
  let events = 0; data.onChange(() => {events++;});
  const unchanged = () => {
    assert.equal(events, 0); assert.equal(data.revision, revision); assert.equal(data.getContentEpoch(), epoch);
    assert.equal(data.schema, schema); assert.equal(data.getColumn('yValues'), cached);
    assert.deepEqual(data.getStorageStats(), stats); assert.deepEqual(data.readBack(), original);
  };
  assert.throws(() => data.replaceSamples({yValues: [9, 10], renderYValues: [99]}), /same length/); unchanged();
  assert.throws(() => data.replaceSamples({yValues: [9]}, {step: Infinity}), /finite/); unchanged();
  const properties = {get yValues(): number[] {throw new Error('column getter');}};
  assert.throws(() => data.replaceSamples(properties), /column getter/); unchanged();
  const arrayLike = {length: 2, 0: 88, get 1(): number {throw new Error('sample getter');}};
  assert.throws(() => data.replaceSamples({yValues: [9, 10], renderYValues: arrayLike}), /sample getter/); unchanged();
  assert.throws(() => data.replaceSamples(null as unknown as SampleColumns), /object/); unchanged();
  data.appendSamples({yValues: [6]});
  assert.equal(data.getValue('xValues', 3), 90 + 4 * .2 + .2);
});

test('partial staging allocations fail atomically, and empty replacement needs no new dense capacity', () => {
  let fail = false;
  const allocations: number[] = [];
  class First extends Float64Array {
    static get [Symbol.species]() {return Float64Array;}
    constructor(length: number) {super(length); allocations.push(length);}
  }
  class Last extends Float64Array {
    static get [Symbol.species]() {return Float64Array;}
    constructor(length: number) {if (fail && length > 0) throw new Error('capacity unavailable'); super(length);}
  }
  const data = new DataSetXY({schema: {a: {storage: First}, b: {storage: Last}}}).setMaxSampleCount(7).appendSamples({a: [1, 2], b: [3, 4]});
  const original = data.readBack(), revision = data.revision, epoch = data.getContentEpoch(), stats = data.getStorageStats();
  let calls = 0; data.onChange(() => {calls++;});
  fail = true;
  assert.throws(() => data.replaceSamples({a: [9, 10], b: [11, 12]}), /capacity unavailable/);
  assert.equal(calls, 0); assert.equal(data.revision, revision); assert.equal(data.getContentEpoch(), epoch); assert.deepEqual(data.getStorageStats(), stats);
  fail = false; assert.deepEqual(data.readBack(), original);
  const before = allocations.filter(value => value > 0).length;
  fail = true; data.replaceSamples({a: [], b: []});
  assert.equal(calls, 1); assert.equal(data.getSampleCount(), 0); assert.equal(data.getStorageStats().capacity, 7);
  assert.equal(allocations.filter(value => value > 0).length, before);
});

test('replacement copies aliased old ring slices and preserves distinct NaN payloads', () => {
  const data = new DataSetXY({schema: {x: {storage: Float64Array}, y: {storage: Float64Array}}}).setMaxSampleCount(4);
  data.appendSamples({x: [0, 1, 2], y: [0, 10, 20]}).appendSamples({x: [3, 4, 5], y: [30, 40, 50]});
  const x = data.getColumnSlices('x')[0], y = data.getColumnSlices('y')[0], oldX = x.slice(), oldY = y.slice();
  data.replaceSamples({x: y, y: x});
  assert.deepEqual(bits(data.getColumn('x')), bits(oldY)); assert.deepEqual(bits(data.getColumn('y')), bits(oldX));
  assert.deepEqual(bits(x), bits(oldX)); assert.deepEqual(bits(y), bits(oldY));
  assert.notEqual(data.getColumnSlices('x')[0].buffer, y.buffer);
  const raw = new Float64Array(4), render = new Float64Array(4);
  new BigUint64Array(raw.buffer).set([0x7ff8000000000123n, 0x8000000000000000n, 0x7ff0000000000000n, 0xfff0000000000000n]);
  new BigUint64Array(render.buffer).set([0x7ff8000000000456n, 0x0000000000000000n, 0x7ff8000000000789n, 0xfff8000000000789n]);
  data.replaceSamples({x: raw, y: render});
  assert.deepEqual(bits(data.readBack().data.x), bits(raw)); assert.deepEqual(bits(data.readBack().data.y), bits(render));
});

test('oversized replacement reads only the retained tail and uses new absolute sample indices', () => {
  const data = waveform().setMaxSampleCount(17).appendSamples({yValues: [9, 10]}, {start: 99, step: 9});
  const amount = 1_000_000; let reads = 0;
  const tail = new Proxy({length: amount} as ArrayLike<number>, {get(target, property) {
    if (property === 'length') return target.length;
    const index = Number(property); if (!Number.isInteger(index)) return undefined;
    if (index < amount - 17) throw new Error('discarded prefix was read'); reads++; return index + .125;
  }});
  data.replaceSamples({yValues: tail, renderYValues: tail}, {start: 10.5, step: .005});
  assert.equal(reads, 34); assert.equal(data.getSampleCount(), 17); assert.equal(data.getNextSampleIndex(), amount);
  assert.equal(data.readBack().iSampleFirst, amount - 17); assert.equal(data.getValue('xValues', 0), 10.5 + (amount - 17) * .005);
  assert.equal(data.getValue('yValues', 16), amount - 1 + .125); assert.equal(data.getStorageStats().capacity, 17);
});

test('same-size replacement invalidates content caches and notification errors occur after commit', () => {
  const data = new DataSetXY({schema: {x: {storage: Float64Array}, y: {storage: Float64Array}}}).appendSamples({x: [1, 2, 3], y: [10, 20, 30]});
  assert.equal(getColumnOrder(data, 'x').strict, true); assert.deepEqual(getColumnBounds(data, 'y'), {start: 10, end: 30});
  const revision = data.revision, epoch = data.getContentEpoch(); let calls = 0;
  const token = data.onChange(() => {calls++; throw new Error('consumer failed');});
  assert.throws(() => data.replaceSamples({x: [3, 2, 1], y: [-10, NaN, 100]}), /consumer failed/);
  assert.equal(calls, 1); assert.equal(data.revision, revision + 1); assert.equal(data.getContentEpoch(), epoch + 1);
  assert.equal(getColumnOrder(data, 'x').monotonic, false); assert.deepEqual(getColumnBounds(data, 'y'), {start: -10, end: 100});
  data.offChange(token); data.dispose(); assert.throws(() => data.replaceSamples({x: [1]}), /disposed/);
});
