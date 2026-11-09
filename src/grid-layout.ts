/** Original tick arithmetic. Sizes are CSS pixels, independent of framebuffer DPR. */
export interface TickPositions { major: number[]; minor: number[]; step: number; }
export function niceNumericStep(span: number, targetIntervals: number): number {
  if (!(span > 0) || !Number.isFinite(span)) return NaN;
  const ideal = span / Math.max(1, targetIntervals), power = 10 ** Math.floor(Math.log10(ideal));
  if (!(power > 0) || !Number.isFinite(power)) return span;
  const n = ideal / power;
  // Major levels use the 1/5/10 decimal hierarchy. The halfway boundaries are
  // geometric means, giving the same density decision after a change of units.
  // The public 6/12/20/25/40/60/100/200/600-span observations constrain this
  // original model; this is not a claim about the reference implementation.
  return (n < Math.sqrt(5) ? 1 : n < Math.sqrt(50) ? 5 : 10) * power;
}
export function steppedTickPositions(low: number, high: number, step: number, limit = 1000): number[] {
  if (!Number.isFinite(low) || !Number.isFinite(high) || !(step > 0) || !Number.isFinite(step)) return [];
  const first = Math.ceil(low / step - 1e-10), last = Math.floor(high / step + 1e-10);
  const decimals = Math.max(0, -Math.floor(Math.log10(step)) + 1);
  const result: number[] = [];
  for (let n = 0; n < limit && first + n <= last; n++) {
    const product=(first+n)*step;
    // Decimal cleanup must retain tiny IEEE values. toFixed is defined up to
    // 100 digits; smaller magnitudes use significant digits instead of zeroing
    // the entire interval through a fixed fifteen-place cap.
    const value = Number(decimals<=100?product.toFixed(decimals):product.toPrecision(17));
    if (value < low || value > high || Object.is(value, result[result.length - 1])) continue;
    result.push(value === 0 ? 0 : value);
  }
  return result;
}
export function numericTickPositions(start: number, end: number, axisSizePixels: number, intervalCount?: number): TickPositions {
  const low = Math.min(start, end), high = Math.max(start, end);
  // The default 12px-label policy is constrained by both the 495px Y domain
  // and the previously observed 682.906px X domain. Use one spacing policy
  // across orientations and resizes; do not switch on a particular range.
  const step = niceNumericStep(high - low, intervalCount ?? Math.max(2, axisSizePixels / 85));
  const major = steppedTickPositions(low, high, step), all = steppedTickPositions(low, high, step / 5);
  const minorSpacing=axisSizePixels*(step/5)/(high-low);
  const minor = minorSpacing>=14?all.filter(v => Math.abs(v / step - Math.round(v / step)) > 1e-8):[];
  return { major, minor, step };
}
export function logarithmicTickPositions(start: number, end: number): TickPositions {
  const low = Math.min(start, end), high = Math.max(start, end), major: number[] = [], minor: number[] = [];
  if (!(low > 0) || !Number.isFinite(high)) return { major, minor, step: NaN };
  for (let exponent = Math.floor(Math.log10(low)); exponent <= Math.ceil(Math.log10(high)); exponent++) {
    const decade = 10 ** exponent;
    for (let multiplier = 1; multiplier <= 9; multiplier++) {
      const value = decade * multiplier;
      if (value >= low && value <= high) (multiplier === 1 ? major : minor).push(value);
    }
  }
  return { major, minor, step: NaN };
}
