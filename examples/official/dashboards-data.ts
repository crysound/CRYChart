/** Original deterministic inputs for the dashboard candidates. Values are not claimed to be reference recordings. */
export function dashboardRandom(seed: number): () => number {let state = seed >>> 0; return () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) + .5) / 4294967296;}
export class SampleClock {
  index = 0; private remainder = 0;
  constructor(readonly rate: number) {if (!Number.isFinite(rate) || rate <= 0) throw new RangeError('Sample rate must be positive');}
  advance(delta: number): {start: number; count: number} {if (!Number.isFinite(delta) || delta < 0) throw new RangeError('Elapsed time must be nonnegative'); this.remainder += delta * this.rate; const count = Math.floor(this.remainder + 1e-8), start = this.index; this.remainder -= count; this.index += count; return {start, count};}
}
export function channelValue(index: number, channel: number): number {return .5 + .22 * Math.sin(index * (.003 + channel * .0006)) + .13 * Math.sin(index * .037 + channel) + .08 * Math.sin(index * .211 + channel * 2);}
export function medicalSignals(time: number): [number, number, number, number] {
  const phase = (time * 1.5) % 1, pulse = (center: number, width: number, amplitude: number) => amplitude * Math.exp(-(((phase - center) / width) ** 2));
  const ecg = pulse(.18, .03, .11) - pulse(.38, .01, .18) + pulse(.4, .008, 1.1) - pulse(.425, .012, .4) + pulse(.67, .07, .28) + .01 * Math.sin(time * 80);
  return [ecg, 80 + 38 * Math.exp(-(((phase - .25) / .14) ** 2)) + 9 * Math.exp(-(((phase - .57) / .07) ** 2)), 50 + 18 * Math.sin(time * 4) + 8 * Math.sin(time * 11), 96 + 1.3 * Math.sin(time * 3.5) + .6 * Math.sin(time * 12)];
}
export function companyExpenses() {
  const random = dashboardRandom(503), names = ['Dev', 'Maintenance', 'Support', 'Sales', 'Marketing'], levels = [2000, 360, 780, 1800, 1870];
  return names.map((name, department) => {let drift = 0; const daily = Array.from({length: 365}, (_, day) => {drift = drift * .96 + (random() - .5) * 65; return Math.round(levels[department] * (1 + .15 * Math.sin(day / 44 + department)) + drift);}); return {name, daily, total: daily.reduce((a, b) => a + b, 0)};});
}
export function fiberIntensity(distance: number, time: number): number {return 320 + 170 * Math.sin(time * .93) + 95 * Math.sin(distance / 430 + time * .27) + 70 * Math.cos(distance / 120 - time * .12);}
export function fiberField(columns = 96, rows = 36): Float32Array {return Float32Array.from({length: columns * rows}, (_, index) => fiberIntensity(index % columns * 35, Math.floor(index / columns)));}
export function columnSums(data: Float32Array, columns: number, rows: number): Float64Array {if (data.length !== columns * rows) throw new RangeError('Matrix shape mismatch'); const sums = new Float64Array(columns); for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) if (Number.isFinite(data[row * columns + col])) sums[col] += data[row * columns + col]; return sums;}
export class RollingMean {
  private values: Float64Array; private cursor = 0; private count = 0; private sum = 0;
  constructor(readonly period: number) {if (!Number.isInteger(period) || period <= 0) throw new RangeError('Mean period must be positive integer'); this.values = new Float64Array(period);}
  push(value: number): number {if (!Number.isFinite(value)) throw new RangeError('Mean input must be finite'); if (this.count === this.period) this.sum -= this.values[this.cursor]; else this.count++; this.values[this.cursor] = value; this.cursor = (this.cursor + 1) % this.period; this.sum += value; return this.sum / this.count;}
}
export function randomWalk(count: number, seed: number): Float32Array {const random = dashboardRandom(seed), values = new Float32Array(count); let value = 0; for (let i = 0; i < count; i++) values[i] = value += (random() - .5) * 2; return values;}

export function trackPoint(fraction: number): {x: number; y: number} {const angle = fraction * Math.PI * 2; return {x: 480 * Math.cos(angle) + 140 * Math.cos(2 * angle), y: 310 * Math.sin(angle) - 85 * Math.sin(3 * angle)};}
export function racingSample(time: number) {
  const lap = Math.floor(time / 75), fraction = (time / 75) % 1, angle = fraction * Math.PI * 2, speed = (180 + 55 * Math.sin(angle - .4) + 30 * Math.cos(angle * 3)), steer = Math.sin(angle * 3) * .7, brake = Math.max(0, -Math.cos(angle * 3)) * .8, torque = (1 - brake) * (.6 + .25 * Math.sin(angle)), gear = Math.max(1, Math.min(6, Math.floor(speed / 45) + 1));
  return {time, lap, lapTime: time - lap * 75, position: 3 + Number(Math.sin(time / 25) < -.5), fuel: Math.max(0, 80 - time * .035), speed, rpm: 2200 + speed / gear * 110, steer, brake, torque, ax: Math.sin(angle * 3) * 1.3, az: Math.cos(angle * 2) * .8, tires: [0, 1, 2, 3].map(i => 83 + 11 * Math.sin(time / 15 + i) + 2 * i), coordinate: trackPoint(fraction)};
}
export const cryptoReferenceValues = [
  {id: 'BTC', name: 'Bitcoin', price: 22900.71, marketCap: 437.8e9, volume: 15.10e9, high: 68780.77, color: '#ef9d35'},
  {id: 'ETH', name: 'Ethereum', price: 1679.59, marketCap: 204.75e9, volume: 11.75e9, high: 4861.29, color: '#96a2d9'},
];
export function cryptoHistory(price: number, seed: number, count: number, scale: number): Float32Array {const wave = randomWalk(count, seed); return Float32Array.from(wave, (value, i) => price * (1 + scale * (value - wave[count - 1]) + .001 * Math.sin(i * .1)));}
