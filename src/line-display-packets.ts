import type { DrawPacket } from './contracts.js';

/** Independent experiment only. The selector still decides every retained
 * display index. This stage only partitions its already projected geometry. */
export interface DisplayPageChunk {
  /** Stable page and boundary-role identity within one selector generation. */
  key: string;
  positions: Float32Array;
  first: number;
  count: number;
  /** Must describe the submitted slice, not merely its source schema. */
  strictlyMonotonicX: boolean;
}

export type PagePacketTemplate = Pick<DrawPacket,
  'origin' | 'domain' | 'clipRect' | 'color' | 'thickness' | 'strokeGroup'>;

interface Entry {
  packet: DrawPacket;
  source?: Float32Array;
  first: number;
  count: number;
  bridge: boolean;
}

export interface PagePacketStats {
  sourceDisplaySamples: number;
  submittedSegments: number;
  geometryPackets: number;
  bridgePackets: number;
  newPackets: number;
  changedPackets: number;
  reusedPackets: number;
  evictedPackets: number;
  /** Input bytes whose packet revision changed, not measured GL uploads. */
  dirtyPositionBytes: number;
  allocatedBridgeBytes: number;
  borrowedProjectionBytes: number;
}

let nextPacketId = -(2 ** 46);

/** A coverage-union-only experiment. Interior page segments use their original
 * Float32 views. Exactly one two-point bridge owns each inter-page segment.
 * All packets must be submitted together under the same strokeGroup; this
 * class does not claim compatible miter geometry in the older strip renderer.
 * Call clear() when source identity/content epoch or projection origin changes.
 */
export class DisplayPagePacketCache {
  private entries = new Map<string, Entry>();
  private disposed = false;

  update(chunks: readonly DisplayPageChunk[], template: PagePacketTemplate): {
    packets: readonly DrawPacket[]; stats: PagePacketStats;
  } {
    if (this.disposed) throw new Error('Display page packet cache is disposed');
    if (!Number.isSafeInteger(template.strokeGroup)) throw new TypeError('A stable logical strokeGroup is required');
    const keys = new Set<string>();
    // Validate before changing resident entries. The selector's borrowed
    // arrays remain immutable during this call and until its next update.
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]!;
      if (keys.has(chunk.key)) throw new TypeError('Display chunk keys must be unique');
      keys.add(chunk.key);
      if (!Number.isSafeInteger(chunk.first) || !Number.isSafeInteger(chunk.count) ||
          chunk.first < 0 || chunk.count < 1 || (chunk.first + chunk.count) * 2 > chunk.positions.length)
        throw new RangeError('Display page slice exceeds its projected array');
      if (!chunk.strictlyMonotonicX) throw new TypeError('Display page packets require strict projected X');
      const previous = chunks[i - 1];
      if (previous && !(chunk.positions[chunk.first * 2]! > previous.positions[(previous.first + previous.count - 1) * 2]!))
        throw new TypeError('Display pages overlap or reverse X');
    }
    const stats: PagePacketStats = {
      sourceDisplaySamples: 0, submittedSegments: 0, geometryPackets: 0,
      bridgePackets: 0, newPackets: 0, changedPackets: 0, reusedPackets: 0,
      evictedPackets: 0, dirtyPositionBytes: 0, allocatedBridgeBytes: 0,
      borrowedProjectionBytes: 0,
    };
    const live = new Set<string>(), packets: DrawPacket[] = [];
    const publish = (key: string, positions: Float32Array, first: number, count: number, bridge: boolean): DrawPacket => {
      live.add(key);
      let entry = this.entries.get(key), changed = false;
      if (!entry) {
        const id = nextPacketId--;
        if (!Number.isSafeInteger(id)) throw new RangeError('Display page packet IDs exhausted');
        entry = { first, count, bridge, packet: {
          id, revision: 0, positions: bridge ? new Float32Array(4) : positions.subarray(first * 2, (first + count) * 2),
          count, dimensions: 2, mode: 'line', pointSize: 0,
          monotonicX: true, strictlyMonotonicX: true, ...template,
        } };
        this.entries.set(key, entry); stats.newPackets++; changed = true;
      }
      if (bridge) {
        const target = entry.packet.positions;
        for (let i = 0; i < 4; i++) if (!Object.is(target[i], positions[i])) { target[i] = positions[i]!; changed = true; }
      } else if (entry.source !== positions || entry.first !== first || entry.count !== count) {
        entry.packet.positions = positions.subarray(first * 2, (first + count) * 2);
        entry.source = positions; entry.first = first; entry.count = count; changed = true;
      }
      if (changed) {
        entry.packet.revision++; stats.changedPackets++; stats.dirtyPositionBytes += count * 8;
      } else stats.reusedPackets++;
      Object.assign(entry.packet, template, { count });
      packets.push(entry.packet);
      stats.submittedSegments += count - 1;
      if (bridge) stats.bridgePackets++; else stats.geometryPackets++;
      return entry.packet;
    };
    // A single reusable scratch avoids one temporary typed array per seam.
    const bridgeValues = new Float32Array(4);
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]!;
      stats.sourceDisplaySamples += chunk.count;
      if (chunk.count >= 2) publish(`p:${chunk.key}`, chunk.positions, chunk.first, chunk.count, false);
      const next = chunks[i + 1];
      if (next) {
        const lastOffset = (chunk.first + chunk.count - 1) * 2, nextOffset = next.first * 2;
        bridgeValues[0] = chunk.positions[lastOffset]!; bridgeValues[1] = chunk.positions[lastOffset + 1]!;
        bridgeValues[2] = next.positions[nextOffset]!; bridgeValues[3] = next.positions[nextOffset + 1]!;
        publish(`b:${chunk.key.length}:${chunk.key}${next.key}`, bridgeValues, 0, 2, true);
      }
    }
    for (const [key] of this.entries) if (!live.has(key)) { this.entries.delete(key); stats.evictedPackets++; }
    const borrowed = new Set<ArrayBufferLike>();
    for (const entry of this.entries.values()) {
      if (entry.bridge) stats.allocatedBridgeBytes += entry.packet.positions.byteLength;
      else if (entry.source) borrowed.add(entry.source.buffer);
    }
    for (const buffer of borrowed) stats.borrowedProjectionBytes += buffer.byteLength;
    if (stats.submittedSegments !== Math.max(0, stats.sourceDisplaySamples - 1)) throw new Error('Display segment ownership is inconsistent');
    return { packets, stats };
  }

  clear(): void { this.entries.clear(); }
  dispose(): void { if (this.disposed) return; this.clear(); this.disposed = true; }
}
