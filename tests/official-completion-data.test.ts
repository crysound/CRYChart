import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { trailingMean, percentile, capacityForecast, stackColumns, sweptValues, symlogSegments, parseDiamonds } from '../examples/official/completion-data';

test('trailing mean uses only the current finite window and responds to corrected source values', () => {
  assert.deepEqual(trailingMean([1, 3, NaN, 9, 12], 3), [1, 2, 2, 6, 10.5]);
  const model = capacityForecast(10), before = model.derive(); model.rows[4].actual += 70; const after = model.derive();
  for (let i = 0; i < 10; i++) assert.ok(Math.abs((after.sma[i] - before.sma[i]) - (i >= 4 ? 70 / Math.min(7, i + 1) : 0)) < 1e-9);
});
test('quantiles and cumulative ranges match independently calculated values', () => {
  assert.equal(percentile([10, 40, 20, 30], .5), 25); assert.equal(percentile([10, 40, 20, 30], .1), 13);
  assert.deepEqual(stackColumns([[1, 3], [4, 5]]), { layers: [[{ low: 0, high: 1 }, { low: 0, high: 3 }], [{ low: 1, high: 5 }, { low: 3, high: 8 }]], totals: [5, 8] });
});
test('sweeping wrap retains real sample indices and leaves a moving gap', () => {
  const values = sweptValues(13, 8, x => x * 2, 2);
  assert.deepEqual(values.slice(0, 5), [16, 18, 20, 22, 24]); assert.ok(Number.isNaN(values[5]) && Number.isNaN(values[6])); assert.equal(values[7], 14);
});
test('piecewise symlog crosses zero without joining unrelated logarithmic spans', () => {
  const parts = symlogSegments([{ x: 0, y: -20 }, { x: 4, y: 20 }], 10);
  assert.deepEqual(parts.negative, [{ x: 0, y: 20 }, { x: 1, y: 10 }]);
  assert.deepEqual(parts.linear, [{ x: 1, y: -10 }, { x: 3, y: 10 }]);
  assert.deepEqual(parts.positive, [{ x: 3, y: 10 }, { x: 4, y: 20 }]);
});
test('diamond loader reads the named data fields and rejects unsupported categories', () => {
  assert.deepEqual(parseDiamonds('price,clarity,carat\n123,IF,0.5'), [{ x: .5, y: 123, value: 7, clarity: 'IF' }]);
  assert.throws(() => parseDiamonds('price,clarity,carat\n123,unknown,0.5'));
  const actual = parseDiamonds(readFileSync('examples/data/diamonds.csv', 'utf8'));
  assert.equal(actual.length, 53940);
  assert.deepEqual(actual[0], { x: .23, y: 326, value: 1, clarity: 'SI2' });
  assert.equal(actual.reduce((sum, row) => sum + row.y, 0), 212135217);
});
