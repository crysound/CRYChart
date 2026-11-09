import test from "node:test";
import assert from "node:assert/strict";
import { ColorRGBA } from "../src/core/styles.js";
import { LinearGradientFill, gradientEndpoints } from "../src/gradients.js";

test("gradient owns its stops and setters retain the previous immutable value", () => {
  const stops = [
    { offset: 0, color: ColorRGBA(255, 0, 0, 0) },
    { offset: 1, color: ColorRGBA(0, 0, 255) },
  ];
  const original = new LinearGradientFill({ stops }),
    changed = original.setAngle(Math.PI / 2, true);
  stops[0]!.offset = 0.8;
  original.getColorStops()[0]!.offset = 0.4;
  assert.equal(original.getColorStops()[0]!.offset, 0);
  assert.equal(original.getAngle(), 0);
  assert.equal(changed.getAngle(), 90);
  assert.equal(changed.getAngle(true), Math.PI / 2);
  assert.equal(original.sample(0.5).a, 0.5);
  assert.throws(() => original.setAngle(NaN), /finite/);
  assert.throws(
    () => original.setColorStops([{ offset: 2, color: ColorRGBA(0, 0, 0) }]),
    /between/,
  );
});

test("zero degrees runs from bottom to top, with clockwise rotation", () => {
  const bounds = { left: 10, top: 20, width: 200, height: 100 };
  assert.deepEqual(gradientEndpoints(bounds, 0), {
    x0: 110,
    y0: 120,
    x1: 110,
    y1: 20,
  });
  const horizontal = gradientEndpoints(bounds, 90);
  assert.ok(
    Math.abs(horizontal.x0 - 10) < 1e-10 &&
      Math.abs(horizontal.x1 - 210) < 1e-10,
  );
  assert.ok(
    Math.abs(horizontal.y0 - 70) < 1e-10 &&
      Math.abs(horizontal.y1 - 70) < 1e-10,
  );
});

test("duplicate stops create a sharp transition, empty gradients stay transparent", () => {
  const red = ColorRGBA(255, 0, 0),
    blue = ColorRGBA(0, 0, 255);
  const gradient = new LinearGradientFill({
    stops: [
      { offset: 0, color: red },
      { offset: 0.5, color: red },
      { offset: 0.5, color: blue },
      { offset: 1, color: blue },
    ],
  });
  assert.deepEqual(gradient.sample(0.5), blue);
  assert.equal(gradient.sample(0.49).toCSS(), red.toCSS());
  assert.equal(new LinearGradientFill({ stops: [] }).sample(0.5).a, 0);
});
