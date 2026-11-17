import test from "node:test";
import assert from "node:assert/strict";
import { ChartXY } from "../src/chart.js";
import { Gauge } from "../src/specialty.js";
import {
  AxisScrollStrategies,
  ColorRGBA,
  SolidFill,
} from "../src/core/styles.js";
import { FormattingFunctions } from "../src/formatting-functions.js";
import { apiTest } from "./helpers/api-test.js";

apiTest(
  "engine object methods delegate to the owning chart and dispose all engine owned icons",
  [
    "ChartXY.engine.addCustomIcon",
    "ChartXY.engine.captureFrame",
    "ChartXY.engine.dispose",
    "ChartXY.engine.getBackgroundFillStyle",
    "ChartXY.engine.getContainer",
    "ChartXY.engine.getRenderStats",
    "ChartXY.engine.setBackgroundFillStyle",
  ],
  () => {
    const chart = new ChartXY();
    try {
      const fill = new SolidFill({ color: ColorRGBA(10, 20, 30) });
      assert.equal(chart.engine.setBackgroundFillStyle(fill), chart.engine);
      assert.equal(chart.engine.getBackgroundFillStyle(), fill);
      assert.equal(chart.getBackgroundFillStyle(), fill);
      assert.equal(chart.engine.getContainer(), chart.container);
      chart.addLineSeries().add({ x: 1, y: 2 });
      const stats = chart.engine.getRenderStats();
      assert.equal(stats.series, 1);
      assert.equal(stats.samples, 1);
      assert.throws(() => chart.engine.captureFrame(), /browser canvas/);
      const icon = chart.engine.addCustomIcon(
        { width: 12, height: 6 } as HTMLCanvasElement,
        { width: 24 },
      );
      assert.deepEqual(icon.getRasterSize(), { width: 24, height: 12 });
      chart.engine.dispose();
      assert.equal(chart.isDisposed(), true);
      assert.equal(icon.isDisposed(), true);
      assert.throws(() => chart.engine.addCustomIcon(undefined), /disposed/);
    } finally {
      chart.dispose();
    }
  },
);

apiTest(
  "specialty engine layout resizes the owner and capture delegates browser availability checks",
  ["SpecialtyChart.engine.captureFrame", "SpecialtyChart.engine.layout"],
  () => {
    const chart = new Gauge({ headless: true, width: 100, height: 100 });
    try {
      assert.equal(chart.valueFormatter(1500), "1.5k");
      assert.equal(chart.valueFormatter(2_000_000), "2M");
      chart.setValueFormatter((value) => value + " units");
      assert.equal(chart.valueFormatter(12), "12 units");
      Object.assign(chart, {
        canvas: { width: 0, height: 0, remove() {} },
        container: { clientWidth: 300, clientHeight: 200 },
      });
      chart.engine.layout();
      assert.equal(chart.width, 300);
      assert.equal(chart.height, 200);
      assert.equal(chart.canvas!.width, 300);
      Object.assign(chart, { canvas: undefined, container: undefined });
      assert.throws(() => chart.engine.captureFrame(), /browser canvas/);
    } finally {
      chart.dispose();
    }
  },
);

test("scroll strategy configuration factories preserve options and drive expansion progressive regressive and legacy scrolling", () => {
  const chart = new ChartXY(),
    axis = chart.axisX,
    series = chart.addLineSeries();
  try {
    const expansion = AxisScrollStrategies.expansion({ custom: "kept" });
    assert.equal(expansion.kind, "expansion");
    assert.equal(expansion.custom, "kept");
    assert.equal(Object.isFrozen(expansion), true);
    axis
      .setAnimationScroll(false)
      .setScrollMargins(false)
      .setInterval({ start: 0, end: 10, stopAxisAfter: false })
      .setScrollStrategy(expansion);
    series.addArraysXY([2, 20], [1, 2]);
    axis.updateAuto();
    assert.deepEqual(axis.getInterval(), { start: 0, end: 20 });
    axis
      .setScrollStrategy(AxisScrollStrategies.progressive())
      .setInterval({ start: 0, end: 10, stopAxisAfter: false });
    axis.updateAuto();
    assert.deepEqual(axis.getInterval(), { start: 10, end: 20 });
    axis
      .setScrollStrategy(AxisScrollStrategies.regressive())
      .setInterval({ start: 10, end: 20, stopAxisAfter: false });
    axis.updateAuto();
    assert.deepEqual(axis.getInterval(), { start: 2, end: 12 });
    const scrolling = AxisScrollStrategies.scrolling();
    assert.equal(scrolling.kind, "scrolling");
    axis
      .setScrollStrategy(scrolling)
      .setInterval({ start: 0, end: 10, stopAxisAfter: false });
    axis.updateAuto();
    assert.deepEqual(axis.getInterval(), { start: 10, end: 20 });
    assert.equal(axis.getScrollStrategy(), scrolling);
    assert.equal(
      FormattingFunctions.Numeric(1234.5, { start: 0, end: 10 }),
      "1234.5",
    );
    assert.equal(
      FormattingFunctions.Scientific(1000, { start: 0, end: 10 }),
      "1.00e+3",
    );
    assert.deepEqual(
      series.getPoints().map((p) => p.x),
      [2, 20],
    );
  } finally {
    chart.dispose();
  }
});
