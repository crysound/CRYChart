import {beginSourceAppend, commitSourceChange, invalidateSourceCertificate, type AppendTicket, type SourceHeader} from './line-delta-certificate.js';
import { EventHub, type EventToken } from './events.js';
import {PagedColumns, type PagedColumnView, type PagedColumnsOptions} from './paged-columns.js';

export type NumericArray = Float32Array | Float64Array | Int8Array | Uint8Array | Uint8ClampedArray | Int16Array | Uint16Array | Int32Array | Uint32Array;
export interface NumericStorage { new(length: number): NumericArray; }
export interface DataColumnSchema {
  storage?: NumericStorage;
  pattern?: 'progressive' | 'regressive' | string | null;
  auto?: boolean;
  [key: string]: unknown;
}
export type DataSetSchema = Record<string, DataColumnSchema>;
export interface PagedDataStorageOptions {
  mode: 'paged'; pageSize?: number; maxPoolBytesPerStorage?: number;
  poolPagesPerStorage?: number; poolHistoryLength?: number;
}
export interface DataSetXYOptions { schema?: DataSetSchema; includesNaN?: boolean; columnStorage?: PagedDataStorageOptions; }
export type SampleColumns = Record<string, ArrayLike<number> | undefined>;
export interface AppendSamplesOptions { start?: number; step?: number; }
export type MaxSampleCount = number | {mode: 'auto'; initial?: number; max?: number} | undefined | null;
export interface ReadBackOptions { onlyInRange?: {key?: string | number; start: number; end: number}; }
export interface DataSetReadBack { data: Record<string, NumericArray>; iSampleFirst: number; }
/** A retained part of this batch evaluates as start + (absoluteIndex - firstIndex) * step.
 * Batch origins are deliberately never rebased: floating-point reassociation loses bits.
 */
export interface AffineColumnRun { readonly firstIndex: number; readonly count: number; readonly start: number; readonly step: number; }
/** Internal borrowed storage view. All indices are absolute logical sample indices.
 * Clip affine runs to [firstIndex, firstIndex + count); runStart skips expired runs.
 * A data-set mutation invalidates the view. Reading it does not materialize automatic X.
 */
export type DataColumnRuns =
  | {kind: 'dense'; firstIndex: number; count: number; slices: readonly NumericArray[]}
  | {kind: 'affine'; firstIndex: number; count: number; runs: readonly AffineColumnRun[]; runStart: number}
  | PagedColumnView;
/** Storage directly held by this data set, excluding caller-held readbacks, renderer
 * buffers and JavaScript heap overhead. These numbers are not process RSS.
 */
export interface DataSetStorageStats {
  readonly sampleCount: number; readonly capacity: number;
  readonly denseTypedArrayBytes: number; readonly snapshotBytes: number;
  /** Includes expired run objects waiting for amortized prefix cleanup. */
  readonly affineRunCount: number; readonly liveAffineRunCount: number;
  readonly autoColumnCount: number; readonly affineColumnCount: number; readonly denseColumnCount: number;
  readonly pagedColumnCount: number; readonly pagedUniqueBytes: number; readonly pagedPoolBytes: number;
  readonly pagedLogicalBytes: number; readonly pagedLogicalPageBytes: number; readonly pagedPageReferences: number;
  readonly pagedPromotionCount: number; readonly ownedNumericBytes: number;
}
interface Column {
  schema: DataColumnSchema; storage: NumericStorage; values: NumericArray;
  runs?: AffineColumnRun[]; runStart: number; autoLast?: number; autoStep: number;
  paged?: string;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${name} must be a positive safe integer`);
  return value;
}

function emptyArray(values: NumericArray): NumericArray {
  if (values instanceof Float64Array) return new Float64Array(0);
  if (values instanceof Float32Array) return new Float32Array(0);
  if (values instanceof Uint8ClampedArray) return new Uint8ClampedArray(0);
  if (values instanceof Int8Array) return new Int8Array(0);
  if (values instanceof Uint8Array) return new Uint8Array(0);
  if (values instanceof Int16Array) return new Int16Array(0);
  if (values instanceof Uint16Array) return new Uint16Array(0);
  if (values instanceof Int32Array) return new Int32Array(0);
  return new Uint32Array(0);
}

/** Built-in views avoid invoking a user storage subclass through Symbol.species. */
function numericView(values: NumericArray, start: number, count: number): NumericArray {
  const offset = values.byteOffset + start * values.BYTES_PER_ELEMENT;
  if (values instanceof Float64Array) return new Float64Array(values.buffer, offset, count);
  if (values instanceof Float32Array) return new Float32Array(values.buffer, offset, count);
  if (values instanceof Uint8ClampedArray) return new Uint8ClampedArray(values.buffer, offset, count);
  if (values instanceof Int8Array) return new Int8Array(values.buffer, offset, count);
  if (values instanceof Uint8Array) return new Uint8Array(values.buffer, offset, count);
  if (values instanceof Int16Array) return new Int16Array(values.buffer, offset, count);
  if (values instanceof Uint16Array) return new Uint16Array(values.buffer, offset, count);
  if (values instanceof Int32Array) return new Int32Array(values.buffer, offset, count);
  return new Uint32Array(values.buffer, offset, count);
}

interface DenseAppendPlan {
  column: Column; replacement?: NumericArray;
  writes: Array<{target: Uint8Array; source: Uint8Array}>;
}

/**
 * Columnar ring storage with a logical sample index independent of physical capacity.
 * Appends write at most the retained tail, so oversized batches do not allocate rows.
 * Data belongs to the data set; attaching or disposing a series does not own it.
 */
export class DataSetXY {
  private schemaSnapshot: Readonly<DataSetSchema>;
  readonly includesNaN: boolean;
  private readonly columns = new Map<string, Column>();
  private readonly events = new EventHub();
  private readonly snapshots = new Map<string, NumericArray>();
  private allocation = 0;
  private head = 0;
  private count = 0;
  private nextIndex = 0;
  private changeRevision = 0;
  private contentEpoch = 0;
  private mode: 'unbounded' | 'fixed' | 'auto' = 'unbounded';
  private maxLimit = Infinity;
  private disposed = false;
  private readonly pagedOptions?: Readonly<PagedDataStorageOptions>;
  private paged?: PagedColumns;
  private pagedPromotionCount = 0;
  private inMutation = false;
  private deferredChange = false;

  constructor(options: DataSetXYOptions = {}) {
    if (options.columnStorage !== undefined) {
      if (options.columnStorage?.mode !== 'paged') throw new TypeError('Unknown column storage mode');
      this.pagedOptions = Object.freeze({...options.columnStorage});
    }
    const schema = options.schema ?? {x: {storage: Float64Array}, y: {storage: Float64Array}};
    this.schemaSnapshot = Object.freeze(Object.fromEntries(Object.entries(schema).map(([name, value]) => [name, Object.freeze({...value})])));
    this.includesNaN = options.includesNaN ?? true;
    for (const [name, columnSchema] of Object.entries(this.schema)) {
      const storage = columnSchema.storage ?? Float64Array;
      this.columns.set(name, {schema: columnSchema, storage, values: new storage(0),
        ...(columnSchema.auto && storage === Float64Array ? {runs: []} : {}),
        ...(this.pagedOptions && !columnSchema.auto ? {paged: name} : {}), runStart: 0, autoStep: 1});
    }
    if (this.pagedOptions) this.paged = new PagedColumns({...this.pagedOptions, capacity: 1,
      schema: Object.fromEntries([...this.columns].filter(([, column]) => column.paged !== undefined).map(([name, column]) => [name, {storage: column.storage}]))});
  }

  get revision(): number { return this.changeRevision; }
  get schema(): Readonly<DataSetSchema> { return this.schemaSnapshot; }
  /** Renderer access includes automatically generated, non-input coordinates. */
  hasColumn(name: string): boolean { return this.columns.has(name); }
  get version(): number { return this.changeRevision; }
  getSampleCount(): number { return this.count; }
  getNextSampleIndex(): number { return this.nextIndex; }
  /** Changes when existing logical sample identities are reset or destroyed.
   * Appends, capacity changes and additional columns preserve retained identities.
   */
  getContentEpoch(): number { return this.contentEpoch; }
  getMaxSampleCount(): number | undefined { return this.mode === 'unbounded' ? undefined : this.mode === 'fixed' ? this.maxLimit : this.allocation; }
  getStorageStats(): DataSetStorageStats {
    let denseTypedArrayBytes = 0, snapshotBytes = 0, affineRunCount = 0, liveAffineRunCount = 0;
    let autoColumnCount = 0, affineColumnCount = 0, denseColumnCount = 0, pagedColumnCount = 0;
    for (const column of this.columns.values()) {
      denseTypedArrayBytes += column.values.byteLength;
      if (column.schema.auto) autoColumnCount++;
      if (column.runs) {
        affineColumnCount++; affineRunCount += column.runs.length; liveAffineRunCount += column.runs.length - column.runStart;
      } else if (column.paged !== undefined) pagedColumnCount++; else denseColumnCount++;
    }
    for (const snapshot of this.snapshots.values()) snapshotBytes += snapshot.byteLength;
    const pages = this.paged?.getStorageStats();
    const pagedUniqueBytes = pages?.uniquePageBytes ?? 0, pagedPoolBytes = pages?.pooledPageBytes ?? 0;
    return {sampleCount: this.count, capacity: this.allocation, denseTypedArrayBytes, snapshotBytes,
      affineRunCount, liveAffineRunCount, autoColumnCount, affineColumnCount, denseColumnCount, pagedColumnCount,
      pagedUniqueBytes, pagedPoolBytes, pagedLogicalBytes: pages?.logicalSampleBytes ?? 0,
      pagedLogicalPageBytes: pages?.logicalPageBytes ?? 0, pagedPageReferences: pages?.logicalPageReferences ?? 0,
      pagedPromotionCount: this.pagedPromotionCount, ownedNumericBytes: denseTypedArrayBytes + pagedUniqueBytes + pagedPoolBytes + snapshotBytes};
  }
  getSchema(): DataSetSchema { return Object.fromEntries(Object.entries(this.schema).map(([key, value]) => [key, {...value}])); }
  /** Internal automatic series coordinate, kept out of the raw input schema.
   * Enable before the first append so each batch retains its own start and step.
   */
  enableImplicitXColumn(): void {
    this.assertAlive();
    if (this.columns.has('_auto')) return;
    if (this.nextIndex !== 0) throw new RangeError('Implicit X must be enabled before adding samples');
    this.columns.set('_auto', {schema: Object.freeze({auto:true,pattern:'progressive'}),
      storage:Float64Array,values:new Float64Array(0),runs:[],runStart:0,autoStep:1});
  }
  onChange(listener: (dataSet: DataSetXY) => void): EventToken { return this.events.on('change', listener); }
  offChange(token: EventToken): boolean { return this.events.off('change', token); }

  /** CRYChart extension: allocate only new columns without disturbing retained samples.
   * Existing column definitions remain unchanged. An all-existing request is a no-op.
   * Allocate the complete addition before committing so allocation failures are atomic.
   */
  addColumns(schema: DataSetSchema): this {
    this.assertAlive();
    return this.pagedOptions ? this.mutateAtomically(() => this.addColumnsInternal(schema)) : this.addColumnsInternal(schema);
  }
  private addColumnsInternal(schema: DataSetSchema): this {
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) throw new TypeError('Column schema must be an object');
    const added = new Map<string, Column>();
    const allocated = this.pagedOptions ? new Set<ArrayBufferLike>() : undefined;
    for (const [name, definition] of Object.entries(schema)) {
      if (this.columns.has(name)) continue;
      if (!definition || typeof definition !== 'object' || Array.isArray(definition)) throw new TypeError(`Invalid schema for column ${name}`);
      const snapshot = Object.freeze({...definition}), storage = snapshot.storage ?? Float64Array;
      // An added column with existing rows must preserve its historical NaN fill.
      const affine = snapshot.auto && storage === Float64Array && this.count === 0;
      const paged = !!this.pagedOptions && !snapshot.auto;
      const capacity = affine || paged ? 0 : this.allocation, values = new storage(capacity);
      if (this.pagedOptions) this.assertPrivateAllocation(values, capacity, allocated);
      if (!ArrayBuffer.isView(values) || values instanceof DataView || !('subarray' in values) || values instanceof BigInt64Array || values instanceof BigUint64Array) throw new TypeError('Column storage must create a numeric typed array');
      if (values.length !== capacity) throw new RangeError('Column storage returned an unexpected capacity');
      if (values instanceof Float32Array || values instanceof Float64Array) values.fill(NaN);
      added.set(name, {schema: snapshot, storage, values, ...(affine ? {runs: []} : {}), ...(paged ? {paged: name} : {}), runStart: 0, autoStep: 1});
    }
    if (!added.size) return this;
    const nextSchema = Object.freeze(Object.fromEntries([...Object.entries(this.schemaSnapshot), ...[...added].map(([name, column]) => [name, column.schema])]));
    if (this.paged) this.paged.addColumns(Object.fromEntries([...added].filter(([, column]) => column.paged !== undefined).map(([name, column]) => [name, {storage: column.storage}])));
    for (const [name, column] of added) this.columns.set(name, column);
    this.schemaSnapshot = nextSchema; this.changed(); return this;
  }

  setMaxSampleCount(value?: MaxSampleCount): this {
    this.assertAlive();
    return this.pagedOptions ? this.mutateAtomically(() => this.setMaxSampleCountInternal(value)) : this.setMaxSampleCountInternal(value);
  }
  private setMaxSampleCountInternal(value?: MaxSampleCount): this {
    if (value == null || value === Infinity) {
      if (this.mode !== 'unbounded') { this.mode = 'unbounded'; this.maxLimit = Infinity; this.changed(); }
      return this;
    }
    if (typeof value === 'number') {
      positiveInteger(value, 'Maximum sample count');
      const changed = this.mode !== 'fixed' || this.maxLimit !== value;
      this.resize(value);
      this.mode = 'fixed'; this.maxLimit = value;
      if (changed) this.changed();
      return this;
    }
    if (value.mode !== 'auto') throw new TypeError('Unknown sample allocation mode');
    const max = value.max === undefined || value.max === Infinity ? Infinity : positiveInteger(value.max, 'Maximum sample count');
    const initial = value.initial === undefined ? Math.max(1, this.allocation) : positiveInteger(value.initial, 'Initial sample count');
    const capacity = Math.min(max, Math.max(initial, this.count));
    this.resize(capacity);
    this.mode = 'auto'; this.maxLimit = max;
    this.changed();
    return this;
  }

  appendSamples(samples: SampleColumns, options: AppendSamplesOptions = {}): this {
    this.assertAlive();
    const ticket = beginSourceAppend(this, this.deltaSourceHeader());
    try {return this.appendCertified(samples, options, ticket);}
    catch (error) {invalidateSourceCertificate(this, this.deltaSourceHeader(), 'append-failed-or-listener-threw'); throw error;}
  }
  private appendCertified(samples: SampleColumns, options: AppendSamplesOptions, ticket: AppendTicket): this {
    if (this.pagedOptions) return this.mutateAtomically(() => this.appendPaged(samples, options, ticket));
    const amount = this.validateAppend(samples, options, this.nextIndex);
    if (amount === 0) return this;
    const targetCount = Math.min(this.maxLimit, this.count + amount);
    const targetAllocation = this.appendAllocation(targetCount);
    // Pathological one-sample batches should not cost more metadata than a dense
    // column. Promotion happens before resize or any logical append is committed.
    const oldestAfterAppend = this.nextIndex + amount - targetCount;
    for (const column of this.columns.values()) {
      if (!column.runs) continue;
      const retainedRuns = column.runs.length - this.findRun(column, oldestAfterAppend) + 1;
      if (retainedRuns > 64 && retainedRuns * 96 > targetAllocation * Float64Array.BYTES_PER_ELEMENT) this.materialize(column);
    }
    if (targetAllocation !== this.allocation) this.resize(targetAllocation);
    const retainedIncoming = Math.min(amount, this.allocation);
    const skip = amount - retainedIncoming;
    const writeStart = amount >= this.allocation ? 0 : (this.head + this.count) % this.allocation;
    const firstRun = Math.min(retainedIncoming, this.allocation - writeStart);

    for (const [name, column] of this.columns) {
      const values = samples[name];
      if (column.schema.auto) {
        const step = options.step ?? column.autoStep;
        const start = options.start ?? (column.autoLast === undefined ? 0 : column.autoLast + step);
        // One affine expression per sample avoids accumulated drift and wrap restarts.
        if (column.runs) column.runs.push({firstIndex: this.nextIndex, count: amount, start, step});
        else {
          for (let i = 0; i < firstRun; i++) column.values[writeStart + i] = start + (skip + i) * step;
          for (let i = firstRun; i < retainedIncoming; i++) column.values[i - firstRun] = start + (skip + i) * step;
        }
        column.autoLast = start + (amount - 1) * step;
        column.autoStep = step;
      } else if (values !== undefined) {
        this.copyInput(column.values, writeStart, values, skip, firstRun);
        this.copyInput(column.values, 0, values, skip + firstRun, retainedIncoming - firstRun);
      } else {
        column.values.fill(NaN, writeStart, writeStart + firstRun);
        column.values.fill(NaN, 0, retainedIncoming - firstRun);
      }
    }
    if (amount >= this.allocation) this.head = 0;
    else this.head = (this.head + Math.max(0, this.count + amount - this.allocation)) % this.allocation;
    this.count = Math.min(this.allocation, this.count + amount);
    this.nextIndex += amount;
    for (const column of this.columns.values()) this.pruneRuns(column);
    this.changed(ticket);
    return this;
  }

  /** Opt-in path: retain only private new pages and bounded dense input drafts
   * until every getter, conversion and allocation succeeds. Dense default above
   * stays on its existing allocation/copy path. */
  private appendPaged(samples: SampleColumns, options: AppendSamplesOptions, ticket: AppendTicket): this {
    if (samples === null || typeof samples !== 'object') throw new TypeError('Sample columns must be an object');
    const inputs = Object.fromEntries(Object.entries(samples)) as SampleColumns;
    const automatic = {start: options.start, step: options.step};
    const amount = this.validateAppend(inputs, automatic, this.nextIndex);
    if (!amount) return this;
    const capacity = this.appendAllocation(Math.min(this.maxLimit, this.count + amount));
    const count = Math.min(capacity, this.count + amount), next = this.nextIndex + amount;
    const reposition = capacity !== this.allocation, incoming = Math.min(amount, capacity), skip = amount - incoming;
    const oldRetained = Math.min(this.count, Math.max(0, capacity - amount));
    const writeStart = reposition ? oldRetained : amount >= capacity ? 0 : (this.head + this.count) % capacity;
    const firstWrite = Math.min(incoming, capacity - writeStart);
    const nextHead = reposition || amount >= capacity ? 0 : (this.head + Math.max(0, this.count + amount - capacity)) % capacity;
    const protectedBuffers = new Set<ArrayBufferLike>(), allocated = new Set<ArrayBufferLike>();
    for (const column of this.columns.values()) protectedBuffers.add(column.values.buffer);
    for (const value of Object.values(inputs)) if (ArrayBuffer.isView(value)) protectedBuffers.add(value.buffer);
    const allocate = (column: Column, length: number): NumericArray => {
      const values = new column.storage(length);
      if (!ArrayBuffer.isView(values) || values instanceof DataView || values instanceof BigInt64Array || values instanceof BigUint64Array
        || values.length !== length || values.BYTES_PER_ELEMENT !== column.values.BYTES_PER_ELEMENT
        || values.byteOffset !== 0 || values.buffer.byteLength !== values.byteLength
        || typeof SharedArrayBuffer !== 'undefined' && values.buffer instanceof SharedArrayBuffer) throw new TypeError('Column storage must allocate an exclusively owned numeric array');
      if (length && (protectedBuffers.has(values.buffer) || allocated.has(values.buffer) || this.paged!.ownsBuffer(values.buffer))) throw new TypeError('Column storage reused a live or input buffer');
      allocated.add(values.buffer); return values;
    };
    const states: Array<{column: Column; start: number; step: number; run?: AffineColumnRun}> = [];
    const plans: DenseAppendPlan[] = [], pageInputs: SampleColumns = {};
    for (const [name, column] of this.columns) {
      if (column.paged !== undefined) {pageInputs[name] = inputs[name]; continue;}
      const auto = column.schema.auto;
      const step = automatic.step ?? column.autoStep;
      const start = automatic.start ?? (column.autoLast === undefined ? 0 : column.autoLast + step);
      let keepAffine = !!column.runs;
      if (keepAffine) {
        const retainedRuns = column.runs!.length - this.findRun(column, next - count) + 1;
        keepAffine = !(retainedRuns > 64 && retainedRuns * 96 > capacity * Float64Array.BYTES_PER_ELEMENT);
      }
      if (keepAffine) {states.push({column, start, step, run: {firstIndex: this.nextIndex, count: amount, start, step}}); continue;}
      const plan: DenseAppendPlan = {column, writes: []};
      const replacement = reposition || !!column.runs ? allocate(column, capacity) : undefined;
      if (replacement) {
        if (reposition) this.copyColumn(column, this.count - oldRetained, oldRetained, replacement);
        else {
          const first = Math.min(this.count, capacity - this.head);
          this.copyColumn(column, 0, first, replacement, this.head); this.copyColumn(column, first, this.count - first, replacement);
        }
        plan.replacement = replacement;
      }
      const staged = allocate(column, incoming);
      if (auto) {
        for (let i = 0; i < incoming; i++) staged[i] = start + (skip + i) * step;
        states.push({column, start, step});
      } else if (inputs[name] === undefined) staged.fill(NaN);
      else this.copyInput(staged, 0, inputs[name]!, skip, incoming);
      const target = replacement ?? column.values, width = target.BYTES_PER_ELEMENT;
      if (firstWrite) plan.writes.push({target: new Uint8Array(target.buffer, target.byteOffset + writeStart * width, firstWrite * width), source: new Uint8Array(staged.buffer, staged.byteOffset, firstWrite * width)});
      if (firstWrite < incoming) plan.writes.push({target: new Uint8Array(target.buffer, target.byteOffset, (incoming - firstWrite) * width), source: new Uint8Array(staged.buffer, staged.byteOffset + firstWrite * width, (incoming - firstWrite) * width)});
      plans.push(plan);
    }
    const prepared = this.paged!.prepareAppendSamples(pageInputs, amount, capacity);
    try {
      // All user-controlled work is done. The remaining writes use intrinsic
      // Uint8Array views, preserving exact IEEE bytes without custom .set hooks.
      prepared.commit();
      for (const plan of plans) {
        for (const write of plan.writes) write.target.set(write.source);
        if (plan.replacement) {plan.column.values = plan.replacement; plan.column.runs = undefined; plan.column.runStart = 0;}
      }
      for (const state of states) {
        if (state.run) state.column.runs!.push(state.run);
        state.column.autoLast = state.start + (amount - 1) * state.step; state.column.autoStep = state.step;
      }
      this.allocation = capacity; this.count = count; this.head = nextHead; this.nextIndex = next;
      for (const column of this.columns.values()) this.pruneRuns(column);
      this.changed(ticket);
    } finally {prepared.abort();}
    return this;
  }

  /** CRYChart internal replacement transaction. Retains this data-set identity,
   * schema and retention policy; resets absolute indices and automatic coordinates
   * to a new sequence. Validation, allocation and input reads happen on isolated
   * storage through the existing append path. Only a complete result is published.
   * A notification listener can still throw after the replacement is committed.
   */
  replaceSamples(samples: SampleColumns, options: AppendSamplesOptions = {}): this {
    this.assertAlive();
    return this.pagedOptions ? this.mutateAtomically(() => this.replaceSamplesInternal(samples, options)) : this.replaceSamplesInternal(samples, options);
  }
  private replaceSamplesInternal(samples: SampleColumns, options: AppendSamplesOptions): this {
    if (samples === null || typeof samples !== 'object') throw new TypeError('Sample columns must be an object');
    // Capture property getters once. Typed arrays are copied by append, never
    // borrowed; passing an existing ring slice cannot overwrite the old sequence.
    const inputs = Object.fromEntries(Object.entries(samples)) as SampleColumns;
    const automatic = {start: options.start, step: options.step};
    const amount = this.validateAppend(inputs, automatic, 0);
    const staged = new DataSetXY({schema: this.schemaSnapshot, includesNaN: this.includesNaN, columnStorage: this.pagedOptions});
    if (this.columns.has('_auto') && !this.schemaSnapshot._auto) staged.enableImplicitXColumn();
    staged.mode = this.mode; staged.maxLimit = this.maxLimit;
    if (amount) {
      // Plan the final allocation once instead of allocating the old capacity and
      // immediately allocating again when the replacement needs a larger ring.
      staged.resize(this.appendAllocation(Math.min(this.maxLimit, amount)));
      staged.appendSamples(inputs, automatic);
    } else {
      // Clearing needs no dense reallocation. The staging auto state is already
      // reset, and these retained buffers are not written during preparation.
      staged.allocation = this.allocation;
      if (staged.paged && this.allocation) staged.paged.resize(this.allocation);
      for (const [name, column] of staged.columns) if (!column.runs && column.paged === undefined) column.values = this.columns.get(name)!.values;
    }
    // No user input reads, constructors or callbacks until every column is ready.
    for (const [name, column] of this.columns) {
      const replacement = staged.columns.get(name)!;
      column.values = replacement.values; column.runs = replacement.runs;
      column.runStart = replacement.runStart; column.autoLast = replacement.autoLast; column.autoStep = replacement.autoStep;
      column.paged = replacement.paged;
    }
    if (this.paged) {const old = this.paged; this.paged = staged.paged; old.dispose();}
    this.allocation = staged.allocation; this.head = staged.head;
    this.count = staged.count; this.nextIndex = staged.nextIndex;
    this.contentEpoch++; this.changed();
    return this;
  }

  /** Internal renderer access. Unlike getColumnSlices this keeps automatic X implicit. */
  getColumnRuns(name: string): DataColumnRuns {
    const column = this.columns.get(name);
    if (!column) throw new RangeError(`Unknown data column: ${name}`);
    const firstIndex = this.nextIndex - this.count;
    if (column.paged !== undefined) return this.paged!.getColumnView(column.paged);
    return column.runs
      ? {kind: 'affine', firstIndex, count: this.count, runs: column.runs, runStart: column.runStart}
      : {kind: 'dense', firstIndex, count: this.count, slices: this.getColumnSlices(name)};
  }

  /** CRYChart internal extension: at most two borrowed views in retained logical order.
   * Automatic Float64 columns materialize once on the first nonempty request. Later
   * calls borrow the same dense ring without a whole-column copy. Callers must not
   * write; reacquire after any data-set mutation. getColumnRuns avoids materialization.
   * Unlike getColumn, these views can observe later writes into the same ring storage.
   */
  getColumnSlices(name: string): readonly NumericArray[] {
    const column = this.columns.get(name);
    if (!column) throw new RangeError(`Unknown data column: ${name}`);
    if (!this.count) return [];
    this.materialize(column);
    const first = Math.min(this.count, this.allocation - this.head), head = this.pagedOptions ? numericView(column.values, this.head, first) : column.values.subarray(this.head, this.head + first) as NumericArray;
    return first === this.count ? [head] : [head, this.pagedOptions ? numericView(column.values, 0, this.count - first) : column.values.subarray(0, this.count - first) as NumericArray];
  }

  /** Cached logical-order column. Treat the returned snapshot as read-only. */
  getColumn(name: string): NumericArray {
    const cached = this.snapshots.get(name);
    if (cached) return cached;
    const column = this.columns.get(name);
    if (!column) throw new RangeError(`Unknown data column: ${name}`);
    const result = new column.storage(this.count);
    if (this.pagedOptions) this.assertPrivateAllocation(result, this.count);
    this.copyColumn(column, 0, this.count, result);
    this.snapshots.set(name, result);
    return result;
  }

  /** Direct, allocation-free access by offset within retained samples. */
  getValue(name: string, retainedOffset: number): number | undefined {
    const column = this.columns.get(name);
    if (!column || !Number.isInteger(retainedOffset) || retainedOffset < 0 || retainedOffset >= this.count) return undefined;
    if (column.paged !== undefined) return this.paged!.getValue(column.paged, retainedOffset);
    if (column.runs) {
      const index = this.nextIndex - this.count + retainedOffset;
      const run = column.runs[this.findRun(column, index)]!;
      return run.start + (index - run.firstIndex) * run.step;
    }
    return column.values[(this.head + retainedOffset) % this.allocation];
  }

  /** Read by logical offset within retained samples, independent of the ring head. */
  getSample(offset: number): Record<string, number> | undefined {
    if (!Number.isInteger(offset) || offset < 0 || offset >= this.count) return undefined;
    return Object.fromEntries(Object.keys(this.schema).map(name => [name, this.getValue(name, offset)!]));
  }

  getSampleByIndex(index: number): Record<string, number> | undefined {
    return this.getSample(index - (this.nextIndex - this.count));
  }

  readBack(options: ReadBackOptions = {}): DataSetReadBack {
    const firstIndex = this.nextIndex - this.count;
    let from = 0, to = this.count;
    if (options.onlyInRange) {
      const range = options.onlyInRange;
      const name = range.key === undefined ? [...this.columns].find(([, c]) => c.schema.pattern === 'progressive' || c.schema.pattern === 'regressive')?.[0] ?? (this.columns.has('xValues') ? 'xValues' : 'x') : String(range.key);
      const column = this.columns.get(name);
      if (!column) throw new RangeError(`Unknown data column: ${name}`);
      [from, to] = this.findRange(column, Math.min(range.start, range.end), Math.max(range.start, range.end));
    }
    const data: Record<string, NumericArray> = {};
    const allocated = this.pagedOptions ? new Set<ArrayBufferLike>() : undefined;
    // Copy only the requested result. A small query must not cache entire columns.
    for (const [name, column] of this.columns) {
      if (!(name in this.schemaSnapshot)) continue;
      const result = new column.storage(to - from);
      if (this.pagedOptions) this.assertPrivateAllocation(result, to - from, allocated);
      this.copyColumn(column, from, to - from, result);
      data[name] = result;
    }
    return {data, iSampleFirst: firstIndex + from};
  }

  clear(): this {
    this.assertAlive();
    return this.pagedOptions ? this.mutateAtomically(() => this.clearInternal()) : this.clearInternal();
  }
  private clearInternal(): this {
    const empty = new Map<Column, NumericArray>();
    if (this.pagedOptions) for (const column of this.columns.values()) if (column.schema.auto && column.storage === Float64Array) empty.set(column, new column.storage(0));
    this.paged?.clear();
    this.contentEpoch++;
    this.head = 0; this.count = 0; this.nextIndex = 0;
    for (const column of this.columns.values()) {
      column.autoLast = undefined; column.autoStep = 1;
      if (column.schema.auto && column.storage === Float64Array) {
        column.values = empty.get(column) ?? new column.storage(0); column.runs = []; column.runStart = 0;
      }
    }
    this.changed();
    return this;
  }

  dispose(): this {
    if (this.disposed) return this;
    this.assertAlive();
    if (this.pagedOptions) return this.mutateAtomically(() => this.disposeInternal());
    return this.disposeInternal();
  }
  private disposeInternal(): this {
    this.contentEpoch++;
    this.disposed = true; this.head = 0; this.count = 0; this.allocation = 0;
    for (const column of this.columns.values()) {
      column.values = this.pagedOptions ? emptyArray(column.values) : new column.storage(0);
      column.paged = undefined;
      if (column.runs) column.runs = [];
      column.runStart = 0; column.autoLast = undefined;
    }
    this.paged?.dispose(); this.paged = undefined;
    try { this.changed(); } finally { if (!this.inMutation) this.events.clear(); }
    return this;
  }
  isDisposed(): boolean { return this.disposed; }

  private deltaSourceHeader(): SourceHeader {
    return {revision: this.changeRevision, epoch: this.contentEpoch, first: this.nextIndex - this.count, next: this.nextIndex,
      capacity: this.allocation, head: this.head, paged: !!this.pagedOptions, pageSize: this.pagedOptions?.pageSize ?? 1024, disposed: this.disposed};
  }
  private changed(ticket?: AppendTicket): void {
    this.changeRevision++;
    commitSourceChange(this, this.deltaSourceHeader(), ticket);
    this.snapshots.clear();
    if (this.inMutation) this.deferredChange = true; else this.events.emit('change', this);
  }
  private assertAlive(): void {
    if (this.disposed) throw new Error('DataSetXY is disposed');
    if (this.inMutation) throw new Error('DataSet mutation is already in progress');
  }
  private mutateAtomically<T>(mutation: () => T): T {
    this.inMutation = true; this.deferredChange = false;
    let result: T;
    try {result = mutation();} catch (error) {this.deferredChange = false; throw error;}
    finally {this.inMutation = false;}
    const notify = this.deferredChange; this.deferredChange = false;
    try {if (notify) this.events.emit('change', this);} finally {if (this.disposed) this.events.clear();}
    return result;
  }
  private validateAppend(samples: SampleColumns, options: AppendSamplesOptions, nextIndex: number): number {
    if (samples === null || typeof samples !== 'object') throw new TypeError('Sample columns must be an object');
    let length: number | undefined;
    for (const [name, values] of Object.entries(samples)) {
      if (values === undefined) continue;
      if (!Number.isSafeInteger(values.length) || values.length < 0) throw new TypeError(`Column ${name} is not a numeric array`);
      if (length === undefined) length = values.length;
      else if (values.length !== length) throw new RangeError('All sample columns must have the same length');
    }
    const amount = length ?? 0;
    if (!amount) return 0;
    if (!Number.isSafeInteger(nextIndex + amount)) throw new RangeError('Sample index exceeds the safe integer range');
    if (options.start !== undefined && !Number.isFinite(options.start)) throw new RangeError('Automatic coordinate start must be finite');
    if (options.step !== undefined && !Number.isFinite(options.step)) throw new RangeError('Automatic coordinate step must be finite');
    return amount;
  }
  private appendAllocation(targetCount: number): number {
    if (targetCount <= this.allocation) return this.allocation;
    const grown = Math.max(targetCount, Math.max(1, this.allocation) * 2, this.mode === 'unbounded' ? 256 : 1);
    return Math.min(this.maxLimit, grown);
  }
  private assertPrivateAllocation(values: NumericArray, length: number, allocated?: Set<ArrayBufferLike>): void {
    if (!ArrayBuffer.isView(values) || values instanceof DataView || values instanceof BigInt64Array || values instanceof BigUint64Array
      || values.length !== length || values.byteOffset !== 0 || values.buffer.byteLength !== values.byteLength
      || typeof SharedArrayBuffer !== 'undefined' && values.buffer instanceof SharedArrayBuffer) throw new TypeError('Column storage must allocate an exclusively owned numeric array');
    if (length) {
      const buffer = values.buffer;
      if (allocated?.has(buffer) || this.paged?.ownsBuffer(buffer)) throw new TypeError('Column storage reused a live buffer');
      for (const column of this.columns.values()) if (column.values.buffer === buffer) throw new TypeError('Column storage reused a live buffer');
      for (const snapshot of this.snapshots.values()) if (snapshot.buffer === buffer) throw new TypeError('Column storage reused a snapshot buffer');
    }
    allocated?.add(values.buffer);
  }
  private resize(capacity: number): void {
    if (capacity === this.allocation) return;
    const retain = Math.min(this.count, capacity), skip = this.count - retain;
    const replacements = new Map<Column, NumericArray>();
    const allocated = this.pagedOptions ? new Set<ArrayBufferLike>() : undefined;
    for (const column of this.columns.values()) {
      if (column.runs || column.paged !== undefined) continue;
      const result = new column.storage(capacity);
      if (this.pagedOptions) this.assertPrivateAllocation(result, capacity, allocated);
      if (result.length !== capacity) throw new RangeError('Column storage returned an unexpected capacity');
      this.copyColumn(column, skip, retain, result);
      replacements.set(column, result);
    }
    // Commit only after every allocation and copy succeeded.
    this.paged?.resize(Math.max(1, capacity));
    for (const [column, values] of replacements) column.values = values;
    this.allocation = capacity; this.head = 0; this.count = retain;
    for (const column of this.columns.values()) this.pruneRuns(column);
    this.snapshots.clear();
    invalidateSourceCertificate(this, this.deltaSourceHeader(), 'capacity-rearranged');
  }

  private findRun(column: Column, index: number): number {
    const runs = column.runs!;
    let low = column.runStart, high = runs.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2), run = runs[middle]!;
      if (run.firstIndex + run.count <= index) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  private pruneRuns(column: Column): void {
    if (!column.runs) return;
    const first = this.nextIndex - this.count;
    while (column.runStart < column.runs.length) {
      const run = column.runs[column.runStart]!;
      if (run.firstIndex + run.count > first) break;
      column.runStart++;
    }
    // Expired batch objects are released in amortized chunks, never per-sample shift.
    if (column.runStart > 256 && column.runStart * 2 > column.runs.length) {
      column.runs = column.runs.slice(column.runStart); column.runStart = 0;
    }
  }

  private copyColumn(column: Column, from: number, amount: number, target: NumericArray, targetOffset = 0): void {
    if (!amount) return;
    if (column.paged !== undefined) {
      const view = this.paged!.getColumnView(column.paged);
      let absolute = view.firstIndex + from, written = 0;
      const output = new Uint8Array(target.buffer, target.byteOffset, target.byteLength), width = target.BYTES_PER_ELEMENT;
      while (written < amount) {
        const pageIndex = Math.floor(absolute / view.pageSize), offset = absolute - pageIndex * view.pageSize, page = view.getPage(pageIndex);
        if (!page) throw new Error('Missing retained page');
        const length = Math.min(amount - written, view.pageSize - offset);
        output.set(new Uint8Array(page.buffer, page.byteOffset + offset * width, length * width), (targetOffset + written) * width);
        absolute += length; written += length;
      }
      return;
    }
    if (column.runs) {
      const firstIndex = this.nextIndex - this.count + from, endIndex = firstIndex + amount;
      for (let r = this.findRun(column, firstIndex); r < column.runs.length; r++) {
        const run = column.runs[r]!;
        const start = Math.max(firstIndex, run.firstIndex), end = Math.min(endIndex, run.firstIndex + run.count);
        for (let index = start; index < end; index++) target[targetOffset + index - firstIndex] = run.start + (index - run.firstIndex) * run.step;
        if (end >= endIndex) break;
      }
      return;
    }
    const physicalStart = (this.head + from) % this.allocation, first = Math.min(amount, this.allocation - physicalStart);
    if (this.pagedOptions) {
      const width = target.BYTES_PER_ELEMENT, output = new Uint8Array(target.buffer, target.byteOffset, target.byteLength);
      output.set(new Uint8Array(column.values.buffer, column.values.byteOffset + physicalStart * width, first * width), targetOffset * width);
      if (first < amount) output.set(new Uint8Array(column.values.buffer, column.values.byteOffset, (amount - first) * width), (targetOffset + first) * width);
      return;
    }
    target.set(column.values.subarray(physicalStart, physicalStart + first), targetOffset);
    if (first < amount) target.set(column.values.subarray(0, amount - first), targetOffset + first);
  }

  private materialize(column: Column): void {
    if (!column.runs && column.paged === undefined) return;
    if (this.inMutation) throw new Error('DataSet representation cannot change during a mutation');
    const result = new column.storage(this.allocation);
    if (this.pagedOptions) this.assertPrivateAllocation(result, this.allocation);
    const first = Math.min(this.count, this.allocation - this.head);
    this.copyColumn(column, 0, first, result, this.head);
    this.copyColumn(column, first, this.count - first, result);
    if (column.paged !== undefined) {this.paged!.removeColumn(column.paged); column.paged = undefined; this.pagedPromotionCount++;}
    column.values = result; column.runs = undefined; column.runStart = 0;
    invalidateSourceCertificate(this, this.deltaSourceHeader(), 'column-materialized');
  }

  private findRange(column: Column, min: number, max: number): [number, number] {
    let from = this.count, to = this.count;
    if (Number.isNaN(min) || Number.isNaN(max)) return [from, to];
    if (column.paged !== undefined) {
      const view = this.paged!.getColumnView(column.paged), firstIndex = view.firstIndex, endIndex = firstIndex + view.count;
      for (let index = firstIndex; index < endIndex;) {
        const pageIndex = Math.floor(index / view.pageSize), page = view.getPage(pageIndex);
        if (!page) throw new Error('Missing retained page');
        const base = pageIndex * view.pageSize, end = Math.min(endIndex, base + view.pageSize);
        for (; index < end; index++) {const value = page[index - base]!; if (value >= min && value <= max) {from = Math.min(from, index - firstIndex); to = index - firstIndex + 1;}}
      }
    } else if (column.runs) {
      const firstIndex = this.nextIndex - this.count;
      for (let r = column.runStart; r < column.runs.length; r++) {
        const run = column.runs[r]!;
        const start = Math.max(firstIndex, run.firstIndex), end = Math.min(this.nextIndex, run.firstIndex + run.count);
        if (Number.isFinite(run.start)) {
          // Each original batch is monotonic, even when different batches jump or
          // reverse. Binary searches retain exact comparisons and include infinities.
          const increasing = run.step >= 0;
          let low = start, high = end;
          while (low < high) {
            const middle = low + Math.floor((high - low) / 2), value = run.start + (middle - run.firstIndex) * run.step;
            if (increasing ? value < min : value > max) low = middle + 1;
            else high = middle;
          }
          const matchStart = low;
          high = end;
          while (low < high) {
            const middle = low + Math.floor((high - low) / 2), value = run.start + (middle - run.firstIndex) * run.step;
            if (increasing ? value <= max : value >= min) low = middle + 1;
            else high = middle;
          }
          if (matchStart < low) { from = Math.min(from, matchStart - firstIndex); to = low - firstIndex; }
          continue;
        }
        for (let index = start; index < end; index++) {
          const value = run.start + (index - run.firstIndex) * run.step;
          if (value >= min && value <= max) { from = Math.min(from, index - firstIndex); to = index - firstIndex + 1; }
        }
      }
    } else {
      const first = Math.min(this.count, this.allocation - this.head);
      for (let i = 0; i < first; i++) {
        const value = column.values[this.head + i]!;
        if (value >= min && value <= max) { from = Math.min(from, i); to = i + 1; }
      }
      for (let i = first; i < this.count; i++) {
        const value = column.values[i - first]!;
        if (value >= min && value <= max) { from = Math.min(from, i); to = i + 1; }
      }
    }
    return [from, to];
  }

  private copyInput(target: NumericArray, targetStart: number, source: ArrayLike<number>, start: number, count: number): void {
    if (count === 0) return;
    if (this.pagedOptions) {
      if (ArrayBuffer.isView(source) && 'subarray' in source) Float64Array.prototype.set.call(target, numericView(source as NumericArray, start, count), targetStart);
      else for (let i = 0; i < count; i++) target[targetStart + i] = source[start + i]!;
      return;
    }
    if (start === 0 && count === source.length) { target.set(source, targetStart); return; }
    if (ArrayBuffer.isView(source) && 'subarray' in source) {
      target.set((source as NumericArray).subarray(start, start + count), targetStart);
      return;
    }
    // General array-like support without an intermediate row/object allocation.
    for (let i = 0; i < count; i++) target[targetStart + i] = source[start + i]!;
  }
}

/** Bounds for drawing deliberately ignore gaps without changing source storage. */
export function finiteExtent(values: ArrayLike<number>): {min: number; max: number} | undefined {
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < values.length; i++) { const value = values[i]!; if (!Number.isFinite(value)) continue; if (value < min) min = value; if (value > max) max = value; }
  return min === Infinity ? undefined : {min, max};
}
