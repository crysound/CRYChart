import test from "node:test";
import assert from "node:assert/strict";
import { ChartXY } from "../src/chart.js";
import { ColorRGBA, SolidFill, SolidLine } from "../src/core/styles.js";
import { recordingPathContext } from "./helpers/recording-path-context.js";

const rect = { left: 0, top: 0, width: 100, height: 100 };
const red = new SolidFill({ color: ColorRGBA(255, 0, 0) }),
  blue = new SolidFill({ color: ColorRGBA(0, 0, 255) });
const stroke = new SolidLine({ fillStyle: blue, thickness: 2 });
function fixture() {
  const chart = new ChartXY();
  chart.axisX.setInterval({ start: 0, end: 10 });
  chart.axisY.setInterval({ start: 0, end: 10 });
  return chart;
}

test("per-rectangle styles retain priority over mutable series defaults in actual Canvas draws", () => {
  const chart = fixture(),
    series = chart.addRectangleSeries(),
    recording = recordingPathContext();
  try {
    series.setDefaultStyle((style) =>
      style.setFillStyle(red).setStrokeStyle(stroke),
    );
    const first = series.addRectangle({ x: 1, y: 1, width: 2, height: 3 });
    series.addRectangles([{ x: 5, y: 2, width: 1, height: 2 }]);
    first.setFillStyle(() => blue).setStrokeStyle(() => stroke);
    series.draw(recording.ctx, rect);
    assert.deepEqual(
      recording.fills.map((item) => item.style),
      [blue.getColor().toCSS(), red.getColor().toCSS()],
    );
    assert.equal(first.getDominantStyle(), blue);
    assert.equal(first.getStrokeStyle(), stroke);
    assert.equal(series.getPointCount(), 2);
    assert.equal(series.getXMin(), 1);
    assert.equal(series.getXMax(), 6);
    assert.equal(series.getYMin(), 1);
    assert.equal(series.getYMax(), 4);
    assert.equal(series.getAxisX(), chart.axisX);
    assert.equal(series.getAxisY(), chart.axisY);
  } finally {
    chart.dispose();
  }
});

test("segment handles update numeric bounds, drawing visibility and disposal subscriptions", () => {
  const chart = fixture(),
    series = chart.addSegmentSeries(),
    recording = recordingPathContext();
  try {
    const figure = series.addSegment({
      startX: 2,
      startY: 1,
      endX: 8,
      endY: 9,
    });
    figure
      .setDimensions({ start: { x: 9, y: 8 }, end: { x: 1, y: 2 } })
      .setStrokeStyle(stroke);
    assert.deepEqual(figure.getDimensions(), {
      startX: 9,
      startY: 8,
      endX: 1,
      endY: 2,
    });
    assert.deepEqual(figure.getBoundaries(), {
      start: { x: 1, y: 2 },
      end: { x: 9, y: 8 },
    });
    assert.deepEqual(series.bounds("x"), { start: 1, end: 9 });
    series.draw(recording.ctx, rect);
    assert.equal(recording.strokes.length, 1);
    assert.ok(
      recording.strokes[0]!.path.some(
        (point) => point[0] === "move" && point[1] === 90 && point[2] === 20,
      ),
    );
    figure.setVisible(false).setMouseInteractions(false);
    assert.equal(figure.getVisible(), false);
    assert.equal(figure.getMouseInteractions(), false);
    series.draw(recording.ctx, rect);
    assert.equal(recording.strokes.length, 1);
    let removed = 0;
    const token = figure.onDispose(() => {
      removed++;
    });
    figure.offDispose(token);
    figure.onDispose(() => {
      removed += 10;
    });
    figure.dispose();
    figure.dispose();
    assert.equal(removed, 10);
    assert.equal(series.getSampleCount(), 0);
    assert.throws(
      () => figure.setDimensions({ startX: 0, startY: 0, endX: 1, endY: 1 }),
      /removed/,
    );
  } finally {
    chart.dispose();
  }
});

test("polygon handle changes invalidate bounds and rendering while returned dimensions remain independent", () => {
  const chart = fixture(),
    series = chart.addPolygonSeries(),
    recording = recordingPathContext();
  try {
    const figure = series.addPolygon([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 0, y: 4 },
    ]);
    const copy = figure.getDimensions();
    copy[0]!.x = 99;
    figure
      .setDimensions([
        { x: 1, y: 1 },
        { x: 3, y: 1 },
        { x: 1, y: 3 },
      ])
      .setFillStyle(() => red)
      .setStrokeStyle(() => stroke);
    assert.equal(figure.getDimensions()[0]!.x, 1);
    assert.equal(figure.getFillStyle(), red);
    assert.equal(figure.getStrokeStyle(), stroke);
    assert.deepEqual(series.bounds("x"), { start: 1, end: 3 });
    series.draw(recording.ctx, rect);
    assert.equal(recording.fills.length, 1);
    figure.setVisible(false);
    assert.equal(figure.getVisible(), false);
    series.draw(recording.ctx, rect);
    assert.equal(recording.fills.length, 1);
    let disposed = 0;
    figure.onDispose(() => {
      disposed++;
    });
    series.clear();
    assert.equal(figure.isDisposed(), true);
    assert.equal(disposed, 1);
    assert.equal(series.getSampleCount(), 0);
    assert.throws(() => figure.setDimensions([]), /disposed/);
  } finally {
    chart.dispose();
  }
});
