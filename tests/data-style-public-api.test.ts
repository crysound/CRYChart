import assert from "node:assert/strict";
import { DataSetXY } from "../src/core/data.js";
import {
  Color,
  ColorRGB,
  ColorRGBA,
  ColorHSV,
  SolidFill,
  LUT,
  FontSettings,
  disableTextShadows,
  htmlTextRenderer,
} from "../src/core/styles.js";
import { apiTest } from "./helpers/api-test.js";

apiTest(
  "public dataset schema copies and implicit coordinates preserve caller data and revision aliases",
  [
    "DataSetXY.getSchema",
    "DataSetXY.hasColumn",
    "DataSetXY.enableImplicitXColumn",
    "DataSetXY.version",
  ],
  () => {
    const data = new DataSetXY({ schema: { y: { storage: Float64Array } } });
    try {
      const schema = data.getSchema();
      schema.y!.storage = Float32Array;
      assert.equal(data.getSchema().y!.storage, Float64Array);
      assert.equal(data.hasColumn("missing"), false);
      data.enableImplicitXColumn();
      data.enableImplicitXColumn();
      assert.equal(data.hasColumn("_auto"), true);
      assert.equal("_auto" in data.getSchema(), false);
      const before = data.version;
      data.appendSamples({ y: [3, 2, 1] }, { start: 10, step: 0.25 });
      assert.equal(data.version, before + 1);
      assert.equal(data.version, data.revision);
      assert.deepEqual(
        [
          data.getValue("_auto", 0),
          data.getValue("_auto", 1),
          data.getValue("_auto", 2),
        ],
        [10, 10.25, 10.5],
      );
      assert.deepEqual([...data.readBack().data.y!], [3, 2, 1]);
      const late = new DataSetXY({ schema: { y: {} } }).appendSamples({
        y: [1],
      });
      assert.throws(
        () => late.enableImplicitXColumn(),
        /before adding samples/,
      );
      late.dispose();
    } finally {
      data.dispose();
    }
  },
);

apiTest(
  "public color constructors channel setters and string aliases retain immutable byte-channel semantics",
  [
    "Color.constructor",
    "Color.setR",
    "Color.setG",
    "Color.setB",
    "Color.toRGBAString",
    "Color.toString",
    "ColorRGB",
    "ColorHSV",
  ],
  () => {
    const color = new Color({ r: 2, g: -0.5, b: 0.25, a: 0.5 });
    assert.equal(color.toString(), "rgba(255, 0, 64, 0.5)");
    assert.equal(color.toRGBAString(), color.toCSS());
    const edited = color.setR(32).setG(64).setB(128);
    assert.deepEqual(
      [edited.getR(), edited.getG(), edited.getB(), edited.getA()],
      [32, 64, 128, 127.5],
    );
    assert.equal(color.getR(), 255);
    assert.equal(color.getG(), 0);
    assert.ok(Object.isFrozen(color));
    assert.equal(ColorRGB(1, 2, 3).toCSS(), "rgba(1, 2, 3, 1)");
    for (const hue of [0, 360, -360, 720])
      assert.equal(ColorHSV(hue).toCSS(), "rgba(255, 0, 0, 1)");
    assert.equal(ColorHSV(120).toCSS(), "rgba(0, 255, 0, 1)");
    assert.equal(ColorHSV(240).toCSS(), "rgba(0, 0, 255, 1)");
  },
);

apiTest(
  "public highlight colors brighten dark colors and darken light colors without changing alpha",
  ["Color.getLighter", "Color.getDarker", "Color.getHighlight"],
  () => {
    const dark = ColorRGBA(0, 0, 0, 128),
      light = ColorRGBA(255, 255, 255, 128);
    assert.equal(
      dark.getLighter().toCSS(),
      "rgba(51, 51, 51, 0.5019607843137255)",
    );
    assert.equal(
      light.getDarker().toCSS(),
      "rgba(204, 204, 204, 0.5019607843137255)",
    );
    assert.equal(dark.getHighlight().toCSS(), dark.getLighter().toCSS());
    assert.equal(light.getHighlight().toCSS(), light.getDarker().toCSS());
    assert.equal(dark.getR(), 0);
    assert.equal(light.getR(), 255);
  },
);

apiTest(
  "fill channel mutation copies its color and palette matrix lookups preserve metadata and fallback colors",
  [
    "SolidFill.setColor",
    "SolidFill.setR",
    "SolidFill.setG",
    "SolidFill.setB",
    "LUT.getColors",
    "LUT.getFallbackColor",
    "LUT.setTitle",
    "LUT.getTitle",
    "LUT.setPercentageValues",
    "LUT.getPercentageValues",
  ],
  () => {
    const original = new SolidFill({ color: ColorRGBA(10, 20, 30) });
    const next = original
      .setR(40)
      .setG(50)
      .setB(60)
      .setColor((color) => color.setA(128));
    assert.equal(original.getColor().toCSS(), "rgba(10, 20, 30, 1)");
    assert.equal(next.getColor().getR(), 40);
    assert.equal(next.getColor().getA(), 128);
    const red = ColorRGB(255, 0, 0),
      blue = ColorRGB(0, 0, 255),
      fallback = ColorRGB(0, 255, 0);
    const initial = new LUT({
      steps: [
        { value: 0, color: red },
        { value: 1, color: blue },
      ],
      fallbackColor: fallback,
    });
    const lut = initial.setTitle("Temperature").setPercentageValues(true);
    assert.equal(initial.getTitle(), "");
    assert.equal(initial.getPercentageValues(), false);
    assert.equal(lut.getTitle(), "Temperature");
    assert.equal(lut.getPercentageValues(), true);
    assert.equal(lut.getFallbackColor(), fallback);
    assert.deepEqual(lut.getColors(0), red);
    assert.deepEqual(lut.getColors([0, 1, NaN]), [red, blue, fallback]);
    assert.deepEqual(
      lut.getColors([
        [0, 1],
        [NaN, Infinity],
      ]),
      [
        [red, blue],
        [fallback, fallback],
      ],
    );
  },
);

apiTest(
  "font variants and HTML text creation preserve source styles and insert plain text",
  [
    "FontSettings.setFamily",
    "FontSettings.setWeight",
    "FontSettings.setStyle",
    "FontSettings.setVariant",
    "FontSettings.getVariant",
    "disableTextShadows",
    "htmlTextRenderer.createElement",
  ],
  () => {
    const initial = new FontSettings({ size: 18, family: "Original" });
    const changed = initial
      .setFamily("Example")
      .setWeight(600)
      .setStyle("italic")
      .setVariant("small-caps");
    assert.equal(changed.toCSS(), "italic small-caps 600 18px Example");
    assert.equal(changed.getVariant(), "small-caps");
    assert.equal(initial.family, "Original");
    assert.equal(initial.getVariant(), "normal");
    const theme = { name: "source" };
    const noShadows = disableTextShadows(theme);
    assert.equal(noShadows.textShadows, false);
    assert.equal(noShadows.textShadowsDisabled, true);
    assert.deepEqual(theme, { name: "source" });
    const element = { textContent: "", innerHTML: "" };
    const document = {
      createElement(name: string) {
        assert.equal(name, "span");
        return element;
      },
    } as unknown as Document;
    assert.equal(
      htmlTextRenderer.createElement("<b>Signal</b>", document),
      element,
    );
    assert.equal(element.textContent, "<b>Signal</b>");
    assert.equal(element.innerHTML, "");
  },
);
