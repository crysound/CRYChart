import test from 'node:test';
import assert from 'node:assert/strict';
import {lineDirectionOracle} from '../src/render-line-direction.js';

const size = [800, 420] as const;

test('Float64 line oracle preserves thickness and independent endpoint caps', () => {
  const middle = lineDirectionOracle([0, 0], [1, 0], [2, 0], [2, 2], size, 2);
  assert.deepEqual(middle, [0, -4 / 420, 0, 4 / 420]);
  const first = lineDirectionOracle([0, 0], [0, 0], [1, 0], [2, 2], size, 2);
  assert.deepEqual(first, [-4 / 800, -4 / 420, -4 / 800, 4 / 420]);
  const last = lineDirectionOracle([0, 0], [1, 0], [1, 0], [2, 2], size, 2);
  assert.deepEqual(last, [4 / 800, -4 / 420, 4 / 800, 4 / 420]);
});

test('Float64 line oracle treats nonfinite neighbors as independent gap endpoints', () => {
  assert.deepEqual(lineDirectionOracle([0, NaN], [1, 0], [2, 0], [2, 2], size, 2),
    lineDirectionOracle([1, 0], [1, 0], [2, 0], [2, 2], size, 2));
  assert.deepEqual(lineDirectionOracle([0, 0], [1, Infinity], [2, 0], [2, 2], size, 2), [0, 0, 0, 0]);
});

test('Float64 line directions are translation independent for exactly representable epoch increments', () => {
  const ordinary = lineDirectionOracle([0, .125], [.25, .5], [.5, -.25], [8, 2], size, 2);
  const epoch = 1700000000000;
  const translated = lineDirectionOracle([epoch, 1024.125], [epoch + .25, 1024.5], [epoch + .5, 1023.75], [8, 2], size, 2);
  assert.deepEqual(translated, ordinary);
});

test('Float64 oracle handles reversed axes, disparate units, and capped acute miters', () => {
  for (const span of [[1e8, 1e-6], [-1e8, 1e-6], [1e8, -1e-6]] as const) {
    const offsets = lineDirectionOracle([0, 0], [100000, 1e-6], [200000, -1e-6], span, size, 2);
    assert.ok(offsets.every(Number.isFinite));
    assert.ok(Math.abs(offsets[0]) <= 16 / 800);
    assert.ok(Math.abs(offsets[1]) <= 16 / 420);
  }
  assert.throws(() => lineDirectionOracle([0, 0], [1, 1], [2, 0], [0, 1], size, 2), /nonzero spans/);
});
