import test from "node:test";
import assert from "node:assert/strict";
import {
  Gauge,
  Pie,
  Spider,
  BarChart,
  TreeMapChart,
  ParallelCoordinateChart,
  DataGrid,
} from "../src/specialty.js";
import {
  SunBurstChart,
  Funnel,
  Pyramid,
  PyramidSliceModes,
} from "../src/hierarchy.js";
import {
  FontSettings,
  SolidFill,
  SolidLine,
  ColorRGBA,
  Themes,
} from "../src/core/styles.js";
import { recordingChartContext } from "./helpers/recording-chart-context.js";

const opts = { headless: true, width: 640, height: 400 };
const fill = new SolidFill({ color: ColorRGBA(230, 30, 40) }),
  stroke = new SolidLine({ fillStyle: fill, thickness: 3 });

test("public specialty panel and gauge fields reflect applied theme title layout interval units visibility and disposal", () => {
  const gauge = new Gauge({ ...opts, theme: Themes.dark });
  try {
    const font = new FontSettings({ size: 20, family: "PublicTitle" }),
      interval = { start: 0, end: 20 };
    gauge
      .setTitle("Temperature")
      .setTitleFont(font)
      .setTitleAlignment("right")
      .setBackgroundFillStyle(fill)
      .setInterval(interval)
      .setValue(12)
      .setUnitLabel("C");
    interval.end = 999;
    assert.equal(gauge.theme, Themes.dark);
    assert.equal(gauge.title, "Temperature");
    assert.equal(gauge.titleFont, font);
    assert.equal(gauge.titleAlignment, "right");
    assert.equal(gauge.background, fill);
    assert.equal(gauge.padding, 18);
    assert.deepEqual(gauge.interval, { start: 0, end: 20 });
    assert.equal(gauge.value, 12);
    assert.equal(gauge.unit, "C");
    const drawing = recordingChartContext();
    gauge.render(drawing.ctx);
    assert.equal(drawing.of("fillRect")[0].fill, fill.getColor().toCSS());
    assert.ok(
      drawing
        .of("fillText")
        .some(
          (c) =>
            c.args[0] === "Temperature" &&
            c.font.includes("20px PublicTitle") &&
            c.args[1] === gauge.width - gauge.padding,
        ),
    );
    assert.ok(drawing.text().includes("12 C"));
    gauge.setVisible(false);
    assert.equal(gauge.visible, false);
    const count = drawing.calls.length;
    gauge.render(drawing.ctx);
    assert.equal(drawing.calls.length, count);
    assert.equal(gauge.disposed, false);
    gauge.dispose();
    assert.equal(gauge.disposed, true);
  } finally {
    gauge.dispose();
  }
});

test("public pie and spider series fields retain individual materials ownership values and visibility used by rendering", () => {
  const pie = new Pie(opts),
    spider = new Spider(opts);
  try {
    const slice = pie
      .addSlice("before", 2)
      .setName("slice")
      .setValue(5)
      .setFillStyle(fill)
      .setStrokeStyle(stroke);
    assert.equal(slice.chart, pie);
    assert.equal(slice.name, "slice");
    assert.equal(slice.value, 5);
    assert.equal(slice.fillStyle, fill);
    assert.equal(slice.strokeStyle, stroke);
    assert.equal(slice.visible, true);
    const drawing = recordingChartContext();
    pie.render(drawing.ctx);
    assert.ok(
      drawing.of("fill").some((c) => c.fill === fill.getColor().toCSS()),
    );
    slice.setVisible(false);
    assert.equal(slice.visible, false);
    assert.equal(slice.disposed, false);
    slice.dispose();
    assert.equal(slice.disposed, true);
    assert.equal(pie.getSlices().length, 0);
    const series = spider
      .addSeries()
      .setName("spider")
      .setFillStyle(fill)
      .setStrokeStyle(stroke)
      .setFillOpacity(0.4)
      .addPoints([
        { name: "a", value: 1 },
        { name: "b", value: 2 },
        { name: "c", value: 3 },
      ]);
    assert.equal(spider.series[0], series);
    assert.equal(series.chart, spider);
    assert.equal(series.name, "spider");
    assert.equal(series.fillStyle, fill);
    assert.equal(series.strokeStyle, stroke);
    assert.equal(series.fillOpacity, 0.4);
    const radar = recordingChartContext();
    spider.render(radar.ctx);
    assert.ok(
      radar
        .of("fill")
        .some((c) => c.alpha === 0.4 && c.fill === fill.getColor().toCSS()),
    );
    series.setVisible(false);
    assert.equal(series.visible, false);
    assert.equal(series.disposed, false);
    series.dispose();
    assert.equal(series.disposed, true);
    assert.equal(spider.getSeries().includes(series), false);
  } finally {
    pie.dispose();
    spider.dispose();
  }
});

test("public categorical and parallel data fields retain owned numeric rows while grid sort fields drive row order", () => {
  const bar = new BarChart(opts),
    tree = new TreeMapChart(opts),
    parallel = new ParallelCoordinateChart(opts),
    grid = new DataGrid(opts);
  try {
    const input = [
      { category: "A", value: 2 },
      { category: "B", value: 5 },
    ];
    bar.setData(input).setHorizontal(true);
    input[0].value = 99;
    assert.equal(bar.horizontal, true);
    assert.equal(bar.data[0].value, 2);
    const drawing = recordingChartContext();
    bar.render(drawing.ctx);
    const box = bar.getBarScreenRect(1)!;
    assert.ok(box.width > box.height);
    const nodes = [{ name: "leaf", value: 3 }];
    tree.setData(nodes);
    nodes[0].value = 99;
    assert.equal(tree.data[0].value, 3);
    tree.render(recordingChartContext().ctx);
    assert.equal(tree.getData()[0].value, 3);
    const rows = [
      { x: 1, y: 2 },
      { x: 3, y: 4 },
    ];
    parallel.setData(rows, ["x", "y"]);
    rows[0].x = 99;
    assert.equal(parallel.data[0].x, 1);
    assert.equal(parallel.getSampleCount(), 2);
    grid
      .setData(
        [
          { id: 1, v: 2 },
          { id: 2, v: 5 },
        ],
        ["id", "v"],
      )
      .setRowHeight(24)
      .sortBy("v", false);
    assert.deepEqual(grid.columns, ["id", "v"]);
    assert.equal(grid.rowHeight, 24);
    assert.equal(grid.sortKey, "v");
    assert.equal(grid.ascending, false);
    assert.deepEqual(
      grid.getData().map((r) => r.id),
      [2, 1],
    );
    assert.equal(grid.getCellScreenRect(2, "v")!.height, 24);
  } finally {
    bar.dispose();
    tree.dispose();
    parallel.dispose();
    grid.dispose();
  }
});

test("public hierarchy labels slice materials generation and pyramid mode constants control live rendered handles", () => {
  const sun = new SunBurstChart(opts),
    funnel = new Funnel(opts),
    pyramid = new Pyramid(opts);
  try {
    const font = new FontSettings({ size: 16, family: "PublicLabel" });
    sun
      .setData([{ name: "leaf", value: 3 }])
      .setLabelFont(font)
      .setLabelFillStyle(fill);
    assert.equal(sun.labelFont, font);
    assert.equal(sun.labelFill, fill);
    const drawing = recordingChartContext();
    sun.render(drawing.ctx);
    assert.ok(
      drawing
        .of("fillText")
        .some(
          (c) =>
            c.args[0] === "leaf" &&
            c.font.includes("16px PublicLabel") &&
            c.fill === fill.getColor().toCSS(),
        ),
    );
    const generation = funnel.dataGeneration;
    funnel.setData([{ name: "stage", value: 4 }]);
    assert.equal(funnel.dataGeneration, generation + 1);
    const slice = funnel
      .getSlices()[0]
      .setName("renamed")
      .setFillStyle(fill)
      .setStrokeStyle(stroke);
    assert.equal(slice.chart, funnel);
    assert.equal(slice.node.name, "renamed");
    assert.equal(slice.fillStyle, fill);
    assert.equal(slice.strokeStyle, stroke);
    assert.equal(slice.visible, true);
    const stages = recordingChartContext();
    funnel.render(stages.ctx);
    assert.ok(
      stages.of("fill").some((c) => c.fill === fill.getColor().toCSS()),
    );
    slice.setVisible(false);
    assert.equal(slice.visible, false);
    assert.equal(slice.disposed, false);
    slice.dispose();
    assert.equal(slice.disposed, true);
    const old = funnel.addSlice("old", 3);
    funnel.setData([{ name: "new", value: 1 }]);
    assert.equal(old.isDisposed(), true);
    assert.equal(funnel.dataGeneration, generation + 2);
    assert.equal(
      PyramidSliceModes[PyramidSliceModes.VariableHeight],
      "VariableHeight",
    );
    pyramid
      .setData([
        { name: "a", value: 2 },
        { name: "b", value: 8 },
      ])
      .setSliceMode(PyramidSliceModes.VariableWidth);
    assert.equal(
      pyramid.getPyramidSliceMode(),
      PyramidSliceModes.VariableWidth,
    );
    pyramid.render(recordingChartContext().ctx);
    assert.equal(pyramid.getSlices().length, 2);
  } finally {
    sun.dispose();
    funnel.dispose();
    pyramid.dispose();
  }
});
