import type {NumericArray, NumericStorage, SampleColumns} from './data.js';

/** Experimental explicit-column storage. It is not used by DataSetXY yet. Automatic
 * coordinates remain the responsibility of the existing affine-column backend. */
export interface PagedColumnDefinition {storage?: NumericStorage;}
export type PagedColumnsSchema = Record<string, PagedColumnDefinition>;
export interface PagedColumnsOptions {
  schema: PagedColumnsSchema;
  capacity: number;
  pageSize?: number;
  /** Fault-injection/measurement hook. Return a fresh, exclusively owned page. */
  allocator?: (storage: NumericStorage, length: number) => NumericArray;
  /** Optional fixed reusable-page limit. Omit for a bounded adaptive pool. */
  poolPagesPerStorage?: number;
  /** Hard byte bound for each constructor's adaptive pool; default 256 KiB. */
  maxPoolBytesPerStorage?: number;
  /** Adaptive targets use the largest draft set in this many recent successful
   * appends, plus one head/tail-slack page per column; default 16 appends. */
  poolHistoryLength?: number;
}

/** Borrowed read-only page view, invalid after any mutation. An absolute sample i
 * uses page floor(i/pageSize), at offset i - pageIndex*pageSize. Only samples in
 * [firstIndex, firstIndex+count) are valid; unused page bytes are NOT observations.
 * getPage is a direct map lookup, not a search through preceding pages. */
export interface PagedColumnView {
  readonly kind: 'paged';
  readonly firstIndex: number;
  readonly count: number;
  readonly pageSize: number;
  readonly revision: number;
  readonly storage: NumericStorage;
  readonly bytesPerElement: number;
  getPage(absolutePageIndex: number): NumericArray | undefined;
}

/** Internal two-phase append. All constructors, input getters and byte comparisons
 * finish before this is returned. commit publishes once; abort leaves the old
 * column views, counters and logical sample identities unchanged. */
export interface PreparedPagedAppend {
  readonly sampleCount: number; readonly nextIndex: number; readonly capacity: number;
  commit(): void;
  abort(): void;
}

export interface PagedColumnsStats {
  readonly capacity: number; readonly sampleCount: number; readonly firstIndex: number;
  readonly nextIndex: number; readonly pageSize: number; readonly columnCount: number;
  /** Actual live, unique owned page bytes, including partial-page slack. */
  readonly uniquePageBytes: number; readonly uniquePageCount: number;
  /** Actual bounded reusable pages. Include these when reporting allocated bytes. */
  readonly pooledPageBytes: number; readonly pooledPageCount: number;
  readonly allocatedPageBytes: number;
  /** Target pool capacity, not an allocation. Actual arrays are pooledPageBytes. */
  readonly poolTargetPages: number; readonly poolTargetBytes: number;
  /** Physical bytes if each currently mapped logical page were independent. */
  readonly logicalPageBytes: number; readonly logicalPageReferences: number;
  /** Retained samples * each column's element width, without page slack. */
  readonly logicalSampleBytes: number;
  readonly sharedPageCount: number; readonly sharedReferences: number;
  /** Object counts only; no claim about JavaScript heap bytes. */
  readonly pageMapEntries: number;
  readonly appendCount: number; readonly appendedSamples: number; readonly discardedInputSamples: number;
  readonly pageAllocations: number; readonly poolReuses: number; readonly deduplicatedDrafts: number;
  readonly sharedInputMatches: number; readonly inputCopySkippedBytes: number;
  readonly identityInputMatches: number; readonly identityComparedBytesSkipped: number;
  readonly inputCopiedBytes: number; readonly retainedCopiedBytes: number;
  readonly comparedBytes: number; readonly pageComparisons: number;
  readonly peakStagedPageBytes: number;
}

type NumericKind = 'f64' | 'f32' | 'i8' | 'u8' | 'u8c' | 'i16' | 'u16' | 'i32' | 'u32';
interface Page {values: NumericArray; bytes: Uint8Array; words: Uint32Array; storage: NumericStorage; refs: number;}
interface Column {storage: NumericStorage; kind: NumericKind; bytesPerElement: number; pages: Map<number, Page>;}
interface Change {column: Column; pageIndex: number; page: Page;}
interface Candidate {page: Page; prefix?: Page; inputBuffer?: ArrayBufferLike; inputOffset?: number; inputBytes?: number;}
interface Counters {
  appendCount: number; appendedSamples: number; discardedInputSamples: number;
  pageAllocations: number; poolReuses: number; deduplicatedDrafts: number;
  sharedInputMatches: number; inputCopySkippedBytes: number;
  identityInputMatches: number; identityComparedBytesSkipped: number;
  inputCopiedBytes: number; retainedCopiedBytes: number; comparedBytes: number;
  pageComparisons: number; peakStagedPageBytes: number;
}
interface Transaction {
  pools: Map<NumericStorage, Page[]>;
  acquired: Set<Page>;
  buffers: Set<ArrayBufferLike>;
  inputBuffers: Set<ArrayBufferLike>;
  identitySafe: boolean;
  stagedBytes: number;
  counters: Counters;
}

function counters(): Counters {
  return {appendCount: 0, appendedSamples: 0, discardedInputSamples: 0, pageAllocations: 0,
    poolReuses: 0, deduplicatedDrafts: 0, sharedInputMatches: 0, inputCopySkippedBytes: 0,
    identityInputMatches: 0, identityComparedBytesSkipped: 0,
    inputCopiedBytes: 0, retainedCopiedBytes: 0,
    comparedBytes: 0, pageComparisons: 0, peakStagedPageBytes: 0};
}
function positive(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${label} must be a positive safe integer`);
  return value;
}
function kindOf(value: unknown): NumericKind | undefined {
  if (value instanceof Float64Array) return 'f64';
  if (value instanceof Float32Array) return 'f32';
  if (value instanceof Uint8ClampedArray) return 'u8c';
  if (value instanceof Int8Array) return 'i8';
  if (value instanceof Uint8Array) return 'u8';
  if (value instanceof Int16Array) return 'i16';
  if (value instanceof Uint16Array) return 'u16';
  if (value instanceof Int32Array) return 'i32';
  if (value instanceof Uint32Array) return 'u32';
  return undefined;
}
function byteView(value: NumericArray): Uint8Array {
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}
function inputView(value: NumericArray, from: number, count: number): NumericArray {
  const offset = value.byteOffset + from * value.BYTES_PER_ELEMENT;
  switch (kindOf(value)) {
    case 'f64': return new Float64Array(value.buffer, offset, count);
    case 'f32': return new Float32Array(value.buffer, offset, count);
    case 'u8c': return new Uint8ClampedArray(value.buffer, offset, count);
    case 'i8': return new Int8Array(value.buffer, offset, count);
    case 'u8': return new Uint8Array(value.buffer, offset, count);
    case 'i16': return new Int16Array(value.buffer, offset, count);
    case 'u16': return new Uint16Array(value.buffer, offset, count);
    case 'i32': return new Int32Array(value.buffer, offset, count);
    default: return new Uint32Array(value.buffer, offset, count);
  }
}
const builtinStorages = new Set<NumericStorage>([Float64Array, Float32Array, Int8Array, Uint8Array,
  Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array]);

/** Page sharing is limited to columns in the same store at the same absolute page.
 * It never guesses aliases from column names or from numeric equality. Candidate
 * pages are compared by their normalized typed bytes over the retained interval.
 * A transaction writes only private drafts and publishes after all conversions,
 * allocations and comparisons succeed. Existing readers therefore see the entire
 * old state if an allocator or an input getter throws. */
export class PagedColumns {
  private readonly columns = new Map<string, Column>();
  private readonly livePages = new Set<Page>();
  private readonly ownedBuffers = new Set<ArrayBufferLike>();
  private pools = new Map<NumericStorage, Page[]>();
  private readonly allocator: NonNullable<PagedColumnsOptions['allocator']>;
  private readonly fixedPoolLimit: number | undefined;
  private readonly maxPoolBytes: number;
  private readonly poolHistoryLength: number;
  private readonly userAllocator: boolean;
  private readonly poolHistory = new Map<NumericStorage, number[]>();
  private poolTargets = new Map<NumericStorage, number>();
  private readonly totals = counters();
  private schemaSnapshot: Readonly<PagedColumnsSchema>;
  private capacity: number;
  private count = 0;
  private nextIndex = 0;
  private changeRevision = 0;
  private contentEpoch = 0;
  private disposed = false;
  private pending?: symbol;
  readonly pageSize: number;

  constructor(options: PagedColumnsOptions) {
    this.capacity = positive(options.capacity, 'Capacity');
    this.pageSize = positive(options.pageSize ?? 1024, 'Page size');
    this.fixedPoolLimit = options.poolPagesPerStorage;
    if (this.fixedPoolLimit !== undefined && (!Number.isSafeInteger(this.fixedPoolLimit) || this.fixedPoolLimit < 0)) throw new RangeError('Pool limit must be a nonnegative safe integer');
    this.maxPoolBytes = positive(options.maxPoolBytesPerStorage ?? 256 * 1024, 'Pool byte bound');
    this.poolHistoryLength = positive(options.poolHistoryLength ?? 16, 'Pool history length');
    this.userAllocator = options.allocator !== undefined;
    this.allocator = options.allocator ?? ((storage, length) => new storage(length));
    if (!options.schema || typeof options.schema !== 'object' || Array.isArray(options.schema)) throw new TypeError('Column schema must be an object');
    const definitions: PagedColumnsSchema = {};
    for (const [name, definition] of Object.entries(options.schema)) {
      this.columns.set(name, this.makeColumn(definition));
      definitions[name] = Object.freeze({...definition});
    }
    this.schemaSnapshot = Object.freeze(definitions);
    this.poolTargets = this.computePoolTargets();
  }

  get schema(): Readonly<PagedColumnsSchema> {return this.schemaSnapshot;}
  get revision(): number {return this.changeRevision;}
  getSampleCount(): number {return this.count;}
  getNextSampleIndex(): number {return this.nextIndex;}
  getContentEpoch(): number {return this.contentEpoch;}
  getCapacity(): number {return this.capacity;}
  isDisposed(): boolean {return this.disposed;}
  /** Internal allocator-alias guard; constant-time, without walking page maps. */
  ownsBuffer(buffer: ArrayBufferLike): boolean {return this.ownedBuffers.has(buffer);}

  appendSamples(samples: SampleColumns): this {
    const prepared = this.prepareAppendSamples(samples);
    prepared.commit();
    return this;
  }

  /** Explicit amount supports an all-omitted paged group while affine columns
   * still advance. Capacity is committed atomically with the new page tail. */
  prepareAppendSamples(samples: SampleColumns, sampleCount?: number, capacity = this.capacity): PreparedPagedAppend {
    this.assertAlive();
    positive(capacity, 'Capacity');
    if (sampleCount !== undefined && (!Number.isSafeInteger(sampleCount) || sampleCount < 0)) throw new RangeError('Sample count must be a nonnegative safe integer');
    const identity = Symbol('paged append'), revision = this.changeRevision;
    this.pending = identity;
    try {
    if (!samples || typeof samples !== 'object' || Array.isArray(samples)) throw new TypeError('Sample columns must be an object');
    let amount: number | undefined = sampleCount;
    const inputs = new Map<string, ArrayLike<number> | undefined>();
    for (const [name, value] of Object.entries(samples)) {
      inputs.set(name, value);
      if (value === undefined) continue;
      if (!Number.isSafeInteger(value.length) || value.length < 0) throw new TypeError(`Invalid sample array: ${name}`);
      if (amount === undefined) amount = value.length;
      else if (value.length !== amount) throw new RangeError('All sample columns must have equal lengths');
    }
    amount ??= 0;
    if (!Number.isSafeInteger(this.nextIndex + amount)) throw new RangeError('Sample index exceeds the safe integer range');
    const next = this.nextIndex + amount, count = Math.min(capacity, this.count + amount), first = next - count;
    const transaction = this.transaction(inputs), changes: Change[] = [];
    const incomingFirst = Math.max(this.nextIndex, first);
    const firstPage = Math.floor(incomingFirst / this.pageSize), lastPage = Math.floor((next - 1) / this.pageSize);
    for (let pageIndex = firstPage; amount && pageIndex <= lastPage; pageIndex++) {
      const base = pageIndex * this.pageSize, begin = Math.max(first, base), end = Math.min(next, base + this.pageSize);
      const writeFirst = Math.max(incomingFirst, base), writeCount = end - writeFirst;
      const candidates = new Map<NumericStorage, Candidate[]>();
      for (const [name, column] of this.columns) {
        const oldEnd = Math.min(this.nextIndex, end);
        const old = oldEnd > begin ? column.pages.get(pageIndex) : undefined;
        if (oldEnd > begin && !old) throw new Error('Missing retained page');
        const input = inputs.get(name);
        const shared = this.matchInput(column, old, input, writeFirst - this.nextIndex, writeFirst - base, writeCount, candidates, transaction);
        if (shared) {changes.push({column, pageIndex, page: shared}); continue;}
        const draft = this.acquire(column, transaction);
        if (oldEnd > begin) {
          const byteStart = (begin - base) * column.bytesPerElement, byteEnd = (oldEnd - base) * column.bytesPerElement;
          draft.bytes.set(old!.bytes.subarray(byteStart, byteEnd), byteStart);
          transaction.counters.retainedCopiedBytes += byteEnd - byteStart;
        }
        this.copyInput(column, draft, writeFirst - base, input, writeFirst - this.nextIndex, writeCount, transaction);
        const page = this.intern(draft, candidates, begin - base, end - base, transaction, old,
          kindOf(input) === column.kind ? input as NumericArray : undefined, writeFirst - this.nextIndex, writeCount);
        changes.push({column, pageIndex, page});
      }
    }
    transaction.counters.appendCount = amount ? 1 : 0;
    transaction.counters.appendedSamples = amount;
    transaction.counters.discardedInputSamples = Math.max(0, amount - capacity);
    let active = true;
    return {sampleCount: count, nextIndex: next, capacity,
      commit: () => {
        if (!active) throw new Error('Paged append transaction is no longer active');
        if (this.pending !== identity || this.disposed || this.changeRevision !== revision) throw new Error('Paged append transaction is stale');
        try {
          if (amount || capacity !== this.capacity) {
            this.capacity = capacity;
            this.publish(changes, transaction, first, next, count);
          }
        } finally {active = false; this.pending = undefined;}
      },
      abort: () => {if (active) {active = false; if (this.pending === identity) this.pending = undefined;}},
    };
    } catch (error) {this.pending = undefined; throw error;}
  }

  /** Growing the limit does not allocate unwritten pages. Shrinking discards only
   * the oldest logical samples; retained pages keep their absolute addresses. */
  resize(capacity: number): this {
    this.assertAlive(); positive(capacity, 'Capacity');
    if (capacity === this.capacity) return this;
    const count = Math.min(this.count, capacity), first = this.nextIndex - count;
    this.evictBefore(first, this.pools);
    this.capacity = capacity; this.count = count; this.poolTargets = this.computePoolTargets();
    this.trimPools(this.pools, this.poolTargets); this.changeRevision++;
    return this;
  }

  /** New columns contain the same typed NaN/zero fill as an omitted append column.
   * Existing schema entries and the old frozen schema snapshot are untouched. */
  addColumns(schema: PagedColumnsSchema): this {
    this.assertAlive();
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) throw new TypeError('Column schema must be an object');
    const additions = new Map<string, Column>(), definitions: PagedColumnsSchema = {...this.schemaSnapshot};
    for (const [name, definition] of Object.entries(schema)) {
      if (this.columns.has(name)) continue;
      additions.set(name, this.makeColumn(definition)); definitions[name] = Object.freeze({...definition});
    }
    if (!additions.size) return this;
    const snapshot = Object.freeze(definitions), transaction = this.transaction(new Map()), changes: Change[] = [];
    const first = this.nextIndex - this.count;
    for (let pageIndex = Math.floor(first / this.pageSize); this.count && pageIndex <= Math.floor((this.nextIndex - 1) / this.pageSize); pageIndex++) {
      const base = pageIndex * this.pageSize, begin = Math.max(first, base) - base, end = Math.min(this.nextIndex, base + this.pageSize) - base;
      const candidates = new Map<NumericStorage, Candidate[]>();
      for (const column of this.columns.values()) {
        const old = column.pages.get(pageIndex);
        if (!old) throw new Error('Missing retained page');
        const pages = candidates.get(column.storage) ?? [];
        if (!pages.some(candidate => candidate.page === old)) pages.push({page: old, prefix: old});
        candidates.set(column.storage, pages);
      }
      for (const column of additions.values()) {
        const draft = this.acquire(column, transaction);
        this.copyInput(column, draft, begin, undefined, 0, end - begin, transaction);
        changes.push({column, pageIndex, page: this.intern(draft, candidates, begin, end, transaction)});
      }
    }
    // Publication contains no calls into user code. Conversion/allocator failures
    // above cannot publish even one of the additional columns.
    for (const [name, column] of additions) this.columns.set(name, column);
    this.schemaSnapshot = snapshot;
    this.publish(changes, transaction, first, this.nextIndex, this.count);
    return this;
  }

  /** Representation promotion detaches only this logical column. Other columns
   * keep shared page references; live data is not copied or changed here. */
  removeColumn(name: string): this {
    this.assertAlive();
    const column = this.columns.get(name);
    if (!column) return this;
    const snapshot = Object.freeze(Object.fromEntries(Object.entries(this.schemaSnapshot).filter(([key]) => key !== name)));
    this.columns.delete(name); this.schemaSnapshot = snapshot;
    const targets = this.computePoolTargets();
    for (const page of column.pages.values()) this.release(page, this.pools, targets);
    column.pages.clear(); this.poolTargets = targets; this.trimPools(this.pools, targets); this.changeRevision++;
    return this;
  }

  getValue(name: string, retainedOffset: number): number | undefined {
    const column = this.columns.get(name);
    if (!column || !Number.isSafeInteger(retainedOffset) || retainedOffset < 0 || retainedOffset >= this.count) return undefined;
    const absolute = this.nextIndex - this.count + retainedOffset, pageIndex = Math.floor(absolute / this.pageSize);
    const page = column.pages.get(pageIndex);
    if (!page) throw new Error('Missing retained page');
    return page.values[absolute - pageIndex * this.pageSize];
  }

  /** Independent caller-owned snapshot; copying typed bytes preserves NaN payloads. */
  readColumn(name: string, from = 0, count = this.count - from): NumericArray {
    const column = this.requireColumn(name);
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(count) || from < 0 || count < 0 || from + count > this.count) throw new RangeError('Read range is outside retained samples');
    const output = new column.storage(count);
    if (kindOf(output) !== column.kind || output.length !== count || output.byteOffset !== 0 || output.buffer.byteLength !== output.byteLength
      || count && this.ownedBuffers.has(output.buffer)) throw new TypeError('Snapshot storage must allocate an independent numeric array');
    const bytes = byteView(output);
    let index = this.nextIndex - this.count + from, written = 0;
    while (written < count) {
      const pageIndex = Math.floor(index / this.pageSize), offset = index - pageIndex * this.pageSize;
      const page = column.pages.get(pageIndex);
      if (!page) throw new Error('Missing retained page');
      const length = Math.min(count - written, this.pageSize - offset), width = column.bytesPerElement;
      bytes.set(page.bytes.subarray(offset * width, (offset + length) * width), written * width);
      index += length; written += length;
    }
    return output;
  }

  getColumnView(name: string): PagedColumnView {
    const column = this.requireColumn(name), revision = this.changeRevision;
    const first = this.nextIndex - this.count, next = this.nextIndex, pageSize = this.pageSize;
    return Object.freeze({kind: 'paged' as const, firstIndex: first, count: this.count, pageSize,
      revision, storage: column.storage, bytesPerElement: column.bytesPerElement,
      getPage: (pageIndex: number): NumericArray | undefined => {
        if (this.disposed || revision !== this.changeRevision) throw new Error('Paged column view was invalidated by a mutation');
        if (!Number.isSafeInteger(pageIndex) || pageIndex < 0 || !this.count || pageIndex < Math.floor(first / pageSize) || pageIndex > Math.floor((next - 1) / pageSize)) return undefined;
        const page = column.pages.get(pageIndex);
        if (!page) throw new Error('Missing retained page');
        return page.values;
      }});
  }

  getStorageStats(): PagedColumnsStats {
    let uniquePageBytes = 0, pooledPageBytes = 0, pooledPageCount = 0;
    let logicalPageBytes = 0, logicalPageReferences = 0, logicalSampleBytes = 0, sharedPageCount = 0, sharedReferences = 0;
    for (const page of this.livePages) {
      uniquePageBytes += page.values.byteLength;
      if (page.refs > 1) {sharedPageCount++; sharedReferences += page.refs - 1;}
    }
    for (const pages of this.pools.values()) for (const page of pages) {pooledPageCount++; pooledPageBytes += page.values.byteLength;}
    for (const column of this.columns.values()) {
      logicalPageReferences += column.pages.size;
      logicalPageBytes += column.pages.size * this.pageSize * column.bytesPerElement;
      logicalSampleBytes += this.count * column.bytesPerElement;
    }
    let poolTargetPages = 0, poolTargetBytes = 0;
    for (const [storage, target] of this.poolTargets) {
      const column = [...this.columns.values()].find(column => column.storage === storage)!;
      poolTargetPages += target; poolTargetBytes += target * this.pageSize * column.bytesPerElement;
    }
    return {capacity: this.capacity, sampleCount: this.count, firstIndex: this.nextIndex - this.count,
      nextIndex: this.nextIndex, pageSize: this.pageSize, columnCount: this.columns.size,
      uniquePageBytes, uniquePageCount: this.livePages.size, pooledPageBytes, pooledPageCount,
      allocatedPageBytes: uniquePageBytes + pooledPageBytes, poolTargetPages, poolTargetBytes, logicalPageBytes, logicalPageReferences,
      logicalSampleBytes, sharedPageCount, sharedReferences, pageMapEntries: logicalPageReferences, ...this.totals};
  }

  clear(): this {
    this.assertAlive();
    for (const column of this.columns.values()) {
      for (const page of column.pages.values()) this.release(page, this.pools);
      column.pages.clear();
    }
    this.nextIndex = 0; this.count = 0; this.poolHistory.clear(); this.poolTargets = this.computePoolTargets();
    this.trimPools(this.pools, this.poolTargets); this.contentEpoch++; this.changeRevision++;
    return this;
  }

  dispose(): this {
    if (this.disposed) return this;
    if (this.pending) throw new Error('Paged column mutation is already in progress');
    this.disposed = true;
    for (const column of this.columns.values()) column.pages.clear();
    this.livePages.clear(); this.pools.clear(); this.ownedBuffers.clear(); this.poolHistory.clear(); this.poolTargets.clear();
    this.capacity = 0; this.count = 0; this.nextIndex = 0; this.contentEpoch++; this.changeRevision++;
    return this;
  }

  private assertAlive(): void {
    if (this.disposed) throw new Error('PagedColumns is disposed');
    if (this.pending) throw new Error('Paged column mutation is already in progress');
  }
  private requireColumn(name: string): Column {
    const column = this.columns.get(name);
    if (!column) throw new RangeError(`Unknown data column: ${name}`);
    return column;
  }
  private makeColumn(definition: PagedColumnDefinition): Column {
    if (!definition || typeof definition !== 'object' || Array.isArray(definition)) throw new TypeError('Invalid column definition');
    const storage = definition.storage ?? Float64Array, empty = new storage(0), kind = kindOf(empty);
    if (!kind || empty.length !== 0) throw new TypeError('Storage must create a numeric typed array');
    return {storage, kind, bytesPerElement: empty.BYTES_PER_ELEMENT, pages: new Map()};
  }
  private transaction(inputs: Map<string, ArrayLike<number> | undefined>): Transaction {
    const pools = new Map<NumericStorage, Page[]>();
    for (const [storage, pages] of this.pools) pools.set(storage, pages.slice());
    const inputBuffers = new Set<ArrayBufferLike>();
    let identitySafe = !this.userAllocator;
    for (const column of this.columns.values()) if (!builtinStorages.has(column.storage)) identitySafe = false;
    for (const input of inputs.values()) {
      if (input === undefined) continue;
      if (kindOf(input)) {
        const buffer = (input as NumericArray).buffer; inputBuffers.add(buffer);
        if (typeof SharedArrayBuffer !== 'undefined' && buffer instanceof SharedArrayBuffer) identitySafe = false;
      } else identitySafe = false;
    }
    return {pools, acquired: new Set(), buffers: new Set(), inputBuffers, identitySafe, stagedBytes: 0, counters: counters()};
  }
  private acquire(column: Column, transaction: Transaction): Page {
    const free = transaction.pools.get(column.storage);
    let page: Page | undefined;
    // Even a previously borrowed page may later be supplied as an input array.
    // Do not overwrite any supplied input while borrowing reusable scratch.
    if (free) for (let i = free.length - 1; i >= 0; i--) {
      if (transaction.inputBuffers.has(free[i].values.buffer)) continue;
      page = free.splice(i, 1)[0]; break;
    }
    if (page) transaction.counters.poolReuses++;
    else {
      const values = this.allocator(column.storage, this.pageSize);
      if (kindOf(values) !== column.kind || values.length !== this.pageSize || values.byteOffset !== 0 || values.buffer.byteLength !== values.byteLength || (typeof SharedArrayBuffer !== 'undefined' && values.buffer instanceof SharedArrayBuffer)) throw new TypeError('Allocator must return an exclusively owned typed page');
      if (this.ownedBuffers.has(values.buffer) || transaction.buffers.has(values.buffer) || transaction.inputBuffers.has(values.buffer)) throw new TypeError('Allocator reused a live, scratch or input buffer');
      const bytes = byteView(values);
      page = {values, bytes, words: new Uint32Array(values.buffer, 0, Math.floor(bytes.length / 4)), storage: column.storage, refs: 0};
      transaction.buffers.add(values.buffer); transaction.counters.pageAllocations++;
    }
    if (!transaction.acquired.has(page)) {
      transaction.acquired.add(page); transaction.stagedBytes += page.values.byteLength;
      transaction.counters.peakStagedPageBytes = Math.max(transaction.counters.peakStagedPageBytes, transaction.stagedBytes);
    }
    return page;
  }
  private copyInput(column: Column, target: Page, at: number, input: ArrayLike<number> | undefined, from: number, count: number, transaction: Transaction): void {
    if (input === undefined) target.values.fill(NaN, at, at + count);
    else if (kindOf(input) === column.kind) {
      const source = input as NumericArray, width = column.bytesPerElement;
      target.bytes.set(new Uint8Array(source.buffer, source.byteOffset + from * width, count * width), at * width);
    } else if (kindOf(input)) Float64Array.prototype.set.call(target.values, inputView(input as NumericArray, from, count), at);
    else for (let i = 0; i < count; i++) target.values[at + i] = input[from + i];
    transaction.counters.inputCopiedBytes += count * column.bytesPerElement;
  }
  /** A shared old prefix is already byte-identical. Compare only the incoming
   * typed span before acquiring another draft; equal data is then written once.
   * Ordinary arrays/conversions still take the staged conversion path. Mutable
   * shared-memory input is excluded from this optimization. */
  private matchInput(column: Column, prefix: Page | undefined, input: ArrayLike<number> | undefined,
    from: number, at: number, count: number, candidates: Map<NumericStorage, Candidate[]>, transaction: Transaction): Page | undefined {
    const pages = candidates.get(column.storage);
    if (!pages?.length || kindOf(input) !== column.kind) return undefined;
    const typed = input as NumericArray;
    if (typeof SharedArrayBuffer !== 'undefined' && typed.buffer instanceof SharedArrayBuffer) return undefined;
    for (const candidate of pages) {
      if (candidate.prefix !== prefix) continue;
      const inputOffset = typed.byteOffset + from * column.bytesPerElement, inputBytes = count * column.bytesPerElement;
      const identity = transaction.identitySafe && candidate.inputBuffer === typed.buffer && candidate.inputOffset === inputOffset && candidate.inputBytes === inputBytes;
      if (!identity && !this.equalInputBytes(typed, from * column.bytesPerElement, candidate.page, at * column.bytesPerElement, inputBytes, transaction)) continue;
      if (identity) {transaction.counters.identityInputMatches++; transaction.counters.identityComparedBytesSkipped += inputBytes;}
      transaction.counters.sharedInputMatches++;
      transaction.counters.inputCopySkippedBytes += count * column.bytesPerElement;
      return candidate.page;
    }
    return undefined;
  }
  private equalInputBytes(input: NumericArray, from: number, target: Page, at: number, length: number, transaction: Transaction): boolean {
    transaction.counters.pageComparisons++;
    const byteStart = input.byteOffset + from;
    if (byteStart % 4 === 0 && at % 4 === 0 && length % 4 === 0) {
      const words = new Uint32Array(input.buffer, byteStart, length / 4), targetStart = at / 4;
      for (let i = 0; i < words.length; i++) if (words[i] !== target.words[targetStart + i]) {
        transaction.counters.comparedBytes += (i + 1) * 4; return false;
      }
    } else {
      const source = new Uint8Array(input.buffer, byteStart, length);
      for (let i = 0; i < length; i++) if (source[i] !== target.bytes[at + i]) {
        transaction.counters.comparedBytes += i + 1; return false;
      }
    }
    transaction.counters.comparedBytes += length;
    return true;
  }
  private intern(draft: Page, candidates: Map<NumericStorage, Candidate[]>, begin: number, end: number, transaction: Transaction,
    prefix?: Page, input?: NumericArray, inputFrom = 0, inputCount = 0): Page {
    const pages = candidates.get(draft.storage) ?? [], width = draft.values.BYTES_PER_ELEMENT;
    for (const {page} of pages) if (this.equalBytes(draft, page, begin * width, end * width, transaction)) {
      const free = transaction.pools.get(draft.storage) ?? [];
      free.push(draft); transaction.pools.set(draft.storage, free);
      transaction.counters.deduplicatedDrafts++;
      return page;
    }
    pages.push({page: draft, prefix, ...(transaction.identitySafe && input ? {inputBuffer: input.buffer,
      inputOffset: input.byteOffset + inputFrom * width, inputBytes: inputCount * width} : {})});
    candidates.set(draft.storage, pages); return draft;
  }
  private equalBytes(a: Page, b: Page, begin: number, end: number, transaction: Transaction): boolean {
    transaction.counters.pageComparisons++;
    let i = begin;
    while (i < end && i % 4) {
      if (a.bytes[i] !== b.bytes[i]) {transaction.counters.comparedBytes += i - begin + 1; return false;}
      i++;
    }
    for (; i + 4 <= end; i += 4) {
      if (a.words[i / 4] !== b.words[i / 4]) {transaction.counters.comparedBytes += i - begin + 4; return false;}
    }
    for (; i < end; i++) {
      if (a.bytes[i] !== b.bytes[i]) {transaction.counters.comparedBytes += i - begin + 1; return false;}
    }
    transaction.counters.comparedBytes += end - begin;
    return true;
  }
  private publish(changes: Change[], transaction: Transaction, first: number, next: number, count: number): void {
    const drafts = new Map<NumericStorage, number>();
    for (const page of transaction.acquired) drafts.set(page.storage, (drafts.get(page.storage) ?? 0) + 1);
    const targets = this.computePoolTargets(transaction.counters.appendCount ? drafts : undefined);
    // No user callbacks or typed allocations after this point.
    for (const {column, pageIndex, page} of changes) {
      const old = column.pages.get(pageIndex);
      if (page === old) continue;
      page.refs++; this.livePages.add(page); this.ownedBuffers.add(page.values.buffer); column.pages.set(pageIndex, page);
      if (old) this.release(old, transaction.pools, targets);
    }
    this.evictBefore(first, transaction.pools, targets);
    this.trimPools(transaction.pools, targets);
    for (const pages of transaction.pools.values()) for (const page of pages) this.ownedBuffers.add(page.values.buffer);
    if (transaction.counters.appendCount) for (const [storage, value] of drafts) {
      const history = this.poolHistory.get(storage) ?? [];
      if (history.length === this.poolHistoryLength) history.shift();
      history.push(value); this.poolHistory.set(storage, history);
    }
    this.pools = transaction.pools; this.poolTargets = targets;
    for (const key of Object.keys(this.totals) as (keyof Counters)[]) {
      if (key === 'peakStagedPageBytes') this.totals[key] = Math.max(this.totals[key], transaction.counters[key]);
      else this.totals[key] += transaction.counters[key];
    }
    this.nextIndex = next; this.count = count; this.changeRevision++;
  }
  private release(page: Page, pools: Map<NumericStorage, Page[]>, targets = this.poolTargets): void {
    page.refs--;
    if (page.refs < 0) throw new Error('Invalid page reference count');
    if (page.refs) return;
    this.livePages.delete(page);
    const free = pools.get(page.storage) ?? [];
    if (free.length < (targets.get(page.storage) ?? 0)) {free.push(page); pools.set(page.storage, free);}
    else this.ownedBuffers.delete(page.values.buffer);
  }
  private evictBefore(first: number, pools: Map<NumericStorage, Page[]>, targets = this.poolTargets): void {
    if (!this.count) return;
    const oldFirstPage = Math.floor((this.nextIndex - this.count) / this.pageSize);
    const oldLastPage = Math.floor((this.nextIndex - 1) / this.pageSize), newFirstPage = Math.floor(first / this.pageSize);
    for (let pageIndex = oldFirstPage; pageIndex <= Math.min(oldLastPage, newFirstPage - 1); pageIndex++) {
      for (const column of this.columns.values()) {
        const page = column.pages.get(pageIndex);
        if (!page) continue;
        column.pages.delete(pageIndex); this.release(page, pools, targets);
      }
    }
  }
  /** Bounded metadata only: at most poolHistoryLength numbers per constructor.
   * No retained-page map or history samples are copied or traversed here. */
  private computePoolTargets(incoming?: Map<NumericStorage, number>): Map<NumericStorage, number> {
    const groups = new Map<NumericStorage, {count: number; width: number}>();
    for (const column of this.columns.values()) {
      const group = groups.get(column.storage) ?? {count: 0, width: column.bytesPerElement};
      group.count++; groups.set(column.storage, group);
    }
    const targets = new Map<NumericStorage, number>();
    for (const [storage, group] of groups) {
      if (this.fixedPoolLimit !== undefined) {targets.set(storage, this.fixedPoolLimit); continue;}
      const history = this.poolHistory.get(storage) ?? [], value = incoming?.get(storage);
      let maximum = value ?? 0;
      const skip = value !== undefined && history.length === this.poolHistoryLength ? 1 : 0;
      for (let i = skip; i < history.length; i++) maximum = Math.max(maximum, history[i]);
      const byteBound = Math.floor(this.maxPoolBytes / (this.pageSize * group.width));
      const capacityBound = (Math.ceil(this.capacity / this.pageSize) + 1) * group.count;
      targets.set(storage, Math.min(byteBound, capacityBound, maximum + group.count));
    }
    return targets;
  }
  private trimPools(pools: Map<NumericStorage, Page[]>, targets: Map<NumericStorage, number>): void {
    for (const [storage, pages] of pools) {
      const limit = targets.get(storage) ?? 0;
      for (let i = limit; i < pages.length; i++) this.ownedBuffers.delete(pages[i].values.buffer);
      if (pages.length > limit) pages.length = limit;
      if (!pages.length) pools.delete(storage);
    }
  }
}

/** Cursor holds one page span at a time. Seek uses a direct absolute-page lookup;
 * next advances to the following span. It allocates no object for each sample. */
export class PagedColumnCursor {
  values: NumericArray | undefined;
  absoluteIndex = 0;
  offset = 0;
  length = 0;
  constructor(readonly view: PagedColumnView, absoluteIndex = view.firstIndex) {this.seek(absoluteIndex);}
  seek(absoluteIndex: number): boolean {
    this.absoluteIndex = absoluteIndex; this.offset = 0; this.length = 0; this.values = undefined;
    if (!Number.isSafeInteger(absoluteIndex) || absoluteIndex < this.view.firstIndex || absoluteIndex >= this.view.firstIndex + this.view.count) return false;
    const pageIndex = Math.floor(absoluteIndex / this.view.pageSize), values = this.view.getPage(pageIndex);
    if (!values) throw new Error('Missing retained page');
    this.values = values; this.offset = absoluteIndex - pageIndex * this.view.pageSize;
    this.length = Math.min(this.view.pageSize - this.offset, this.view.firstIndex + this.view.count - absoluteIndex);
    return true;
  }
  next(): boolean {return this.seek(this.absoluteIndex + this.length);}
}

export function readPagedValue(view: PagedColumnView, absoluteIndex: number): number | undefined {
  if (!Number.isSafeInteger(absoluteIndex) || absoluteIndex < view.firstIndex || absoluteIndex >= view.firstIndex + view.count) return undefined;
  const pageIndex = Math.floor(absoluteIndex / view.pageSize), page = view.getPage(pageIndex);
  if (!page) throw new Error('Missing retained page');
  return page[absoluteIndex - pageIndex * view.pageSize];
}
