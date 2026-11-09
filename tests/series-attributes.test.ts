import test from "node:test";
import assert from "node:assert/strict";
import { ChartXY } from "../src/chart.js";
import { ColorRGBA, LUT, PalettedFill, SolidLine } from "../src/core/styles.js";
import { colorMappedLine } from "../src/series-attributes.js";
import { IndividualPointFill } from "../src/point-fill.js";

const red = ColorRGBA(255, 0, 0),
  green = ColorRGBA(0, 255, 0),
  blue = ColorRGBA(0, 0, 255);
test("point attributes allocate only when supplied and remain aligned across retained ring wraps", () => {
  const chart = new ChartXY(),
    plain = chart.addLineSeries();
  assert.deepEqual(Object.keys(plain.getDataSet().schema), ["xValues", "yValues"]);
  const s = chart
    .addPointSeries()
    .setMaxSampleCount(2)
    .setIndividualPointSizeEnabled(true)
    .setIndividualPointColorEnabled(true)
    .setIndividualPointRotationEnabled(true);
  s.add([
    { x: 0, y: 0, size: 12, color: red, rotation: 0 },
    { x: 1, y: 1, size: 24, color: green, rotation: 90 },
    { x: 2, y: 2, size: 36, color: blue, rotation: 180 },
  ]);
  const p = s.drawPacket("points");
  assert.deepEqual([...p.pointSizes!], [24, 36]);
  assert.deepEqual([...p.pointRotations!], [90, 180]);
  assert.deepEqual([...p.colors!], [0, 1, 0, 1, 0, 0, 1, 1]);
  assert.deepEqual(s.getSample(1).color, blue);
  assert.equal(s.getNextSampleIndex(), 3);
  s.appendSamples({
    xValues: [3],
    yValues: [3],
    size: [48],
    rotation: [270],
    color: [red.toUint32()],
  });
  assert.deepEqual([...s.drawPacket("points").pointSizes!], [36, 48]);
  assert.equal(s.getNextSampleIndex(), 4);
  chart.dispose();
});

test("point LUT values and style buffers are cached during viewport changes", () => {
  const chart = new ChartXY(),
    s = chart
      .addPointSeries()
      .setIndividualPointValueEnabled(true)
      .setPointFillStyle(
        new PalettedFill({
          lut: new LUT({
            steps: [
              { value: 0, color: red },
              { value: 10, color: blue },
            ],
          }),
          lookUpProperty: "value",
        }),
      );
  s.add([
    { x: 1, y: 1, value: 0 },
    { x: 2, y: 2, value: 10 },
  ]);
  const p = s.drawPacket("points");
  assert.deepEqual([...p.colors!], [1, 0, 0, 1, 0, 0, 1, 1]);
  chart.getDefaultAxisX().setInterval({ start: 0, end: 3 });
  assert.equal(s.drawPacket("points").colors, p.colors);
  s.clear().add({ x: 4, y: 4, value: 5 });
  assert.deepEqual([...s.drawPacket("points").colors!], [0.5, 0, 0.5, 1]);
  s.setIndividualPointValueEnabled(false);
  assert.deepEqual([...s.drawPacket("points").colors!], [0, 0, 0, 0]);
  chart.dispose();
});

test("IndividualPointFill uses each point color and immutable fallback when color is missing", () => {
  const chart = new ChartXY(),
    original = new IndividualPointFill({ color: red }),
    fill = original.setFallbackColor(green),
    s = chart.addPointSeries().setPointFillStyle(fill);
  s.add([
    { x: 0, y: 0, color: blue },
    { x: 1, y: 1 },
  ]);
  assert.deepEqual(
    [...s.drawPacket("points").colors!],
    [0, 0, 1, 1, 0, 1, 0, 1],
  );
  assert.equal(original.getFallbackColor(), red);
  chart.dispose();
});

test("continuous line palettes insert intermediate LUT colors even when raw segments cross several stops", () => {
  const lut = new LUT({
      steps: [
        { value: 0, color: red },
        { value: 5, color: green },
        { value: 10, color: blue },
      ],
    }),
    p = colorMappedLine(
      new Float32Array([0, 0, 10, 10]),
      new Float64Array([0, 10]),
      lut,
    );
  assert.deepEqual([...p.positions], [0, 0, 5, 5, 10, 10]);
  assert.deepEqual([...p.colors], [1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 1]);
});

test("discrete line palettes keep hard boundaries at interior points and exact sample endpoints", () => {
  const lut = new LUT({
    steps: [
      { value: 0, color: red },
      { value: 5, color: green },
      { value: 10, color: blue },
    ],
    interpolate: false,
  });
  const p = colorMappedLine(
    new Float32Array([0, 0, 5, 0, 10, 0]),
    new Float64Array([0, 5, 10]),
    lut,
  );
  assert.deepEqual([...p.positions], [0, 0, 5, 0, 5, 0, 10, 0]);
  assert.deepEqual(
    [...p.colors],
    [1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1],
  );
  const descending = colorMappedLine(
    new Float32Array([10, 0, 0, 0]),
    new Float64Array([10, 0]),
    lut,
  );
  assert.deepEqual([...descending.positions], [10, 0, 5, 0, 5, 0, 0, 0]);
  assert.deepEqual([...descending.colors.slice(0, 4)], [0, 1, 0, 1]);
});

test("palette-split line geometry leaves original data and point marker storage intact", () => {
  const chart = new ChartXY(),
    s = chart.addPointLineSeries().setStrokeStyle(
      new SolidLine({
        fillStyle: new PalettedFill({
          lut: new LUT({
            steps: [
              { value: 0, color: red },
              { value: 5, color: green },
              { value: 10, color: blue },
            ],
          }),
          lookUpProperty: "x",
        }),
      }),
    );
  s.add([
    { x: 0, y: 0 },
    { x: 10, y: 10 },
  ]);
  const line = s.drawPacket("line"),
    point = s.drawPacket("points");
  assert.equal(line.count, 3);
  assert.equal(point.count, 2);
  assert.notEqual(line.id, point.id);
  assert.equal(s.getSampleCount(), 2);
  chart.dispose();
});
