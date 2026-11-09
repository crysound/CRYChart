import test from 'node:test';
import assert from 'node:assert/strict';
import { covarianceEllipse, ecg, fiveNumberSummary, heatField, histogram, random, spectrum, steps, waveform } from '../examples/signals';

test('FFT recovers the independently specified amplitude and frequency of two tones', () => {
  const sampleRate = 1024;
  const samples = Float64Array.from({ length: 1024 }, (_, i) => 1.25 * Math.sin(2 * Math.PI * 64 * i / sampleRate) + 0.4 * Math.cos(2 * Math.PI * 192 * i / sampleRate));
  const result = spectrum(samples, sampleRate);
  assert.equal(result.length, 513);
  assert.equal(result[64].x, 64);
  assert.ok(Math.abs(result[64].y - 1.25) < 1e-10);
  assert.ok(Math.abs(result[192].y - 0.4) < 1e-10);
  const leakage = result.filter((_, i) => i !== 64 && i !== 192).reduce((sum, point) => sum + point.y, 0);
  assert.ok(leakage < 1e-10);
});

test('DC and Nyquist spectrum bins are not incorrectly doubled', () => {
  const dc = spectrum(new Float64Array(16).fill(2), 16);
  assert.equal(dc[0].y, 2);
  const nyquist = spectrum(Float64Array.from({ length: 16 }, (_, i) => i % 2 ? -3 : 3), 16);
  assert.equal(nyquist[8].y, 3);
  assert.throws(() => spectrum([1, 2, 3], 10), RangeError);
  assert.throws(() => spectrum([1, 2, 3, 4], 0), RangeError);
});

test('histogram counts both endpoints once and excludes invalid and out-of-range values', () => {
  const bins = histogram([-1, 0, 0.5, 1, 2, 3, 4, 5, NaN, Infinity], 4, 0, 4);
  assert.deepEqual(bins.map(bin => bin.value), [2, 1, 1, 2]);
  assert.equal(bins.reduce((count, bin) => count + bin.value, 0), 6);
  assert.throws(() => histogram([0], 0, 0, 1), RangeError);
});

test('synthetic waveform preserves sample time when generated in separate chunks', () => {
  const whole = waveform(20, 1000, 37, 2);
  const chunks = [...waveform(7, 1000, 37, 2), ...waveform(13, 1000, 37, 2, 7)];
  assert.deepEqual(chunks, whole);
  assert.equal(whole[19].x, 0.019);
  assert.throws(() => waveform(10, 0, 2), RangeError);
});

test('synthetic fixtures are reproducible, finite and exhibit nonconstant measurements', () => {
  const a = random(91), b = random(91);
  for (let i = 0; i < 30; i++) { const value = a(); assert.equal(value, b()); assert.ok(value >= 0 && value < 1); }
  const matrix = heatField(24, 16, 0.7);
  assert.equal(matrix.length, 16); assert.ok(matrix.every(row => row.length === 24));
  assert.ok(matrix.flat().every(value => Number.isFinite(value) && value >= 0 && value <= 1));
  assert.notDeepEqual(matrix, heatField(24, 16, 1.5));
  const beatPeriod = 60 / 72;
  assert.ok(Math.abs(ecg(0.123) - ecg(0.123 + beatPeriod)) < 1e-12);
  assert.ok(ecg(beatPeriod * 0.37) > ecg(beatPeriod * 0.1) + 0.8);
});

test('step interpolation distinguishes transition positions without changing endpoint samples', () => {
  const input = [{ x: 0, y: 2 }, { x: 4, y: 5 }];
  assert.deepEqual(steps(input, 'before'), [{ x: 0, y: 2 }, { x: 0, y: 5 }, { x: 4, y: 5 }]);
  assert.deepEqual(steps(input, 'after'), [{ x: 0, y: 2 }, { x: 4, y: 2 }, { x: 4, y: 5 }]);
  assert.deepEqual(steps(input, 'middle'), [{ x: 0, y: 2 }, { x: 2, y: 2 }, { x: 2, y: 5 }, { x: 4, y: 5 }]);
  assert.deepEqual(input, [{ x: 0, y: 2 }, { x: 4, y: 5 }]);
});

test('covariance ellipse matches a known centered diagonal covariance and closes the path', () => {
  const points = [{ x: -2, y: 0 }, { x: 2, y: 0 }, { x: 0, y: -1 }, { x: 0, y: 1 }];
  const curve = covarianceEllipse(points, 2, 4);
  assert.ok(Math.abs(curve[0].x - 2 * Math.sqrt(8 / 3)) < 1e-12);
  assert.ok(Math.abs(curve[1].y - 2 * Math.sqrt(2 / 3)) < 1e-12);
  assert.ok(Math.abs(curve[0].x - curve[4].x) < 1e-12);
  assert.ok(Math.abs(curve[0].y - curve[4].y) < 1e-12);
  assert.throws(() => covarianceEllipse([{ x: 1, y: 1 }], 2), RangeError);
});

test('five-number summary uses finite samples, interpolates quartiles and does not mutate input', () => {
  const values = [9, 1, 8, 2, 7, 3, 6, 4, 5, NaN];
  assert.deepEqual(fiveNumberSummary(values), { min: 1, lowerQuartile: 3, median: 5, upperQuartile: 7, max: 9 });
  assert.deepEqual(fiveNumberSummary([0, 10]), { min: 0, lowerQuartile: 2.5, median: 5, upperQuartile: 7.5, max: 10 });
  assert.equal(values[0], 9);
  assert.throws(() => fiveNumberSummary([NaN]), RangeError);
});
