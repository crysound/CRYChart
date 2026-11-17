import test from "node:test";
import assert from "node:assert/strict";
import { MapChart } from "../src/map.js";
import { SolidFill, SolidLine, ColorRGBA } from "../src/core/styles.js";
import { recordingChartContext } from "./helpers/recording-chart-context.js";

test("public map overlay fields expose owned geographic series revisions materials visibility and disposal used by the renderer", () => {
  const chart = new MapChart({ headless: true, width: 640, height: 400 });
  try {
    const points = chart.addPointSeries(),
      line = chart.addLineSeries(),
      fill = new SolidFill({ color: ColorRGBA(20, 30, 240) }),
      stroke = new SolidLine({ fillStyle: fill, thickness: 3 });
    points
      .setName("sites")
      .setFillStyle(fill)
      .setStrokeStyle(stroke)
      .setPointSize(12);
    const revision = points.revision;
    points.addPoints([[0, 0]]);
    assert.equal(points.chart, chart);
    assert.equal(points.kind, "points");
    assert.equal(line.kind, "line");
    assert.equal(points.name, "sites");
    assert.equal(points.fill, fill);
    assert.equal(points.stroke, stroke);
    assert.equal(points.pointSize, 12);
    assert.equal(points.revision, revision + 1);
    const drawing = recordingChartContext();
    chart.render(drawing.ctx);
    assert.ok(drawing.of("arc").some((c) => c.args[2] === 6));
    assert.ok(
      drawing.of("fill").some((c) => c.fill === fill.getColor().toCSS()),
    );
    points.setVisible(false);
    assert.equal(points.visible, false);
    const before = drawing.of("arc").length;
    chart.render(drawing.ctx);
    assert.equal(drawing.of("arc").length, before);
    assert.equal(points.disposed, false);
    points.dispose();
    assert.equal(points.disposed, true);
    assert.equal(chart.getSeries().includes(points), false);
    assert.equal(points.getSampleCount(), 0);
  } finally {
    chart.dispose();
  }
});
