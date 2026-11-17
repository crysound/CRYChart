import test from "node:test";
import assert from "node:assert/strict";
import {
  createWorldAxisConversion,
  worldAxisValueToFraction,
  worldAxisFractionToValue,
} from "../src/world-axis.js";
import { zoomWorldCameraStep3D } from "../src/world-camera.js";

test("world-axis fractions include asymmetric geometry margins and invert descending intervals", () => {
  for (const [start, end, endpoints] of [
    [10, 30, [8, 34]],
    [30, 10, [32, 6]],
  ] as const) {
    const conversion = createWorldAxisConversion({ start, end }, false, 1, {
      start: 100,
      end: 200,
    });
    assert.deepEqual(conversion.transformed, {
      start: endpoints[0],
      end: endpoints[1],
    });
    for (const fraction of [0, 0.25, 0.5, 1]) {
      const expected = endpoints[0] + fraction * (endpoints[1] - endpoints[0]);
      assert.equal(worldAxisFractionToValue(fraction, conversion), expected);
      assert.ok(
        Math.abs(worldAxisValueToFraction(expected, conversion) - fraction) <
          1e-14,
      );
      assert.equal(
        worldAxisFractionToValue(1 - fraction, conversion, true),
        expected,
      );
      assert.equal(
        worldAxisValueToFraction(expected, conversion, true),
        1 - fraction,
      );
    }
  }
});

test("logarithmic world-axis fractions preserve powers of ten and immutable conversion inputs", () => {
  const requested = { start: 1, end: 1000 },
    margins = { start: 0, end: 0 };
  const conversion = createWorldAxisConversion(requested, true, 1, margins);
  for (const [fraction, value] of [
    [0, 1],
    [1 / 3, 10],
    [2 / 3, 100],
    [1, 1000],
  ]) {
    assert.equal(worldAxisFractionToValue(fraction!, conversion), value);
    assert.equal(worldAxisValueToFraction(value!, conversion), fraction);
  }
  requested.end = 10;
  margins.start = 100;
  assert.equal(conversion.requested.end, 1000);
  assert.equal(conversion.geometryMargin.start, 0);
  assert.ok(Object.isFrozen(conversion.transformed));
  assert.ok(Object.isFrozen(conversion.requested));
  assert.throws(
    () => createWorldAxisConversion({ start: 0, end: 10 }, true, 1, margins),
    RangeError,
  );
  assert.throws(
    () =>
      createWorldAxisConversion(
        { start: -Number.MAX_VALUE, end: Number.MAX_VALUE },
        false,
        1,
        margins,
      ),
    RangeError,
  );
  assert.throws(
    () => createWorldAxisConversion({ start: 1, end: 10 }, false, 0, margins),
    RangeError,
  );
});

test("discrete world zoom uses direction rather than wheel magnitude and clips the camera radius", () => {
  const position = { x: 0, y: 0, z: 2 };
  assert.deepEqual(zoomWorldCameraStep3D(position, 1), { x: 0, y: 0, z: 2.1 });
  assert.deepEqual(zoomWorldCameraStep3D(position, 1000), {
    x: 0,
    y: 0,
    z: 2.1,
  });
  assert.deepEqual(zoomWorldCameraStep3D(position, -1, 2), {
    x: 0,
    y: 0,
    z: 1.8,
  });
  assert.deepEqual(zoomWorldCameraStep3D({ x: 0, y: 0, z: 0.81 }, -1), {
    x: 0,
    y: 0,
    z: 0.8,
  });
  assert.deepEqual(zoomWorldCameraStep3D({ x: 0, y: 0, z: 2.99 }, 1), {
    x: 0,
    y: 0,
    z: 3,
  });
  assert.deepEqual(zoomWorldCameraStep3D(position, 0), position);
  assert.deepEqual(zoomWorldCameraStep3D(position, 1, 0), position);
  assert.deepEqual(position, { x: 0, y: 0, z: 2 });
  for (const [delta, sensitivity] of [
    [Infinity, 1],
    [1, NaN],
  ])
    assert.throws(
      () => zoomWorldCameraStep3D(position, delta!, sensitivity),
      RangeError,
    );
  assert.throws(
    () => zoomWorldCameraStep3D({ x: 0, y: 0, z: 0 }, 1),
    RangeError,
  );
  assert.throws(
    () => zoomWorldCameraStep3D({ x: 0, y: 0, z: 1e308 }, 1, Number.MAX_VALUE),
    RangeError,
  );
});
