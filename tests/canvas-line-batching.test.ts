import assert from "node:assert/strict";
import test from "node:test";
import type { DrawPacket } from "../src/contracts";
import { DataRenderer } from "../src/render";

function recordLine(count: number, options: Partial<DrawPacket> = {}, gap = -1) {
  type Command = [name: "move" | "line", x: number, y: number];
  const paths: Command[][] = [];
  let path: Command[] = [];
  const context = {
    setTransform() {}, clearRect() {}, save() {}, restore() {},
    beginPath() { path = []; }, rect() {}, clip() {}, setLineDash() {},
    moveTo(x: number, y: number) { path.push(["move", x, y]); },
    lineTo(x: number, y: number) { path.push(["line", x, y]); },
    stroke() { paths.push(path); },
  };
  const canvas = Object.assign(new EventTarget(), {
    width: count, height: 100, getContext: () => context,
  });
  const renderer = new DataRenderer(canvas as unknown as HTMLCanvasElement, { renderer: "canvas2d" });
  const positions = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    positions[i * 2] = i;
    positions[i * 2 + 1] = i === gap ? NaN : i % 2;
  }
  renderer.render([{
    id: 1, revision: 1, positions, count, dimensions: 2, mode: "line",
    color: [0.3, 0, 0.5, 1], thickness: 1, pointSize: 0,
    origin: { x: 0, y: 0, z: 0 },
    domain: { x: { start: 0, end: count }, y: { start: 0, end: 1 } },
    ...options,
  }], { left: 0, top: 0, width: count, height: 100 }, 1);
  renderer.dispose();
  return { paths, drawCalls: renderer.stats.drawCalls, vertices: renderer.stats.vertices };
}

test("long solid Canvas2D lines split within a segment and keep all samples", () => {
  const { paths, drawCalls, vertices } = recordLine(16_500);
  assert.equal(drawCalls, 3);
  assert.equal(vertices, 16_500);
  assert.deepEqual(paths.map(path => path.length), [8192, 8192, 120]);
  assert.deepEqual(paths[0]!.at(-1), ["line", 8190.5, 50]);
  assert.deepEqual(paths[1]![0], ["move", 8190.5, 50]);
  assert.deepEqual(paths[1]![1], ["line", 8191, 0]);
  assert.deepEqual(paths.at(-1)!.at(-1), ["line", 16_499, 0]);
});

test("an invalid sample at a split starts the next Canvas2D path without a bridge", () => {
  const { paths } = recordLine(8200, {}, 8191);
  assert.deepEqual(paths[0]!.at(-1), ["line", 8190, 100]);
  assert.deepEqual(paths[1]![0], ["move", 8192, 100]);
});

test("short, dashed, and translucent Canvas2D lines keep a single stroke", () => {
  assert.equal(recordLine(8192).drawCalls, 1);
  assert.equal(recordLine(8200, { dashPattern: [5, 3] }).drawCalls, 1);
  assert.equal(recordLine(8200, { color: [0.3, 0, 0.5, 0.4] }).drawCalls, 1);
});
