import {DataSetXY, type DataColumnRuns} from './core/data.js';
import type {Interval} from './contracts.js';
import {boundsFromRuns} from './data-runs.js';
import {getColumnOrder} from './data-order.js';
import {PagedColumnCursor} from './core/paged-columns.js';

export const DATA_BOUNDS_BLOCK_SIZE = 1024;

export interface ColumnBoundsStats {
  readonly scannedSamples: number;
  readonly lastScannedSamples: number;
  readonly fullBlockBuilds: number;
  readonly lastFullBlockBuilds: number;
  readonly affineRunVisits: number;
  readonly lastAffineRunVisits: number;
  readonly affineEndpointReads: number;
  readonly lastAffineEndpointReads: number;
  readonly cacheHits: number;
  readonly rebuilds: number;
  readonly updates: number;
  readonly fullBlocksInWindow: number;
  readonly cachedExtremaEntries: number;
  readonly retainedExtremaEntries: number;
}
interface Summary {start: number; end: number; min: number; max: number;}
interface Extreme {block: number; value: number;}

/** Only complete immutable blocks enter these queues. A later, more extreme block
 * outlives every earlier block it removes, so discarded summaries never need replay.
 */
class ExtremeQueue {
  private items: Extreme[] = [];
  private head = 0;
  constructor(private readonly minimum: boolean) {}
  add(block: number, value: number): void {
    if (!Number.isFinite(value)) return;
    while (this.items.length > this.head) {
      const previous = this.items[this.items.length - 1]!.value;
      const winner = this.minimum ? Math.min(previous, value) : Math.max(previous, value);
      // Object.is preserves the distinction between negative and positive zero.
      if (!Object.is(winner, value)) break;
      this.items.pop();
    }
    this.items.push({block, value});
  }
  expire(firstBlock: number): void {
    while (this.head < this.items.length && this.items[this.head]!.block < firstBlock) this.head++;
    if (this.head > 256 && this.head * 2 > this.items.length) {
      this.items = this.items.slice(this.head); this.head = 0;
    }
  }
  get value(): number { return this.items[this.head]?.value ?? (this.minimum ? Infinity : -Infinity); }
  get size(): number { return this.items.length - this.head; }
  get storedSize(): number { return this.items.length; }
  clear(): void { this.items = []; this.head = 0; }
}

interface State {
  epoch: number; revision: number; first: number; end: number;
  kind?: DataColumnRuns['kind']; processedFullEnd: number;
  head?: Summary; tail?: Summary; result?: Interval;
  minima: ExtremeQueue; maxima: ExtremeQueue;
  scannedSamples: number; lastScannedSamples: number;
  fullBlockBuilds: number; lastFullBlockBuilds: number;
  affineRunVisits: number; lastAffineRunVisits: number;
  affineEndpointReads: number; lastAffineEndpointReads: number;
  cacheHits: number; rebuilds: number; updates: number;
}
interface DataSetCache {columns: Map<string, State>; epoch: number;}
const caches = new WeakMap<DataSetXY, DataSetCache>();

function clearComputed(state: State): void {
  state.epoch = -1; state.revision = -1; state.first = 0; state.end = 0;
  state.kind = undefined; state.processedFullEnd = 0;
  state.head = undefined; state.tail = undefined; state.result = undefined;
  state.minima.clear(); state.maxima.clear();
  state.lastScannedSamples = 0; state.lastFullBlockBuilds = 0; state.lastAffineRunVisits = 0; state.lastAffineEndpointReads = 0;
}
function createState(): State {
  return {epoch: -1, revision: -1, first: 0, end: 0, processedFullEnd: 0,
    minima: new ExtremeQueue(true), maxima: new ExtremeQueue(false),
    scannedSamples: 0, lastScannedSamples: 0, fullBlockBuilds: 0, lastFullBlockBuilds: 0,
    affineRunVisits: 0, lastAffineRunVisits: 0, affineEndpointReads: 0, lastAffineEndpointReads: 0, cacheHits: 0, rebuilds: 0, updates: 0};
}
function dataSetCache(dataSet: DataSetXY): DataSetCache {
  let cache = caches.get(dataSet);
  if (!cache) {
    cache = {columns: new Map(), epoch: dataSet.getContentEpoch()};
    caches.set(dataSet, cache);
    const owned = cache;
    // No data arrays or data-set reference are captured. The weak key owns this cache.
    dataSet.onChange(current => {
      if (current.isDisposed()) { owned.columns.clear(); caches.delete(current); return; }
      const epoch = current.getContentEpoch();
      if (epoch !== owned.epoch) {
        for (const state of owned.columns.values()) clearComputed(state);
        owned.epoch = epoch;
      }
    });
  }
  return cache;
}

function readStoredRange(view: Extract<DataColumnRuns, {kind: 'dense'|'paged'}>, start: number, end: number, state: State, seed?: Summary): Summary {
  const reuse = seed && seed.start === start && seed.end <= end;
  const scanStart = reuse ? seed.end : start;
  let min = reuse ? seed.min : Infinity, max = reuse ? seed.max : -Infinity;
  if (view.kind === 'paged') {
    const cursor = new PagedColumnCursor(view, scanStart);
    while (cursor.values && cursor.absoluteIndex < end) {
      const values = cursor.values, stop = cursor.offset + Math.min(cursor.length, end - cursor.absoluteIndex);
      for (let i = cursor.offset; i < stop; i++) {
        const value = values[i]!;
        if (Number.isFinite(value)) {
          if (value < min || (value === 0 && min === 0 && Object.is(value, -0))) min = value;
          if (value > max || (value === 0 && max === 0 && Object.is(value, 0))) max = value;
        }
      }
      if (cursor.absoluteIndex + cursor.length >= end) break;
      cursor.next();
    }
  } else {
    let absolute = view.firstIndex;
    for (const values of view.slices) {
      const from = Math.max(0, scanStart - absolute), to = Math.min(values.length, end - absolute);
      for (let i = from; i < to; i++) {
        const value = values[i]!;
        if (Number.isFinite(value)) {
          // Match Math.min/max's signed-zero ties without doing both full
          // extrema operations for every ordinary, already bounded sample.
          if (value < min || (value === 0 && min === 0 && Object.is(value, -0))) min = value;
          if (value > max || (value === 0 && max === 0 && Object.is(value, 0))) max = value;
        }
      }
      absolute += values.length;
      if (absolute >= end) break;
    }
  }
  state.scannedSamples += end - scanStart; state.lastScannedSamples += end - scanStart;
  return {start, end, min, max};
}

/** Exact finite bounds of retained samples. Dense columns scan each completed block
 * once; a rolling update scans only new samples and its truncated first block.
 * Automatic coordinates use original per-batch endpoint expressions without a dense X.
 */
export function getColumnBounds(dataSet: DataSetXY, name: string): Interval | undefined {
  if (!(dataSet.hasColumn?.(name) ?? Object.prototype.hasOwnProperty.call(dataSet.schema, name))) throw new RangeError(`Unknown data column: ${name}`);
  if (dataSet.isDisposed()) return undefined;
  const cache = dataSetCache(dataSet);
  let state = cache.columns.get(name);
  if (!state) { state = createState(); cache.columns.set(name, state); }
  state.lastScannedSamples = 0; state.lastFullBlockBuilds = 0; state.lastAffineRunVisits = 0; state.lastAffineEndpointReads = 0;
  const epoch = dataSet.getContentEpoch(), end = dataSet.getNextSampleIndex(), first = end - dataSet.getSampleCount();
  if (state.epoch === epoch && state.first === first && state.end === end) {
    state.revision = dataSet.revision; state.cacheHits++;
    return state.result && {...state.result};
  }
  const view = dataSet.getColumnRuns(name);
  if (state.epoch !== epoch || state.kind !== view.kind || first < state.first || end < state.end) {
    clearComputed(state); state.rebuilds++;
  }
  state.updates++;
  if (view.kind === 'affine') {
    const order = getColumnOrder(dataSet, name);
    let resolved = view.count === 0;
    if (resolved) state.result = undefined;
    else if (order.finite && order.monotonic) {
      const start = dataSet.getValue(name, 0)!, stop = dataSet.getValue(name, view.count - 1)!;
      state.affineEndpointReads += 2; state.lastAffineEndpointReads = 2;
      // Numeric ordering treats +0 and -0 as equal. An interior signed zero may
      // still affect Math.min/max, so retain the run fallback for this rare tie.
      if (order.strict || (start !== 0 && stop !== 0) || view.count === 1) {
        state.result = {start: Math.min(start, stop), end: Math.max(start, stop)}; resolved = true;
      }
    }
    if (!resolved) {
      state.result = boundsFromRuns(view);
      state.lastAffineRunVisits = view.runs.length - view.runStart;
      state.affineRunVisits += state.lastAffineRunVisits;
    }
  } else if (first === end) {
    state.head = undefined; state.tail = undefined; state.result = undefined;
    state.minima.clear(); state.maxima.clear(); state.processedFullEnd = Math.floor(end / DATA_BOUNDS_BLOCK_SIZE);
  } else {
    const fullFirst = Math.ceil(first / DATA_BOUNDS_BLOCK_SIZE), fullEnd = Math.floor(end / DATA_BOUNDS_BLOCK_SIZE);
    const previousHead = state.head, previousTail = state.tail;
    state.minima.expire(fullFirst); state.maxima.expire(fullFirst);
    for (let block = Math.max(fullFirst, state.processedFullEnd); block < fullEnd; block++) {
      const start = block * DATA_BOUNDS_BLOCK_SIZE, stop = start + DATA_BOUNDS_BLOCK_SIZE;
      const summary = readStoredRange(view, start, stop, state, previousTail);
      state.minima.add(block, summary.min); state.maxima.add(block, summary.max);
      state.fullBlockBuilds++; state.lastFullBlockBuilds++;
    }
    state.processedFullEnd = fullEnd;
    state.head = first % DATA_BOUNDS_BLOCK_SIZE
      ? readStoredRange(view, first, Math.min(end, fullFirst * DATA_BOUNDS_BLOCK_SIZE), state,
        previousHead?.start === first ? previousHead : previousTail)
      : undefined;
    const tailStart = fullEnd * DATA_BOUNDS_BLOCK_SIZE;
    state.tail = end % DATA_BOUNDS_BLOCK_SIZE && tailStart >= first && (!state.head || tailStart >= state.head.end)
      ? readStoredRange(view, tailStart, end, state, previousTail?.start === tailStart ? previousTail : previousHead)
      : undefined;
    const min = Math.min(state.minima.value, state.head?.min ?? Infinity, state.tail?.min ?? Infinity);
    const max = Math.max(state.maxima.value, state.head?.max ?? -Infinity, state.tail?.max ?? -Infinity);
    state.result = min === Infinity ? undefined : {start: min, end: max};
  }
  state.epoch = epoch; state.revision = dataSet.revision; state.first = first; state.end = end; state.kind = view.kind;
  return state.result && {...state.result};
}

/** Does not compute bounds, read samples, or create a cache. Counts exclude JavaScript
 * object overhead and caller-held results; no byte estimate is presented as heap/RSS.
 */
export function getColumnBoundsStats(dataSet: DataSetXY, name: string): ColumnBoundsStats | undefined {
  const state = caches.get(dataSet)?.columns.get(name);
  if (!state) return undefined;
  return {scannedSamples: state.scannedSamples, lastScannedSamples: state.lastScannedSamples,
    fullBlockBuilds: state.fullBlockBuilds, lastFullBlockBuilds: state.lastFullBlockBuilds,
    affineRunVisits: state.affineRunVisits, lastAffineRunVisits: state.lastAffineRunVisits,
    affineEndpointReads: state.affineEndpointReads, lastAffineEndpointReads: state.lastAffineEndpointReads,
    cacheHits: state.cacheHits, rebuilds: state.rebuilds, updates: state.updates,
    fullBlocksInWindow: state.kind === 'dense' || state.kind === 'paged' ? Math.max(0, Math.floor(state.end / DATA_BOUNDS_BLOCK_SIZE) - Math.ceil(state.first / DATA_BOUNDS_BLOCK_SIZE)) : 0,
    cachedExtremaEntries: state.minima.size + state.maxima.size,
    retainedExtremaEntries: state.minima.storedSize + state.maxima.storedSize};
}
