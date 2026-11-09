import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {Chart3D, ChartXY} from '../src/chart.js';
import {Themes} from '../src/core/styles.js';
import {advanced3dExtraEntries, decodeLidarAsset, audioSpectrum3D, fftSampleRate, fftSize, spectrumBins, airQualityData, buildSliceIndex, querySlice} from '../examples/official/advanced3d-extra.js';

const near = (a: number, b: number, tolerance = 1e-6) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);
const readAsset = (name: string) => readFileSync(resolve('examples/data', name));
const arrayBuffer = (data: Uint8Array) => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
class ElementStub {
  style: Record<string, any> = {}; dataset: Record<string, string> = {}; children: ElementStub[] = []; parent?: ElementStub; clientWidth = 1000; clientHeight = 620; disabled = false;
  listeners = new Map<string, Set<(event: any) => void>>(); textContent = ''; value = '';
  constructor(readonly tag: string) {} get parentElement() {return this.parent;} get tagName() {return this.tag.toUpperCase();}
  append(...children: ElementStub[]) {children.forEach(child => {child.parent = this; this.children.push(child);});} remove() {if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this);}
  addEventListener(name: string, listener: (value: any) => void) {const listeners = this.listeners.get(name) ?? new Set(); listeners.add(listener); this.listeners.set(name, listeners);} removeEventListener(name: string, listener: (value: any) => void) {this.listeners.get(name)?.delete(listener);}
  getBoundingClientRect() {return {left: 0, top: 0, width: this.clientWidth, height: this.clientHeight};}
  dispatch(name: string, event: any = {}) {this.listeners.get(name)?.forEach(listener => listener({target: this, preventDefault() {}, stopImmediatePropagation() {}, ...event}));}
  find(control: string): ElementStub | undefined {if (this.dataset.control === control) return this; for (const child of this.children) {const match = child.find(control); if (match) return match;}}
}
async function dom(run: (host: ElementStub) => void | Promise<void>) {
  const previous = globalThis.document, previousFetch = globalThis.fetch, host = new ElementStub('host');
  Object.assign(globalThis, {document: {createElement: (name: string) => new ElementStub(name), body: host}, fetch: async (input: URL | string) => ({ok: true, status: 200, arrayBuffer: async () => arrayBuffer(readAsset(new URL(String(input)).pathname.split('/').at(-1)!))})});
  try {await run(host);} finally {globalThis.fetch = previousFetch; if (previous === undefined) Reflect.deleteProperty(globalThis, 'document'); else Object.assign(globalThis, {document: previous});}
}
function mount(id: string, host: ElementStub) {
  const create = (Constructor: any, args: any) => {const previous = globalThis.document; Reflect.deleteProperty(globalThis, 'document'); try {const chart = new Constructor({...args, width: 1000, height: 620}); chart.overlay = new ElementStub('canvas'); return chart;} finally {Object.assign(globalThis, {document: previous});}};
  return advanced3dExtraEntries.find(entry => entry.id.includes(`-${id}-`))!.mount!({host: host as unknown as HTMLElement, engine: {ChartXY: (args: any) => create(ChartXY, args), Chart3D: (args: any) => create(Chart3D, args)}, theme: Themes.darkGold});
}
function clean(mounted: ReturnType<typeof mount>) {mounted.dispose?.(); mounted.charts.forEach(chart => chart.dispose());}
async function loaded(mounted: ReturnType<typeof mount>) {for (let attempt = 0; attempt < 100; attempt++) {const state = mounted.snapshot!() as any; assert.equal(state.error, ''); if (state.ready) return state; await new Promise(resolve => setTimeout(resolve, 1));} throw new Error('Point-cloud fixture did not load');}

test('procedural data sizes and SHA-256 hashes match their generator manifest', () => {
  const manifest = JSON.parse(readAsset('3d-data-provenance.json').toString()); assert.equal(manifest.assets.length, 5);
  assert.equal(manifest.schemaVersion, 2); assert.equal(manifest.kind, 'deterministic-synthetic-data'); assert.equal(manifest.seed, 20261109);
  assert.equal(manifest.generator, 'scripts/generate-demo-assets.ts'); assert.ok(readFileSync(resolve(manifest.generator)).byteLength > 0);
  for (const asset of manifest.assets) {const bytes = readAsset(asset.file); assert.equal(bytes.length, asset.bytes); assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.sha256); assert.equal(asset.kind, manifest.kind); assert.equal(asset.generator, manifest.generator); assert.equal(asset.seed, manifest.seed);}
  assert.match(readAsset('3D-DATA-SOURCES.txt').toString(), /deterministic synthetic data/);
});

test('point-cloud parser decodes planar little-endian coordinates and planar RGB exactly', () => {
  const building = decodeLidarAsset(arrayBuffer(readAsset('lidar-city-buildings.bin'))); assert.equal(building.count, 584308); assert.deepEqual([building.x[0], building.y[0], building.z[0]], [-9600, 0, -13000]); assert.deepEqual(building.bounds.y, {start: 0, end: 6984});
  const bytes = readAsset('lidar-city-vegetation.bin'), vegetation = decodeLidarAsset(arrayBuffer(bytes), true); assert.equal(vegetation.count, 853604); assert.deepEqual([vegetation.x[0], vegetation.y[0], vegetation.z[0]], [-9820, 300, -13000]);
  const color = vegetation.color![0], offset = 4 + vegetation.count * 6; assert.equal(color >>> 24, bytes[offset]); assert.equal((color >>> 16) & 255, bytes[offset + vegetation.count]); assert.equal((color >>> 8) & 255, bytes[offset + vegetation.count * 2]); assert.equal(color & 255, 255);
  const land = decodeLidarAsset(arrayBuffer(readAsset('lidar-terrain.bin'))); assert.equal(land.count, 1139662); assert.deepEqual(land.bounds, {x: {start: 1661, end: 5694}, y: {start: -111, end: 1104}, z: {start: 5287, end: 9296}});
  assert.throws(() => decodeLidarAsset(new ArrayBuffer(3)), /header/); assert.throws(() => decodeLidarAsset(arrayBuffer(bytes.subarray(0, bytes.length - 1)), true), /file size/); assert.throws(() => decodeLidarAsset(arrayBuffer(bytes)), /file size/);
});

test('counting-sort slab index returns exact inclusive slices at bin edges without altering source', () => {
  const input = Float32Array.from([2, -100, 100, 0, 99, -1, 200, 1]), original = input.slice(), index = buildSliceIndex(input, 100);
  for (const [coordinate, width] of [[0, 0], [0, 2], [100, 2], [0, 400], [-1000, 10], [1000, 10]]) {const result = [...querySlice(index, coordinate, width)].sort((a, b) => a - b), expected = [...input.keys()].filter(i => Math.abs(input[i] - coordinate) <= width / 2); assert.deepEqual(result, expected);}
  assert.deepEqual(input, original); assert.throws(() => buildSliceIndex(Float32Array.from([1, NaN])), /finite/); assert.throws(() => buildSliceIndex(input, 0), /positive/); assert.throws(() => querySlice(index, 0, -1), /nonnegative/);
});

test('stereo audio computes Hann-windowed FFT peaks and synthetic hourly values stay exact', () => {
  assert.equal(fftSampleRate, 24000); assert.equal(fftSize, 1024); assert.equal(spectrumBins, 308); const left = audioSpectrum3D(0, 0), right = audioSpectrum3D(0, 1);
  assert.equal(left.samples.length, 1024); assert.equal(left.samples[0], 0); near(left.samples.at(-1)!, 0); assert.equal(left.values.length, 308); assert.ok(left.values.every(value => Number.isFinite(value) && value >= -100 && value <= 0)); near(left.peakHz, 240, fftSampleRate / fftSize); near(right.peakHz, 420, fftSampleRate / fftSize); assert.notDeepEqual(left.values, right.values); assert.notDeepEqual(audioSpectrum3D(200, 0).values, left.values);
  assert.equal(airQualityData.length, 684); const observed = airQualityData.find(row => row.time === Date.UTC(2025, 0, 21))!; assert.equal(observed.pm25, 14.36); assert.equal(observed.no2, 28.87); assert.equal(new Set(airQualityData.map(row => row.time)).size, 684); assert.ok(airQualityData.every((row, i) => Number.isFinite(row.pm25 + row.no2) && (!i || row.time - airQualityData[i - 1].time === 3600000)));
});

test('actual full point clouds load into series and per-group visibility stays independent', () => dom(async host => {
  assert.equal(advanced3dExtraEntries.length, 7); assert.equal(new Set(advanced3dExtraEntries.map(entry => entry.id)).size, 7); assert.ok(advanced3dExtraEntries.every(entry => entry.observed.length && entry.gaps.length && entry.mount));
  const park = mount('0910', host); try {const state = await loaded(park); assert.equal(state.pointCount, 1437912); assert.deepEqual(state.groups.map((group: any) => group.count), [584308, 853604]); assert.equal(state.individualVegetationRGB, true); host.find('series-1')!.dispatch('click'); assert.deepEqual((park.snapshot!() as any).groups.map((group: any) => group.visible), [true, false]);} finally {clean(park);}
  const land = mount('0911', host); try {const state = await loaded(land); assert.equal(state.pointCount, 1139662); assert.equal(state.discrete, true); assert.deepEqual(state.paletteLevels, [-111, 0, 200, 400, 600, 800, 1000]); assert.deepEqual(state.bounds.y, {start: -111, end: 1104});} finally {clean(land);}
}));

test('LiDAR age replay and five random-walk channels keep their real bounded sample counts', () => dom(async host => {
  const lidar = mount('0058', host); try {const start = await loaded(lidar); assert.equal(start.samples, 4477); lidar.update!(60, 60); const state = lidar.snapshot!() as any; assert.equal(state.samples, 1200000); assert.equal(state.nextSample, 1204477); assert.deepEqual(state.agePaletteValues, [0, 55, 60]); assert.equal(lidar.charts[0].series[0].getDataSet().getNextSampleIndex(), 1204477);} finally {clean(lidar);}
  const channels = mount('0059', host); try {channels.update!(10, 10); const state = channels.snapshot!() as any; assert.equal(state.channels.length, 5); assert.ok(state.channels.every((channel: any) => channel.count === 3000)); assert.equal(state.nextSample, 3600); assert.equal(state.interval.end - state.interval.start, 10000); host.find('series-2')!.dispatch('click'); assert.deepEqual((channels.snapshot!() as any).channels.map((channel: any) => channel.visible), [true, true, false, true, true]);} finally {clean(channels);}
}));

test('audio 2D heatmap and transposed 3D surface share FFT values and stay aligned beyond one history window', () => dom(host => {
  const mounted = mount('0913', host); try {const initial = mounted.snapshot!() as any; assert.equal(initial.frames, 16); for (let second = 1; second <= 10; second++) mounted.update!(second, 1); const state = mounted.snapshot!() as any; assert.equal(state.frames, 366);
    state.components.forEach((component: any) => {assert.equal(component.heatSamples, 366); assert.equal(component.surfaceSamples, 256 * 308); assert.deepEqual(component.lastValues, component.surfaceLatest); near(component.heatTimeBounds.start, component.timeInterval.start, .1); near(component.heatTimeBounds.end, component.timeInterval.end, .1); near(component.surfaceTimeBounds.start, component.timeInterval.start, .1); near(component.surfaceTimeBounds.end, component.timeInterval.end - 1000 / 35, .1);}); assert.notDeepEqual(state.components[0].lastValues, state.components[1].lastValues);
  } finally {clean(mounted);}
}));

test('time-series hover displays the synthetic UTC timestamp and both sample values', () => dom(host => {
  const mounted = mount('1709', host); try {const state = mounted.snapshot!() as any; assert.equal(state.samples, 684); const overlay = mounted.charts[0].overlay as unknown as ElementStub; overlay.dispatch('pointermove', {clientX: state.probe.pixel.x, clientY: state.probe.pixel.y}); const hover = mounted.snapshot!() as any; assert.equal(hover.hovered.time, Date.UTC(2025, 0, 21)); assert.match(hover.tooltip, /2025-01-21 00:00:00 UTC/); assert.match(hover.tooltip, /14\.36/); assert.match(hover.tooltip, /28\.87/); overlay.dispatch('pointerleave'); assert.equal((mounted.snapshot!() as any).hovered, undefined);} finally {clean(mounted);}
}));

test('orthogonal slicing selects actual point slabs and 2D drag and 3D click update the linked coordinates', () => dom(async host => {
  const mounted = mount('1710', host); try {const initial = await loaded(mounted); assert.equal(initial.samples, 1437912); assert.ok(initial.slices.every((slice: any) => slice.samples > 0 && slice.samples < initial.samples)); const cloudSeries = mounted.charts[0].series.find((series: any) => series.getName() === 'City point cloud'), source = cloudSeries.getDataSet();
    for (const slice of initial.slices) {const values = source.getColumn(cloudSeries.getDataMapping()[slice.normal]), expected = values.reduce((count: number, value: number) => count + Number(Math.abs(value - initial.selected[slice.normal]) <= 60), 0); assert.equal(slice.samples, expected);}
    const plane = initial.slices[0], overlay = mounted.charts[1].overlay as unknown as ElementStub, y = plane.plot.top + plane.plot.height * .4; overlay.dispatch('pointerdown', {clientX: plane.xPixel, clientY: y, pointerId: 1}); overlay.dispatch('pointermove', {clientX: plane.plot.left + plane.plot.width * .7, clientY: y, pointerId: 1}); overlay.dispatch('pointerup'); const dragged = mounted.snapshot!() as any; assert.notEqual(dragged.selected.x, initial.selected.x); assert.equal(dragged.selectionVersion, initial.selectionVersion + 1); assert.equal(dragged.slices[0].vertical, dragged.selected.x); assert.equal(dragged.slices[1].vertical, dragged.selected.x);
    const volume = mounted.charts[0].overlay as unknown as ElementStub, pixel = dragged.pointProbe.pixel; volume.dispatch('pointerdown', {clientX: pixel.x, clientY: pixel.y}); volume.dispatch('pointerup', {clientX: pixel.x, clientY: pixel.y}); const clicked = mounted.snapshot!() as any; assert.equal(clicked.selectionVersion, dragged.selectionVersion + 1); assert.ok(Object.values(clicked.selected).every(Number.isInteger)); assert.equal(clicked.slices[2].vertical, clicked.selected.z); assert.equal(clicked.slices[2].horizontal, clicked.selected.y);
  } finally {clean(mounted);}
}));
