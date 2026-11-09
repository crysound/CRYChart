import {
  Color,
  ColorRGBA,
  resolveValue,
  type FillStyle,
  type ValueOrMutator,
} from "./core/styles.js";

/** Use the color stored with each point, falling back for samples without one. */
export class IndividualPointFill implements FillStyle {
  readonly kind = "individual";
  readonly type = "fillstyle";
  readonly fillType = "individual";
  private readonly color: Color;
  constructor(options: { color?: Color } = {}) {
    this.color = options.color ?? ColorRGBA(255, 255, 255);
    Object.freeze(this);
  }
  getColor(): Color {
    return this.color;
  }
  getFallbackColor(): Color {
    return this.color;
  }
  setFallbackColor(value: ValueOrMutator<Color>): this {
    return new IndividualPointFill({
      color: resolveValue(value, this.color),
    }) as this;
  }
}
