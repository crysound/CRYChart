import type {Rect} from './contracts.js';
import {containedRasterClip, type RasterClipFrame} from './raster-clip.js';

export interface StrokePixel {x: number; y: number;}
export interface StrokeViewport {x: number; y: number; width: number; height: number;}
export interface StrokeRegion {viewport: StrokeViewport; region: StrokeViewport; offsetX: number; offsetY: number;}

/** Framebuffer coordinates, with a lower-left origin. A scratch texture only
 * needs the intersection that can actually contribute to the destination. */
export function strokeRegion(rect: Rect, clip: Rect, dpr: number, bufferWidth: number, bufferHeight: number, containedFrame?: RasterClipFrame): StrokeRegion | undefined {
  if (containedFrame) {
    const region = containedRasterClip(rect, clip, containedFrame);
    if (!region) return undefined;
    const viewport = {...containedFrame.viewport};
    return {viewport, region, offsetX: region.x - viewport.x, offsetY: region.y - viewport.y};
  }
  if (![rect.left, rect.top, rect.width, rect.height, clip.left, clip.top, clip.width, clip.height, dpr, bufferWidth, bufferHeight].every(Number.isFinite) || dpr <= 0 || rect.width <= 0 || rect.height <= 0 || clip.width <= 0 || clip.height <= 0 || bufferWidth <= 0 || bufferHeight <= 0) return undefined;
  const viewport = {
    x: Math.round(rect.left * dpr),
    y: Math.round(bufferHeight - (rect.top + rect.height) * dpr),
    width: Math.max(1, Math.round(rect.width * dpr)),
    height: Math.max(1, Math.round(rect.height * dpr)),
  };
  const x = Math.max(0, viewport.x, Math.round(clip.left * dpr));
  const y = Math.max(0, viewport.y, Math.round(bufferHeight - (clip.top + clip.height) * dpr));
  const endX = Math.min(bufferWidth, viewport.x + viewport.width, Math.round((clip.left + clip.width) * dpr));
  const endY = Math.min(bufferHeight, viewport.y + viewport.height, Math.round(bufferHeight - clip.top * dpr));
  if (endX <= x || endY <= y) return undefined;
  return {viewport, region: {x, y, width: endX - x, height: endY - y}, offsetX: x - viewport.x, offsetY: y - viewport.y};
}

/** Four triangle-strip corners enclosing a round-cap segment's entire AA
 * support. Unlike a shared miter, this bound is independent of its neighbors. */
export function capsuleQuad(start: StrokePixel, end: StrokePixel, width: number): readonly StrokePixel[] {
  if (![start.x, start.y, end.x, end.y, width].every(Number.isFinite) || width <= 0) return [];
  const dx = end.x - start.x, dy = end.y - start.y, distance = Math.hypot(dx, dy);
  const tx = distance ? dx / distance : 1, ty = distance ? dy / distance : 0;
  const nx = -ty, ny = tx, radius = width / 2 + 1;
  return [-1, 1].flatMap(side => [
    {x: start.x + (side * nx - tx) * radius, y: start.y + (side * ny - ty) * radius},
    {x: end.x + (side * nx + tx) * radius, y: end.y + (side * ny + ty) * radius},
  ]);
}

export function segmentCoverage(point: StrokePixel, start: StrokePixel, end: StrokePixel, width: number): number {
  if (![point.x, point.y, start.x, start.y, end.x, end.y, width].every(Number.isFinite) || width <= 0) return 0;
  const dx = end.x - start.x, dy = end.y - start.y, squared = dx * dx + dy * dy;
  const t = squared ? Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / squared)) : 0;
  const distance = Math.hypot(point.x - start.x - t * dx, point.y - start.y - t * dy);
  return Math.max(0, Math.min(1, width / 2 + .5 - distance));
}

/** The intended mask semantics: a stroke is the union of finite segments,
 * including caps. Alpha is applied once after taking the maximum coverage. */
export function strokeCoverage(point: StrokePixel, points: readonly StrokePixel[], width: number): number {
  let coverage = 0;
  for (let i = 1; i < points.length; i++) coverage = Math.max(coverage, segmentCoverage(point, points[i - 1]!, points[i]!, width));
  return coverage;
}
