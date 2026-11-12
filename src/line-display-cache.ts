import {acceptsExtremaPair,type ExtremaPairProof} from './line-extrema-pair-proof.js';
import {LineSelectionLedger, ownLedgerPage, A, type LedgerPage, type LedgerWork, type LedgerPolicy} from './line-selection-ledger.js';
import type {DrawPacket, Rect} from './contracts.js';
import type {DataColumnRuns} from './core/data.js';
import type {LineBlockRequest} from './line-block-cache.js';
import {DisplayPagePacketCache, type PagePacketStats} from './line-display-packets.js';
import {LineDisplayArena, type LineArenaStats} from './line-display-arena.js';

/** Experimental display simplification only. All source rows remain owned by
 * the DataSet. This is not a replacement for raw readback, bounds or cursors. */
export interface LineDisplayRequest extends LineBlockRequest {
  plotRect: Rect;
  devicePixelRatio: number;
  /** Maximum physical-pixel X extent of one simplified finite run. This is a
   * horizontal centerline bound, not a promise of identical antialias bytes. */
  maximumPixelSpan?: number;
  collectAudit?: boolean;
  /** Capsule-coverage-only packaging experiment. It does not change selection.
   * Source indices are flattened only when collectAudit is explicitly true. */
  packetMode?: 'flat' | 'pages' | 'arena';
  /** Explicit capsule-coverage experiment. Defaults to preserving the original
   * neighbors of sharp extrema for compatibility with miter geometry. */
  preserveExtremaNeighbors?: boolean;
  /** Explicit local capsule experiment. Both adjacent original points must
   * lie within this conservative physical-pixel radius before omission. */
  extremaNeighborDistancePixels?: number;
  /** Exact-byte candidate: reuse accepted, unchanged terminal groups when an
   * appended tail causes its containing page to be selected again. */
  reuseUnchangedGroups?: boolean;
  /** Internal-render candidate: omit the flattened audit-only source-index
   * vector. Page selection indices and all original DataSet values remain.
   * collectAudit:true always materializes this vector for verification. */
  collectSourceIndices?: boolean;
  /** Independent producer-certified selection experiment; default false. */
  reuseCertifiedPages?: boolean;
  /** Independent finite dense waveform candidate; issued proof expires on mutation. */
  extremaPairProof?: ExtremaPairProof;
}
export interface LineDisplayAudit {
  first: number;
  last: number;
  minimum: number;
  maximum: number;
  pixelSpan: number;
  finite: boolean;
}
export interface LineDisplayStats {
  retainedSourceSamples: number;
  displaySelectionPolicy?: string;
  extremaPairAdmission?: string;
  requestedSourceSamples: number;
  selectedDisplaySamples: number;
  submittedDisplaySamples: number;
  omittedDisplaySamples: number;
  summaryPages: number;
  summaryBytes: number;
  selectionBytes: number;
  projectionBytes: number;
  cachedSelectionBytes: number;
  cachedProjectionBytes: number;
  cachedTopologyBytes: number;
  reusedSelectionPages: number;
  sourceSamplesScannedThisUpdate: number;
  boundarySamplesScannedThisUpdate: number;
  visitedSummaryNodes: number;
  reusedPages: number;
  evictedPages: number;
  largestSimplifiedPixelSpan: number;
  maximumProjectionXError: number;
  maximumProjectionYError: number;
  sourceReduction: false;
  displayReduction: boolean;
  pagePackets?: PagePacketStats;
  arena?: LineArenaStats;
  extremaNeighborsRetained: boolean;
  extremaNeighborDistancePixels?: number;
  reusedTerminalGroups: number;
  reusedProjectionSamplesThisUpdate: number;
  projectedSamplesThisUpdate: number;
  projectionRebasesThisUpdate: number;
  selectionDelta?: LedgerWork;
}
export type LineDisplayResult =
  | {kind: 'display'; packet?: DrawPacket; packets?: readonly DrawPacket[]; sourceIndices: Float64Array; sourceIndicesIncluded?: boolean; stats: LineDisplayStats; audit?: readonly LineDisplayAudit[]}
  | {kind: 'fallback'; reason: 'unverified-x-order' | 'unsupported-transform' | 'invalid-viewport' | 'resource-limit' | 'relative-overflow'; stats: LineDisplayStats};

type Reader = (index: number) => number;
// Five integers per terminal tree node: node id, page-local begin/end and the
// selected-array begin/end. Whole interior groups can be copied; only a clipped
// boundary group is queried again when a viewport or retained prefix advances.
const GROUP_STRIDE = 5;
type SelectedPage = {first: number; end: number; scale: number; maximumSpan: number; directionRatio: number; neighborFirst: number; neighborNext: number; builtNext: number; indices: Float64Array; positions: Float32Array; groups: Int32Array; groupLookup?: Uint16Array;
  strict: boolean; maximumXError: number; maximumYError: number; largestSpan: number; extremaNeighborsRetained: boolean; neighborDistance?: number; neighborScaleX: number; neighborScaleY: number; audit?: readonly LineDisplayAudit[]};
type Page = {base: number; builtNext: number; states: Uint8Array; minimum: Uint16Array; maximum: Uint16Array; selected?: SelectedPage};

/** Small dense-only loop, outside update's selection/ledger closures. All reads
 * are from the current borrowed span. Scalar locals preserve earliest ties and
 * finite/gap classification; the original page is written only after scanning.
 * No scratch objects, source copies or borrowed views survive this call. */
function scanDenseLeaf(page: Page, node: number, values: ArrayLike<number>, spanFirst: number, begin: number, end: number): void {
  const first = begin - spanFirst, last = end - spanFirst;
  let min = first, max = first, minValue = Infinity, maxValue = -Infinity, finite = 0;
  for (let index = first; index < last; index++) {
    const value = values[index]!;
    if (Number.isFinite(value)) {
      finite++;
      if (value < minValue) {minValue = value; min = index;}
      if (value > maxValue) {maxValue = value; max = index;}
    }
  }
  const offset = spanFirst - page.base;
  page.states[node] = finite === 0 ? 2 : finite === last - first ? 1 : 3;
  page.minimum[node] = min + offset; page.maximum[node] = max + offset;
}

/** Build a page contained in one current dense span without per-leaf dispatch
 * or reader callbacks during its ancestor merges. Only the current borrowed
 * values and existing compact index/state arrays are used; no value cache or
 * persistent view is introduced. Seam pages keep the general reader path. */
function buildDensePage(page: Page, values: ArrayLike<number>, spanFirst: number, retainedFirst: number, end: number, firstLeaf: number, lastLeaf: number, leaves: number, leafSize: number): number {
  const states = page.states, minimum = page.minimum, maximum = page.maximum;
  const offset = page.base - spanFirst;
  let scanned = 0;
  for (let leaf = firstLeaf; leaf <= lastLeaf; leaf++) {
    const first = Math.max(retainedFirst - page.base, leaf * leafSize), last = Math.min(end - page.base, (leaf + 1) * leafSize);
    let min = first, max = first, minValue = Infinity, maxValue = -Infinity, finite = 0;
    for (let index = first; index < last; index++) {
      const value = values[offset + index]!;
      if (Number.isFinite(value)) {
        finite++;
        if (value < minValue) {minValue = value; min = index;}
        if (value > maxValue) {maxValue = value; max = index;}
      }
    }
    const node = leaves + leaf;
    states[node] = finite === 0 ? 2 : finite === last - first ? 1 : 3;
    minimum[node] = min; maximum[node] = max;
    scanned += last - first;
  }
  let beginNode = leaves + firstLeaf, endNode = leaves + lastLeaf;
  while (beginNode > 1) {
    beginNode = Math.floor(beginNode / 2); endNode = Math.floor(endNode / 2);
    for (let node = beginNode; node <= endNode; node++) {
      const left = node * 2, right = left + 1, a = states[left]!, b = states[right]!;
      if (!a || !b) {
        const other = a ? left : right;
        states[node] = states[other]!; minimum[node] = minimum[other]!; maximum[node] = maximum[other]!;
      } else {
        states[node] = a === b && a !== 3 ? a : 3;
        if (a === 2) {minimum[node] = minimum[right]!; maximum[node] = maximum[right]!;}
        else if (b === 2) {minimum[node] = minimum[left]!; maximum[node] = maximum[left]!;}
        else {
          // Out-of-retention entries read undefined here, which has the same
          // comparison result as the general reader's NaN. Queries still clip
          // expired prefixes before consulting a complete summary node.
          const minLeft = minimum[left]!, minRight = minimum[right]!, maxLeft = maximum[left]!, maxRight = maximum[right]!;
          minimum[node] = values[offset + minLeft]! <= values[offset + minRight]! ? minLeft : minRight;
          maximum[node] = values[offset + maxLeft]! >= values[offset + maxRight]! ? maxLeft : maxRight;
        }
      }
    }
  }
  return scanned;
}
type State = {identity: object; epoch: number; binding: number; projection: string; next: number};
let nextDisplayId = -(2 ** 42);

/** Fixed absolute-index pages contain a compact min/max tree. Tail appends only
 * rebuild touched leaves and their ancestors. Moving the retained start only
 * clips queries; expired values are never read from old tree nodes. Each finite
 * accepted node emits its first/minimum/maximum/last source indices in source
 * order. Mixed finite/nonfinite nodes descend; every gap remains disconnected.
 *
 * For a finite accepted node, both the original and selected polylines are
 * continuous and attain the same minimum and maximum Y inside an X slab no
 * wider than maximumPixelSpan. Their centerline Hausdorff distance is therefore
 * bounded horizontally by that span, before Float32 projection. This statement
 * does not imply equal raster coverage, opacity accumulation or join geometry.
 * Dense bounded opaque solid streams may use this display view when admitted
 * by the host's rendering policy. All original source values remain available;
 * the view does not promise byte-identical antialiasing or join coverage.
 */
export class LineDisplayCache {
  private readonly pageSize: number;
  private readonly leafSize: number;
  private readonly leaves: number;
  private readonly pageBytes: number;
  private readonly maximumSummaryBytes: number;
  private readonly maximumDisplaySamples: number;
  private pages = new Map<number, Page>();
  private state?: State;
  private origin?: DrawPacket['origin'];
  private indices = new Float64Array(0);
  private positions = new Float32Array(0);
  private outputCount = 0;
  private revision = 0;
  private id = nextDisplayId--;
  private disposed = false;
  private pagePackets?: DisplayPagePacketCache;
  private arena?: LineDisplayArena;
  private deltaLedger?: LineSelectionLedger;

  constructor(options: {pageSize?: number; leafSize?: number; maximumSummaryBytes?: number; maximumDisplaySamples?: number} = {}) {
    this.pageSize = options.pageSize ?? 4096;
    this.leafSize = options.leafSize ?? 16;
    if (!isPowerOfTwo(this.pageSize) || this.pageSize > 32768 || !isPowerOfTwo(this.leafSize) || this.leafSize > this.pageSize)
      throw new RangeError('Display tree page/leaf sizes must be powers of two with leaf <= page <= 32768');
    this.leaves = this.pageSize / this.leafSize;
    this.pageBytes = this.leaves * 2 * (Uint8Array.BYTES_PER_ELEMENT + Uint16Array.BYTES_PER_ELEMENT * 2);
    this.maximumSummaryBytes = options.maximumSummaryBytes ?? 8 * 1024 * 1024;
    this.maximumDisplaySamples = options.maximumDisplaySamples ?? 1048576;
    if (!(this.maximumSummaryBytes >= 0) || !Number.isSafeInteger(this.maximumDisplaySamples) || this.maximumDisplaySamples < 2)
      throw new RangeError('Display cache budgets must be nonnegative bytes and at least two samples');
  }

  update(request: LineDisplayRequest): LineDisplayResult {
    return this.updateProjection(request, true);
  }

  private updateProjection(request: LineDisplayRequest, allowRebase: boolean): LineDisplayResult {
    if (this.disposed) throw new Error('Line display cache is disposed');
    const source = request.source, retained = source.nextSampleIndex - source.firstSampleIndex;
    const extremaPair = acceptsExtremaPair(request.extremaPairProof,source);
    const selectionPolicyKey = request.projectionKey + (extremaPair ? ':extrema-pair-v1' : ':original-v4');
    if (![source.firstSampleIndex, source.nextSampleIndex, source.contentEpoch, source.revision, request.visibleSegments.first, request.visibleSegments.end].every(Number.isSafeInteger) ||
      source.firstSampleIndex < 0 || retained < 0 || source.x.firstIndex !== source.firstSampleIndex || source.y.firstIndex !== source.firstSampleIndex || source.x.count !== retained || source.y.count !== retained)
      throw new RangeError('Display source must expose matching retained columns and safe source indices');
    const stats: LineDisplayStats = {retainedSourceSamples: retained, requestedSourceSamples: 0, selectedDisplaySamples: 0, submittedDisplaySamples: 0, omittedDisplaySamples: 0,
      summaryPages: 0, summaryBytes: 0, selectionBytes: 0, projectionBytes: 0, cachedSelectionBytes: 0, cachedProjectionBytes: 0, cachedTopologyBytes: 0, reusedSelectionPages: 0, sourceSamplesScannedThisUpdate: 0, boundarySamplesScannedThisUpdate: 0,
      visitedSummaryNodes: 0, reusedPages: 0, evictedPages: 0, largestSimplifiedPixelSpan: 0, maximumProjectionXError: 0, maximumProjectionYError: 0, sourceReduction: false, displayReduction: false, extremaNeighborsRetained: request.preserveExtremaNeighbors !== false,
      reusedTerminalGroups: 0, reusedProjectionSamplesThisUpdate: 0, projectedSamplesThisUpdate: 0, projectionRebasesThisUpdate: 0};
    const fallback = (reason: Extract<LineDisplayResult, {kind: 'fallback'}>['reason']): LineDisplayResult => {stats.evictedPages += this.pages.size; this.clear(); return {kind: 'fallback', reason, stats};};
    if (request.coordinateMode !== 'linear') return fallback('unsupported-transform');
    if (retained > 1 && request.monotonicX !== 'verified-strict') return fallback('unverified-x-order');
    const extent = Math.abs(request.domain.x.end - request.domain.x.start), maximumSpan = request.maximumPixelSpan ?? 1;
    const scale = request.plotRect.width * request.devicePixelRatio / extent;
    if (!(extent > 0) || !Number.isFinite(scale) || scale <= 0 || !Number.isFinite(maximumSpan) || maximumSpan <= 0 || maximumSpan > 4)
      return fallback('invalid-viewport');
    const yScale = Math.abs(request.plotRect.height * request.devicePixelRatio / (request.domain.y.end - request.domain.y.start));
    if (!Number.isFinite(yScale) || yScale <= 0) return fallback('invalid-viewport');
    const neighborDistance = request.extremaNeighborDistancePixels;
    if (neighborDistance !== undefined && (!Number.isFinite(neighborDistance) || neighborDistance <= 0 || neighborDistance > .125))
      throw new RangeError('Experimental neighbor distance must be positive and at most 0.125 physical pixels');
    stats.extremaNeighborDistancePixels = neighborDistance;
    stats.displaySelectionPolicy=extremaPair?'extrema-pair-page-edges':'original-v4';
    stats.extremaPairAdmission=request.extremaPairProof?.reason??'not-requested';
    if(extremaPair)stats.extremaNeighborsRetained=false;
    // Upper-bound the real screen scales. Their stable power-of-two classes
    // keep cached omissions valid across small affine-window rounding noise.
    const neighborScaleX = neighborDistance === undefined ? 0 : 2 ** Math.ceil(Math.log2(scale));
    const neighborScaleY = neighborDistance === undefined ? 0 : 2 ** Math.ceil(Math.log2(yScale));
    // This conservative power-of-two class is only a selection criterion, not
    // a coordinate quantization. Up to 2x the true Y/X ratio retains extra sharp
    // turns and avoids invalidating all pages for affine-window rounding noise.
    const directionRatio = 2 ** Math.ceil(Math.log2(yScale / scale));
    const old = this.state;
    if (old && (old.identity !== source.identity || old.epoch !== source.contentEpoch || old.binding !== request.bindingRevision || old.projection !== selectionPolicyKey || source.nextSampleIndex < old.next || source.firstSampleIndex >= old.next)) this.clear();
    const first = Math.max(source.firstSampleIndex, request.visibleSegments.first), last = Math.min(source.nextSampleIndex - 1, request.visibleSegments.end);
    const audit: LineDisplayAudit[] | undefined = request.collectAudit ? [] : undefined;
    this.outputCount = 0;
    if (last <= first) {this.pages.clear(); this.pagePackets?.clear(); this.arena?.clear(); this.deltaLedger?.clear(); return {kind: 'display', sourceIndices: this.indices.subarray(0, 0), stats, audit};}
    stats.requestedSourceSamples = last - first + 1;
    const firstPage = Math.floor(first / this.pageSize), lastPage = Math.floor(last / this.pageSize), wantedCount = lastPage - firstPage + 1;
    if (wantedCount * this.pageBytes > this.maximumSummaryBytes) return fallback('resource-limit');
    const deltaEnabled = request.reuseCertifiedPages === true && request.packetMode === 'arena' && request.collectAudit !== true;
    const deltaPolicy = (): LedgerPolicy => ({identity: source.identity, binding: request.bindingRevision, projection: selectionPolicyKey,
      preserveNeighbors: stats.extremaNeighborsRetained, reuseGroups: request.reuseUnchangedGroups === true,
      numbers: [scale, maximumSpan, directionRatio, neighborDistance, neighborScaleX, neighborScaleY, this.origin?.x, this.origin?.y, this.origin?.z]});
    if (deltaEnabled) this.deltaLedger ??= new LineSelectionLedger(this.pageSize);
    const deltaPlan = deltaEnabled && this.origin ? this.deltaLedger!.prepare(source, deltaPolicy(), first, last + 1) : undefined;
    if (deltaPlan) {
      for (let key = deltaPlan.previousFirstPage; key < Math.min(firstPage, deltaPlan.previousEndPage); key++) if (this.pages.delete(key)) stats.evictedPages++;
      for (let key = Math.max(lastPage + 1, deltaPlan.previousFirstPage); key < deltaPlan.previousEndPage; key++) if (this.pages.delete(key)) stats.evictedPages++;
    } else {
      this.arena?.materializeLedgerEntries(); this.deltaLedger?.clear();
      for (const key of this.pages.keys()) if (key < firstPage || key > lastPage) {this.pages.delete(key); stats.evictedPages++;}
    }
    const ownedPages: LedgerPage[] = [];
    let deltaOutputOffset = -1;
    const x = reader(source.x), y = reader(source.y);
    // Borrow only for this synchronous update. Most summary leaves fit wholly
    // inside one dense ring span; avoid a reader closure call for every value.
    // A leaf crossing the ring seam and all other storage keep the exact reader.
    const denseY = source.y.kind === 'dense' ? source.y : undefined;
    const denseA = denseY?.slices[0], denseB = denseY?.slices[1];
    const denseFirst = source.firstSampleIndex, denseSplit = denseFirst + (denseA?.length ?? 0);
    const denseComplete = !!denseY && !!denseA && (denseA.length + (denseB?.length ?? 0) === denseY.count);
    if (!this.origin) {const firstY = y(first); this.origin = {x: x(first), y: Number.isFinite(firstY) ? firstY : 0, z: 0};}
    const origin = this.origin;
    const arenaMode = request.packetMode === 'arena', pageMode = request.packetMode === 'pages' || arenaMode;
    const includeIndices = request.collectAudit === true || (!pageMode && request.collectSourceIndices !== false);
    if (!includeIndices && this.indices.length) this.indices = new Float64Array(0);
    if (pageMode) {
      if (arenaMode) {this.arena ??= new LineDisplayArena(this.maximumDisplaySamples); this.pagePackets?.clear();}
      else {this.pagePackets ??= new DisplayPagePacketCache(); this.arena?.clear();}
      if (this.positions.length) this.positions = new Float32Array(0);
    } else {this.pagePackets?.clear(); this.arena?.clear();}
    const chunks: {offset: number; selected: SelectedPage; first: number; end: number; key: string}[] = [];
    let resourceLimit = false;
    const ensureIndices = (count: number) => {
      if (count > this.maximumDisplaySamples) {resourceLimit = true; return false;}
      if (!includeIndices) return true;
      if (count > this.indices.length) {let capacity = Math.max(64, this.indices.length); while (capacity < count) capacity *= 2; const next = new Float64Array(Math.min(this.maximumDisplaySamples, capacity)); next.set(this.indices); this.indices = next;}
      return true;
    };
    let selection: number[] | undefined, selectionAudit: LineDisplayAudit[] | undefined;
    const emit = (index: number) => {
      if (selection) {if (!selection.length || selection[selection.length - 1]! < index) selection.push(index); return;}
      if (includeIndices && this.outputCount && this.indices[this.outputCount - 1]! >= index) return;
      if (this.outputCount >= this.maximumDisplaySamples) {resourceLimit = true; return;}
      if (!ensureIndices(this.outputCount + 1)) return;
      if (includeIndices) this.indices[this.outputCount] = index;
      this.outputCount++;
    };
    // The halo is an original source neighbor and is never a submitted segment.
    const hasBefore = first > source.firstSampleIndex, hasAfter = last + 1 < source.nextSampleIndex;
    if (hasBefore) emit(first - 1);
    let currentPageLargestSpan = 0, pageLargestSpan = 0;
    const preserveTurn = (center: number) => {
      if (!stats.extremaNeighborsRetained) return false;
      if (center <= source.firstSampleIndex || center + 1 >= source.nextSampleIndex) return false;
      const currentY = y(center), beforeY = y(center - 1), afterY = y(center + 1);
      if (!Number.isFinite(currentY) || !Number.isFinite(beforeY) || !Number.isFinite(afterY)) return true;
      const dyA = currentY - beforeY, dyB = afterY - currentY;
      if (dyA * dyB > 0) return false;
      const currentX = x(center), dxA = currentX - x(center - 1), dxB = x(center + 1) - currentX;
      if (neighborDistance !== undefined) {
        const ax = dxA * neighborScaleX, ay = dyA * neighborScaleY, bx = dxB * neighborScaleX, by = dyB * neighborScaleY, squaredLimit = neighborDistance * neighborDistance;
        if (ax * ax + ay * ay <= squaredLimit && bx * bx + by * by <= squaredLimit) return false;
      }
      const ay = dyA * directionRatio, by = dyB * directionRatio;
      const lengthProduct = Math.sqrt((dxA * dxA + ay * ay) * (dxB * dxB + by * by));
      return !Number.isFinite(lengthProduct) || dxA * dxB + ay * by < .995 * lengthProduct;
    };
    const emitExtremum = (center: number, begin: number, end: number) => {
      const retainNeighbors = preserveTurn(center);
      if (retainNeighbors) emit(Math.max(begin, center - 1)); emit(center); if (retainNeighbors) emit(Math.min(end - 1, center + 1));
    };
    let selectionBoundaryFirst=first,selectionBoundaryEnd=last+1;
    const choose = (begin: number, end: number, min: number, max: number, finite: boolean, pixelSpan: number) => {
      if(!extremaPair||begin===selectionBoundaryFirst)emit(begin);
      // Keep actual neighbors of the accepted extrema. Replacing a steep peak's
      // immediate directions can otherwise change its finite-width join even
      // when the original peak itself is selected. Overlapping neighborhoods
      // stay in source order and are deduplicated by emit().
      if (finite) {
        const a = Math.min(min, max), b = Math.max(min, max);
        if(extremaPair){emit(a);if(b!==a)emit(b);}
        else {emitExtremum(a, begin, end); if (b !== a) emitExtremum(b, begin, end);}
      }
      if(!extremaPair||end===selectionBoundaryEnd)emit(end - 1);
      currentPageLargestSpan = Math.max(currentPageLargestSpan, pixelSpan);
      if (end - begin > 2) {stats.largestSimplifiedPixelSpan = Math.max(stats.largestSimplifiedPixelSpan, pixelSpan); pageLargestSpan = Math.max(pageLargestSpan, pixelSpan);}
      selectionAudit?.push({first: begin, last: end - 1, minimum: min, maximum: max, pixelSpan, finite});
    };
    const scanBoundary = (begin: number, end: number) => {
      let runFirst = begin;
      while (runFirst < end) {
        const finite = Number.isFinite(y(runFirst)); stats.boundarySamplesScannedThisUpdate++;
        let runEnd = runFirst + 1, min = runFirst, max = runFirst, minValue = y(runFirst), maxValue = minValue;
        while (runEnd < end) {
          const value = y(runEnd); stats.boundarySamplesScannedThisUpdate++;
          if (Number.isFinite(value) !== finite) break;
          if (finite) {if (value < minValue) {minValue = value; min = runEnd;} if (value > maxValue) {maxValue = value; max = runEnd;}}
          runEnd++;
        }
        const span = (x(runEnd - 1) - x(runFirst)) * scale;
        if (span <= maximumSpan) choose(runFirst, runEnd, min, max, finite, span);
        else for (let index = runFirst; index < runEnd; index++) emit(index);
        runFirst = runEnd;
      }
    };
    for (let pageIndex = firstPage; pageIndex <= lastPage && !resourceLimit; pageIndex++) {
      if (deltaPlan && pageIndex === deltaPlan.stableFirstPage) {
        if (!ensureIndices(this.outputCount + deltaPlan.stable[A.count]!)) break;
        deltaOutputOffset = this.outputCount; this.outputCount += deltaPlan.stable[A.count]!;
        stats.reusedPages += deltaPlan.stableEndPage - deltaPlan.stableFirstPage;
        stats.reusedSelectionPages += deltaPlan.stableEndPage - deltaPlan.stableFirstPage;
        stats.largestSimplifiedPixelSpan = Math.max(stats.largestSimplifiedPixelSpan, deltaPlan.stable[A.span]!);
        pageIndex = deltaPlan.stableEndPage - 1; continue;
      }
      const chunkStart = chunks.length; pageLargestSpan = 0;
      let page = this.pages.get(pageIndex);
      if (!page) {
        const base = pageIndex * this.pageSize;
        page = {base, builtNext: Math.max(base, source.firstSampleIndex), states: new Uint8Array(this.leaves * 2), minimum: new Uint16Array(this.leaves * 2), maximum: new Uint16Array(this.leaves * 2)};
        this.pages.set(pageIndex, page);
      } else stats.reusedPages++;
      const end = Math.min(page.base + this.pageSize, source.nextSampleIndex), buildFrom = Math.max(source.firstSampleIndex, page.builtNext);
      if (buildFrom < end) {
        const firstLeaf = Math.floor((buildFrom - page.base) / this.leafSize), lastLeaf = Math.floor((end - 1 - page.base) / this.leafSize);
        // Ancestors may reference already-built leaves, so require the whole
        // retained page (not just its new tail) to belong to this dense span.
        const activeBegin = Math.max(source.firstSampleIndex, page.base);
        const firstSpan = denseComplete && activeBegin >= denseFirst && end <= denseSplit;
        const pageValues = firstSpan ? denseA : denseComplete && denseB && activeBegin >= denseSplit && end <= source.nextSampleIndex ? denseB : undefined;
        if (pageValues) {
          stats.sourceSamplesScannedThisUpdate += buildDensePage(page, pageValues, firstSpan ? denseFirst : denseSplit, source.firstSampleIndex, end, firstLeaf, lastLeaf, this.leaves, this.leafSize);
        } else {
        let scanned = 0;
        for (let leaf = firstLeaf; leaf <= lastLeaf; leaf++) {
          const begin = Math.max(source.firstSampleIndex, page.base + leaf * this.leafSize), leafEnd = Math.min(end, page.base + (leaf + 1) * this.leafSize);
          const node = this.leaves + leaf;
          const inFirstSpan = denseComplete && begin >= denseFirst && leafEnd <= denseSplit;
          const values = inFirstSpan ? denseA
            : denseComplete && denseB && begin >= denseSplit && leafEnd <= source.nextSampleIndex ? denseB : undefined;
          if (values) {
            scanDenseLeaf(page, node, values, inFirstSpan ? denseFirst : denseSplit, begin, leafEnd);
          } else {
            let min = begin, max = begin, minValue = Infinity, maxValue = -Infinity, finite = 0;
            for (let index = begin; index < leafEnd; index++) {
              const value = y(index);
              if (Number.isFinite(value)) {finite++; if (value < minValue) {minValue = value; min = index;} if (value > maxValue) {maxValue = value; max = index;}}
            }
            page.states[node] = finite === 0 ? 2 : finite === leafEnd - begin ? 1 : 3;
            page.minimum[node] = min - page.base; page.maximum[node] = max - page.base;
          }
          scanned += leafEnd - begin;
        }
        stats.sourceSamplesScannedThisUpdate += scanned;
        // Recompute affected ancestors only, retaining untouched page summaries.
        let beginNode = this.leaves + firstLeaf, endNode = this.leaves + lastLeaf;
        while (beginNode > 1) {
          beginNode = Math.floor(beginNode / 2); endNode = Math.floor(endNode / 2);
          for (let node = beginNode; node <= endNode; node++) this.merge(page, node, y);
        }
        }
        page.builtNext = end;
      }
      const queryFirst = Math.max(first, page.base, source.firstSampleIndex), queryEnd = Math.min(last + 1, page.base + this.pageSize, source.nextSampleIndex);
      const neighborFirst = Math.max(source.firstSampleIndex, page.base - 1), neighborNext = Math.min(source.nextSampleIndex, page.base + this.pageSize + 1);
      let activeFirst = queryFirst, activeEnd = queryEnd, topology: number[] | undefined;
      const previousSelected = page.selected;
      let reusedProjection: {outputFirst: number; first: number; end: number; selected: SelectedPage}[] | undefined;
      const reuseTerminal = (node: number, begin: number, end: number, finite: boolean, span: number): boolean => {
        const old = previousSelected;
        if (!request.reuseUnchangedGroups || !old?.groupLookup ||
            source.firstSampleIndex >= begin || end >= old.neighborNext ||
            begin < old.first || end > old.end ||
            old.maximumSpan !== maximumSpan || old.directionRatio !== directionRatio ||
            old.extremaNeighborsRetained !== stats.extremaNeighborsRetained || old.neighborDistance !== neighborDistance ||
            old.neighborScaleX !== neighborScaleX || old.neighborScaleY !== neighborScaleY) return false;
        const group = old.groupLookup[node]! - 1;
        if (group < 0) return false;
        const offset = group * GROUP_STRIDE;
        if (old.groups[offset + 1]! + page!.base !== begin || old.groups[offset + 2]! + page!.base !== end) return false;
        const from = old.groups[offset + 3]!, to = old.groups[offset + 4]!, outputFirst = selection!.length;
        if (from >= to) return false;
        if(extremaPair&&((begin===activeFirst&&old.indices[from]!==begin)||(end===activeEnd&&old.indices[to-1]!==end-1)))return false;
        for (let index = from; index < to; index++) selection!.push(old.indices[index]!);
        (reusedProjection ??= []).push({outputFirst, first: from, end: to, selected: old});
        currentPageLargestSpan = Math.max(currentPageLargestSpan, span);
        if (end - begin > 2) {stats.largestSimplifiedPixelSpan = Math.max(stats.largestSimplifiedPixelSpan, span); pageLargestSpan = Math.max(pageLargestSpan, span);}
        selectionAudit?.push({first: begin, last: end - 1, minimum: page!.base + page!.minimum[node]!, maximum: page!.base + page!.maximum[node]!, pixelSpan: span, finite});
        stats.reusedTerminalGroups++;
        return true;
      };
      const visit = (node: number, begin: number, end: number) => {
        if (resourceLimit || end <= activeFirst || begin >= activeEnd || begin >= source.nextSampleIndex || end <= source.firstSampleIndex) return;
        stats.visitedSummaryNodes++;
        const clippedFirst = Math.max(activeFirst, begin, source.firstSampleIndex), clippedEnd = Math.min(activeEnd, end, source.nextSampleIndex);
        const state = page!.states[node]!;
        const selectedFirst = selection!.length;
        if (clippedFirst === begin && clippedEnd === end && (state === 1 || state === 2)) {
          const span = (x(end - 1) - x(begin)) * scale;
          if (span <= maximumSpan) {
            if (!reuseTerminal(node, begin, end, state === 1, span))
              choose(begin, end, page!.base + page!.minimum[node]!, page!.base + page!.maximum[node]!, state === 1, span);
            topology?.push(node, begin - page!.base, end - page!.base, selectedFirst, selection!.length); return;
          }
        }
        if (end - begin <= this.leafSize) {
          scanBoundary(clippedFirst, clippedEnd);
          topology?.push(node, begin - page!.base, end - page!.base, selectedFirst, selection!.length); return;
        }
        const middle = begin + (end - begin) / 2;
        visit(node * 2, begin, middle); visit(node * 2 + 1, middle, end);
      };
      let projectionFailed = false;
      const project = (): SelectedPage => {
        const indices = Float64Array.from(selection!), positions = new Float32Array(indices.length * 2);
        let strict = true, previous = -Infinity, maximumXError = 0, maximumYError = 0, rangeIndex = 0, projected = 0, reused = 0;
        for (let index = 0; index < indices.length;) {
          const range = reusedProjection?.[rangeIndex];
          if (range?.outputFirst === index) {
            const old = range.selected, count = range.end - range.first;
            positions.set(old.positions.subarray(range.first * 2, range.end * 2), index * 2);
            if (!(old.positions[range.first * 2]! > previous)) strict = false;
            if (!old.strict) for (let cursor = range.first + 1; cursor < range.end; cursor++) if (!(old.positions[cursor * 2]! > old.positions[(cursor - 1) * 2]!)) {strict = false; break;}
            previous = old.positions[(range.end - 1) * 2]!;
            maximumXError = Math.max(maximumXError, old.maximumXError); maximumYError = Math.max(maximumYError, old.maximumYError);
            reused += count; index += count; rangeIndex++; continue;
          }
          const absolute = indices[index]!, rawX = x(absolute), rawY = y(absolute), px = Math.fround(rawX - origin.x), py = Number.isFinite(rawY) ? Math.fround(rawY - origin.y) : NaN;
          if (!Number.isFinite(px) || (Number.isFinite(rawY) && !Number.isFinite(py))) projectionFailed = true;
          positions[index * 2] = px; positions[index * 2 + 1] = py;
          if (!(px > previous)) strict = false; previous = px;
          maximumXError = Math.max(maximumXError, Math.abs(origin.x + px - rawX));
          if (Number.isFinite(rawY)) maximumYError = Math.max(maximumYError, Math.abs(origin.y + py - rawY));
          projected++; index++;
        }
        stats.projectedSamplesThisUpdate += projected; stats.reusedProjectionSamplesThisUpdate += reused;
        const groups = Int32Array.from(topology ?? []), groupLookup = request.reuseUnchangedGroups && groups.length ? new Uint16Array(this.leaves * 2) : undefined;
        if (groupLookup) for (let offset = 0; offset < groups.length; offset += GROUP_STRIDE) groupLookup[groups[offset]!] = offset / GROUP_STRIDE + 1;
        reusedProjection = undefined;
        return {first: activeFirst, end: activeEnd, scale, maximumSpan, directionRatio, neighborFirst, neighborNext, builtNext: page!.builtNext, indices, positions, groups, groupLookup, strict, maximumXError, maximumYError, largestSpan: currentPageLargestSpan, extremaNeighborsRetained: stats.extremaNeighborsRetained, neighborDistance, neighborScaleX, neighborScaleY, audit: selectionAudit};
      };
      const append = (selected: SelectedPage, begin: number, end: number, role: string) => {
        if (begin >= end || !ensureIndices(this.outputCount + end - begin)) return;
        const offset = this.outputCount; if (includeIndices) this.indices.set(selected.indices.subarray(begin, end), offset); this.outputCount += end - begin;
        chunks.push({offset, selected, first: begin, end, key: `${page!.base}:${role}`});
        const ratio = scale / selected.scale;
        // A cached page supplies a conservative bound for any subset of it.
        stats.largestSimplifiedPixelSpan = Math.max(stats.largestSimplifiedPixelSpan, selected.largestSpan * ratio);
        pageLargestSpan = Math.max(pageLargestSpan, selected.largestSpan * ratio);
        if (audit && selected.audit) {
          const firstIndex = selected.indices[begin]!, lastIndex = selected.indices[end - 1]!;
          for (const item of selected.audit) if (extremaPair ? item.minimum>=firstIndex&&item.minimum<=lastIndex&&item.maximum>=firstIndex&&item.maximum<=lastIndex : item.first >= firstIndex && item.last <= lastIndex) audit.push({...item, pixelSpan: item.pixelSpan * ratio});
        }
      };
      let cached = page.selected;
      // Cache the complete currently available page, not the clipped viewport.
      // A ring may advance its prefix through the cached page without changing
      // any retained source value. Its first touched group is queried again.
      const scaleRatio = cached ? scale / cached.scale : 1;
      const reuse = cached && cached.first <= queryFirst && cached.end >= queryEnd && scaleRatio >= .5 && cached.largestSpan * scaleRatio <= maximumSpan && cached.maximumSpan === maximumSpan && cached.directionRatio === directionRatio && cached.extremaNeighborsRetained === stats.extremaNeighborsRetained && cached.neighborDistance === neighborDistance && cached.neighborScaleX === neighborScaleX && cached.neighborScaleY === neighborScaleY && cached.neighborNext === neighborNext && cached.builtNext === page.builtNext && (!audit || cached.audit);
      if (!reuse) {
        activeFirst = Math.max(page.base, source.firstSampleIndex); activeEnd = Math.min(page.base + this.pageSize, source.nextSampleIndex);
        selection = []; selectionAudit = audit ? [] : undefined; topology = []; currentPageLargestSpan = 0;
        selectionBoundaryFirst=activeFirst;selectionBoundaryEnd=activeEnd;
        visit(1, page.base, page.base + this.pageSize);
        cached = project(); page.selected = cached;
        if (projectionFailed) return fallback('relative-overflow');
      } else stats.reusedSelectionPages++;
      topology = undefined; selection = undefined; selectionAudit = undefined;
      const groups = cached!.groups, groupCount = groups.length / GROUP_STRIDE;
      let low = 0, high = groupCount;
      while (low < high) {const middle = (low + high) >>> 1; if (page.base + groups[middle * GROUP_STRIDE + 2]! <= queryFirst) low = middle + 1; else high = middle;}
      const firstGroup = low;
      high = groupCount;
      while (low < high) {const middle = (low + high) >>> 1; if (page.base + groups[middle * GROUP_STRIDE + 1]! < queryEnd) low = middle + 1; else high = middle;}
      const groupEnd = low;
      if (firstGroup >= groupEnd) {if (deltaEnabled) ownedPages.push(ownLedgerPage(pageIndex, page.selected, [], pageLargestSpan)); continue;}
      const needsQuery = (group: number) => {
        const offset = group * GROUP_STRIDE, begin = Math.max(cached!.first, page!.base + groups[offset + 1]!), end = Math.min(cached!.end, page!.base + groups[offset + 2]!);
        return queryFirst > begin || queryEnd < end || (cached!.neighborFirst !== neighborFirst && begin <= source.firstSampleIndex) ||
          extremaPair&&((group===firstGroup&&cached!.indices[groups[offset+3]!]!==queryFirst)||(group===groupEnd-1&&cached!.indices[groups[offset+4]!-1]!==queryEnd-1));
      };
      const appendBoundary = (group: number) => {
        const offset = group * GROUP_STRIDE;
        activeFirst = queryFirst; activeEnd = queryEnd; selection = []; selectionAudit = audit ? [] : undefined; currentPageLargestSpan = 0;
        selectionBoundaryFirst=activeFirst;selectionBoundaryEnd=activeEnd;
        visit(groups[offset]!, page!.base + groups[offset + 1]!, page!.base + groups[offset + 2]!);
        const boundary = project(); selection = undefined; selectionAudit = undefined;
        append(boundary, 0, boundary.indices.length, `boundary:${group}`);
      };
      let middleFirst = firstGroup, middleEnd = groupEnd;
      if (needsQuery(firstGroup)) {appendBoundary(firstGroup); middleFirst++;}
      const queryLast = middleFirst < groupEnd && needsQuery(groupEnd - 1);
      if (queryLast) middleEnd--;
      if (middleFirst < middleEnd) append(cached!, groups[middleFirst * GROUP_STRIDE + 3]!, groups[(middleEnd - 1) * GROUP_STRIDE + 4]!, 'middle');
      if (queryLast) appendBoundary(groupEnd - 1);
      if (projectionFailed) return fallback('relative-overflow');
      if (deltaEnabled) ownedPages.push(ownLedgerPage(pageIndex, page.selected, chunks.slice(chunkStart), pageLargestSpan));
    }
    if (hasAfter) emit(last + 1);
    if (resourceLimit) return fallback('resource-limit');
    const count = this.outputCount;
    if (!pageMode && this.positions.length < count * 2) {let capacity = Math.max(128, this.positions.length); while (capacity < count * 2) capacity *= 2; this.positions = new Float32Array(capacity);}
    let strict = true, previous = -Infinity;
    const projectHalo = (index: number) => {
      const original = index === 0 && hasBefore ? first - 1 : last + 1, rawX = x(original), rawY = y(original), px = Math.fround(rawX - origin.x), py = Number.isFinite(rawY) ? Math.fround(rawY - origin.y) : NaN;
      if (!Number.isFinite(px) || (Number.isFinite(rawY) && !Number.isFinite(py))) return fallback('relative-overflow');
      if (!pageMode) {this.positions[index * 2] = px; this.positions[index * 2 + 1] = py;}
      if (!(px > previous)) strict = false; previous = px;
      stats.maximumProjectionXError = Math.max(stats.maximumProjectionXError, Math.abs(origin.x + px - rawX));
      if (Number.isFinite(rawY)) stats.maximumProjectionYError = Math.max(stats.maximumProjectionYError, Math.abs(origin.y + py - rawY));
      return undefined;
    };
    if (hasBefore) {const failed = projectHalo(0); if (failed) return failed;}
    let stableProjected = false;
    const projectStable = () => {
      if (!deltaPlan || stableProjected) return;
      const a = deltaPlan.stable;
      if (!a[A.strict] || !(a[A.firstX]! > previous)) strict = false;
      previous = a[A.lastX]!;
      stats.maximumProjectionXError = Math.max(stats.maximumProjectionXError, a[A.errorX]!);
      stats.maximumProjectionYError = Math.max(stats.maximumProjectionYError, a[A.errorY]!);
      stableProjected = true;
    };
    for (const chunk of chunks) {
      if (deltaPlan && chunk.offset >= deltaOutputOffset) projectStable();
      const values = chunk.selected;
      if (!pageMode) this.positions.set(values.positions.subarray(chunk.first * 2, chunk.end * 2), chunk.offset * 2);
      if (!(values.positions[chunk.first * 2]! > previous)) strict = false;
      if (!values.strict) for (let index = chunk.first + 1; index < chunk.end; index++) if (!(values.positions[index * 2]! > values.positions[(index - 1) * 2]!)) {strict = false; break;}
      previous = values.positions[(chunk.end - 1) * 2]!;
      stats.maximumProjectionXError = Math.max(stats.maximumProjectionXError, values.maximumXError);
      stats.maximumProjectionYError = Math.max(stats.maximumProjectionYError, values.maximumYError);
    }
    projectStable();
    if (hasAfter) {const failed = projectHalo(count - 1); if (failed) return failed;}
    stats.selectedDisplaySamples = count; stats.submittedDisplaySamples = count - Number(hasBefore) - Number(hasAfter);
    stats.omittedDisplaySamples = stats.requestedSourceSamples - stats.submittedDisplaySamples;
    stats.displayReduction = stats.omittedDisplaySamples > 0;
    stats.summaryPages = this.pages.size; stats.summaryBytes = this.pages.size * this.pageBytes; stats.selectionBytes = this.indices.byteLength; stats.projectionBytes = this.positions.byteLength;
    const completedDelta = deltaPlan ? this.deltaLedger!.complete(deltaPlan, ownedPages) : undefined;
    if (completedDelta) {stats.cachedSelectionBytes = completedDelta.aggregate[A.selection]!; stats.cachedProjectionBytes = completedDelta.aggregate[A.projection]!; stats.cachedTopologyBytes = completedDelta.aggregate[A.topology]!;}
    else {for (const page of this.pages.values()) {stats.cachedSelectionBytes += page.selected?.indices.byteLength ?? 0; stats.cachedProjectionBytes += page.selected?.positions.byteLength ?? 0; stats.cachedTopologyBytes += (page.selected?.groups.byteLength ?? 0) + (page.selected?.groupLookup?.byteLength ?? 0);}}
    this.state = {identity: source.identity, epoch: source.contentEpoch, binding: request.bindingRevision, projection: selectionPolicyKey, next: source.nextSampleIndex};
    if (pageMode) {
      // A rolling window can outlive its original projection origin. Recover
      // Float32 spacing around the current window before falling back to raw
      // geometry. Keep min/max summaries: only display selections/coordinates
      // and their GPU/ledger certificates depend on this origin. Re-reading all
      // retained source samples here causes periodic stalls at high rates.
      if (!strict && allowRebase) {
        const center = x(first) / 2 + x(last) / 2;
        if (Number.isFinite(center) && center !== origin.x) {
          this.origin = {...origin, x: center};
          for (const page of this.pages.values()) page.selected = undefined;
          this.pagePackets?.clear(); this.arena?.clear(); this.deltaLedger?.clear();
          const retry = this.updateProjection(request, false);
          retry.stats.projectionRebasesThisUpdate++;
          // Preserve actual work counters from both attempts, but publish only
          // the accepted projection's errors, allocations and geometry counts.
          for (const key of ['sourceSamplesScannedThisUpdate', 'boundarySamplesScannedThisUpdate',
            'visitedSummaryNodes', 'projectedSamplesThisUpdate', 'reusedProjectionSamplesThisUpdate',
            'reusedTerminalGroups', 'evictedPages'] as const) retry.stats[key] += stats[key];
          return retry;
        }
      }
      // Even a centered origin cannot represent every possible source spacing.
      // Keep the strict-order safety gate and bound recovery to one attempt.
      if (!strict) return fallback('unverified-x-order');
      if (arenaMode) {
        const template = {strokeGroup: request.strokeGroup ?? this.id, origin: this.origin!, domain: request.domain, clipRect: request.clipRect, thickness: request.style.thickness, color: [...request.style.color] as typeof request.style.color};
        const packed = completedDelta ? this.arena!.updateCertified(completedDelta, template, this.id)
          : this.arena!.update(chunks.map(chunk => ({key: chunk.key, positions: chunk.selected.positions, first: chunk.first, count: chunk.end - chunk.first, strictlyMonotonicX: true})), template, this.id);
        stats.arena = packed.stats; stats.projectionBytes = packed.stats.capacityBytes;
        if (completedDelta) {
          stats.projectionBytes += completedDelta.aggregate[A.extra]!;
          this.deltaLedger!.commit(completedDelta, stats.sourceSamplesScannedThisUpdate);
        } else {
          const projected = new Set([...this.pages.values()].map(page => page.selected?.positions.buffer));
          for (const chunk of chunks) if (!projected.has(chunk.selected.positions.buffer)) {projected.add(chunk.selected.positions.buffer); stats.projectionBytes += chunk.selected.positions.buffer.byteLength;}
          if (deltaEnabled) this.deltaLedger!.seed(source, deltaPolicy(), first, last + 1, ownedPages, stats.sourceSamplesScannedThisUpdate);
        }
        if (deltaEnabled) stats.selectionDelta = this.deltaLedger!.getStats();
        return {kind: 'display', packets: packed.packets, sourceIndices: includeIndices ? this.indices.subarray(0, count) : this.indices, sourceIndicesIncluded: includeIndices, stats, audit};
      }
      const packed = this.pagePackets!.update(chunks.map(chunk => ({key: chunk.key, positions: chunk.selected.positions, first: chunk.first, count: chunk.end - chunk.first, strictlyMonotonicX: true})),
        {strokeGroup: request.strokeGroup ?? this.id, origin: this.origin, domain: request.domain, clipRect: request.clipRect, thickness: request.style.thickness, color: [...request.style.color]});
      stats.pagePackets = packed.stats;
      const projected = new Set<ArrayBufferLike>();
      for (const page of this.pages.values()) if (page.selected) projected.add(page.selected.positions.buffer);
      stats.projectionBytes = packed.stats.allocatedBridgeBytes;
      for (const chunk of chunks) if (chunk.end - chunk.first >= 2 && !projected.has(chunk.selected.positions.buffer)) {
        projected.add(chunk.selected.positions.buffer); stats.projectionBytes += chunk.selected.positions.buffer.byteLength;
      }
      return {kind: 'display', packets: packed.packets, sourceIndices: includeIndices ? this.indices.subarray(0, count) : this.indices, sourceIndicesIncluded: includeIndices, stats, audit};
    }
    const packet: DrawPacket = {id: this.id, revision: ++this.revision, count, positions: this.positions.subarray(0, count * 2), dimensions: 2, mode: 'line',
      strokeGroup: request.strokeGroup ?? this.id,
      pointSize: 0, thickness: request.style.thickness, color: [...request.style.color], origin: this.origin, domain: request.domain, clipRect: request.clipRect,
      monotonicX: true, strictlyMonotonicX: strict, drawFirst: Number(hasBefore), drawCount: stats.submittedDisplaySamples};
    return {kind: 'display', packet, sourceIndices: includeIndices ? this.indices.subarray(0, count) : this.indices, sourceIndicesIncluded: includeIndices, stats, audit};
  }

  /** Release hidden geometry without changing the projection of unchanged data.
   * Only the scalar origin and existing source/policy invalidation record remain.
   * update still invalidates them on identity/epoch/binding/policy/window changes;
   * ordinary clear and dispose continue to drop every reference. */
  suspend(): void {
    const origin = this.origin, state = this.state;
    this.clear();
    if (!this.disposed) {this.origin = origin; this.state = state;}
  }
  clear(): void {this.pages.clear(); this.pagePackets?.clear(); this.arena?.clear(); this.deltaLedger?.clear(); this.state = undefined; this.origin = undefined; this.indices = new Float64Array(0); this.positions = new Float32Array(0); this.outputCount = 0; this.id = nextDisplayId--;}
  dispose(): void {if (this.disposed) return; this.clear(); this.disposed = true;}

  private merge(page: Page, node: number, y: Reader): void {
    const left = node * 2, right = left + 1, a = page.states[left]!, b = page.states[right]!;
    if (!a || !b) {
      const other = a ? left : right;
      page.states[node] = page.states[other]!; page.minimum[node] = page.minimum[other]!; page.maximum[node] = page.maximum[other]!; return;
    }
    page.states[node] = a === b && a !== 3 ? a : 3;
    if (a === 2) {page.minimum[node] = page.minimum[right]!; page.maximum[node] = page.maximum[right]!; return;}
    if (b === 2) {page.minimum[node] = page.minimum[left]!; page.maximum[node] = page.maximum[left]!; return;}
    page.minimum[node] = y(page.base + page.minimum[left]!) <= y(page.base + page.minimum[right]!) ? page.minimum[left]! : page.minimum[right]!;
    page.maximum[node] = y(page.base + page.maximum[left]!) >= y(page.base + page.maximum[right]!) ? page.maximum[left]! : page.maximum[right]!;
  }
}

function isPowerOfTwo(value: number): boolean {return Number.isSafeInteger(value) && value > 0 && (value & (value - 1)) === 0;}

/** Direct borrowed reads; no dense materialization of an automatic X column. */
function reader(column: DataColumnRuns): Reader {
  if (column.kind === 'paged') {
    let pageIndex = NaN, values: ReturnType<typeof column.getPage>;
    return index => {if (index < column.firstIndex || index >= column.firstIndex + column.count) return NaN; const next = Math.floor(index / column.pageSize); if (next !== pageIndex) {values = column.getPage(next); pageIndex = next;} return values?.[index - next * column.pageSize] ?? NaN;};
  }
  if (column.kind === 'dense') {
    const a = column.slices[0], b = column.slices[1], length = a?.length ?? 0;
    if (column.slices.length > 2) throw new RangeError('Display tree supports at most two dense ring slices');
    // Real borrowed dense slices are already clipped to the retained count.
    // Hoist their bounds and choose the one/two-span access path once. Typed
    // array out-of-range reads remain NaN, without repeated object lookups,
    // optional chaining and four range branches for every valid source value.
    const first = column.firstIndex;
    if (a && !b && length === column.count) return index => a[index - first] ?? NaN;
    if (a && b && length + b.length === column.count) {
      const split = first + length;
      return index => (index < split ? a[index - first] : b[index - split]) ?? NaN;
    }
    return index => {const offset = index - column.firstIndex; return offset < 0 || offset >= column.count ? NaN : (offset < length ? a?.[offset] : b?.[offset - length]) ?? NaN;};
  }
  const runs = column.runs, runStart = column.runStart, lastIndex = runs.length - 1, tail = runs[lastIndex];
  let current = runStart;
  return index => {
    let run = runs[current];
    if (!run || index < run.firstIndex || index >= run.firstIndex + run.count) {
      // Equal-sized append batches permit a constant-time candidate lookup.
      // Validate its actual absolute-index interval before using it: variable
      // batches, the larger initial prefill and all irregular cases still fall
      // back to the exact binary search. Never reassociate the run expression.
      const guess = tail && tail.count > 0 ? Math.max(runStart, lastIndex - Math.ceil((tail.firstIndex - index) / tail.count)) : -1;
      const candidate = runs[guess];
      if (candidate && index >= candidate.firstIndex && index < candidate.firstIndex + candidate.count) {current = guess; run = candidate;}
      else {
        let low = runStart, high = runs.length;
        while (low < high) {const middle = low + Math.floor((high - low) / 2), value = runs[middle]!; if (value.firstIndex + value.count <= index) low = middle + 1; else high = middle;}
        current = low; run = runs[current];
      }
    }
    return run ? run.start + (index - run.firstIndex) * run.step : NaN;
  };
}
