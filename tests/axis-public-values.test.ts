import test from "node:test";
import assert from "node:assert/strict";
import { ChartXY, Polar } from "../src/chart.js";
import {
  NumericTickStrategy,
  DateTimeTickStrategy,
  TimeTickStrategy,
  TickStyle,
} from "../src/axis.js";
import {
  FontSettings,
  SolidFill,
  SolidLine,
  ColorRGBA,
} from "../src/core/styles.js";

test("public axis fields reflect applied range policies layout units and hover state without altering source samples", () => {
  const chart = new ChartXY(),
    axis = chart.addAxisY({ iStack: 2 });
  try {
    chart.addLineSeries({ axisY: axis }).addArraysXY([1, 2], [4, 8]);
    const defaults = { start: -10, end: 10 },
      restriction = { intervalMax: 6 },
      font = new FontSettings({ size: 19 }),
      fill = new SolidFill({ color: ColorRGBA(20, 30, 40) }),
      interaction = { zoom: false };
    axis
      .setDefaultInterval(defaults)
      .setIntervalRestrictions(restriction)
      .setInterval(1, 9)
      .setInverted(true)
      .setTitle("Voltage")
      .setUnits("V")
      .setTitleFont(font)
      .setTitleFillStyle(fill)
      .setTitleRotation(30)
      .setUserInteractions(interaction);
    assert.equal(axis.chart, chart);
    assert.deepEqual(axis.defaultInterval, defaults);
    assert.equal(axis.intervalRestriction, restriction);
    assert.deepEqual(axis.interval, { start: 2, end: 8 });
    assert.equal(axis.inverted, true);
    assert.equal(axis.valueToFraction(2), 1);
    assert.equal(axis.iStack, 2);
    assert.equal(axis.title, "Voltage");
    assert.equal(axis.unit, "V");
    assert.equal(axis.getDisplayTitle(), "Voltage (V)");
    assert.equal(axis.titleFont, font);
    assert.equal(axis.titleFill, fill);
    assert.equal(axis.titleRotation, 30);
    assert.equal(axis.interaction, interaction);
    axis.setScrollStrategy(false);
    assert.equal(axis.scrollStrategy, false);
    axis.setAutoFit(true);
    assert.equal(axis.scrollStrategy, "fitting");
    assert.equal(axis.getAutoFit(), true);
    axis.setHighlight(0.4).setHighlightOnHover(true);
    axis.setPointerHover(true);
    assert.equal(axis.highlight, 0.4);
    assert.equal(axis.highlightOnHover, true);
    assert.equal(axis.getEffectiveHighlight(), 1);
    axis.setVisible(false);
    assert.equal(axis.visible, false);
    assert.equal(axis.getEffectiveHighlight(), 0);
    assert.equal(axis.disposed, false);
    axis.dispose();
    assert.equal(axis.disposed, true);
    assert.equal(axis.getEffectiveHighlight(), 0);
  } finally {
    chart.dispose();
  }
});

test("annotation public fields expose the owning axis range styles visibility and change callback lifecycle", () => {
  const chart = new ChartXY(),
    axis = chart.axisX;
  try {
    const line = axis.addConstantLine().setValue(3),
      band = axis.addBand().setBounds({ start: 2, end: 7 }),
      fill = new SolidFill({ color: ColorRGBA(10, 20, 30) }),
      stroke = new SolidLine({ fillStyle: fill, thickness: 3 });
    assert.equal(line.axis, axis);
    assert.equal(line.kind, "line");
    assert.equal(line.value, 3);
    assert.equal(band.kind, "band");
    assert.equal(band.start, 2);
    assert.equal(band.end, 7);
    assert.deepEqual(band.getBounds(), { start: 2, end: 7 });
    band
      .setFillStyle(fill)
      .setStrokeStyle(stroke)
      .setMouseInteractions(false)
      .setVisible(false);
    assert.equal(band.fill, fill);
    assert.equal(band.stroke, stroke);
    assert.equal(band.mouseInteractions, false);
    assert.equal(band.visible, false);
    assert.equal(band.getPointerEvents(), false);
    let changes = 0;
    const original = band.onChange;
    band.onChange = () => {
      changes++;
      original();
    };
    band.setStart(4);
    assert.equal(changes, 1);
    assert.equal(band.start, 4);
    assert.equal(typeof band.onChange, "function");
    band.dispose();
    assert.ok(changes > 1);
    assert.equal(axis.annotations.includes(band), false);
  } finally {
    chart.dispose();
  }
});

test("tick strategy public fields drive tick and cursor text while calendar and polar owners retain their domains", () => {
  const chart = new ChartXY(),
    polar = new Polar();
  try {
    const strategy = new NumericTickStrategy(),
      font = new FontSettings({ size: 17 }),
      fill = new SolidFill({ color: ColorRGBA(1, 2, 3) }),
      stroke = new SolidLine({ fillStyle: fill, thickness: 2 }),
      format = (value: number) => "n=" + value;
    strategy
      .setFormattingFunction(format)
      .setCursorFormatter((value) => "cursor=" + value)
      .setExtremeFormattingFunction((value) => "edge=" + value);
    assert.equal(strategy.kind, "numeric");
    assert.equal(strategy.formatting(2), "n=2");
    assert.equal(strategy.cursorFormatting!(3), "cursor=3");
    assert.equal(strategy.extremeFormatting(4), "edge=4");
    const style = new TickStyle()
      .setLabelFont(font)
      .setLabelFillStyle(fill)
      .setGridStrokeStyle(stroke)
      .setTickStyle(stroke)
      .setTickLength(9)
      .setLabelFormatter(format);
    assert.equal(style.font, font);
    assert.equal(style.fill, fill);
    assert.equal(style.grid, stroke);
    assert.equal(style.tick, stroke);
    assert.equal(style.length, 9);
    assert.equal(style.formatter!(5), "n=5");
    chart.axisX.setTickStrategy("Numeric", (s) => s.setMajorTickStyle(style));
    chart.axisX.setInterval(0, 10);
    assert.ok(chart.axisX.ticks().every((t) => t.label === "n=" + t.value));
    const datetime = new DateTimeTickStrategy().setGreatTickStyle(style);
    assert.equal(datetime.kind, "datetime");
    assert.equal(datetime.great, style);
    assert.equal(datetime.great.formatter!(6), "n=6");
    const time = new TimeTickStrategy();
    assert.equal(time.kind, "time");
    const angular = polar.getAngularAxis();
    assert.equal(angular.polarChart, polar);
    angular.setNorth(30);
    assert.equal(polar.getAngleOrigin(), 60);
  } finally {
    chart.dispose();
    polar.dispose();
  }
});
