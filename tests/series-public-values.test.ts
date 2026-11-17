import test from "node:test";
import assert from "node:assert/strict";
import { ChartXY, Chart3D, Polar } from "../src/chart.js";
import { DataSetXY } from "../src/core/data.js";
import { palette, fillColor } from "../src/series.js";
import {
  SolidFill,
  SolidLine,
  ColorRGBA,
  PointShape,
} from "../src/core/styles.js";

test("public point series fields expose applied materials rotations source ownership visibility and cursor state", () => {
  const chart = new ChartXY(),
    three = new Chart3D();
  try {
    const fill = new SolidFill({ color: ColorRGBA(120, 30, 40) }),
      stroke = new SolidLine({ fillStyle: fill, thickness: 4 }),
      series = chart
        .addPointLineAreaSeries()
        .setName("trace")
        .setStrokeStyle(stroke)
        .setPointFillStyle(fill)
        .setPointStrokeStyle(stroke)
        .setAreaFillStyle(fill)
        .setPointShape(PointShape.Triangle)
        .setPointRotation(45)
        .setPointSize(9)
        .setAnimationHighlight(false)
        .setHighlight(0.5)
        .add({ x: 1, y: 2 });
    assert.equal(series.chart, chart);
    assert.equal(series.name, "trace");
    assert.equal(series.stroke, stroke);
    assert.equal(series.pointFill, fill);
    assert.equal(series.pointStroke, stroke);
    assert.equal(series.areaFill, fill);
    assert.equal(series.pointShape, PointShape.Triangle);
    assert.equal(series.pointRotation, 45);
    assert.equal(series.highlight, 0.5);
    const packet = series.drawPacket("points");
    assert.equal(packet.pointRotation, 45);
    assert.equal(packet.pointShape, PointShape.Triangle);
    assert.equal(packet.pointStrokeThickness, 4);
    assert.deepEqual(
      series.getPoints().map((p) => [p.x, p.y]),
      [[1, 2]],
    );
    series.setCursorEnabled(false).setVisible(false);
    assert.equal(series.cursorEnabled, false);
    assert.equal(series.visible, false);
    assert.equal(chart.solveNearest({ clientX: 0, clientY: 0 }).length, 0);
    const spatial = three.addLineSeries().add({ x: 1, y: 2, z: 3 });
    assert.equal(spatial.axisZ, three.axisZ);
    assert.deepEqual(spatial.bounds("z"), { start: 3, end: 3 });
    assert.equal(fillColor(undefined), palette[0]);
    assert.equal(
      new Set(palette.map((c) => c.toUint32())).size,
      palette.length,
    );
    assert.ok(palette.length >= 6);
  } finally {
    chart.dispose();
    three.dispose();
  }
});

test("public heatmap fields distinguish fixed and scrolling domains and retain wireframe and axis ownership", () => {
  const chart = new ChartXY();
  try {
    const heat = chart
        .addHeatmapGridSeries({ columns: 2, rows: 2, dataOrder: "rows" })
        .setName("grid")
        .setStart({ x: 2, y: 3 })
        .setStep({ x: 4, y: 5 }),
      wire = new SolidLine({ thickness: 2 });
    heat.setWireframeStyle(wire).invalidateIntensityValues([
      [1, 2],
      [3, 4],
    ]);
    assert.equal(heat.chart, chart);
    assert.equal(heat.axisY, chart.axisY);
    assert.equal(heat.name, "grid");
    assert.equal(heat.kind, "heatmap");
    assert.deepEqual(heat.start, { x: 2, y: 3 });
    assert.deepEqual(heat.step, { x: 4, y: 5 });
    assert.deepEqual(heat.bounds("y"), { start: 3, end: 13 });
    assert.equal(heat.wireframe, wire);
    assert.equal(heat.scrolling, false);
    heat.setCursorEnabled(false).setVisible(false);
    assert.equal(heat.cursorEnabled, false);
    assert.equal(heat.visible, false);
    assert.equal(chart.solveNearest({ clientX: 0, clientY: 0 }).length, 0);
    const stream = chart.addHeatmapScrollingGridSeries({
      resolution: 2,
      scrollDimension: "rows",
    });
    stream.addIntensityValues([
      [1, 2],
      [3, 4],
      [5, 6],
    ]);
    assert.equal(stream.scrolling, true);
    assert.equal(stream.scrollDimension, "rows");
    assert.equal(stream.sampleCount, 3);
    assert.equal(stream.getSampleCount(), 3);
    assert.equal(stream.getIntensityValue(2, 1), 6);
    stream.clear();
    assert.equal(stream.sampleCount, 0);
  } finally {
    chart.dispose();
  }
});

test("public polar fields preserve chart ownership dimensions data orientation and angular intensity addressing", () => {
  const chart = new Polar();
  try {
    const series = chart.addLineSeries().setData([{ angle: 90, amplitude: 2 }]);
    assert.equal(series.polarChart, chart);
    const screen = series.polarChart.projectPolarPoint({
      angle: 90,
      amplitude: 2,
    });
    assert.ok(Number.isFinite(screen.x) && Number.isFinite(screen.y));
    assert.deepEqual(series.getData(), [{ angle: 90, amplitude: 2 }]);
    const heat = chart
      .addHeatmapSeries({
        sectors: 4,
        annuli: 2,
        amplitudeEnd: 6,
        dataOrder: "sectors",
      })
      .invalidateIntensityValues([
        [1, 5],
        [2, 6],
        [3, 7],
        [4, 8],
      ]);
    assert.equal(heat.polar, true);
    assert.equal(heat.sectors, 4);
    assert.equal(heat.annuli, 2);
    assert.equal(heat.polarDataOrder, "sectors");
    assert.deepEqual([...heat.data], [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.equal(heat.getIntensityAt(-90, 4), 8);
  } finally {
    chart.dispose();
  }
});

test("public NaN declaration flags remain metadata and never discard or rewrite explicitly supplied source values", () => {
  for (const hint of [true, false]) {
    const data = new DataSetXY({ includesNaN: hint });
    try {
      assert.equal(data.includesNaN, hint);
      data.appendSamples({ x: [1, 2], y: [NaN, 4] });
      assert.equal(data.getSampleCount(), 2);
      assert.ok(Number.isNaN(data.getValue("y", 0)));
      assert.equal(data.getValue("y", 1), 4);
    } finally {
      data.dispose();
    }
  }
});
