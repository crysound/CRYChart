/** Artifact-only producer contract. It owns numbers, never borrowed columns. */
export interface SourceHeader {
  revision: number;
  epoch: number;
  first: number;
  next: number;
  capacity: number;
  head: number;
  paged: boolean;
  pageSize: number;
  disposed: boolean;
}
export interface SourceCertificate extends Readonly<SourceHeader> {
  readonly producer: number;
  readonly serial: number;
  readonly lineage: number;
  readonly reason: string;
  /** A failed dense input read can have written bytes without a revision.
   * The unchanged selector cannot certify its old cache until a new epoch. */
  readonly tainted: boolean;
}
export interface AppendTicket {
  readonly before: Readonly<SourceHeader>;
  readonly prior?: SourceCertificate;
}
export interface CertifiedSourceDelta {
  readonly kind: 'unchanged' | 'append-prefix';
  readonly previous: SourceCertificate;
  readonly current: SourceCertificate;
  /** All original values in this absolute interval are unchanged. */
  readonly stableFirst: number;
  readonly stableEnd: number;
  readonly appendedFirst: number;
  readonly appendedEnd: number;
  /** Storage ranges are diagnostic only. Selection always uses absolute indices. */
  readonly physicalWrites: readonly {first: number; count: number}[];
  readonly physicalKind: 'ring-slots-for-dense-columns';
  /** Configured paged data sets can contain promoted dense columns as well.
   * This envelope applies only to columns that still use absolute pages. */
  readonly pagedWrites?: {readonly firstPage: number; readonly pageCount: number};
}
export type SourceDeltaResult = {delta: CertifiedSourceDelta; reason?: never} | {delta?: never; reason: string};

const producers = new WeakMap<object, SourceCertificate>();
const issued = new WeakSet<object>();
let nextProducer = 1;
const sameHeader = (a: SourceHeader, b: SourceHeader): boolean =>
  a.revision === b.revision && a.epoch === b.epoch && a.first === b.first && a.next === b.next &&
  a.capacity === b.capacity && a.head === b.head && a.paged === b.paged && a.pageSize === b.pageSize && a.disposed === b.disposed;
const valid = (h: SourceHeader): boolean =>
  [h.revision, h.epoch, h.first, h.next, h.capacity, h.head, h.pageSize].every(Number.isSafeInteger) &&
  h.revision >= 0 && h.epoch >= 0 && h.first >= 0 && h.next >= h.first && h.capacity >= 0 &&
  h.next - h.first <= h.capacity && h.head >= 0 && (h.capacity ? h.head < h.capacity : h.head === 0) && h.pageSize > 0;

function publish(owner: object, header: SourceHeader, reason: string, preserveLineage: boolean): SourceCertificate {
  const old = producers.get(owner);
  const record: SourceCertificate = Object.freeze({...header,
    producer: old?.producer ?? nextProducer++, serial: (old?.serial ?? 0) + 1,
    lineage: (old?.lineage ?? 0) + Number(!preserveLineage), reason,
    tainted: reason === 'append-failed-or-listener-threw' || reason === 'unproved-reentrant-append' || !!old?.tainted && old.epoch === header.epoch});
  producers.set(owner, record); issued.add(record);
  return record;
}

/** Captured before any user getter, copy or mutation can re-enter the producer. */
export function beginSourceAppend(owner: object, header: SourceHeader): AppendTicket {
  const before = Object.freeze({...header});
  const prior = producers.get(owner);
  return Object.freeze({before, prior});
}

/** Called after the complete source write, before the change event is emitted. */
export function commitSourceChange(owner: object, header: SourceHeader, ticket?: AppendTicket): SourceCertificate {
  const prior = producers.get(owner);
  const before = ticket?.before;
  const append = !!before && valid(before) && valid(header) && !before.disposed && !header.disposed &&
    ticket!.prior === prior && (!prior || sameHeader(prior, before)) &&
    header.revision === before.revision + 1 && header.epoch === before.epoch &&
    header.next > before.next && header.first >= before.first &&
    header.capacity === before.capacity && header.paged === before.paged && header.pageSize === before.pageSize;
  const reentered = !!ticket && ticket.prior !== prior && before?.epoch === header.epoch && before?.capacity === header.capacity;
  return publish(owner, header, append ? 'certified-append' : reentered ? 'unproved-reentrant-append' : 'unproved-change', append);
}

/** Representation changes and failures break the lineage even without revision changes. */
export function invalidateSourceCertificate(owner: object, header: SourceHeader, reason: string): void {
  publish(owner, header, reason, false);
}

export function readSourceCertificate(owner: object, expected?: Pick<SourceHeader, 'revision' | 'epoch' | 'first' | 'next'>): SourceCertificate | undefined {
  const record = producers.get(owner);
  if (!record || record.disposed || !valid(record)) return undefined;
  if (expected && (record.revision !== expected.revision || record.epoch !== expected.epoch || record.first !== expected.first || record.next !== expected.next)) return undefined;
  return record;
}

/** Proves an arbitrary number of commits, not just a revision increment of one. */
export function certifySourceDelta(owner: object, previous: SourceCertificate | undefined, expected: Pick<SourceHeader, 'revision' | 'epoch' | 'first' | 'next'>): SourceDeltaResult {
  const current = readSourceCertificate(owner, expected);
  if (!current) return {reason: 'missing-or-mismatched-producer-certificate'};
  if (current.tainted) return {reason: 'source-requires-new-content-epoch'};
  if (!previous || !issued.has(previous)) return {reason: 'missing-issued-previous-certificate'};
  if (previous.producer !== current.producer || previous.lineage !== current.lineage || previous.epoch !== current.epoch)
    return {reason: 'producer-lineage-changed'};
  if (current.serial < previous.serial || current.first < previous.first || current.next < previous.next)
    return {reason: 'source-sequence-regressed'};
  const stableFirst = Math.max(previous.first, current.first), stableEnd = previous.next;
  if (stableFirst >= stableEnd) return {reason: 'no-stable-retained-overlap'};
  const amount = current.next - previous.next;
  const physicalWrites: {first: number; count: number}[] = [];
  let pagedWrites: {firstPage: number; pageCount: number} | undefined;
  if (amount) {
    if (current.paged) {
      const first = Math.floor(Math.max(previous.next, current.first) / current.pageSize);
      const end = Math.ceil(current.next / current.pageSize);
      if (first < end) pagedWrites = {firstPage: first, pageCount: end - first};
    }
    if (amount >= current.capacity) physicalWrites.push({first: 0, count: current.capacity});
    else {
      const first = (previous.head + previous.next - previous.first) % current.capacity;
      const length = Math.min(amount, current.capacity - first);
      physicalWrites.push({first, count: length});
      if (length < amount) physicalWrites.push({first: 0, count: amount - length});
    }
  }
  return {delta: {kind: amount ? 'append-prefix' : 'unchanged', previous, current,
    stableFirst, stableEnd, appendedFirst: Math.max(previous.next, current.first), appendedEnd: current.next,
    physicalWrites, physicalKind: 'ring-slots-for-dense-columns', pagedWrites}};
}

/** A page needs both original neighbors before it can be an immutable interior.
 * The partial head, old tail and the page which just gained a right neighbor
 * deliberately stay on the original selector. */
export function certifiedCompletePageRange(delta: CertifiedSourceDelta, pageSize: number,
  previousVisibleFirst: number, previousVisibleEnd: number, visibleFirst: number, visibleEnd: number): {firstPage: number; endPage: number} {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1) throw new RangeError('Invalid selection page size');
  const first = Math.max(delta.stableFirst + 1, previousVisibleFirst, visibleFirst);
  const end = Math.min(delta.stableEnd - 1, previousVisibleEnd, visibleEnd);
  const firstPage = Math.ceil(first / pageSize), endPage = Math.max(firstPage, Math.floor(end / pageSize));
  return {firstPage, endPage};
}
