import { Color, type LUT } from "./core/styles.js";

export function writeColor(
  target: Float32Array | number[],
  offset: number,
  color: Color,
): void {
  target[offset] = color.r;
  target[offset + 1] = color.g;
  target[offset + 2] = color.b;
  target[offset + 3] = color.a;
}

/** Insert palette boundaries so RGB interpolation cannot skip a LUT stop. */
export function colorMappedLine(
  positions: Float32Array,
  values: Float64Array,
  lut: LUT,
): { positions: Float32Array; colors: Float32Array } {
  const count = positions.length / 2,
    output: number[] = [],
    colors: number[] = [],
    steps = lut.getSteps(),
    continuous = lut.getInterpolation();
  const emit = (
    x: number,
    y: number,
    value: number,
    color = lut.getColor(value),
  ) => {
    output.push(x, y);
    writeColor(colors, colors.length, color);
  };
  if (!continuous && count > 1) {
    for (let i = 1; i < count; i++) {
      const ax = positions[(i - 1) * 2]!,
        ay = positions[(i - 1) * 2 + 1]!,
        bx = positions[i * 2]!,
        by = positions[i * 2 + 1]!,
        a = values[i - 1]!,
        b = values[i]!;
      if (![ax, ay, bx, by].every(Number.isFinite)) {
        emit(NaN, NaN, NaN);
        continue;
      }
      const boundaries = [
        0,
        ...(Number.isFinite(a) && Number.isFinite(b) && a !== b
          ? steps
              .map((step) => (step.value - a) / (b - a))
              .filter((t) => t > 0 && t < 1)
          : []),
        1,
      ].sort((x, y) => x - y);
      for (let j = 1; j < boundaries.length; j++) {
        const t0 = boundaries[j - 1]!,
          t1 = boundaries[j]!,
          mid = a + ((b - a) * (t0 + t1)) / 2,
          c = lut.getColor(mid);
        emit(ax + (bx - ax) * t0, ay + (by - ay) * t0, mid, c);
        emit(ax + (bx - ax) * t1, ay + (by - ay) * t1, mid, c);
      }
    }
    return {
      positions: new Float32Array(output),
      colors: new Float32Array(colors),
    };
  }
  for (let i = 0; i < count; i++) {
    const x = positions[i * 2]!,
      y = positions[i * 2 + 1]!,
      value = values[i]!;
    if (i > 0) {
      const px = positions[(i - 1) * 2]!,
        py = positions[(i - 1) * 2 + 1]!,
        previous = values[i - 1]!;
      if (
        [px, py, x, y, previous, value].every(Number.isFinite) &&
        previous !== value
      ) {
        const crossings = steps
          .map((step) => ({
            t: (step.value - previous) / (value - previous),
            value: step.value,
          }))
          .filter((step) => step.t > 0 && step.t < 1)
          .sort((a, b) => a.t - b.t);
        for (const cross of crossings) {
          const cx = px + (x - px) * cross.t,
            cy = py + (y - py) * cross.t;
          if (continuous) emit(cx, cy, cross.value);
          else {
            const leftValue =
                previous + (value - previous) * Math.max(0, cross.t - 1e-8),
              rightValue =
                previous + (value - previous) * Math.min(1, cross.t + 1e-8);
            emit(cx, cy, leftValue);
            emit(cx, cy, rightValue);
          }
        }
      }
    }
    emit(x, y, value);
  }
  return {
    positions: new Float32Array(output),
    colors: new Float32Array(colors),
  };
}
