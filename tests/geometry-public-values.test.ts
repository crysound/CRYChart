import test from "node:test";
import assert from "node:assert/strict";
import { ChartXY } from "../src/chart.js";
import { GeometryStyle, type BoxSeries } from "../src/geometry.js";
import { SolidFill, SolidLine, ColorRGBA } from "../src/core/styles.js";
import { recordingChartContext } from "./helpers/recording-chart-context.js";

const rect = { left: 0, top: 0, width: 100, height: 100 };
function fixture() {
  const chart = new ChartXY();
  chart.axisX.setInterval(0, 10);
  chart.axisY.setInterval(0, 10);
  return chart;
}

test("public geometry fields retain chart axis aliases identity material and cursor lifecycle used by drawing and picking", () => {
  const chart = fixture();
  try {
    const series = chart.addRectangleSeries(),
      other = chart.addRectangleSeries(),
      fill = new SolidFill({ color: ColorRGBA(20, 200, 30) }),
      stroke = new SolidLine({ fillStyle: fill, thickness: 4 }),
      style = new GeometryStyle(fill, stroke);
    assert.equal(style.fill, fill);
    assert.equal(style.stroke, stroke);
    series
      .setFillStyle(style.fill)
      .setStrokeStyle(style.stroke)
      .setName("region")
      .setAnimationHighlight(false)
      .setHighlight(0.5)
      .addRectangle({ x: 1, y: 2, width: 3, height: 4 });
    assert.equal(series.chart, chart);
    assert.equal(series.axisX, chart.axisX);
    assert.equal(series.axisY, chart.axisY);
    assert.equal(series.xAxis, series.axisX);
    assert.equal(series.yAxis, series.axisY);
    assert.equal(series.name, "region");
    assert.equal(series.kind, "rectangles");
    assert.notEqual(series.id, other.id);
    assert.equal(typeof series.id, "number");
    assert.equal(series.fill, fill);
    assert.equal(series.stroke, stroke);
    assert.equal(series.highlight, 0.5);
    const formatter = () => [["selected"]];
    series.setCursorResultTableFormatter(formatter).setCursorEnabled(false);
    assert.equal(series.cursorFormatter, formatter);
    assert.equal(series.cursorEnabled, false);
    assert.equal(series.solveNearest({ clientX: 0, clientY: 0 }), undefined);
    series.setCursorEnabled(true);
    const drawing = recordingChartContext();
    series.draw(drawing.ctx, rect);
    assert.ok(drawing.of("stroke").some((c) => c.lineWidth === 4));
    series.setVisible(false);
    assert.equal(series.visible, false);
    assert.equal(series.solveNearest({ clientX: 0, clientY: 0 }), undefined);
    assert.equal(series.disposed, false);
    series.dispose();
    assert.equal(series.disposed, true);
    assert.equal(chart.getSeries().includes(series), false);
  } finally {
    chart.dispose();
  }
});

test("packed and polygon public figure storage styles and event hubs preserve per-figure behavior and clear stale metadata", () => {
  const chart = fixture();
  try {
    const packed = chart.addRectangleSeries(),
      figure = packed.addRectangle({
        x: 1,
        y: 2,
        width: 2,
        height: 3,
        name: "sensor",
      }),
      fill = new SolidFill({ color: ColorRGBA(200, 20, 30) }),
      stroke = new SolidLine({ fillStyle: fill, thickness: 3 });
    assert.equal(figure.series, packed);
    assert.equal(packed.metadata.get(figure.index)!.name, "sensor");
    figure.setMouseInteractions(false);
    assert.equal(figure.mouseInteractions, false);
    assert.equal(figure.getMouseInteractions(), false);
    let disposed = 0;
    figure.events.on("dispose", () => disposed++);
    figure.dispose();
    assert.equal(disposed, 1);
    assert.equal(figure.events.listenerCount(), 0);
    assert.equal(packed.metadata.size, 0);
    const polygons = chart.addPolygonSeries(),
      polygon = polygons.addPolygon([
        { x: 1, y: 1 },
        { x: 4, y: 1 },
        { x: 1, y: 4 },
      ]);
    assert.equal(polygons.figures[0], polygon);
    assert.equal(polygon.series, polygons);
    assert.deepEqual([...polygon.points], [1, 1, 4, 1, 1, 4]);
    polygon.setFillStyle(fill).setStrokeStyle(stroke);
    assert.equal(polygon.fill, fill);
    assert.equal(polygon.stroke, stroke);
    const drawing = recordingChartContext();
    polygons.draw(drawing.ctx, rect);
    assert.ok(
      drawing.of("fill").some((c) => c.fill === fill.getColor().toCSS()),
    );
    polygon.setVisible(false);
    assert.equal(polygon.visible, false);
    const count = drawing.of("fill").length;
    polygons.draw(drawing.ctx, rect);
    assert.equal(drawing.of("fill").length, count);
    assert.equal(polygon.disposed, false);
    polygon.events.on("dispose", () => disposed++);
    polygon.dispose();
    assert.equal(polygon.disposed, true);
    assert.equal(disposed, 2);
    assert.equal(polygon.events.listenerCount(), 0);
  } finally {
    chart.dispose();
  }
});

test("range public boundary materials choose forward and reversed fills and independent stroke widths", () => {
  const chart = fixture();
  try {
    const forward = chart.addRangeSeries(),
      reverse = chart.addRangeSeries(),
      high = new SolidFill({ color: ColorRGBA(255, 0, 0) }),
      low = new SolidFill({ color: ColorRGBA(0, 0, 255) }),
      top = new SolidLine({ fillStyle: high, thickness: 2 }),
      bottom = new SolidLine({ fillStyle: low, thickness: 5 });
    for (const s of [forward, reverse])
      s.setHighFillStyle(high)
        .setLowFillStyle(low)
        .setHighStrokeStyle(top)
        .setLowStrokeStyle(bottom);
    assert.equal(forward.highStroke, top);
    assert.equal(forward.lowStroke, bottom);
    assert.equal(reverse.lowFill, low);
    forward.add([
      { position: 1, low: 2, high: 7 },
      { position: 3, low: 2, high: 7 },
    ]);
    reverse.add([
      { position: 5, low: 8, high: 3 },
      { position: 7, low: 8, high: 3 },
    ]);
    const drawing = recordingChartContext();
    forward.draw(drawing.ctx, rect);
    reverse.draw(drawing.ctx, rect);
    assert.deepEqual(
      drawing.of("fill").map((c) => c.fill),
      [high.getColor().toCSS(), low.getColor().toCSS()],
    );
    assert.deepEqual(
      drawing.of("stroke").map((c) => c.lineWidth),
      [2, 5, 2, 5],
    );
  } finally {
    chart.dispose();
  }
});

test("OHLC public pack width gap mode and polarity materials drive candle drawing while horizontal boxes swap bounds", () => {
  const chart = fixture();
  try {
    const candles = chart.addOHLCSeries(),
      positive = new SolidFill({ color: ColorRGBA(0, 255, 0) }),
      negative = new SolidFill({ color: ColorRGBA(255, 0, 0) });
    candles
      .setFigureWidth(6)
      .setFigureMinimumGap(3)
      .setPackData(false)
      .setPositiveFillStyle(positive)
      .setNegativeFillStyle(negative)
      .add([
        { x: 2, open: 2, high: 8, low: 1, close: 6 },
        { x: 5, open: 7, high: 9, low: 2, close: 3 },
      ]);
    assert.equal(candles.figureWidth, 6);
    assert.equal(candles.minimumGap, 3);
    assert.equal(candles.pack, false);
    assert.equal(candles.mode, "candlestick");
    assert.equal(candles.positive, positive);
    assert.equal(candles.negative, negative);
    const drawing = recordingChartContext();
    candles.draw(drawing.ctx, rect);
    assert.deepEqual(
      drawing.of("fillRect").map((c) => [c.args[2], c.fill]),
      [
        [6, positive.getColor().toCSS()],
        [6, negative.getColor().toCSS()],
      ],
    );
    candles.setPackData(true);
    assert.equal(candles.pack, true);
    assert.equal(candles.getSampleCount(), 2);
    const boxes: BoxSeries = chart.addBoxSeries();
    boxes.add({
      start: 1,
      end: 2,
      lowerExtreme: 3,
      lowerQuartile: 4,
      median: 5,
      upperQuartile: 6,
      upperExtreme: 8,
    });
    boxes.setHorizontal(true);
    assert.equal(boxes.horizontal, true);
    assert.deepEqual(boxes.bounds("x"), { start: 3, end: 8 });
    assert.deepEqual(boxes.bounds("y"), { start: 1, end: 2 });
  } finally {
    chart.dispose();
  }
});
