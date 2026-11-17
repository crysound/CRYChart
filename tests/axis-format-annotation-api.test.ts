import assert from "node:assert/strict";
import { ChartXY, Polar } from "../src/chart.js";
import {
  Annotation,
  DateTimeTickStrategy,
  TimeTickStrategy,
  TickStyle,
  PolarAxisRadial,
  mutate,
} from "../src/axis.js";
import {
  FontSettings,
  SolidFill,
  SolidLine,
  ColorRGBA,
  emptyFill,
} from "../src/core/styles.js";
import { apiTest } from "./helpers/api-test.js";

apiTest(
  "calendar zoom formatters select the requested scale and keep absolute timestamps and range metadata",
  [
    "DateTimeTickStrategy.setFormattingDecade",
    "DateTimeTickStrategy.setFormattingYear",
    "DateTimeTickStrategy.setFormattingMonth",
    "DateTimeTickStrategy.setFormattingDay",
    "DateTimeTickStrategy.setFormattingHour",
    "DateTimeTickStrategy.setFormattingMinute",
    "DateTimeTickStrategy.setFormattingSecond",
    "DateTimeTickStrategy.setFormattingMilliSecond",
    "DateTimeTickStrategy.formatDateTimeTick",
    "DateTimeTickStrategy.formatDateTimeCursor",
    "DateTimeTickStrategy.getUTC",
    "DateTimeTickStrategy.getLocale",
    "DateTimeTickStrategy.hasDateTimeFormatting",
  ],
  () => {
    const strategy = new DateTimeTickStrategy()
      .setUTC(true)
      .setLocale("en-US")
      .setDateOrigin(1000);
    assert.equal(strategy.getUTC(), true);
    assert.equal(strategy.getLocale(), "en-US");
    assert.equal(strategy.hasDateTimeFormatting(), false);
    const calls: any[] = [],
      major = (value: number, range: any, locale: string) => {
        calls.push({ value, range, locale });
        range.start = -1;
        return `M${value}`;
      };
    const minor = (value: number) => `m${value}`,
      great = (value: number) => `G${value}`;
    strategy
      .setFormattingDecade(major, minor)
      .setFormattingYear(major, minor)
      .setFormattingMonth(great, major, minor)
      .setFormattingDay(great, major, minor)
      .setFormattingHour(great, major, minor)
      .setFormattingMinute(great, major, minor)
      .setFormattingSecond(great, major, minor)
      .setFormattingMilliSecond(great, major);
    const range = { start: 0, end: 10000 };
    for (const zoom of [
      "decade",
      "year",
      "month",
      "day",
      "hour",
      "minute",
      "second",
      "millisecond",
    ] as const) {
      assert.equal(
        strategy.formatDateTimeTick(250, range, "major", zoom),
        "M1250",
      );
      if (zoom !== "millisecond")
        assert.equal(
          strategy.formatDateTimeTick(250, range, "minor", zoom),
          "m1250",
        );
    }
    assert.equal(calls.length, 8);
    assert.ok(calls.every((c) => c.value === 1250 && c.locale === "en-US"));
    assert.deepEqual(range, { start: 0, end: 10000 });
    assert.equal(strategy.hasDateTimeFormatting(), true);
    strategy.setCursorFormatter((value: number) => `cursor:${value}`);
    assert.equal(strategy.formatDateTimeCursor(250, range), "cursor:1250");
    assert.throws(
      () =>
        strategy.setFormattingHour(great, { month: "invalid" } as any, minor),
      RangeError,
    );
    assert.equal(
      strategy.formatDateTimeTick(250, range, "major", "hour"),
      "M1250",
    );
  },
);

apiTest(
  "time strategy public overrides retain caller fonts and custom placements when theme defaults refresh",
  [
    "TimeTickStrategy.constructor",
    "TimeTickStrategy.getMajorTickStyle",
    "TimeTickStrategy.getMinorTickStyle",
    "TimeTickStrategy.refreshDefaults",
    "TimeTickStrategy.resolveDefaultMinorFont",
    "TimeTickStrategy.setMajorTickPlacement",
    "TimeTickStrategy.setMinorTickPlacement",
    "TimeTickStrategy.setMajorTickStyle",
    "TimeTickStrategy.setMinorTickStyle",
    "TimeTickStrategy.setTickStyle",
    "TimeTickStrategy.setTickPlacement",
    "TimeTickStrategy.usesBoundedMinor",
  ],
  () => {
    const seed = new FontSettings({ size: 14, family: "Seed" }),
      fill = new SolidFill({ color: ColorRGBA(12, 34, 56) });
    const context = { font: seed, fill, minorEnabled: true };
    const strategy = new TimeTickStrategy(
      () => {},
      seed,
      {},
      () => context,
    );
    assert.equal(strategy.usesBoundedMinor(), true);
    assert.equal(strategy.resolveDefaultMinorFont().size, 10);
    strategy.setMajorTickStyle((style: TickStyle) =>
      style.setLabelFont(seed.setSize(19)),
    );
    strategy.setMinorTickStyle((style: TickStyle) =>
      style.setLabelFillStyle(fill).setLabelFont(seed.setSize(11)),
    );
    context.font = seed.setSize(22);
    strategy.refreshDefaults();
    assert.equal(strategy.getMajorTickStyle().getLabelFont().size, 19);
    assert.equal(strategy.getMinorTickStyle().getLabelFont().size, 11);
    assert.equal(strategy.getMinorTickStyle().getLabelFillStyle(), fill);
    assert.equal(
      strategy.getMinorTickStyle().hasLabelFillStyleOverride(),
      true,
    );
    const major = () => [{ position: 1 }],
      minor = () => [{ position: 0.5 }];
    strategy.setMajorTickPlacement(major).setMinorTickPlacement(minor);
    assert.deepEqual(strategy.customMajor(), [{ position: 1 }]);
    assert.deepEqual(strategy.customMinor(), [{ position: 0.5 }]);
    strategy.setTickPlacement({ major, minor });
    assert.equal(strategy.getCustomTickPlacement().major, major);
    strategy.setTickStyle((style: TickStyle) =>
      style.setLabelFont(seed.setSize(17)),
    );
    assert.equal(strategy.getMajorTickStyle().getLabelFont().size, 17);
    assert.equal(strategy.getMinorTickStyle().getLabelFont().size, 17);
    context.minorEnabled = false;
    assert.equal(strategy.usesBoundedMinor(), false);
    assert.equal(strategy.resolveDefaultMinorFont().size, 22);
  },
);

apiTest(
  "radial axis constructor keeps angular orientation separate from the numeric interval",
  ["PolarAxisRadial.constructor"],
  () => {
    const chart = new Polar(),
      radial = new PolarAxisRadial(chart);
    try {
      radial
        .setInterval({ start: 0, end: 360 })
        .setNorth(45)
        .setClockwise(true);
      assert.equal(radial.getNorth(), 45);
      assert.equal(radial.getClockwise(), true);
      assert.deepEqual(radial.getInterval(), { start: 0, end: 360 });
      assert.equal(radial.getTickFormattingFunction()(Math.PI / 2), "90°");
    } finally {
      radial.dispose();
      chart.dispose();
    }
  },
);

apiTest(
  "public immutable mutator preserves inputs and applies replacement or callback exactly once",
  ["mutate"],
  () => {
    const original = Object.freeze({ value: 3 });
    let calls = 0;
    const next = mutate(original, (previous) => {
      calls++;
      return { value: previous.value + 1 };
    });
    assert.deepEqual(next, { value: 4 });
    assert.deepEqual(original, { value: 3 });
    assert.equal(calls, 1);
    assert.equal(mutate(3, 9), 9);
    assert.throws(
      () =>
        mutate(3, () => {
          throw new Error("consumer");
        }),
      /consumer/,
    );
  },
);

apiTest(
  "annotation position bounds and style aliases affect one annotation without changing the axis interval",
  [
    "Annotation.constructor",
    "Annotation.setPosition",
    "Annotation.getPosition",
    "Annotation.setName",
    "Annotation.setText",
    "Annotation.setLabelTextFormatter",
    "Annotation.setMarker",
    "Annotation.getStart",
    "Annotation.getEnd",
    "Annotation.getFillStyle",
    "Annotation.getStrokeStyle",
    "Annotation.getVisible",
  ],
  () => {
    const chart = new ChartXY(),
      axis = chart.axisX,
      changed: string[] = [];
    try {
      axis.setInterval({ start: -10, end: 10 });
      const annotation = new Annotation(axis, "line", () => {
        changed.push("change");
      });
      annotation.setPosition(2);
      assert.equal(annotation.getPosition(), 2);
      annotation
        .setName("limit")
        .setText("warning")
        .setLabelTextFormatter((value: number) => `V${value}`);
      assert.equal(annotation.name, "limit");
      assert.equal(annotation.text, "warning");
      assert.equal(annotation.textFormatter(2), "V2");
      assert.equal(
        annotation.setMarker((marker) => marker.setPosition(3)),
        annotation,
      );
      assert.equal(annotation.getPosition(), 3);
      annotation.setStart(-2).setEnd(4);
      assert.equal(annotation.getStart(), -2);
      assert.equal(annotation.getEnd(), 4);
      const bounds = annotation.getBounds();
      bounds.start = -100;
      assert.deepEqual(annotation.getBounds(), { start: -2, end: 4 });
      const fill = new SolidFill({ color: ColorRGBA(1, 2, 3) }),
        stroke = new SolidLine({ fillStyle: fill });
      annotation.setFillStyle(fill).setStrokeStyle(stroke).setVisible(false);
      assert.equal(annotation.getFillStyle(), fill);
      assert.equal(annotation.getStrokeStyle(), stroke);
      assert.equal(annotation.getVisible(), false);
      assert.deepEqual(axis.getInterval(), { start: -10, end: 10 });
      assert.ok(changed.length > 0);
      annotation.dispose();
    } finally {
      chart.dispose();
    }
  },
);

apiTest(
  "annotation interaction revisions disable stale drags and removed listeners cannot fire again",
  [
    "Annotation.getUserInteractions",
    "Annotation.getDragCapabilities",
    "Annotation.getInteractionRevision",
    "Annotation.setMouseInteractionsEnabled",
    "Annotation.setDraggingMode",
    "Annotation.onValueChange",
    "Annotation.offValueChange",
    "Annotation.on",
    "Annotation.off",
    "Annotation.emitPublicInteraction",
    "Annotation.isDisposed",
  ],
  () => {
    const chart = new ChartXY(),
      line = chart.axisX.addConstantLine();
    try {
      const interactions = { move: { drag: true }, scale: { drag: true } };
      line.setUserInteractions(interactions);
      assert.equal(line.getUserInteractions(), interactions);
      assert.deepEqual(line.getDragCapabilities(), { move: true, scale: true });
      const revision = line.getInteractionRevision();
      line.setMouseInteractionsEnabled(false);
      assert.ok(line.getInteractionRevision() > revision);
      line.setDraggingMode(false);
      assert.deepEqual(line.getDragCapabilities(), {
        move: false,
        scale: false,
      });
      const values: number[] = [],
        token = line.onValueChange((_line: any, value: number) => {
          values.push(value);
        });
      line.setValue(5);
      assert.equal(line.offValueChange(token), true);
      line.setValue(6);
      assert.deepEqual(values, [5]);
      let changes = 0;
      const event = line.on("valuechange", () => {
        changes++;
      });
      line.setValue(7);
      line.off(event);
      line.setValue(8);
      assert.equal(changes, 1);
      const clicks: Event[] = [],
        clicked = (event: Event) => {
          clicks.push(event);
        };
      line.addEventListener("click", clicked);
      const click = new Event("click");
      line.emitPublicInteraction("click", click);
      assert.deepEqual(clicks, [click]);
      line.removeEventListener("click", clicked);
      assert.equal(line.isDisposed(), false);
      line.dispose();
      assert.equal(line.isDisposed(), true);
      assert.equal(line.events.listenerCount(), 0);
    } finally {
      chart.dispose();
    }
  },
);

apiTest(
  "documented axis annotation and tick placeholders accept compatibility calls without promising visual changes",
  [
    "Axis.setAnimationDuration",
    "Axis.setThickness",
    "Axis.setPadding",
    "TickStyle.setLabelRotation",
    "TickStyle.setLabelAlignment",
    "TickStyle.setTickPadding",
    "Annotation.setEffect",
    "Annotation.setTextFillStyle",
    "Annotation.setTextFont",
    "Annotation.setTextRotation",
  ],
  () => {
    const chart = new ChartXY(),
      axis = chart.axisX,
      tick = new TickStyle(),
      line = axis.addConstantLine();
    try {
      axis.setInterval({ start: -2, end: 8 });
      const length = axis.getLength(),
        font = tick.getLabelFont();
      assert.equal(
        axis.setAnimationDuration(123).setThickness(10).setPadding(20),
        axis,
      );
      assert.equal(
        tick.setLabelRotation(45).setLabelAlignment("left").setTickPadding(30),
        tick,
      );
      assert.equal(
        line
          .setEffect(true)
          .setTextFillStyle(emptyFill)
          .setTextFont(new FontSettings({ size: 30 }))
          .setTextRotation(90),
        line,
      );
      assert.deepEqual(axis.getInterval(), { start: -2, end: 8 });
      assert.deepEqual(axis.getLength(), length);
      assert.equal(tick.getLabelFont(), font);
    } finally {
      chart.dispose();
    }
  },
);
