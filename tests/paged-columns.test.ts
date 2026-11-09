import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import {DataSetXY, type NumericArray, type NumericStorage, type SampleColumns} from '../src/core/data.js';
import {PagedColumns, PagedColumnCursor, readPagedValue} from '../src/core/paged-columns.js';

const f64 = {left: {storage: Float64Array}, right: {storage: Float64Array}};
const bytes = (values: NumericArray) => new Uint8Array(values.buffer, values.byteOffset, values.byteLength);
const bitsEqual = (a: NumericArray, b: NumericArray, message?: string) => assert.deepEqual(bytes(a), bytes(b), message);

/** Independent dense oracle: TypedArray#set performs the platform's native
 * conversion/bit copy. It has no page addressing, sharing, pooling or COW logic. */
class DenseOracle {
  values = new Map<string, NumericArray>();
  next = 0;
  constructor(readonly schema: Record<string, {storage: NumericStorage}>, public capacity: number) {
    for (const [name, definition] of Object.entries(schema)) this.values.set(name, new definition.storage(0));
  }
  append(input: SampleColumns, amount: number) {
    for (const [name, {storage}] of Object.entries(this.schema)) {
      const normalized = new storage(amount);
      if (input[name] === undefined) normalized.fill(NaN);
      else normalized.set(input[name]!);
      const old = this.values.get(name)!, retainedNew = Math.min(amount, this.capacity);
      const retainedOld = Math.min(old.length, this.capacity - retainedNew), result = new storage(retainedOld + retainedNew);
      result.set(old.subarray(old.length - retainedOld), 0);
      result.set(normalized.subarray(amount - retainedNew), retainedOld);
      this.values.set(name, result);
    }
    this.next += amount;
  }
  resize(capacity: number) {
    this.capacity = capacity;
    for (const [name, value] of this.values) this.values.set(name, value.slice(-capacity) as NumericArray);
  }
  clear() {
    for (const [name, definition] of Object.entries(this.schema)) this.values.set(name, new definition.storage(0));
    this.next = 0;
  }
}
function assertOracle(data: PagedColumns, oracle: DenseOracle) {
  assert.equal(data.getNextSampleIndex(), oracle.next);
  for (const [name, wanted] of oracle.values) {
    assert.equal(data.getSampleCount(), wanted.length);
    bitsEqual(data.readColumn(name), wanted, `column ${name}`);
    for (let i = 0; i < wanted.length; i++) assert.ok(Object.is(data.getValue(name, i), wanted[i]), `${name}[${i}]`);
  }
}
function nan64(words: bigint[]): Float64Array {
  const result = new Float64Array(words.length);
  new BigUint64Array(result.buffer).set(words);
  return result;
}

test('same typed pages share owned storage while snapshots and input arrays stay independent', () => {
  const data = new PagedColumns({schema: f64, capacity: 20, pageSize: 4});
  const left = Float64Array.from([1, 2, 3, 4, 5, 6]), right = left.slice();
  data.appendSamples({left, right});
  const a = data.getColumnView('left'), b = data.getColumnView('right');
  assert.equal(a.getPage(0), b.getPage(0)); assert.equal(a.getPage(1), b.getPage(1));
  assert.notEqual(a.getPage(0)!.buffer, left.buffer);
  const stats = data.getStorageStats();
  assert.equal(stats.uniquePageBytes, 2 * 4 * 8); assert.equal(stats.logicalPageBytes, 2 * stats.uniquePageBytes);
  assert.equal(stats.logicalSampleBytes, 6 * 2 * 8); assert.equal(stats.sharedPageCount, 2);
  assert.equal(stats.allocatedPageBytes, stats.uniquePageBytes + stats.pooledPageBytes);
  const snapshot = data.readColumn('left'); snapshot[0] = 100; left.fill(-10); right.fill(-20);
  assert.deepEqual(Array.from(data.readColumn('left')), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(Array.from(data.readColumn('right')), [1, 2, 3, 4, 5, 6]);
});

test('signed zero, NaN payloads and infinity differences use typed bytes rather than numeric equality', () => {
  const sameNaN = nan64([0x7ff8000000000101n, 0x8000000000000000n, 0x7ff0000000000000n, 0xfff0000000000000n]);
  const changedNaN = sameNaN.slice(); new BigUint64Array(changedNaN.buffer)[0] = 0x7ff8000000000202n;
  const data = new PagedColumns({schema: f64, capacity: 12, pageSize: 4});
  data.appendSamples({left: sameNaN, right: changedNaN});
  bitsEqual(data.readColumn('left'), sameNaN); bitsEqual(data.readColumn('right'), changedNaN);
  assert.notEqual(data.getColumnView('left').getPage(0), data.getColumnView('right').getPage(0));
  data.appendSamples({left: sameNaN, right: sameNaN.slice()});
  assert.equal(data.getColumnView('left').getPage(1), data.getColumnView('right').getPage(1));
  const negativeZero = Float64Array.from([-0, 1, 2, 3]), positiveZero = Float64Array.from([+0, 1, 2, 3]);
  data.appendSamples({left: negativeZero, right: positiveZero});
  assert.notEqual(data.getColumnView('left').getPage(2), data.getColumnView('right').getPage(2));
  assert.equal(Object.is(data.getValue('left', 8), -0), true); assert.equal(Object.is(data.getValue('right', 8), +0), true);
});

test('partial page COW changes one page and can re-share after all differing retained values expire', () => {
  const data = new PagedColumns({schema: f64, capacity: 9, pageSize: 4});
  data.appendSamples({left: [1, 2, 3, 4, 5], right: [1, 2, 3, 4, 5]});
  const untouched = data.getColumnView('left').getPage(0), previous = data.getColumnView('left').getPage(1);
  data.appendSamples({left: [6], right: [600]});
  assert.equal(data.getColumnView('left').getPage(0), untouched);
  assert.equal(data.getColumnView('right').getPage(0), untouched);
  assert.notEqual(data.getColumnView('left').getPage(1), data.getColumnView('right').getPage(1));
  assert.notEqual(data.getColumnView('left').getPage(1), previous);
  assert.equal(data.getStorageStats().uniquePageCount, 3);
  data.resize(1).appendSamples({left: [7], right: [7]});
  assert.equal(data.getSampleCount(), 1);
  assert.equal(data.getColumnView('left').getPage(1), data.getColumnView('right').getPage(1));
  assert.deepEqual(Array.from(data.readColumn('left')), [7]);
  assert.equal(data.getColumnView('left').getPage(0), undefined);
});

test('equal typed incoming spans with a shared prefix write one draft and preserve payload bytes', () => {
  let allocations = 0;
  const data = new PagedColumns({schema: f64, capacity: 16, pageSize: 4, poolPagesPerStorage: 0,
    allocator(storage, length) {allocations++; return new storage(length);}});
  const first = nan64([0x7ff8000000000505n, 0x8000000000000000n]);
  data.appendSamples({left: first, right: first.slice()});
  assert.equal(allocations, 1);
  assert.equal(data.getStorageStats().inputCopiedBytes, first.byteLength);
  assert.equal(data.getStorageStats().inputCopySkippedBytes, first.byteLength);
  const second = Float64Array.from([3, 4]);
  data.appendSamples({left: second, right: second.slice()});
  assert.equal(allocations, 2);
  assert.equal(data.getStorageStats().retainedCopiedBytes, first.byteLength);
  assert.equal(data.getStorageStats().sharedInputMatches, 2);
  const expected = new Float64Array(4); expected.set(first); expected.set(second, 2);
  bitsEqual(data.readColumn('left'), expected); bitsEqual(data.readColumn('right'), expected);
  assert.equal(data.getColumnView('left').getPage(0), data.getColumnView('right').getPage(0));
});

test('typed-span shortcut does not merge different retained prefixes or signed-zero differences', () => {
  const data = new PagedColumns({schema: f64, capacity: 8, pageSize: 4});
  data.appendSamples({left: Float64Array.from([1]), right: Float64Array.from([100])});
  data.appendSamples({left: Float64Array.from([2]), right: Float64Array.from([2])});
  assert.notEqual(data.getColumnView('left').getPage(0), data.getColumnView('right').getPage(0));
  assert.deepEqual(Array.from(data.readColumn('left')), [1, 2]); assert.deepEqual(Array.from(data.readColumn('right')), [100, 2]);
  data.clear().appendSamples({left: Float64Array.from([-0]), right: Float64Array.from([+0])});
  assert.notEqual(data.getColumnView('left').getPage(0), data.getColumnView('right').getPage(0));
  assert.equal(data.getStorageStats().sharedInputMatches, 0);
  const bytesStore = new PagedColumns({schema: {a: {storage: Uint8Array}, b: {storage: Uint8Array}}, capacity: 12, pageSize: 5});
  const input = new Uint8Array([99, 1, 2, 3, 4, 5, 6, 99]).subarray(1, 7);
  bytesStore.appendSamples({a: input, b: input.slice()});
  bitsEqual(bytesStore.readColumn('a'), input); bitsEqual(bytesStore.readColumn('b'), input);
  assert.equal(bytesStore.getStorageStats().uniquePageCount, 2);
});

test('same buffer and offset certify typed equality only when no input-mutating callback can run', () => {
  const input = nan64([0x7ff8000000000909n, 0x8000000000000000n, 0x4000000000000000n, 0x4008000000000000n]);
  const data = new PagedColumns({schema: f64, capacity: 8, pageSize: 4});
  const alias = new Float64Array(input.buffer, input.byteOffset, input.length);
  data.appendSamples({left: input, right: alias});
  assert.equal(data.getStorageStats().identityInputMatches, 1);
  assert.equal(data.getStorageStats().comparedBytes, 0);
  assert.notEqual(data.getColumnView('left').getPage(0)!.buffer, input.buffer);
  bitsEqual(data.readColumn('right'), input);
  class CustomFloat64 extends Float64Array {}
  const custom = new PagedColumns({schema: {a: {storage: CustomFloat64}, b: {storage: CustomFloat64}}, capacity: 4, pageSize: 4});
  custom.appendSamples({a: input, b: input});
  assert.equal(custom.getStorageStats().identityInputMatches, 0); assert.equal(custom.getStorageStats().comparedBytes, input.byteLength);
  bitsEqual(custom.readColumn('a'), input);
  const callback = new PagedColumns({schema: {a: {storage: Float64Array}, trigger: {storage: Int8Array}, b: {storage: Float64Array}}, capacity: 4, pageSize: 4});
  const source = Float64Array.from([1, 2, 3, 4]);
  const trigger = {length: 4, get 0() {source[0] = 99; return 0;}, 1: 0, 2: 0, 3: 0};
  callback.appendSamples({a: source, trigger, b: source});
  assert.equal(callback.getValue('a', 0), 1); assert.equal(callback.getValue('b', 0), 99);
  assert.equal(callback.getStorageStats().identityInputMatches, 0);
  assert.notEqual(callback.getColumnView('a').getPage(0), callback.getColumnView('b').getPage(0));
});

test('scratch reuse never overwrites an input buffer returned by a previous borrowed view', () => {
  const data = new PagedColumns({schema: f64, capacity: 4, pageSize: 4});
  data.appendSamples({left: Float64Array.of(1, 2, 3, 4), right: Float64Array.of(1, 2, 3, 4)});
  const priorPage = data.getColumnView('right').getPage(0)!;
  data.clear();
  data.appendSamples({left: Float64Array.of(5, 6, 7, 8), right: priorPage});
  assert.deepEqual(Array.from(priorPage), [1, 2, 3, 4]);
  assert.deepEqual(Array.from(data.readColumn('left')), [5, 6, 7, 8]);
  assert.deepEqual(Array.from(data.readColumn('right')), [1, 2, 3, 4]);
});

test('adaptive pools reuse full-ring drafts, respect the byte bound and trim expired batch peaks', () => {
  const data = new PagedColumns({schema: f64, capacity: 256, pageSize: 4, poolHistoryLength: 16, maxPoolBytesPerStorage: 4096});
  const input = Float64Array.from({length: 64}, (_, i) => i), equal = input.slice();
  for (let i = 0; i < 5; i++) data.appendSamples({left: input, right: equal});
  const allocations = data.getStorageStats().pageAllocations;
  for (let i = 0; i < 12; i++) data.appendSamples({left: input, right: equal});
  assert.equal(data.getStorageStats().pageAllocations, allocations, 'steady ring appends reuse all touched drafts');
  assert.equal(data.getStorageStats().poolTargetPages, 18); assert.ok(data.getStorageStats().pooledPageCount <= 18);
  for (let i = 0; i < 16; i++) data.appendSamples({left: Float64Array.of(i), right: Float64Array.of(i)});
  const trimmed = data.getStorageStats();
  assert.equal(trimmed.poolTargetPages, 3); assert.ok(trimmed.pooledPageCount <= 3);
  assert.ok(trimmed.pooledPageBytes <= trimmed.poolTargetBytes);
  data.clear(); assert.equal(data.getStorageStats().poolTargetPages, 2); assert.ok(data.getStorageStats().pooledPageCount <= 2);
  const limited = new PagedColumns({schema: f64, capacity: 256, pageSize: 4, maxPoolBytesPerStorage: 64});
  for (let i = 0; i < 6; i++) limited.appendSamples({left: input, right: equal});
  assert.equal(limited.getStorageStats().poolTargetBytes, 64); assert.ok(limited.getStorageStats().pooledPageBytes <= 64);
});

test('ring wrap, oversized input, omitted columns, growth and shrink match a dense typed oracle', () => {
  const schema = {left: {storage: Float64Array}, right: {storage: Float64Array}, low: {storage: Float32Array}, integer: {storage: Int16Array}, clamp: {storage: Uint8ClampedArray}};
  const data = new PagedColumns({schema, capacity: 13, pageSize: 4}), oracle = new DenseOracle(schema, 13);
  let state = 1749;
  const random = () => {state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state;};
  for (let round = 0; round < 500; round++) {
    if (round % 53 === 0) {data.clear(); oracle.clear();}
    if (round % 11 === 0) {const capacity = 1 + random() % 35; data.resize(capacity); oracle.resize(capacity);}
    const amount = 1 + random() % 67;
    const left = new Float64Array(amount);
    for (let i = 0; i < amount; i++) {
      const pick = random() % 40;
      left[i] = pick === 0 ? Infinity : pick === 1 ? -Infinity : pick === 2 ? NaN : pick === 3 ? -0 : ((random() % 10000) - 5000) / 7;
    }
    const right = left.slice(); if (round % 3 === 0) right[random() % amount] += 1;
    const input: SampleColumns = {left, right, low: left, integer: left, clamp: left};
    if (round % 7 === 0) delete input.right;
    if (round % 9 === 0) input.low = Array.from(left);
    data.appendSamples(input); oracle.append(input, amount); assertOracle(data, oracle);
    assert.ok(data.getStorageStats().pooledPageCount <= data.getStorageStats().poolTargetPages);
    assert.ok(data.getStorageStats().pooledPageBytes <= data.getStorageStats().poolTargetBytes);
    assert.equal(data.getStorageStats().firstIndex, oracle.next - data.getSampleCount());
  }
});

test('conversion is by storage type, and different types never share even when values agree', () => {
  const schema = {x: {storage: Float64Array}, y: {storage: Float64Array}, f: {storage: Float32Array}, u: {storage: Uint32Array}, i: {storage: Int32Array}};
  const data = new PagedColumns({schema, capacity: 8, pageSize: 4}), oracle = new DenseOracle(schema, 8);
  const f32 = new Float32Array(4); new Uint32Array(f32.buffer).set([0x7fc00101, 0x80000000, 0x3f99999a, 0x7f800000]);
  const input = {x: f32, y: Array.from(f32), f: f32, u: [-1, NaN, Infinity, 2 ** 32 + 5], i: [-1, NaN, Infinity, 2 ** 32 + 5]};
  data.appendSamples(input); oracle.append(input, 4); assertOracle(data, oracle);
  assert.notEqual(data.getColumnView('u').getPage(0)!.buffer, data.getColumnView('i').getPage(0)!.buffer);
  bitsEqual(data.readColumn('f'), f32);
});

test('allocation and input getter failures leave values, indices, revision, views and statistics unchanged', () => {
  let allocations = 0, failAt = Infinity;
  const data = new PagedColumns({schema: f64, capacity: 11, pageSize: 4, poolPagesPerStorage: 0,
    allocator(storage, length) {if (++allocations === failAt) throw new Error('injected allocation failure'); return new storage(length);}});
  data.appendSamples({left: [1, 2, 3, 4, 5], right: [1, 2, 3, 4, 5]});
  const stats = data.getStorageStats(), revision = data.revision, epoch = data.getContentEpoch();
  const left = data.readColumn('left'), right = data.readColumn('right'), oldView = data.getColumnView('left'), oldPage = oldView.getPage(0);
  failAt = allocations + 2;
  assert.throws(() => data.appendSamples({left: [6, 7, 8, 9, 10, 11, 12], right: [60, 70, 80, 90, 100, 110, 120]}), /allocation failure/);
  assert.deepEqual(data.getStorageStats(), stats); assert.equal(data.revision, revision); assert.equal(data.getContentEpoch(), epoch);
  bitsEqual(data.readColumn('left'), left); bitsEqual(data.readColumn('right'), right); assert.equal(oldView.getPage(0), oldPage);
  failAt = Infinity;
  const bad = {length: 3, 0: 9, get 1(): number {throw new Error('input getter failed');}, 2: 11};
  assert.throws(() => data.appendSamples({left: [9, 10, 11], right: bad}), /input getter failed/);
  assert.deepEqual(data.getStorageStats(), stats); bitsEqual(data.readColumn('left'), left); bitsEqual(data.readColumn('right'), right);
  data.appendSamples({left: [6, 7], right: [6, 7]});
  assert.deepEqual(Array.from(data.readColumn('left')), [1, 2, 3, 4, 5, 6, 7]);
});

test('allocator aliasing is rejected and rollback remains valid with reusable scratch pages', () => {
  let override: NumericArray | undefined;
  const data = new PagedColumns({schema: f64, capacity: 12, pageSize: 4,
    allocator(storage, count) {return override ?? new storage(count);}});
  const input = Float64Array.from([1, 2, 3, 4]); override = input;
  assert.throws(() => data.appendSamples({left: input, right: input}), /input buffer/);
  assert.equal(data.getSampleCount(), 0);
  override = undefined; data.appendSamples({left: input, right: input});
  const before = data.getStorageStats(), a = data.readColumn('left');
  const bad = {length: 6, 0: 1, 1: 2, 2: 3, 3: 4, get 4(): number {throw new Error('late getter');}, 5: 6};
  assert.throws(() => data.appendSamples({left: [1, 2, 3, 4, 5, 6], right: bad}), /late getter/);
  assert.deepEqual(data.getStorageStats(), before); bitsEqual(data.readColumn('left'), a);
  data.appendSamples({left: [5, 6], right: [5, 6]});
  assert.deepEqual(Array.from(data.readColumn('right')), [1, 2, 3, 4, 5, 6]);
});

test('column additions use immutable schema, NaN/zero history and all-or-nothing allocation', () => {
  let fail = false;
  const data = new PagedColumns({schema: {a: {storage: Float64Array}}, capacity: 7, pageSize: 4,
    allocator(storage, size) {if (fail) throw new Error('add allocation'); return new storage(size);}});
  data.appendSamples({a: [NaN, NaN, NaN, NaN, NaN]});
  const oldSchema = data.schema, revision = data.revision, stats = data.getStorageStats();
  fail = true;
  assert.throws(() => data.addColumns({b: {storage: Float64Array}, c: {storage: Int16Array}}), /add allocation/);
  assert.equal(data.schema, oldSchema); assert.deepEqual(data.getStorageStats(), stats); assert.equal(data.revision, revision);
  fail = false; data.addColumns({b: {storage: Float64Array}, c: {storage: Int16Array}});
  assert.equal(Object.isFrozen(data.schema), true); assert.equal(oldSchema.b, undefined); assert.equal(data.revision, revision + 1);
  assert.equal(data.getColumnView('a').getPage(0), data.getColumnView('b').getPage(0));
  assert.deepEqual(Array.from(data.readColumn('c')), [0, 0, 0, 0, 0]);
  data.appendSamples({a: [6], b: [7]});
  assert.equal(data.getValue('a', 5), 6); assert.equal(data.getValue('b', 5), 7); assert.equal(data.getValue('c', 5), 0);
  const sameSchema = data.schema; data.addColumns({a: {storage: Float32Array}}); assert.equal(data.schema, sameSchema);
});

test('absolute page access and cursor clip head/tail, seek directly and reject stale views', () => {
  const data = new PagedColumns({schema: f64, capacity: 11, pageSize: 4});
  data.appendSamples({left: Array.from({length: 20}, (_, i) => i), right: Array.from({length: 20}, (_, i) => i)});
  const view = data.getColumnView('left');
  assert.equal(view.firstIndex, 9); assert.equal(view.count, 11); assert.equal(view.getPage(1), undefined); assert.equal(view.getPage(5), undefined);
  assert.equal(readPagedValue(view, 8), undefined); assert.equal(readPagedValue(view, 20), undefined); assert.equal(readPagedValue(view, 18), 18);
  const cursor = new PagedColumnCursor(view), observed: number[] = [], spans: number[] = [];
  do {spans.push(cursor.length); for (let i = 0; i < cursor.length; i++) observed.push(cursor.values![cursor.offset + i]);} while (cursor.next());
  assert.deepEqual(observed, Array.from({length: 11}, (_, i) => i + 9)); assert.deepEqual(spans, [3, 4, 4]);
  assert.equal(cursor.seek(14), true); assert.equal(cursor.offset, 2); assert.equal(cursor.length, 2);
  assert.equal(cursor.next(), true); assert.equal(cursor.absoluteIndex, 16);
  data.appendSamples({left: [20], right: [20]});
  assert.throws(() => view.getPage(4), /invalidated/); assert.throws(() => cursor.seek(15), /invalidated/);
  assert.throws(() => data.getColumnView('missing'), /Unknown/);
  assert.throws(() => data.readColumn('left', 0, 12), /outside/);
});

test('tail appends do not enumerate historical pages and copy only the bounded partial tail', () => {
  const data = new PagedColumns({schema: f64, capacity: 100_003, pageSize: 1024});
  const values = Float64Array.from({length: 100_003}, (_, i) => i);
  data.appendSamples({left: values, right: values});
  const interior = data.getColumnView('left').getPage(40), before = data.getStorageStats();
  const internals = data as unknown as {livePages: Set<unknown>};
  const original = internals.livePages[Symbol.iterator];
  internals.livePages[Symbol.iterator] = function(): SetIterator<unknown> {throw new Error('enumerated all historical pages');};
  try {data.appendSamples({left: [100003, 100004, 100005], right: [100003, 100004, 100005]});}
  finally {internals.livePages[Symbol.iterator] = original;}
  const after = data.getStorageStats();
  assert.equal(data.getColumnView('left').getPage(40), interior);
  assert.ok(after.retainedCopiedBytes - before.retainedCopiedBytes <= 2 * 1024 * 8);
  assert.ok(after.pageComparisons - before.pageComparisons <= 2);
  assert.equal(data.getValue('left', 0), 3); assert.equal(data.getValue('right', 100002), 100005);
});

test('clear and dispose release shared pages once, with bounded pools and independent stores', () => {
  const data = new PagedColumns({schema: f64, capacity: 16, pageSize: 4});
  const other = new PagedColumns({schema: f64, capacity: 16, pageSize: 4});
  const values = Float64Array.from({length: 16}, (_, i) => i);
  data.appendSamples({left: values, right: values}); other.appendSamples({left: values, right: values});
  assert.notEqual(data.getColumnView('left').getPage(0)!.buffer, other.getColumnView('left').getPage(0)!.buffer);
  const snapshot = data.readColumn('left'), epoch = data.getContentEpoch();
  data.clear(); assert.equal(data.getStorageStats().uniquePageBytes, 0); assert.ok(data.getStorageStats().pooledPageCount <= 2);
  assert.equal(data.getContentEpoch(), epoch + 1); assert.equal(data.getNextSampleIndex(), 0);
  data.appendSamples({left: [20], right: [20]}); assert.equal(data.getValue('left', 0), 20);
  data.dispose(); assert.equal(data.getStorageStats().allocatedPageBytes, 0); assert.equal(data.getStorageStats().pageMapEntries, 0);
  const revision = data.revision; assert.equal(data.dispose(), data); assert.equal(data.revision, revision);
  bitsEqual(snapshot, values); bitsEqual(other.readColumn('left'), values);
  assert.throws(() => data.appendSamples({left: [1]}), /disposed/);
});

type Pattern = 'equal' | 'rare-nonfinite' | 'different';
function signal(channel: number, first: number, count: number, pattern: Pattern) {
  const left = new Float64Array(count), right = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    const index = first + i;
    left[i] = Math.sin(index * .003 + channel * .02) + .1 * Math.cos(index * .017);
    if (pattern === 'rare-nonfinite' && index % 997 === 0) left[i] = Infinity;
    right[i] = pattern === 'different' ? left[i] * 1.01 + .01 : Number.isFinite(left[i]) ? left[i] : NaN;
  }
  return {left, right};
}

test('small one-channel CPU profile (opt in with CRY_PAGED_PROFILE=1)', {skip: process.env.CRY_PAGED_PROFILE !== '1'}, () => {
  const results = [];
  const left = Float64Array.from({length: 960}, (_, i) => Math.sin(i * .01)), distinct = left.slice();
  for (const [pageSize, alias] of [[256, false], [1024, false], [1024, true]] as const) {
    const data = new PagedColumns({schema: f64, capacity: 48_000, pageSize});
    const input = {left, right: alias ? left : distinct};
    for (let i = 0; i < 64; i++) data.appendSamples(input);
    const before = data.getStorageStats(), start = performance.now();
    for (let i = 0; i < 6000; i++) data.appendSamples(input);
    const elapsedMs = performance.now() - start, after = data.getStorageStats();
    results.push({pageSize, alias, appendCount: 6000, elapsedMs, newPages: after.pageAllocations - before.pageAllocations,
      comparedBytes: after.comparedBytes - before.comparedBytes, identityMatches: after.identityInputMatches - before.identityInputMatches,
      allocatedPageBytes: after.allocatedPageBytes, poolTargetBytes: after.poolTargetBytes});
    data.dispose(); assert.equal(data.getStorageStats().allocatedPageBytes, 0);
  }
  const directory = resolve('codex_artifact/paged-columns-node/profile'); mkdirSync(directory, {recursive: true});
  writeFileSync(resolve(directory, 'summary.json'), JSON.stringify({node: process.version, results}, null, 2));
  console.log(JSON.stringify(results));
});

test('bounded Node storage benchmark, three repeats (opt in with CRY_PAGED_BENCH=1)', {skip: process.env.CRY_PAGED_BENCH !== '1'}, () => {
  const cases = [{channels: 4, seconds: 1}, {channels: 1, seconds: 60}, {channels: 128, seconds: 1}];
  const rows: Record<string, any>[] = [], sampleRate = 48_000, batchSize = 960, repeats = 3, warmBatches = 50;
  const memory = () => {const value = process.memoryUsage(); return {rss: value.rss, heapUsed: value.heapUsed, external: value.external, arrayBuffers: value.arrayBuffers};};
  const gc = () => (globalThis as unknown as {gc?: () => void}).gc?.();
  const timingKeys = ['constructMs', 'firstAppendMs', 'fillAppendMs', 'coldTotalMs', 'warmAppendMs'];
  const percentile = (values: number[], fraction: number) => {
    const sorted = [...values].sort((a, b) => a - b), at = (sorted.length - 1) * fraction, below = Math.floor(at);
    return sorted[below] + (sorted[Math.min(sorted.length - 1, below + 1)] - sorted[below]) * (at - below);
  };
  const storageStats = (stores: (DataSetXY | PagedColumns)[]) => {
    const stats = stores.map(store => store.getStorageStats());
    const sum = (key: string) => stats.reduce((total, entry) => total + Number((entry as unknown as Record<string, number>)[key] ?? 0), 0);
    return stores[0] instanceof PagedColumns
      ? {bytes: {unique: sum('uniquePageBytes'), pooled: sum('pooledPageBytes'), allocated: sum('allocatedPageBytes'), logicalPages: sum('logicalPageBytes'), logicalSamples: sum('logicalSampleBytes'), poolTarget: sum('poolTargetBytes')},
        counters: {pageAllocations: sum('pageAllocations'), poolReuses: sum('poolReuses'), deduplicatedDrafts: sum('deduplicatedDrafts'),
          sharedInputMatches: sum('sharedInputMatches'), inputCopySkippedBytes: sum('inputCopySkippedBytes'),
          identityInputMatches: sum('identityInputMatches'), identityComparedBytesSkipped: sum('identityComparedBytesSkipped'),
          inputCopiedBytes: sum('inputCopiedBytes'), retainedCopiedBytes: sum('retainedCopiedBytes'), comparedBytes: sum('comparedBytes'), pageComparisons: sum('pageComparisons'), peakStagedPageBytesSum: sum('peakStagedPageBytes')},
        pageReferences: sum('logicalPageReferences')}
      : {bytes: {denseTypedArrays: sum('denseTypedArrayBytes'), snapshots: sum('snapshotBytes'), affineRuns: sum('affineRunCount')}, counters: undefined, pageReferences: undefined};
  };
  for (const scenario of cases) for (const pattern of ['equal', 'rare-nonfinite', 'different'] as Pattern[]) {
    const capacity = sampleRate * scenario.seconds;
    let referenceDigest: string | undefined;
    for (let repeat = 0; repeat < repeats; repeat++) for (const pageSize of [0, 256, 1024, 4096].slice(repeat).concat([0, 256, 1024, 4096].slice(0, repeat))) {
      gc(); const memoryBefore = memory(), constructStart = performance.now();
      const stores = Array.from({length: scenario.channels}, () => pageSize
        ? new PagedColumns({schema: f64, capacity, pageSize})
        : new DataSetXY({schema: {x: {storage: Float64Array, auto: true}, ...f64}}).setMaxSampleCount(capacity));
      const constructMs = performance.now() - constructStart;
      let fillAppendMs = 0, firstAppendMs = 0, warmAppendMs = 0, fillAppendCalls = 0, warmAppendCalls = 0;
      for (let first = 0; first < capacity; first += batchSize) {
        const count = Math.min(batchSize, capacity - first);
        for (let channel = 0; channel < stores.length; channel++) {
          const input = signal(channel, first, count, pattern), start = performance.now();
          stores[channel].appendSamples(input); const elapsed = performance.now() - start;
          fillAppendMs += elapsed; if (!first) firstAppendMs += elapsed; fillAppendCalls++;
        }
      }
      const memoryAfterFill = memory(), afterFill = storageStats(stores);
      for (let batch = 0; batch < warmBatches; batch++) {
        const first = capacity + batch * batchSize;
        for (let channel = 0; channel < stores.length; channel++) {
          const input = signal(channel, first, batchSize, pattern), start = performance.now();
          stores[channel].appendSamples(input); warmAppendMs += performance.now() - start; warmAppendCalls++;
        }
      }
      const memoryAfterWarm = memory(), afterWarm = storageStats(stores), total = capacity + warmBatches * batchSize;
      const digest = createHash('sha256');
      for (const store of stores) {
        assert.equal(store.getSampleCount(), capacity); assert.equal(store.getNextSampleIndex(), total);
        if (store instanceof PagedColumns) for (const name of ['left', 'right']) digest.update(bytes(store.readColumn(name)));
        else {const values = store.readBack().data; for (const name of ['left', 'right']) digest.update(bytes(values[name]));}
      }
      const sha256 = digest.digest('hex');
      if (!referenceDigest) referenceDigest = sha256; else assert.equal(sha256, referenceDigest, `dense/paged byte oracle ${scenario.channels}/${scenario.seconds}/${pattern}/${pageSize}`);
      const warmCounters = afterWarm.counters && afterFill.counters ? Object.fromEntries(Object.keys(afterWarm.counters).map(key => [key,
        (afterWarm.counters as Record<string, number>)[key] - (afterFill.counters as Record<string, number>)[key]])) : undefined;
      rows.push({backend: pageSize ? 'paged-prototype' : 'current-dense-DataSet-with-affine-X', ...scenario, pattern, pageSize: pageSize || null, repeat,
        capacityPerChannel: capacity, retainedSamples: capacity * scenario.channels, fillAppendCalls, warmAppendCalls, constructMs, firstAppendMs, fillAppendMs,
        coldTotalMs: constructMs + fillAppendMs, warmAppendMs, warmSamplesPerSecondDuringAppend: warmBatches * batchSize * scenario.channels / (warmAppendMs / 1000), sha256,
        afterFill, afterWarm, warmCounters, memoryBefore, memoryAfterFill, memoryAfterWarm});
      for (const store of stores) {
        store.dispose();
        const disposed = store.getStorageStats();
        assert.equal('allocatedPageBytes' in disposed ? disposed.allocatedPageBytes : disposed.denseTypedArrayBytes, 0);
      }
    }
  }
  const summaries: Record<string, any>[] = [];
  for (const scenario of cases) for (const pattern of ['equal', 'rare-nonfinite', 'different']) for (const pageSize of [null, 256, 1024, 4096]) {
    const group = rows.filter(row => row.channels === scenario.channels && row.seconds === scenario.seconds && row.pattern === pattern && row.pageSize === pageSize);
    const timings = Object.fromEntries(timingKeys.map(key => [key, {median: percentile(group.map(row => row[key]), .5), p95: percentile(group.map(row => row[key]), .95), values: group.map(row => row[key])}]));
    summaries.push({...scenario, pattern, pageSize, repeats: group.length, timings, afterFill: group[0].afterFill, afterWarm: group[0].afterWarm, warmCounters: group[0].warmCounters});
  }
  const directory = resolve('codex_artifact/paged-columns-node'); mkdirSync(directory, {recursive: true});
  const report = {createdAt: new Date().toISOString(), node: process.version, platform: process.platform, arch: process.arch,
    scope: 'Node storage prototype only; not active DataSet backend, browser/GPU performance or a 128-channel 60-second result',
    measurement: 'Three repeats, rotated backend order. Cold means a fresh storage instance (not a fresh JS process): construction, first append and initial capacity fill are separate. Warm is 50 further 960-sample batches after capacity is full. Input generation and SHA256 are outside all append timers. P95 is linear interpolation over only three repeats; it is descriptive, not a stable tail-latency estimate.',
    sourceSha256: createHash('sha256').update(readFileSync(resolve('src/core/paged-columns.ts'))).digest('hex'),
    denseSourceSha256: createHash('sha256').update(readFileSync(resolve('src/core/data.ts'))).digest('hex'), sampleRate, batchSize, repeats, warmBatches,
    differences: 'rare-nonfinite: raw Infinity every 997 samples, render NaN; different: render = raw*1.01+.01',
    memory: 'Owned array statistics are exact allocations, not process RSS; capacity is a logical retention limit, with paged storage allocated as samples arrive. Process memory is a point-in-time snapshot including other runtime allocations. peakStagedPageBytesSum adds per-store maxima, not a simultaneous process peak.', summaries, rows};
  writeFileSync(resolve(directory, 'report-v3.json'), JSON.stringify(report, null, 2));
  console.log(`Paged storage benchmark v3: ${summaries.length} cases x ${repeats} repeats with matching byte digests; report ${resolve(directory, 'report-v3.json')}`);
});
