import type { FormattingRange } from './formatting-functions.js';

/** Number of fractional second digits supported by Time tick formatting. */
export type TimePrecision = 0 | 3 | 6 | 9;

/** Format a signed duration in milliseconds, without changing the source value.
 * Hours do not wrap at midnight. Seconds/milliseconds omit smaller units;
 * microseconds/nanoseconds round the final unit and propagate its carry.
 */
export function formatTime(value: number, precision: TimePrecision = 3): string {
  if (!Number.isFinite(value)) return String(value);
  const magnitude = Math.abs(value);
  let milliseconds = BigInt(Math.trunc(magnitude));
  let fraction = 0;
  let unitsPerMillisecond = 1;
  if (precision > 3) {
    unitsPerMillisecond = precision === 6 ? 1000 : 1000000;
    fraction = Math.round((magnitude - Math.trunc(magnitude)) * unitsPerMillisecond);
    if (fraction === unitsPerMillisecond) { milliseconds += 1n; fraction = 0; }
  }
  const seconds = milliseconds / 1000n;
  const hours = seconds / 3600n;
  const minutes = seconds / 60n % 60n;
  const secondsInMinute = seconds % 60n;
  const main = `${value < 0 ? '-' : ''}${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secondsInMinute).padStart(2, '0')}`;
  if (precision === 0) return main;
  const subsecond = Number(milliseconds % 1000n) * unitsPerMillisecond + fraction;
  return main + '.' + String(subsecond).padStart(precision, '0');
}

/** Public duration formatters; inputs are milliseconds, including fractions. */
export const TimeFormattingFunctions = Object.freeze({
  hhmmss: (value: number) => formatTime(value, 0),
  hhmmssmmm: (value: number) => formatTime(value, 3),
  hhmmssmmmuuu: (value: number) => formatTime(value, 6),
  hhmmssmmmuuunnn: (value: number) => formatTime(value, 9),
});
/** Select display precision from the resolved formatting range in milliseconds.
 * These boundaries are verified through the public Time axis API, with scroll
 * margins disabled so a logical range cannot be confused with layout padding.
 */
export function timePrecisionForRange(range: FormattingRange): TimePrecision {
  const span = Math.abs(range.end - range.start);
  if (!Number.isFinite(span) || span <= 0) return 3;
  if (span < .01) return 9;
  if (span < 10) return 6;
  return span >= 10500 ? 0 : 3;
}

/** Default Time-axis formatting; custom formatter callbacks apply their own
 * policy and must not receive this origin-adjusted display value implicitly. */
export function formatTimeDefault(value: number, range: FormattingRange, timeOrigin = 0): string {
  return formatTime(timeOrigin === 0 ? value : value + timeOrigin, timePrecisionForRange(range));
}
