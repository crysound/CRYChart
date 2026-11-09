import type {Rect} from './contracts.js';

export interface Axis3DTickRequest {
  axis: number;
  order: number;
  text: string;
  preferred: {x: number; y: number};
  tangent: {x: number; y: number};
  outward: {x: number; y: number};
}
export interface Axis3DTickPlacement extends Axis3DTickRequest {
  x: number;
  y: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
  displacement: number;
  overlapArea: number;
  withinBounds: boolean;
  withinDisplacement: boolean;
  orderPreserved: boolean;
  resolved: boolean;
}
export interface Axis3DTickLayout {
  labels: Axis3DTickPlacement[];
  unresolvedCount: number;
}

/** Arrange only 3D tick text. Values, axis domains and data projections are not
 * inputs to this helper. All requested strings are retained, including when a
 * very small canvas cannot accommodate them. */
export function layoutAxis3DTicks(
  context: Pick<CanvasRenderingContext2D, 'measureText'>,
  requests: readonly Axis3DTickRequest[],
  bounds: Rect,
  options: {gap?: number; maximumDisplacement?: number} = {},
): Axis3DTickLayout {
  const gap = options.gap ?? 2, maximumDisplacement = options.maximumDisplacement ?? 64;
  const pad = 2, left = bounds.left + pad, right = bounds.left + bounds.width - pad;
  const top = bounds.top + pad, bottom = bounds.top + bounds.height - pad;
  const metrics = new Map<string, {left: number; right: number; ascent: number; descent: number}>();
  const measurements = (text: string) => {
    let measured = metrics.get(text);
    if (!measured) {
      const value = context.measureText(text);
      const finite = (number: number, fallback: number) => Number.isFinite(number) ? number : fallback;
      measured = {left: finite(value.actualBoundingBoxLeft, value.width / 2), right: finite(value.actualBoundingBoxRight, value.width / 2),
        ascent: finite(value.actualBoundingBoxAscent, 11), descent: finite(value.actualBoundingBoxDescent, 3)};
      metrics.set(text, measured);
    }
    return measured;
  };
  const placed: Axis3DTickPlacement[] = [], result: Axis3DTickPlacement[] = new Array(requests.length);
  const previous = new Map<number, {order: number; projected: number}>();
  const ordered = requests.map((request, index) => ({request, index})).sort((a, b) => a.request.axis - b.request.axis || a.request.order - b.request.order || a.index - b.index);
  for (const {request, index} of ordered) {
    const text = measurements(request.text), length = Math.hypot(request.tangent.x, request.tangent.y);
    const tx = length > 1e-9 ? request.tangent.x / length : 1, ty = length > 1e-9 ? request.tangent.y / length : 0;
    let nx = -ty, ny = tx;
    if (nx * request.outward.x + ny * request.outward.y < 0) {nx = -nx; ny = -ny;}
    const prior = previous.get(request.axis);
    const candidate = (normal: number, slide: number): Axis3DTickPlacement => {
      let x = request.preferred.x + nx * normal + tx * slide, y = request.preferred.y + ny * normal + ty * slide;
      const minX = left + text.left, maxX = right - text.right, minY = top + text.ascent, maxY = bottom - text.descent;
      x = minX <= maxX ? Math.max(minX, Math.min(maxX, x)) : (left + right + text.left - text.right) / 2;
      y = minY <= maxY ? Math.max(minY, Math.min(maxY, y)) : (top + bottom + text.ascent - text.descent) / 2;
      const box = {left: x - text.left, top: y - text.ascent, right: x + text.right, bottom: y + text.descent};
      const overlapArea = placed.reduce((sum, other) => sum + Math.max(0, Math.min(box.right + gap, other.right) - Math.max(box.left - gap, other.left)) * Math.max(0, Math.min(box.bottom + gap, other.bottom) - Math.max(box.top - gap, other.top)), 0);
      const projected = x * tx + y * ty;
      const orderPreserved = !prior || request.order === prior.order || projected > prior.projected + .25;
      const withinBounds = box.left >= left && box.right <= right && box.top >= top && box.bottom <= bottom;
      const displacement = Math.hypot(x - request.preferred.x, y - request.preferred.y), withinDisplacement = displacement <= maximumDisplacement + 1e-9;
      return {...request, ...box, x, y, displacement, overlapArea, withinBounds, withinDisplacement, orderPreserved,
        resolved: withinBounds && withinDisplacement && orderPreserved && overlapArea === 0};
    };
    let best = candidate(0, 0);
    // Keep the usual placement without searching whenever it is already valid.
    // Only a collision uses the bounded outward and along-axis alternatives.
    if (!best.resolved) {
      const score = (value: Axis3DTickPlacement) => (value.withinBounds ? 0 : 1e12) + (value.withinDisplacement ? 0 : 1e11) + (value.orderPreserved ? 0 : 1e10) + value.overlapArea * 1e6 + value.displacement;
      let bestScore = score(best);
      for (const normal of [8, 16, 24, 32, 48, 64, -8, -16]) {
        if (Math.abs(normal) > maximumDisplacement) continue;
        for (const slide of [0, -4, 4, -8, 8, -12, 12]) {
          if (Math.hypot(normal, slide) > maximumDisplacement) continue;
          const next = candidate(normal, slide), nextScore = score(next);
          if (nextScore < bestScore) {best = next; bestScore = nextScore;}
        }
      }
    }
    placed.push(best); result[index] = best;
    previous.set(request.axis, {order: request.order, projected: best.x * tx + best.y * ty});
  }
  return {labels: result, unresolvedCount: result.filter(label => !label.resolved).length};
}
