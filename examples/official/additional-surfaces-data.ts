/** Original data/geometry generators. The optional brain OBJ has separate CC0 provenance. */
export interface SurfaceGeometry {positions: Float64Array; indices: Uint32Array; values?: Float32Array;}
export interface MeshCell {points: {x: number; y: number}[]; value: number;}
export const eegNames = ['AF3', 'AF4', 'F5', 'F6', 'FC5', 'FC6', 'T7', 'CP5', 'CP6', 'O2'] as const;
const checked = (n: number, min: number) => {if (!Number.isInteger(n) || n < min) throw new RangeError('Invalid mesh resolution'); return n;};

export function warpedMeshCells(columns = 24, rows = 18): MeshCell[] {
  checked(columns, 2); checked(rows, 2);
  const point = (c: number, r: number) => ({x: c + .26 * Math.sin(r * .6) * Math.sin(c * Math.PI / columns), y: r + .22 * Math.sin(c * .5) * Math.sin(r * Math.PI / rows)});
  return Array.from({length: columns * rows}, (_, i) => {const c = i % columns, r = Math.floor(i / columns); return {points: [point(c, r), point(c + 1, r), point(c + 1, r + 1), point(c, r + 1)], value: Math.sin((c + .5) * .3) * Math.cos((r + .5) * .35)};});
}
export function polarMeshCells(rings = 10, sectors = 48): MeshCell[] {
  checked(rings, 1); checked(sectors, 3);
  const point = (r: number, a: number) => ({x: r / rings * Math.cos(a * 2 * Math.PI / sectors), y: r / rings * Math.sin(a * 2 * Math.PI / sectors)});
  return Array.from({length: rings * sectors}, (_, i) => {const r = Math.floor(i / sectors), a = i % sectors; return {points: [point(r, a), point(r + 1, a), point(r + 1, a + 1), point(r, a + 1)], value: Math.sin((a + .5) * 2 * Math.PI / sectors * 3) * (r + .5) / rings};});
}
export function surfaceGeometry(columns = 49, rows = 41): SurfaceGeometry {
  checked(columns, 2); checked(rows, 2); const positions = new Float64Array(columns * rows * 3), values = new Float32Array(columns * rows), indices: number[] = [];
  for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) {
    const i = row * columns + col, x = col / (columns - 1) * 8 - 4, z = row / (rows - 1) * 8 - 4, r = Math.hypot(x, z), y = r === 0 ? 1 : Math.sin(r * 2) / (r * 2);
    positions.set([x, y, z], i * 3); values[i] = y;
    if (col + 1 < columns && row + 1 < rows) indices.push(i, i + columns, i + 1, i + 1, i + columns, i + columns + 1);
  }
  return {positions, indices: Uint32Array.from(indices), values};
}
function sphere(longitudes: number, latitudes: number, vertex: (x: number, y: number, z: number) => number[]): SurfaceGeometry {
  const positions: number[] = [], indices: number[] = [];
  for (let lat = 0; lat <= latitudes; lat++) for (let lon = 0; lon <= longitudes; lon++) {const p = Math.PI * lat / latitudes, t = 2 * Math.PI * lon / longitudes; positions.push(...vertex(Math.sin(p) * Math.cos(t), Math.cos(p), Math.sin(p) * Math.sin(t)));}
  for (let lat = 0; lat < latitudes; lat++) for (let lon = 0; lon < longitudes; lon++) {const i = lat * (longitudes + 1) + lon; if (lat) indices.push(i, i + 1, i + longitudes + 1); if (lat + 1 < latitudes) indices.push(i + 1, i + longitudes + 2, i + longitudes + 1);}
  return {positions: Float64Array.from(positions), indices: Uint32Array.from(indices)};
}
export function asteroidGeometry(): SurfaceGeometry {
  const craters = [[.65, .5, .57], [-.75, .3, .55], [.15, -.65, .74], [.9, -.2, -.38]];
  return sphere(96, 48, (x, y, z) => {let radius = 1 + .08 * Math.sin(x * 9 + y * 3) * Math.sin(z * 8 - x); for (const c of craters) {const d = Math.hypot(x - c[0], y - c[1], z - c[2]); radius -= .18 * Math.exp(-(d * d) / .025);} return [1.3 * x * radius, .55 * y * radius, .65 * z * radius];});
}
/** Original stylized airplane: ellipsoid fuselage plus closed, subdivided lifting surfaces. */
export function airplaneGeometry(): SurfaceGeometry {
  const body = sphere(48, 24, (x, y, z) => [x * 1.6, y * .17, z * .18]), p = [...body.positions], indices = [...body.indices];
  function slab(corners: number[][], thickness: number) {const base = p.length / 3; for (const dy of [-thickness, thickness]) corners.forEach(v => p.push(v[0], v[1] + dy, v[2])); indices.push(base, base + 2, base + 1, base, base + 3, base + 2, base + 4, base + 5, base + 6, base + 4, base + 6, base + 7); for (let i = 0; i < 4; i++) {const j = (i + 1) % 4; indices.push(base + i, base + j, base + i + 4, base + j, base + j + 4, base + i + 4);}}
  for (const sign of [-1, 1]) {slab([[.5, 0, .05 * sign], [-.8, 0, 1.65 * sign], [-1.05, 0, 1.65 * sign], [-.55, 0, .05 * sign]], .025); slab([[-1, .06, .06 * sign], [-1.5, .06, .65 * sign], [-1.65, .06, .65 * sign], [-1.4, .06, .06 * sign]], .02);}
  const b = p.length / 3; p.push(-1, .1, 0, -1.5, .7, 0, -1.65, .1, 0); indices.push(b, b + 1, b + 2, b + 2, b + 1, b);
  return {positions: Float64Array.from(p), indices: Uint32Array.from(indices)};
}

/** OBJ positions and polygon faces only; handles negative indices and fan triangulates. */
export function parseOBJ(text: string, objectName?: string): SurfaceGeometry {
  const all: number[][] = [], faces: number[][] = []; let selected = !objectName;
  for (const raw of text.split(/\r?\n/)) {const [kind, ...parts] = raw.trim().split(/\s+/); if (kind === 'o') selected = !objectName || parts.join(' ') === objectName;
    else if (kind === 'v') {const v = parts.slice(0, 3).map(Number); if (v.length !== 3 || !v.every(Number.isFinite)) throw new RangeError('Invalid OBJ vertex'); all.push(v);}
    else if (kind === 'f' && selected) {const face = parts.map(part => {const n = Number(part.split('/')[0]), i = n < 0 ? all.length + n : n - 1; if (!Number.isInteger(n) || n === 0 || i < 0 || i >= all.length) throw new RangeError('Invalid OBJ index'); return i;}); if (face.length < 3) throw new RangeError('Invalid OBJ face'); faces.push(face);}}
  if (!faces.length) throw new RangeError('OBJ contains no selected faces');
  const remap = new Map<number, number>(), positions: number[] = [], indices: number[] = [];
  const index = (n: number) => {let result = remap.get(n); if (result === undefined) {result = remap.size; remap.set(n, result); positions.push(...all[n]);} return result;};
  for (const face of faces) {const a = index(face[0]); for (let i = 1; i + 1 < face.length; i++) indices.push(a, index(face[i]), index(face[i + 1]));}
  return {positions: Float64Array.from(positions), indices: Uint32Array.from(indices)};
}
export function normalizeModel(input: SurfaceGeometry): SurfaceGeometry {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]; for (let i = 0; i < input.positions.length; i++) {const d = i % 3; min[d] = Math.min(min[d], input.positions[i]); max[d] = Math.max(max[d], input.positions[i]);}
  const span = Math.max(...max.map((value, i) => value - min[i])); if (!(span > 0)) throw new RangeError('Mesh extent must be positive');
  return {...input, positions: Float64Array.from(input.positions, (value, i) => (value - (min[i % 3] + max[i % 3]) / 2) * 2 / span)};
}
export function sensorLocations(positions: ArrayLike<number>, count = 10): Float64Array {
  checked(count, 1); const result = new Float64Array(count * 3), n = positions.length / 3; if (!Number.isInteger(n) || !n) throw new RangeError('Sensors require XYZ geometry');
  // Farthest-point sampling spreads the sensors over the actual model surface.
  const chosen: number[] = [0]; while (chosen.length < Math.min(count, n)) {let best = -1, distance = -1; for (let i = 0; i < n; i++) {let d = Infinity; for (const c of chosen) d = Math.min(d, (positions[i * 3] - positions[c * 3]) ** 2 + (positions[i * 3 + 1] - positions[c * 3 + 1]) ** 2 + (positions[i * 3 + 2] - positions[c * 3 + 2]) ** 2); if (d > distance) {distance = d; best = i;}} chosen.push(best);}
  for (let i = 0; i < count; i++) for (let d = 0; d < 3; d++) result[i * 3 + d] = positions[chosen[i % chosen.length] * 3 + d]; return result;
}
export function sensorWeights(positions: ArrayLike<number>, sensors: ArrayLike<number>): Float64Array {
  const count = sensors.length / 3, out = new Float64Array(positions.length / 3 * count); if (!Number.isInteger(count) || !count || positions.length % 3) throw new RangeError('Invalid sensor geometry');
  for (let i = 0; i < positions.length / 3; i++) {let sum = 0, exact = -1; for (let j = 0; j < count; j++) {const d = (positions[i * 3] - sensors[j * 3]) ** 2 + (positions[i * 3 + 1] - sensors[j * 3 + 1]) ** 2 + (positions[i * 3 + 2] - sensors[j * 3 + 2]) ** 2; if (d < 1e-20) exact = j; const w = 1 / Math.max(d, 1e-20); out[i * count + j] = w; sum += w;} for (let j = 0; j < count; j++) out[i * count + j] = exact >= 0 ? +(j === exact) : out[i * count + j] / sum;} return out;
}
export function interpolateSensors(weights: ArrayLike<number>, values: ArrayLike<number>): Float32Array {if (!values.length || weights.length % values.length) throw new RangeError('Invalid weights'); return Float32Array.from({length: weights.length / values.length}, (_, i) => {let value = 0; for (let j = 0; j < values.length; j++) value += weights[i * values.length + j] * values[j]; return value;});}
export function eegSample(channel: number, sampleIndex: number): number {const t = sampleIndex / 1000; return 28 * Math.sin(2 * Math.PI * (8 + channel * .43) * t + channel * .6) + 12 * Math.sin(2 * Math.PI * 1.7 * t + channel) + 4 * Math.cos(2 * Math.PI * 31 * t - channel);}
/** Bounded 100 ms running mean, independent raw source remains available to the caller. */
export class SensorAverage {
  readonly sums: Float64Array; readonly values: Float64Array; private readonly ring: Float64Array; private head = 0; count = 0;
  constructor(readonly channels = 10, readonly window = 100) {checked(channels, 1); checked(window, 1); this.sums = new Float64Array(channels); this.values = new Float64Array(channels); this.ring = new Float64Array(channels * window);}
  push(input: ArrayLike<number>): Float64Array {if (input.length !== this.channels || !Array.from(input).every(Number.isFinite)) throw new RangeError('Invalid sensor frame'); for (let c = 0; c < this.channels; c++) {const i = this.head * this.channels + c; this.sums[c] += input[c] - this.ring[i]; this.ring[i] = input[c]; this.values[c] = this.sums[c] / Math.min(this.count + 1, this.window);} this.head = (this.head + 1) % this.window; this.count++; return this.values;}
}
export function linearGaugeSample(channel: number, sampleIndex: number): number {const t = sampleIndex / 20; return Math.max(0, Math.min(100, 50 + 31 * Math.sin(t * (.53 + channel * .11) + channel * 1.6) + 16 * Math.cos(t * 1.7 - channel)));}
