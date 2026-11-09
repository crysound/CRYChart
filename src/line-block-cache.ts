import type {DrawPacket, Rect} from './contracts.js';
import type {DataColumnRuns} from './core/data.js';

/** Leaves room for endpoint, both block halos and renderer end padding within
 * one 32768-sample power-of-two allocation. Block indices need not be powers of two. */
export const DEFAULT_LINE_BLOCK_SEGMENTS = 32760;

/** Experimental block contract: the ChartXY integration is opt-in and off by default.
 * Blocks partition SEGMENTS, not samples. For B segments, an interior block
 * draws B+1 samples and stores two additional samples solely as miter halos.
 * Adjacent blocks share one drawn boundary sample and never share a segment.
 */
export interface LineBlockSource {
  /** Stable identity of the source DataSet; never retained after dispose(). */
  identity: object;
  /** Changes on clear/replacement/nonappend mutation, including clear+append
   * between two rendered frames. Revision jumps alone do not imply a reset. */
  contentEpoch: number;
  revision: number;
  firstSampleIndex: number;
  nextSampleIndex: number;
  /** Borrowed dense/affine views in source precision; no dense auto-X snapshot. */
  x: DataColumnRuns;
  y: DataColumnRuns;
}

export interface LineBlockRequest {
  source: LineBlockSource;
  /** Same logical stroke across independently cached geometry packets. */
  strokeGroup?: number;
  /** Coordinate mapping / axis transform identity. Logarithmic or unsupported
   * mappings return a fallback result until separately implemented and tested. */
  projectionKey: string;
  coordinateMode: 'linear' | 'unsupported';
  bindingRevision: number;
  styleRevision: number;
  /** Inclusive first, exclusive last requested segment-start indices. The host
   * derives these from the visible source X range, retaining edge neighbors. */
  visibleSegments: {first: number; end: number};
  domain: DrawPacket['domain'];
  clipRect?: Rect;
  style: Pick<DrawPacket, 'color' | 'thickness'>;
  /** Negative X values are valid. Reversing, duplicate or nonfinite source X
   * must be detected; it cannot be asserted away from a schema hint alone. */
  monotonicX: 'verified-strict' | 'unknown' | 'invalid';
}

export interface LineBlockSpan {
  blockIndex: number;
  nominalFirstSegment: number;
  /** Owned segment starts [firstSegment,endSegment). */
  firstSegment: number;
  endSegment: number;
  /** Real drawn samples [firstSegment,endSegment], inclusive at both ends. */
  firstDrawSample: number;
  lastDrawSample: number;
  /** Actual source halo indices; endpoints duplicate the first/last retained
   * sample only when a real neighbor no longer exists. */
  beforeSample: number;
  afterSample: number;
}

export interface LineBlockPacket extends DrawPacket {
  /** A private far-negative identity (starting below -2^40); -seriesId is
   * already used by other geometry and must not be reused for block packets. */
  id: number;
  /** Packet count includes only local storage, including both halos. Public
   * series/data-set sample counts always come from the complete source. */
  count: number;
  /** Intersect the visibility range with these drawn samples. Halos participate
   * in join calculation but are never separate segments or cursor samples. */
  drawFirst: number;
  drawCount: number;
  sourceFirstSample: number;
  firstOwnedSegment: number;
  endOwnedSegment: number;
  contentEpoch: number;
  blockIndex: number;
  clipRect?: Rect;
  /** Float64 origin with unchanged Float32 relative raster coordinates. Source
   * values, readback, cursor data and affine X expressions retain precision. */
  origin: DrawPacket['origin'];
  /** CPU reconstruction error, not a promise that raster bytes equal the old
   * whole-series Float32 origin. Smaller blocks may improve that precision. */
  precision: {maximumXError: number; maximumYError: number};
  /** Local position pairs changed this update. Compatibility uploaders may use
   * updateFrom, but that can include unchanged pairs between disjoint patches. */
  dirtySampleRanges: readonly {first: number; count: number}[];
}

export interface LineBlockCacheStats {
  residentBlocks: number;
  residentProjectionBytes: number;
  projectedSamplesThisUpdate: number;
  positionPairsWrittenThisUpdate: number;
  evictedBlocksThisUpdate: number;
  reusedBlocksThisUpdate: number;
  requestedSegments: number;
  sourceRetainedSamples: number;
  /** No source rows are discarded by this cache. */
  sourceReduction: false;
}

export type LineBlockResult =
  | {kind: 'blocks'; packets: readonly LineBlockPacket[]; stats: LineBlockCacheStats}
  | {kind: 'fallback'; reason: 'unverified-x-order' | 'unsupported-transform' | 'nonfinite-x' | 'nonincreasing-x' | 'relative-overflow' | 'resource-limit'; stats: LineBlockCacheStats};

export interface LineBlockCache {
  /** Update only touched tail blocks and changed endpoint halos. Advancing the
   * retained start clips old segments; it does not reproject the whole history.
   * Viewport changes retain only visible blocks plus adjacent halo information.
   * Binding/epoch/style changes publish packets atomically or request fallback. */
  update(request: LineBlockRequest): LineBlockResult;
  clear(): void;
  dispose(): void;
}

type FallbackReason = Extract<LineBlockResult, {kind: 'fallback'}>['reason'];
type ColumnReader = (absoluteIndex: number) => number;
interface BlockEntry {
  blockIndex: number;
  nominalFirst: number;
  origin: {x: number; y: number; z: number};
  storage: Float32Array;
  realNext: number;
  observedFirst: number;
  observedNext: number;
  strictProjectedX: boolean;
  maximumXError: number;
  maximumYError: number;
  packet: LineBlockPacket;
}
let nextBlockPacketId = -(2 ** 40);
let nextBlockStrokeGroup = -(2 ** 44);

/** Experimental CPU block cache. It owns derived Float32 coordinates only;
 * it never owns, trims, materializes, mutates, or disposes source columns.
 * The host must obtain verified-strict from a complete retained-column order
 * certificate (data-order.ts), not merely from the currently visible range.
 */
export class LineBlockCache {
  private readonly strokeGroup = nextBlockStrokeGroup--;
  private readonly blockSize: number;
  private readonly maximumBytes: number;
  private entries = new Map<number, BlockEntry>();
  private state?: {identity: object; epoch: number; projectionKey: string; binding: number; style: number; next: number};
  private revision = 0;
  private disposed = false;

  constructor(options: {segmentsPerBlock?: number; maximumProjectionBytes?: number} = {}) {
    this.blockSize = options.segmentsPerBlock ?? DEFAULT_LINE_BLOCK_SEGMENTS;
    this.maximumBytes = options.maximumProjectionBytes ?? Infinity;
    if (!Number.isSafeInteger(this.blockSize) || this.blockSize < 1 || this.blockSize > 1048576)
      throw new RangeError('Line block size must be a positive integer up to 1048576');
    if (!(this.maximumBytes >= 0) || (this.maximumBytes !== Infinity && !Number.isFinite(this.maximumBytes)))
      throw new RangeError('Line block projection budget must be nonnegative');
  }

  update(request: LineBlockRequest): LineBlockResult {
    if (this.disposed) throw new Error('Line block cache is disposed');
    const source = request.source, retained = source.nextSampleIndex - source.firstSampleIndex;
    if (![source.firstSampleIndex, source.nextSampleIndex, source.contentEpoch, source.revision].every(Number.isSafeInteger) || source.firstSampleIndex < 0 || retained < 0 ||
      source.x.firstIndex !== source.firstSampleIndex || source.y.firstIndex !== source.firstSampleIndex || source.x.count !== retained || source.y.count !== retained)
      throw new RangeError('Line block source ranges must describe the same retained rows');
    const stats: LineBlockCacheStats = {residentBlocks: 0, residentProjectionBytes: 0, projectedSamplesThisUpdate: 0, positionPairsWrittenThisUpdate: 0, evictedBlocksThisUpdate: 0, reusedBlocksThisUpdate: 0, requestedSegments: 0, sourceRetainedSamples: retained, sourceReduction: false};
    const fallback = (reason: FallbackReason): LineBlockResult => {stats.evictedBlocksThisUpdate += this.entries.size; this.clear(); return {kind: 'fallback', reason, stats};};
    if (request.coordinateMode !== 'linear') return fallback('unsupported-transform');
    if (retained >= 2 && request.monotonicX !== 'verified-strict') return fallback(request.monotonicX === 'invalid' ? 'nonincreasing-x' : 'unverified-x-order');
    const state = this.state;
    if (state && (state.identity !== source.identity || state.epoch !== source.contentEpoch || state.projectionKey !== request.projectionKey || state.binding !== request.bindingRevision || state.style !== request.styleRevision || source.nextSampleIndex < state.next || source.firstSampleIndex >= state.next)) {
      stats.evictedBlocksThisUpdate += this.entries.size; this.entries.clear();
    }
    const spans = planLineBlockSpans(source.firstSampleIndex, source.nextSampleIndex, request.visibleSegments, this.blockSize);
    const bytesPerBlock = (this.blockSize + 3) * 2 * Float32Array.BYTES_PER_ELEMENT;
    if (spans.length * bytesPerBlock > this.maximumBytes) return fallback('resource-limit');
    stats.requestedSegments = spans.reduce((sum, span) => sum + span.endSegment - span.firstSegment, 0);
    const wanted = new Set(spans.map(span => span.blockIndex));
    const x = columnReader(source.x), y = columnReader(source.y), packets: LineBlockPacket[] = [];
    for (const span of spans) {
      let entry = this.entries.get(span.blockIndex);
      const fresh = !entry;
      if (!entry) {
        const anchor = Math.max(span.nominalFirstSegment, source.firstSampleIndex);
        const originX = x(anchor);
        if (!Number.isFinite(originX)) return fallback('nonfinite-x');
        let originY = 0;
        for (let index = anchor; index <= Math.min(span.nominalFirstSegment + this.blockSize, source.nextSampleIndex - 1); index++) {
          const value = y(index); if (Number.isFinite(value)) {originY = value; break;}
        }
        const id = nextBlockPacketId--;
        if (!Number.isSafeInteger(id)) throw new RangeError('Line block packet identity exhausted');
        const origin = {x: originX, y: originY, z: 0}, storage = new Float32Array((this.blockSize + 3) * 2);
        entry = {
          blockIndex: span.blockIndex, nominalFirst: span.nominalFirstSegment, origin, storage,
          realNext: Math.max(span.nominalFirstSegment - 1, source.firstSampleIndex), observedFirst: source.firstSampleIndex, observedNext: source.nextSampleIndex,
          strictProjectedX: true, maximumXError: 0, maximumYError: 0,
          packet: {id, revision: 0, positions: storage.subarray(0, 0), count: 0, dimensions: 2, mode: 'line', color: [...request.style.color], thickness: request.style.thickness, pointSize: 0, origin, domain: request.domain, monotonicX: true, strictlyMonotonicX: true,
            drawFirst: 0, drawCount: 0, sourceFirstSample: span.nominalFirstSegment - 1, firstOwnedSegment: span.firstSegment, endOwnedSegment: span.endSegment,
            contentEpoch: source.contentEpoch, blockIndex: span.blockIndex, precision: {maximumXError: 0, maximumYError: 0}, dirtySampleRanges: []},
        };
      }
      const dirty: {first: number; count: number}[] = [];
      const base = entry.nominalFirst - 1;
      const realEnd = Math.min(entry.nominalFirst + this.blockSize + 2, source.nextSampleIndex);
      const from = Math.max(entry.realNext, source.firstSampleIndex);
      if (from < realEnd) {
        const failure = projectBlockRange(entry, source, x, y, from, realEnd, stats);
        if (failure) return fallback(failure);
        dirty.push({first: from - base, count: realEnd - from}); entry.realNext = realEnd;
      }
      // Fill unavailable prefix only when constructing a partial retained block.
      // Subsequent retention advances patch the immediate cap neighbor alone.
      if (fresh && source.firstSampleIndex > base) {
        const localFirst = source.firstSampleIndex - base;
        for (let index = 0; index < localFirst; index++) {entry.storage[index * 2] = entry.storage[localFirst * 2]!; entry.storage[index * 2 + 1] = entry.storage[localFirst * 2 + 1]!; stats.positionPairsWrittenThisUpdate++;}
        if (localFirst) dirty.push({first: 0, count: localFirst});
      } else if (entry.observedFirst !== source.firstSampleIndex && source.firstSampleIndex > base && source.firstSampleIndex <= entry.nominalFirst + this.blockSize) {
        const localFirst = source.firstSampleIndex - base;
        entry.storage[(localFirst - 1) * 2] = entry.storage[localFirst * 2]!;
        entry.storage[(localFirst - 1) * 2 + 1] = entry.storage[localFirst * 2 + 1]!;
        dirty.push({first: localFirst - 1, count: 1}); stats.positionPairsWrittenThisUpdate++;
      }
      const lastCore = Math.min(entry.nominalFirst + this.blockSize, source.nextSampleIndex - 1);
      const count = lastCore - entry.nominalFirst + 3;
      if ((fresh || entry.observedNext !== source.nextSampleIndex) && lastCore + 1 >= source.nextSampleIndex) {
        entry.storage[(count - 1) * 2] = entry.storage[(count - 2) * 2]!;
        entry.storage[(count - 1) * 2 + 1] = entry.storage[(count - 2) * 2 + 1]!;
        dirty.push({first: count - 1, count: 1}); stats.positionPairsWrittenThisUpdate++;
      }
      const packet = entry.packet;
      if (dirty.length) {
        packet.previousRevision = fresh ? undefined : packet.revision;
        packet.revision = ++this.revision;
        packet.updateFrom = fresh ? undefined : Math.min(...dirty.map(range => range.first));
      } else {packet.previousRevision = undefined; packet.updateFrom = undefined; stats.reusedBlocksThisUpdate++;}
      packet.dirtySampleRanges = dirty;
      if (packet.count !== count) packet.positions = entry.storage.subarray(0, count * 2);
      packet.count = count; packet.drawFirst = span.firstSegment - base; packet.drawCount = span.endSegment - span.firstSegment + 1;
      packet.firstOwnedSegment = span.firstSegment; packet.endOwnedSegment = span.endSegment;
      packet.domain = request.domain; packet.clipRect = request.clipRect; packet.color = [...request.style.color]; packet.thickness = request.style.thickness;
      packet.strokeGroup = request.strokeGroup ?? this.strokeGroup;
      packet.monotonicX = true; packet.strictlyMonotonicX = entry.strictProjectedX;
      packet.precision = {maximumXError: entry.maximumXError, maximumYError: entry.maximumYError};
      entry.observedFirst = source.firstSampleIndex; entry.observedNext = source.nextSampleIndex;
      this.entries.set(span.blockIndex, entry); packets.push(packet);
    }
    for (const blockIndex of this.entries.keys()) if (!wanted.has(blockIndex)) {this.entries.delete(blockIndex); stats.evictedBlocksThisUpdate++;}
    stats.residentBlocks = this.entries.size; stats.residentProjectionBytes = this.entries.size * bytesPerBlock;
    this.state = {identity: source.identity, epoch: source.contentEpoch, projectionKey: request.projectionKey, binding: request.bindingRevision, style: request.styleRevision, next: source.nextSampleIndex};
    return {kind: 'blocks', packets, stats};
  }

  clear(): void {this.entries.clear(); this.state = undefined;}
  dispose(): void {if (this.disposed) return; this.clear(); this.disposed = true;}
}

/** Keep the exact per-batch affine expression. The common automatic-X/dense-Y
 * path resolves run and ring boundaries once per contiguous chunk, not per row.
 * Error maxima and counters stay local until the chunk operation completes. */
function projectBlockRange(entry: BlockEntry, source: LineBlockSource, x: ColumnReader, y: ColumnReader,
  from: number, end: number, stats: LineBlockCacheStats): FallbackReason | undefined {
  const storage = entry.storage, originX = entry.origin.x, originY = entry.origin.y;
  const base = entry.nominalFirst - 1, first = source.firstSampleIndex;
  let previousX = from > first ? x(from - 1) : -Infinity;
  let previousRelativeX = Math.fround(previousX - originX);
  let strict = entry.strictProjectedX, maximumXError = entry.maximumXError, maximumYError = entry.maximumYError, written = 0;
  const finish = (failure?: FallbackReason) => {
    entry.strictProjectedX = strict; entry.maximumXError = maximumXError; entry.maximumYError = maximumYError;
    stats.projectedSamplesThisUpdate += written; stats.positionPairsWrittenThisUpdate += written;
    return failure;
  };
  if (source.x.kind === 'affine' && source.y.kind === 'dense') {
    const runs = source.x.runs, slices = source.y.slices, firstSliceEnd = first + (slices[0]?.length ?? 0);
    let low = source.x.runStart, high = runs.length;
    while (low < high) {const middle = low + Math.floor((high - low) / 2), run = runs[middle]!; if (run.firstIndex + run.count <= from) low = middle + 1; else high = middle;}
    let runIndex = low, absolute = from;
    while (absolute < end) {
      const run = runs[runIndex];
      if (!run || run.firstIndex > absolute) return finish('nonfinite-x');
      const firstSlice = absolute < firstSliceEnd, values = slices[firstSlice ? 0 : 1];
      const sliceBase = firstSlice ? first : firstSliceEnd;
      const chunkEnd = Math.min(end, run.firstIndex + run.count, firstSlice ? firstSliceEnd : source.nextSampleIndex);
      if (chunkEnd <= absolute) return finish('nonfinite-x');
      const runStart = run.start, runFirst = run.firstIndex, step = run.step;
      for (; absolute < chunkEnd; absolute++) {
        const valueX = runStart + (absolute - runFirst) * step, valueY = values?.[absolute - sliceBase] ?? NaN;
        if (!Number.isFinite(valueX)) return finish('nonfinite-x');
        if (absolute > first && !(valueX > previousX)) return finish('nonincreasing-x');
        const finiteY = Number.isFinite(valueY), relativeX = Math.fround(valueX - originX), relativeY = finiteY ? Math.fround(valueY - originY) : NaN;
        if (!Number.isFinite(relativeX) || (finiteY && !Number.isFinite(relativeY))) return finish('relative-overflow');
        if (absolute > first && !(relativeX > previousRelativeX)) strict = false;
        const offset = (absolute - base) * 2; storage[offset] = relativeX; storage[offset + 1] = relativeY;
        maximumXError = Math.max(maximumXError, Math.abs(originX + relativeX - valueX));
        if (finiteY) maximumYError = Math.max(maximumYError, Math.abs(originY + relativeY - valueY));
        previousX = valueX; previousRelativeX = relativeX; written++;
      }
      if (absolute >= run.firstIndex + run.count) runIndex++;
    }
  } else {
    for (let absolute = from; absolute < end; absolute++) {
      const valueX = x(absolute), valueY = y(absolute);
      if (!Number.isFinite(valueX)) return finish('nonfinite-x');
      if (absolute > first && !(valueX > previousX)) return finish('nonincreasing-x');
      const finiteY = Number.isFinite(valueY), relativeX = Math.fround(valueX - originX), relativeY = finiteY ? Math.fround(valueY - originY) : NaN;
      if (!Number.isFinite(relativeX) || (finiteY && !Number.isFinite(relativeY))) return finish('relative-overflow');
      if (absolute > first && !(relativeX > previousRelativeX)) strict = false;
      const offset = (absolute - base) * 2; storage[offset] = relativeX; storage[offset + 1] = relativeY;
      maximumXError = Math.max(maximumXError, Math.abs(originX + relativeX - valueX));
      if (finiteY) maximumYError = Math.max(maximumYError, Math.abs(originY + relativeY - valueY));
      previousX = valueX; previousRelativeX = relativeX; written++;
    }
  }
  return finish();
}

function columnReader(column: DataColumnRuns): ColumnReader {
  if (column.kind === 'paged') {
    let pageIndex = NaN, values: ReturnType<typeof column.getPage>;
    return index => {if (index < column.firstIndex || index >= column.firstIndex + column.count) return NaN; const next = Math.floor(index / column.pageSize); if (next !== pageIndex) {values = column.getPage(next); pageIndex = next;} return values?.[index - next * column.pageSize] ?? NaN;};
  }
  if (column.kind === 'dense') {
    const first = column.slices[0], second = column.slices[1], firstCount = first?.length ?? 0;
    if (column.slices.length > 2) throw new RangeError('Dense source must expose at most two ring slices');
    return index => {
      const offset = index - column.firstIndex;
      if (offset < 0 || offset >= column.count) return NaN;
      return (offset < firstCount ? first?.[offset] : second?.[offset - firstCount]) ?? NaN;
    };
  }
  let current = column.runStart;
  return index => {
    if (index < column.firstIndex || index >= column.firstIndex + column.count) return NaN;
    let run = column.runs[current];
    if (!run || index < run.firstIndex || index >= run.firstIndex + run.count) {
      if (run && index >= run.firstIndex + run.count) {
        while (current + 1 < column.runs.length && index >= column.runs[current]!.firstIndex + column.runs[current]!.count) current++;
      } else {
        let low = column.runStart, high = column.runs.length;
        while (low < high) {const middle = (low + high) >>> 1, value = column.runs[middle]!; if (value.firstIndex + value.count <= index) low = middle + 1; else high = middle;}
        current = low;
      }
      run = column.runs[current];
    }
    return run ? run.start + (index - run.firstIndex) * run.step : NaN;
  };
}

/** Pure range planner for the proposed geometry contract, not a renderer. */
export function planLineBlockSpans(firstSample: number, nextSample: number, visibleSegments: {first: number; end: number}, segmentsPerBlock = DEFAULT_LINE_BLOCK_SEGMENTS): LineBlockSpan[] {
  if (![firstSample, nextSample, visibleSegments.first, visibleSegments.end, segmentsPerBlock].every(Number.isSafeInteger) || firstSample < 0 || nextSample < firstSample || segmentsPerBlock < 1)
    throw new RangeError('Line block ranges must be safe, nonnegative source indices');
  const first = Math.max(firstSample, visibleSegments.first), end = Math.min(nextSample - 1, visibleSegments.end);
  if (end <= first) return [];
  const result: LineBlockSpan[] = [];
  for (let blockIndex = Math.floor(first / segmentsPerBlock); blockIndex <= Math.floor((end - 1) / segmentsPerBlock); blockIndex++) {
    const nominalFirstSegment = blockIndex * segmentsPerBlock;
    const firstSegment = Math.max(first, nominalFirstSegment), endSegment = Math.min(end, nominalFirstSegment + segmentsPerBlock);
    result.push({blockIndex, nominalFirstSegment, firstSegment, endSegment, firstDrawSample: firstSegment, lastDrawSample: endSegment, beforeSample: Math.max(firstSample, firstSegment - 1), afterSample: Math.min(nextSample - 1, endSegment + 1)});
  }
  return result;
}
