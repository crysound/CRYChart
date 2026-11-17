import test from "node:test";
import assert from "node:assert/strict";
import type { DrawPacket } from "../src/contracts.js";
import { TextureLineRenderer } from "../src/render-line-texture.js";
import { LineOffsetCache } from "../src/render-line-offsets.js";
import { RecordingLineGL } from "./helpers/recording-line-gl.js";

const rect = { left: 10, top: 20, width: 200, height: 100 };
const positions = (count: number) =>
  Float32Array.from({ length: count * 2 }, (_, i) =>
    i % 2 ? i + 0.25 : i / 2,
  );
const packet = (changes: Partial<DrawPacket> = {}): DrawPacket => ({
  id: 1,
  revision: 1,
  positions: positions(6),
  count: 6,
  dimensions: 2,
  mode: "line",
  color: [1, 0, 0, 0.5],
  thickness: 2,
  pointSize: 0,
  strictlyMonotonicX: true,
  origin: { x: 1000, y: 10, z: 0 },
  domain: { x: { start: 1000, end: 1010 }, y: { start: 10, end: 20 } },
  ...changes,
});
const context = (gl: RecordingLineGL) =>
  gl as unknown as WebGL2RenderingContext;
const layout = { buffer: {}, strideBytes: 8, centerOffsetBytes: 8 };

test("texture uploads preserve all source coordinates across rows and restore caller pixel-store state", () => {
  const gl = new RecordingLineGL(),
    renderer = new TextureLineRenderer(context(gl));
  const source = packet(),
    before = new Map(gl.pixelStore);
  assert.equal(renderer.draw(source, rect, 2), true);
  const uploads = gl.of("texSubImage2D");
  assert.deepEqual(
    uploads.map((args) => args.slice(2, 6)),
    [
      [0, 0, 4, 1],
      [0, 1, 2, 1],
    ],
  );
  assert.deepEqual(
    uploads.flatMap((args) => [...args[8]]),
    [...source.positions],
  );
  assert.deepEqual(gl.pixelStore, before);
  assert.deepEqual(gl.of("viewport").at(-1), [20, 360, 400, 200]);
  assert.deepEqual(gl.of("drawArrays").at(-1), [gl.TRIANGLE_STRIP, 0, 12]);
  assert.equal(renderer.stats.uploadedBytes, 48);
  renderer.beginFrame();
  renderer.draw(source, rect, 2);
  renderer.endFrame();
  assert.equal(
    renderer.stats.uploads,
    1,
    "unchanged data must reuse its resident texture",
  );
  assert.equal(renderer.stats.submittedSamples, 6);
  renderer.dispose();
});

test("texture append updates only the revised tail; growth and a broken revision chain upload full source", () => {
  const gl = new RecordingLineGL(),
    renderer = new TextureLineRenderer(context(gl));
  renderer.draw(packet(), rect, 1);
  gl.calls.length = 0;
  renderer.draw(
    packet({
      revision: 2,
      previousRevision: 1,
      updateFrom: 5,
      count: 8,
      positions: positions(8),
    }),
    rect,
    1,
  );
  assert.deepEqual(
    gl.of("texSubImage2D").map((args) => args.slice(2, 6)),
    [[1, 1, 3, 1]],
  );
  assert.equal(renderer.stats.uploadedBytes, 72);
  assert.equal(gl.of("texStorage2D").length, 0);
  gl.calls.length = 0;
  renderer.draw(
    packet({
      revision: 3,
      previousRevision: 2,
      updateFrom: 7,
      count: 9,
      positions: positions(9),
    }),
    rect,
    1,
  );
  assert.deepEqual(gl.of("texStorage2D")[0]!.slice(-2), [4, 4]);
  assert.equal(gl.of("deleteTexture").length, 1);
  assert.equal(
    gl.of("texSubImage2D").reduce((n, args) => n + args[8].length / 2, 0),
    9,
  );
  gl.calls.length = 0;
  renderer.draw(
    packet({ revision: 4, previousRevision: 0, updateFrom: 5 }),
    rect,
    1,
  );
  assert.deepEqual(
    gl.of("texSubImage2D").flatMap((args) => [...args[8]]),
    [...positions(6)],
  );
  renderer.dispose();
});

test("a failed texture upload restores pixel-store state and can be retried without publishing a cached revision", () => {
  const gl = new RecordingLineGL(),
    renderer = new TextureLineRenderer(context(gl)),
    before = new Map(gl.pixelStore);
  gl.throwOn = "texSubImage2D";
  assert.throws(() => renderer.draw(packet(), rect, 1), /Injected/);
  assert.deepEqual(gl.pixelStore, before);
  assert.equal(renderer.stats.uploads, 0);
  gl.throwOn = undefined;
  gl.calls.length = 0;
  renderer.draw(packet(), rect, 1);
  assert.equal(
    gl.of("texSubImage2D").flatMap((args) => [...args[8]]).length,
    12,
  );
  assert.equal(renderer.stats.uploads, 1);
  renderer.dispose();
});

test("texture admission rejects unsupported packets, skips empty/transparent selections and validates explicit ranges", () => {
  const gl = new RecordingLineGL(),
    renderer = new TextureLineRenderer(context(gl));
  for (const changes of [
    { strictlyMonotonicX: false },
    { mode: "points" },
    { dimensions: 3 },
    { count: 1 },
    { count: 17, positions: positions(17) },
    { thickness: 0 },
    { colors: new Float32Array(24) },
    { dashPattern: [1, 1] },
    { positions: new Float32Array(2) },
  ] as Partial<DrawPacket>[]) {
    assert.equal(renderer.draw(packet(changes), rect, 1), false);
  }
  gl.lost = true;
  assert.equal(renderer.draw(packet(), rect, 1), false);
  gl.lost = false;
  for (const range of [
    { first: -1, count: 2 },
    { first: 0, count: 7 },
    { first: 0.5, count: 2 },
    { first: 0, count: -1 },
  ]) {
    assert.throws(() => renderer.draw(packet(), rect, 1, range), RangeError);
  }
  assert.equal(renderer.draw(packet(), rect, 1, { first: 1, count: 1 }), true);
  assert.equal(renderer.draw(packet({ color: [1, 0, 0, 0] }), rect, 1), true);
  assert.equal(gl.of("createTexture").length, 0);
  renderer.dispose();
});

test("texture frame eviction, context restoration and repeated disposal release owned resources", () => {
  const gl = new RecordingLineGL(),
    renderer = new TextureLineRenderer(context(gl));
  renderer.beginFrame();
  renderer.draw(packet(), rect, 1);
  renderer.draw(packet({ id: 2 }), rect, 1);
  renderer.endFrame();
  renderer.beginFrame();
  renderer.draw(packet({ id: 2 }), rect, 1);
  renderer.endFrame();
  assert.equal(gl.of("deleteTexture").length, 1);
  renderer.restoreContext();
  renderer.draw(packet({ id: 2 }), rect, 1);
  assert.equal(
    renderer.stats.uploads,
    3,
    "restored contexts cannot reuse invalid textures",
  );
  renderer.dispose();
  const count = gl.calls.length;
  renderer.dispose();
  renderer.restoreContext();
  assert.equal(gl.calls.length, count);
  assert.equal(renderer.draw(packet(), rect, 1), false);
});

test("offset cache reuses panned geometry, recomputes append halos and invalidates changed scales", () => {
  const gl = new RecordingLineGL(),
    cache = new LineOffsetCache(context(gl), { directionMode: "relative" });
  const first = cache.update(packet(), rect, 1, layout);
  assert.equal(first.computedFrom, 0);
  assert.equal(first.computedCount, 6);
  assert.equal(cache.stats.residentAllocatedBytes, 256);
  cache.beginFrame();
  const panned = cache.update(
    packet({
      domain: { x: { start: 1005, end: 1015 }, y: { start: 20, end: 30 } },
    }),
    rect,
    1,
    layout,
  );
  assert.equal(panned.reused, true);
  assert.equal(cache.stats.computations, 0);
  assert.equal(cache.stats.cacheHits, 1);
  const appended = cache.update(
    packet({
      revision: 2,
      previousRevision: 1,
      updateFrom: 5,
      count: 8,
      positions: positions(8),
    }),
    rect,
    1,
    layout,
  );
  assert.equal(appended.buffer, first.buffer);
  assert.equal(appended.computedFrom, 4);
  assert.equal(appended.computedCount, 4);
  assert.deepEqual(gl.of("bindBufferRange").at(-1)!.slice(-2), [64, 64]);
  const scaled = cache.update(
    packet({
      revision: 3,
      previousRevision: 2,
      updateFrom: 7,
      count: 9,
      positions: positions(9),
    }),
    rect,
    2,
    layout,
  );
  assert.equal(scaled.computedFrom, 0);
  assert.equal(scaled.computedCount, 9);
  const grown = cache.update(
    packet({
      revision: 4,
      previousRevision: 3,
      updateFrom: 8,
      count: 20,
      positions: positions(20),
    }),
    rect,
    2,
    layout,
  );
  assert.equal(grown.computedFrom, 0);
  assert.equal(cache.stats.residentAllocatedBytes, 512);
  cache.beginFrame();
  cache.endFrame();
  assert.equal(cache.stats.residentAllocatedBytes, 0);
  cache.dispose();
});

test("offset transform-feedback failures always restore bindings and retry the uncommitted computation", () => {
  for (const failure of ["beginTransformFeedback", "drawArrays"]) {
    const gl = new RecordingLineGL(),
      cache = new LineOffsetCache(context(gl));
    gl.throwOn = failure;
    assert.throws(() => cache.update(packet(), rect, 1, layout), /Injected/);
    assert.equal(
      gl.of("endTransformFeedback").length,
      failure === "drawArrays" ? 1 : 0,
    );
    assert.deepEqual(gl.of("disable").at(-1), [gl.RASTERIZER_DISCARD]);
    assert.deepEqual(gl.of("bindBufferBase").at(-1), [
      gl.TRANSFORM_FEEDBACK_BUFFER,
      0,
      null,
    ]);
    assert.deepEqual(gl.of("bindTransformFeedback").at(-1), [
      gl.TRANSFORM_FEEDBACK,
      null,
    ]);
    assert.deepEqual(gl.of("bindVertexArray").at(-1), [null]);
    assert.equal(cache.stats.computations, 0);
    gl.throwOn = undefined;
    assert.equal(cache.update(packet(), rect, 1, layout).reused, false);
    cache.dispose();
  }
});

test("offset inputs validate source layout, scale and lifecycle before GPU computation", () => {
  const gl = new RecordingLineGL(),
    cache = new LineOffsetCache(context(gl));
  for (const changes of [
    { mode: "points" },
    { dimensions: 3 },
    { strictlyMonotonicX: false },
    { colors: new Float32Array(24) },
    { dashPattern: [1, 1] },
  ] as Partial<DrawPacket>[]) {
    assert.throws(
      () => cache.update(packet(changes), rect, 1, layout),
      TypeError,
    );
  }
  for (const changes of [
    { count: 0 },
    { count: 1.5 },
    { thickness: 0 },
    { domain: { x: { start: 0, end: 0 }, y: { start: 0, end: 1 } } },
  ]) {
    assert.throws(
      () => cache.update(packet(changes), rect, 1, layout),
      RangeError,
    );
  }
  for (const changes of [
    { strideBytes: 4 },
    { strideBytes: 10 },
    { centerOffsetBytes: 0 },
    { centerOffsetBytes: 9 },
  ]) {
    assert.throws(
      () => cache.update(packet(), rect, 1, { ...layout, ...changes }),
      RangeError,
    );
  }
  assert.throws(
    () => cache.update(packet(), rect, Infinity, layout),
    RangeError,
  );
  gl.lost = true;
  assert.throws(
    () => cache.update(packet(), rect, 1, layout),
    /context is lost/,
  );
  gl.lost = false;
  cache.update(packet(), rect, 1, layout);
  cache.restoreContext();
  assert.equal(cache.stats.residentAllocatedBytes, 0);
  assert.equal(cache.update(packet(), rect, 1, layout).reused, false);
  cache.dispose();
  const count = gl.calls.length;
  cache.dispose();
  cache.restoreContext();
  assert.equal(gl.calls.length, count);
  assert.throws(() => cache.update(packet(), rect, 1, layout), /disposed/);
});

for (const [name, create] of [
  ["texture", (gl: RecordingLineGL) => new TextureLineRenderer(context(gl))],
  ["offset", (gl: RecordingLineGL) => new LineOffsetCache(context(gl))],
] as const) {
  for (const failure of [
    "createProgram",
    "createShader",
    "compile",
    "link",
    "createVertexArray",
    ...(name === "offset" ? ["createTransformFeedback"] : []),
  ]) {
    test(`${name} initialization cleans up partial GPU allocations after ${failure} failure`, () => {
      const gl = new RecordingLineGL();
      gl.failure = failure;
      assert.throws(() => create(gl));
      assert.ok(
        gl.created.every((value) => gl.deleted.has(value)),
        "failed initialization must release every allocated object",
      );
    });
  }
}

test("failed texture and offset storage allocations can be retried", () => {
  const gl = new RecordingLineGL(),
    renderer = new TextureLineRenderer(context(gl)),
    cache = new LineOffsetCache(context(gl));
  gl.failure = "createTexture";
  assert.throws(() => renderer.draw(packet(), rect, 1), /allocation failed/);
  gl.failure = "createBuffer";
  assert.throws(
    () => cache.update(packet(), rect, 1, layout),
    /allocation failed/,
  );
  gl.failure = undefined;
  assert.equal(renderer.draw(packet(), rect, 1), true);
  assert.equal(cache.update(packet(), rect, 1, layout).computedCount, 6);
  renderer.dispose();
  cache.dispose();
});
