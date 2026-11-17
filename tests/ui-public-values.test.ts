import test from "node:test";
import assert from "node:assert/strict";
import { ChartXY } from "../src/chart.js";
import {
  FontSettings,
  ColorRGBA,
  SolidFill,
  SolidLine,
  UIElementBuilders,
  UIOrigins,
} from "../src/core/styles.js";
import { recordingChartContext } from "./helpers/recording-chart-context.js";

test("public UI fields describe rendered text background placement rotation and live pointer state", () => {
  const chart = new ChartXY();
  try {
    const fill = new SolidFill({ color: ColorRGBA(200, 30, 40) }),
      stroke = new SolidLine({ fillStyle: fill, thickness: 3 }),
      font = new FontSettings({ size: 18, family: "FieldFont" }),
      ui = chart
        .addUIElement(UIElementBuilders.CheckBox)
        .setText("accept")
        .setPosition({ x: 50, y: 50 })
        .setOrigin(UIOrigins.Center)
        .setTextFont(font)
        .setTextFillStyle(fill)
        .setMargin(4)
        .setRotation(30)
        .setEffect(true);
    ui.setBackground((b) => b.setFillStyle(fill).setStrokeStyle(stroke));
    assert.equal(ui.owner, chart);
    assert.equal(ui.kind, "CheckBox");
    assert.equal(ui.font, font);
    assert.equal(ui.fill, fill);
    assert.equal(ui.background.fill, fill);
    assert.equal(ui.background.stroke, stroke);
    assert.equal(ui.margin, 4);
    assert.deepEqual(ui.origin, UIOrigins.Center);
    assert.equal(ui.rotation, 30);
    assert.equal(ui.effect, true);
    const drawing = recordingChartContext();
    ui.draw(drawing.ctx, { left: 0, top: 0, width: 200, height: 100 });
    assert.ok(
      drawing
        .of("fillText")
        .some(
          (c) =>
            c.args[0] === "accept" &&
            c.fill === fill.getColor().toCSS() &&
            c.font.includes("18px FieldFont"),
        ),
    );
    assert.ok(drawing.of("strokeRect").some((c) => c.lineWidth === 3));
    assert.ok(drawing.of("rotate").some((c) => c.args[0] === Math.PI / 6));
    assert.equal(ui.bounds.left, 100 - ui.bounds.width / 2 + ui.margin);
    const point = { x: ui.bounds.left + 1, y: ui.bounds.top + 1 };
    assert.equal(ui.pointerEvents, true);
    ui.handlePointer("click", point);
    assert.equal(ui.checked, true);
    ui.setPointerEvents(false);
    assert.equal(ui.pointerEvents, false);
    assert.equal(ui.handlePointer("click", point), false);
    assert.equal(ui.checked, true);
    ui.setVisible(false);
    assert.equal(ui.visible, false);
    const count = drawing.calls.length;
    ui.draw(drawing.ctx, { left: 0, top: 0, width: 200, height: 100 });
    assert.equal(drawing.calls.length, count);
  } finally {
    chart.dispose();
  }
});

test("public cursor grid and marker fields agree with drawing policies and legend row height controls total layout", () => {
  const chart = new ChartXY();
  try {
    const cursor = chart.getCursor(),
      x = new SolidLine({ thickness: 2 }),
      y = new SolidLine({ thickness: 4 });
    cursor
      .setGridStrokeXStyle(x)
      .setGridStrokeYStyle(y)
      .setTickMarkerXVisible(false)
      .setTickMarkerYVisible(false)
      .setPointMarkerVisible(false);
    assert.equal(cursor.gridX, x);
    assert.equal(cursor.gridY, y);
    assert.equal(cursor.tickX, false);
    assert.equal(cursor.tickY, false);
    assert.equal(cursor.pointMarker, false);
    cursor.setPosition({ x: 1, y: 2 });
    assert.equal(cursor.getPositions().length, 1);
    cursor
      .setTickMarkerXVisible(true)
      .setTickMarkerYVisible(true)
      .setPointMarkerVisible(true);
    assert.equal(cursor.tickX, true);
    assert.equal(cursor.tickY, true);
    assert.equal(cursor.pointMarker, true);
    const series = chart.addLineSeries().setName("curve"),
      legend = chart.addLegendBox().setTitle("Signals").add(series);
    legend.rowHeight = 30;
    assert.equal(legend.title, "Signals");
    assert.equal(legend.rowHeight, 30);
    const drawing = recordingChartContext();
    legend.draw(drawing.ctx, { left: 0, top: 0, width: 640, height: 400 });
    assert.equal(legend.bounds.height, 60 + 2 * legend.padding);
    assert.ok(drawing.text().includes("Signals"));
    assert.ok(drawing.text().includes("curve"));
  } finally {
    chart.dispose();
  }
});
