import test from "node:test";
import assert from "node:assert/strict";
import { ChartXY, Chart3D } from "../src/chart.js";
import {
  ColorRGBA,
  SolidFill,
  SolidLine,
  DashedLine,
  StipplePatterns,
  PalettedFill,
  LUT,
  PointShape,
  PointStyle3D,
  PixelatedPoints3D,
  TriangulatedPoints3D,
  UIElementBuilders,
  UILayoutBuilders,
  UIOrigins,
  htmlTextRenderer,
} from "../src/core/styles.js";
import { IndividualPointFill } from "../src/point-fill.js";
import { LinearGradientFill, canvasGradient } from "../src/gradients.js";
import { Icon } from "../src/custom-icon.js";
import { applyLine } from "../src/ui.js";
import { recordingChartContext } from "./helpers/recording-chart-context.js";

test("public normalized color line and dash fields drive Canvas colors widths and every exported stipple pattern", () => {
  const color = ColorRGBA(40, 128, 64),
    fill = new SolidFill({ color }),
    line = new SolidLine({ fillStyle: fill, thickness: 4 }),
    drawing = recordingChartContext();
  assert.equal(color.g, 128 / 255);
  assert.equal(color.b, 64 / 255);
  assert.equal(color.toCSS(), "rgba(40, 128, 64, 1)");
  assert.equal(line.kind, "solid");
  assert.equal(line.fillStyle, fill);
  assert.equal(line.thickness, 4);
  assert.equal(applyLine(drawing.ctx, line), true);
  assert.equal(drawing.ctx.lineWidth, 4);
  const patterns = [
    StipplePatterns.Dotted,
    StipplePatterns.DottedDense,
    StipplePatterns.Dashed,
    StipplePatterns.DashedEqual,
    StipplePatterns.DashedLoose,
    StipplePatterns.DashDotted,
  ];
  assert.equal(Object.isFrozen(StipplePatterns), true);
  assert.equal(new Set(patterns.map((p) => p.join(","))).size, 6);
  assert.deepEqual(patterns, [
    [1, 3],
    [1, 1],
    [6, 3],
    [4, 4],
    [6, 6],
    [6, 3, 1, 3],
  ]);
  for (const pattern of patterns) {
    const dashed = new DashedLine({
      fillStyle: fill,
      thickness: 2,
      pattern,
      patternScale: 2,
    });
    assert.equal(dashed.kind, "dashed");
    assert.deepEqual(dashed.pattern, pattern);
    assert.equal(dashed.patternScale, 2);
    applyLine(drawing.ctx, dashed);
    assert.deepEqual(
      drawing.of("setLineDash").at(-1)!.args[0],
      pattern.map((v) => v * 2),
    );
    assert.equal(Object.isFrozen(dashed.pattern), true);
  }
});

test("palette individual and gradient fill discriminators and references select actual point colors and Canvas gradients", () => {
  const chart = new ChartXY();
  try {
    const red = ColorRGBA(255, 0, 0),
      blue = ColorRGBA(0, 0, 255),
      lut = new LUT({
        steps: [
          { value: 0, color: red },
          { value: 10, color: blue },
        ],
      }),
      palette = new PalettedFill({ lut, lookUpProperty: "y" }),
      individual = new IndividualPointFill({ color: red });
    assert.equal(palette.kind, "palette");
    assert.equal(palette.lut, lut);
    assert.equal(palette.lookUpProperty, "y");
    const points = chart
      .addPointSeries()
      .setPointFillStyle(palette)
      .add([
        { x: 0, y: 0 },
        { x: 1, y: 10 },
      ]);
    const packet = points.drawPacket("points");
    assert.deepEqual([...packet.colors!].slice(0, 4), [1, 0, 0, 1]);
    assert.deepEqual([...packet.colors!].slice(4, 8), [0, 0, 1, 1]);
    assert.equal(individual.kind, "individual");
    assert.equal(individual.type, "fillstyle");
    assert.equal(individual.fillType, "individual");
    points.setPointFillStyle(individual).add({ x: 2, y: 5, color: blue });
    assert.deepEqual(
      [...points.drawPacket("points").colors!].slice(8, 12),
      [0, 0, 1, 1],
    );
    const gradient = new LinearGradientFill({
        stops: [
          { offset: 0, color: red },
          { offset: 1, color: blue },
        ],
      }),
      drawing = recordingChartContext();
    assert.equal(gradient.kind, "linear-gradient");
    assert.equal(gradient.type, "fillstyle");
    assert.equal(gradient.fillType, "linear-gradient");
    canvasGradient(drawing.ctx, gradient, {
      left: 0,
      top: 0,
      width: 20,
      height: 40,
    });
    assert.equal(drawing.of("colorStop").length, 2);
  } finally {
    chart.dispose();
  }
});

test("all exported point shape constants and public 3D point style fields survive packet preparation without data replacement", () => {
  const chart = new ChartXY(),
    three = new Chart3D();
  try {
    const series = chart.addPointSeries().add({ x: 1, y: 2 }),
      shapes = [
        PointShape.Arrow,
        PointShape.Cross,
        PointShape.Diamond,
        PointShape.Minus,
        PointShape.Star,
        PointShape.Triangle,
      ];
    assert.deepEqual(shapes, [7, 3, 4, 6, 8, 2]);
    for (const shape of shapes) {
      series.setPointShape(shape);
      assert.equal(series.drawPacket("points").pointShape, shape);
      assert.equal(series.getSampleCount(), 1);
    }
    const fill = new SolidFill({ color: ColorRGBA(4, 5, 6) }),
      style = new TriangulatedPoints3D({
        fillStyle: fill,
        size: 12,
        shape: "cube",
      });
    assert.equal(style.fillStyle, fill);
    assert.equal(style.size, 12);
    assert.equal(style.shape, "cube");
    const points = three
      .addPointSeries()
      .setPointStyle(style)
      .add({ x: 1, y: 2, z: 3 });
    assert.equal(points.getPointSize(), 12);
    assert.equal(points.getPointFillStyle(), fill);
    assert.equal(points.getPointShape(), "cube");
    const pixel = new PointStyle3D.Pixelated({ size: 7 });
    assert.ok(pixel instanceof PixelatedPoints3D);
    assert.equal(pixel.getSize(), 7);
    points.setPointStyle(pixel);
    assert.equal(points.getPointSize(), 7);
  } finally {
    chart.dispose();
    three.dispose();
  }
});

test("UI builder constants create their declared element and layout kinds and origins anchor real element bounds", () => {
  const chart = new ChartXY();
  try {
    const builders = [
      UIElementBuilders.AxisTickMajor,
      UIElementBuilders.AxisTickMinor,
      UIElementBuilders.ButtonBox,
      UIElementBuilders.LUTRange,
      UIElementBuilders.PointableTextBox,
      UILayoutBuilders.Column,
      UILayoutBuilders.Row,
    ];
    assert.equal(Object.isFrozen(UILayoutBuilders), true);
    assert.deepEqual(
      builders.map((builder) => builder.kind),
      [
        "AxisTickMajor",
        "AxisTickMinor",
        "ButtonBox",
        "LUTRange",
        "PointableTextBox",
        "Column",
        "Row",
      ],
    );
    for (const builder of builders) {
      const ui = chart.addUIElement(builder).setText("builder");
      assert.equal(builder.kind, builder.type);
      assert.equal(ui.kind, builder.kind);
      assert.equal(ui.getText(), "builder");
    }
    const origins = [
      UIOrigins.LeftBottom,
      UIOrigins.CenterBottom,
      UIOrigins.RightBottom,
      UIOrigins.LeftCenter,
      UIOrigins.RightCenter,
      UIOrigins.CenterTop,
      UIOrigins.RightTop,
    ];
    assert.deepEqual(origins, [
      { x: 0, y: 0 },
      { x: 0.5, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 0.5 },
      { x: 1, y: 0.5 },
      { x: 0.5, y: 1 },
      { x: 1, y: 1 },
    ]);
    for (const origin of origins) {
      const ui = chart
          .addUIElement(UIElementBuilders.TextBox)
          .setText("origin")
          .setPosition({ x: 50, y: 50 })
          .setOrigin(origin),
        drawing = recordingChartContext();
      ui.draw(drawing.ctx, { left: 0, top: 0, width: 200, height: 100 });
      const b = ui.bounds;
      assert.equal(b.left, 100 - origin.x * b.width);
      assert.equal(b.top, 50 - (1 - origin.y) * b.height);
    }
    assert.equal(htmlTextRenderer.kind, "html");
    assert.equal(htmlTextRenderer.type, "html-text-renderer");
    const element = htmlTextRenderer.createElement("A<br>B", {
      createElement: () => ({ textContent: "" }),
    } as unknown as Document);
    assert.equal(element.textContent, "A<br>B");
    const icon = new Icon({ width: 8, height: 4 } as HTMLCanvasElement, {
      width: 16,
      height: 12,
    });
    assert.equal(icon.type, "icon");
    assert.equal(icon.width, 16);
    assert.equal(icon.height, 12);
    chart.addPointSeries().setPointShape(icon).add({ x: 1, y: 2 });
    assert.deepEqual(icon.getRasterSize(), { width: 16, height: 12 });
    icon.dispose();
  } finally {
    chart.dispose();
  }
});
