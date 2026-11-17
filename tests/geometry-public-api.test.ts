import assert from "node:assert/strict";
import { ChartXY } from "../src/chart.js";
import {
  GeometryStyle,
  RectangleFigure,
  SegmentFigure,
  PolygonFigure,
  BoxFigure,
} from "../src/geometry.js";
import { SolidFill, SolidLine, ColorRGBA } from "../src/core/styles.js";
import { apiTest } from "./helpers/api-test.js";
import { recordingChartContext } from "./helpers/recording-chart-context.js";

const fill = new SolidFill({ color: ColorRGBA(220, 20, 30) }),
  other = new SolidFill({ color: ColorRGBA(20, 30, 220) }),
  stroke = new SolidLine({ fillStyle: fill, thickness: 3 });
const rect = { left: 0, top: 0, width: 100, height: 100 };
function fixture() {
  const chart = new ChartXY();
  chart.axisX.setInterval(0, 10);
  chart.axisY.setInterval(0, 10);
  return chart;
}

apiTest(
  "geometry styles handles and copied figure dimensions preserve source ownership and real bounds",
  [
    "GeometryStyle.constructor",
    "GeometryStyle.getFillStyle",
    "GeometryStyle.getStrokeStyle",
    "RectangleFigure.constructor",
    "SegmentFigure.constructor",
    "PolygonFigure.constructor",
    "BoxFigure.constructor",
    "BoxFigure.getDimensions",
    "PackedFigure.getFillStyle",
  ],
  () => {
    const chart = fixture();
    try {
      const style = new GeometryStyle(fill, stroke);
      assert.equal(style.getFillStyle(), fill);
      assert.equal(style.getStrokeStyle(), stroke);
      const rectangle = chart
          .addRectangleSeries()
          .addRectangle({ x: 1, y: 2, width: 3, height: 4 }),
        segment = chart
          .addSegmentSeries()
          .addSegment({ startX: 1, startY: 2, endX: 3, endY: 4 }),
        polygon = chart.addPolygonSeries().addPolygon([
          { x: 0, y: 0 },
          { x: 3, y: 0 },
          { x: 0, y: 3 },
        ]);
      assert.ok(rectangle instanceof RectangleFigure);
      assert.ok(segment instanceof SegmentFigure);
      assert.ok(polygon instanceof PolygonFigure);
      rectangle.setFillStyle(fill);
      assert.equal(rectangle.getFillStyle(), fill);
      assert.deepEqual(rectangle.getDimensionsPositionAndSize(), {
        x: 1,
        y: 2,
        width: 3,
        height: 4,
      });
      const box = chart.addBoxSeries().add({
        start: 1,
        end: 2,
        lowerExtreme: 1,
        lowerQuartile: 2,
        median: 3,
        upperQuartile: 4,
        upperExtreme: 5,
      });
      assert.ok(box instanceof BoxFigure);
      const copy = box.getDimensions();
      copy.median = 99;
      assert.deepEqual(box.getDimensions(), {
        start: 1,
        end: 2,
        lowerExtreme: 1,
        lowerQuartile: 2,
        median: 3,
        upperQuartile: 4,
        upperExtreme: 5,
      });
    } finally {
      chart.dispose();
    }
  },
);

apiTest(
  "geometry series configuration events highlighting and screen solving preserve retained samples",
  [
    "GeometrySeries.changed",
    "GeometrySeries.getName",
    "GeometrySeries.getSeriesDrawOrderIndex",
    "GeometrySeries.getVisible",
    "GeometrySeries.setCursorEnabled",
    "GeometrySeries.setCursorResultTableFormatter",
    "GeometrySeries.getCursorResultTableFormatter",
    "GeometrySeries.setMouseInteractions",
    "GeometrySeries.setMouseInteractionsEnabled",
    "GeometrySeries.getAnimationHighlight",
    "GeometrySeries.advanceHighlight",
    "GeometrySeries.getHighlightStrength",
    "GeometrySeries.cancelHighlightAnimation",
    "GeometrySeries.suspendHighlightAnimation",
    "GeometrySeries.setEffect",
    "GeometrySeries.on",
    "GeometrySeries.off",
    "GeometrySeries.onDispose",
    "GeometrySeries.dispose",
    "GeometrySeries.solveNearestFromScreen",
  ],
  () => {
    const chart = fixture(),
      series = chart.addRectangleSeries();
    try {
      const figure = series.addRectangle({ x: 1, y: 1, width: 2, height: 3 });
      series.setName("gates").setDrawOrder({ seriesDrawOrderIndex: 7 });
      assert.equal(series.getName(), "gates");
      assert.equal(series.getSeriesDrawOrderIndex(), 7);
      assert.equal(series.getVisible(), true);
      const format = () => [["gate"]];
      series.setCursorResultTableFormatter(format);
      assert.equal(series.getCursorResultTableFormatter()!()[0][0], "gate");
      series.setCursorEnabled(false);
      assert.equal(series.solveNearest({ clientX: 0, clientY: 0 }), undefined);
      series
        .setCursorEnabled(true)
        .setMouseInteractions(false)
        .setMouseInteractionsEnabled(true);
      assert.equal(series.mouseInteractions, true);
      const drawing = recordingChartContext();
      series.draw(drawing.ctx, rect);
      assert.equal(
        series.solveNearestFromScreen({ x: 20, y: 75 }).figure.index,
        figure.index,
      );
      const revision = series.revision;
      series.changed();
      assert.equal(series.revision, revision + 1);
      series.setHighlight(true);
      assert.equal(series.getAnimationHighlight(), true);
      series.advanceHighlight(0);
      series.advanceHighlight(600);
      assert.equal(series.getHighlightStrength(), 1);
      series.suspendHighlightAnimation();
      assert.equal(series.getHighlightStrength(), 0);
      series.cancelHighlightAnimation();
      assert.equal(series.getHighlightStrength(), 0);
      series.setAnimationHighlight(false);
      assert.equal(series.getAnimationHighlight(), false);
      assert.equal(series.getSampleCount(), 1);
      assert.equal(series.setEffect(false), series);
      assert.throws(() => series.setEffect(true), /not implemented/);
      let notifications = 0;
      const token = series.on("custom", () => notifications++);
      series.events.emit("custom");
      series.off(token);
      series.events.emit("custom");
      assert.equal(notifications, 1);
      series.onDispose(() => notifications++);
      series.dispose();
      assert.equal(notifications, 2);
      assert.equal(chart.getSeries().includes(series), false);
    } finally {
      chart.dispose();
    }
  },
);

apiTest(
  "packed figure epoch checks reject stale removal and polygon disposal notifies exactly once",
  [
    "PackedSeries.itemAlive",
    "PackedSeries.removeItem",
    "PolygonFigure.dispose",
  ],
  () => {
    const chart = fixture(),
      series = chart.addRectangleSeries();
    try {
      const old = series.addRectangle({ x: 0, y: 0, width: 1, height: 1 }),
        epoch = old.epoch;
      assert.equal(series.itemAlive(old.index, epoch), true);
      series.clear();
      const current = series.addRectangle({ x: 2, y: 3, width: 1, height: 1 });
      series.removeItem(old.index, epoch);
      assert.equal(series.getSampleCount(), 1);
      assert.equal(series.itemAlive(old.index, epoch), false);
      assert.equal(series.itemAlive(current.index, current.epoch), true);
      series.removeItem(current.index, current.epoch);
      assert.equal(series.getSampleCount(), 0);
      assert.equal(current.isDisposed(), true);
      const polygon = chart.addPolygonSeries().addPolygon([
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
      ]);
      let calls = 0;
      polygon.onDispose(() => calls++);
      polygon.dispose();
      polygon.dispose();
      assert.equal(calls, 1);
    } finally {
      chart.dispose();
    }
  },
);

apiTest(
  "range high and low outlines reach separate drawn boundaries while fill styles round trip independently",
  [
    "RangeSeries.setHighFillStyle",
    "RangeSeries.getHighFillStyle",
    "RangeSeries.setLowFillStyle",
    "RangeSeries.getLowFillStyle",
    "RangeSeries.setHighStrokeStyle",
    "RangeSeries.getHighStrokeStyle",
    "RangeSeries.setLowStrokeStyle",
    "RangeSeries.getLowStrokeStyle",
    "RangeSeries.setStrokeStyle",
  ],
  () => {
    const chart = fixture(),
      series = chart.addRangeSeries();
    try {
      const low = new SolidLine({ fillStyle: other, thickness: 5 });
      series.setStrokeStyle(stroke);
      assert.equal(series.getHighStrokeStyle(), stroke);
      assert.equal(series.getLowStrokeStyle(), stroke);
      series
        .setHighFillStyle(fill)
        .setLowFillStyle(other)
        .setHighStrokeStyle(stroke)
        .setLowStrokeStyle(low)
        .add([
          { position: 1, low: 2, high: 6 },
          { position: 3, low: 3, high: 8 },
        ]);
      assert.equal(series.getHighFillStyle(), fill);
      assert.equal(series.getLowFillStyle(), other);
      assert.equal(series.getHighStrokeStyle(), stroke);
      assert.equal(series.getLowStrokeStyle(), low);
      const drawing = recordingChartContext();
      series.draw(drawing.ctx, rect);
      assert.ok(
        drawing.of("fill").some((c) => c.fill === fill.getColor().toCSS()),
      );
      assert.ok(drawing.of("stroke").some((c) => c.lineWidth === 3));
      assert.ok(drawing.of("stroke").some((c) => c.lineWidth === 5));
      assert.equal(series.getSampleCount(), 2);
    } finally {
      chart.dispose();
    }
  },
);

apiTest(
  "OHLC widths gaps packing and positive negative fills preserve source rows and draw distinct price directions",
  [
    "OHLCSeries.setFigureWidth",
    "OHLCSeries.getFigureWidth",
    "OHLCSeries.setFigureMinimumGap",
    "OHLCSeries.getFigureMinimumGap",
    "OHLCSeries.getPackData",
    "OHLCSeries.setPositiveFillStyle",
    "OHLCSeries.setNegativeFillStyle",
    "GeometrySeries.hitTest",
  ],
  () => {
    const chart = fixture(),
      series = chart.addOHLCSeries();
    try {
      series
        .setFigureWidth(0.8)
        .setFigureMinimumGap(3)
        .setPositiveFillStyle(fill)
        .setNegativeFillStyle(other)
        .add([
          { x: 1, open: 3, high: 6, low: 2, close: 5 },
          { x: 1.01, open: 6, high: 7, low: 1, close: 2 },
        ]);
      assert.equal(series.getFigureWidth(), 0.8);
      assert.equal(series.getFigureMinimumGap(), 3);
      assert.equal(series.getPackData(), false);
      const drawing = recordingChartContext();
      series.draw(drawing.ctx, rect);
      assert.ok(
        drawing.of("fillRect").some((c) => c.fill === fill.getColor().toCSS()),
      );
      assert.ok(
        drawing.of("fillRect").some((c) => c.fill === other.getColor().toCSS()),
      );
      series.setPackData(true);
      assert.equal(series.getPackData(), true);
      assert.equal(series.getSampleCount(), 2);
      assert.equal(series.hitTest({ x: 10, y: 50 }, rect), undefined);
      assert.throws(() => series.setFigureWidth(0), RangeError);
    } finally {
      chart.dispose();
    }
  },
);
