import test from 'node:test';
import assert from 'node:assert/strict';
import {DataSetXY} from '../src/core/data.js';
import {getColumnOrder} from '../src/data-order.js';
import {PagedColumns} from '../src/core/paged-columns.js';
import {DEFAULT_LINE_BLOCK_SEGMENTS, LineBlockCache, planLineBlockSpans, type LineBlockRequest, type LineBlockResult} from '../src/line-block-cache.js';

function data(count: number, options: {capacity?: number; start?: number; step?: number} = {}) {
  const source = new DataSetXY({schema: {x: {storage: Float64Array, auto: true, pattern: 'progressive'}, y: {storage: Float64Array}}});
  if (options.capacity) source.setMaxSampleCount(options.capacity);
  source.appendSamples({y: Float64Array.from({length: count}, (_, index) => Math.sin(index * .13))}, {start: options.start ?? 0, step: options.step ?? 1});
  return source;
}
function request(source: DataSetXY, first?: number, end?: number): LineBlockRequest {
  const next = source.getNextSampleIndex(), retainedFirst = next - source.getSampleCount(), order = getColumnOrder(source, 'x');
  return {source: {identity: source, contentEpoch: source.getContentEpoch(), revision: source.revision, firstSampleIndex: retainedFirst, nextSampleIndex: next, x: source.getColumnRuns('x'), y: source.getColumnRuns('y')},
    projectionKey: 'x/y:linear', coordinateMode: 'linear', bindingRevision: 0, styleRevision: 0,
    visibleSegments: {first: first ?? retainedFirst, end: end ?? next - 1}, domain: {x: {start: 0, end: 100}, y: {start: -2, end: 2}},
    style: {color: [0, 1, 1, 1], thickness: 2}, monotonicX: order.finite && order.strict ? 'verified-strict' : 'invalid'};
}
function blocks(result: LineBlockResult) {if (result.kind !== 'blocks') assert.fail(result.reason); assert.equal(result.kind, 'blocks'); return result;}
function verifySamples(source: DataSetXY, result: ReturnType<typeof blocks>) {
  const retainedFirst = source.getNextSampleIndex() - source.getSampleCount();
  for (const packet of result.packets) {
    assert.ok(packet.id < -(2 ** 40) + 1);
    assert.equal(packet.drawCount, packet.endOwnedSegment - packet.firstOwnedSegment + 1);
    for (let local = packet.drawFirst; local < packet.drawFirst + packet.drawCount; local++) {
      const index = packet.sourceFirstSample + local, offset = index - retainedFirst;
      const x = source.getValue('x', offset)!, y = source.getValue('y', offset)!;
      assert.ok(Math.abs(packet.positions[local * 2]! + packet.origin.x - x) <= packet.precision.maximumXError + Number.EPSILON);
      if (Number.isFinite(y)) assert.ok(Math.abs(packet.positions[local * 2 + 1]! + packet.origin.y - y) <= packet.precision.maximumYError + Number.EPSILON);
      else assert.ok(Number.isNaN(packet.positions[local * 2 + 1]!));
    }
  }
  for (let index = 1; index < result.packets.length; index++) assert.equal(result.packets[index - 1]!.endOwnedSegment, result.packets[index]!.firstOwnedSegment);
}

test('block planner partitions segments with one shared endpoint and no repeated segment', () => {
  const spans = planLineBlockSpans(0, 97, {first: 0, end: 96}, 16);
  assert.equal(spans.reduce((sum, span) => sum + span.endSegment - span.firstSegment, 0), 96);
  for (let index = 1; index < spans.length; index++) assert.equal(spans[index - 1]!.lastDrawSample, spans[index]!.firstDrawSample);
});

test('paged explicit Y and implicit X produce the same incremental blocks as dense ring storage', () => {
  const source = data(10000, {capacity: 10000}), paged = new PagedColumns({schema: {y: {storage: Float64Array}}, capacity: 10000, pageSize: 256});
  paged.appendSamples({y: source.readBack().data.y!});
  const denseCache = new LineBlockCache({segmentsPerBlock: 512}), pagedCache = new LineBlockCache({segmentsPerBlock: 512});
  for (let pass = 0; pass < 3; pass++) {
    if (pass) {const values = Float64Array.from({length: 137}, (_,i) => i % 17 ? Math.sin(i * .07) : NaN); source.appendSamples({y: values}); paged.appendSamples({y: values});}
    const req = request(source), dense = blocks(denseCache.update(req)), candidate = blocks(pagedCache.update({...req, source: {...req.source, identity: paged, y: paged.getColumnView('y')}}));
    assert.equal(candidate.packets.length, dense.packets.length);
    for (let i = 0; i < dense.packets.length; i++) {assert.deepEqual(candidate.packets[i]!.positions, dense.packets[i]!.positions); assert.deepEqual(candidate.packets[i]!.origin, dense.packets[i]!.origin);}
    verifySamples(source, candidate);
  }
});

test('default block leaves halo and strip padding inside one 32768-sample allocation', () => {
  const source = data(100000), cache = new LineBlockCache();
  const result = blocks(cache.update(request(source, 40000, 50000)));
  assert.equal(DEFAULT_LINE_BLOCK_SEGMENTS, 32760);
  assert.equal(result.packets.length, 1);
  const packet = result.packets[0]!;
  assert.equal(packet.count, DEFAULT_LINE_BLOCK_SEGMENTS + 3);
  assert.ok((packet.count + 2) * 16 <= 32768 * 16);
  assert.equal(result.stats.residentProjectionBytes, (DEFAULT_LINE_BLOCK_SEGMENTS + 3) * 8);
});

test('block projection keeps source auto-X implicit and exposes complete source precision', () => {
  const source = data(97, {start: 1700000000000, step: 1000 / 48000}), cache = new LineBlockCache({segmentsPerBlock: 16});
  const result = blocks(cache.update(request(source))); verifySamples(source, result);
  assert.equal(result.stats.sourceRetainedSamples, 97);
  assert.equal(source.getColumnRuns('x').kind, 'affine');
  assert.equal(source.getStorageStats().snapshotBytes, 0);
});

test('panning inside cached blocks changes draw range without projection or origin changes', () => {
  const source = data(100), cache = new LineBlockCache({segmentsPerBlock: 16});
  const before = blocks(cache.update(request(source, 20, 40))).packets.map(packet => ({id: packet.id, revision: packet.revision, storage: packet.positions.buffer, origin: packet.origin}));
  const after = blocks(cache.update(request(source, 21, 41)));
  assert.equal(after.stats.projectedSamplesThisUpdate, 0); assert.equal(after.stats.positionPairsWrittenThisUpdate, 0);
  after.packets.forEach((packet, index) => {assert.equal(packet.id, before[index]!.id); assert.equal(packet.revision, before[index]!.revision); assert.equal(packet.positions.buffer, before[index]!.storage); assert.equal(packet.origin, before[index]!.origin);});
  verifySamples(source, after);
});

test('multiple append batches between updates only project the new tail and its halos', () => {
  const source = data(100000), cache = new LineBlockCache();
  blocks(cache.update(request(source, 90000, 99999)));
  source.appendSamples({y: [1, 2, 3, 4]}); source.appendSamples({y: [5, 6, 7, 8, 9]});
  const result = blocks(cache.update(request(source, 90000, 100008)));
  assert.ok(result.stats.projectedSamplesThisUpdate <= 11, String(result.stats.projectedSamplesThisUpdate));
  verifySamples(source, result);
});

test('full ring retention clips old segments, patches the cap, and keeps existing origins', () => {
  const source = data(64, {capacity: 64}), cache = new LineBlockCache({segmentsPerBlock: 16});
  const first = blocks(cache.update(request(source))), original = first.packets[0]!.origin;
  source.appendSamples({y: Float64Array.from({length: 8}, (_, index) => .2 * index)});
  const result = blocks(cache.update(request(source)));
  assert.equal(result.packets[0]!.origin, original);
  assert.equal(result.packets[0]!.firstOwnedSegment, 8);
  assert.ok(result.stats.projectedSamplesThisUpdate < 20, String(result.stats.projectedSamplesThisUpdate));
  const packet = result.packets[0]!, local = packet.drawFirst;
  assert.equal(packet.positions[(local - 1) * 2], packet.positions[local * 2]);
  assert.equal(packet.positions[(local - 1) * 2 + 1], packet.positions[local * 2 + 1]);
  verifySamples(source, result);
});

test('clear and refill with the same point count invalidates all old block identities', () => {
  const source = data(30), cache = new LineBlockCache({segmentsPerBlock: 8});
  const ids = new Set(blocks(cache.update(request(source))).packets.map(packet => packet.id));
  source.clear(); source.appendSamples({y: new Float64Array(30).fill(99)}, {start: 10000, step: .25});
  const result = blocks(cache.update(request(source)));
  assert.ok(result.packets.every(packet => !ids.has(packet.id))); verifySamples(source, result);
});

test('negative X is valid, and nonfinite Y remains a gap at its source position', () => {
  const source = data(0), cache = new LineBlockCache({segmentsPerBlock: 4});
  source.appendSamples({y: [0, NaN, Infinity, -Infinity, 2, 3, 4, 5]}, {start: -10, step: .25});
  const result = blocks(cache.update(request(source))); verifySamples(source, result);
  assert.equal(source.getValue('y', 2), Infinity); assert.equal(source.getValue('y', 3), -Infinity);
});

test('full-source order certificate rejects a hidden reversal beyond the visible range', () => {
  const source = new DataSetXY({schema: {x: {storage: Float64Array}, y: {storage: Float64Array}}});
  const x = Float64Array.from({length: 100}, (_, index) => index); x[4] = 1;
  source.appendSamples({x, y: new Float64Array(100)});
  const result = new LineBlockCache({segmentsPerBlock: 8}).update(request(source, 80, 99));
  assert.equal(result.kind, 'fallback'); if (result.kind === 'fallback') assert.equal(result.reason, 'nonincreasing-x');
});

test('resource limit returns fallback without dropping source samples', () => {
  const source = data(100), cache = new LineBlockCache({segmentsPerBlock: 16, maximumProjectionBytes: 100});
  const result = cache.update(request(source)); assert.equal(result.kind, 'fallback');
  if (result.kind === 'fallback') assert.equal(result.reason, 'resource-limit');
  assert.equal(source.getSampleCount(), 100); assert.equal(result.stats.residentBlocks, 0);
});

test('style/binding changes invalidate atomically and cache disposal leaves the DataSet alive', () => {
  const source = data(100), cache = new LineBlockCache({segmentsPerBlock: 16});
  const ids = new Set(blocks(cache.update(request(source))).packets.map(packet => packet.id));
  const changed = request(source); changed.bindingRevision++; changed.styleRevision++;
  assert.ok(blocks(cache.update(changed)).packets.every(packet => !ids.has(packet.id)));
  cache.dispose(); cache.dispose(); assert.equal(source.getSampleCount(), 100);
  assert.throws(() => cache.update(request(source)), /disposed/);
});
