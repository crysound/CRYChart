import test from 'node:test';
import assert from 'node:assert/strict';
import {DataSetXY, type NumericArray, type NumericStorage, type DataSetSchema} from '../src/core/data.js';
import {PagedColumns} from '../src/core/paged-columns.js';

const bytes = (values: NumericArray) => new Uint8Array(values.buffer, values.byteOffset, values.byteLength);
function sameBits(actual: NumericArray, expected: NumericArray) {assert.equal(actual.BYTES_PER_ELEMENT, expected.BYTES_PER_ELEMENT); assert.deepEqual(bytes(actual), bytes(expected));}
function make(paged: boolean, capacity = 19, storage: NumericStorage = Float64Array) {
  return new DataSetXY({schema: {x: {auto: true, storage: Float64Array, pattern: 'progressive'}, raw: {storage}, render: {storage}},
    ...(paged ? {columnStorage: {mode: 'paged' as const, pageSize: 4, poolPagesPerStorage: 0}} : {})}).setMaxSampleCount(capacity);
}
function equalData(actual: DataSetXY, expected: DataSetXY) {
  assert.equal(actual.getSampleCount(), expected.getSampleCount()); assert.equal(actual.getNextSampleIndex(), expected.getNextSampleIndex());
  assert.equal(actual.getMaxSampleCount(), expected.getMaxSampleCount());
  const a = actual.readBack(), e = expected.readBack(); assert.equal(a.iSampleFirst, e.iSampleFirst);
  for (const name of Object.keys(e.data)) sameBits(a.data[name], e.data[name]);
}
function snapshot(data: DataSetXY) {
  return {read: data.readBack(), stats: data.getStorageStats(), revision: data.revision, epoch: data.getContentEpoch(), next: data.getNextSampleIndex(), max: data.getMaxSampleCount(), schema: data.schema};
}
function unchanged(data: DataSetXY, before: ReturnType<typeof snapshot>) {
  assert.deepEqual(data.readBack(), before.read); assert.deepEqual(data.getStorageStats(), before.stats); assert.equal(data.revision, before.revision);
  assert.equal(data.getContentEpoch(), before.epoch); assert.equal(data.getNextSampleIndex(), before.next); assert.equal(data.getMaxSampleCount(), before.max); assert.equal(data.schema, before.schema);
}

test('paged DataSet is explicit, lazily allocates pages and shares identical same-type columns by actual bytes', () => {
  const dense = make(false, 1024), paged = make(true, 1024), value = new Float64Array([1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(paged.getStorageStats().ownedNumericBytes, 0); assert.equal(dense.getStorageStats().denseTypedArrayBytes, 1024 * 16);
  paged.appendSamples({raw: value, render: value}); dense.appendSamples({raw: value, render: value}); equalData(paged, dense);
  const raw = paged.getColumnRuns('raw'), render = paged.getColumnRuns('render');
  assert.equal(raw.kind, 'paged'); assert.equal(render.kind, 'paged'); assert.equal(paged.getColumnRuns('x').kind, 'affine');
  if (raw.kind !== 'paged' || render.kind !== 'paged') throw new Error('Expected paged view');
  assert.equal(raw.getPage(0), render.getPage(0)); assert.equal(raw.getPage(1), render.getPage(1));
  const stats = paged.getStorageStats(); assert.equal(stats.pagedUniqueBytes, 8 * 8); assert.equal(stats.pagedLogicalBytes, 8 * 16); assert.equal(stats.pagedPageReferences, 4);
  assert.equal(stats.denseTypedArrayBytes, 0); assert.equal(stats.snapshotBytes, 0); value[0] = 999; assert.equal(paged.getValue('raw', 0), 1);
});

test('IEEE signed zero, NaN payloads, infinity and storage conversions keep exact independent column bytes', () => {
  const raw = new Float64Array(12), render = new Float64Array(12), rawBits = new BigUint64Array(raw.buffer), renderBits = new BigUint64Array(render.buffer);
  for (let i = 0; i < 12; i++) raw[i] = render[i] = i + .125;
  raw[0] = -0; render[0] = 0; rawBits[4] = 0x7ff8000000000123n; renderBits[4] = 0x7ff8000000000456n; raw[8] = Infinity; render[8] = NaN;
  const data = make(true, 12); data.appendSamples({raw, render}); const read = data.readBack(); sameBits(read.data.raw, raw); sameBits(read.data.render, render);
  assert.equal(data.getStorageStats().pagedUniqueBytes, 12 * 16);
  const mixed = new DataSetXY({schema: {a: {storage: Float64Array}, b: {storage: Float32Array}, c: {storage: Int16Array}}, columnStorage: {mode: 'paged', pageSize: 4, poolPagesPerStorage: 0}});
  const values = [1.23456789012345, -0, Infinity, NaN]; mixed.appendSamples({a: values, b: values, c: values});
  sameBits(mixed.getColumn('a'), new Float64Array(values)); sameBits(mixed.getColumn('b'), new Float32Array(values)); sameBits(mixed.getColumn('c'), new Int16Array(values));
  assert.equal(mixed.getStorageStats().pagedUniqueBytes, 4 * (8 + 4 + 2));
});

test('many partial appends, wrap, shrink and regrow agree byte-for-byte with retained dense storage', () => {
  const paged = make(true), dense = make(false);
  for (let batch = 0; batch < 60; batch++) {
    const count = batch % 7 + 1, raw = new Float64Array(count), render = new Float64Array(count);
    for (let i = 0; i < count; i++) {raw[i] = (batch * 17 + i) % 23 === 0 ? Infinity : Math.sin(batch + i) * 1e-6; render[i] = Number.isFinite(raw[i]) ? raw[i] : NaN;}
    const options = batch % 13 === 0 ? {start: batch * -.125, step: .2} : {step: batch % 9 === 0 ? -.125 : .2};
    paged.appendSamples({raw, render}, options); dense.appendSamples({raw, render}, options); equalData(paged, dense);
    if (batch === 20) {paged.setMaxSampleCount(9); dense.setMaxSampleCount(9); equalData(paged, dense);}
    if (batch === 35) {paged.setMaxSampleCount(31); dense.setMaxSampleCount(31); equalData(paged, dense);}
  }
  assert.equal(paged.getStorageStats().denseTypedArrayBytes, 0); assert.equal(paged.getStorageStats().snapshotBytes, 0);
});

test('range readbacks and snapshots do not promote pages; explicit slices promote only the requested column', () => {
  const paged = make(true, 9), dense = make(false, 9);
  const input = new Float64Array(Array.from({length: 15}, (_, i) => i + .25));
  for (const data of [paged, dense]) data.appendSamples({raw: input, render: input}, {start: 10, step: 2});
  const before = paged.getColumnRuns('raw'), range = paged.readBack({onlyInRange: {key: 'x', start: 26, end: 30}});
  assert.deepEqual(Array.from(range.data.raw), [8.25, 9.25, 10.25]); assert.equal(range.iSampleFirst, 8);
  const snapshot = paged.getColumn('raw'); snapshot[0] = 999; assert.equal(paged.getValue('raw', 0), 6.25);
  assert.equal(paged.getColumnRuns('raw').kind, 'paged'); const revision = paged.revision, epoch = paged.getContentEpoch();
  const parts = paged.getColumnSlices('raw'); assert.ok(parts.length <= 2); assert.deepEqual(parts.flatMap(part => Array.from(part)), Array.from(dense.getColumn('raw')));
  assert.equal(paged.getColumnRuns('raw').kind, 'dense'); assert.equal(paged.getColumnRuns('render').kind, 'paged');
  assert.equal(paged.revision, revision); assert.equal(paged.getContentEpoch(), epoch); assert.equal(paged.getStorageStats().pagedPromotionCount, 1);
  if (before.kind === 'paged') assert.throws(() => before.getPage(2), /invalidated/);
  for (const data of [paged, dense]) data.appendSamples({raw: [20, 21, 22], render: [20, Infinity, 22]}); equalData(paged, dense);
  assert.equal(paged.getStorageStats().denseTypedArrayBytes, 9 * 8);
});

test('append getter failures are atomic across paged, materialized and implicit automatic columns', () => {
  const data = make(true, 12); data.appendSamples({raw: [1, 2, 3, 4], render: [1, 2, 3, 4]}, {start: 10, step: .125});
  data.getColumnSlices('raw'); const before = snapshot(data), view = data.getColumnRuns('render');
  const bad = {length: 3, 0: 20, get 1(): number {throw new Error('input failure');}, 2: 22};
  assert.throws(() => data.appendSamples({raw: [20, 21, 22], render: bad}), /input failure/); unchanged(data, before);
  if (view.kind === 'paged') assert.equal(view.getPage(0)?.[0], 1);
  assert.throws(() => data.appendSamples({get raw(): Float64Array {throw new Error('property failure');}, render: [1]}), /property failure/); unchanged(data, before);
  const reentrant = {length: 1, get 0(): number {data.clear(); return 0;}};
  assert.throws(() => data.appendSamples({raw: [2], render: reentrant}), /mutation.*progress/); unchanged(data, before);
});

test('page allocation, dense resize, schema addition and materialization failures leave all public state unchanged', () => {
  let fail = false;
  class FailingFloat64 extends Float64Array {constructor(length: number) {if (fail && length > 0) throw new Error('allocation failure'); super(length);}}
  const data = make(true, 12, FailingFloat64); data.appendSamples({raw: [1, 2, 3, 4], render: [1, 2, 3, 4]});
  let before = snapshot(data); fail = true;
  assert.throws(() => data.appendSamples({raw: [5, 6, 7, 8], render: [5, 6, 7, 8]}), /allocation failure/);
  fail = false; unchanged(data, before); fail = true;
  assert.throws(() => data.getColumnSlices('raw'), /allocation failure/); fail = false; unchanged(data, before);
  data.getColumnSlices('raw'); before = snapshot(data); fail = true;
  assert.throws(() => data.setMaxSampleCount(24), /allocation failure/); fail = false; unchanged(data, before);
  fail = true; assert.throws(() => data.addColumns({newColumn: {storage: FailingFloat64}}), /allocation failure/); fail = false; unchanged(data, before);
});

test('replacement keeps dataset identity and retention policy, atomically resets auto X and notifies only once', () => {
  const data = make(true, 7), expected = make(false, 7); let events = 0;
  data.onChange(() => events++); data.appendSamples({raw: [1, 2, 3], render: [1, 2, 3]}, {start: 100, step: 2}); events = 0;
  const before = snapshot(data), old = data.getColumnRuns('raw'), bad = {length: 2, 0: 7, get 1(): number {throw new Error('replacement failure');}};
  assert.throws(() => data.replaceSamples({raw: [7, 8], render: bad}), /replacement failure/); unchanged(data, before); assert.equal(events, 0);
  const values = new Float64Array([10, 11, 12, 13, 14, 15, 16, 17, 18]);
  data.replaceSamples({raw: values, render: values}, {start: -5, step: .25}); expected.replaceSamples({raw: values, render: values}, {start: -5, step: .25}); equalData(data, expected);
  assert.equal(data.getContentEpoch(), before.epoch + 1); assert.equal(data.revision, before.revision + 1); assert.equal(data.schema, before.schema); assert.equal(events, 1);
  if (old.kind === 'paged') assert.throws(() => old.getPage(0), /invalidated/);
  data.replaceSamples({}); assert.equal(events, 2); assert.equal(data.getSampleCount(), 0); assert.equal(data.getNextSampleIndex(), 0); assert.equal(data.getMaxSampleCount(), 7);
  data.appendSamples({raw: [3], render: [3]}); assert.equal(data.getValue('x', 0), 0);
});

test('only-auto input, added columns and auto-capacity/unbounded transitions preserve shared row identity', () => {
  const data = make(true, 4), dense = make(false, 4);
  for (const item of [data, dense]) item.appendSamples({x: [999, 998, 997, 996]}); equalData(data, dense);
  const schema = data.schema; data.addColumns({integer: {storage: Int16Array}, late: {storage: Float32Array}}); dense.addColumns({integer: {storage: Int16Array}, late: {storage: Float32Array}});
  assert.notEqual(data.schema, schema); assert.equal('integer' in schema, false); equalData(data, dense); assert.equal(data.getValue('integer', 0), 0); assert.ok(Number.isNaN(data.getValue('late', 0)));
  for (const item of [data, dense]) {item.setMaxSampleCount({mode: 'auto', max: 6}); item.appendSamples({raw: [1, 2, 3, 4], render: [1, 2, 3, 4]});}
  equalData(data, dense); assert.equal(data.getMaxSampleCount(), 6);
  for (const item of [data, dense]) {item.setMaxSampleCount(undefined); item.appendSamples({raw: [5, 6, 7], render: [5, 6, 7]});}
  equalData(data, dense); assert.equal(data.getMaxSampleCount(), undefined);
});

test('oversized input reads only retained tail and affine X keeps the original IEEE expression', () => {
  const data = make(true, 11); let reads = 0;
  const values = new Proxy({length: 1_000_003} as ArrayLike<number>, {get(target, key) {if (key === 'length') return target.length; if (typeof key === 'string' && /^\d+$/.test(key)) {reads++; return Number(key) + .125;} return undefined;}});
  data.appendSamples({raw: values, render: values}, {start: .3, step: .1});
  assert.equal(reads, 22); assert.equal(data.getSampleCount(), 11); assert.equal(data.getNextSampleIndex(), 1_000_003);
  assert.equal(data.getValue('raw', 0), 999_992.125); assert.equal(data.getValue('x', 0), .3 + 999_992 * .1);
  assert.equal(data.getStorageStats().snapshotBytes, 0); assert.ok(data.getStorageStats().pagedUniqueBytes <= 4 * 4 * 8);
});

test('borrowed ring aliases are copied before overwrite and clear/dispose release pages even when change handlers throw', () => {
  const data = make(true, 8); data.appendSamples({raw: [0, 1, 2, 3, 4, 5, 6, 7], render: [0, 1, 2, 3, 4, 5, 6, 7]});
  data.appendSamples({raw: [8, 9], render: [8, 9]}); const alias = data.getColumnSlices('raw')[0], expected = Array.from(alias);
  data.replaceSamples({raw: alias, render: alias}); assert.deepEqual(Array.from(data.readBack().data.raw), expected); assert.deepEqual(Array.from(data.readBack().data.render), expected);
  data.clear(); assert.equal(data.getStorageStats().pagedUniqueBytes, 0); assert.equal(data.getSampleCount(), 0);
  data.appendSamples({raw: [1, 2], render: [1, 2]}); data.getColumn('render');
  data.onChange(() => {throw new Error('dispose subscriber');}); assert.throws(() => data.dispose(), /dispose subscriber/);
  assert.equal(data.isDisposed(), true); assert.equal(data.getStorageStats().ownedNumericBytes, 0); assert.equal((data as any).events.listenerCount(), 0); data.dispose();
});

test('paged two-phase transaction keeps borrowed live pages valid until commit and supports all-omitted columns', () => {
  const store = new PagedColumns({schema: {a: {}, b: {}}, capacity: 7, pageSize: 4, poolPagesPerStorage: 0});
  store.appendSamples({a: [1, 2, 3], b: [1, 2, 3]}); const view = store.getColumnView('a'), stats = store.getStorageStats();
  const transaction = store.prepareAppendSamples({}, 5, 9); assert.equal(view.getPage(0)?.[0], 1); assert.deepEqual(store.getStorageStats(), stats);
  assert.throws(() => store.resize(20), /mutation.*progress/); transaction.abort(); assert.deepEqual(store.getStorageStats(), stats); assert.equal(view.getPage(0)?.[0], 1);
  const committed = store.prepareAppendSamples({}, 5, 9); committed.commit(); assert.equal(store.getSampleCount(), 8); assert.equal(store.getCapacity(), 9); assert.ok(Number.isNaN(store.getValue('a', 7)));
  assert.throws(() => view.getPage(0), /invalidated/); assert.throws(() => committed.commit(), /no longer active/);
});

test('a constructor cannot return a retained page as a dense materialization or append allocation', () => {
  let reuse: Float64Array | undefined;
  const Storage = function(length: number) {return reuse && length ? reuse : new Float64Array(length);} as unknown as NumericStorage;
  const data = make(true, 4, Storage); data.appendSamples({raw: [1, 2, 3, 4], render: [1, 2, 3, 4]}); const view = data.getColumnRuns('raw');
  if (view.kind !== 'paged') throw new Error('Expected pages'); reuse = view.getPage(0) as Float64Array;
  assert.throws(() => data.getColumnSlices('raw'), /reused a live/); assert.equal(data.getValue('raw', 0), 1);
  assert.throws(() => data.appendSamples({raw: [5, 6, 7, 8], render: [5, 6, 7, 8]}), /reused a live/); assert.equal(data.getValue('raw', 0), 1); reuse = undefined;
});

test('mixed dense auto-Float32, implicit auto-Float64 and paged values commit in one transaction', () => {
  const schema: DataSetSchema = {x: {storage: Float64Array, auto: true}, coarseX: {storage: Float32Array, auto: true}, raw: {storage: Float64Array}, render: {storage: Float64Array}};
  const actual = new DataSetXY({schema, columnStorage: {mode: 'paged', pageSize: 4, poolPagesPerStorage: 0}}).setMaxSampleCount(7), expected = new DataSetXY({schema}).setMaxSampleCount(7);
  for (let pass = 0; pass < 9; pass++) {
    const values = [pass + .125, pass + .25, pass + .5]; for (const item of [actual, expected]) item.appendSamples({raw: values, render: values}, {step: .003}); equalData(actual, expected);
  }
  const before = snapshot(actual), bad = {length: 2, 0: 10, get 1(): number {throw new Error('late page read');}};
  assert.throws(() => actual.appendSamples({raw: [10, 20], render: bad}), /late page read/); unchanged(actual, before);
  assert.equal(actual.getColumnRuns('coarseX').kind, 'dense'); assert.equal(actual.getColumnRuns('x').kind, 'affine');
});

test('cross-precision typed input does not invoke custom subclass species or copy skipped oversized input', () => {
  class NarrowFloat32 extends Float32Array {constructor(length: number) {super(length);}}
  const input = new NarrowFloat32(20); for (let i = 0; i < input.length; i++) input[i] = i + .12345;
  const actual = make(true, 7); actual.appendSamples({raw: input, render: input});
  const expected = new Float64Array(Array.from(input).slice(-7)); sameBits(actual.getColumn('raw'), expected); sameBits(actual.getColumn('render'), expected);
  actual.getColumnSlices('raw'); actual.appendSamples({raw: input, render: input}); sameBits(actual.getColumn('raw'), expected); sameBits(actual.getColumn('render'), expected);
});
