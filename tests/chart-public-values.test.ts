import test from "node:test";
import assert from "node:assert/strict";
import { ChartXY, Chart3D, SurfaceGridSeries } from "../src/chart.js";
import { Dashboard } from "../src/index.js";
import { Gauge } from "../src/specialty.js";
import { SolidFill, ColorRGBA, FontSettings } from "../src/core/styles.js";
import { chartDocument } from "./helpers/chart-document.js";
import { apiTest } from "./helpers/api-test.js";

apiTest(
  "public chart surfaces own their DOM layers backing dimensions engine aliases and visual lifecycle",
  ["value:ChartXY.engine.canvas", "value:ChartXY.engine.container"],
  (t) => {
    const { host } = chartDocument(t),
      chart = new ChartXY({ container: host, renderer: "canvas2d" });
    try {
      assert.equal(chart.root!.parentElement, host);
      assert.equal(chart.canvas!.parentElement, chart.root);
      assert.equal(chart.underlay!.parentElement, chart.root);
      assert.equal(chart.overlay!.parentElement, chart.root);
      assert.deepEqual(
        [...chart.root!.children],
        [chart.underlay, chart.canvas, chart.overlay],
      );
      assert.equal(chart.engine.canvas, chart.canvas);
      assert.equal(chart.engine.container, chart.root);
      assert.equal(chart.renderer!.backend, "canvas2d");
      chart.resize(320, 180);
      assert.equal(chart.width, 320);
      assert.equal(chart.dpr, 2);
      for (const canvas of [chart.canvas, chart.overlay, chart.underlay])
        assert.deepEqual([canvas!.width, canvas!.height], [640, 360]);
      const fill = new SolidFill({ color: ColorRGBA(12, 34, 56) }),
        plot = new SolidFill({ color: ColorRGBA(70, 80, 90) }),
        font = new FontSettings({ size: 22 });
      chart
        .setTitle("Owned layers")
        .setTitleFont(font)
        .setTitleFillStyle(fill)
        .setBackgroundFillStyle(fill)
        .setSeriesBackgroundFillStyle(plot)
        .setPadding({ left: 11, right: 12, top: 13, bottom: 14 })
        .setAnimationsEnabled(true);
      assert.equal(chart.title, "Owned layers");
      assert.equal(chart.titleFont, font);
      assert.equal(chart.titleFill, fill);
      assert.equal(chart.background, fill);
      assert.equal(chart.plotBackground, plot);
      assert.deepEqual(chart.padding, {
        left: 11,
        right: 12,
        top: 13,
        bottom: 14,
      });
      assert.equal(chart.animationsEnabled, true);
      chart.renderNow();
      const drawing = (chart.underlay as any).drawing;
      assert.ok(
        drawing
          .of("fillText")
          .some(
            (c: any) =>
              c.args[0] === "Owned layers" &&
              c.fill === fill.getColor().toCSS() &&
              c.font.includes("22px"),
          ),
      );
      assert.equal(chart.root!.style.background, fill.getColor().toCSS());
      assert.ok(
        drawing
          .of("fillRect")
          .some((c: any) => c.fill === plot.getColor().toCSS()),
      );
      chart.setVisible(false);
      assert.equal(chart.visible, false);
      assert.equal(chart.root!.hidden, true);
      assert.equal(chart.disposed, false);
      chart.dispose();
      assert.equal(chart.disposed, true);
      assert.equal(host.children.length, 0);
    } finally {
      chart.dispose();
    }
  },
);

test("public specialty container and dashboard disposal state follow actual host ownership and remove their children", (t) => {
  const { host } = chartDocument(t),
    gauge = new Gauge({ container: host }),
    dashboard = new Dashboard({ container: host });
  try {
    assert.equal(gauge.container, host);
    assert.equal(gauge.canvas!.parentElement, host);
    assert.equal(dashboard.disposed, false);
    dashboard.createGauge({ headless: true });
    assert.equal(dashboard.getChartCount(), 1);
    dashboard.dispose();
    assert.equal(dashboard.disposed, true);
    assert.equal(dashboard.getChartCount(), 0);
    assert.throws(() => dashboard.createGauge({ headless: true }), /disposed/);
    gauge.dispose();
    assert.equal(host.children.length, 0);
  } finally {
    gauge.dispose();
    dashboard.dispose();
  }
});

test("public legacy surface fields describe owned grid heights extents identity axes revisions and disposal", () => {
  const chart = new ChartXY(),
    three = new Chart3D();
  try {
    assert.equal(chart.axesZ.length, 0);
    assert.equal(three.axesZ[0], three.axisZ);
    const grid: SurfaceGridSeries = chart.addSurfaceGridSeries({
        columns: 2,
        rows: 2,
      }),
      other: SurfaceGridSeries = chart.addSurfaceGridSeries({
        columns: 2,
        rows: 2,
      });
    grid.setName("surface").setStart({ x: 2, z: 4 }).setStep({ x: 3, z: 5 });
    const revision = grid.revision;
    grid.invalidateHeightMap([
      [1, 2],
      [3, NaN],
    ]);
    assert.equal(grid.chart, chart);
    assert.equal(grid.axisX, chart.axisX);
    assert.equal(grid.axisY, chart.axisY);
    assert.equal(grid.axisZ, undefined);
    assert.equal(grid.kind, "surface");
    assert.notEqual(grid.id, other.id);
    assert.equal(grid.columns, 2);
    assert.equal(grid.rows, 2);
    assert.equal(grid.name, "surface");
    assert.deepEqual(grid.start, { x: 2, z: 4 });
    assert.deepEqual(grid.step, { x: 3, z: 5 });
    assert.equal(grid.values.length, grid.columns * grid.rows);
    assert.deepEqual([...grid.values].slice(0, 3), [1, 2, 3]);
    assert.ok(Number.isNaN(grid.values[3]));
    assert.equal(grid.revision, revision + 1);
    assert.deepEqual(grid.bounds("y"), { start: 1, end: 3 });
    grid.setVisible(false);
    assert.equal(grid.visible, false);
    assert.equal(grid.disposed, false);
    grid.dispose();
    assert.equal(grid.disposed, true);
    assert.equal(chart.getSeries().includes(grid), false);
  } finally {
    chart.dispose();
    three.dispose();
  }
});
