import type {DataColumnRuns} from './core/data.js';
import {certifySourceDelta, certifiedCompletePageRange, readSourceCertificate, type SourceCertificate} from './core/line-delta-certificate.js';

/** These are selector-owned immutable arrays, never DataSet borrowed storage. */
export interface LedgerSelection {
  readonly indices: Float64Array;
  readonly positions: Float32Array;
  readonly groups: Int32Array;
  readonly groupLookup?: Uint16Array;
  readonly strict: boolean;
  readonly maximumXError: number;
  readonly maximumYError: number;
  readonly largestSpan: number;
  readonly scale: number;
}
export interface LedgerChunk {
  readonly key: string;
  readonly positions: Float32Array;
  readonly first: number;
  readonly count: number;
  readonly strictlyMonotonicX: boolean;
}
export interface LedgerEntry extends LedgerChunk {readonly offset: number;}
export interface LedgerPage {
  readonly index: number;
  readonly chunks: readonly LedgerChunk[];
  readonly aggregate: Float64Array;
}
export interface LedgerPolicy {
  readonly identity: object;
  readonly binding: number;
  readonly projection: string;
  /** Exact scalar copies. Their evaluation remains in the original selector. */
  readonly numbers: readonly (number | undefined)[];
  readonly preserveNeighbors: boolean;
  readonly reuseGroups: boolean;
}
export interface LedgerSource {
  identity: object; contentEpoch: number; revision: number;
  firstSampleIndex: number; nextSampleIndex: number;
  x: DataColumnRuns; y: DataColumnRuns;
}
export interface LedgerWork {
  hits: number; fallbacks: number; lastReason: string;
  reusedCompletePages: number; visitedPages: number; newlyScannedSamples: number;
  ownedPageRecords: number; retainedTypedBytes: number; auxiliaryTypedBytes: number;
}
export interface LedgerPlan {
  readonly owner: LineSelectionLedger;
  readonly certificate: SourceCertificate;
  readonly policy: LedgerPolicy;
  readonly visibleFirst: number;
  readonly visibleEnd: number;
  readonly firstPage: number;
  readonly endPage: number;
  readonly previousFirstPage: number;
  readonly previousEndPage: number;
  readonly stableFirstPage: number;
  readonly stableEndPage: number;
  readonly stable: Float64Array;
  readonly oldStableOffset: number;
  readonly prefixPages: number;
  readonly suffixPages: number;
}
export interface LedgerCompletedPlan extends LedgerPlan {
  readonly prefix: readonly LedgerEntry[];
  readonly suffix: readonly LedgerEntry[];
  readonly changedPages: readonly LedgerPage[];
  readonly prefixCount: number;
  readonly count: number;
  readonly aggregate: Float64Array;
}

// All sums are bounded integers; max fields are nonnegative. Reordering neither
// changes IEEE coordinate operations nor introduces cancellation in statistics.
export const A = {count: 0, chunks: 1, selection: 2, projection: 3, topology: 4,
  extra: 5, span: 6, errorX: 7, errorY: 8, strict: 9, firstX: 10, lastX: 11} as const;
const WIDTH = 12;
const prepared = new WeakSet<object>();
const completed = new WeakSet<object>();
function empty(): Float64Array {const a = new Float64Array(WIDTH); a[A.strict] = 1; return a;}
function combine(left: Float64Array, right: Float64Array): Float64Array {
  const result = new Float64Array(WIDTH);
  for (let i = 0; i <= A.extra; i++) result[i] = left[i]! + right[i]!;
  for (let i = A.span; i <= A.errorY; i++) result[i] = Math.max(0, left[i]!, right[i]!);
  result[A.strict] = Number(!!left[A.strict] && !!right[A.strict] && (!left[A.count] || !right[A.count] || right[A.firstX]! > left[A.lastX]!));
  result[A.firstX] = left[A.count] ? left[A.firstX]! : right[A.firstX]!;
  result[A.lastX] = right[A.count] ? right[A.lastX]! : left[A.lastX]!;
  return result;
}
/** Fold a node into one query-owned accumulator. The output can be either
 * operand at offset zero. Capture cross-field inputs before replacing count:
 * endpoint and strict-seam decisions must use the original child counts.
 * Every returned range still owns fresh storage; no shared query scratch escapes. */
function foldRange(out: Float64Array, left: Float64Array, leftOffset: number,
  right: Float64Array, rightOffset: number): void {
  const leftCount = left[leftOffset + A.count]!, rightCount = right[rightOffset + A.count]!;
  const strict = Number(!!left[leftOffset + A.strict] && !!right[rightOffset + A.strict] &&
    (!leftCount || !rightCount || right[rightOffset + A.firstX]! > left[leftOffset + A.lastX]!));
  const firstX = leftCount ? left[leftOffset + A.firstX]! : right[rightOffset + A.firstX]!;
  const lastX = rightCount ? right[rightOffset + A.lastX]! : left[leftOffset + A.lastX]!;
  for (let i = 0; i <= A.extra; i++) out[i] = left[leftOffset + i]! + right[rightOffset + i]!;
  for (let i = A.span; i <= A.errorY; i++) out[i] = Math.max(0, left[leftOffset + i]!, right[rightOffset + i]!);
  out[A.strict] = strict; out[A.firstX] = firstX; out[A.lastX] = lastX;
}
function samePolicy(a: LedgerPolicy, b: LedgerPolicy): boolean {
  return a.identity === b.identity && a.binding === b.binding && a.projection === b.projection &&
    a.preserveNeighbors === b.preserveNeighbors && a.reuseGroups === b.reuseGroups &&
    a.numbers.length === b.numbers.length && a.numbers.every((n, i) => Object.is(n, b.numbers[i]));
}
function ownPolicy(p: LedgerPolicy): LedgerPolicy {return Object.freeze({...p, numbers: Object.freeze([...p.numbers])});}
function expected(source: LedgerSource) {
  return {revision: source.revision, epoch: source.contentEpoch, first: source.firstSampleIndex, next: source.nextSampleIndex};
}

export function ownLedgerPage(index: number, cached: LedgerSelection | undefined,
  chunks: readonly {key: string; selected: LedgerSelection; first: number; end: number}[], largestSpan: number): LedgerPage {
  const aggregate = empty(), owned: LedgerChunk[] = [];
  aggregate[A.selection] = cached?.indices.byteLength ?? 0;
  aggregate[A.projection] = cached?.positions.byteLength ?? 0;
  aggregate[A.topology] = (cached?.groups.byteLength ?? 0) + (cached?.groupLookup?.byteLength ?? 0);
  aggregate[A.span] = Math.max(0, largestSpan);
  const seen = new Set<ArrayBufferLike>();
  if (cached) seen.add(cached.positions.buffer);
  let previous = -Infinity;
  for (const chunk of chunks) {
    const selected = chunk.selected, count = chunk.end - chunk.first;
    if (!Number.isSafeInteger(chunk.first) || !Number.isSafeInteger(count) || chunk.first < 0 || count < 1 || chunk.end * 2 > selected.positions.length)
      throw new RangeError('Owned selector chunk is out of range');
    let strict = selected.positions[chunk.first * 2]! > previous;
    if (!selected.strict) for (let i = chunk.first + 1; i < chunk.end; i++) if (!(selected.positions[i * 2]! > selected.positions[(i - 1) * 2]!)) {strict = false; break;}
    if (!aggregate[A.count]) aggregate[A.firstX] = selected.positions[chunk.first * 2]!;
    previous = selected.positions[(chunk.end - 1) * 2]!;
    aggregate[A.lastX] = previous;
    aggregate[A.strict] = Number(!!aggregate[A.strict] && strict && Number.isFinite(previous));
    aggregate[A.count] += count; aggregate[A.chunks]++;
    aggregate[A.errorX] = Math.max(aggregate[A.errorX]!, selected.maximumXError);
    aggregate[A.errorY] = Math.max(aggregate[A.errorY]!, selected.maximumYError);
    if (!seen.has(selected.positions.buffer)) {seen.add(selected.positions.buffer); aggregate[A.extra] += selected.positions.buffer.byteLength;}
    owned.push(Object.freeze({key: chunk.key, positions: selected.positions, first: chunk.first, count, strictlyMonotonicX: true}));
  }
  return Object.freeze({index, chunks: Object.freeze(owned), aggregate});
}

/** Bounded page-keyed aggregation tree. Only changed owned pages are written.
 * The absolute page number is checked separately from its cyclic tree slot. */
export class LineSelectionLedger {
  private pages = new Map<number, LedgerPage>();
  private capacity = 0;
  private tree = new Float64Array(0);
  private certificate?: SourceCertificate;
  private policy?: LedgerPolicy;
  private firstPage = 0;
  private endPage = 0;
  private visibleFirst = 0;
  private visibleEnd = 0;
  private serial = 0;
  private planSerial = new WeakMap<object, number>();
  private disposed = false;
  private work: LedgerWork = {hits: 0, fallbacks: 0, lastReason: 'not-seeded', reusedCompletePages: 0, visitedPages: 0,
    newlyScannedSamples: 0, ownedPageRecords: 0, retainedTypedBytes: 0, auxiliaryTypedBytes: 0};

  constructor(readonly pageSize: number, readonly maximumPages = 4096, readonly maximumTypedBytes = 32 * 1024 * 1024,
    readonly maximumChangedPages = 64) {
    if (!Number.isSafeInteger(pageSize) || pageSize < 1 || !Number.isSafeInteger(maximumPages) || maximumPages < 2 ||
      (maximumPages & (maximumPages - 1)) !== 0 || !(maximumTypedBytes > 0)) throw new RangeError('Invalid ledger budget');
  }
  getStats(): LedgerWork {return {...this.work};}
  private miss(reason: string): undefined {this.work.fallbacks++; this.work.lastReason = reason; this.work.reusedCompletePages = 0; return undefined;}
  private readNode(node: number): Float64Array {return this.tree.slice(node * WIDTH, (node + 1) * WIDTH);}
  private writePage(index: number, page?: LedgerPage): void {
    let node = this.capacity + (index % this.capacity);
    this.tree.set(page?.aggregate ?? empty(), node * WIDTH);
    // node is a parent in [1, capacity). Its WIDTH-field interval ends at
    // (node + 1) * WIDTH <= (2 * node) * WIDTH, the left-child start.
    // The right child follows the left. Thus destination and both inputs are
    // disjoint for every iteration, including parent1 and the smallest tree.
    // Keep exactly combine()'s field order, expressions and left/right order.
    const tree = this.tree;
    while (node > 1) {
      node = Math.floor(node / 2);
      const target = node * WIDTH, left = node * 2 * WIDTH, right = (node * 2 + 1) * WIDTH;
      for (let i = 0; i <= A.extra; i++) tree[target + i] = tree[left + i]! + tree[right + i]!;
      for (let i = A.span; i <= A.errorY; i++) tree[target + i] = Math.max(0, tree[left + i]!, tree[right + i]!);
      tree[target + A.strict] = Number(!!tree[left + A.strict] && !!tree[right + A.strict] && (!tree[left + A.count] || !tree[right + A.count] || tree[right + A.firstX]! > tree[left + A.lastX]!));
      tree[target + A.firstX] = tree[left + A.count] ? tree[left + A.firstX]! : tree[right + A.firstX]!;
      tree[target + A.lastX] = tree[right + A.count] ? tree[right + A.lastX]! : tree[left + A.lastX]!;
    }
  }
  private physicalRange(first: number, end: number): Float64Array {
    const left = empty(), right = empty(); first += this.capacity; end += this.capacity;
    while (first < end) {
      if (first & 1) foldRange(left, left, 0, this.tree, first++ * WIDTH);
      if (end & 1) foldRange(right, this.tree, --end * WIDTH, right, 0);
      first >>>= 1; end >>>= 1;
    }
    foldRange(left, left, 0, right, 0);
    return left;
  }
  range(first: number, end: number): Float64Array {
    if (first >= end) return empty();
    if (!this.capacity || first < this.firstPage || end > this.endPage) throw new RangeError('Ledger range is not owned');
    const slot = first % this.capacity, count = end - first;
    return slot + count <= this.capacity ? this.physicalRange(slot, slot + count)
      : combine(this.physicalRange(slot, this.capacity), this.physicalRange(0, slot + count - this.capacity));
  }
  private retainedBytes(a: Float64Array): number {return a[A.selection]! + a[A.projection]! + a[A.topology]! + a[A.extra]!;}
  private validPage(page: LedgerPage): boolean {
    const prefix = `${page.index * this.pageSize}:`, keys = new Set<string>();
    for (const chunk of page.chunks) {if (!chunk.key.startsWith(prefix) || keys.has(chunk.key)) return false; keys.add(chunk.key);}
    return true;
  }
  private updateResources(): void {
    this.work.ownedPageRecords = this.pages.size;
    this.work.retainedTypedBytes = this.pages.size ? this.retainedBytes(this.range(this.firstPage, this.endPage)) : 0;
    this.work.auxiliaryTypedBytes = this.tree.byteLength + this.pages.size * WIDTH * Float64Array.BYTES_PER_ELEMENT;
  }
  seed(source: LedgerSource, policy: LedgerPolicy, visibleFirst: number, visibleEnd: number, pages: readonly LedgerPage[], newlyScannedSamples = 0): boolean {
    this.clear();
    if (this.disposed) throw new Error('Selection ledger is disposed');
    this.work.visitedPages = pages.length; this.work.newlyScannedSamples = newlyScannedSamples;
    const certificate = readSourceCertificate(source.identity, expected(source));
    if (!certificate || certificate.tainted) {this.miss('seed-source-unproved'); return false;}
    if (!pages.length || pages.length > this.maximumPages) {this.miss('seed-page-budget'); return false;}
    const first = Math.floor(visibleFirst / this.pageSize), end = Math.floor((visibleEnd - 1) / this.pageSize) + 1;
    if (end - first !== pages.length || pages.some((page, i) => page.index !== first + i || !this.validPage(page))) {this.miss('seed-page-order'); return false;}
    let aggregate = empty(); for (const page of pages) aggregate = combine(aggregate, page.aggregate);
    if (this.retainedBytes(aggregate) > this.maximumTypedBytes) {this.miss('seed-byte-budget'); return false;}
    let capacity = 2; while (capacity < pages.length) capacity *= 2;
    this.capacity = capacity; this.tree = new Float64Array(capacity * 2 * WIDTH);
    for (let i = 0; i < capacity * 2; i++) this.tree[i * WIDTH + A.strict] = 1;
    this.firstPage = first; this.endPage = end;
    for (const page of pages) {this.pages.set(page.index, page); this.writePage(page.index, page);}
    this.certificate = certificate; this.policy = ownPolicy(policy); this.visibleFirst = visibleFirst; this.visibleEnd = visibleEnd;
    this.work.lastReason = 'seeded'; this.serial++; this.updateResources(); return true;
  }
  prepare(source: LedgerSource, policy: LedgerPolicy, visibleFirst: number, visibleEnd: number): LedgerPlan | undefined {
    if (this.disposed) throw new Error('Selection ledger is disposed');
    if (!this.policy || !this.certificate) return this.miss('not-seeded');
    if (!samePolicy(this.policy, policy)) return this.miss('selection-policy-changed');
    const result = certifySourceDelta(source.identity, this.certificate, expected(source));
    if (!result.delta) return this.miss(result.reason);
    if (visibleFirst < this.visibleFirst || visibleEnd < this.visibleEnd || visibleEnd <= visibleFirst) return this.miss('viewport-not-forward');
    const firstPage = Math.floor(visibleFirst / this.pageSize), endPage = Math.floor((visibleEnd - 1) / this.pageSize) + 1;
    if (endPage - firstPage > this.capacity || endPage - firstPage > this.maximumPages) return this.miss('page-capacity-growth');
    const stable = certifiedCompletePageRange(result.delta, this.pageSize, this.visibleFirst, this.visibleEnd, visibleFirst, visibleEnd);
    const stableFirstPage = Math.max(stable.firstPage, this.firstPage), stableEndPage = Math.min(stable.endPage, this.endPage);
    if (stableFirstPage >= stableEndPage) return this.miss('no-complete-stable-pages');
    const prefixPages = stableFirstPage - firstPage, suffixPages = endPage - stableEndPage;
    if (prefixPages < 0 || suffixPages < 0 || prefixPages + suffixPages > this.maximumChangedPages) return this.miss('changed-page-budget');
    // Conservative preflight bounds all new indices, positions and topology.
    // No overflow decision is deferred until the arena has been written.
    if (this.work.retainedTypedBytes + (prefixPages + suffixPages) * this.pageSize * 40 > this.maximumTypedBytes)
      return this.miss('typed-byte-budget');
    const plan: LedgerPlan = Object.freeze({owner: this, certificate: result.delta.current, policy: ownPolicy(policy), visibleFirst, visibleEnd,
      firstPage, endPage, previousFirstPage: this.firstPage, previousEndPage: this.endPage, stableFirstPage, stableEndPage, stable: this.range(stableFirstPage, stableEndPage),
      oldStableOffset: this.range(this.firstPage, stableFirstPage)[A.count]!, prefixPages, suffixPages});
    prepared.add(plan); this.planSerial.set(plan, this.serial); return plan;
  }
  complete(plan: LedgerPlan, changedPages: readonly LedgerPage[]): LedgerCompletedPlan {
    this.validate(plan, false);
    if (changedPages.length !== plan.prefixPages + plan.suffixPages) throw new Error('Delta boundary page count differs');
    const prefix: LedgerEntry[] = [], suffix: LedgerEntry[] = [];
    let aggregate = empty(), offset = 0;
    for (let i = 0; i < changedPages.length; i++) {
      if (i === plan.prefixPages) {aggregate = combine(aggregate, plan.stable); offset += plan.stable[A.count]!;}
      const page = changedPages[i]!, expectedPage = i < plan.prefixPages ? plan.firstPage + i : plan.stableEndPage + i - plan.prefixPages;
      if (page.index !== expectedPage || !this.validPage(page)) throw new Error('Delta boundary page order differs');
      const output = i < plan.prefixPages ? prefix : suffix;
      for (const chunk of page.chunks) {output.push(Object.freeze({...chunk, offset})); offset += chunk.count;}
      aggregate = combine(aggregate, page.aggregate);
    }
    if (changedPages.length === plan.prefixPages) {aggregate = combine(aggregate, plan.stable); offset += plan.stable[A.count]!;}
    const prefixCount = prefix.reduce((n, c) => n + c.count, 0);
    if (offset !== aggregate[A.count] || this.retainedBytes(aggregate) > this.maximumTypedBytes) throw new Error('Delta aggregate exceeds its preflight');
    const result: LedgerCompletedPlan = Object.freeze({...plan, prefix: Object.freeze(prefix), suffix: Object.freeze(suffix),
      changedPages: Object.freeze([...changedPages]), prefixCount, count: offset, aggregate});
    completed.add(result); this.planSerial.set(result, this.serial); return result;
  }
  validate(plan: LedgerPlan, requireComplete = true): void {
    if (plan.owner !== this || !(requireComplete ? completed : prepared).has(plan) || this.planSerial.get(plan) !== this.serial)
      throw new Error('Unissued or stale selection delta');
  }
  lookupOld(key: string): LedgerEntry | undefined {
    const separator = key.indexOf(':'), base = Number(key.slice(0, separator));
    if (separator < 1 || !Number.isSafeInteger(base) || base < 0 || base % this.pageSize) return undefined;
    const pageIndex = base / this.pageSize, page = this.pages.get(pageIndex);
    if (!page) return undefined;
    let offset = this.range(this.firstPage, pageIndex)[A.count]!;
    for (const chunk of page.chunks) {if (chunk.key === key) return {...chunk, offset}; offset += chunk.count;}
    return undefined;
  }
  materialize(plan?: LedgerCompletedPlan): LedgerEntry[] {
    if (plan) this.validate(plan);
    const output: LedgerEntry[] = [];
    let offset = 0;
    const append = (page: LedgerPage) => {for (const chunk of page.chunks) {output.push({...chunk, offset}); offset += chunk.count;}};
    if (!plan) for (let page = this.firstPage; page < this.endPage; page++) append(this.pages.get(page)!);
    else {
      for (let i = 0; i < plan.prefixPages; i++) append(plan.changedPages[i]!);
      for (let page = plan.stableFirstPage; page < plan.stableEndPage; page++) append(this.pages.get(page)!);
      for (let i = plan.prefixPages; i < plan.changedPages.length; i++) append(plan.changedPages[i]!);
    }
    return output;
  }
  commit(plan: LedgerCompletedPlan, newlyScannedSamples: number): void {
    this.validate(plan);
    for (let page = this.firstPage; page < Math.min(plan.firstPage, this.endPage); page++) {this.pages.delete(page); this.writePage(page);}
    for (let page = Math.max(plan.endPage, this.firstPage); page < this.endPage; page++) {this.pages.delete(page); this.writePage(page);}
    for (const page of plan.changedPages) {this.pages.set(page.index, page); this.writePage(page.index, page);}
    this.firstPage = plan.firstPage; this.endPage = plan.endPage; this.visibleFirst = plan.visibleFirst; this.visibleEnd = plan.visibleEnd;
    this.certificate = plan.certificate; this.policy = plan.policy; this.serial++;
    this.work.hits++; this.work.lastReason = 'certified-complete-middle';
    this.work.reusedCompletePages = plan.stableEndPage - plan.stableFirstPage;
    this.work.visitedPages = plan.changedPages.length; this.work.newlyScannedSamples = newlyScannedSamples;
    this.updateResources();
  }
  clear(): void {
    this.pages.clear(); this.tree = new Float64Array(0); this.capacity = 0;
    this.certificate = undefined; this.policy = undefined; this.firstPage = this.endPage = this.visibleFirst = this.visibleEnd = 0; this.serial++;
    this.work.ownedPageRecords = this.work.retainedTypedBytes = this.work.auxiliaryTypedBytes = this.work.reusedCompletePages = 0;
    this.work.visitedPages = this.work.newlyScannedSamples = 0; this.work.lastReason = 'cleared';
  }
  dispose(): void {if (this.disposed) return; this.clear(); this.disposed = true;}
}
