import { random } from '../signals';

export interface Sample { x: number; y: number }

export function trailingMean(values: readonly number[], window: number): number[] {
  if (!Number.isInteger(window) || window < 1) throw new RangeError('Window must be a positive integer');
  let sum = 0, finite = 0;
  return values.map((value, i) => {
    if (Number.isFinite(value)) { sum += value; finite++; }
    if (i >= window && Number.isFinite(values[i - window])) { sum -= values[i - window]; finite--; }
    return finite ? sum / finite : NaN;
  });
}

export function percentile(values: readonly number[], q: number): number {
  if (!(q >= 0 && q <= 1)) throw new RangeError('Invalid quantile');
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return NaN;
  const position = (sorted.length - 1) * q, lo = Math.floor(position), hi = Math.ceil(position);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (position - lo);
}

/** Immutable source rows; derived columns are recalculated after an input correction. */
export function capacityForecast(count = 90, seed = 1720) {
  const rng = random(seed);
  const rows = Array.from({ length: count }, (_, i) => {
    const center = 16000 + 2000 * Math.sin(i / 4.8) - (i % 7 === 5 ? 3300 : 0);
    return { x: Date.UTC(2026, 2, 1) + i * 86400000, actual: center + (rng() - .5) * 1200, predictions: Array.from({ length: 21 }, () => center + (rng() - .5) * 3600) };
  });
  const derive = () => ({
    median: rows.map(row => percentile(row.predictions, .5)),
    low: rows.map(row => percentile(row.predictions, .1)),
    high: rows.map(row => percentile(row.predictions, .9)),
    sma: trailingMean(rows.map(row => row.actual), 7),
  });
  return { rows, derive };
}

export function stackColumns(columns: readonly (readonly number[])[]) {
  const count = columns[0]?.length ?? 0;
  if (columns.some(column => column.length !== count || column.some(value => !Number.isFinite(value) || value < 0))) throw new RangeError('Stack columns must have equal lengths and nonnegative finite values');
  const totals = new Float64Array(count);
  const layers = columns.map(column => column.map((value, i) => { const low = totals[i]; totals[i] += value; return { low, high: totals[i] }; }));
  return { layers, totals: Array.from(totals) };
}

export function ecgValue(sample: number, sampleRate = 960): number {
  const phase = (sample / sampleRate * 1.2) % 1;
  const gaussian = (center: number, width: number, amplitude: number) => amplitude * Math.exp(-.5 * ((phase - center) / width) ** 2);
  return gaussian(.18, .025, 120) - gaussian(.37, .01, 230) + gaussian(.4, .009, 1050) - gaussian(.43, .012, 510) + gaussian(.66, .05, 250) + 15 * Math.sin(sample / sampleRate * .8);
}

export function sweptValues(nextSample: number, capacity: number, valueAt: (index: number) => number, gap = 20): number[] {
  if (!Number.isInteger(nextSample) || nextSample < 0 || !Number.isInteger(capacity) || capacity < 2) throw new RangeError('Invalid sweep dimensions');
  const cursor = nextSample % capacity;
  return Array.from({ length: capacity }, (_, x) => {
    const age = (cursor - 1 - x + capacity) % capacity;
    const index = nextSample - 1 - age;
    return index < 0 || age >= capacity - gap ? NaN : valueAt(index);
  });
}

/** Split segments at both thresholds before routing, preserving boundary intersections. */
export function symlogSegments(points: readonly Sample[], threshold = 10) {
  if (!(threshold > 0)) throw new RangeError('Threshold must be positive');
  const result: { positive: Sample[]; linear: Sample[]; negative: Sample[] } = { positive: [], linear: [], negative: [] };
  const zone = (y: number) => y > threshold ? 'positive' : y < -threshold ? 'negative' : 'linear';
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    if (![a.x, a.y, b.x, b.y].every(Number.isFinite)) continue;
    const ts = [0, 1];
    if (a.y !== b.y) for (const boundary of [-threshold, threshold]) { const t = (boundary - a.y) / (b.y - a.y); if (t > 0 && t < 1) ts.push(t); }
    ts.sort((x, y) => x - y);
    for (let j = 1; j < ts.length; j++) {
      const t0 = ts[j - 1], t1 = ts[j], which = zone(a.y + (b.y - a.y) * (t0 + t1) / 2), line = result[which];
      const map = (t: number) => ({ x: a.x + (b.x - a.x) * t, y: (which === 'negative' ? -1 : 1) * (a.y + (b.y - a.y) * t) });
      const p = map(t0), q = map(t1), last = line.at(-1);
      if (last && (last.x !== p.x || last.y !== p.y)) line.push({ x: NaN, y: NaN });
      if (!last || last.x !== p.x || last.y !== p.y) line.push(p);
      line.push(q);
    }
  }
  return result;
}

export function trackTelemetry(count = 800) {
  return Array.from({ length: count }, (_, i) => {
    const t = i / (count - 1) * Math.PI * 2;
    return { x: 30 * Math.cos(t) + 9 * Math.cos(t * 3), y: 18 * Math.sin(t) + 5 * Math.sin(t * 2), speed: 30 + 20 * (1 + Math.sin(t * 3)) / 2, acceleration: Math.cos(t * 3) * 4, steering: Math.sin(t * 2) * 35 };
  });
}

export function parseDiamonds(csv: string) {
  const fields = (line: string) => {
    const values: string[] = []; let value = '', quoted = false;
    for (let i = 0; i < line.length; i++) {
      const character = line[i];
      if (character === '"') { if (quoted && line[i + 1] === '"') { value += '"'; i++; } else quoted = !quoted; }
      else if (character === ',' && !quoted) { values.push(value); value = ''; }
      else value += character;
    }
    if (quoted) throw new Error('Unclosed quoted diamond field');
    values.push(value); return values;
  };
  const [header, ...lines] = csv.trim().split(/\r?\n/), names = fields(header), ix = names.indexOf('carat'), iy = names.indexOf('price'), ic = names.indexOf('clarity');
  if ([ix, iy, ic].some(index => index < 0)) throw new Error('Diamond data is missing required columns');
  const clarity = ['I1', 'SI2', 'SI1', 'VS2', 'VS1', 'VVS2', 'VVS1', 'IF'];
  return lines.map((line, index) => { const row = fields(line), x = Number(row[ix]), y = Number(row[iy]), value = clarity.indexOf(row[ic]); if (!Number.isFinite(x) || !Number.isFinite(y) || value < 0) throw new Error(`Invalid diamond record ${index}`); return { x, y, value, clarity: row[ic] }; });
}
