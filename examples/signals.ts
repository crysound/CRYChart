/** Deterministic synthetic fixtures. No upstream sample data or assets are used. */
export type Point = { x: number; y: number };

export function random(seed = 1729): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export function waveform(length: number, sampleRate: number, frequency: number, amplitude = 1, start = 0): Point[] {
  if (!Number.isInteger(length) || length < 0 || !(sampleRate > 0)) throw new RangeError('Invalid sample geometry');
  return Array.from({ length }, (_, i) => {
    const x = (i + start) / sampleRate;
    return { x, y: amplitude * (Math.sin(2 * Math.PI * frequency * x) + 0.22 * Math.sin(2 * Math.PI * frequency * 3 * x)) };
  });
}

/** Iterative radix-two FFT, normalized as a single-sided amplitude spectrum. */
export function spectrum(samples: ArrayLike<number>, sampleRate: number): Point[] {
  const n = samples.length;
  if (n < 2 || (n & (n - 1)) !== 0 || !(sampleRate > 0)) throw new RangeError('FFT requires a power-of-two sample count and positive sample rate');
  const real = Float64Array.from(samples);
  const imag = new Float64Array(n);
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    while (j & bit) { j ^= bit; bit >>= 1; }
    j ^= bit;
    if (i < j) { const value = real[i]; real[i] = real[j]; real[j] = value; }
  }
  for (let width = 2; width <= n; width *= 2) {
    const half = width / 2;
    for (let start = 0; start < n; start += width) {
      for (let offset = 0; offset < half; offset++) {
        const angle = -2 * Math.PI * offset / width;
        const cosine = Math.cos(angle), sine = Math.sin(angle);
        const even = start + offset, odd = even + half;
        const re = real[odd] * cosine - imag[odd] * sine;
        const im = real[odd] * sine + imag[odd] * cosine;
        real[odd] = real[even] - re;
        imag[odd] = imag[even] - im;
        real[even] += re;
        imag[even] += im;
      }
    }
  }
  return Array.from({ length: n / 2 + 1 }, (_, k) => ({
    x: k * sampleRate / n,
    y: Math.hypot(real[k], imag[k]) * ((k === 0 || k === n / 2) ? 1 : 2) / n,
  }));
}

export function heatField(columns: number, rows: number, phase = 0): number[][] {
  return Array.from({ length: rows }, (_, y) => Array.from({ length: columns }, (_, x) => {
    const a = (x / columns - 0.5) * 5, b = (y / rows - 0.5) * 5;
    return 0.5 + 0.35 * Math.sin(a * 2 + phase) * Math.cos(b * 1.7 - phase * 0.3) + 0.15 * Math.exp(-(a * a + b * b));
  }));
}

export function ecg(time: number, rate = 72): number {
  const phase = ((time * rate / 60) % 1 + 1) % 1;
  const peak = (center: number, width: number, scale: number) => scale * Math.exp(-(((phase - center) / width) ** 2));
  return peak(0.17, 0.045, 0.12) - peak(0.34, 0.014, 0.16) + peak(0.37, 0.009, 1.05) - peak(0.40, 0.018, 0.24) + peak(0.67, 0.09, 0.24);
}

export function histogram(values: ArrayLike<number>, bins: number, start: number, end: number): { category: string; value: number }[] {
  if (!Number.isInteger(bins) || bins <= 0 || !(end > start)) throw new RangeError('Invalid histogram bounds');
  const counts = new Uint32Array(bins);
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (!Number.isFinite(value) || value < start || value > end) continue;
    counts[Math.min(bins - 1, Math.floor((value - start) / (end - start) * bins))]++;
  }
  return Array.from(counts, (value, i) => ({ category: (start + (i + 0.5) * (end - start) / bins).toFixed(1), value }));
}

export function steps(points: readonly Point[], placement: 'before' | 'after' | 'middle'): Point[] {
  if (!points.length) return [];
  const result = [{ ...points[0] }];
  for (let i = 1; i < points.length; i++) {
    const left = points[i - 1], right = points[i];
    if (placement === 'before') result.push({ x: left.x, y: right.y });
    else if (placement === 'after') result.push({ x: right.x, y: left.y });
    else { const middle = (left.x + right.x) / 2; result.push({ x: middle, y: left.y }, { x: middle, y: right.y }); }
    result.push({ ...right });
  }
  return result;
}

/** Covariance ellipse: the scale is an explicit Mahalanobis radius, not a promised confidence probability. */
export function covarianceEllipse(points: readonly Point[], scale: number, segments = 180): Point[] {
  if (points.length < 2 || !(scale > 0)) throw new RangeError('Ellipse needs at least two points and a positive radius');
  let x = 0, y = 0;
  for (const point of points) { x += point.x; y += point.y; }
  x /= points.length; y /= points.length;
  let xx = 0, yy = 0, xy = 0;
  for (const point of points) { const dx = point.x - x, dy = point.y - y; xx += dx * dx; yy += dy * dy; xy += dx * dy; }
  xx /= points.length - 1; yy /= points.length - 1; xy /= points.length - 1;
  const delta = Math.hypot(xx - yy, 2 * xy), major = Math.sqrt(Math.max(0, (xx + yy + delta) / 2)), minor = Math.sqrt(Math.max(0, (xx + yy - delta) / 2));
  const angle = Math.atan2(2 * xy, xx - yy) / 2, cosine = Math.cos(angle), sine = Math.sin(angle);
  return Array.from({ length: segments + 1 }, (_, i) => {
    const t = i / segments * Math.PI * 2, a = scale * major * Math.cos(t), b = scale * minor * Math.sin(t);
    return { x: x + a * cosine - b * sine, y: y + a * sine + b * cosine };
  });
}

export function fiveNumberSummary(values: readonly number[]): { min: number; lowerQuartile: number; median: number; upperQuartile: number; max: number } {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) throw new RangeError('A finite sample is required');
  const q = (fraction: number) => { const at = (sorted.length - 1) * fraction, i = Math.floor(at); return sorted[i] + (sorted[Math.min(i + 1, sorted.length - 1)] - sorted[i]) * (at - i); };
  return { min: sorted[0], lowerQuartile: q(0.25), median: q(0.5), upperQuartile: q(0.75), max: sorted[sorted.length - 1] };
}
