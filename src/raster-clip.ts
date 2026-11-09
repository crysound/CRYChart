import type {Rect} from './contracts.js';

/** Legacy is deliberately separate: existing pipelines have different clip
 * intersections. Only the explicit contained candidate uses this contract. */
export type GpuClipPolicy = 'legacy' | 'contained';
export interface PixelRect {x: number; y: number; width: number; height: number;}
export interface RasterClipFrame {
  readonly width: number;
  readonly height: number;
  /** CSS top-left coordinates map to target top-left pixels using this transform. */
  readonly scaleX: number;
  readonly scaleY: number;
  readonly offsetX: number;
  readonly offsetY: number;
  /** Original lower-left projection viewport. Clipping never changes it. */
  readonly viewport: Readonly<PixelRect>;
}
/** Actual destination metadata, supplied by the attachment owner. A default
 * drawing buffer size must never stand in for a custom FBO attachment size.
 * Treat this descriptor as immutable throughout a render batch. */
export interface RasterTarget extends RasterClipFrame {
  readonly framebuffer: WebGLFramebuffer | null;
}

const finiteRect = (rect: Rect): void => {
  if (![rect.left, rect.top, rect.width, rect.height, rect.left + rect.width, rect.top + rect.height].every(Number.isFinite))
    throw new RangeError('Raster clip rectangles must be finite');
};
export function validateRasterFrame(frame: RasterClipFrame): void {
  if (!frame || !Number.isSafeInteger(frame.width) || !Number.isSafeInteger(frame.height) || frame.width < 0 || frame.height < 0 ||
      ![frame.scaleX, frame.scaleY, frame.offsetX, frame.offsetY].every(Number.isFinite) || frame.scaleX <= 0 || frame.scaleY <= 0)
    throw new RangeError('Raster target dimensions and transform must be finite and valid');
  const viewport = frame.viewport;
  if (!viewport || ![viewport.x, viewport.y, viewport.width, viewport.height, viewport.x + viewport.width, viewport.y + viewport.height].every(Number.isSafeInteger) || viewport.width < 0 || viewport.height < 0)
    throw new RangeError('Raster projection viewport must contain integer pixel bounds');
}
export function requireRasterTarget(target: RasterTarget | undefined): RasterTarget {
  if (!target || target.framebuffer === undefined)
    throw new TypeError('Contained GPU clipping requires an explicit destination rasterTarget');
  validateRasterFrame(target);
  return target;
}

/** Preserve the chart's existing viewport rounding. The target dimensions must
 * be the real allocated default backing store or custom attachment dimensions. */
export function rasterTargetForRect(framebuffer: WebGLFramebuffer | null, width: number, height: number, rect: Rect, dpr: number): RasterTarget {
  finiteRect(rect);
  if (!Number.isFinite(dpr) || dpr <= 0) throw new RangeError('Raster target DPR must be positive and finite');
  const target: RasterTarget = {framebuffer, width, height, scaleX: dpr, scaleY: dpr, offsetX: 0, offsetY: 0,
    viewport: {x: Math.round(rect.left * dpr), y: Math.round(height - (rect.top + rect.height) * dpr),
      width: Math.max(1, Math.round(rect.width * dpr)), height: Math.max(1, Math.round(rect.height * dpr))}};
  validateRasterFrame(target);
  return target;
}

/** Returns only complete target-pixel squares inside plot AND optional clip,
 * then intersects the actual target and unchanged projection viewport.
 * Negative/zero CSS area is empty; it is not an axis-reversal instruction.
 * No epsilon is used at integer boundaries and no empty clip expands to 1px. */
export function containedRasterClip(plot: Rect, clip: Rect | undefined, frame: RasterClipFrame): PixelRect | undefined {
  validateRasterFrame(frame); finiteRect(plot); if (clip) finiteRect(clip);
  const selected = clip ?? plot;
  if (plot.width <= 0 || plot.height <= 0 || selected.width <= 0 || selected.height <= 0 || frame.width === 0 || frame.height === 0) return undefined;
  const left = Math.max(plot.left, selected.left), right = Math.min(plot.left + plot.width, selected.left + selected.width);
  const top = Math.max(plot.top, selected.top), bottom = Math.min(plot.top + plot.height, selected.top + selected.height);
  if (right <= left || bottom <= top) return undefined;
  const continuous = [frame.offsetX + left * frame.scaleX, frame.offsetX + right * frame.scaleX,
    frame.height - (frame.offsetY + bottom * frame.scaleY), frame.height - (frame.offsetY + top * frame.scaleY)];
  if (!continuous.every(Number.isFinite)) throw new RangeError('Raster clip transform overflow');
  const viewport = frame.viewport;
  const x = Math.max(0, viewport.x, Math.ceil(continuous[0]!));
  const y = Math.max(0, viewport.y, Math.ceil(continuous[2]!));
  const endX = Math.min(frame.width, viewport.x + viewport.width, Math.floor(continuous[1]!));
  const endY = Math.min(frame.height, viewport.y + viewport.height, Math.floor(continuous[3]!));
  return endX > x && endY > y ? {x, y, width: endX - x, height: endY - y} : undefined;
}
