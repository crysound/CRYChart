import test from 'node:test';
import assert from 'node:assert/strict';
import {containedRasterClip, rasterTargetForRect, requireRasterTarget, type RasterClipFrame} from '../src/raster-clip.js';

const plot = {left: 10, top: 20, width: 200, height: 100};
test('contained clip intersects CSS plot, packet, unchanged viewport and actual destination', () => {
  const frame = rasterTargetForRect(null, 500, 400, plot, 2);
  assert.deepEqual(containedRasterClip(plot, {left: -20, top: 70, width: 400, height: 90}, frame), {x: 20, y: 160, width: 400, height: 100});
  assert.deepEqual(frame.viewport, {x: 20, y: 160, width: 400, height: 200});
  assert.deepEqual(containedRasterClip(plot, undefined, {...frame, width: 150, viewport: {x: 0, y: 170, width: 125, height: 35}}), {x: 20, y: 170, width: 105, height: 35});
});

test('complete-pixel containment holds at fractional DPR and without epsilon snapping', () => {
  for (const dpr of [1, 1.0000000447034836, 1.25, 1.5, 1.75, 2]) {
    const outer = {left: -3.25, top: 2.125, width: 19.75, height: 18.625};
    const clip = {left: 1.125, top: 3.375, width: 8.75, height: 7.25};
    const frame = rasterTargetForRect(null, 60, 50, outer, dpr), result = containedRasterClip(outer, clip, frame)!;
    for (let x = result.x; x < result.x + result.width; x++) for (let y = result.y; y < result.y + result.height; y++) {
      assert.ok(x >= clip.left * dpr && x + 1 <= (clip.left + clip.width) * dpr);
      assert.ok(y >= frame.height - (clip.top + clip.height) * dpr && y + 1 <= frame.height - clip.top * dpr);
      assert.ok(x >= 0 && y >= 0 && x + 1 <= frame.width && y + 1 <= frame.height);
    }
  }
  const rect = {left: 100, top: 80, width: 800, height: 420};
  assert.deepEqual(containedRasterClip(rect, undefined, rasterTargetForRect(null, 1000, 600, rect, 1)), {x: 100, y: 100, width: 800, height: 420});
  assert.deepEqual(containedRasterClip(rect, undefined, rasterTargetForRect(null, 1000, 600, rect, 1.0000000447034836)), {x: 101, y: 100, width: 799, height: 419});
});

test('empty, negative and subpixel CSS intersections remain empty; reversal belongs to projection', () => {
  const frame = rasterTargetForRect(null, 500, 400, plot, 1);
  for (const clip of [{left: 40, top: 50, width: 0, height: 10}, {left: 40, top: 50, width: -3, height: 10},
    {left: 40.1, top: 50, width: .8, height: 10}, {left: 40, top: 50.1, width: 10, height: .8},
    {left: 300, top: 20, width: 10, height: 10}]) assert.equal(containedRasterClip(plot, clip, frame), undefined);
  assert.equal(containedRasterClip(plot, undefined, {...frame, width: 0}), undefined);
  assert.deepEqual(containedRasterClip(plot, {left: 40, top: 50, width: .5, height: .5}, rasterTargetForRect(null, 1000, 800, plot, 2)), {x: 80, y: 699, width: 1, height: 1});
});

test('custom FBO metadata and CSS offsets use the real target rather than a canvas size', () => {
  const outer = {left: 0, top: 0, width: 100, height: 100};
  const frame: RasterClipFrame = {width: 48, height: 32, scaleX: 2, scaleY: 2, offsetX: -5, offsetY: 3, viewport: {x: -5, y: -171, width: 200, height: 200}};
  assert.deepEqual(containedRasterClip(outer, {left: 2, top: 1, width: 12, height: 10}, frame), {x: 0, y: 7, width: 23, height: 20});
  assert.throws(() => requireRasterTarget(undefined), /explicit/);
  assert.throws(() => containedRasterClip(plot, {left: NaN, top: 0, width: 1, height: 1}, frame), /finite/);
  assert.throws(() => containedRasterClip(plot, undefined, {...frame, width: 3.5}), /dimensions/);
  assert.throws(() => containedRasterClip(plot, undefined, {...frame, scaleX: -1}), /transform/);
  assert.throws(() => containedRasterClip(plot, undefined, {...frame, viewport: {x: .5, y: 0, width: 10, height: 10}}), /integer/);
});

test('128-pane actual integer-origin candidate retains the documented eight reference differences', () => {
  const rect = {left: 100, top: 80, width: 800, height: 420}, dpr = 1.0000000447034836;
  const target = rasterTargetForRect(null, 1000, 600, rect, dpr), different: number[] = [], occupied = new Set<number>();
  for (let i = 0; i < 128; i++) {
    const pane = {left: 100, top: 80 + i * 420 / 128, width: 800, height: 420 / 128};
    const clip = containedRasterClip(rect, pane, target)!;
    const modelY = Math.ceil((600 - pane.top - pane.height) * dpr), modelTop = Math.floor((600 - pane.top) * dpr);
    if (clip.y !== modelY || clip.height !== modelTop - modelY) different.push(i);
    for (let y = clip.y; y < clip.y + clip.height; y++) {assert.ok(!occupied.has(y)); occupied.add(y);}
  }
  assert.deepEqual(different, [0, 31, 32, 63, 64, 95, 96, 127]);
  assert.equal(occupied.size, 292);
});
