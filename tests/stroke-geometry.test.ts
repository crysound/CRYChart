import test from "node:test";
import assert from "node:assert/strict";
import {
  dashDistances,
  dashPattern,
  splinePositions,
} from "../src/stroke-geometry.js";
import { ChartXY } from "../src/chart.js";

test("dash phase follows continuous screen distance across short vertices and restarts after gaps", () => {
  const p = new Float32Array([0, 0, 1, 0, 2, 0, NaN, NaN, 10, 10, 13, 14]);
  assert.deepEqual(
    [...dashDistances(p, 3, 3, 5)],
    [0, 3, 3, 6, 0, 0, 0, 0, 0, 15],
  );
  assert.deepEqual(dashPattern([1, 2, 3], 2), [2, 4, 6, 2, 4, 6]);
  assert.deepEqual(dashPattern([0, 0]), []);
  assert.throws(() => dashPattern([1, -2]), /nonnegative/);
});

test("spline passes every original point, preserves straight trajectories and splits at missing values", () => {
  const straight = splinePositions(new Float32Array([0, 1, 1, 3, 2, 5]), 8);
  assert.equal(straight.length, 34);
  for (let i = 0; i < straight.length; i += 2)
    assert.ok(Math.abs(straight[i + 1]! - 2 * straight[i]! - 1) < 1e-6);
  const curve = splinePositions(
    new Float32Array([0, 0, 1, 1, 2, 0, NaN, NaN, 4, 2, 5, 3]),
    4,
  );
  assert.deepEqual([...curve.slice(8, 10)], [1, 1]);
  assert.ok(Number.isNaN(curve[18]) && Number.isNaN(curve[19]));
  assert.deepEqual([...curve.slice(-2)], [5, 3]);
  assert.ok(curve[3]! > curve[2]!); // Smooth tangent changes the shape between original endpoints.
});

test("spline render geometry caches separately from original samples used by cursor and point markers", () => {
  const chart = new ChartXY(),
    series = chart.addSplineSeries().add([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 0 },
    ]);
  const first = series.drawPacket("line"),
    markers = series.drawPacket("points");
  assert.equal(series.getSampleCount(), 3);
  assert.equal(markers.count, 3);
  assert.equal(first.count, 33);
  assert.notEqual(first.id, markers.id);
  chart.getDefaultAxisX().setInterval({ start: 0.5, end: 1.5 });
  assert.equal(series.drawPacket("line").positions, first.positions);
  series.add({ x: 3, y: 2 });
  assert.notEqual(series.drawPacket("line").positions, first.positions);
  chart.dispose();
});
