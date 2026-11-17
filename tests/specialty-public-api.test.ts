import assert from "node:assert/strict";
import {
  Pie,
  PieSlice,
  Gauge,
  Spider,
  SpiderSeries,
  BarChart,
  TreeMapChart,
  ParallelCoordinateChart,
  DataGrid,
} from "../src/specialty.js";
import {
  SolidFill,
  SolidLine,
  ColorRGBA,
  FontSettings,
  UIElementBuilders,
} from "../src/core/styles.js";
import { apiTest } from "./helpers/api-test.js";
import { recordingChartContext } from "./helpers/recording-chart-context.js";

const options = { headless: true, width: 640, height: 400 };
const fill = new SolidFill({ color: ColorRGBA(220, 20, 40) }),
  stroke = new SolidLine({ fillStyle: fill, thickness: 3 });

apiTest(
  "specialty panels render title and background settings and schedule one frame per invalidation batch",
  [
    "SpecialtyChart.getTitle",
    "SpecialtyChart.setTitleAlignment",
    "SpecialtyChart.setTitleFont",
    "SpecialtyChart.setBackgroundFillStyle",
    "SpecialtyChart.getBackgroundFillStyle",
    "SpecialtyChart.addUIElement",
    "SpecialtyChart.addLegendBox",
    "SpecialtyChart.getSeries",
    "SpecialtyChart.off",
    "SpecialtyChart.layout",
    "SpecialtyChart.invalidate",
    "SpecialtyChart.captureFrame",
  ],
  async (t) => {
    const chart = new Gauge(options),
      drawing = recordingChartContext();
    const previousRAF = Object.getOwnPropertyDescriptor(
        globalThis,
        "requestAnimationFrame",
      ),
      previousCancel = Object.getOwnPropertyDescriptor(
        globalThis,
        "cancelAnimationFrame",
      ),
      previousDPR = Object.getOwnPropertyDescriptor(
        globalThis,
        "devicePixelRatio",
      );
    let scheduled: FrameRequestCallback | undefined,
      requests = 0;
    Object.assign(globalThis, {
      requestAnimationFrame: (callback: FrameRequestCallback) => {
        requests++;
        scheduled = callback;
        return 1;
      },
      cancelAnimationFrame: () => {},
      devicePixelRatio: 1,
    });
    t.after(() => {
      for (const [key, descriptor] of [
        ["requestAnimationFrame", previousRAF],
        ["cancelAnimationFrame", previousCancel],
        ["devicePixelRatio", previousDPR],
      ] as const) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    });
    try {
      chart
        .setTitle("Status")
        .setTitleAlignment("right")
        .setTitleFont(new FontSettings({ size: 21, family: "Header" }))
        .setBackgroundFillStyle(fill);
      assert.equal(chart.getTitle(), "Status");
      assert.equal(chart.getBackgroundFillStyle(), fill);
      assert.deepEqual(chart.getSeries(), []);
      const ui = chart
        .addUIElement(UIElementBuilders.TextBox)
        .setText("overlay");
      const legend = chart.addLegendBox();
      assert.equal(chart.ui.length, 2);
      chart.render(drawing.ctx);
      assert.ok(drawing.text().includes("overlay"));
      assert.ok(
        drawing
          .of("fillText")
          .some(
            (c) => c.args[0] === "Status" && c.font.includes("21px Header"),
          ),
      );
      assert.equal(drawing.of("fillRect")[0]!.fill, fill.getColor().toCSS());
      let changes = 0;
      const token = chart.on("custom", () => changes++);
      chart.events.emit("custom");
      chart.off(token);
      chart.events.emit("custom");
      assert.equal(changes, 1);
      assert.throws(() => chart.captureFrame(), /browser canvas/);
      const canvas = {
        width: 0,
        height: 0,
        remove() {},
        toDataURL: (type: string) => `data:${type};base64,AQID`,
      };
      Object.assign(chart, {
        canvas,
        container: { clientWidth: 300, clientHeight: 200 },
      });
      chart.layout();
      assert.deepEqual(
        [chart.width, chart.height, canvas.width, canvas.height],
        [300, 200, 300, 200],
      );
      const blob = chart.captureFrame("image/jpeg");
      assert.equal(blob.type, "image/jpeg");
      assert.deepEqual(
        [...new Uint8Array(await blob.arrayBuffer())],
        [1, 2, 3],
      );
      Object.assign(chart, { context: drawing.ctx });
      chart.invalidate();
      chart.invalidate();
      assert.equal(requests, 1);
      assert.ok(scheduled);
      scheduled!(0);
      chart.dispose();
      assert.equal(ui.isDisposed(), true);
      assert.equal(legend.isDisposed(), true);
    } finally {
      chart.dispose();
    }
  },
);

apiTest(
  "pie slice styles sorting labels and explosion controls change rendered geometry and preserve live handles",
  [
    "Pie.addSlices",
    "Pie.setSliceSorter",
    "Pie.setLabelPosition",
    "Pie.setLabelFormatter",
    "Pie.setLabelFont",
    "Pie.setLabelEffect",
    "Pie.setCenterLabel",
    "Pie.setRadiusFactor",
    "Pie.setSelectionOffset",
    "Pie.setSliceExplosionOffset",
    "Pie.setSliceExploded",
    "Pie.getCursorMode",
    "Pie.setCursor",
    "PieSlice.constructor",
    "PieSlice.getName",
    "PieSlice.setName",
    "PieSlice.getFillStyle",
    "PieSlice.setFillStyle",
    "PieSlice.setStrokeStyle",
    "PieSlice.setVisible",
    "PieSlice.applyExploded",
    "PieSlice.dispose",
  ],
  () => {
    const chart = new Pie(options);
    try {
      chart.addSlices([
        { name: "small", value: 1 },
        { name: "large", value: 3 },
      ]);
      const first = chart.getSlices()[0]!,
        second = chart.getSlices()[1]!;
      assert.ok(first instanceof PieSlice);
      first.setName("renamed").setFillStyle(fill).setStrokeStyle(stroke);
      assert.equal(first.getName(), "renamed");
      assert.equal(first.getFillStyle(), fill);
      chart
        .setSliceSorter((a, b) => b.getValue() - a.getValue())
        .setInnerRadius(30)
        .setRadiusFactor(0.3)
        .setLabelPosition("inside")
        .setLabelFormatter((slice) => "P:" + slice.getName())
        .setLabelFont(new FontSettings({ size: 15, family: "Pie" }))
        .setLabelEffect(true)
        .setCenterLabel((total) => "total:" + total);
      const drawing = recordingChartContext();
      chart.render(drawing.ctx);
      assert.ok(drawing.text().includes("P:large"));
      assert.ok(drawing.text().includes("total:4"));
      assert.equal(drawing.of("arc")[0]!.args[2], (400 - 36) * 0.3);
      assert.ok(drawing.of("strokeText").length >= 2);
      chart.setSelectionOffset(10).setSliceExplosionOffset(7);
      assert.equal(chart.getSliceExplosionOffset(), 7);
      chart.setSliceExploded(first, true);
      chart.setSliceExploded(second, true);
      assert.equal(first.getExploded(), false);
      assert.equal(second.getExploded(), true);
      second.applyExploded(false);
      assert.equal(second.getExploded(), false);
      first.setVisible(false);
      assert.equal(first.getVisible(), false);
      first.setVisible(true);
      chart
        .setCursorMode("show-pointed")
        .setCursor((cursor) => cursor.setResultTableVisible(false));
      assert.equal(chart.getCursorMode(), "show-pointed");
      assert.equal(chart.getCursor().getResultTableVisible(), false);
      assert.throws(() => chart.setRadiusFactor(0), RangeError);
      assert.throws(() => chart.setSelectionOffset(-1), RangeError);
      first.dispose();
      assert.equal(chart.getSlices().length, 1);
    } finally {
      chart.dispose();
    }
  },
);

apiTest(
  "gauge formatter font size and arc color reach the actual value and arc drawing commands",
  ["Gauge.setValueFormatter", "Gauge.setValueFontSize", "Gauge.setArcColor"],
  () => {
    const chart = new Gauge(options);
    try {
      chart
        .setValue(42)
        .setValueFormatter((value) => "reading:" + value)
        .setValueFontSize(31)
        .setArcColor(fill.getColor());
      const drawing = recordingChartContext();
      chart.render(drawing.ctx);
      assert.ok(
        drawing
          .of("fillText")
          .some((c) => c.args[0] === "reading:42" && c.font.startsWith("31px")),
      );
      assert.ok(
        drawing.of("stroke").some((c) => c.stroke === fill.getColor().toCSS()),
      );
      assert.throws(() => chart.setValueFontSize(0), RangeError);
    } finally {
      chart.dispose();
    }
  },
);

apiTest(
  "spider series style opacity visibility and removal keep copied ranges and retained source points consistent",
  [
    "Spider.getAxisRange",
    "Spider.getSeries",
    "Spider.setRadiusFactor",
    "Spider.setLabelEffect",
    "SpiderSeries.constructor",
    "SpiderSeries.getName",
    "SpiderSeries.getFillStyle",
    "SpiderSeries.setFillStyle",
    "SpiderSeries.setFillOpacity",
    "SpiderSeries.setStrokeStyle",
    "SpiderSeries.setVisible",
    "SpiderSeries.getVisible",
    "SpiderSeries.clear",
    "SpiderSeries.dispose",
    "SpiderSeries.isDisposed",
  ],
  () => {
    const chart = new Spider(options);
    try {
      chart
        .setAxisRange("A", { start: 0, end: 10 })
        .setRadiusFactor(0.4)
        .setLabelEffect(true);
      const range = chart.getAxisRange("A")!;
      range.end = 999;
      assert.deepEqual(chart.getAxisRange("A"), { start: 0, end: 10 });
      const series = chart
        .addSeries()
        .setName("sensor")
        .setData([
          { name: "A", value: 4 },
          { name: "B", value: 6 },
          { name: "C", value: 8 },
        ])
        .setFillStyle(fill)
        .setFillOpacity(0.4)
        .setStrokeStyle(stroke);
      assert.ok(series instanceof SpiderSeries);
      assert.equal(series.getName(), "sensor");
      assert.equal(series.getFillStyle(), fill);
      const drawing = recordingChartContext();
      chart.render(drawing.ctx);
      assert.ok(
        drawing
          .of("fill")
          .some((c) => c.alpha === 0.4 && c.fill === fill.getColor().toCSS()),
      );
      series.setVisible(false);
      assert.equal(series.getVisible(), false);
      const hidden = recordingChartContext();
      chart.render(hidden.ctx);
      assert.equal(hidden.of("fill").length, 0);
      series.setVisible(true).clear();
      assert.deepEqual(series.points, []);
      assert.throws(() => series.setFillOpacity(2), RangeError);
      series.dispose();
      assert.equal(series.isDisposed(), true);
      assert.deepEqual(chart.getSeries(), []);
    } finally {
      chart.dispose();
    }
  },
);

apiTest(
  "bar label title gradient corner and shadow settings alter real drawing and clear removes cached hit rectangles",
  [
    "BarChart.addData",
    "BarChart.clear",
    "BarChart.setValueAxisTitle",
    "BarChart.setCategoryAxisTitle",
    "BarChart.setCategoryLabelsAtBars",
    "BarChart.setBarLabelFormatter",
    "BarChart.setLabelPosition",
    "BarChart.setCornerRadius",
    "BarChart.setGradientFill",
    "BarChart.setBarEffect",
    "BarChart.setLabelEffect",
  ],
  () => {
    const chart = new BarChart(options);
    try {
      const input = [
        { category: "A", value: 2 },
        { category: "B", value: 4 },
      ];
      chart
        .addData(input)
        .setHorizontal(true)
        .setValueAxisTitle("volts")
        .setCategoryAxisTitle("channels")
        .setCategoryLabelsAtBars(true)
        .setBarLabelFormatter((row) => "B" + row.value)
        .setLabelPosition("inside")
        .setCornerRadius(5)
        .setGradientFill(true)
        .setBarEffect(true)
        .setLabelEffect(true);
      input[0]!.value = 99;
      const drawing = recordingChartContext();
      chart.render(drawing.ctx);
      assert.ok(drawing.text().includes("volts"));
      assert.ok(drawing.text().includes("channels"));
      assert.ok(drawing.text().includes("B2"));
      assert.ok(
        drawing
          .of("roundRect")
          .some(
            (c) => JSON.stringify(c.args[4]) === JSON.stringify([0, 5, 5, 0]),
          ),
      );
      assert.ok(drawing.of("gradient").length >= 2);
      assert.ok(drawing.of("fill").some((c) => c.shadowBlur > 0));
      assert.ok(drawing.of("strokeText").length >= 2);
      chart.clear();
      chart.render(drawing.ctx);
      assert.deepEqual(chart.getData(), []);
      assert.equal(chart.getBarScreenRect(0), undefined);
    } finally {
      chart.dispose();
    }
  },
);

apiTest(
  "treemap layout labels and navigation update rendered tiles while preserving the source hierarchy",
  [
    "TreeMapChart.drillUp",
    "TreeMapChart.resetView",
    "TreeMapChart.setValueLabelsVisible",
    "TreeMapChart.setLabelFont",
    "TreeMapChart.setLabelEffect",
    "TreeMapChart.setCornerRadius",
    "TreeMapChart.setTilePadding",
  ],
  () => {
    const data = [
        {
          name: "A",
          children: [
            { name: "A1", value: 2 },
            { name: "A2", value: 3 },
          ],
        },
        { name: "B", value: 5 },
      ],
      chart = new TreeMapChart(options).setData(data);
    try {
      chart
        .setValueLabelsVisible(false)
        .setLabelFont(new FontSettings({ size: 16, family: "Tiles" }))
        .setLabelEffect(true)
        .setCornerRadius(4)
        .setTilePadding(6);
      const drawing = recordingChartContext();
      chart.render(drawing.ctx);
      assert.ok(drawing.of("roundRect").some((c) => c.args[4] === 4));
      assert.ok(
        drawing.of("fillText").some((c) => c.font.includes("16px Tiles")),
      );
      assert.ok(!drawing.text().includes("5"));
      chart.drillDown("A");
      assert.deepEqual(chart.getPath(), ["A"]);
      chart.drillUp();
      assert.deepEqual(chart.getPath(), []);
      chart.drillDown("A").resetView();
      assert.deepEqual(chart.getPath(), []);
      assert.deepEqual(chart.getData(), data);
    } finally {
      chart.dispose();
    }
  },
);

apiTest(
  "parallel axis hover mode thresholds row identity and retention preserve numeric geometry and selection",
  [
    "ParallelCoordinateChart.getMaxSampleCount",
    "ParallelCoordinateChart.getThresholds",
    "ParallelCoordinateChart.setAxisLabelAngle",
    "ParallelCoordinateChart.setHoverMode",
    "ParallelCoordinateChart.setRowId",
    "ParallelCoordinateChart.setStrokeThickness",
  ],
  () => {
    const chart = new ParallelCoordinateChart(options).setData(
      [
        { key: "one", x: 0, y: 1 },
        { key: "two", x: 1, y: 2 },
      ],
      ["x", "y"],
    );
    try {
      assert.equal(chart.getMaxSampleCount(), undefined);
      chart.setRowId("key").setSelectedRow("two");
      assert.equal(chart.getSelectedRow()!.key, "two");
      chart.setThresholds("x", [{ start: 0, end: 0.5, color: "#ff0000" }]);
      const thresholds = chart.getThresholds("x");
      thresholds[0]!.end = 100;
      assert.equal(chart.getThresholds("x")[0]!.end, 0.5);
      chart.setAxisLabelAngle(30).setStrokeThickness(3).setHoverMode("axis");
      const drawing = recordingChartContext();
      chart.render(drawing.ctx);
      assert.ok(
        drawing
          .of("rotate")
          .some((c) => Math.abs(c.args[0] - Math.PI / 6) < 1e-12),
      );
      assert.ok(drawing.of("stroke").some((c) => c.lineWidth === 3));
      const p = chart.getAxisScreenPosition("x", 0)!;
      assert.equal(chart.activateAt(p).axis, "x");
      chart.setHoverMode("row");
      chart.render(drawing.ctx);
      assert.equal(chart.activateAt(p).key, "one");
      chart.setMaxSampleCount(1);
      assert.equal(chart.getMaxSampleCount(), 1);
      assert.equal(chart.getSampleCount(), 1);
      assert.equal(chart.getData()[0]!.key, "two");
      assert.throws(() => chart.setStrokeThickness(0), RangeError);
    } finally {
      chart.dispose();
    }
  },
);

apiTest(
  "grid column renderers row height cell styles and scrolling affect visible cell geometry and text",
  [
    "DataGrid.setColumnTitle",
    "DataGrid.setColumnRenderer",
    "DataGrid.setCellStyle",
    "DataGrid.getCellStyle",
    "DataGrid.setRowHeight",
    "DataGrid.getCellScreenRect",
    "DataGrid.scrollTo",
  ],
  () => {
    const chart = new DataGrid({ ...options, height: 180 }).setData(
      Array.from({ length: 10 }, (_, id) => ({ id, v: id * 2 })),
      ["id", "v"],
    );
    try {
      chart
        .setColumnTitle("v", "Voltage")
        .setRowHeight(24)
        .setCellStyle((value) => ({ color: value > 0 ? "red" : "blue" }))
        .setColumnRenderer("v", (ctx, rect, value) =>
          ctx.fillText("cell:" + value, rect.left + 2, rect.top + 2),
        );
      const style = chart.getCellStyle(0, "v")!;
      style.color = "changed";
      assert.equal(chart.getCellStyle(0, "v")!.color, "blue");
      const drawing = recordingChartContext();
      chart.render(drawing.ctx);
      assert.ok(drawing.text().includes("Voltage"));
      assert.ok(
        drawing
          .of("fillText")
          .some((c) => c.args[0] === "cell:0" && c.fill === "blue"),
      );
      assert.equal(chart.getCellScreenRect(0, "v")!.height, 24);
      chart.scrollTo(999);
      assert.equal(chart.getCellScreenRect(0, "v"), undefined);
      assert.ok(chart.getCellScreenRect(9, "v"));
      chart.scrollTo(0);
      assert.ok(chart.getCellScreenRect(0, "v"));
      assert.throws(() => chart.setRowHeight(10), RangeError);
      assert.throws(() => chart.scrollTo(NaN), RangeError);
      chart.setColumnRenderer("v", undefined).setCellStyle(undefined);
      assert.equal(chart.getCellStyle(0, "v"), undefined);
    } finally {
      chart.dispose();
    }
  },
);
