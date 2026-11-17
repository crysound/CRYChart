import assert from "node:assert/strict";
import {
  SunBurstChart,
  Funnel,
  Pyramid,
  StageSlice,
} from "../src/hierarchy.js";
import {
  ColorRGBA,
  SolidFill,
  SolidLine,
  FontSettings,
  LUT,
} from "../src/core/styles.js";
import { apiTest } from "./helpers/api-test.js";
import { recordingChartContext } from "./helpers/recording-chart-context.js";

const options = { headless: true, width: 640, height: 400 };
const nodes = [
  {
    name: "A",
    children: [
      { name: "A1", value: 2 },
      { name: "A2", value: 3 },
    ],
  },
  { name: "B", value: 5 },
];
const red = new SolidFill({ color: ColorRGBA(220, 20, 30) }),
  blue = new SolidFill({ color: ColorRGBA(20, 30, 220) }),
  stroke = new SolidLine({ fillStyle: blue, thickness: 2 });

apiTest(
  "sunburst depth angles radius fonts and label callbacks alter rendered arcs while navigation preserves source data",
  [
    "SunBurstChart.getFocus",
    "SunBurstChart.drillUp",
    "SunBurstChart.resetView",
    "SunBurstChart.setMaxDepth",
    "SunBurstChart.setInnerRadius",
    "SunBurstChart.setRadiusFactor",
    "SunBurstChart.setStartAngle",
    "SunBurstChart.setLabelFont",
    "SunBurstChart.setLabelFillStyle",
    "SunBurstChart.setLabelFormatter",
    "SunBurstChart.setValueFormatter",
    "SunBurstChart.labelFormatter",
  ],
  () => {
    const chart = new SunBurstChart(options).setData(nodes);
    try {
      assert.equal(chart.labelFormatter({ name: "default" }, 1), "default");
      chart
        .setMaxDepth(1)
        .setInnerRadius(0.4)
        .setRadiusFactor(0.4)
        .setStartAngle(0)
        .setLabelFont(new FontSettings({ size: 13, family: "Labels" }))
        .setLabelFillStyle(red)
        .setLabelFormatter((node) => "N:" + node.name)
        .setValueFormatter((value) => "V" + value);
      const a = recordingChartContext();
      chart.render(a.ctx);
      const arcs = a.of("arc");
      assert.equal(arcs.length, 4);
      assert.equal(arcs[0]!.args[3], 0);
      assert.ok(
        Math.abs(arcs[1]!.args[2] / (arcs[0]!.args[2] + 1) - 0.4) < 1e-12,
      );
      assert.ok(a.text().some((text) => text.startsWith("N:")));
      assert.ok(
        a
          .of("fillText")
          .some(
            (call) =>
              call.font.includes("13px Labels") &&
              call.fill === red.getColor().toCSS(),
          ),
      );
      chart.setRadiusFactor(0.2);
      const b = recordingChartContext();
      chart.render(b.ctx);
      assert.ok(
        Math.abs((b.of("arc")[0]!.args[2] + 1) / (arcs[0]!.args[2] + 1) - 0.5) <
          1e-12,
      );
      for (const depth of [0, 33, 1.5])
        assert.throws(() => chart.setMaxDepth(depth), RangeError);
      assert.throws(() => chart.setRadiusFactor(1), RangeError);
      assert.throws(() => chart.setInnerRadius(NaN), RangeError);
      assert.throws(() => chart.setStartAngle(Infinity), RangeError);
      chart.drillDown("A");
      assert.equal(chart.getFocus()!.name, "A");
      chart.drillUp();
      assert.equal(chart.getFocus(), undefined);
      chart.drillDown("A").resetView();
      assert.deepEqual(chart.getPath(), []);
      assert.deepEqual(chart.getData(), nodes);
      assert.equal(chart.valueFormatter(5), "V5");
    } finally {
      chart.dispose();
    }
  },
);

class HoverFunnel extends Funnel {
  hover(slice: StageSlice) {
    this.hovered = { data: slice, label: "hover", contains: () => true };
  }
}

apiTest(
  "hierarchy stage styles sorting palette and effects reach their rendered labels and polygons",
  [
    "SlicedHierarchyChart.addSlices",
    "SlicedHierarchyChart.addData",
    "SlicedHierarchyChart.getData",
    "SlicedHierarchyChart.getSeries",
    "SlicedHierarchyChart.setSliceGap",
    "SlicedHierarchyChart.setLUT",
    "SlicedHierarchyChart.setSliceFillStyle",
    "SlicedHierarchyChart.getSliceFillStyle",
    "SlicedHierarchyChart.setSliceStrokeStyle",
    "SlicedHierarchyChart.getSliceStrokeStyle",
    "SlicedHierarchyChart.setSliceSorter",
    "SlicedHierarchyChart.getSliceSorter",
    "SlicedHierarchyChart.setLabelFillStyle",
    "SlicedHierarchyChart.getLabelFillStyle",
    "SlicedHierarchyChart.setLabelFont",
    "SlicedHierarchyChart.getLabelFont",
    "SlicedHierarchyChart.setLabelFormatter",
    "SlicedHierarchyChart.getLabelFormatter",
    "SlicedHierarchyChart.setSliceHighlightOnHover",
    "SlicedHierarchyChart.setSliceEffect",
    "SlicedHierarchyChart.getSliceEffect",
    "SlicedHierarchyChart.setLabelEffect",
    "SlicedHierarchyChart.getLabelEffect",
  ],
  () => {
    const chart = new HoverFunnel(options);
    try {
      const slices = chart.addSlices([
        { name: "small", value: 1 },
        { name: "large", value: 3 },
      ]);
      chart.addData([{ name: "zero", value: 0 }]);
      assert.equal(chart.getSeries().length, 3);
      const data = chart.getData();
      data[0]!.name = "changed";
      assert.equal(chart.getData()[0]!.name, "small");
      const lut = new LUT({
        steps: [
          { value: 1, color: red.getColor() },
          { value: 3, color: blue.getColor() },
        ],
      });
      chart.setLUT(lut);
      const initial = recordingChartContext();
      chart.render(initial.ctx);
      assert.deepEqual(
        initial.of("fill").map((c) => c.fill),
        [red.getColor().toCSS(), blue.getColor().toCSS()],
      );
      const sorter = (a: StageSlice, b: StageSlice) =>
          b.getValue() - a.getValue(),
        style = () => red,
        formatter = (slice: StageSlice) => "stage:" + slice.getName();
      chart
        .setSliceSorter(sorter)
        .setSliceFillStyle(style)
        .setSliceStrokeStyle(stroke)
        .setSliceGap(6)
        .setLabelFont(new FontSettings({ size: 16, family: "Stage" }))
        .setLabelFillStyle(blue)
        .setLabelFormatter(formatter)
        .setSliceEffect(true)
        .setLabelEffect(true);
      assert.equal(chart.getSliceSorter(), sorter);
      assert.equal(chart.getSliceFillStyle(), style);
      assert.equal(chart.getSliceStrokeStyle(), stroke);
      assert.equal(chart.getLabelFormatter(), formatter);
      assert.equal(chart.getLabelFont().size, 16);
      assert.equal(chart.getLabelFillStyle(), blue);
      assert.equal(chart.getSliceEffect(), true);
      assert.equal(chart.getLabelEffect(), true);
      chart.hover(slices[1]!);
      chart.setSliceHighlightOnHover(false);
      const unhighlighted = recordingChartContext();
      chart.render(unhighlighted.ctx);
      assert.ok(unhighlighted.of("fill").every((c) => c.alpha === 0.94));
      chart.hover(slices[1]!);
      chart.setSliceHighlightOnHover(true);
      const highlighted = recordingChartContext();
      chart.render(highlighted.ctx);
      assert.equal(highlighted.of("fill")[0]!.alpha, 1);
      assert.equal(highlighted.text()[0], "stage:large");
      assert.ok(
        highlighted
          .of("fillText")
          .some((c) => c.shadowBlur === 3 && c.font.includes("16px Stage")),
      );
    } finally {
      chart.dispose();
    }
  },
);

apiTest(
  "stage handles preserve per-slice overrides reject stale mutation and reset focused views",
  [
    "StageSlice.constructor",
    "StageSlice.getName",
    "StageSlice.setName",
    "StageSlice.getFillStyle",
    "StageSlice.getStrokeStyle",
    "StageSlice.setStrokeStyle",
    "StageSlice.getVisible",
    "StageSlice.dispose",
    "SlicedHierarchyChart.getFocus",
    "SlicedHierarchyChart.resetView",
    "Pyramid.getPyramidSliceMode",
  ],
  () => {
    const chart = new Funnel(options).setData(nodes),
      pyramid = new Pyramid(options);
    try {
      const slice = chart.getSlices()[1]!;
      assert.ok(slice instanceof StageSlice);
      slice.setName("renamed").setFillStyle(red).setStrokeStyle(stroke);
      assert.equal(slice.getName(), "renamed");
      assert.equal(slice.getFillStyle(), red);
      assert.equal(slice.getStrokeStyle(), stroke);
      assert.equal(slice.getVisible(), true);
      slice.setVisible(false);
      assert.equal(slice.getVisible(), false);
      slice.setVisible(true).dispose();
      assert.equal(slice.isDisposed(), true);
      assert.throws(() => slice.setName("stale"), /removed|replaced/);
      assert.equal(chart.getSeries().length, 1);
      chart.drillDown("A");
      assert.equal(chart.getFocus()!.name, "A");
      chart.resetView();
      assert.equal(chart.getFocus(), undefined);
      assert.deepEqual(chart.getPath(), []);
      pyramid.setSliceMode("VariableWidth");
      assert.equal(pyramid.getPyramidSliceMode(), 1);
    } finally {
      chart.dispose();
      pyramid.dispose();
    }
  },
);
