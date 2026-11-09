import {A, type LineSelectionLedger, type LedgerCompletedPlan, type LedgerEntry} from './line-selection-ledger.js';
import type {DrawPacket} from './contracts.js';
import type {DisplayPageChunk, PagePacketTemplate} from './line-display-packets.js';

export interface LineArenaDirtyRange {first: number; count: number;}
/** Borrowed until the arena's next successful update. One storage id owns one
 * VBO, even when two draw views refer to it. Ranges are physical sample slots. */
export interface LineArenaStorage {
  id: number;
  revision: number;
  previousRevision: number;
  values: Float32Array;
  dirtyRanges: readonly LineArenaDirtyRange[];
  capacity: number;
}
export interface LineArenaPacket extends DrawPacket {
  arenaStorage: LineArenaStorage;
  arenaFirst: number;
}
export interface LineArenaStats {
  sourceDisplaySamples: number;
  submittedSegments: number;
  geometryPackets: number;
  capacityBytes: number;
  reusedSamples: number;
  writtenSamples: number;
  dirtyPositionBytes: number;
  fullRebuild: boolean;
  head: number;
  wrapped: boolean;
  generationReset: boolean;
}
type Entry = DisplayPageChunk & {offset: number};
type Anchor = {first: number; oldFirst: number; count: number};
let nextArenaId = -(2 ** 47);

/** Experimental packaging only: existing projected coordinates are copied
 * byte-for-byte into a single cyclic allocation. No source value is removed,
 * re-projected, or approximated. This needs the independent arena uploader;
 * ordinary DrawPacket upload must not consume these shared-storage packets. */
export class LineDisplayArena {
  private storage?: LineArenaStorage;
  private entries: Entry[] = [];
  private entriesOwner?: LineSelectionLedger;
  private generation?: unknown;
  private origin?: DrawPacket['origin'];
  private head = 0;
  private disposed = false;

  constructor(readonly maximumSamples = 1048576) {
    if (!Number.isSafeInteger(maximumSamples) || maximumSamples < 2) throw new RangeError('Arena budget must allow at least two samples');
  }

  update(chunks: readonly DisplayPageChunk[], template: PagePacketTemplate, generation: unknown): {
    packets: readonly LineArenaPacket[]; storage?: LineArenaStorage; stats: LineArenaStats;
  } {
    if (this.disposed) throw new Error('Line display arena is disposed');
    this.materializeLedgerEntries();
    if (!Number.isSafeInteger(template.strokeGroup)) throw new TypeError('Arena geometry requires a stable strokeGroup');
    const keys = new Set<string>(), entries: Entry[] = [];
    let count = 0, previousX = -Infinity;
    for (const chunk of chunks) {
      if (keys.has(chunk.key)) throw new TypeError('Arena chunk keys must be unique');
      keys.add(chunk.key);
      if (!Number.isSafeInteger(chunk.first) || !Number.isSafeInteger(chunk.count) || chunk.first < 0 || chunk.count < 1 ||
          (chunk.first + chunk.count) * 2 > chunk.positions.length) throw new RangeError('Arena chunk exceeds its projected array');
      if (!chunk.strictlyMonotonicX || !(chunk.positions[chunk.first * 2]! > previousX)) throw new TypeError('Arena chunks require strict ordered projected X');
      if (chunk.positions.buffer === this.storage?.values.buffer) throw new TypeError('Arena input must not alias its writable storage');
      previousX = chunk.positions[(chunk.first + chunk.count - 1) * 2]!;
      if (!Number.isFinite(previousX)) throw new TypeError('Arena X values must be finite');
      entries.push({...chunk, offset: count}); count += chunk.count;
      if (count > this.maximumSamples) throw new RangeError('Arena display sample budget exceeded');
    }
    const stats: LineArenaStats = {sourceDisplaySamples: count, submittedSegments: Math.max(0, count - 1), geometryPackets: 0,
      capacityBytes: 0, reusedSamples: 0, writtenSamples: 0, dirtyPositionBytes: 0, fullRebuild: false,
      head: 0, wrapped: false, generationReset: false};
    if (!count) {this.clear(); return {packets: [], stats};}
    const differentGeneration = this.generation !== generation || !this.origin ||
      this.origin.x !== template.origin.x || this.origin.y !== template.origin.y || this.origin.z !== template.origin.z;
    if (differentGeneration) {this.clear(); stats.generationReset = true;}
    let storage = this.storage, anchor: Anchor | undefined;
    if (!storage || storage.capacity < count) {
      let capacity = Math.min(64, this.maximumSamples);
      while (capacity < count) capacity = Math.min(this.maximumSamples, capacity * 2);
      storage = {id: storage?.id ?? nextArenaId--, revision: storage?.revision ?? 0, previousRevision: -1,
        capacity, values: new Float32Array((capacity + 1) * 2), dirtyRanges: []};
      if (!Number.isSafeInteger(storage.id)) throw new RangeError('Arena storage IDs exhausted');
      this.head = 0; stats.fullRebuild = true;
    } else {
      // Array identity certifies immutable projected bytes. Matching by value,
      // source key alone or revision number alone would be insufficient.
      const oldByKey = new Map(this.entries.map(entry => [entry.key, entry]));
      let current: Anchor | undefined;
      for (const entry of entries) {
        const old = oldByKey.get(entry.key);
        if (!old || old.positions !== entry.positions) {current = undefined; continue;}
        const first = Math.max(entry.first, old.first), end = Math.min(entry.first + entry.count, old.first + old.count);
        if (first >= end) {current = undefined; continue;}
        const next: Anchor = {first: entry.offset + first - entry.first, oldFirst: old.offset + first - old.first, count: end - first};
        if (current && current.first + current.count === next.first && current.oldFirst + current.count === next.oldFirst)
          current = {...current, count: current.count + next.count};
        else current = next;
        if (!anchor || current.count > anchor.count) anchor = current;
      }
      if (anchor) this.head = modulo(this.head + anchor.oldFirst - anchor.first, storage.capacity);
      else {this.head = 0; stats.fullRebuild = true;}
    }
    const dirty: LineArenaDirtyRange[] = [];
    const copy = (first: number, end: number) => {
      if (first >= end) return;
      for (const entry of entries) {
        const from = Math.max(first, entry.offset), to = Math.min(end, entry.offset + entry.count);
        if (from >= to) continue;
        let sourceFirst = entry.first + from - entry.offset, targetFirst = modulo(this.head + from, storage!.capacity), remaining = to - from;
        while (remaining > 0) {
          const length = Math.min(remaining, storage!.capacity - targetFirst);
          storage!.values.set(entry.positions.subarray(sourceFirst * 2, (sourceFirst + length) * 2), targetFirst * 2);
          dirty.push({first: targetFirst, count: length});
          stats.writtenSamples += length;
          remaining -= length; sourceFirst += length; targetFirst = 0;
        }
      }
    };
    if (anchor) {copy(0, anchor.first); copy(anchor.first + anchor.count, count); stats.reusedSamples = anchor.count;}
    else copy(0, count);
    // Copy the native Float32 bits, including NaN payloads. The guard owns the
    // wrap segment, so a separate bridge packet is unnecessary.
    if (dirty.some(range => range.first === 0)) {
      storage.values.set(storage.values.subarray(0, 2), storage.capacity * 2);
      dirty.push({first: storage.capacity, count: 1}); stats.writtenSamples++;
    }
    storage.previousRevision = storage.revision;
    if (dirty.length) storage.revision++;
    storage.dirtyRanges = mergeRanges(dirty);
    stats.dirtyPositionBytes = storage.dirtyRanges.reduce((sum, range) => sum + range.count * 8, 0);
    this.storage = storage; this.entries = entries; this.generation = generation; this.origin = {...template.origin};
    stats.capacityBytes = storage.values.byteLength; stats.head = this.head;
    const packets: LineArenaPacket[] = [];
    const publish = (first: number, length: number) => {
      if (length < 2) return;
      packets.push({id: storage!.id, revision: storage!.revision, previousRevision: storage!.previousRevision,
        positions: storage!.values.subarray(first * 2, (first + length) * 2), count: length,
        arenaStorage: storage!, arenaFirst: first, dimensions: 2, mode: 'line', pointSize: 0,
        monotonicX: true, strictlyMonotonicX: true, ...template});
    };
    const untilEnd = storage.capacity - this.head;
    if (count <= untilEnd) publish(this.head, count);
    else {stats.wrapped = true; publish(this.head, untilEnd + 1); publish(0, count - untilEnd);}
    stats.geometryPackets = packets.length;
    if (packets.reduce((sum, packet) => sum + packet.count - 1, 0) !== stats.submittedSegments)
      throw new Error('Arena segment partition is inconsistent');
    return {packets, storage, stats};
  }

  /** Internal own-selector certificate. Foreign descriptors use update(). */
  updateCertified(plan: LedgerCompletedPlan, template: PagePacketTemplate, generation: unknown): {
    packets: readonly LineArenaPacket[]; storage?: LineArenaStorage; stats: LineArenaStats;
  } {
    if (this.disposed) throw new Error('Line display arena is disposed');
    plan.owner.validate(plan);
    const differentGeneration = this.generation !== generation || !this.origin ||
      this.origin.x !== template.origin.x || this.origin.y !== template.origin.y || this.origin.z !== template.origin.z;
    // The longest anchor must include this entire stable middle. Otherwise use
    // the unchanged full method; partial copies may then include middle pages.
    if (differentGeneration || !this.storage || this.storage.capacity < plan.count ||
      plan.stable[A.count]! <= plan.count - plan.stable[A.count]!)
      return this.update(plan.owner.materialize(plan), template, generation);
    if (!Number.isSafeInteger(template.strokeGroup)) throw new TypeError('Arena geometry requires a stable strokeGroup');
    const keys = new Set<string>();
    const entries = [...plan.prefix, ...plan.suffix];
    for (const entry of entries) {
      if (keys.has(entry.key)) throw new TypeError('Arena chunk keys must be unique'); keys.add(entry.key);
      if (!Number.isSafeInteger(entry.first) || !Number.isSafeInteger(entry.count) || entry.first < 0 || entry.count < 1 ||
        (entry.first + entry.count) * 2 > entry.positions.length) throw new RangeError('Arena chunk exceeds its projected array');
      if (!entry.strictlyMonotonicX || !Number.isFinite(entry.positions[(entry.first + entry.count - 1) * 2]!))
        throw new TypeError('Arena X values must be finite and ordered');
      if (entry.positions.buffer === this.storage.values.buffer) throw new TypeError('Arena input must not alias its writable storage');
    }
    if (!plan.aggregate[A.strict] || !Number.isFinite(plan.aggregate[A.firstX]) || !Number.isFinite(plan.aggregate[A.lastX]))
      throw new TypeError('Arena chunks require strict ordered projected X');
    if (plan.count > this.maximumSamples) throw new RangeError('Arena display sample budget exceeded');
    const count = plan.count, storage = this.storage;
    const stats: LineArenaStats = {sourceDisplaySamples: count, submittedSegments: Math.max(0, count - 1), geometryPackets: 0,
      capacityBytes: 0, reusedSamples: 0, writtenSamples: 0, dirtyPositionBytes: 0, fullRebuild: false,
      head: 0, wrapped: false, generationReset: false};
    let anchor: Anchor | undefined, current: Anchor | undefined;
    const accept = (next: Anchor | undefined) => {
      if (!next) {current = undefined; return;}
      if (current && current.first + current.count === next.first && current.oldFirst + current.count === next.oldFirst)
        current = {...current, count: current.count + next.count};
      else current = next;
      if (!anchor || current.count > anchor.count) anchor = current;
    };
    const match = (entry: LedgerEntry) => {
      const old = plan.owner.lookupOld(entry.key);
      if (!old || old.positions !== entry.positions) {accept(undefined); return;}
      const first = Math.max(entry.first, old.first), end = Math.min(entry.first + entry.count, old.first + old.count);
      accept(first >= end ? undefined : {first: entry.offset + first - entry.first, oldFirst: old.offset + first - old.first, count: end - first});
    };
    for (const entry of plan.prefix) match(entry);
    accept({first: plan.prefixCount, oldFirst: plan.oldStableOffset, count: plan.stable[A.count]!});
    for (const entry of plan.suffix) match(entry);
    if (!anchor || anchor.first > plan.prefixCount || anchor.first + anchor.count < plan.prefixCount + plan.stable[A.count]!)
      throw new Error('Certified anchor does not include the stable middle');
    this.head = modulo(this.head + anchor.oldFirst - anchor.first, storage.capacity);
    const dirty: LineArenaDirtyRange[] = [];
    const copy = (first: number, end: number) => {
      if (first >= end) return;
      for (const entry of entries) {
        const from = Math.max(first, entry.offset), to = Math.min(end, entry.offset + entry.count);
        if (from >= to) continue;
        let sourceFirst = entry.first + from - entry.offset, targetFirst = modulo(this.head + from, storage.capacity), remaining = to - from;
        while (remaining > 0) {
          const length = Math.min(remaining, storage.capacity - targetFirst);
          storage.values.set(entry.positions.subarray(sourceFirst * 2, (sourceFirst + length) * 2), targetFirst * 2);
          dirty.push({first: targetFirst, count: length}); stats.writtenSamples += length;
          remaining -= length; sourceFirst += length; targetFirst = 0;
        }
      }
    };
    copy(0, anchor.first); copy(anchor.first + anchor.count, count); stats.reusedSamples = anchor.count;
    if (dirty.some(range => range.first === 0)) {
      storage.values.set(storage.values.subarray(0, 2), storage.capacity * 2);
      dirty.push({first: storage.capacity, count: 1}); stats.writtenSamples++;
    }
    storage.previousRevision = storage.revision;
    if (dirty.length) storage.revision++;
    storage.dirtyRanges = mergeRanges(dirty);
    stats.dirtyPositionBytes = storage.dirtyRanges.reduce((sum, range) => sum + range.count * 8, 0);
    this.storage = storage; this.entries = []; this.entriesOwner = plan.owner;
    this.generation = generation; this.origin = {...template.origin};
    stats.capacityBytes = storage.values.byteLength; stats.head = this.head;
    const packets: LineArenaPacket[] = [];
    const publish = (first: number, length: number) => {
      if (length < 2) return;
      packets.push({id: storage.id, revision: storage.revision, previousRevision: storage.previousRevision,
        positions: storage.values.subarray(first * 2, (first + length) * 2), count: length,
        arenaStorage: storage, arenaFirst: first, dimensions: 2, mode: 'line', pointSize: 0,
        monotonicX: true, strictlyMonotonicX: true, ...template});
    };
    const untilEnd = storage.capacity - this.head;
    if (count <= untilEnd) publish(this.head, count);
    else {stats.wrapped = true; publish(this.head, untilEnd + 1); publish(0, count - untilEnd);}
    stats.geometryPackets = packets.length;
    if (packets.reduce((sum, packet) => sum + packet.count - 1, 0) !== stats.submittedSegments)
      throw new Error('Arena segment partition is inconsistent');
    return {packets, storage, stats};
  }

  /** Before a full fallback, restore only private descriptor metadata. */
  materializeLedgerEntries(): void {
    if (this.entriesOwner) {this.entries = this.entriesOwner.materialize(); this.entriesOwner = undefined;}
  }

  clear(): void {this.entriesOwner = undefined; this.storage = undefined; this.entries = []; this.generation = undefined; this.origin = undefined; this.head = 0;}
  dispose(): void {if (this.disposed) return; this.clear(); this.disposed = true;}
}

function modulo(value: number, divisor: number): number {return ((value % divisor) + divisor) % divisor;}
function mergeRanges(ranges: LineArenaDirtyRange[]): LineArenaDirtyRange[] {
  ranges.sort((a, b) => a.first - b.first);
  const merged: LineArenaDirtyRange[] = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range.first <= last.first + last.count) last.count = Math.max(last.first + last.count, range.first + range.count) - last.first;
    else merged.push({...range});
  }
  return merged;
}
