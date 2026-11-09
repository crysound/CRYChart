import test from 'node:test';
import assert from 'node:assert/strict';
import {DataSetXY} from '../src/core/data.js';
import {ChartXY} from '../src/chart.js';
import {getColumnBounds, getColumnBoundsStats} from '../src/data-bounds.js';
import {getColumnOrder} from '../src/data-order.js';
import {LineBlockCache, type LineBlockRequest} from '../src/line-block-cache.js';

function data(paged: boolean, auto = true, capacity = 2048) {
  return new DataSetXY({schema: {x: {storage: Float64Array, auto, pattern: 'progressive'}, raw: {storage: Float64Array}, render: {storage: Float64Array}},
    ...(paged ? {columnStorage: {mode: 'paged' as const, pageSize: 256, poolPagesPerStorage: 0}} : {})}).setMaxSampleCount(capacity);
}
function source(data: DataSetXY): LineBlockRequest {
  const next = data.getNextSampleIndex(), first = next - data.getSampleCount();
  return {source: {identity: data, contentEpoch: data.getContentEpoch(), revision: data.revision, firstSampleIndex: first, nextSampleIndex: next, x: data.getColumnRuns('x'), y: data.getColumnRuns('render')},
    projectionKey: 'x/render', coordinateMode: 'linear', bindingRevision: 0, styleRevision: 0,
    visibleSegments: {first, end: next - 1}, domain: {x: {start: 0, end: 3000}, y: {start: -2, end: 2}},
    style: {color: [1, 0, 0, 1], thickness: 2}, monotonicX: getColumnOrder(data, 'x').strict ? 'verified-strict' : 'invalid'};
}

test('actual opt-in DataSet projects through ChartXY series, cursor lookup and incremental blocks without materialization', () => {
  const paged = data(true), dense = data(false), a = new ChartXY({renderer: 'canvas2d'}), b = new ChartXY({renderer: 'canvas2d'});
  const lineA = a.addLineSeries({dataSet: paged}).setDataMapping({x: 'x', y: 'render'}), lineB = b.addLineSeries({dataSet: dense}).setDataMapping({x: 'x', y: 'render'});
  const other = a.addLineSeries({dataSet: paged}).setDataMapping({x: 'x', y: 'raw'});
  const blockA = new LineBlockCache({segmentsPerBlock: 257}), blockB = new LineBlockCache({segmentsPerBlock: 257});
  paged.getColumnSlices = () => {throw new Error('renderer must not materialize');};
  paged.getColumn = () => {throw new Error('renderer must not snapshot entire columns');};
  for (let pass = 0; pass < 6; pass++) {
    const n = pass ? 317 : 2048, raw = Float64Array.from({length: n}, (_, i) => i % 97 ? Math.sin((pass * 317 + i) * .01) : Infinity), render = Float64Array.from(raw, value => Number.isFinite(value) ? value : NaN);
    paged.appendSamples({raw, render}, {step: .125}); dense.appendSamples({raw, render}, {step: .125});
    a.renderNow(); b.renderNow(); assert.deepEqual(lineA.bounds('y'), lineB.bounds('y')); assert.deepEqual(lineA.drawPacket('line').positions, lineB.drawPacket('line').positions);
    const near = paged.getValue('x', Math.floor(paged.getSampleCount() / 2))!; assert.deepEqual(lineA.findNearestX(near), lineB.findNearestX(near));
    const pa = blockA.update(source(paged)), pb = blockB.update(source(dense));
    assert.equal(pa.kind, 'blocks'); assert.equal(pb.kind, 'blocks');
    if (pa.kind === 'blocks' && pb.kind === 'blocks') {assert.equal(pa.packets.length, pb.packets.length); for (let i = 0; i < pa.packets.length; i++) assert.deepEqual(pa.packets[i].positions, pb.packets[i].positions);}
    assert.equal(paged.getColumnRuns('x').kind, 'affine'); assert.equal(paged.getColumnRuns('raw').kind, 'paged'); assert.equal(paged.getColumnRuns('render').kind, 'paged');
    const stats = paged.getStorageStats(); assert.equal(stats.denseTypedArrayBytes, 0); assert.equal(stats.snapshotBytes, 0); assert.equal(stats.pagedPromotionCount, 0);
  }
  other.dispose(); lineA.dispose(); assert.equal(paged.getSampleCount(), 2048); a.dispose(); b.dispose(); paged.dispose(); dense.dispose();
  assert.equal(paged.getStorageStats().ownedNumericBytes, 0);
});

test('actual paged explicit-X dataset bounds/order only read new tail and retained head after a full ring wraps', () => {
  const item = data(true, false, 20000), x = Float64Array.from({length: 20000}, (_, i) => i), y = Float64Array.from(x, value => Math.sin(value));
  item.appendSamples({x, raw: y, render: y}); assert.equal(getColumnOrder(item, 'x').strict, true); getColumnBounds(item, 'render');
  const original = item.getColumnRuns.bind(item); let pageReads = 0;
  item.getColumnRuns = name => {const view = original(name); return view.kind === 'paged' ? {...view, getPage(index: number) {pageReads++; return view.getPage(index);}} : view;};
  item.appendSamples({x: [20000, 20001, 20002], raw: [-5, Infinity, 7], render: [-5, NaN, 7]});
  assert.equal(getColumnOrder(item, 'x').lastScannedSamples, 3); assert.ok(pageReads <= 2); pageReads = 0;
  assert.deepEqual(getColumnBounds(item, 'render'), {start: -5, end: 7}); assert.ok(pageReads <= 8); assert.ok(getColumnBoundsStats(item, 'render')!.lastScannedSamples <= 1026);
  assert.equal(item.getStorageStats().snapshotBytes, 0); assert.equal(item.getStorageStats().denseTypedArrayBytes, 0); item.dispose();
});

test('same-size atomic replacement invalidates exact bounds/order caches without materializing the paged source', () => {
  const item = data(true, false, 8); item.appendSamples({x: [1, 2, 3], raw: [1, 2, 3], render: [1, 2, 3]});
  assert.equal(getColumnOrder(item, 'x').strict, true); assert.deepEqual(getColumnBounds(item, 'render'), {start: 1, end: 3});
  item.replaceSamples({x: [3, 2, 1], raw: [Infinity, 100, -8], render: [NaN, 100, -8]});
  assert.equal(getColumnOrder(item, 'x').monotonic, false); assert.deepEqual(getColumnBounds(item, 'render'), {start: -8, end: 100});
  assert.equal(item.getColumnRuns('x').kind, 'paged'); assert.equal(item.getStorageStats().denseTypedArrayBytes, 0); item.dispose();
});
