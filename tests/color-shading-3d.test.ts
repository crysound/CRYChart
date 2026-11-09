import test from 'node:test';
import assert from 'node:assert/strict';
import * as styles from '../src/core/styles.js';
import {Chart3D} from '../src/chart.js';

test('Simple is a public immutable shading value and reaches actual mesh draw packets', () => {
  const Simple = (styles as any).ColorShadingStyles?.Simple;
  assert.equal(typeof Simple, 'function');
  const simple = new Simple();
  assert.equal(simple.type, 'simple');
  assert.ok(Object.isFrozen(simple));
  const chart = new Chart3D();
  try {
    const mesh = chart.addMeshModel().setGeometry({positions: [0, 0, 0, 1, 0, 0, 0, 1, 0]});
    const first = mesh.getDrawPackets(value => value, 'identity')[0];
    assert.equal(first.unshaded, undefined, 'Existing lighting defaults remain intact');
    const revision = mesh.revision;
    assert.equal((mesh as any).setColorShadingStyle(simple), mesh);
    assert.equal((mesh as any).getColorShadingStyle(), simple);
    const second = mesh.getDrawPackets(value => value, 'identity')[0];
    assert.ok(mesh.revision > revision);
    assert.equal(second.unshaded, true);
    assert.deepEqual(second.positions, first.positions);
    assert.deepEqual(second.colors, first.colors);
    assert.throws(() => (mesh as any).setColorShadingStyle({type: 'phong'}), /unsupported|not.*implement/i);
    assert.throws(() => (mesh as any).setColorShadingStyle(undefined), /shading/i);
    assert.equal((mesh as any).getColorShadingStyle(), simple, 'Rejected styles are atomic');
    mesh.setDepthTestEnabled(false).setBackfaceCullingMode('cull-front').setHighlightOnHover(false);
    const state = mesh.getDrawPackets(value => value, 'identity')[0];
    assert.equal(state.depthTestEnabled, false);
    assert.equal(state.backfaceCullingMode, 'cull-front');
    assert.equal(mesh.getDepthTestEnabled(), false);
    assert.equal(mesh.getBackfaceCullingMode(), 'cull-front');
    assert.equal(mesh.getHighlightOnHover(), false);
    assert.throws(() => mesh.setBackfaceCullingMode('both' as any), /culling/);
    assert.throws(() => mesh.setDepthTestEnabled('yes' as any), /boolean/);
    assert.throws(() => mesh.setHighlightOnHover(true), /not implemented/);
    assert.equal(mesh.getBackfaceCullingMode(), 'cull-front');
  } finally { chart.dispose(); }
});

test('Simple also reaches box packets without changing legacy setLighting behavior', () => {
  const Simple = (styles as any).ColorShadingStyles?.Simple;
  assert.equal(typeof Simple, 'function');
  const chart = new Chart3D();
  try {
    const box = chart.addBoxSeries().add([{x: 0, y: 0, z: 0, width: 1, height: 1, depth: 1}]);
    box.setLighting(false);
    assert.equal(box.getDrawPackets(value => value, 'identity')[0].unshaded, undefined);
    (box as any).setColorShadingStyle(new Simple());
    assert.equal(box.getDrawPackets(value => value, 'identity')[0].unshaded, true);
  } finally { chart.dispose(); }
});
