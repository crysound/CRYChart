import test from "node:test";
import assert from "node:assert/strict";
import { ChartXY, Chart3D, Polar, SurfaceGridSeries } from "../src/chart.js";
import { RangeSeries } from "../src/geometry.js";
import {
  FontSettings,
  SolidFill,
  SolidLine,
  ColorRGBA,
} from "../src/core/styles.js";
import { recordingChartContext } from "./helpers/recording-chart-context.js";
import { apiTest } from "./helpers/api-test.js";

class ChartHarness extends ChartXY {
  pending() {
    return this.hasPendingAxisScrollAnimations();
  }
  order() {
    return this.orderedSeriesForDrawing();
  }
}

test("chart aliases update title backgrounds cursor visibility events and series ordering", () => {
  const chart = new ChartHarness();
  try {
    const font = new FontSettings({ family: "Header", size: 22 }),
      fill = new SolidFill({ color: ColorRGBA(1, 2, 3) });
    chart
      .setTitleFont(font)
      .setBackgroundFillStyle(fill)
      .setSeriesBackgroundFillStyle(fill);
    assert.equal(chart.getTitleFont(), font);
    assert.equal(chart.resolveTextFont(font), font);
    assert.equal(chart.getBackgroundFillStyle(), fill);
    assert.equal(chart.getSeriesBackgroundFillStyle(), fill);
    chart.setTitleMargin({ left: 7, top: 9 });
    const margin = chart.getTitleMargin();
    margin.left = 999;
    assert.equal(chart.getTitleMargin().left, 7);
    chart.setVisible(false);
    assert.equal(chart.getVisible(), false);
    chart.setVisible(true);
    assert.equal(chart.getVisible(), true);
    chart.setCursor((c) => c.setResultTableVisible(false));
    assert.equal(chart.getCursor().resultVisible, false);
    chart.setAutoCursor((c) => c.setResultTableVisible(true));
    assert.equal(chart.getAutoCursor().resultVisible, true);
    chart.setAutoCursorMode("disabled");
    assert.equal(chart.getAutoCursorMode(), 0);
    chart.setMouseInteractions(false);
    assert.equal(chart.getUserInteractions(), false);
    chart.setMouseInteractionsEnabled(true);
    assert.equal(chart.getUserInteractions(), true);
    assert.doesNotThrow(() =>
      chart.validateAxisInteractions(chart.axisX, false),
    );
    let layouts = 0,
      custom = 0;
    const resize = chart.onResize(() => layouts++),
      token = chart.on("custom", () => custom++);
    chart.resize(500, 300);
    chart.events.emit("custom");
    chart.off(resize);
    chart.off(token);
    chart.resize(600, 400);
    chart.events.emit("custom");
    assert.equal(layouts, 1);
    assert.equal(custom, 1);
    const first = chart.addRectangleSeries(),
      second = chart.addRectangleSeries();
    chart.onSeriesDrawOrderChanged();
    first.setDrawOrder({ seriesDrawOrderIndex: 4 });
    second.setDrawOrder({ seriesDrawOrderIndex: 2 });
    assert.deepEqual(chart.order(), [second, first]);
    chart.removeSeries(first);
    assert.equal(chart.getSeries().includes(first), false);
    first.dispose();
  } finally {
    chart.dispose();
  }
});

test("chart axis host methods bound fits visible domains and schedule or cancel only registered animation axes", () => {
  const chart = new ChartHarness();
  try {
    const s = chart
      .addLineSeries()
      .setPointSize(8)
      .setStrokeStyle(new SolidLine({ thickness: 6 }));
    s.addArraysXY([1, 2, 3], [5, -4, 9]);
    assert.equal(chart.supportsAxisIntervalMaxRestrictions(), true);
    assert.deepEqual(chart.getAxisInitialInterval(chart.axisX), {
      start: 0,
      end: 10,
    });
    assert.deepEqual(chart.getAxisDefaultFitMargins(chart.axisX), {
      start: 0,
      end: 0,
    });
    assert.deepEqual(chart.getAxisAutoScrollMargins(chart.axisX), {
      start: 4,
      end: 4,
    });
    assert.equal(
      chart.getAxisCustomTickPlacementPixelLength(chart.axisX),
      undefined,
    );
    assert.equal(chart.getDefaultAxisZ(), undefined);
    assert.deepEqual(chart.boundsFor(chart.axisX), { start: 1, end: 3 });
    chart.axisX.setInterval(1, 2);
    assert.deepEqual(chart.boundsFor(chart.axisY, true), { start: -4, end: 5 });
    chart.fitToData();
    assert.ok(chart.axisY.getInterval().start <= -4);
    assert.ok(chart.axisY.getInterval().end >= 9);
    chart.requestAxisScrollAnimation(chart.axisX);
    assert.equal(chart.pending(), true);
    chart.cancelAxisScrollAnimation(chart.axisX);
    assert.equal(chart.pending(), false);
    chart.setVisible(false);
    chart.requestAxisScrollAnimation(chart.axisX);
    assert.equal(chart.pending(), false);
    const area = chart.addAreaRangeSeries();
    assert.ok(area instanceof RangeSeries);
    area.add([{ position: 0, low: -2, high: 6 }]);
    assert.equal(area.getSampleCount(), 1);
  } finally {
    chart.dispose();
  }
});

apiTest(
  "legacy XY surface grids retain finite height bounds transform extents styles and lifecycle",
  [
    "SurfaceGridSeries.constructor",
    "SurfaceGridSeries.invalidateHeightMap",
    "SurfaceGridSeries.setStart",
    "SurfaceGridSeries.setStep",
    "SurfaceGridSeries.setFillStyle",
    "SurfaceGridSeries.setWireframeStyle",
    "SurfaceGridSeries.setName",
    "SurfaceGridSeries.getName",
    "SurfaceGridSeries.setVisible",
    "SurfaceGridSeries.getVisible",
    "SurfaceGridSeries.getSampleCount",
    "SurfaceGridSeries.bounds",
    "SurfaceGridSeries.dispose",
    "SurfaceGridSeries.isDisposed",
  ],
  () => {
    const chart = new ChartXY();
    try {
      const grid = chart.addSurfaceGridSeries({ columns: 2, rows: 2 });
      assert.ok(grid instanceof SurfaceGridSeries);
      grid
        .invalidateHeightMap([
          [NaN, -3],
          [8, Infinity],
        ])
        .setStart({ x: 2, z: 4 })
        .setStep({ x: 3, z: -2 })
        .setName("legacy");
      assert.equal(grid.getName(), "legacy");
      assert.equal(grid.getSampleCount(), 4);
      assert.deepEqual(grid.bounds("x"), { start: 2, end: 5 });
      assert.deepEqual(grid.bounds("y"), { start: -3, end: 8 });
      assert.deepEqual(grid.bounds("z"), { start: 4, end: 2 });
      const fill = new SolidFill(),
        wire = new SolidLine({ thickness: 2 });
      grid.setFillStyle(fill).setWireframeStyle(wire).setVisible(false);
      assert.equal(grid.fill, fill);
      assert.equal(grid.wireframe, wire);
      assert.equal(grid.getVisible(), false);
      assert.equal(grid.isDisposed(), false);
      grid.dispose();
      assert.equal(grid.isDisposed(), true);
      assert.equal(chart.getSeries().includes(grid), false);
    } finally {
      chart.dispose();
    }
  },
);

test("polar axis layout settings validate finite angles and cursor formatting can reset to the default", () => {
  const chart = new Polar();
  try {
    chart.setAngleOrigin(45).setClockwise(true).setRadialAxisAngle(90);
    assert.equal(chart.getAngleOrigin(), 45);
    assert.equal(chart.getClockwise(), true);
    assert.equal(chart.getRadialAxisAngle(), 90);
    assert.equal(chart.getAngularAxis(), chart.getDefaultAxisX());
    assert.ok(chart.getAxisTickFont() instanceof FontSettings);
    assert.throws(() => chart.setRadialAxisAngle(NaN), RangeError);
    assert.equal(chart.getRadialAxisAngle(), 90);
    const formatter = () => [["polar"]];
    chart.setCursorFormatting(formatter);
    assert.equal(chart.getCursorFormatting(), formatter);
    assert.deepEqual(chart.getCursorFormatting()(chart, {} as any, []), [
      ["polar"],
    ]);
    chart.setCursorFormatting(undefined);
    assert.notEqual(chart.getCursorFormatting(), formatter);
    assert.throws(() => chart.setCursorFormatting(5 as any), TypeError);
  } finally {
    chart.dispose();
  }
});

test("3D camera diagnostics zoom policy and axis publication preserve requested source ranges", () => {
  const chart = new Chart3D({ experimental3DCameraModel: "legacy" });
  try {
    assert.equal(chart.getProjection(), "orthographic");
    assert.equal(chart.getAnimationZoom(), false);
    chart.setAnimationZoom(false);
    assert.throws(() => chart.setAnimationZoom(true), /world-camera/);
    assert.equal(
      chart.onAxisIntervalRequested(chart.axisX, { start: 1, end: 2 }),
      false,
    );
    chart.setProjection("perspective").setCameraAutomaticFittingEnabled(true);
    assert.equal(chart.getProjection(), "perspective");
    assert.equal(chart.getCameraAutomaticFittingEnabled(), true);
    chart.setAnimationZoom(true);
    assert.equal(chart.getAnimationZoom(), true);
    assert.deepEqual(chart.getAxisDefaultFitMargins(chart.axisX), {
      start: 0,
      end: 0,
    });
    assert.equal(
      chart.getAxisDefaultStrokeStyle(),
      chart.theme.axisStrokeStyle,
    );
    const direction = chart.getCameraDirection();
    assert.ok(
      Math.abs(Math.hypot(direction.x, direction.y, direction.z) - 1) < 1e-10,
    );
    direction.x = 999;
    assert.notEqual(chart.getCameraDirection().x, 999);
    chart.axisX.setInterval(2, 8);
    assert.deepEqual(chart.axisX.getInterval(), { start: 2, end: 8 });
    const stats = chart.getRenderStats();
    assert.equal(stats.backend, "headless");
    assert.equal(stats.series, 0);
    assert.ok(stats.width > 0 && stats.height > 0);
  } finally {
    chart.dispose();
  }
});

test("image export composes canvas layers converts bytes forwards options and revokes download URLs", async (t) => {
  const chart = new ChartXY(),
    drawing = recordingChartContext(),
    created: any[] = [],
    urls: string[] = [],
    revoked: string[] = [],
    descriptors = new Map<string, PropertyDescriptor | undefined>();
  const replace = (key: string, value: any) => {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      value,
      configurable: true,
      writable: true,
    });
  };
  const png = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
  let fail = false;
  replace("document", {
    createElement: (tag: string) => {
      const element: any =
        tag === "canvas"
          ? {
              width: 0,
              height: 0,
              getContext: () => drawing.ctx,
              toDataURL: (type: string, quality: number) => {
                created.push({ type, quality });
                return `data:${type};base64,AQID`;
              },
              toBlob: (
                callback: (blob: Blob | null) => void,
                type: string,
                quality: number,
              ) => {
                created.push({ type, quality });
                callback(
                  fail ? null : new Blob([new Uint8Array([1, 2, 3])], { type }),
                );
              },
            }
          : {
              click() {
                created.push({ download: this.download, href: this.href });
              },
            };
      return element;
    },
  });
  const originalCreate = URL.createObjectURL,
    originalRevoke = URL.revokeObjectURL;
  URL.createObjectURL = (blob) => {
    assert.deepEqual(blob.size, png.size);
    urls.push("blob:test");
    return "blob:test";
  };
  URL.revokeObjectURL = (url) => {
    revoked.push(String(url));
  };
  t.after(() => {
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  });
  try {
    assert.throws(() => chart.captureFrame(), /browser canvas/);
    const canvas = { width: 600, height: 400 };
    Object.assign(chart, { canvas, overlay: {}, underlay: {} });
    const blob = chart.captureFrame("image/jpeg", 0.7);
    assert.equal(blob.type, "image/jpeg");
    assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], [1, 2, 3]);
    assert.equal(drawing.of("drawImage").length, 3);
    assert.equal(
      (await chart.exportToImage({ type: "image/webp", quality: 0.5 })).type,
      "image/webp",
    );
    assert.equal(
      (await chart.exportImage({ type: "image/jpeg" })).type,
      "image/jpeg",
    );
    assert.equal((await chart.captureImage()).type, "image/png");
    await chart.downloadPNG("report");
    assert.deepEqual(created.at(-1), {
      download: "report.png",
      href: "blob:test",
    });
    assert.deepEqual(urls, revoked);
    assert.deepEqual(created[0], { type: "image/jpeg", quality: 0.7 });
    fail = true;
    await assert.rejects(chart.exportToImage(), /failed/);
    Object.assign(chart, {
      canvas: undefined,
      overlay: undefined,
      underlay: undefined,
    });
    chart.dispose();
    assert.throws(() => chart.captureFrame(), /disposed/);
  } finally {
    Object.assign(chart, {
      canvas: undefined,
      overlay: undefined,
      underlay: undefined,
    });
    chart.dispose();
  }
});
