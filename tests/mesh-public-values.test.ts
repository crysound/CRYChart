import test from "node:test";
import assert from "node:assert/strict";
import { Chart3D } from "../src/chart.js";
import { MeshSeries3D, type Series3DBase } from "../src/mesh3d.js";
import { SolidFill, SolidLine, ColorRGBA } from "../src/core/styles.js";

test("public 3D series base fields identify axis ownership material lighting event changes and disposal", () => {
  const chart = new Chart3D();
  try {
    const surface = chart.addSurfaceMeshSeries(),
      base: Series3DBase = surface,
      fill = new SolidFill({ color: ColorRGBA(100, 20, 30) }),
      wire = new SolidLine({ fillStyle: fill, thickness: 2 });
    surface
      .setGeometry({ positions: [0, 0, 0, 1, 0, 0, 0, 1, 0] })
      .setFillStyle(fill)
      .setWireframeStyle(wire)
      .setName("mesh")
      .setLighting(false);
    assert.equal(base.chart, chart);
    assert.equal(base.axisX, chart.axisX);
    assert.equal(base.axisY, chart.axisY);
    assert.equal(base.axisZ, chart.axisZ);
    assert.equal(base.name, "mesh");
    assert.equal(base.kind, "surface-mesh3d");
    assert.equal(surface.kind, "surface-mesh3d");
    assert.equal(base.fill, fill);
    assert.equal(base.wireframe, wire);
    assert.equal(base.lighting, false);
    const packets = surface.getDrawPackets((v) => v, "identity");
    assert.equal(packets[0].lighting, false);
    assert.equal(packets[1].thickness, 2);
    assert.equal(typeof base.id, "number");
    assert.equal(packets[0].id, base.id);
    let changes = 0;
    base.events.on("change", () => changes++);
    surface.setLighting(true);
    assert.equal(changes, 1);
    surface.setCursorEnabled(false).setVisible(false);
    assert.equal(base.cursorEnabled, false);
    assert.equal(base.visible, false);
    assert.equal(base.disposed, false);
    surface.dispose();
    assert.equal(base.disposed, true);
    assert.equal(base.events.listenerCount(), 0);
    assert.equal(chart.getSeries().includes(surface), false);
    const mesh = new MeshSeries3D(chart).setGeometry({
      positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
    });
    assert.equal(mesh.kind, "mesh3d");
    assert.equal(mesh.getTriangleCount(), 1);
    mesh.dispose();
    const box = chart.addBoxSeries().addBoxes([{ x: 1, y: 2, z: 3 }]),
      model = chart
        .addMeshModel()
        .setModelGeometry({ vertices: [0, 0, 0, 1, 0, 0, 0, 1, 0] });
    assert.equal(box.kind, "boxes3d");
    assert.equal(model.kind, "mesh-model3d");
    assert.equal(box.getSampleCount(), 1);
    assert.equal(model.getTriangleCount(), 1);
  } finally {
    chart.dispose();
  }
});

test("public 3D grid dimensions transform and transpose fields correspond to retained XYZ vertices", () => {
  const chart = new Chart3D();
  try {
    const grid = chart.addSurfaceGridSeries({
      columns: 2,
      rows: 3,
      start: { x: 10, z: 20 },
      step: { x: 2, z: 3 },
      transposeXZ: true,
    });
    grid.invalidateHeightMap([
      [1, 2],
      [3, 4],
      [5, 6],
    ]);
    assert.equal(grid.kind, "surface-grid3d");
    assert.equal(grid.columns, 2);
    assert.equal(grid.rows, 3);
    assert.deepEqual(grid.step, { x: 2, z: 3 });
    assert.equal(grid.transposeXZ, true);
    const positions = grid.getGeometry().positions;
    assert.deepEqual([...positions].slice(0, 6), [20, 1, 10, 20, 2, 12]);
    assert.deepEqual(grid.bounds("x"), { start: 20, end: 26 });
    assert.deepEqual(grid.bounds("z"), { start: 10, end: 12 });
    assert.equal(grid.getSampleCount(), grid.columns * grid.rows);
  } finally {
    chart.dispose();
  }
});
