import test from "node:test";
import assert from "node:assert/strict";
import { Chart3D } from "../src/chart.js";
import { MeshSeries3D, SurfaceMesh3D } from "../src/mesh3d.js";
import {
  SolidFill,
  SolidLine,
  ColorRGBA,
  SimpleShadingStyle,
} from "../src/core/styles.js";
import { apiTest } from "./helpers/api-test.js";

apiTest(
  "mesh replacement APIs update owned geometry colors scalar values and normalized packets",
  ["MeshSeries3D.constructor", "SurfaceMesh3D.constructor"],
  () => {
    const chart = new Chart3D();
    try {
      const mesh = new MeshSeries3D(chart),
        surface = chart.addSurfaceMeshSeries();
      assert.ok(mesh instanceof MeshSeries3D);
      assert.ok(surface instanceof SurfaceMesh3D);
      mesh.setData([
        { x: 0, y: 0, z: 0, value: 1 },
        { x: 1, y: 0, z: 0, value: 2 },
        { x: 0, y: 1, z: 0, value: 3 },
      ]);
      const positions = [0, 0, 0, 2, 0, 0, 0, 2, 0],
        values = [4, 5, 6],
        colors = [1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 1];
      mesh
        .invalidateVertexPositions(positions)
        .invalidateValues(values)
        .invalidateVertexColors(colors);
      positions[3] = 99;
      values[0] = 99;
      colors[0] = 0;
      assert.deepEqual(
        [...mesh.getGeometry().positions],
        [0, 0, 0, 2, 0, 0, 0, 2, 0],
      );
      assert.deepEqual([...mesh.getGeometry().values!], [4, 5, 6]);
      assert.equal(mesh.getGeometry().colors![0], 1);
      const packet = mesh.getDrawPackets((v) => v, "identity")[0];
      assert.equal(packet.positions[3], 2);
      assert.equal(packet.colors![0], 1);
      assert.equal(packet.count, 3);
      assert.throws(() => mesh.invalidateVertexPositions([1]), RangeError);
      assert.throws(() => mesh.invalidateValues([1]), RangeError);
      assert.throws(() => mesh.invalidateVertexColors([NaN]), RangeError);
      assert.equal(mesh.getSampleCount(), 3);
      mesh.invalidateVertexColors(undefined);
      assert.equal(mesh.getGeometry().colors, undefined);
      mesh.clear();
      assert.equal(mesh.getSampleCount(), 0);
      assert.equal(mesh.bounds("x"), undefined);
      surface.setData({ positions: [0, 0, 0, 1, 0, 0, 0, 1, 0] });
      assert.equal(surface.getTriangleCount(), 1);
    } finally {
      chart.dispose();
    }
  },
);

apiTest(
  "3D series styles axes event removal and disposal affect packets and chart membership",
  ["Series3DBase.dispose"],
  () => {
    const chart = new Chart3D(),
      mesh = chart.addSurfaceMeshSeries();
    try {
      mesh.setGeometry({ positions: [0, 0, 0, 1, 0, 0, 0, 1, 0] });
      const fill = new SolidFill({ color: ColorRGBA(10, 20, 30) }),
        wire = new SolidLine({ fillStyle: fill, thickness: 2 });
      mesh
        .setName("mesh")
        .setVisible(false)
        .setFillStyle(fill)
        .setWireframeStyle(wire)
        .setColorShadingStyle(new SimpleShadingStyle());
      assert.equal(mesh.getName(), "mesh");
      assert.equal(mesh.getVisible(), false);
      assert.equal(mesh.getFillStyle(), fill);
      assert.equal(mesh.getWireframeStyle(), wire);
      assert.equal(mesh.getColorShadingStyle()?.type, "simple");
      assert.equal(mesh.getDrawPackets((v) => v, "same")[0].unshaded, true);
      mesh.setVisible(true).setMouseInteractions(false);
      assert.equal(mesh.mouseInteractions, false);
      mesh.setMouseInteractionsEnabled(true);
      assert.equal(mesh.mouseInteractions, true);
      mesh.setCursorEnabled(false);
      assert.equal(mesh.getCursorEnabled(), false);
      assert.equal(mesh.getAxisX(), chart.getDefaultAxisX());
      assert.equal(mesh.getAxisY(), chart.getDefaultAxisY());
      assert.equal(mesh.getAxisZ(), chart.getDefaultAxisZ());
      let changes = 0,
        disposed = 0;
      const token = mesh.on("change", () => changes++);
      mesh.setLighting(false);
      assert.equal(changes, 1);
      assert.equal(mesh.off(token), true);
      mesh.setLighting(true);
      assert.equal(changes, 1);
      mesh.on("dispose", () => disposed++);
      mesh.dispose();
      mesh.dispose();
      assert.equal(disposed, 1);
      assert.equal(chart.getSeries().includes(mesh), false);
      assert.equal(mesh.isDisposed(), true);
    } finally {
      chart.dispose();
    }
  },
);

test("bounded 3D boxes retain newest boxes and roundness appears in renderer packets", () => {
  const chart = new Chart3D(),
    boxes = chart.addBoxSeries();
  try {
    boxes.setMaxSampleCount(2).addBoxes([
      { x: 0, y: 0, z: 0 },
      { x: 2, y: 3, z: 4 },
      { x: 5, y: 6, z: 7 },
    ]);
    assert.equal(boxes.getMaxSampleCount(), 2);
    assert.equal(boxes.getSampleCount(), 2);
    assert.deepEqual(boxes.bounds("x"), { start: 2, end: 6 });
    boxes.setRoundedEdges(true);
    assert.equal(boxes.getRoundedEdges(), 0.12);
    assert.equal(boxes.getDrawPackets((v) => v, "id")[0].roundness, 0.12);
    assert.throws(() => boxes.setRoundedEdges(0.6), RangeError);
    assert.equal(boxes.getRoundedEdges(), 0.12);
    boxes.setRoundedEdges(false);
    assert.equal(boxes.getRoundedEdges(), 0);
    boxes.clear();
    assert.equal(boxes.getSampleCount(), 0);
    assert.equal(boxes.bounds("z"), undefined);
  } finally {
    chart.dispose();
  }
});

test("model alignment and location copies move world bounds without mutating retained model vertices", () => {
  const chart = new Chart3D(),
    model = chart.addMeshModel();
  try {
    model
      .setModelGeometry({ vertices: [0, 0, 0, 2, 0, 0, 0, 2, 0] })
      .setModelLocation({ x: 5, y: 6, z: 7 })
      .setModelAlignment({ x: 0, y: 0, z: 0 });
    const original = model.getGeometry().positions,
      at = model.bounds("x")!;
    assert.ok(at.start < 5 && at.end > 5);
    const location = model.getModelLocation();
    location.x = 999;
    assert.deepEqual(model.getModelLocation(), { x: 5, y: 6, z: 7 });
    const alignment = model.getModelAlignment();
    alignment.x = -1;
    assert.equal(model.getModelAlignment().x, 0);
    model.setModelAlignment({ x: -1, y: 0, z: 0 });
    assert.equal(model.bounds("x")!.start, 5);
    assert.throws(
      () => model.setModelAlignment({ x: 2, y: 0, z: 0 }),
      RangeError,
    );
    assert.equal(model.getModelAlignment().x, -1);
    assert.deepEqual(model.getGeometry().positions, original);
  } finally {
    chart.dispose();
  }
});

test("3D surface cursor resolves retained finite nodes and respects visibility cursor and disposal", () => {
  const chart = new Chart3D();
  try {
    chart.axisX.setInterval(0, 2);
    chart.axisY.setInterval(0, 5);
    chart.axisZ!.setInterval(0, 2);
    const grid = chart.addSurfaceGridSeries({ columns: 2, rows: 2 });
    grid.invalidateHeightMap([
      [1, 2],
      [3, 4],
    ]);
    const point = chart.translateCoordinate(
        { x: 0, y: 1, z: 0 },
        { x: chart.axisX, y: chart.axisY, z: chart.axisZ },
        chart.coordsClient,
      ),
      hit = grid.solveNearest3D(point)!;
    assert.equal(hit.distanceSquared, 0);
    assert.deepEqual([hit.x, hit.y, hit.z], [0, 1, 0]);
    assert.equal(hit.series, grid);
    grid.setCursorEnabled(false);
    assert.equal(grid.solveNearest3D(point), undefined);
    grid.setCursorEnabled(true).setVisible(false);
    assert.equal(grid.solveNearest3D(point), undefined);
    grid.dispose();
    assert.equal(grid.solveNearest3D(point), undefined);
  } finally {
    chart.dispose();
  }
});
