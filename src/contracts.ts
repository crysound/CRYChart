import type {Icon} from './custom-icon.js';
export type Point = {
  x: number;
  y: number;
  z?: number;
  angle?: number;
  amplitude?: number;
  [key: string]: unknown;
};
export type Interval = { start: number; end: number };
export type Mutator<T> = T | ((previous: T) => T);
export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}
export interface PlotDomain {
  x: Interval;
  y: Interval;
  z?: Interval;
}
export interface DrawPacket {
  id: number;
  /** Consecutive packets belonging to one solid stroke. Coverage is merged
   * before compositing its color, including block-boundary caps. */
  strokeGroup?: number;
  revision: number;
  positions: Float32Array;
  count: number;
  dimensions: 2 | 3;
  mode: "line" | "points" | "triangles";
  color: [number, number, number, number];
  thickness: number;
  pointSize: number;
  pointShape?: number;
  /** Actual bitmap shape. Intrinsic RGBA is preserved rather than tinted as a vector shape. */
  pointIcon?: Icon;
  pointRotation?: number;
  dashPattern?: readonly number[];
  colors?: Float32Array;
  pointSizes?: Float32Array;
  pointRotations?: Float32Array;
  pointStrokeColor?: [number, number, number, number];
  pointStrokeThickness?: number;
  /** Consecutive append optimization, valid only if the renderer has previousRevision. */
  updateFrom?: number;
  previousRevision?: number;
  /** Position-pair patches relative to previousRevision. Valid only while the
   * uploader retains that exact revision and enough GPU storage; otherwise it
   * uploads the complete positions. Includes cap/halo edits as well as appends. */
  dirtySampleRanges?: readonly {first: number; count: number}[];
  /** Verified nondecreasing finite projected X values, for lossless viewport culling. */
  monotonicX?: boolean;
  /** No repeated X coordinates: permits sharing line joins without reversal ambiguity. */
  strictlyMonotonicX?: boolean;
  origin: { x: number; y: number; z: number };
  domain: PlotDomain;
  logarithmic?: { x: boolean; y: boolean };
  /** Optional clipping rectangle in chart CSS pixels for axes in separate stacks. */
  clipRect?: Rect;
  /** Optional owned sample range; surrounding stored samples supply line-join halos only. */
  drawFirst?: number;
  drawCount?: number;
}
export interface RenderHost {
  invalidate(): void;
  removeSeries(series: unknown): void;
  getDefaultAxisX(): any;
  getDefaultAxisY(): any;
  getDefaultAxisZ?(): any;
}
export class UnsupportedFeatureError extends Error {
  constructor(feature: string) {
    super(`CRYChart does not yet implement ${feature}`);
    this.name = "UnsupportedFeatureError";
  }
}
