import test from 'node:test';
import assert from 'node:assert/strict';
import {Chart3D} from '../src/chart.js';

const near = (a: number, b: number, epsilon = 2e-7) => assert.ok(Math.abs(a - b) <= epsilon, `${a} != ${b}`);
function fixture() {
  const chart = new Chart3D().setBoundingBox({x: 3, y: 2, z: 1});
  const axes = [chart.axisX, chart.axisY, chart.getDefaultAxisZ()];
  axes.forEach(axis => axis.setInterval({start: -20, end: 40, stopAxisAfter: true}));
  return {chart, axes};
}

test('model min alignment and world scale preserve the same axis geometry as the page lines', () => {
  const {chart, axes} = fixture();
  try {
    const vertices = [4, 5, 6, 7, 5, 6, 4, 9, 8], before = vertices.slice();
    const origin = chart.translateCoordinate({x: 0, y: 0, z: 0}, chart.coordsAxis, chart.coordsWorld);
    const unit = chart.translateCoordinate({x: 1, y: 1, z: 1}, chart.coordsAxis, chart.coordsWorld);
    const mesh: any = chart.addMeshModel();
    mesh.setModelGeometry({vertices, indices: [0, 1, 2]})
      .setModelAlignment({x: -1, y: -1, z: -1}).setModelLocation({x: 4, y: 5, z: 6})
      .setScale({x: unit.x - origin.x, y: unit.y - origin.y, z: unit.z - origin.z});
    const normalize = (v: number, dim: 0 | 1 | 2) => axes[dim].valueToFraction(v) * 2 - 1;
    const packet = mesh.getDrawPackets(normalize, 'first')[0];
    for (let i = 0; i < vertices.length; i++) near(packet.positions[i], normalize(vertices[i], (i % 3) as 0 | 1 | 2));
    assert.deepEqual(vertices, before);
    assert.deepEqual(mesh.getGeometry().positions, Float64Array.from(vertices));
    assert.equal(packet.count, 3);
    assert.deepEqual([...packet.indices], [0, 1, 2]);
    const scale = mesh.getScale(); scale.x = 999;
    assert.notEqual(mesh.getScale().x, 999);
    const location = mesh.getModelLocation(); location.x = 999;
    assert.equal(mesh.getModelLocation().x, 4);
    assert.throws(() => mesh.setScale({x: NaN}), /finite/);
    assert.throws(() => mesh.setModelAlignment({x: 2, y: 0, z: 0}), /alignment/i);
    assert.deepEqual(mesh.getModelAlignment(), {x: -1, y: -1, z: -1});
    const revision = mesh.revision;
    const cached = mesh.getDrawPackets(normalize, 'first')[0];
    mesh.setScale(mesh.getScale());
    assert.equal(mesh.revision, revision, 'Original page calls setScale on every projection pass');
    assert.equal(mesh.getDrawPackets(normalize, 'first')[0], cached);
  } finally { chart.dispose(); }
});

test('model transforms invalidate cached GPU positions while geometry and triangle changes stay exact', () => {
  const {chart} = fixture();
  try {
    const mesh: any = chart.addMeshModel();
    mesh.setModelGeometry({vertices: [0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0], indices: [0, 1, 2]})
      .setModelAlignment({x: -1, y: -1, z: -1}).setScale(.05).setModelLocation({x: 0, y: 0, z: 0});
    const first = mesh.getDrawPackets((v: number) => v, 'same')[0].positions.slice();
    mesh.setModelLocation({x: 10, y: 0, z: 0});
    const next = mesh.getDrawPackets((v: number) => v, 'same')[0];
    assert.notDeepEqual(next.positions, first);
    near(next.positions[3] - next.positions[0], first[3] - first[0]);
    mesh.setModelGeometry({vertices: mesh.getGeometry().positions, indices: [1, 3, 2]});
    assert.deepEqual([...mesh.getDrawPackets((v: number) => v, 'same')[0].indices], [1, 3, 2]);
    const count = mesh.getSampleCount();
    assert.throws(() => mesh.setModelGeometry({vertices: [0, 1], indices: []}), /XYZ|vertices|coordinates/);
    assert.equal(mesh.getSampleCount(), count);
    mesh.clear(); assert.equal(mesh.getSampleCount(), 0);
    mesh.dispose(); assert.throws(() => mesh.setModelLocation({x: 0, y: 0, z: 0}), /disposed/);
  } finally { chart.dispose(); }
});

test('model location stays in axis coordinates while bounding volume and scale change world extents', () => {
  const {chart, axes} = fixture();
  try {
    const mesh: any = chart.addMeshModel();
    mesh.setModelGeometry({vertices: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2]})
      .setModelAlignment({x: -1, y: -1, z: -1}).setModelLocation({x: 10, y: 5, z: 2}).setScale(.02);
    const normalize = (v: number, dim: 0 | 1 | 2) => axes[dim].valueToFraction(v) * 2 - 1;
    const a = mesh.getDrawPackets(normalize, 'fixed')[0].positions.slice();
    chart.setBoundingBox({x: 1, y: 2, z: 3});
    const b = mesh.getDrawPackets(normalize, 'fixed')[0].positions.slice();
    near(a[0], b[0]); near(a[1], b[1]); near(a[2], b[2]);
    near(b[3] - b[0], (a[3] - a[0]) * 3);
    near(b[7] - b[1], a[7] - a[1]);
    const beforeScale = mesh.getGeometry().positions;
    mesh.setScale(.04);
    const c = mesh.getDrawPackets(normalize, 'fixed')[0].positions;
    near(c[3] - c[0], (b[3] - b[0]) * 2);
    assert.deepEqual(mesh.getGeometry().positions, beforeScale);
    assert.ok(mesh.getDrawPackets(normalize, 'fixed')[0].normals.every(Number.isFinite));
  } finally { chart.dispose(); }
});
