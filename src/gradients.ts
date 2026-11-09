import { Color, ColorRGBA, type FillStyle } from "./core/styles.js";
import type { Rect } from "./contracts.js";

export interface ColorStop {
  color: Color;
  offset: number;
}
export interface LinearGradientFillStyleProperties {
  type: "fillstyle";
  fillType: "linear-gradient";
  stops: ColorStop[];
  angle: number;
}

function isColorValue(value: unknown): value is Color {
  if (!value || typeof value !== 'object') return false;
  const color = value as Partial<Color>;
  return [color.r, color.g, color.b, color.a].every(channel => typeof channel === 'number' && Number.isFinite(channel) && channel >= 0 && channel <= 1)
    && typeof color.toCSS === 'function' && typeof color.getR === 'function' && typeof color.getG === 'function'
    && typeof color.getB === 'function' && typeof color.getA === 'function';
}

/** Immutable gradient. Zero degrees points up; positive angles turn clockwise. */
export class LinearGradientFill implements FillStyle {
  readonly kind = "linear-gradient";
  readonly type = "fillstyle";
  readonly fillType = "linear-gradient";
  private readonly stops: readonly Readonly<ColorStop>[];
  private readonly angle: number;
  constructor(options: Partial<LinearGradientFillStyleProperties> = {}) {
    this.angle = options.angle ?? 0;
    if (!Number.isFinite(this.angle))
      throw new RangeError("Gradient angle must be finite");
    const stops = options.stops ?? [
      { offset: 0, color: ColorRGBA(0, 0, 0) },
      { offset: 1, color: ColorRGBA(255, 255, 255) },
    ];
    this.stops = Object.freeze(
      stops
        .map((stop) => {
          if (
            !Number.isFinite(stop.offset) ||
            stop.offset < 0 ||
            stop.offset > 1
          )
            throw new RangeError("Gradient offsets must lie between 0 and 1");
          if (!isColorValue(stop.color))
            throw new TypeError("Gradient stops require Color values");
          return Object.freeze({ ...stop });
        })
        .sort((a, b) => a.offset - b.offset),
    );
    Object.freeze(this);
  }
  setColorStops(stops: ColorStop[]): this {
    return new LinearGradientFill({ stops, angle: this.angle }) as this;
  }
  getColorStops(): ColorStop[] {
    return this.stops.map((stop) => ({ ...stop }));
  }
  setAngle(angle: number, isRadians = false): this {
    return new LinearGradientFill({
      stops: this.getColorStops(),
      angle: isRadians ? (angle * 180) / Math.PI : angle,
    }) as this;
  }
  getAngle(isRadians = false): number {
    return isRadians ? (this.angle * Math.PI) / 180 : this.angle;
  }
  /** Representative color for legends and non-gradient swatches. */
  getColor(): Color {
    return this.sample(0.5);
  }
  sample(offset: number): Color {
    if (!this.stops.length || !Number.isFinite(offset))
      return ColorRGBA(0, 0, 0, 0);
    let left = this.stops[0]!;
    if (offset < left.offset) return left.color;
    for (let i = 1; i < this.stops.length; i++) {
      const right = this.stops[i]!;
      if (offset < right.offset) {
        const t = (offset - left.offset) / (right.offset - left.offset),
          a = left.color,
          b = right.color;
        return new Color(
          a.r + (b.r - a.r) * t,
          a.g + (b.g - a.g) * t,
          a.b + (b.b - a.b) * t,
          a.a + (b.a - a.a) * t,
        );
      }
      left = right;
    }
    return left.color;
  }
  hasVisibleStops(): boolean {
    return this.stops.some((stop) => stop.color.a > 0);
  }
}

/** Support lines of the box projected onto the gradient direction. */
export function gradientEndpoints(
  bounds: Rect,
  angle: number,
): { x0: number; y0: number; x1: number; y1: number } {
  const radians = (angle * Math.PI) / 180,
    dx = Math.sin(radians),
    dy = -Math.cos(radians);
  const radius =
    (Math.abs(dx) * bounds.width + Math.abs(dy) * bounds.height) / 2;
  const cx = bounds.left + bounds.width / 2,
    cy = bounds.top + bounds.height / 2;
  return {
    x0: cx - dx * radius,
    y0: cy - dy * radius,
    x1: cx + dx * radius,
    y1: cy + dy * radius,
  };
}

export function canvasGradient(
  context: CanvasRenderingContext2D,
  fill: LinearGradientFill,
  bounds: Rect,
): CanvasGradient {
  const p = gradientEndpoints(bounds, fill.getAngle()),
    gradient = context.createLinearGradient(p.x0, p.y0, p.x1, p.y1);
  for (const stop of fill.getColorStops())
    gradient.addColorStop(stop.offset, stop.color.toCSS());
  return gradient;
}
