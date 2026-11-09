/** Each segment stores a bounded dash phase and its physical end distance. */
export function dashDistances(
  positions: Float32Array,
  scaleX: number,
  scaleY: number,
  period: number,
): Float32Array {
  if (!(period > 0) || !Number.isFinite(period))
    throw new RangeError("Dash period must be positive and finite");
  const count = Math.floor(positions.length / 2),
    distances = new Float32Array(Math.max(0, count - 1) * 2);
  let phase = 0;
  for (let i = 1; i < count; i++) {
    const x0 = positions[(i - 1) * 2]!,
      y0 = positions[(i - 1) * 2 + 1]!,
      x1 = positions[i * 2]!,
      y1 = positions[i * 2 + 1]!;
    if (![x0, y0, x1, y1].every(Number.isFinite)) {
      phase = 0;
      continue;
    }
    const length = Math.hypot((x1 - x0) * scaleX, (y1 - y0) * scaleY);
    distances[(i - 1) * 2] = phase;
    distances[(i - 1) * 2 + 1] = phase + length;
    phase = (phase + length) % period;
  }
  return distances;
}

export function dashPattern(pattern: readonly number[], scale = 1): number[] {
  if (
    !Number.isFinite(scale) ||
    scale <= 0 ||
    pattern.some((value) => !Number.isFinite(value) || value < 0)
  )
    throw new RangeError(
      "Dash pattern lengths must be finite and nonnegative, with positive scale",
    );
  const values = (
    pattern.length % 2 ? [...pattern, ...pattern] : [...pattern]
  ).map((value) => value * scale);
  if (values.length > 16)
    throw new RangeError("Dash patterns support up to 16 alternating lengths");
  return values.some((value) => value > 0) ? values : [];
}

/** Cubic Hermite interpolation with neighboring secants; missing samples split curves. */
export function splinePositions(
  points: Float32Array,
  subdivisions = 16,
): Float32Array {
  if (
    !Number.isSafeInteger(subdivisions) ||
    subdivisions < 1 ||
    subdivisions > 256
  )
    throw new RangeError("Spline subdivisions must be between 1 and 256");
  const output: number[] = [];
  let begin = 0;
  const count = Math.floor(points.length / 2),
    valid = (i: number) =>
      i >= 0 &&
      i < count &&
      Number.isFinite(points[i * 2]) &&
      Number.isFinite(points[i * 2 + 1]);
  while (begin < count) {
    while (begin < count && !valid(begin)) begin++;
    if (begin >= count) break;
    let end = begin;
    while (end + 1 < count && valid(end + 1)) end++;
    if (output.length) output.push(NaN, NaN);
    output.push(points[begin * 2]!, points[begin * 2 + 1]!);
    for (let i = begin; i < end; i++)
      for (let j = 1; j <= subdivisions; j++) {
        const t = j / subdivisions,
          t2 = t * t,
          t3 = t2 * t;
        for (let d = 0; d < 2; d++) {
          const a = points[i * 2 + d]!,
            b = points[(i + 1) * 2 + d]!;
          const m0 = i === begin ? b - a : (b - points[(i - 1) * 2 + d]!) / 2;
          const m1 = i + 1 === end ? b - a : (points[(i + 2) * 2 + d]! - a) / 2;
          output.push(
            (2 * t3 - 3 * t2 + 1) * a +
              (t3 - 2 * t2 + t) * m0 +
              (-2 * t3 + 3 * t2) * b +
              (t3 - t2) * m1,
          );
        }
      }
    begin = end + 1;
  }
  return new Float32Array(output);
}
