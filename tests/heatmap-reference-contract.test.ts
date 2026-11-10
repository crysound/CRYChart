import test from 'node:test';
import assert from 'node:assert/strict';
import { ChartXY } from '../src/chart.js';

test('omitted dataOrder follows the public column default for full and partial numeric matrices', () => {
  const chart = new ChartXY(), heat = chart.addHeatmapGridSeries({ columns: 4, rows: 3 });
  try {
    assert.equal(heat.dataOrder, 'columns');
    const columns = [[-0, -10, 8], [1, 5, 9], [NaN, 6, 10], [3, 7, 12]];
    assert.equal(heat.invalidateIntensityValues(columns), heat);
    assert.deepEqual([...heat.data], [-0, 1, NaN, 3, -10, 5, 6, 7, 8, 9, 10, 12]);
    heat.invalidateIntensityValues({ iColumn: 1, iRow: 0, values: [Float64Array.from([101, 201, 301]), Float32Array.from([102, 202, 302])] });
    assert.deepEqual([...heat.data], [-0, 101, 102, 3, -10, 201, 202, 7, 8, 301, 302, 12]);
    assert.deepEqual(columns, [[-0, -10, 8], [1, 5, 9], [NaN, 6, 10], [3, 7, 12]]);
  } finally { chart.dispose(); }
});

test('column-oriented rectangular writes update only their declared cells and upload bounds', () => {
  const chart = new ChartXY(), heat = chart.addHeatmapGridSeries({ columns: 4, rows: 3, dataOrder: 'columns' });
  heat.invalidateIntensityValues([[0, -10, 8], [1, 5, 9], [NaN, 6, 10], [3, 7, 12]]);
  heat.acknowledgeDataRevision(heat.dataRevision);
  heat.invalidateIntensityValues({ iColumn: 1, iRow: 0, values: [[101, 201, 301], [102, 202, 302]] });
  assert.deepEqual([...heat.data], [0, 101, 102, 3, -10, 201, 202, 7, 8, 301, 302, 12]);
  assert.deepEqual(heat.dataUpdate, { x: 1, y: 0, width: 2, height: 3, previousRevision: 1 });
  const before = heat.data.slice(), revision = heat.dataRevision;
  assert.throws(() => heat.invalidateIntensityValues({ iColumn: 3, iRow: 0, values: [[1], [2]] }), /rectangular range/);
  assert.deepEqual(heat.data, before); assert.equal(heat.dataRevision, revision);
  chart.dispose();
});

test('flat full and partial inputs obey dataOrder, preserve NaN/zero, and reject malformed shapes atomically', () => {
  for (const dataOrder of ['rows', 'columns']) {
    const chart = new ChartXY(), heat = chart.addHeatmapGridSeries({ columns: 4, rows: 3, dataOrder });
    const full = dataOrder === 'rows' ? [0, 1, NaN, 3, -10, 5, 6, 7, 8, 9, 10, 12] : [0, -10, 8, 1, 5, 9, NaN, 6, 10, 3, 7, 12];
    heat.invalidateIntensityValues(Float32Array.from(full));
    assert.deepEqual([...heat.data], [0, 1, NaN, 3, -10, 5, 6, 7, 8, 9, 10, 12]);
    heat.invalidateIntensityValues({ iColumn: 1, iRow: 1, columns: 2, rows: 2, values: Float32Array.from(dataOrder === 'rows' ? [11, 12, 21, 22] : [11, 21, 12, 22]) });
    assert.deepEqual([...heat.data], [0, 1, NaN, 3, -10, 11, 12, 7, 8, 21, 22, 12]);
    const before = heat.data.slice(), revision = heat.dataRevision;
    assert.throws(() => heat.invalidateIntensityValues({ iColumn: 0, iRow: 0, columns: 2, rows: 2, values: [1, 2, 3] }), /rectangular range/);
    assert.deepEqual(heat.data, before); assert.equal(heat.dataRevision, revision);
    chart.dispose();
  }
});

test('explicit grid end controls step while preserving the requested step for reset', () => {
  const chart = new ChartXY(), heat = chart.addHeatmapGridSeries({ columns: 4, rows: 3 });
  heat.setStart({ x: 10, y: 20 }).setStep({ x: 2, y: 3 });
  assert.deepEqual(heat.getEnd(), { x: 18, y: 29 });
  assert.equal(heat.setEnd({ x: 30, y: 50 }), heat);
  assert.deepEqual(heat.getStep(), { x: 5, y: 10 });
  heat.setStart(undefined).setStep(undefined);
  assert.deepEqual(heat.getStep(), { x: 7.5, y: 50 / 3 });
  heat.setStep({ x: 2, y: 3 });
  assert.deepEqual(heat.getEnd(), { x: 30, y: 50 });
  assert.deepEqual(heat.getStep(), { x: 7.5, y: 50 / 3 });
  heat.setEnd(undefined);
  assert.deepEqual(heat.getStep(), { x: 2, y: 3 });
  assert.deepEqual(heat.getEnd(), { x: 8, y: 9 });
  heat.setStep(undefined).setEnd({ x: 40, y: 30 }).setStart({ x: 4, y: 6 });
  assert.deepEqual(heat.getStep(), { x: 9, y: 8 });
  const start = heat.getStart(); start.x = 999;
  assert.deepEqual(heat.getStart(), { x: 4, y: 6 });
  chart.dispose();
});

for (const dataOrder of [undefined, 'rows', 'columns']) {
  test(`malformed full replacements preserve every cell and pending update for ${dataOrder ?? 'default'} order`, () => {
    const chart = new ChartXY(), heat = chart.addHeatmapGridSeries({ columns: 4, rows: 3, ...(dataOrder ? { dataOrder } : {}) });
    try {
      const columnOrder = dataOrder !== 'rows', outer = columnOrder ? 4 : 3, inner = columnOrder ? 3 : 4;
      heat.invalidateIntensityValues(Array.from({ length: outer }, (_, a) => Array.from({ length: inner }, (_, b) => a * 10 + b)));
      heat.acknowledgeDataRevision(heat.dataRevision);
      heat.invalidateIntensityValues({ iColumn: 1, iRow: 1, values: [[-0]] });
      const beforeBytes = new Uint8Array(heat.data.buffer).slice(), beforeBuffer = heat.data,
        revision = heat.revision, dataRevision = heat.dataRevision, update = heat.dataUpdate;
      let invalidations = 0; chart.invalidate = () => { invalidations++; };
      const valid = () => Array.from({ length: outer }, () => Array(inner).fill(999));
      const invalid: Array<{ name: string; make: () => any }> = [
        { name: 'long outer', make: () => [...valid(), Array(inner).fill(999)] },
        { name: 'ragged first', make: () => { const a = valid(); a[0]!.pop(); return a; } },
        { name: 'ragged last', make: () => { const a = valid(); a[outer - 1]!.pop(); return a; } },
        { name: 'null first', make: () => { const a: any = valid(); a[0] = null; return a; } },
        { name: 'null last', make: () => { const a: any = valid(); a[outer - 1] = null; return a; } },
        { name: 'missing outer vector', make: () => { const a = valid(); delete a[1]; return a; } },
        { name: 'missing scalar', make: () => { const a = valid(); delete a[outer - 1]![inner - 1]; return a; } },
        { name: 'late getter throws', make: () => { const a = valid(); Object.defineProperty(a[outer - 1], inner - 1, { get() { throw new Error('late input getter'); } }); return a; } },
        { name: 'flat short', make: () => new Float32Array(11) },
        { name: 'flat long', make: () => new Float64Array(13) },
        { name: 'flat late getter throws', make: () => { const a = Array(12).fill(999); Object.defineProperty(a, 11, { get() { throw new Error('late input getter'); } }); return a; } },
        { name: 'flat non-number', make: () => [...Array(11).fill(999), 'invalid'] },
        { name: 'null input', make: () => null },
        { name: 'undefined input', make: () => undefined },
      ];
      for (const item of invalid) {
        assert.throws(() => heat.invalidateIntensityValues(item.make()), item.name);
        assert.deepEqual(new Uint8Array(heat.data.buffer), beforeBytes, item.name);
        assert.equal(heat.data, beforeBuffer); assert.equal(heat.revision, revision); assert.equal(heat.dataRevision, dataRevision);
        assert.equal(heat.dataUpdate, update); assert.equal(invalidations, 0);
      }
    } finally { chart.dispose(); }
  });
}

test('a bounded rectangular matrix is an atomic origin-prefix patch, while empty matrices are no-ops', () => {
  for (const dataOrder of [undefined, 'rows', 'columns']) {
    const chart = new ChartXY(), heat = chart.addHeatmapGridSeries({ columns: 4, rows: 3, ...(dataOrder ? { dataOrder } : {}) });
    try {
      const columnOrder = dataOrder !== 'rows';
      heat.invalidateIntensityValues(new Float32Array(12).fill(3)); heat.acknowledgeDataRevision(heat.dataRevision);
      heat.invalidateIntensityValues(columnOrder ? [[101, 201], [102, 202]] : [[101, 102], [201, 202]]);
      assert.deepEqual([...heat.data], [101, 102, 3, 3, 201, 202, 3, 3, 3, 3, 3, 3]);
      assert.deepEqual(heat.dataUpdate, { x: 0, y: 0, width: 2, height: 2, previousRevision: 1 });
      const before = heat.data.slice(), revision = heat.revision, dataRevision = heat.dataRevision, update = heat.dataUpdate;
      let invalidations = 0; chart.invalidate = () => { invalidations++; };
      for (const value of [[], [[]], [[], []], { iColumn: 0, iRow: 0, values: [] }, { iColumn: 0, iRow: 0, values: [[]] }]) {
        assert.equal(heat.invalidateIntensityValues(value), heat); assert.deepEqual(heat.data, before);
        assert.equal(heat.revision, revision); assert.equal(heat.dataRevision, dataRevision); assert.equal(heat.dataUpdate, update); assert.equal(invalidations, 0);
      }
      const full = Array.from({ length: columnOrder ? 4 : 3 }, () => Array(columnOrder ? 3 : 4).fill(7));
      heat.invalidateIntensityValues(full); assert.equal(heat.dataUpdate, undefined); assert.deepEqual([...heat.data], Array(12).fill(7));
    } finally { chart.dispose(); }
  }
});

test('partial throwing getters and ragged matrices cannot change cells or upload metadata', () => {
  for (const dataOrder of ['rows', 'columns']) {
    const chart = new ChartXY(), heat = chart.addHeatmapGridSeries({ columns: 4, rows: 3, dataOrder });
    try {
      heat.invalidateIntensityValues(new Float32Array(12).fill(2)); heat.acknowledgeDataRevision(heat.dataRevision);
      const before = heat.data.slice(), revision = heat.dataRevision;
      const nested = [[101, 102], [201, 202]];
      Object.defineProperty(nested[1], 1, { get() { throw new Error('partial getter'); } });
      assert.throws(() => heat.invalidateIntensityValues({ iColumn: 1, iRow: 1, values: nested }), /partial getter/);
      const flat = [101, 102, 201, 202];
      Object.defineProperty(flat, 3, { get() { throw new Error('partial getter'); } });
      assert.throws(() => heat.invalidateIntensityValues({ iColumn: 1, iRow: 1, columns: 2, rows: 2, values: flat }), /partial getter/);
      assert.throws(() => heat.invalidateIntensityValues({ iColumn: 1, iRow: 1, values: [[1, 2], [3]] }), /rectangular range/);
      assert.deepEqual(heat.data, before); assert.equal(heat.dataRevision, revision); assert.equal(heat.dataUpdate, undefined);
    } finally { chart.dispose(); }
  }
});

test('a column-major replacement snapshots an aliased input before transposing it', () => {
  const chart = new ChartXY(), heat = chart.addHeatmapGridSeries({ columns: 4, rows: 3 });
  try {
    heat.invalidateIntensityValues(Float32Array.from({ length: 12 }, (_, i) => i));
    const previous = [...heat.data];
    heat.invalidateIntensityValues(heat.data);
    const expected = Array.from({ length: 12 }, (_, index) => previous[(index % 4) * 3 + Math.floor(index / 4)]);
    assert.deepEqual([...heat.data], expected);
  } finally { chart.dispose(); }
});
