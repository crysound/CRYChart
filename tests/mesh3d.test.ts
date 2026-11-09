import test from 'node:test';
import assert from 'node:assert/strict';
import {Chart3D} from '../src/chart.js';
import {BoxSeries3D, MeshModel3D, SurfaceGrid3D, triangulateScatter3D, fitEllipsoid3D, meshNormals} from '../src/mesh3d.js';
import {ColorRGBA, LUT, PalettedFill} from '../src/core/styles.js';

const chart = () => new Chart3D({width: 800, height: 600});
const normalize = (value: number) => value / 100;
const near = (a: number, b: number, tolerance = 1e-9) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);

test('indexed geometry copies its source and rejected updates are atomic', () => {
  const host = chart(), mesh = new MeshModel3D(host), positions = [0, 0, 0, 1, 0, 0, 0, 1, 0]; mesh.setGeometry({positions, indices: [0, 1, 2]}); positions[0] = 50;
  assert.equal(mesh.getGeometry().positions[0], 0); assert.equal(mesh.getTriangleCount(), 1); const revision = mesh.revision;
  assert.throws(() => mesh.setGeometry({positions, indices: [0, 1, 50]}), /index/); assert.equal(mesh.revision, revision);
  const output = mesh.getGeometry(); output.positions[0] = 30; assert.equal(mesh.getGeometry().positions[0], 0); mesh.dispose(); mesh.dispose(); assert.equal(mesh.isDisposed(), true); host.dispose();
});

test('surface patches preserve unrelated heights and update only nearby normals; clear preserves topology', () => {
  const host = chart(), grid = new SurfaceGrid3D(host, {columns: 10, rows: 10}).invalidateHeightMap(new Float32Array(100).fill(2));
  const first = grid.getDrawPackets(normalize, 'fixed')[0], before = first.positions.slice(), indexArray = first.indices;
  grid.invalidateHeightMap({iColumn: 4, iRow: 5, values: [[12, 13]]}); const next = grid.getDrawPackets(normalize, 'fixed')[0];
  assert.equal(next.positions, first.positions); assert.equal(next.indices, indexArray); assert.equal(next.previousRevision, first.revision); assert.deepEqual(next.positionUpdateRanges, [{start: 54 * 3, count: 6}]);
  for (let index = 0; index < 100; index++) if (index !== 54 && index !== 55) assert.equal(next.positions[index * 3 + 1], before[index * 3 + 1]);
  assert.ok(next.normalUpdateRanges!.reduce((total, range) => total + range.count, 0) <= 90); const values = grid.values.slice(); const revision = grid.revision;
  assert.throws(() => grid.invalidateHeightMap({iColumn: 9, values: [[1, 2]]}), /outside/); assert.deepEqual(grid.values, values); assert.equal(grid.revision, revision);
  grid.clear(); assert.equal(grid.getSampleCount(), 100); assert.equal(grid.getTriangleCount(), 162); assert.ok(grid.values.every(Number.isNaN)); grid.invalidateHeightMap(new Float32Array(100).fill(3)); assert.ok(grid.getDrawPackets(normalize, 'fixed')[0].allFinite); grid.dispose(); host.dispose();
});

test('height and intensity encode independently and bounded surface rows remain chronological', () => {
  const host = chart(), lut = new LUT({steps: [{value: 0, color: ColorRGBA(255, 0, 0)}, {value: 1, color: ColorRGBA(0, 0, 255)}]}), grid = new SurfaceGrid3D(host, {columns: 2, rows: 3}).invalidateHeightMap([[1, 2], [3, 4], [5, 6]]).setFillStyle(new PalettedFill({lut, lookUpProperty: 'value'})).invalidateIntensityValues([[0, 1], [0, 1], [0, 1]]);
  const packet = grid.getDrawPackets(normalize, 'fixed')[0]; assert.deepEqual([...packet.colors!.subarray(0, 8)], [1, 0, 0, 1, 0, 0, 1, 1]); const positions = packet.positions.slice(); grid.invalidateIntensityValues(new Float32Array(6).fill(.5)); assert.deepEqual(grid.getDrawPackets(normalize, 'fixed')[0].positions, positions);
  grid.addRows([[7, 8], [9, 10]]); assert.deepEqual([...grid.values], [5, 6, 7, 8, 9, 10]); assert.equal(grid.start.z, 2); grid.dispose(); host.dispose();
});

test('transposed streaming surface advances time on X while frequency remains on Z', () => {
  const host = chart(), grid = new SurfaceGrid3D(host, {columns: 2, rows: 3, transposeXZ: true, start: {x: 10, z: 100}, step: {x: 20, z: 5}}).invalidateHeightMap([[2, 2], [2, 2], [2, 2]]);
  assert.deepEqual(grid.bounds('x'), {start: 100, end: 110}); assert.deepEqual(grid.bounds('z'), {start: 10, end: 30});
  const packet = grid.getDrawPackets(value => value, 'identity')[0]; assert.deepEqual([...packet.positions.subarray(0, 6)], [100, 2, 10, 100, 2, 30]);
  for (let index = 0; index < packet.normals!.length; index += 3) near(packet.normals![index + 1], 1);
  grid.addRows([[4, 6]]); assert.deepEqual([...grid.values], [2, 2, 2, 2, 4, 6]); assert.deepEqual(grid.bounds('x'), {start: 105, end: 115}); assert.deepEqual(grid.bounds('z'), {start: 10, end: 30});
  const updated = grid.getDrawPackets(value => value, 'identity')[0]; assert.deepEqual([...updated.positions.subarray(-6)], [115, 4, 10, 115, 6, 30]); assert.ok(updated.normals!.every(Number.isFinite)); grid.dispose(); host.dispose();
});

test('box instances keep centers, dimensions and height-gradient endpoints across ring retention', () => {
  const host = chart(), boxes = new BoxSeries3D(host, {maxSampleCount: 2, roundedEdges: true}).setFillStyle(new PalettedFill({lookUpProperty: 'y', lut: new LUT({steps: [{value: 0, color: ColorRGBA(255, 255, 0)}, {value: 100, color: ColorRGBA(255, 0, 0)}]})}));
  boxes.add([{x: 0, y: 0, z: 0, width: 2, height: 100, depth: 4}, {xCenter: 5, yCenter: 50, zCenter: 5, xSize: 2, ySize: 100, zSize: 2}, {x: 10, height: 50}]);
  const packet = boxes.getDrawPackets(normalize, 'fixed')[0]; assert.equal(packet.mode, 'boxes'); assert.equal(packet.count, 2); near(packet.positions[0], .05, 1e-7); assert.equal(packet.boxSizes![1], 1); assert.deepEqual([...packet.colors!.subarray(0, 4)], [1, 1, 0, 1]); assert.deepEqual([...packet.boxTopColors!.subarray(0, 4)], [1, 0, 0, 1]); assert.equal(packet.roundness, .12);
  assert.throws(() => boxes.setData([{height: -1}]), /nonnegative/); assert.equal(boxes.getSampleCount(), 2); assert.deepEqual(boxes.bounds('x'), {start: 4, end: 11}); boxes.dispose(); host.dispose();
});

test('scatter triangulation covers a square without duplicate, nonfinite or degenerate faces', () => {
  const points = [{x: 0, y: 0, z: 0}, {x: 2, y: 1, z: 0}, {x: 2, y: 3, z: 2}, {x: 0, y: 2, z: 2}, {x: 1, y: 1, z: 1}, {x: 1, y: 99, z: 1}, {x: NaN, y: 3, z: 0}];
  const geometry = triangulateScatter3D(points), p = geometry.positions, faces = geometry.indices!; assert.equal(p.length / 3, 5); assert.equal(faces.length / 3, 4); let area = 0;
  for (let index = 0; index < faces.length; index += 3) {const a = faces[index] * 3, b = faces[index + 1] * 3, c = faces[index + 2] * 3; const cross = (p[b] - p[a]) * (p[c + 2] - p[a + 2]) - (p[b + 2] - p[a + 2]) * (p[c] - p[a]); assert.ok(cross > 0); area += cross / 2;} near(area, 4);
  assert.equal(triangulateScatter3D([{x: 0, y: 1, z: 0}, {x: 1, y: 0, z: 0}, {x: 2, y: 1, z: 0}]).indices!.length, 0);
});

test('covariance ellipsoid eigensystem reconstructs correlated data and rejects missing samples', () => {
  const input = Array.from({length: 180}, (_, i) => {const angle = i * Math.PI / 90, a = Math.cos(angle), b = Math.sin(angle), c = Math.sin(angle * 3); return {x: 10 + 2 * a + .4 * b, y: -3 + a - .8 * b, z: 5 + .3 * c};});
  const fit = fitEllipsoid3D([...input, {x: NaN, y: 0, z: 1}], {standardDeviations: 2}); assert.equal(fit.sampleCount, 180); near(fit.center[0], 10); near(fit.center[1], -3); near(fit.center[2], 5);
  for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) {let rebuilt = 0, identity = 0; for (let axis = 0; axis < 3; axis++) {rebuilt += fit.basis[axis * 3 + row] * fit.eigenvalues[axis] * fit.basis[axis * 3 + col]; identity += fit.basis[row * 3 + axis] * fit.basis[col * 3 + axis];} near(rebuilt, fit.covariance[row * 3 + col]); near(identity, row === col ? 1 : 0);}
  assert.ok(Array.from(fit.geometry.positions).every(Number.isFinite)); assert.ok(fit.geometry.indices!.length > 1000); assert.throws(() => fitEllipsoid3D([{x: 1, y: 2, z: 3}]), /two finite/);
  const normals = meshNormals(Float32Array.from(fit.geometry.positions), Uint32Array.from(fit.geometry.indices!)); assert.ok(normals.every(Number.isFinite));
});
