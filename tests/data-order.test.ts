import test from 'node:test';
import assert from 'node:assert/strict';
import {DataSetXY} from '../src/core/data.js';
import {getColumnOrder, type ColumnOrder} from '../src/data-order.js';

function explicit(capacity: number) {
  return new DataSetXY({schema: {x: {storage: Float64Array, pattern: 'progressive'}}}).setMaxSampleCount(capacity);
}
function automatic(capacity: number) {
  return new DataSetXY({schema: {x: {storage: Float64Array, auto: true}, y: {storage: Float32Array}}}).setMaxSampleCount(capacity);
}
function oracle(data: DataSetXY, name = 'x') {
  let finite = true, monotonic = true, strict = true, previous: number | undefined;
  for (let i = 0; i < data.getSampleCount(); i++) {
    const value = data.getValue(name, i)!;
    if (!Number.isFinite(value)) finite = false;
    if (i > 0) { if (value < previous!) monotonic = false; if (value <= previous!) strict = false; }
    previous = value;
  }
  return {finite, monotonic: finite && monotonic, strict: finite && strict};
}
function flags(order: ColumnOrder) { return {finite: order.finite, monotonic: order.monotonic, strict: order.strict}; }

test('dense order checks the complete window and ignores false progressive hints', () => {
  const data = explicit(100_000), values = Float64Array.from({length: 100_000}, (_, i) => i - 30_000);
  values[20] = NaN; values[40_000] = values[39_999]!; values[70_000] = -1;
  data.appendSamples({x: values});
  let order = getColumnOrder(data, 'x');
  assert.deepEqual(flags(order), {finite: false, monotonic: false, strict: false});
  assert.equal(order.lastScannedSamples, 100_000);
  assert.equal(order.lastInvalidPointIndex, 20); assert.equal(order.lastDecreaseEdgeIndex, 70_000);
  data.appendSamples({x: Float64Array.from({length: 60_000}, (_, i) => 100_000 + i)});
  order = getColumnOrder(data, 'x');
  assert.deepEqual(flags(order), {finite: true, monotonic: false, strict: false});
  assert.equal(order.lastScannedSamples, 60_000);
  data.appendSamples({x: Float64Array.from({length: 10_001}, (_, i) => 160_000 + i)});
  order = getColumnOrder(data, 'x');
  assert.deepEqual(flags(order), {finite: true, monotonic: true, strict: true});
  assert.equal(order.firstIndex, 70_001); assert.equal(order.rebuilds, 1);
  assert.deepEqual(flags(order), oracle(data));
});

test('full rings scan only newly appended samples across skipped frames and recover at exact edge boundaries', () => {
  const data = explicit(4096);
  data.appendSamples({x: Float64Array.from({length: 4096}, (_, i) => i)});
  getColumnOrder(data, 'x');
  for (let iteration = 0; iteration < 40; iteration++) {
    let appended = 0;
    for (const length of [100, 37, 333]) {
      const next = data.getNextSampleIndex();
      data.appendSamples({x: Float64Array.from({length}, (_, i) => next + i)}); appended += length;
    }
    const order = getColumnOrder(data, 'x');
    assert.equal(order.lastScannedSamples, appended); assert.equal(order.rebuilds, 1);
    assert.deepEqual(flags(order), oracle(data));
  }
  const duplicate = explicit(4).appendSamples({x: [1, 2, 2, 3]});
  assert.equal(getColumnOrder(duplicate, 'x').strict, false);
  duplicate.appendSamples({x: [4]}); assert.equal(getColumnOrder(duplicate, 'x').strict, false);
  duplicate.appendSamples({x: [5]});
  const recovered = getColumnOrder(duplicate, 'x');
  assert.equal(recovered.firstIndex, 2); assert.equal(recovered.lastNonIncreaseEdgeIndex, 2); assert.equal(recovered.strict, true);
  const decrease = explicit(4).appendSamples({x: [10, 9, 10, 11]});
  assert.equal(getColumnOrder(decrease, 'x').monotonic, false);
  decrease.appendSamples({x: [12]}); assert.equal(getColumnOrder(decrease, 'x').strict, true);
});

test('nonfinite violations recover only after the latest bad retained point expires', () => {
  const data = explicit(4).appendSamples({x: [NaN, 1, Infinity, 3]});
  assert.equal(getColumnOrder(data, 'x').finite, false);
  data.appendSamples({x: [4]}); assert.equal(getColumnOrder(data, 'x').finite, false);
  data.appendSamples({x: [5]}); assert.equal(getColumnOrder(data, 'x').finite, false);
  data.appendSamples({x: [6]}); assert.deepEqual(flags(getColumnOrder(data, 'x')), {finite: true, monotonic: true, strict: true});
  data.appendSamples({x: [-Infinity, NaN, Infinity, NaN]});
  assert.deepEqual(flags(getColumnOrder(data, 'x')), {finite: false, monotonic: false, strict: false});
  data.appendSamples({x: [-5, -4, -3, -2]});
  assert.deepEqual(flags(getColumnOrder(data, 'x')), {finite: true, monotonic: true, strict: true});
});

test('ordinary uniform X uses a conservative IEEE certificate while cross-batch jumps remain visible', () => {
  const data = automatic(48_000);
  data.appendSamples({y: new Float32Array(48_000)}, {start: -500, step: 1000 / 48_000});
  let order = getColumnOrder(data, 'x');
  assert.deepEqual(flags(order), oracle(data));
  assert.equal(order.lastScannedSamples, 0); assert.equal(order.lastAffineFastSamples, 48_000); assert.equal(order.lastAffineEndpointEvaluations, 2);
  for (let batch = 0; batch < 3; batch++) data.appendSamples({y: new Float32Array(960)}, {step: 1000 / 48_000});
  order = getColumnOrder(data, 'x');
  assert.equal(order.lastScannedSamples, 0); assert.equal(order.lastAffineFastSamples, 2880); assert.equal(order.lastAffineEndpointEvaluations, 6);
  assert.equal(order.strict, true);
  data.appendSamples({y: new Float32Array(100)}, {start: -1000, step: .5});
  order = getColumnOrder(data, 'x'); assert.equal(order.monotonic, false); assert.equal(order.finite, true);
  assert.equal(order.lastDecreaseEdgeIndex, 50_880);
  data.setMaxSampleCount(100);
  order = getColumnOrder(data, 'x');
  assert.equal(order.strict, true); assert.equal(order.lastScannedSamples, 0); assert.equal(order.lastAffineEndpointEvaluations, 0);
  assert.equal(data.getColumnRuns('x').kind, 'affine'); assert.equal(data.getStorageStats().snapshotBytes, 0);
});

test('uncertain ULP spacing, constants, negative steps, subnormals and overflow match exact evaluations', () => {
  for (const options of [
    {start: 2 ** 53, step: .25}, {start: 1e20, step: 1}, {start: -1e16, step: .1},
    {start: 7, step: 0}, {start: 100, step: -.125}, {start: -0, step: -0},
    {start: 0, step: Number.MIN_VALUE}, {start: 0, step: Number.MIN_VALUE * 16},
    {start: Number.MAX_VALUE / 2, step: Number.MAX_VALUE / 4}, {start: -1e16, step: 1e16},
  ]) {
    const data = automatic(211).appendSamples({y: new Float32Array(211)}, options);
    let order = getColumnOrder(data, 'x');
    assert.deepEqual(flags(order), oracle(data), JSON.stringify(options));
    if (!(options.step > 0) || options.start === 2 ** 53 || options.start === 1e20) assert.equal(order.lastScannedSamples, 211);
    data.appendSamples({y: new Float32Array(17)}, {step: options.step});
    order = getColumnOrder(data, 'x');
    assert.deepEqual(flags(order), oracle(data));
    assert.ok(order.lastScannedSamples <= 17);
  }
});

test('affine strict certificates survive adversarial exponent and ULP boundary cases', () => {
  for (const exponent of [-1074, -1022, -1000, -100, -52, 0, 52, 53, 100, 500, 1022]) {
    for (const sign of [-1, 1]) for (const factor of [.125, .5, 1, 2, 8, 16, 1000]) {
      const start = sign * 2 ** exponent, step = Math.max(Number.MIN_VALUE, Math.abs(start) * Number.EPSILON * factor);
      const data = automatic(257).appendSamples({y: new Float32Array(257)}, {start, step});
      const order = getColumnOrder(data, 'x');
      assert.deepEqual(flags(order), oracle(data), `exponent=${exponent},sign=${sign},factor=${factor}`);
      if (order.affineFastSamples) assert.equal(order.strict, true);
    }
  }
});

test('random explicit streams match the full-window oracle after clears, resizes and oversized overwrites', () => {
  let random = 0x1ba3d4;
  const next = () => { random ^= random << 13; random ^= random >>> 17; random ^= random << 5; return random >>> 0; };
  const data = explicit(311);
  for (let iteration = 0; iteration < 600; iteration++) {
    const action = next() % 15;
    if (action === 0) data.clear();
    else if (action === 1) data.setMaxSampleCount(1 + next() % 600);
    else if (action === 2) data.setMaxSampleCount({mode: 'auto', initial: 3, max: 700});
    for (let b = 0, batches = 1 + next() % 4; b < batches; b++) {
      const count = 1 + next() % 900, origin = data.getNextSampleIndex();
      const x = Float64Array.from({length: count}, (_, i) => {
        const value = next();
        return value % 127 === 0 ? NaN : value % 131 === 0 ? Infinity : value % 137 === 0 ? -Infinity : value % 31 === 0 ? origin + i - 1 : value % 53 === 0 ? -i : origin + i;
      });
      data.appendSamples({x});
    }
    assert.deepEqual(flags(getColumnOrder(data, 'x')), oracle(data), `iteration ${iteration}`);
  }
});

test('content epochs, shared readers, new columns and storage promotion preserve cache validity', () => {
  const data = automatic(1024).appendSamples({y: [0, 1, 2]}, {start: 10, step: .5});
  const initial = getColumnOrder(data, 'x');
  assert.equal(getColumnOrder(data, 'x').cacheHits, initial.cacheHits + 1);
  data.getColumnSlices('x');
  const unchanged = getColumnOrder(data, 'x');
  assert.equal(unchanged.lastScannedSamples, 0); assert.equal(unchanged.strict, true);
  data.appendSamples({y: [3, 4]}, {step: .5});
  assert.equal(getColumnOrder(data, 'x').lastScannedSamples, 2);
  data.addColumns({extra: {storage: Float64Array}});
  assert.equal(getColumnOrder(data, 'extra').finite, false);
  data.clear().appendSamples({y: [0, 1, 2], extra: [1, 1, 1]}, {start: 10, step: -.5});
  const replaced = getColumnOrder(data, 'x');
  assert.equal(replaced.rebuilds, 2); assert.equal(replaced.monotonic, false);
  assert.equal(getColumnOrder(data, 'extra').strict, false);
  const independent = explicit(3).appendSamples({x: [-3, -2, -1]});
  assert.equal(getColumnOrder(independent, 'x').strict, true);
  data.clear();
  assert.deepEqual(flags(getColumnOrder(data, 'x')), {finite: true, monotonic: true, strict: true});
  assert.throws(() => getColumnOrder(data, 'absent'), /Unknown data column/);
  data.dispose(); assert.equal(getColumnOrder(data, 'x').sampleCount, 0);
});
