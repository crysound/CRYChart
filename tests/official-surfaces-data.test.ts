import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {Gauge} from '../src/specialty.js';
import {ColorHEX, LUT} from '../src/core/styles.js';
import {warpedMeshCells, polarMeshCells, surfaceGeometry, asteroidGeometry, airplaneGeometry, parseOBJ, normalizeModel, sensorLocations, sensorWeights, interpolateSensors, SensorAverage, eegSample, linearGaugeSample} from '../examples/official/additional-surfaces-data.js';

function recording() {
  const calls: {name: string; args: any[]}[] = [], record = (name: string, args: any[]) => {for (const value of args) if (typeof value === 'number') assert.ok(Number.isFinite(value)); calls.push({name, args});};
  const ctx = new Proxy({measureText: (s: string) => ({width: s.length * 7}), createLinearGradient: (...args: any[]) => {record('gradient', args); return {addColorStop: (...args: any[]) => record('stop', args)};}}, {get(target: any, key: string) {return key in target ? target[key] : (...args: any[]) => record(key, args);}, set(target: any, key: string, value) {target[key] = value; return true;}}) as unknown as CanvasRenderingContext2D;
  return {ctx, calls};
}
test('default Gauge retains the original radial coordinates and needle/progress commands', () => {
  const gauge = new Gauge({headless: true, width: 500, height: 320}).setValue(50), {ctx, calls} = recording(); gauge.render(ctx);
  assert.equal(gauge.getOrientation(), 'radial'); const arcs = calls.filter(c => c.name === 'arc'); assert.equal(arcs.length, 2);
  const radius = 284 * .57; assert.deepEqual(arcs[0].args, [250, 18 + 284 * .65, radius, -Math.PI, 0]); assert.equal(arcs[1].args[4], -Math.PI / 2);
  assert.equal(calls.filter(c => c.name === 'gradient').length, 0); assert.ok(calls.some(c => c.name === 'fillText' && c.args[0] === '50')); gauge.dispose();
});
test('linear Gauge renders bands or continuous LUT and maps pointer endpoints without changing raw value', () => {
  const gauge = new Gauge({headless: true, width: 300, height: 300}).setOrientation('vertical').setInterval({start: -20, end: 20}).setProgressVisible(false).setBands([{start: -20, end: 0, color: ColorHEX('#ff0000')}, {start: 0, end: 20, color: ColorHEX('#00ff00')}]);
  const track = (gauge as any).linearTrack((gauge as any).plotRect()); (gauge as any).dragAt({x: track.left, y: track.top}); assert.equal(gauge.getValue(), 20); (gauge as any).dragAt({x: track.left, y: track.top + track.height}); assert.equal(gauge.getValue(), -20);
  gauge.setInteractive(false); (gauge as any).dragAt({x: 0, y: 0}); assert.equal(gauge.getValue(), -20);
  gauge.setValue(33); let r = recording(); gauge.render(r.ctx); assert.equal(gauge.getValue(), 33); assert.equal(r.calls.filter(c => c.name === 'arc').length, 0); assert.ok(r.calls.filter(c => c.name === 'fillRect').length >= 4);
  const lut = new LUT({steps: [{value: -20, color: ColorHEX('#ff0000')}, {value: 20, color: ColorHEX('#00ff00')}]}); gauge.setLinearLUT(lut); r = recording(); gauge.render(r.ctx); assert.equal(r.calls.filter(c => c.name === 'stop').length, 129); assert.equal(gauge.getLinearLUT(), lut);
  assert.throws(() => gauge.setOrientation('diagonal' as any), /orientation/); assert.equal(gauge.getOrientation(), 'vertical'); gauge.dispose();
});
test('horizontal Gauge uses increasing X and preserves keyboard/disabled behavior', () => {
  const gauge = new Gauge({headless: true}).setOrientation('horizontal'), track = (gauge as any).linearTrack((gauge as any).plotRect());
  (gauge as any).dragAt({x: track.left + track.width * .25, y: 0}); assert.equal(gauge.getValue(), 25); (gauge as any).key('ArrowRight'); assert.equal(gauge.getValue(), 26); gauge.setInteractive(false); assert.equal((gauge as any).key('ArrowRight'), false); assert.equal(gauge.getValue(), 26); gauge.dispose();
});
test('warped and circular meshes have finite closed cells and independently known values', () => {
  const cells = warpedMeshCells(); assert.equal(cells.length, 432); assert.equal(cells[0].value, Math.sin(.5 * .3) * Math.cos(.5 * .35));
  for (const cell of cells) assert.ok(cell.points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)));
  for (let row = 0; row < 18; row++) for (let col = 0; col < 23; col++) {assert.deepEqual(cells[row * 24 + col].points[1], cells[row * 24 + col + 1].points[0]); assert.deepEqual(cells[row * 24 + col].points[2], cells[row * 24 + col + 1].points[3]);}
  const rings = polarMeshCells(); assert.equal(rings.length, 480); for (let i = 0; i < 48; i++) assert.equal(Math.hypot(rings[i].points[0].x, rings[i].points[0].y), 0); assert.ok(Math.abs(Math.hypot(rings.at(-1)!.points[2].x, rings.at(-1)!.points[2].y) - 1) < 1e-15);
});
test('all original 3D models have complete, in-range indexed triangles and genuine XYZ variation', () => {
  for (const geometry of [surfaceGeometry(), asteroidGeometry(), airplaneGeometry()]) {assert.equal(geometry.positions.length % 3, 0); assert.equal(geometry.indices.length % 3, 0); assert.ok(geometry.positions.every(Number.isFinite)); assert.ok(geometry.indices.every(i => i < geometry.positions.length / 3)); for (let d = 0; d < 3; d++) {const values = geometry.positions.filter((_, i) => i % 3 === d); assert.ok(Math.max(...values) > Math.min(...values));}}
  const surface = surfaceGeometry(3, 3); assert.equal(surface.positions[4 * 3 + 1], 1); assert.equal(surface.indices.length, 24);
});
test('OBJ object selection, negative indices and fan triangles preserve independent input coordinates', () => {
  const obj = 'v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\no ignored\nf 1 2 3\no target\nf -4/1/1 -3/2/1 -2/3/1 -1/4/1';
  const g = parseOBJ(obj, 'target'); assert.deepEqual([...g.positions], [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]); assert.deepEqual([...g.indices], [0, 1, 2, 0, 2, 3]);
  assert.throws(() => parseOBJ('v 0 0 0\nf 0 1 1'), /index/); assert.throws(() => parseOBJ(obj, 'missing'), /no selected/); const centered = normalizeModel(g); assert.deepEqual([...centered.positions], [-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]); assert.equal(g.positions[0], 0);
});
test('CC0 brain asset matches its provenance and retains every extracted vertex', () => {
  const path = 'examples/data/brain-drummyfish', bytes = readFileSync(`${path}.obj`), provenance = JSON.parse(readFileSync(`${path}.provenance.json`, 'utf8'));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), provenance.outputSHA256); assert.equal(provenance.license, 'CC0-1.0'); const g = parseOBJ(bytes.toString()); assert.equal(g.positions.length / 3, provenance.extractedVertexCount); assert.ok(g.indices.length / 3 >= provenance.faceCount); assert.ok(g.indices.every(i => i < g.positions.length / 3));
});
test('sensor weights reproduce sensor samples exactly and preserve constant fields', () => {
  const p = Float64Array.from([0, 0, 0, 1, 0, 0, .5, 0, 0]), s = Float64Array.from([0, 0, 0, 1, 0, 0]), w = sensorWeights(p, s);
  assert.deepEqual([...w], [1, 0, 0, 1, .5, .5]); assert.deepEqual([...interpolateSensors(w, [2, 6])], [2, 6, 4]); assert.deepEqual([...interpolateSensors(w, [13, 13])], [13, 13, 13]);
  const locations = sensorLocations(asteroidGeometry().positions, 10); assert.equal(locations.length, 30); assert.ok(locations.every(Number.isFinite));
});
test('100 ms running mean consumes all raw 1 kHz values and matches a separate window sum', () => {
  const a = new SensorAverage(10, 100), history: number[][] = [];
  for (let sample = 0; sample < 337; sample++) {const raw = Array.from({length: 10}, (_, c) => eegSample(c, sample)); history.push(raw); a.push(raw); for (let c = 0; c < 10; c++) {const window = history.slice(-100); const expected = window.reduce((sum, row) => sum + row[c], 0) / window.length; assert.ok(Math.abs(a.values[c] - expected) < 2e-13);}}
  assert.equal(a.count, 337); const before = [...a.values]; assert.throws(() => a.push([NaN]), /sensor frame/); assert.deepEqual([...a.values], before);
});
test('four linear-gauge signals have deterministic bounded values at every retained sample', () => {for (let c = 0; c < 4; c++) for (let i = 0; i < 1000; i++) {const value = linearGaugeSample(c, i); assert.ok(value >= 0 && value <= 100); assert.equal(value, linearGaugeSample(c, i));} assert.equal(linearGaugeSample(0, 0), 66);});
