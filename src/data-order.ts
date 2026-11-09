import type {DataSetXY, DataColumnRuns, AffineColumnRun} from './core/data.js';
import {PagedColumnCursor} from './core/paged-columns.js';
import {readSourceCertificate, certifySourceDelta, type SourceCertificate} from './core/line-delta-certificate.js';

export interface ColumnOrder {
  /** All three properties cover the complete retained window, including hidden data.
   * An empty window is vacuously ordered. Consumers still need their own count guard.
   */
  readonly finite: boolean; readonly monotonic: boolean; readonly strict: boolean;
  readonly sampleCount: number; readonly firstIndex: number; readonly nextIndex: number; readonly contentEpoch: number;
  readonly lastInvalidPointIndex: number; readonly lastDecreaseEdgeIndex: number; readonly lastNonIncreaseEdgeIndex: number;
  /** Individually examined values, excluding endpoints of certified affine spans. */
  readonly scannedSamples: number; readonly lastScannedSamples: number;
  readonly affineFastSamples: number; readonly lastAffineFastSamples: number;
  readonly affineEndpointEvaluations: number; readonly lastAffineEndpointEvaluations: number;
  readonly cacheHits: number; readonly rebuilds: number;
}
interface State {
  epoch: number; first: number; next: number; lastIndex: number; lastValue: number;
  invalid: number; decrease: number; nonIncrease: number;
  scanned: number; lastScanned: number; fast: number; lastFast: number;
  endpoints: number; lastEndpoints: number; cacheHits: number; rebuilds: number;
}
interface Cache {epoch: number; columns: Map<string, State>;}
const caches = new WeakMap<DataSetXY, Cache>();

function resetContent(state: State): void {
  state.epoch = -1; state.first = 0; state.next = 0; state.lastIndex = -1; state.lastValue = NaN;
  state.invalid = -1; state.decrease = -1; state.nonIncrease = -1;
  state.lastScanned = 0; state.lastFast = 0; state.lastEndpoints = 0;
}
function createState(): State {
  return {epoch: -1, first: 0, next: 0, lastIndex: -1, lastValue: NaN, invalid: -1, decrease: -1, nonIncrease: -1,
    scanned: 0, lastScanned: 0, fast: 0, lastFast: 0, endpoints: 0, lastEndpoints: 0, cacheHits: 0, rebuilds: 0};
}
function cacheFor(dataSet: DataSetXY): Cache {
  let cache = caches.get(dataSet);
  if (!cache) {
    cache = {epoch: dataSet.getContentEpoch(), columns: new Map()};
    caches.set(dataSet, cache);
    const owned = cache;
    dataSet.onChange(current => {
      if (current.isDisposed()) { owned.columns.clear(); caches.delete(current); return; }
      const epoch = current.getContentEpoch();
      if (owned.epoch !== epoch) {
        for (const state of owned.columns.values()) resetContent(state);
        owned.epoch = epoch;
      }
    });
  }
  return cache;
}

function accept(state: State, index: number, value: number, first: number): void {
  if (!Number.isFinite(value)) state.invalid = index;
  if (index > first && state.lastIndex === index - 1) {
    if (value < state.lastValue) state.decrease = index;
    if (value <= state.lastValue) state.nonIncrease = index;
  }
  state.lastValue = value; state.lastIndex = index;
}

/** Sufficient, deliberately conservative certificate for the actual two rounded
 * operations start + (index - firstIndex) * step. Eight relative-error units cover
 * the two operations at both adjacent points; an absolute floor covers subnormals.
 * No run origin is rebased, and a failed certificate falls back to exact evaluations.
 */
function certifiedIncreasing(run: AffineColumnRun, firstOffset: number, lastOffset: number, a: number, b: number): boolean {
  if (!(run.step > 0) || !Number.isFinite(run.step) || !Number.isFinite(run.start) || !Number.isFinite(a) || !Number.isFinite(b) || !(b > a)) return false;
  const magnitude = Math.max(Math.abs(run.start), Math.abs(firstOffset * run.step), Math.abs(lastOffset * run.step), Math.abs(a), Math.abs(b));
  const separation = magnitude * Number.EPSILON * 8 + Number.MIN_VALUE * 8;
  return run.step > separation;
}

function scanAffine(state: State, view: Extract<DataColumnRuns, {kind: 'affine'}>, from: number, next: number): void {
  let low = view.runStart, high = view.runs.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2), run = view.runs[middle]!;
    if (run.firstIndex + run.count <= from) low = middle + 1;
    else high = middle;
  }
  for (let r = low; r < view.runs.length; r++) {
    const run = view.runs[r]!, first = Math.max(from, run.firstIndex), end = Math.min(next, run.firstIndex + run.count);
    if (first >= end) continue;
    if (end - first > 1) {
      const firstOffset = first - run.firstIndex, lastOffset = end - 1 - run.firstIndex;
      const a = run.start + firstOffset * run.step, b = run.start + lastOffset * run.step;
      state.endpoints += 2; state.lastEndpoints += 2;
      if (certifiedIncreasing(run, firstOffset, lastOffset, a, b)) {
        // The first point still needs its edge compared with the previous batch.
        accept(state, first, a, view.firstIndex);
        state.lastIndex = end - 1; state.lastValue = b;
        state.fast += end - first; state.lastFast += end - first;
        continue;
      }
    }
    for (let index = first; index < end; index++) accept(state, index, run.start + (index - run.firstIndex) * run.step, view.firstIndex);
    state.scanned += end - first; state.lastScanned += end - first;
  }
}

function result(state: State, first: number, next: number, epoch: number): ColumnOrder {
  const finite = state.invalid < first;
  return {finite, monotonic: finite && state.decrease <= first, strict: finite && state.nonIncrease <= first,
    sampleCount: next - first, firstIndex: first, nextIndex: next, contentEpoch: epoch,
    lastInvalidPointIndex: state.invalid, lastDecreaseEdgeIndex: state.decrease, lastNonIncreaseEdgeIndex: state.nonIncrease,
    scannedSamples: state.scanned, lastScannedSamples: state.lastScanned, affineFastSamples: state.fast, lastAffineFastSamples: state.lastFast,
    affineEndpointEvaluations: state.endpoints, lastAffineEndpointEvaluations: state.lastEndpoints,
    cacheHits: state.cacheHits, rebuilds: state.rebuilds};
}

/** Exact ordering of the full retained column. Latest violation indices are enough:
 * a retained point must be >= first, while both ends of an edge require index > first.
 * Append-only progress consumes only unseen retained data, independent of revisions.
 */
export function getColumnOrder(dataSet: DataSetXY, name: string): ColumnOrder {
  if (!(dataSet.hasColumn?.(name) ?? Object.prototype.hasOwnProperty.call(dataSet.schema, name))) throw new RangeError(`Unknown data column: ${name}`);
  const epoch = dataSet.getContentEpoch(), next = dataSet.getNextSampleIndex(), first = next - dataSet.getSampleCount();
  if (dataSet.isDisposed()) return result(createState(), first, next, epoch);
  const cache = cacheFor(dataSet);
  let state = cache.columns.get(name);
  if (!state) { state = createState(); cache.columns.set(name, state); }
  state.lastScanned = 0; state.lastFast = 0; state.lastEndpoints = 0;
  if (state.epoch === epoch && state.first === first && state.next === next) {
    state.cacheHits++;
    return result(state, first, next, epoch);
  }
  if (state.epoch !== epoch || next < state.next || first < state.first) {
    resetContent(state); state.rebuilds++;
  }
  const from = Math.max(first, state.next);
  if (from < next) {
    const view = dataSet.getColumnRuns(name);
    if (view.kind === 'affine') scanAffine(state, view, from, next);
    else if (view.kind === 'paged') {
      const cursor = new PagedColumnCursor(view, from);
      while (cursor.values) {
        const values = cursor.values, base = cursor.absoluteIndex - cursor.offset;
        for (let i = cursor.offset, end = i + cursor.length; i < end; i++) accept(state, base + i, values[i]!, first);
        cursor.next();
      }
      state.scanned += next - from; state.lastScanned += next - from;
    } else {
      let absolute = view.firstIndex;
      for (const values of view.slices) {
        const start = Math.max(0, from - absolute);
        for (let i = start; i < values.length; i++) accept(state, absolute + i, values[i]!, first);
        absolute += values.length;
      }
      state.scanned += next - from; state.lastScanned += next - from;
    }
  }
  state.epoch = epoch; state.first = first; state.next = next;
  return result(state, first, next, epoch);
}

/** Internal finite-only predicate. Its independent cache never publishes order
 * facts or changes getColumnOrder's scan counters. Every newly exposed value is
 * checked, including values outside the viewport; only a producer-certified
 * unchanged retained prefix can reuse earlier checks. */
export interface ColumnFinite {
  readonly finite: boolean;
  readonly verifiedCurrent: boolean;
  readonly sampleCount: number;
  readonly firstIndex: number;
  readonly nextIndex: number;
  readonly contentEpoch: number;
  readonly lastInvalidPointIndex: number;
  readonly scannedSamples: number;
  readonly lastScannedSamples: number;
  readonly fullScans: number;
  readonly incrementalScans: number;
  readonly cacheHits: number;
}
interface FiniteState {
  // SourceCertificate owns only scalar metadata, never borrowed source arrays.
  certificate?: SourceCertificate;
  invalid: number;
  scanned: number;
  fullScans: number;
  incrementalScans: number;
  cacheHits: number;
}
const finiteCaches = new WeakMap<DataSetXY, Map<string, FiniteState>>();

export function getColumnFinite(dataSet: DataSetXY, name: string): ColumnFinite {
  if (!(dataSet.hasColumn?.(name) ?? Object.prototype.hasOwnProperty.call(dataSet.schema, name))) throw new RangeError(`Unknown data column: ${name}`);
  const epoch = dataSet.getContentEpoch(), next = dataSet.getNextSampleIndex(), first = next - dataSet.getSampleCount();
  const expected = {revision: dataSet.revision, epoch, first, next};
  let columns = finiteCaches.get(dataSet);
  if (!columns && !dataSet.isDisposed()) {
    columns = new Map(); finiteCaches.set(dataSet, columns);
    const owned = columns;
    dataSet.onChange(current => {if (current.isDisposed()) {owned.clear(); finiteCaches.delete(current);}});
  }
  let state = columns?.get(name);
  if (!state) {state = {invalid: -1, scanned: 0, fullScans: 0, incrementalScans: 0, cacheHits: 0}; columns?.set(name, state);}
  const before = readSourceCertificate(dataSet, expected);
  const delta = !before?.tainted && state.certificate
    ? certifySourceDelta(dataSet, state.certificate, expected).delta : undefined;
  state.certificate = undefined;
  let from = first, scanned = 0;
  if (delta) {
    from = Math.max(first, delta.previous.next);
    if (delta.kind === 'unchanged') state.cacheHits++;
    else state.incrementalScans++;
  } else {state.invalid = -1; state.fullScans++;}
  if (from < next && !dataSet.isDisposed()) {
    const view = dataSet.getColumnRuns(name);
    if (view.firstIndex !== first || view.count !== next - first) throw new RangeError('Finite source does not cover the retained window');
    if (view.kind === 'dense') {
      let absolute = first;
      for (const values of view.slices) {
        const start = Math.max(0, from - absolute), end = Math.min(values.length, next - absolute);
        for (let i = start; i < end; i++) if (!Number.isFinite(values[i]!)) state.invalid = absolute + i;
        scanned += Math.max(0, end - start); absolute += values.length;
      }
    } else if (view.kind === 'paged') {
      for (let index = from; index < next;) {
        const pageIndex = Math.floor(index / view.pageSize), base = pageIndex * view.pageSize;
        const values = view.getPage(pageIndex), end = Math.min(next, base + view.pageSize);
        for (; index < end; index++) {if (!Number.isFinite(values?.[index - base])) state.invalid = index; scanned++;}
      }
    } else {
      for (let r = view.runStart; r < view.runs.length; r++) {
        const run = view.runs[r]!, begin = Math.max(from, run.firstIndex), end = Math.min(next, run.firstIndex + run.count);
        for (let index = begin; index < end; index++) if (!Number.isFinite(run.start + (index - run.firstIndex) * run.step)) state.invalid = index;
        scanned += Math.max(0, end - begin);
      }
    }
    if (scanned !== next - from) throw new RangeError('Finite source omitted retained values');
  }
  state.scanned += scanned;
  // Never cache a failed/reentrant producer or a scan spanning a source change.
  const after = readSourceCertificate(dataSet, expected);
  const verifiedCurrent = dataSet.revision === expected.revision && dataSet.getContentEpoch() === epoch &&
    dataSet.getNextSampleIndex() === next && dataSet.getSampleCount() === next - first && before === after;
  state.certificate = verifiedCurrent && after && !after.tainted ? after : undefined;
  return {finite: verifiedCurrent && state.invalid < first, verifiedCurrent, sampleCount: next - first, firstIndex: first,
    nextIndex: next, contentEpoch: epoch, lastInvalidPointIndex: state.invalid, scannedSamples: state.scanned,
    lastScannedSamples: scanned, fullScans: state.fullScans, incrementalScans: state.incrementalScans, cacheHits: state.cacheHits};
}
