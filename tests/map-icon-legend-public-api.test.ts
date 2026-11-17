import test from "node:test";
import assert from "node:assert/strict";
import { Icon } from "../src/custom-icon.js";
import { LinearGradientFill, canvasGradient } from "../src/gradients.js";
import {
  MapChart,
  MapOverlay,
  MapPointSeries,
  MapLineSeries,
  pointInMapRing,
  type GeoJSONFeatureCollection,
} from "../src/map.js";
import { ChartXY } from "../src/chart.js";
import {
  LegendEventTarget,
  LegendEntryClickBehaviors,
} from "../src/native-legend.js";
import { SolidFill, SolidLine, ColorRGBA } from "../src/core/styles.js";
import { UnsupportedFeatureError } from "../src/contracts.js";
import { recordingChartContext } from "./helpers/recording-chart-context.js";
import { apiTest } from "./helpers/api-test.js";

test("custom icon immutable dimensions preserve aspect ratio borrowed source and disposal notifications", () => {
  const source = { width: 80, height: 40 } as HTMLCanvasElement,
    icon = new Icon(source);
  try {
    assert.equal(icon.getWidth(), undefined);
    assert.equal(icon.getHeight(), undefined);
    assert.deepEqual(icon.getRasterSize(), { width: 80, height: 40 });
    assert.equal(icon.getSource(), source);
    assert.equal(icon.getCanvasSource(), source);
    const width = icon.setWidth(20),
      height = icon.setHeight(10),
      size = icon.setSize(5, 6);
    assert.deepEqual(width.getRasterSize(), { width: 20, height: 10 });
    assert.deepEqual(height.getRasterSize(), { width: 20, height: 10 });
    assert.deepEqual(size.getRasterSize(), { width: 5, height: 6 });
    assert.equal(width.getWidth(), 20);
    assert.equal(height.getHeight(), 10);
    assert.equal(icon.getWidth(), undefined);
    assert.throws(() => icon.setSize(0, 1), RangeError);
    let released = 0;
    const off = icon.onDispose(() => released++);
    off();
    icon.onDispose(() => released++);
    assert.equal(icon.isDisposed(), false);
    icon.dispose();
    icon.dispose();
    assert.equal(icon.isDisposed(), true);
    assert.equal(released, 1);
    assert.equal(icon.getSource(), undefined);
    assert.equal(icon.getCanvasSource(), undefined);
    icon.onDispose(() => released++);
    assert.equal(released, 2);
    assert.throws(() => icon.setWidth(2), /disposed/);
    width.dispose();
    height.dispose();
    size.dispose();
  } finally {
    icon.dispose();
  }
});

test("gradient representative color visible stops and Canvas endpoints match the actual fill contract", () => {
  const black = ColorRGBA(0, 0, 0),
    white = ColorRGBA(255, 255, 255),
    gradient = new LinearGradientFill({
      angle: 90,
      stops: [
        { offset: 0, color: black },
        { offset: 1, color: white },
      ],
    }),
    drawing = recordingChartContext();
  assert.equal(gradient.hasVisibleStops(), true);
  assert.equal(gradient.getColor().getR(), 127.5);
  assert.equal(new LinearGradientFill({ stops: [] }).hasVisibleStops(), false);
  const output = canvasGradient(drawing.ctx, gradient, {
    left: 10,
    top: 20,
    width: 100,
    height: 40,
  });
  assert.equal(typeof output.addColorStop, "function");
  const points = drawing.of("gradient")[0].args;
  assert.ok(Math.abs(points[0] - 10) < 1e-10);
  assert.ok(Math.abs(points[2] - 110) < 1e-10);
  assert.deepEqual(
    drawing.of("colorStop").map((c) => c.args),
    [
      [0, black.toCSS()],
      [1, white.toCSS()],
    ],
  );
  const error = new UnsupportedFeatureError("custom behavior");
  assert.ok(error instanceof Error);
  assert.match(error.message, /custom behavior/);
  assert.equal(error.name, "UnsupportedFeatureError");
});

test("legend event tokens focus behavior toggles and hit testing follow the laid out entry bounds", () => {
  const events = new LegendEventTarget();
  let count = 0;
  const token = events.on("click", () => count++);
  events.emit("click", {});
  assert.equal(count, 1);
  assert.equal(events.off(token), true);
  events.emit("click", {});
  assert.equal(count, 1);
  events.on("click", () => count++);
  events.clear();
  events.emit("click", {});
  assert.equal(count, 1);
  assert.equal(events.listenerCount(), 0);
  const chart = new ChartXY();
  try {
    const a = chart.addLineSeries().setName("A"),
      b = chart.addLineSeries().setName("B"),
      legend = chart.legend;
    legend.setOptions({ visible: true });
    const entries = legend.getEntries(),
      info = {
        entry: entries.find((e) => e.component === a)!,
        allEntries: entries,
      };
    LegendEntryClickBehaviors.toggleIndividualVisibility({}, info);
    assert.equal(a.getVisible(), false);
    LegendEntryClickBehaviors.focusClicked({}, info);
    assert.equal(a.getVisible(), true);
    assert.equal(b.getVisible(), false);
    const layout = legend.getLayout(recordingChartContext().ctx, {
      left: 0,
      top: 0,
      width: 640,
      height: 400,
    });
    assert.equal(layout.hidden, false);
    assert.equal(
      legend.hitTest({ x: layout.bounds.left + 1, y: layout.bounds.top + 1 }),
      true,
    );
    assert.equal(legend.hitTest({ x: -1, y: -1 }), false);
    legend.setVisible(false);
    assert.equal(
      legend.hitTest({ x: layout.bounds.left + 1, y: layout.bounds.top + 1 }),
      false,
    );
  } finally {
    chart.dispose();
  }
});

apiTest(
  "map overlay aliases retain owned geographic data and clear or remove only the intended series",
  [
    "MapOverlay.constructor",
    "MapPointSeries.constructor",
    "MapLineSeries.constructor",
  ],
  () => {
    const chart = new MapChart({ headless: true, width: 640, height: 400 });
    try {
      const points = chart.addPoints([[1, 2]]),
        line = chart.addLine([
          [0, 0],
          [1, 1],
        ]);
      assert.ok(points instanceof MapPointSeries);
      assert.ok(line instanceof MapLineSeries);
      assert.ok(points instanceof MapOverlay);
      const data: any[] = [{ longitude: 3, latitude: 4 }];
      points.setData(data).addPoints([[5, 6]]);
      data[0].latitude = 80;
      assert.deepEqual(points.getPoints(), [
        { longitude: 3, latitude: 4 },
        [5, 6],
      ]);
      const fill = new SolidFill({ color: ColorRGBA(1, 2, 3) }),
        stroke = new SolidLine({ fillStyle: fill, thickness: 3 });
      points
        .setFillStyle(fill)
        .setStrokeStyle(stroke)
        .setName("cities")
        .setVisible(false);
      assert.equal(points.getFillStyle(), fill);
      assert.equal(points.getStrokeStyle(), stroke);
      assert.equal(points.getName(), "cities");
      assert.equal(points.getVisible(), false);
      points.clear();
      assert.equal(points.getSampleCount(), 0);
      assert.equal(line.getSampleCount(), 2);
      chart.removeOverlay(points);
      assert.equal(chart.getSeries().includes(points), false);
      line.dispose();
      assert.equal(chart.getSeries().includes(line), false);
    } finally {
      chart.dispose();
    }
  },
);

test("map region keys selection styles and explicit view preserve source features and projection round trips", () => {
  const chart = new MapChart({ headless: true, width: 640, height: 400 }),
    data: GeoJSONFeatureCollection = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          id: "A",
          properties: { name: "Alpha", code: "region-a" },
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [0, 0],
                [10, 0],
                [10, 10],
                [0, 10],
                [0, 0],
              ],
            ],
          },
        },
      ],
    };
  try {
    chart.setGeoJSON(data).setRegionKey("code").setSelectedRegion("region-a");
    assert.deepEqual(chart.getRegions(), [
      { key: "region-a", name: "Alpha", value: undefined, selected: true },
    ]);
    const regions = chart.getRegions();
    regions[0].name = "changed";
    assert.equal(chart.getRegions()[0].name, "Alpha");
    chart.setSelectedRegion(undefined);
    assert.equal(chart.getRegions()[0].selected, false);
    const stroke = new SolidLine({ thickness: 4 });
    chart.setRegionStrokeStyle(stroke);
    const drawing = recordingChartContext();
    chart.render(drawing.ctx);
    const scale = drawing.of("scale")[0].args[0];
    assert.ok(
      drawing
        .of("stroke")
        .some((c) => Math.abs(c.lineWidth * scale - 4) < 1e-10),
    );
    chart.setView({ center: [20, 30], zoom: 2 });
    const view = chart.getView();
    assert.ok(Math.abs(view.center.longitude - 20) < 1e-8);
    assert.ok(Math.abs(view.center.latitude - 30) < 1e-8);
    assert.equal(view.zoom, 2);
    assert.throws(() => chart.setView({ zoom: 0 }), RangeError);
    assert.equal(chart.getView().zoom, 2);
    const rect = chart.getPlotRect();
    assert.ok(rect.width > 0 && rect.height > 0);
    rect.width = 0;
    assert.ok(chart.getPlotRect().width > 0);
    assert.equal(data.features[0].properties!.name, "Alpha");
    const ring = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
      { x: 0, y: 2 },
    ];
    assert.equal(pointInMapRing({ x: 1, y: 1 }, ring), true);
    assert.equal(pointInMapRing({ x: 0, y: 1 }, ring), true);
    assert.equal(pointInMapRing({ x: 3, y: 1 }, ring), false);
  } finally {
    chart.dispose();
  }
});
