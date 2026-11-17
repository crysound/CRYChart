import test from "node:test";
import assert from "node:assert/strict";
import { ChartXY } from "../src/chart.js";
import type { PointLineAreaSeries } from "../src/series.js";
import { ColorRGBA, SolidFill } from "../src/core/styles.js";
import { LinearGradientFill } from "../src/gradients.js";
import { recordingPathContext } from "./helpers/recording-path-context.js";

class AreaChart extends ChartXY {
  drawAreaFallback(ctx: CanvasRenderingContext2D, series: PointLineAreaSeries) {
    this.drawArea(ctx, series);
  }
}
function fixture() {
  const chart = new AreaChart();
  chart.resize(400, 240);
  chart.axisX.setInterval({ start: 0, end: 4 });
  chart.axisY.setInterval({ start: 0, end: 10 });
  return chart;
}

test("Canvas area fill closes each finite run to the baseline without bridging NaN gaps", () => {
  const chart = fixture(),
    series = chart.addAreaSeries(),
    recording = recordingPathContext();
  try {
    const fill = new SolidFill({ color: ColorRGBA(200, 20, 40, 128) });
    series.setAreaFillStyle(fill).add([
      { x: 0, y: 1 },
      { x: 1, y: 2 },
      { x: 2, y: NaN },
      { x: 3, y: 3 },
      { x: 4, y: 4 },
    ]);
    chart.drawAreaFallback(recording.ctx, series);
    const r = chart.getSeriesScreenRect(series),
      base = r.top + r.height;
    assert.deepEqual(
      recording.fills.map((item) => item.path),
      [
        [
          ["move", r.left, base],
          ["line", r.left, base - 0.1 * r.height],
          ["line", r.left + 0.25 * r.width, base - 0.2 * r.height],
          ["line", r.left + 0.25 * r.width, base],
          ["close"],
        ],
        [
          ["move", r.left + 0.75 * r.width, base],
          ["line", r.left + 0.75 * r.width, base - 0.3 * r.height],
          ["line", r.left + r.width, base - 0.4 * r.height],
          ["line", r.left + r.width, base],
          ["close"],
        ],
      ],
    );
    assert.ok(
      recording.fills.every((item) => item.style === fill.getColor().toCSS()),
    );
    assert.equal(recording.depth(), 0);
  } finally {
    chart.dispose();
  }
});

test("Canvas area gradients use finite data and baseline bounds while preserving source values", () => {
  const chart = fixture(),
    series = chart.addAreaSeries(),
    recording = recordingPathContext();
  try {
    series.setAreaFillStyle(new LinearGradientFill()).add([
      { x: 1, y: 2 },
      { x: 2, y: NaN },
      { x: 3, y: 8 },
    ]);
    const before = series.getDataSet().readBack();
    chart.drawAreaFallback(recording.ctx, series);
    const r = chart.getSeriesScreenRect(series),
      [x0, y0, x1, y1] = recording.gradients[0]!.endpoints;
    assert.equal(x0, r.left + 0.5 * r.width);
    assert.equal(x1, x0);
    assert.equal(y0, r.top + r.height);
    assert.ok(Math.abs(y1! - (r.top + 0.2 * r.height)) < 1e-10);
    assert.equal(recording.gradients[0]!.stops.length, 2);
    assert.equal(recording.fills.length, 2);
    assert.deepEqual(series.getDataSet().readBack(), before);
    assert.equal(recording.depth(), 0);
  } finally {
    chart.dispose();
  }
});

test("invalid area baselines and all-missing gradient data restore Canvas state without painting", () => {
  const chart = fixture(),
    series = chart.addAreaSeries(),
    recording = recordingPathContext();
  try {
    series.add([{ x: 0, y: 1 }]);
    series.areaBaseline = NaN;
    chart.drawAreaFallback(recording.ctx, series);
    assert.equal(recording.depth(), 0);
    series.areaBaseline = 0;
    series
      .clear()
      .setAreaFillStyle(new LinearGradientFill())
      .add([{ x: 0, y: NaN }]);
    chart.drawAreaFallback(recording.ctx, series);
    assert.equal(recording.fills.length, 0);
    assert.equal(recording.gradients.length, 0);
    assert.equal(recording.depth(), 0);
  } finally {
    chart.dispose();
  }
});
