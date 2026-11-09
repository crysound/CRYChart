import test from 'node:test';
import assert from 'node:assert/strict';
import {Chart3D, ChartXY} from '../src/chart.js';
import {Themes} from '../src/core/styles.js';
import {advanced3dEntries, heightField, heightGrid, roundedColumns, spectrumRow, pointCloudFrame, gridContours, sampleGridBilinear, surfacePath, pickHeightGrid} from '../examples/official/advanced3d.js';

const near = (a: number, b: number, tolerance = 1e-6) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);
class ElementStub {
  style: Record<string, any> = {}; dataset: Record<string, string> = {}; children: ElementStub[] = []; parent?: ElementStub; clientWidth = 1000; clientHeight = 620; disabled = false;
  listeners = new Map<string, Set<(event: any) => void>>(); textContent = ''; value = '';
  constructor(readonly tag: string) {} get parentElement() {return this.parent;} get tagName() {return this.tag.toUpperCase();}
  append(...children: ElementStub[]) {children.forEach(child => {child.parent = this; this.children.push(child);});} remove() {if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this);}
  addEventListener(name: string, listener: (value: any) => void) {const listeners = this.listeners.get(name) ?? new Set(); listeners.add(listener); this.listeners.set(name, listeners);} removeEventListener(name: string, listener: (value: any) => void) {this.listeners.get(name)?.delete(listener);}
  getBoundingClientRect() {return {left: 0, top: 0, width: this.clientWidth, height: this.clientHeight};}
  dispatch(name: string, event: any = {}) {this.listeners.get(name)?.forEach(listener => listener({target: this, ...event}));}
  find(control: string): ElementStub | undefined {if (this.dataset.control === control) return this; for (const child of this.children) {const match = child.find(control); if (match) return match;}}
}
function dom<T>(run: (host: ElementStub) => T): T {const previous = globalThis.document, host = new ElementStub('host'); Object.assign(globalThis, {document: {createElement: (name: string) => new ElementStub(name), body: host}}); try {return run(host);} finally {if (previous === undefined) Reflect.deleteProperty(globalThis, 'document'); else Object.assign(globalThis, {document: previous});}}
function mount(id: string, host: ElementStub) {const create = (Constructor: any, args: any) => {const previous = globalThis.document; Reflect.deleteProperty(globalThis, 'document'); try {const chart = new Constructor({...args, width: 1000, height: 620}); chart.overlay = new ElementStub('canvas'); return chart;} finally {Object.assign(globalThis, {document: previous});}}; return advanced3dEntries.find(entry => entry.id.includes(`-${id}-`))!.mount!({host: host as unknown as HTMLElement, engine: {ChartXY: (args: any) => create(ChartXY, args), Chart3D: (args: any) => create(Chart3D, args)}, theme: Themes.darkGold});}
function clean(mounted: ReturnType<typeof mount>) {mounted.dispose?.(); mounted.charts.forEach(chart => chart.dispose());}

test('original 3D generators keep finite bounded data, real dimensions and changing frames', () => {
  assert.equal(advanced3dEntries.length, 13); assert.equal(new Set(advanced3dEntries.map(entry => entry.id)).size, 13); assert.ok(advanced3dEntries.every(entry => entry.observed.length && entry.gaps.length && entry.mount));
  const grid = heightGrid(1024, 1024); assert.equal(grid.length, 1048576); assert.ok(grid.every(Number.isFinite)); near(grid[0], heightField(0, 0), 1e-5);
  assert.equal(roundedColumns(0).length, 100); assert.notEqual(roundedColumns(0)[0].height, roundedColumns(1)[0].height); assert.equal(spectrumRow(0).length, 60); assert.notDeepEqual(spectrumRow(0), spectrumRow(10));
  const target = {x: new Float32Array(10000), y: new Float32Array(10000), z: new Float32Array(10000)}; assert.equal(pointCloudFrame(0, target), target); const first = target.x.slice(); pointCloudFrame(1, target); assert.notDeepEqual(target.x, first); assert.ok(target.y.every(value => value >= 0 && value <= 100));
});

test('contours, bilinear sampling and surface distance follow a known planar field', () => {
  const data = Float32Array.from([0, 1, 2, 3]); near(sampleGridBilinear(data, 2, 2, .25, .75), 1.75); const path = surfacePath(data, 2, 2, {x: 0, z: 0}, {x: 1, z: 1}, 50); near(path.at(-1)!.distance, Math.sqrt(11)); assert.ok(path.every(point => Math.abs(point.y - point.x - 2 * point.z) < 1e-6));
  const contours = gridContours(data, 2, 2, [1.5]); assert.equal(contours.length, 3); for (const point of contours.slice(0, 2)) near(point.x + 2 * point.z, 1.5);
  const picked = pickHeightGrid(data, 2, 2, {x: .3, y: .4}, point => ({x: point.x, y: point.z, depth: point.y})); assert.ok(picked); near(picked!.x, .3); near(picked!.z, .4); near(picked!.y, 1.1); assert.equal(pickHeightGrid(data, 2, 2, {x: 3, y: 4}, point => ({x: point.x, y: point.z, depth: point.y})), undefined);
});

test('bubble grouping and scatter shapes use actual data and independent legend visibility', () => dom(host => {
  const bubbles = mount('0038', host), first = bubbles.snapshot!() as any; assert.equal(first.series.length, 3); assert.equal(first.individualSizes, true); assert.ok(first.series.every((series: any) => series.count === 650)); host.find('series-1')!.dispatch('click'); assert.deepEqual((bubbles.snapshot!() as any).series.map((series: any) => series.visible), [true, false, true]); clean(bubbles);
  const scatter = mount('0900', host), data = scatter.snapshot!() as any; assert.equal(data.total, 4800); assert.deepEqual(data.series.map((series: any) => series.count), [1600, 3200]); assert.equal(data.lowerShape, 'instanced-cuboids'); clean(scatter);
}));

test('spectrogram streaming and camera switches are independent, and rounded geometry can change at runtime', () => dom(host => {
  const spectrum = mount('0904', host), initial = spectrum.snapshot!() as any; spectrum.update!(1, .1); assert.equal((spectrum.snapshot!() as any).nextRow, initial.nextRow + 2); assert.equal((spectrum.snapshot!() as any).count, 7200); host.find('spectrum-stream')!.dispatch('click'); const paused = spectrum.snapshot!() as any; spectrum.update!(2, .2); assert.equal((spectrum.snapshot!() as any).nextRow, paused.nextRow); assert.notEqual((spectrum.snapshot!() as any).camera.azimuth, paused.camera.azimuth); host.find('camera-animation')!.dispatch('click'); const camera = (spectrum.snapshot!() as any).camera; spectrum.update!(3, .2); assert.deepEqual((spectrum.snapshot!() as any).camera, camera); clean(spectrum);
  const rounded = mount('0907', host), before = rounded.snapshot!() as any; rounded.update!(2, 2); assert.notEqual((rounded.snapshot!() as any).firstHeight, before.firstHeight); host.find('rounded-edges')!.dispatch('click'); assert.equal((rounded.snapshot!() as any).roundness, 0); assert.equal((rounded.snapshot!() as any).count, 100); clean(rounded);
}));

test('realtime points replace all ten thousand records and five lines advance at their declared rates', () => dom(host => {
  const points = mount('0908', host), first = points.snapshot!() as any; points.update!(1, .016); const next = points.snapshot!() as any; assert.equal(next.count, 10000); assert.equal(next.frame, 1); assert.notDeepEqual(next.first, first.first); assert.equal(next.capacity, 10000); clean(points);
  const lines = mount('0909', host), before = lines.snapshot!() as any; lines.update!(1, 1); const after = lines.snapshot!() as any; assert.equal(after.nextSample - before.nextSample, 300); assert.ok(after.series.every((series: any, index: number) => series.count - before.series[index].count === 300)); assert.equal(after.interval.end - after.interval.start, 1000); clean(lines);
}));

test('million-sample shared inputs and independent intensity toggle real lighting and wireframes', () => dom(host => {
  const grid = mount('0912', host), state = grid.snapshot!() as any; assert.equal(state.sampleCount, 1048576); assert.equal(state.heatSamples, 1048576); assert.equal(state.triangleCount, 1023 * 1023 * 2); host.find('surface-shading')!.dispatch('click'); assert.equal((grid.snapshot!() as any).lighting, true); clean(grid);
  const intensity = mount('0914', host); assert.equal((intensity.snapshot!() as any).lookup, 'value'); assert.notEqual((intensity.snapshot!() as any).firstHeight, (intensity.snapshot!() as any).firstIntensity); host.find('surface-mode')!.dispatch('click'); assert.equal((intensity.snapshot!() as any).mode, 1); const surface = intensity.charts[0].series[0]; assert.equal(surface.getWireframeStyle().getThickness(), 0); host.find('surface-mode')!.dispatch('click'); assert.equal(surface.getFillStyle().getColor().a, 0); clean(intensity);
}));

test('partial surface updates keep untouched data, and chunks load actual four-million-point geometry', () => dom(host => {
  const partial = mount('0915', host), first = partial.snapshot!() as any; partial.update!(4, 4); const next = partial.snapshot!() as any; assert.equal(next.sampleCount, 40000); assert.equal(next.untouchedCorner, 0); assert.notDeepEqual(next.patch, first.patch); assert.equal(next.updates, first.updates + 1); clean(partial);
  const chunks = mount('0916', host); assert.equal((chunks.snapshot!() as any).loadedChunks, 1); for (let i = 0; i < 3; i++) host.find('load-chunk')!.dispatch('click'); const loaded = chunks.snapshot!() as any; assert.equal(loaded.loadedChunks, 4); assert.equal(loaded.totalSamples, 4194304); assert.equal(loaded.chunkBounds[0].x.end, loaded.chunkBounds[1].x.start); assert.equal(loaded.chunkBounds[0].z.end, loaded.chunkBounds[2].z.start); clean(chunks);
}));

test('ellipsoid and scatter surface have real indexed faces, with independent legend controls', () => dom(host => {
  const ellipsoid = mount('0917', host), state = ellipsoid.snapshot!() as any; assert.equal(state.fittedSamples, 1000); assert.ok(state.triangles > 1000); assert.ok(state.eigenvalues.every((value: number) => value > 0)); host.find('series-1')!.dispatch('click'); assert.equal((ellipsoid.snapshot!() as any).series[1].visible, false); clean(ellipsoid);
  const scatter = mount('0918', host), geometry = scatter.snapshot!() as any; assert.equal(geometry.rawSamples, 800); assert.ok(geometry.triangles > 1400); assert.equal(geometry.colorLookup, 'value'); clean(scatter);
}));

test('two real projected surface clicks create a profile and its hover updates a 3D marker', () => dom(host => {
  const mounted = mount('0919', host), state = mounted.snapshot!() as any, overlay = mounted.charts[0].overlay as unknown as ElementStub;
  for (const pixel of state.selectionPixels) {overlay.dispatch('pointerdown', {clientX: pixel.x, clientY: pixel.y}); overlay.dispatch('pointerup', {clientX: pixel.x, clientY: pixel.y});}
  const selected = mounted.snapshot!() as any; assert.equal(selected.selected.length, 2); assert.equal(selected.profileSamples, 400); assert.ok(selected.pathDistance > 100); near(selected.profileInterval.end, selected.pathDistance);
  const profile = mounted.charts[1], plot = profile.plot; (profile.overlay as unknown as ElementStub).dispatch('pointermove', {clientX: plot.left + plot.width / 2, clientY: plot.top + plot.height / 2}); assert.equal((mounted.snapshot!() as any).hoveredIndex, 200); assert.equal(mounted.charts[0].series.find((series: any) => series.getName() === 'Profile cursor').getSampleCount(), 1); clean(mounted);
}));
