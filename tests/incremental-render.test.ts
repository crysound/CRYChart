import test from "node:test";
import assert from "node:assert/strict";
import { ChartXY } from "../src/chart.js";
import { DataSetXY } from "../src/core/data.js";

test("sequential appends project only the tail and preserve GPU origin and storage", () => {
  const c = new ChartXY(),
    s = c.addLineSeries();
  s.addArraysXY(
    new Float64Array([1e12, 1e12 + 0.25]),
    new Float64Array([1, 2]),
  );
  const first = s.drawPacket();
  s.add({ x: 1e12 + 0.5, y: 3 });
  const next = s.drawPacket();
  assert.equal(next.updateFrom, 2);
  assert.equal(next.previousRevision, first.revision);
  assert.equal(next.positions.buffer, first.positions.buffer);
  assert.deepEqual([...next.positions], [0, 0, 0.25, 1, 0.5, 2]);
  assert.deepEqual(next.origin, first.origin);
  c.dispose();
});

test("clear/replay, wrapped retention and equal-revision dataset rebinding force complete projection", () => {
  const c = new ChartXY(),
    s = c.addLineSeries().setMaxSampleCount(3);
  s.add([
    { x: 0, y: 0 },
    { x: 1, y: 1 },
    { x: 2, y: 2 },
  ]);
  s.drawPacket();
  s.add({ x: 3, y: 3 });
  let p = s.drawPacket();
  assert.equal(p.updateFrom, undefined);
  assert.equal(p.origin.x, 1);
  assert.deepEqual([...p.positions], [0, 0, 1, 1, 2, 2]);
  s.clear().add([
    { x: 10, y: 4 },
    { x: 11, y: 5 },
  ]);
  p = s.drawPacket();
  assert.equal(p.updateFrom, undefined);
  assert.equal(p.origin.x, 10);
  const d = new DataSetXY({schema:{xValues:{storage:Float64Array},yValues:{storage:Float64Array}}}).appendSamples({ xValues: [20, 21], yValues: [6, 8] });
  s.setDataSet(d);
  p = s.drawPacket();
  assert.equal(p.updateFrom, undefined);
  assert.equal(p.origin.x, 20);
  assert.deepEqual([...p.positions], [0, 0, 1, 2]);
  c.dispose();
});

test("capacity growth preserves projected history and logical counts", () => {
  const c = new ChartXY(),
    s = c
      .addLineSeries()
      .add(Array.from({ length: 250 }, (_, i) => ({ x: i, y: 2 * i })));
  const first = s.drawPacket();
  s.add(Array.from({ length: 40 }, (_, i) => ({ x: 250 + i, y: 500 + 2 * i })));
  const next = s.drawPacket();
  assert.equal(next.updateFrom, 250);
  assert.notEqual(next.positions.buffer, first.positions.buffer);
  assert.equal(next.count, 290);
  for (let i = 0; i < 290; i++) {
    assert.equal(next.positions[i * 2], i);
    assert.equal(next.positions[i * 2 + 1], i * 2);
  }
  c.dispose();
});
