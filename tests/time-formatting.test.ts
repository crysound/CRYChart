import test from 'node:test';
import assert from 'node:assert/strict';
import { formatTime, formatTimeDefault, timePrecisionForRange, TimeFormattingFunctions } from '../src/time-formatting.js';

test('public Time formatters preserve duration sign, all hours, and requested digit groups', () => {
  const cases = [
    [0, ['00:00:00', '00:00:00.000', '00:00:00.000000', '00:00:00.000000000']],
    [-0, ['00:00:00', '00:00:00.000', '00:00:00.000000', '00:00:00.000000000']],
    [90061001, ['25:01:01', '25:01:01.001', '25:01:01.001000', '25:01:01.001000000']],
    [-90061001, ['-25:01:01', '-25:01:01.001', '-25:01:01.001000', '-25:01:01.001000000']],
    [.12567891234567, ['00:00:00', '00:00:00.000', '00:00:00.000126', '00:00:00.000125679']],
    [-45, ['-00:00:00', '-00:00:00.045', '-00:00:00.045000', '-00:00:00.045000000']],
  ] as const;
  for (const [value, expected] of cases) assert.deepEqual(Object.values(TimeFormattingFunctions).map(fn => fn(value)), expected);
});

test('second and millisecond modes omit smaller units while fine modes round the last unit', () => {
  assert.equal(TimeFormattingFunctions.hhmmss(1999.9999), '00:00:01');
  assert.equal(TimeFormattingFunctions.hhmmssmmm(1.9999), '00:00:00.001');
  assert.equal(TimeFormattingFunctions.hhmmssmmmuuu(.0004999), '00:00:00.000000');
  assert.equal(TimeFormattingFunctions.hhmmssmmmuuu(.0005), '00:00:00.000001');
  assert.equal(TimeFormattingFunctions.hhmmssmmmuuunnn(.00000049), '00:00:00.000000000');
  assert.equal(TimeFormattingFunctions.hhmmssmmmuuunnn(.0000005), '00:00:00.000000001');
  assert.equal(TimeFormattingFunctions.hhmmssmmmuuunnn(-.0000005), '-00:00:00.000000001');
});

test('rounding carries into milliseconds, seconds, minutes and unbounded hours', () => {
  // Expected carries follow duration arithmetic across each unit boundary.
  assert.equal(TimeFormattingFunctions.hhmmssmmmuuu(.9999), '00:00:00.001000');
  assert.equal(TimeFormattingFunctions.hhmmssmmmuuu(999.9999), '00:00:01.000000');
  assert.equal(TimeFormattingFunctions.hhmmssmmmuuu(59999.9999), '00:01:00.000000');
  assert.equal(TimeFormattingFunctions.hhmmssmmmuuu(3599999.9999999), '01:00:00.000000');
  assert.equal(TimeFormattingFunctions.hhmmssmmmuuunnn(3599999.9999999), '01:00:00.000000000');
  assert.equal(TimeFormattingFunctions.hhmmssmmmuuu(-59999.9999), '-00:01:00.000000');
});

test('large exact millisecond values retain representable fractions without scaling the whole duration', () => {
  assert.equal(TimeFormattingFunctions.hhmmssmmmuuu(1e12 + .125), '277777:46:40.000125');
  assert.equal(TimeFormattingFunctions.hhmmssmmmuuunnn(1e12 + .125), '277777:46:40.000125000');
  assert.equal(TimeFormattingFunctions.hhmmssmmm(Number.MAX_SAFE_INTEGER), '2501999792:59:00.991');
});

test('nonfinite values remain explicit and formatting never mutates a caller value array', () => {
  const values = new Float64Array([NaN, Infinity, -Infinity, -0, 1.9999]);
  const before = new Uint8Array(values.buffer).slice();
  assert.deepEqual(Array.from(values, value => formatTime(value)), ['NaN', 'Infinity', '-Infinity', '00:00:00.000', '00:00:00.001']);
  assert.deepEqual(new Uint8Array(values.buffer), before);
});

test('Time default display precision uses the resolved range and verified boundary inclusions', () => {
  const cases = [[.009999, 9], [.01, 6], [.010001, 6], [9.999, 6], [10, 3], [10.001, 3],
    [10499.99999, 3], [10500, 0], [10500.00001, 0], [86400000, 0]] as const;
  for (const [span, expected] of cases) {
    assert.equal(timePrecisionForRange({ start: 0, end: span }), expected);
    assert.equal(timePrecisionForRange({ start: span, end: 0 }), expected);
  }
  // Same logical interval can have a larger *resolved* formatter range when
  // automatic scrolling margins are active. That geometry belongs to Axis.
  assert.equal(timePrecisionForRange({ start: 0, end: 9.9 }), 6);
  assert.equal(timePrecisionForRange({ start: -.14, end: 10.04 }), 3);
});

test('Time origin shifts the duration without limiting hours or changing range precision', () => {
  const range = { start: 0, end: 100 };
  assert.equal(formatTimeDefault(0, range, 86400000), '24:00:00.000');
  assert.equal(formatTimeDefault(-45, range, 86400000), '23:59:59.955');
  assert.equal(formatTimeDefault(90061001, range, 86400000), '49:01:01.001');
  assert.equal(formatTimeDefault(.12567891234567, { start: 0, end: 9.999 }), '00:00:00.000126');
  assert.equal(formatTimeDefault(.12567891234567, { start: 0, end: .009999 }), '00:00:00.000125679');
  assert.deepEqual(range, { start: 0, end: 100 });
});

test('degenerate or nonfinite formatting ranges use a finite millisecond display fallback', () => {
  for (const range of [{ start: 0, end: 0 }, { start: NaN, end: 1 }, { start: 0, end: Infinity }]) {
    assert.equal(timePrecisionForRange(range), 3);
    assert.equal(formatTimeDefault(1250, range), '00:00:01.250');
  }
});
