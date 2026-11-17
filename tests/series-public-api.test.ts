import test from "node:test";
import assert from "node:assert/strict";
import { ChartXY, Chart3D, Polar } from "../src/chart.js";
import {
  PointLineAreaSeries,
  SplineSeries,
  HeatmapSeries,
  fillColor,
} from "../src/series.js";
import {
  PolarSeries,
  PolarLineSeries,
  PolarPointSeries,
  PolarPointLineSeries,
} from "../src/polar-series.js";
import { PolarHeatmapSeries } from "../src/polar-heatmap.js";
import {
  ColorRGBA,
  SolidFill,
  emptyFill,
  PalettedFill,
  LUT,
} from "../src/core/styles.js";
import { IndividualPointFill } from "../src/point-fill.js";
import { validateSolveMode, xyCursorHit } from "../src/cursor-api.js";
import { apiTest } from "./helpers/api-test.js";

apiTest(
  "series array aliases retain samples and binding revisions track mappings rather than appended data",
  ["PointLineAreaSeries.constructor", "SplineSeries.constructor"],
  () => {
    const chart = new ChartXY(),
      three = new Chart3D();
    try {
      const line = chart.addLineSeries();
      assert.ok(line instanceof PointLineAreaSeries);
      const revision = line.getDataBindingRevision();
      line.addArrayY([2, 4]).addArrayY([8]);
      assert.equal(line.getDataBindingRevision(), revision);
      assert.deepEqual(
        line.getPoints().map((p) => [p.x, p.y]),
        [
          [0, 2],
          [1, 4],
          [2, 8],
        ],
      );
      assert.equal(line.getPointAmount(), 3);
      assert.equal(line.getPointCount(), 3);
      line.setDataMapping(line.getDataMapping());
      assert.equal(line.getDataBindingRevision(), revision + 1);
      line.setDataCleaning({ minDataPointCount: 2 });
      assert.equal(line.getMaxSampleCount(), 2);
      assert.deepEqual(
        line.getPoints().map((p) => p.y),
        [4, 8],
      );
      const spline = chart.addSplineSeries();
      assert.ok(spline instanceof SplineSeries);
      spline.addArraysXY([0, 1, 2], [0, 5, 0]);
      assert.ok(spline.drawPacket().count > 3);
      assert.equal(spline.getSampleCount(), 3);
      const spatial = three.addLineSeries();
      spatial.addArraysXYZ([1, 2], [3, 4], [5, 6]);
      assert.equal(spatial.getAxisZ(), three.getDefaultAxisZ());
      assert.deepEqual(
        spatial.getPoints().map((p) => p.z),
        [5, 6],
      );
    } finally {
      chart.dispose();
      three.dispose();
    }
  },
);

test("visible domain bounds exclude nonfinite pairs preserve cached ownership and respond to new samples", () => {
  const chart = new ChartXY(),
    series = chart.addLineSeries();
  try {
    series.addArraysXY([0, 1, 2, 3], [2, NaN, -5, 9]);
    const bounds = series.boundsWithinOtherAxis("y", { start: 3, end: 1 })!;
    assert.deepEqual(bounds, { start: -5, end: 9 });
    bounds.start = -100;
    assert.deepEqual(series.boundsWithinOtherAxis("y", { start: 1, end: 3 }), {
      start: -5,
      end: 9,
    });
    assert.deepEqual(series.boundsWithinOtherAxis("x", { start: -6, end: 3 }), {
      start: 0,
      end: 2,
    });
    assert.equal(
      series.boundsWithinOtherAxis("y", { start: 10, end: 11 }),
      undefined,
    );
    series.add({ x: 2.5, y: 20 });
    assert.deepEqual(series.boundsWithinOtherAxis("y", { start: 1, end: 3 }), {
      start: -5,
      end: 20,
    });
  } finally {
    chart.dispose();
  }
});

test("series attributes cursor formatting interaction aliases and highlight colors preserve source styles", () => {
  const chart = new ChartXY(),
    s = chart.addPointLineAreaSeries();
  try {
    s.add({ x: 1, y: 2 });
    s.setIndividualPointSizeEnabled(true)
      .setIndividualPointRotationEnabled(true)
      .setIndividualPointColorEnabled(true)
      .setIndividualPointValueEnabled(true)
      .setPointRotation(90);
    assert.equal(s.getIndividualPointSizeEnabled(), true);
    assert.equal(s.getIndividualPointRotationEnabled(), true);
    assert.equal(s.getIndividualPointColorEnabled(), true);
    assert.equal(s.getIndividualPointValueEnabled(), true);
    assert.equal(s.getPointRotation(), 90);
    assert.throws(() => s.setPointRotation(NaN), RangeError);
    const color = ColorRGBA(40, 50, 60),
      fill = new SolidFill({ color });
    s.setFillStyle(fill).setAreaBaseline(-4);
    assert.equal(s.getFillStyle(), fill);
    assert.equal(s.areaBaseline, -4);
    s.setMouseInteractions(false);
    assert.equal(s.mouseInteractions, false);
    s.setMouseInteractionsEnabled(true);
    assert.equal(s.mouseInteractions, true);
    s.setCursorEnabled(false);
    assert.equal(s.getCursorEnabled(), false);
    const legacy = () => [["legacy"]];
    s.setCursorResultTableFormatter(legacy);
    assert.equal(s.cursorFormatter, legacy);
    const rows = [["before"]],
      hit = { x: 1, y: 2 };
    assert.equal(s.formatCursorRows(hit, rows), rows);
    const formatter = (h: any, b: any[][]) => [[h.y, b[0][0]]];
    s.setCursorFormattingOverride(formatter);
    assert.equal(s.getCursorFormattingOverride(), formatter);
    assert.deepEqual(s.formatCursorRows(hit, rows), [[2, "before"]]);
    assert.throws(() => s.setCursorFormattingOverride(1 as any), TypeError);
    s.setHighlight(1);
    s.advanceHighlight(0);
    s.advanceHighlight(600);
    assert.equal(s.getHighlightStrength(), 1);
    assert.notDeepEqual(s.resolveRenderColor(color), color);
    assert.equal(s.getFillStyle(), fill);
    s.suspendHighlightAnimation();
    assert.equal(s.getHighlightStrength(), 0);
    s.cancelHighlightAnimation();
    assert.equal(s.hasPendingHighlight(), false);
    let changed = 0;
    const token = s.on("datachange", () => changed++);
    s.add({ x: 2, y: 3 });
    s.off(token);
    s.add({ x: 3, y: 4 });
    assert.equal(changed, 1);
    assert.equal(s.setEffect(false), s);
    assert.equal(s.setEffect(undefined), s);
    assert.throws(() => s.setEffect(true), /not implemented/);
  } finally {
    chart.dispose();
  }
});

apiTest(
  "heatmap interpolation palette range cursor formatting and scrolling offsets preserve scalar data",
  ["HeatmapSeries.constructor"],
  () => {
    const chart = new ChartXY();
    try {
      const h = chart.addHeatmapGridSeries({
        columns: 2,
        rows: 2,
        dataOrder: "rows",
      });
      assert.ok(h instanceof HeatmapSeries);
      h.invalidateIntensityValues([
        [0, 10],
        [20, 30],
      ]);
      h.setName("temperature");
      assert.equal(h.getName(), "temperature");
      const range = { start: 0, end: 30 };
      h.setIntensityRange(range);
      range.end = 999;
      assert.deepEqual(h.intensityRange, { start: 0, end: 30 });
      h.setIntensityInterpolation("bilinear");
      assert.equal(h.getIntensityInterpolation(), "bilinear");
      assert.equal(h.getPixelInterpolationMode(), "bilinear");
      h.setPixelInterpolationMode(undefined);
      assert.equal(h.getIntensityInterpolation(), "disabled");
      assert.throws(
        () => h.setIntensityInterpolation("nearest" as any),
        TypeError,
      );
      assert.deepEqual([...h.data], [0, 10, 20, 30]);
      h.setCursorEnabled(false);
      assert.equal(h.getCursorEnabled(), false);
      const rows = [["before"]];
      assert.equal(h.formatCursorRows({}, rows), rows);
      const f = (hit: any) => [[hit.intensity]];
      h.setCursorFormattingOverride(f);
      assert.equal(h.getCursorFormattingOverride(), f);
      assert.deepEqual(h.formatCursorRows({ intensity: 20 }, rows), [[20]]);
      h.setVisible(false);
      assert.equal(h.getVisible(), false);
      h.setVisible(true);
      assert.equal(h.getVisible(), true);
      assert.equal(h.setEffect(false), h);
      assert.throws(() => h.setEffect(true), /not implemented/);
      assert.equal(h.isDisposed(), false);
      h.dispose();
      assert.equal(h.isDisposed(), true);
      const stream = chart
        .addHeatmapScrollingGridSeries({
          resolution: 2,
          scrollDimension: "columns",
        })
        .setDataCleaning({ maxDataPointCount: 3 });
      stream.addIntensityValues([
        [1, 2],
        [3, 4],
        [5, 6],
        [7, 8],
      ]);
      const offset = stream.getScrollOffset();
      assert.ok(offset.x >= 0 && offset.x < stream.columns);
      assert.equal(offset.y, 0);
      assert.equal(stream.getFirstRetainedSampleIndex(), 1);
      assert.equal(stream.getIntensityValue(3, 1), 8);
      offset.x = -1;
      assert.ok(stream.getScrollOffset().x >= 0);
    } finally {
      chart.dispose();
    }
  },
);

apiTest(
  "polar series factory variants retain raw polar data and formatter highlight lifecycle",
  [
    "PolarSeries.constructor",
    "PolarLineSeries.constructor",
    "PolarPointSeries.constructor",
    "PolarPointLineSeries.constructor",
  ],
  () => {
    const chart = new Polar();
    try {
      const line = chart.addLineSeries(),
        points = chart.addPointSeries(),
        both = chart.addPointLineSeries();
      assert.ok(line instanceof PolarLineSeries);
      assert.ok(points instanceof PolarPointSeries);
      assert.ok(both instanceof PolarPointLineSeries);
      assert.ok(line instanceof PolarSeries);
      line.setData([{ angle: 450, amplitude: -3 }]);
      assert.deepEqual(line.getData(), [{ angle: 450, amplitude: -3 }]);
      const rows = [["polar"]],
        hit = {} as any;
      assert.equal(line.formatCursorRows(hit, rows), rows);
      const formatter = () => [["override"]];
      line.setCursorFormattingOverride(formatter);
      assert.equal(line.getCursorFormattingOverride(), formatter);
      assert.deepEqual(line.formatCursorRows(hit, rows), [["override"]]);
      line.setHighlight(true);
      assert.equal(line.getAnimationHighlight(), true);
      line.advanceHighlight(0);
      line.advanceHighlight(600);
      assert.equal(line.getHighlightStrength(), 1);
      line.suspendHighlightAnimation();
      assert.equal(line.getHighlightStrength(), 0);
      line.cancelHighlightAnimation();
      assert.equal(line.hasPendingHighlight(), false);
    } finally {
      chart.dispose();
    }
  },
);

apiTest(
  "polar heatmap exposes palette and cursor policies independently from source intensities",
  ["PolarHeatmapSeries.constructor"],
  () => {
    const chart = new Polar();
    try {
      const heat = chart.addHeatmapSeries({
        sectors: 2,
        annuli: 2,
        amplitudeEnd: 10,
      });
      assert.ok(heat instanceof PolarHeatmapSeries);
      heat.invalidateIntensityValues([
        [1, 2],
        [3, 4],
      ]);
      const lut = new LUT({
          steps: [
            { value: 0, color: ColorRGBA(0, 0, 0) },
            { value: 4, color: ColorRGBA(255, 255, 255) },
          ],
        }),
        fill = new PalettedFill({ lut });
      heat.setFillStyle(fill);
      assert.equal(heat.getFillStyle(), fill);
      assert.equal(fill.getLUT(), lut);
      heat.setCursorEnabled(false).setCursorInterpolationEnabled(true);
      assert.equal(heat.getCursorEnabled(), false);
      assert.equal(heat.getCursorInterpolationEnabled(), true);
      assert.equal(heat.solveNearest({ clientX: 0, clientY: 0 }), undefined);
      const format = () => [["intensity"]];
      heat.setCursorResultTableFormatter(format);
      assert.equal(heat.getCursorResultTableFormatter(), format);
      assert.deepEqual(heat.getCursorResultTableFormatter()!(), [
        ["intensity"],
      ]);
      assert.deepEqual([...heat.data], [1, 2, 3, 4]);
    } finally {
      chart.dispose();
    }
  },
);

test("cursor hit helper preserves computed axes distances and metadata while fill resolution respects transparency", () => {
  const chart = new ChartXY(),
    s = chart.addLineSeries();
  try {
    chart.axisX.setInterval(0, 10);
    chart.axisY.setInterval(0, 10);
    const point = { x: 3, y: 7 },
      at = chart.translatePoint(
        point,
        { x: s.axisX, y: s.axisY },
        chart.coordsClient,
      );
    const hit = xyCursorHit(s, point, at, {
      distanceSquared: 999,
      extra: "ok",
    });
    assert.equal(hit.distanceSquared, 0);
    assert.equal(hit.series, s);
    assert.equal(hit.axisX, s.axisX);
    assert.equal(hit.axisY, s.axisY);
    assert.equal((hit as any).extra, "ok");
    assert.deepEqual(hit.cursorPosition.pointMarker, point);
    assert.doesNotThrow(() => validateSolveMode("show-nearest"));
    assert.doesNotThrow(() => validateSolveMode("show-all"));
    assert.doesNotThrow(() => validateSolveMode("show-pointed"));
    assert.throws(() => validateSolveMode("interpolated"), RangeError);
    const color = ColorRGBA(100, 20, 30),
      fill = new IndividualPointFill({ color });
    assert.equal(fill.getColor(), color);
    assert.equal(fillColor(new SolidFill({ color })), color);
    assert.equal(fillColor({ color }), color);
    assert.equal(fillColor({}, color), color);
    assert.equal(fillColor(emptyFill).getA(), 0);
    assert.equal(
      fill
        .setFallbackColor(ColorRGBA(1, 2, 3))
        .getColor()
        .getR(),
      1,
    );
    assert.equal(fill.getColor(), color);
  } finally {
    chart.dispose();
  }
});
