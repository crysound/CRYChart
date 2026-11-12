import test from 'node:test';
import assert from 'node:assert/strict';
import {DataSetXY} from '../src/core/data.js';
import {getColumnOrder} from '../src/data-order.js';
import {LineDisplayCache, type LineDisplayRequest, type LineDisplayResult} from '../src/line-display-cache.js';
import {PagedColumns} from '../src/core/paged-columns.js';

function make(count: number, options: {capacity?: number; start?: number; step?: number; y?: (index: number) => number} = {}) {
  const data = new DataSetXY({schema: {x: {storage: Float64Array, auto: true, pattern: 'progressive'}, y: {storage: Float64Array}}});
  if (options.capacity) data.setMaxSampleCount(options.capacity);
  data.appendSamples({y: Float64Array.from({length: count}, (_, index) => options.y?.(index) ?? Math.sin(index * .19) + Math.cos(index * .03) * .2)}, {start: options.start ?? 0, step: options.step ?? 1});
  return data;
}
function request(data: DataSetXY, options: {first?: number; last?: number; width?: number; span?: number; audit?: boolean} = {}): LineDisplayRequest {
  const next = data.getNextSampleIndex(), first = next - data.getSampleCount(), order = getColumnOrder(data, 'x');
  return {source: {identity: data, contentEpoch: data.getContentEpoch(), revision: data.revision, firstSampleIndex: first, nextSampleIndex: next, x: data.getColumnRuns('x'), y: data.getColumnRuns('y')},
    coordinateMode: 'linear', bindingRevision: 0, styleRevision: 0, projectionKey: 'linear-x/y', monotonicX: order.finite && order.strict ? 'verified-strict' : 'invalid',
    visibleSegments: {first: options.first ?? first, end: options.last ?? next - 1},
    domain: {x: {start: data.getValue('x', 0)!, end: data.getValue('x', data.getSampleCount() - 1)!}, y: {start: -2, end: 2}},
    plotRect: {left: 0, top: 0, width: options.width ?? 100, height: 420}, devicePixelRatio: 1, maximumPixelSpan: options.span ?? 1,
    style: {color: [0, 1, 1, 1], thickness: 2}, collectAudit: options.audit ?? true};
}
function display(result: LineDisplayResult) {if (result.kind !== 'display') throw new Error(result.reason); return result;}
function original(data: DataSetXY) {return data.readBack().data;}
function verifySources(data: DataSetXY, result: ReturnType<typeof display>) {
  const packet = result.packet!; const first = data.getNextSampleIndex() - data.getSampleCount();
  assert.equal(result.sourceIndices.length, packet.count);
  for (let local = 0; local < packet.count; local++) {
    const absolute = result.sourceIndices[local]!, offset = absolute - first;
    assert.ok(Number.isSafeInteger(absolute) && absolute >= first && offset < data.getSampleCount());
    if (local) assert.ok(absolute > result.sourceIndices[local - 1]!);
    const x = data.getValue('x', offset)!, y = data.getValue('y', offset)!;
    assert.ok(Math.abs(packet.positions[local * 2]! + packet.origin.x - x) <= result.stats.maximumProjectionXError + Number.EPSILON);
    if (Number.isFinite(y)) assert.ok(Math.abs(packet.positions[local * 2 + 1]! + packet.origin.y - y) <= result.stats.maximumProjectionYError + Number.EPSILON);
    else assert.ok(Number.isNaN(packet.positions[local * 2 + 1]!));
  }
}

test('display selection keeps true extrema, source order and bounded X slabs without altering raw rows', () => {
  const data = make(100000, {y: i => i % 997 === 0 ? 9 : i % 991 === 0 ? -8 : Math.sin(i * .19)}), before = original(data), cache = new LineDisplayCache();
  const result = display(cache.update(request(data, {width: 800, span: 1}))), selected = new Set(result.sourceIndices);
  assert.ok(result.stats.displayReduction); assert.ok(result.stats.submittedDisplaySamples < 20000); verifySources(data, result);
  for (const range of result.audit!) {
    assert.ok(range.pixelSpan <= 1 + 1e-12);
    assert.ok(selected.has(range.first) && selected.has(range.last));
    if (range.finite) {
      assert.ok(selected.has(range.minimum) && selected.has(range.maximum));
      const min = data.getValue('y', range.minimum)!, max = data.getValue('y', range.maximum)!;
      for (let index = range.first; index <= range.last; index++) {const value = data.getValue('y', index)!; assert.ok(value >= min && value <= max);}
    }
  }
  assert.deepEqual(original(data), before); assert.equal(data.getSampleCount(), 100000); assert.equal(data.getColumnRuns('x').kind, 'affine');
});

test('NaN and infinity gaps never acquire a new finite bridge, including page and leaf boundaries', () => {
  const gaps = new Set([0, 15, 16, 17, 4095, 4096, 4097, 8191, 8192, 9999]);
  const data = make(10000, {y: index => gaps.has(index) ? index % 2 ? Infinity : NaN : Math.sin(index * .1)}), result = display(new LineDisplayCache().update(request(data)));
  verifySources(data, result);
  for (let i = 1; i < result.sourceIndices.length; i++) {
    const a = result.sourceIndices[i - 1]!, b = result.sourceIndices[i]!;
    if (Number.isFinite(data.getValue('y', a)) && Number.isFinite(data.getValue('y', b))) for (let index = a; index <= b; index++) assert.ok(Number.isFinite(data.getValue('y', index)), 'unexpected bridge at ' + index);
  }
  const selected = new Set(result.sourceIndices);
  for (const gap of gaps) {if (gap > 0 && !gaps.has(gap - 1)) assert.ok(selected.has(gap - 1)); if (gap < 9999 && !gaps.has(gap + 1)) assert.ok(selected.has(gap + 1));}
});

test('sparse zoom returns every real sample and keeps only original join halos', () => {
  const data = make(1000), req = request(data, {first: 400, last: 420, width: 800});
  req.domain.x = {start: 400, end: 420};
  const result = display(new LineDisplayCache().update(req));
  assert.deepEqual([...result.sourceIndices], Array.from({length: 23}, (_, i) => 399 + i));
  assert.equal(result.packet!.drawFirst, 1); assert.equal(result.packet!.drawCount, 21); assert.equal(result.stats.displayReduction, false);
});

test('append across multiple revisions only rebuilds the tail leaf and new source samples', () => {
  const data = make(100000), cache = new LineDisplayCache();
  display(cache.update(request(data)));
  data.appendSamples({y: new Float64Array(9).fill(40)}); data.appendSamples({y: new Float64Array(22).fill(-40)});
  const result = display(cache.update(request(data)));
  assert.ok(result.stats.sourceSamplesScannedThisUpdate <= 31 + 15, String(result.stats.sourceSamplesScannedThisUpdate));
  assert.ok(result.stats.reusedSelectionPages > 20, String(result.stats.reusedSelectionPages));
  assert.ok(result.sourceIndices.includes(100000)); assert.ok(result.sourceIndices.includes(100009)); verifySources(data, result);
});

test('ring retention excludes expired extrema and cached summaries match a fresh cache', () => {
  const capacity = 10000, data = make(capacity, {capacity, y: i => i === 2 ? -100 : i === 63 ? 100 : Math.sin(i * .1)}), cache = new LineDisplayCache();
  display(cache.update(request(data)));
  for (let pass = 0; pass < 4; pass++) {
    data.appendSamples({y: Float64Array.from({length: 97}, (_, index) => Math.cos((pass * 97 + index) * .13))});
    const current = display(cache.update(request(data))), fresh = display(new LineDisplayCache().update(request(data)));
    assert.deepEqual([...current.sourceIndices], [...fresh.sourceIndices]);
    assert.ok(current.stats.sourceSamplesScannedThisUpdate <= 97 + 15); verifySources(data, current);
  }
});

test('full-page selection survives advancing retention while only the clipped tree edge is queried', () => {
  const data = make(48000, {capacity: 48000, y: i => i % 997 ? Math.sin(i * .19) : NaN}), cache = new LineDisplayCache();
  display(cache.update(request(data, {width: 800, audit: false})));
  for (let pass = 0; pass < 9; pass++) {
    data.appendSamples({y: Float64Array.from({length: 960}, (_, i) => (pass * 960 + i) % 991 ? Math.cos(i * .17) : NaN)});
    const req = request(data, {width: 800, audit: false}); req.strokeGroup = 123;
    const result = display(cache.update(req)), fresh = display(new LineDisplayCache().update(req));
    assert.deepEqual(result.sourceIndices, fresh.sourceIndices);
    assert.equal(result.packet!.strokeGroup, 123);
    assert.ok(result.stats.visitedSummaryNodes < fresh.stats.visitedSummaryNodes / 2);
    assert.ok(result.stats.sourceSamplesScannedThisUpdate <= 975);
    assert.ok(result.stats.cachedTopologyBytes > 0 && result.stats.cachedTopologyBytes < 100000);
    verifySources(data, result);
  }
});

test('selection topology keeps large absolute sample indices without signed 32-bit truncation', () => {
  const data = make(10000), req = request(data, {audit: false}), offset = 2 ** 40;
  const shift = (column: LineDisplayRequest['source']['x']): LineDisplayRequest['source']['x'] => {
    if (column.kind === 'dense') return {...column, firstIndex: column.firstIndex + offset};
    if (column.kind === 'affine') return {...column, firstIndex: column.firstIndex + offset, runs: column.runs.map(run => ({...run, firstIndex: run.firstIndex + offset}))};
    throw new Error('Test requires dense or affine storage');
  };
  req.source = {...req.source, firstSampleIndex: offset, nextSampleIndex: offset + 10000, x: shift(req.source.x), y: shift(req.source.y)};
  req.visibleSegments = {first: offset, end: offset + 9999};
  const cache = new LineDisplayCache(); display(cache.update(req));
  req.visibleSegments = {first: offset + 123, end: offset + 8456};
  const result = display(cache.update(req)), fresh = display(new LineDisplayCache().update(req));
  assert.deepEqual(result.sourceIndices, fresh.sourceIndices);
  assert.equal(result.sourceIndices[0], offset + 122);
  for (let i = 0; i < result.sourceIndices.length; i++) assert.equal(result.packet!.positions[i * 2]! + result.packet!.origin.x, result.sourceIndices[i]! - offset);
});

test('panning within pages reuses summaries and evicts pages outside the requested view', () => {
  const data = make(100000), cache = new LineDisplayCache();
  const before = display(cache.update(request(data, {first: 20000, last: 40000})));
  const after = display(cache.update(request(data, {first: 20001, last: 40001})));
  assert.equal(after.stats.sourceSamplesScannedThisUpdate, 0); assert.equal(after.stats.summaryBytes, before.stats.summaryBytes);
  assert.ok(after.stats.reusedSelectionPages >= 3);
  const far = display(cache.update(request(data, {first: 90000, last: 99999})));
  assert.ok(far.stats.evictedPages > 0); assert.ok(far.stats.summaryPages <= 4); assert.ok(far.stats.summaryBytes <= 4 * 2560);
});

test('small per-channel Y ranges omit unnecessary smooth-turn neighbors while retaining source extrema', () => {
  const data = make(48000, {start: 0, step: 1000 / 48000, y: i => .8 * Math.sin(i * .017) + .08 * Math.cos(i * .113)}), req = request(data, {width: 800});
  req.domain.y = {start: -1.3 * 128, end: 1.3 * 128};
  const cache = new LineDisplayCache(), result = display(cache.update(req));
  assert.ok(result.stats.submittedDisplaySamples < 4300, String(result.stats.submittedDisplaySamples)); verifySources(data, result);
  req.domain.x.end += 1e-12;
  const moved = display(cache.update(req)); assert.equal(moved.stats.reusedSelectionPages, moved.stats.summaryPages);
});

test('paged ring columns use direct borrowed pages and match dense source selection without materialization', () => {
  const data = make(10000, {capacity: 10000}), paged = new PagedColumns({schema: {y: {storage: Float64Array}}, capacity: 10000, pageSize: 256});
  paged.appendSamples({y: data.readBack().data.y!});
  const a = new LineDisplayCache(), b = new LineDisplayCache();
  for (let pass = 0; pass < 3; pass++) {
    if (pass) {const values = Float64Array.from({length: 117}, (_,i) => i % 17 ? Math.sin(i * .1) : NaN); data.appendSamples({y: values}); paged.appendSamples({y: values});}
    const req = request(data), pagedRequest = {...req, source: {...req.source, identity: paged, y: paged.getColumnView('y')}};
    const dense = display(a.update(req)), result = display(b.update(pagedRequest));
    assert.deepEqual([...result.sourceIndices], [...dense.sourceIndices]); assert.deepEqual(result.packet!.positions, dense.packet!.positions);
    assert.equal(paged.getColumnView('y').count, 10000);
  }
});

test('clear and refill of equal length cannot reuse old values or origin', () => {
  const data = make(1000), cache = new LineDisplayCache(), first = display(cache.update(request(data))), id = first.packet!.id;
  data.clear(); data.appendSamples({y: new Float64Array(1000).fill(72)}, {start: 1e12, step: .25});
  const next = display(cache.update(request(data))); assert.notEqual(next.packet!.id, id); assert.equal(next.packet!.origin.x, 1e12); verifySources(data, next);
  assert.ok(next.stats.sourceSamplesScannedThisUpdate >= 1000);
});

test('epoch X, reversed axes and large-offset Y keep raw source values and bounded projection errors', () => {
  const data = make(10000, {start: 1700000000000, step: 1000 / 48000, y: i => 1e9 + Math.sin(i * .1) * 1e-4});
  const req = request(data, {width: 800}); [req.domain.x.start, req.domain.x.end] = [req.domain.x.end, req.domain.x.start];
  const result = display(new LineDisplayCache().update(req)); verifySources(data, result);
  assert.ok(result.stats.maximumProjectionXError < .001); assert.ok(result.stats.maximumProjectionYError < 1e-7);
});

test('hidden source reversal rejects simplification even when the visible tail is ordered', () => {
  const data = new DataSetXY({schema: {x: {storage: Float64Array}, y: {storage: Float64Array}}}), xs = Float64Array.from({length: 10000}, (_, i) => i); xs[1] = 50;
  data.appendSamples({x: xs, y: new Float64Array(10000)});
  const result = new LineDisplayCache().update(request(data, {first: 9000, last: 9999}));
  assert.equal(result.kind, 'fallback'); if (result.kind === 'fallback') assert.equal(result.reason, 'unverified-x-order');
});

test('resource limits fall back without dropping raw samples, and disposal leaves shared data alive', () => {
  const data = make(10000), result = new LineDisplayCache({maximumSummaryBytes: 1}).update(request(data));
  assert.equal(result.kind, 'fallback'); assert.equal(data.getSampleCount(), 10000);
  const cache = new LineDisplayCache({maximumDisplaySamples: 32}), req = request(data); req.domain.x = {start: 0, end: 100};
  assert.equal(cache.update(req).kind, 'fallback'); assert.equal(data.getSampleCount(), 10000);
  const alive = new LineDisplayCache(); display(alive.update(request(data))); alive.dispose(); alive.dispose(); assert.equal(data.getSampleCount(), 10000); assert.throws(() => alive.update(request(data)), /disposed/);
});

test('independent centerline oracle bounds both directions inside each accepted X slab', () => {
  const data = make(12000, {y: i => Math.sin(i * .23) * (i % 71 ? 1 : 4)}), req = request(data, {width: 800, span: .5}), result = display(new LineDisplayCache().update(req));
  const distance = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1))); return Math.hypot(px - ax - t * dx, py - ay - t * dy);};
  const sx = 800 / 11999, sy = 420 / 8;
  for (const cell of result.audit!) {
    if (!cell.finite || cell.last - cell.first < 4) continue;
    const selected = [...new Set([cell.first, cell.minimum, cell.maximum, cell.last])].sort((a,b) => a-b);
    for (let index = cell.first; index <= cell.last; index++) {
      let nearest = Infinity;
      for (let s = 1; s < selected.length; s++) nearest = Math.min(nearest, distance(index * sx, data.getValue('y',index)! * sy, selected[s-1]! * sx, data.getValue('y',selected[s-1]!)! * sy, selected[s]! * sx, data.getValue('y',selected[s]!)! * sy));
      assert.ok(nearest <= .5 + 1e-9, String(nearest));
    }
    for (let s = 1; s < selected.length; s++) for (const t of [.25,.5,.75]) {
      const a=selected[s-1]!, b=selected[s]!, px=(a+(b-a)*t)*sx, py=(data.getValue('y',a)!+(data.getValue('y',b)!-data.getValue('y',a)!)*t)*sy;
      let nearest=Infinity; for(let i=cell.first+1;i<=cell.last;i++) nearest=Math.min(nearest,distance(px,py,(i-1)*sx,data.getValue('y',i-1)!*sy,i*sx,data.getValue('y',i)!*sy));
      assert.ok(nearest <= .5 + 1e-9, String(nearest));
    }
  }
});

for (const mode of ['pages', 'arena'] as const) test(`${mode} projection recovery retains summaries, peaks and gaps and resumes incremental updates`, () => {
  const capacity = 192000 * 60, batch = 192000 * 6, step = 1000 / 192000;
  const values = (n: number, first: number) => Float64Array.from({length: n}, (_, i) => (first + i) % 8191 === 0 ? NaN : (first + i) % 997 === 0 ? 1 : 0);
  const data = new DataSetXY({schema: {x: {storage: Float64Array, auto: true, pattern: 'progressive'}, y: {storage: Float64Array}}});
  data.setMaxSampleCount(capacity);
  data.appendSamples({y: values(capacity, 0)}, {start: 1811059, step});
  const cache = new LineDisplayCache();
  const draw = () => display(cache.update({...request(data, {width: 910, audit: false}), strokeGroup: 42,
    packetMode: mode, reuseCertifiedPages: true, reuseUnchangedGroups: true, collectSourceIndices: false}));
  try {
    draw();
    data.appendSamples({y: values(batch, capacity)});
    const recovered = draw();
    assert.equal(recovered.stats.projectionRebasesThisUpdate, 1);
    assert.ok(recovered.stats.sourceSamplesScannedThisUpdate <= batch + 32);
    assert.ok(recovered.stats.reusedPages > 2500);
    assert.ok(recovered.stats.submittedDisplaySamples < 100000);
    let sawPeak = false, sawGap = false;
    for (const packet of recovered.packets!) for (let i = 0; i < packet.count; i++) {
      const rawX = packet.positions[i * 2]! + packet.origin.x;
      const absolute = Math.round((rawX - 1811059) / step);
      const rawY = data.getValue('y', absolute - batch)!;
      const displayedY = packet.positions[i * 2 + 1]! + packet.origin.y;
      if (Number.isNaN(rawY)) {assert.ok(Number.isNaN(displayedY)); sawGap = true;}
      else {assert.equal(displayedY, rawY); if (rawY === 1) sawPeak = true;}
      if (i) assert.ok(packet.positions[i * 2]! > packet.positions[(i - 1) * 2]!);
    }
    assert.ok(sawPeak && sawGap);
    data.appendSamples({y: values(9600, capacity + batch)});
    const next = draw();
    assert.equal(next.stats.projectionRebasesThisUpdate, 0);
    assert.ok(next.stats.sourceSamplesScannedThisUpdate <= 9616);
    assert.ok(next.stats.projectedSamplesThisUpdate < 1000);
    if (mode === 'arena') {
      assert.equal(next.stats.arena!.fullRebuild, false);
      assert.ok(next.stats.selectionDelta!.reusedCompletePages > 2500);
    }
  } finally {cache.dispose(); data.dispose();}
});

test('irreducible Float32 spacing still falls back after one bounded projection recovery', () => {
  const data = make(1, {start: 0});
  data.appendSamples({y: Float64Array.from({length: 4999}, (_, i) => i % 2)}, {start: 1e12, step: .001});
  const cache = new LineDisplayCache();
  const result = cache.update({...request(data), strokeGroup: 1, packetMode: 'arena'});
  assert.equal(result.kind, 'fallback');
  if (result.kind === 'fallback') assert.equal(result.reason, 'unverified-x-order');
  assert.equal(result.stats.projectionRebasesThisUpdate, 1);
  assert.equal(data.getSampleCount(), 5000);
  cache.dispose(); data.dispose();
});
