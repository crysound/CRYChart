import assert from "node:assert/strict";
import { ChartXY } from "../src/chart.js";
import { Axis, NumericTickStrategy, TickStyle } from "../src/axis.js";
import {
  AxisScrollStrategies,
  FontSettings,
  ColorRGBA,
  SolidFill,
} from "../src/core/styles.js";
import { apiTest } from "./helpers/api-test.js";

apiTest(
  "range setters preserve omitted endpoints and return owned snapshots",
  ["Axis.setInterval", "Axis.getInterval"],
  () => {
    const chart = new ChartXY(),
      axis = chart.axisX;
    try {
      assert.equal(axis.setInterval(2, 12), axis);
      assert.equal(axis.setInterval({ start: 4 }), axis);
      assert.deepEqual(axis.getInterval(), { start: 4, end: 12 });
      axis.setInterval({ end: 18 });
      assert.deepEqual(axis.getInterval(), { start: 4, end: 18 });
      const copy = axis.getInterval();
      copy.start = -100;
      assert.deepEqual(axis.getInterval(), { start: 4, end: 18 });
      assert.equal(axis.getStopped(), true);
    } finally {
      chart.dispose();
    }
  },
);

apiTest(
  "invalid ranges do not publish interval or stopped-state changes",
  ["Axis.setInterval", "Axis.onIntervalChange", "Axis.on"],
  () => {
    const chart = new ChartXY(),
      axis = chart.axisX;
    try {
      axis.setInterval({ start: 2, end: 12, stopAxisAfter: false });
      let events = 0;
      axis.onIntervalChange(() => {
        events++;
      });
      axis.on("stoppedchange", () => {
        events++;
      });
      for (const interval of [
        { start: 2, end: 2 },
        { start: NaN },
        { end: Infinity },
        { start: -Infinity },
      ]) {
        assert.throws(() => axis.setInterval(interval), RangeError);
        assert.deepEqual(axis.getInterval(), { start: 2, end: 12 });
        assert.equal(axis.getStopped(), false);
      }
      assert.equal(events, 0);
    } finally {
      chart.dispose();
    }
  },
);

apiTest(
  "ascending descending inverted and logarithmic ranges retain independent coordinate transforms",
  [
    "Axis.setInverted",
    "Axis.getInverted",
    "Axis.valueToFraction",
    "Axis.fractionToValue",
  ],
  () => {
    const chart = new ChartXY(),
      linear = chart.axisX,
      log = chart.addAxisY({ type: "logarithmic" });
    try {
      for (const interval of [
        { start: -10, end: 30 },
        { start: 30, end: -10 },
      ]) {
        linear.setInterval(interval);
        for (const inverted of [false, true]) {
          linear.setInverted(inverted);
          assert.equal(linear.getInverted(), inverted);
          for (const fraction of [0, 0.25, 0.5, 1]) {
            const expected =
              interval.start +
              (inverted ? 1 - fraction : fraction) *
                (interval.end - interval.start);
            assert.equal(linear.fractionToValue(fraction), expected);
            assert.ok(
              Math.abs(linear.valueToFraction(expected) - fraction) < 1e-12,
            );
          }
          assert.deepEqual(linear.getInterval(), interval);
        }
      }
      log.setInterval({ start: 1, end: 1000 });
      assert.equal(log.fractionToValue(1 / 3), 10);
      assert.equal(log.valueToFraction(100), 2 / 3);
      assert.throws(() => log.setInterval({ start: 0, end: 10 }), /positive/);
      assert.deepEqual(log.getInterval(), { start: 1, end: 1000 });
    } finally {
      chart.dispose();
    }
  },
);

apiTest(
  "auto-fit state follows disabled strategies and resumed data following",
  [
    "Axis.setAutoFit",
    "Axis.getAutoFit",
    "Axis.setStopped",
    "Axis.getStopped",
    "Axis.setScrollStrategy",
    "Axis.getScrollStrategy",
  ],
  () => {
    const chart = new ChartXY(),
      axis = chart.axisY;
    try {
      const line = chart.addLineSeries().add([
        { x: 0, y: 2 },
        { x: 1, y: 6 },
      ]);
      axis.setScrollMargins(false).setInterval({ start: -20, end: 20 });
      assert.equal(axis.getAutoFit(), false);
      assert.equal(axis.setAutoFit(true), axis);
      chart.renderNow();
      assert.equal(axis.getAutoFit(), true);
      assert.deepEqual(axis.getInterval(), { start: 2, end: 6 });
      axis.setAutoFit(false);
      line.add({ x: 2, y: 50 });
      chart.renderNow();
      assert.equal(axis.getAutoFit(), false);
      assert.deepEqual(axis.getInterval(), { start: 2, end: 6 });
      for (const strategy of [undefined, null, false]) {
        axis.setScrollStrategy(strategy);
        assert.equal(axis.getAutoFit(), false);
        assert.equal(axis.getScrollStrategy(), strategy);
        axis.setAutoFit(true);
        chart.renderNow();
        assert.equal(axis.getAutoFit(), true);
        assert.deepEqual(axis.getInterval(), { start: 2, end: 50 });
      }
    } finally {
      chart.dispose();
    }
  },
);

apiTest(
  "default interval callbacks receive current data bounds and fit respects explicit stop requests",
  ["Axis.setDefaultInterval", "Axis.getDefaultInterval", "Axis.fit"],
  () => {
    const chart = new ChartXY(),
      axis = chart.axisX;
    try {
      const line = chart.addLineSeries().add([
          { x: 10, y: 0 },
          { x: 30, y: 1 },
        ]),
        states: any[] = [];
      const callback = (state: any) => {
        states.push(state);
        return { start: state.dataMax - 5, end: state.dataMax };
      };
      assert.equal(axis.getDefaultInterval(), undefined);
      axis.setDefaultInterval(callback);
      assert.equal(axis.getDefaultInterval(), callback);
      assert.deepEqual(axis.getInterval(), { start: 25, end: 30 });
      line.add({ x: 40, y: 2 });
      axis.fit(false, false);
      assert.deepEqual(axis.getInterval(), { start: 35, end: 40 });
      assert.equal(axis.getStopped(), false);
      assert.equal(states.at(-1).dataMin, 10);
      assert.equal(states.at(-1).dataMax, 40);
      axis.fit(false, true);
      assert.equal(axis.getStopped(), true);
    } finally {
      chart.dispose();
    }
  },
);

apiTest(
  "view layout and interaction aliases leave the selected numeric interval unchanged",
  [
    "Axis.getLength",
    "Axis.getTitleRotation",
    "Axis.hasTitleFillStyleOverride",
    "Axis.setMouseInteractions",
    "Axis.setMouseInteractionsEnabled",
    "Axis.getUserInteractions",
  ],
  () => {
    const chart = new ChartXY(),
      axis = chart.axisX;
    try {
      axis.setInterval({ start: -3, end: 7 }).setLength({ pixels: 180 });
      const length = axis.getLength() as { pixels: number };
      length.pixels = 1;
      assert.deepEqual(axis.getLength(), { pixels: 180 });
      assert.equal(axis.getTitleRotation(), 0);
      axis.setTitleRotation(45);
      assert.equal(axis.getTitleRotation(), 45);
      assert.equal(axis.hasTitleFillStyleOverride(), false);
      axis.setTitleFillStyle(new SolidFill({ color: ColorRGBA(1, 2, 3) }));
      assert.equal(axis.hasTitleFillStyleOverride(), true);
      axis.setMouseInteractions(false);
      assert.equal(axis.getUserInteractions(), false);
      axis.setMouseInteractionsEnabled(true);
      assert.equal(axis.getUserInteractions(), true);
      assert.deepEqual(axis.getInterval(), { start: -3, end: 7 });
    } finally {
      chart.dispose();
    }
  },
);

apiTest(
  "Axis numeric precision configures cursor and tick text without rounding source data",
  ["Axis.setNumericPrecision"],
  () => {
    const chart = new ChartXY(),
      axis = chart.axisX;
    try {
      const line = chart.addLineSeries().add([{ x: 1.23456789, y: 2 }]),
        revision = line.getDataSet().revision;
      axis.setInterval({ start: 0, end: 2 });
      assert.equal(axis.setNumericPrecision(3), axis);
      assert.equal(axis.formatCursorValue(1.23456789), "1.235");
      assert.ok(
        axis
          .tickLayout(600)
          .major.every((tick) => /^-?\d+\.\d{3}$/.test(tick.label)),
      );
      for (const precision of [-1, 1.5, 101, Infinity, NaN])
        assert.throws(() => axis.setNumericPrecision(precision), RangeError);
      assert.equal(line.getSample(0).x, 1.23456789);
      assert.equal(line.getDataSet().revision, revision);
      assert.deepEqual(axis.getInterval(), { start: 0, end: 2 });
    } finally {
      chart.dispose();
    }
  },
);

apiTest(
  "public axis event removal and disposal detach listeners",
  ["Axis.off", "Axis.emitPublicInteraction", "Axis.isDisposed"],
  () => {
    const chart = new ChartXY(),
      axis = chart.axisX;
    try {
      let intervals = 0;
      const token = axis.on("intervalchange", () => {
        intervals++;
      });
      axis.setInterval(2, 12);
      assert.equal(axis.off(token), true);
      axis.setInterval(3, 13);
      assert.equal(intervals, 1);
      const received: Event[] = [],
        listener = (event: Event) => {
          received.push(event);
        };
      axis.addEventListener("click", listener);
      const event = new Event("click");
      axis.emitPublicInteraction("click", event);
      assert.deepEqual(received, [event]);
      axis.removeEventListener("click", listener);
      axis.emitPublicInteraction("click", new Event("click"));
      assert.equal(received.length, 1);
      assert.equal(axis.isDisposed(), false);
      axis.dispose();
      assert.equal(axis.isDisposed(), true);
      assert.equal(axis.events.listenerCount(), 0);
    } finally {
      chart.dispose();
    }
  },
);

apiTest(
  "exposed scroll frame hooks advance bounded animations and cancellation preserves the current range",
  ["Axis.advanceScrollAnimation", "Axis.cancelScrollAnimation"],
  () => {
    const chart = new ChartXY(),
      axis = chart.axisX;
    try {
      chart.addLineSeries().add([
        { x: 0, y: 0 },
        { x: 30, y: 1 },
      ]);
      axis
        .setScrollMargins(false)
        .setAnimationScroll(true)
        .setScrollStrategy(AxisScrollStrategies.progressive)
        .setInterval({ start: 0, end: 10, stopAxisAfter: false });
      axis.updateAuto();
      axis.advanceScrollAnimation(0);
      axis.advanceScrollAnimation(16);
      const range = axis.getInterval();
      assert.ok(range.start >= 0 && range.end <= 30);
      assert.equal(range.end - range.start, 10);
      axis.cancelScrollAnimation();
      axis.advanceScrollAnimation(10000);
      assert.deepEqual(axis.getInterval(), range);
    } finally {
      chart.dispose();
    }
  },
);

apiTest(
  "numeric strategy exposes independent extreme formatting and public placement configuration",
  [
    "NumericTickStrategy.setExtremeFormattingFunction",
    "NumericTickStrategy.setGreatTickStyle",
    "NumericTickStrategy.setMaxTickCount",
    "NumericTickStrategy.setTickPlacement",
    "NumericTickStrategy.setDateOrigin",
  ],
  () => {
    const strategy = new NumericTickStrategy(),
      formatter = (value: number) => `E${value}`;
    strategy.setExtremeFormattingFunction(formatter);
    assert.equal(strategy.getExtremeFormattingFunction()!(3), "E3");
    const style = new TickStyle(new FontSettings({ size: 16 }));
    strategy.setGreatTickStyle(style);
    assert.equal(strategy.getMajorTickStyle().getLabelFont().size, 16);
    strategy.setMaxTickCount(4);
    assert.equal(strategy.maxTickCount, 4);
    const placement = () => [{ position: 1, label: "one" }];
    strategy.setTickPlacement(placement);
    assert.equal(strategy.getCustomTickPlacement(), placement);
    assert.deepEqual(strategy.customMajor(), [{ position: 1, label: "one" }]);
    strategy.setDateOrigin(new Date(1000));
    assert.equal(strategy.dateOrigin, 1000);
  },
);
