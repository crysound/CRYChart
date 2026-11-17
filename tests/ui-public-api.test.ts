import assert from "node:assert/strict";
import {
  UIElement,
  UIBackground,
  ResultTable,
  Cursor,
  CursorPointMarker,
  LegendBox,
  applyLine,
} from "../src/ui.js";
import {
  FontSettings,
  UIOrigins,
  SolidFill,
  SolidLine,
  DashedLine,
  ColorRGBA,
  emptyLine,
  emptyFill,
  UIBuilder,
  PixelatedPoints3D,
  TriangulatedPoints3D,
  SimpleShadingStyle,
  assertColorShadingStyle,
  resolveValue,
  EmptyFill,
} from "../src/core/styles.js";
import { apiTest } from "./helpers/api-test.js";
import { recordingChartContext } from "./helpers/recording-chart-context.js";

apiTest(
  "UI font rotation origin and pointer settings affect rendered text and checked events",
  [
    "UIElement.setFont",
    "UIElement.setRotation",
    "UIElement.setTextRotation",
    "UIElement.getOrigin",
    "UIElement.getVisible",
    "UIElement.setPointerEvents",
    "UIElement.setMouseInteractions",
    "UIElement.setEffect",
    "UIElement.setChecked",
    "UIElement.onCheckedChange",
    "UIElement.on",
    "UIElement.off",
    "UIElement.offDispose",
  ],
  () => {
    const drawing = recordingChartContext(),
      ui = new UIElement({}, "CheckBox")
        .setText("Enabled")
        .setPosition({ x: 50, y: 50 });
    const checks: boolean[] = [];
    const token = ui.onCheckedChange((_ui: UIElement, value: boolean) =>
      checks.push(value),
    );
    ui.setFont(new FontSettings({ size: 17, family: "Example" }))
      .setTextRotation(30)
      .setEffect(true)
      .setOrigin(UIOrigins.Center);
    const origin = ui.getOrigin();
    origin.x = 0;
    assert.deepEqual(ui.getOrigin(), UIOrigins.Center);
    ui.draw(drawing.ctx, { left: 0, top: 0, width: 300, height: 200 });
    assert.ok(drawing.text().includes("Enabled"));
    assert.ok(
      drawing.of("fillText").some((c) => c.font.includes("17px Example")),
    );
    assert.ok(
      drawing
        .of("rotate")
        .some((c) => Math.abs(c.args[0] - Math.PI / 6) < 1e-12),
    );
    ui.setChecked(true).setChecked(false);
    assert.deepEqual(checks, [true, false]);
    ui.off(token);
    ui.setChecked(true);
    assert.deepEqual(checks, [true, false]);
    const center = { x: ui.bounds.left + 1, y: ui.bounds.top + 1 };
    assert.equal(ui.hitTest(center), true);
    ui.setMouseInteractions(false);
    assert.equal(ui.hitTest(center), false);
    ui.setPointerEvents(true).setVisible(false);
    assert.equal(ui.getVisible(), false);
    assert.equal(ui.hitTest(center), false);
    let disposed = 0;
    const off = ui.onDispose(() => {
      disposed++;
    });
    ui.offDispose(off);
    ui.dispose();
    assert.equal(disposed, 0);
    assert.equal(drawing.depth(), 0);
  },
);

apiTest(
  "result tables own row arrays and cursor placement clamps an actual rendered table",
  [
    "UIBackground.constructor",
    "ResultTable.constructor",
    "ResultTable.addRow",
    "ResultTable.clear",
    "Cursor.drawResultTable",
    "Cursor.setSolveMode",
    "Cursor.setResultTableAutoTextStyle",
    "Cursor.getAutoFit",
    "Cursor.getKeepWithinAxisBoundaries",
  ],
  () => {
    let invalidations = 0;
    const background = new UIBackground(() => {
      invalidations++;
    });
    background.setFillStyle(emptyFill);
    assert.equal(invalidations, 1);
    const drawing = recordingChartContext(),
      table = new ResultTable({}, "ResultTable");
    table.addRow("X", "1.5").addRow("Y", "2.5");
    const copy = table.getContent();
    copy[0]![0] = "changed";
    assert.equal(table.getContent()[0]![0], "X");
    const cursor = new Cursor()
      .setResultTable(table)
      .setSolveMode("nearest")
      .setResultTableAutoTextStyle(false)
      .setAutoFit(true)
      .setKeepWithinAxisBoundaries(true);
    assert.equal(cursor.solveMode, "nearest");
    assert.equal(cursor.autoTextStyle, false);
    assert.equal(cursor.getAutoFit(), true);
    assert.equal(cursor.getKeepWithinAxisBoundaries(), true);
    const rect = { left: 0, top: 0, width: 200, height: 100 };
    cursor.drawResultTable(drawing.ctx, rect, { x: 198, y: 99 });
    assert.ok(
      table.bounds.left >= 0 && table.bounds.left + table.bounds.width <= 200,
    );
    assert.ok(drawing.text().some((t) => t.includes("1.5")));
    table.clear();
    assert.deepEqual(table.getContent(), []);
    cursor.dispose();
    assert.equal(table.isDisposed(), true);
    assert.equal(drawing.depth(), 0);
  },
);

apiTest(
  "point marker fill and outline reach the cursor drawing path and hidden legends release entries",
  [
    "CursorPointMarker.constructor",
    "CursorPointMarker.setStrokeStyle",
    "CursorPointMarker.getFillStyle",
    "CursorPointMarker.getStrokeStyle",
    "LegendBox.setTitle",
    "LegendBox.getEntries",
    "LegendBox.remove",
    "applyLine",
  ],
  () => {
    const fill = new SolidFill({ color: ColorRGBA(200, 30, 40) }),
      stroke = new SolidLine({ fillStyle: fill, thickness: 2 }),
      marker = new CursorPointMarker();
    marker.setFillStyle(fill).setStrokeStyle(stroke).setSize(12);
    assert.equal(marker.getFillStyle(), fill);
    assert.equal(marker.getStrokeStyle(), stroke);
    const drawing = recordingChartContext(),
      cursor = new Cursor()
        .setPointMarker(marker)
        .setPosition({ x: 10, y: 10 })
        .setResultTableVisible(false)
        .setTickMarkerXVisible(false)
        .setTickMarkerYVisible(false);
    cursor.draw(
      drawing.ctx,
      { left: 0, top: 0, width: 100, height: 100 },
      (p) => p,
    );
    assert.ok(
      drawing.of("fill").some((c) => c.fill === fill.getColor().toCSS()),
    );
    assert.ok(
      drawing.of("stroke").some((c) => c.stroke === fill.getColor().toCSS()),
    );
    assert.equal(applyLine(drawing.ctx, emptyLine), false);
    assert.equal(applyLine(drawing.ctx, stroke), true);
    const entry = {
      getName: () => "signal",
      getVisible: () => true,
      isDisposed: () => false,
      getStrokeStyle: () => stroke,
    };
    const legend = new LegendBox().setTitle("Signals").add(entry);
    const copy = legend.getEntries();
    copy.length = 0;
    assert.equal(legend.getEntries().length, 1);
    legend.draw(drawing.ctx, { left: 0, top: 0, width: 300, height: 200 });
    assert.ok(drawing.text().includes("Signals"));
    legend.remove(entry);
    assert.deepEqual(legend.getEntries(), []);
    legend.dispose();
    cursor.dispose();
  },
);

apiTest(
  "public style builders preserve immutable patterns point styles and explicit shading validation",
  [
    "DashedLine.setPattern",
    "DashedLine.setPatternScale",
    "DashedLine.getPatternScale",
    "PixelatedPoints3D.constructor",
    "TriangulatedPoints3D.setShape",
    "TriangulatedPoints3D.getShape",
    "TriangulatedPoints3D.setFillStyle",
    "UIBuilder.constructor",
    "EmptyFill.constructor",
    "assertColorShadingStyle",
    "resolveValue",
  ],
  () => {
    const source = new DashedLine({ pattern: [2, 4] }),
      pattern = [3, 7],
      changed = source.setPattern(pattern).setPatternScale(2);
    pattern[0] = 99;
    assert.deepEqual(changed.getPattern(), [3, 7]);
    assert.equal(changed.getPatternScale(), 2);
    assert.deepEqual(source.getPattern(), [2, 4]);
    const fill = new SolidFill({ color: ColorRGBA(4, 5, 6) }),
      style = new TriangulatedPoints3D(),
      updated = style.setShape("sphere").setFillStyle(fill);
    assert.equal(updated.getShape(), "sphere");
    assert.equal(updated.getFillStyle(), fill);
    assert.notEqual(style.getFillStyle(), fill);
    assert.equal(new PixelatedPoints3D().getSize(), 5);
    const builder = new UIBuilder("TextBox").setFont(
      new FontSettings({ size: 20 }),
    );
    assert.equal((builder.options.font as FontSettings).size, 20);
    assert.ok(Object.isFrozen(builder));
    assert.equal(new EmptyFill().kind, "empty");
    assert.doesNotThrow(() =>
      assertColorShadingStyle(new SimpleShadingStyle()),
    );
    assert.throws(() => assertColorShadingStyle({ kind: "unsupported" }));
    assert.equal(
      resolveValue((old: number) => old + 2, 3),
      5,
    );
    assert.equal(resolveValue(8, 3), 8);
  },
);
