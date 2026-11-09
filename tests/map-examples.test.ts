import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {MapChart, projectMapPolygon, pointInMapPolygon, projectMapPosition, type GeoPosition} from '../src/map.js';
import {ChartXY, Chart3D} from '../src/chart.js';
import {Pie} from '../src/specialty.js';
import {Themes} from '../src/core/styles.js';
import {LinearGradientFill} from '../src/gradients.js';
import {mapEntries, mapWorld, mapStates, mapZones, mapCovid, mapAirRoute, mapRoads, populationGrowth, covidMetric, covidHistory, covidValues, routeDistance, airStatistics, temperatureFrame, energySources, energyZoneFacts, energyProfile, energyTotals} from '../examples/official/maps.js';

const near = (a: number, b: number, tolerance = 1e-7) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
const options = {headless: true, width: 1000, height: 620};
function recording() {
  const calls = {fills: 0, lines: 0, gradients: 0, text: [] as string[]};
  const finite = (...values: number[]) => values.forEach(value => assert.ok(Number.isFinite(value), `Invalid drawing coordinate ${value}`));
  const ctx = {
    save() {}, restore() {}, beginPath() {}, closePath() {}, clip() {}, setLineDash() {},
    setTransform(...values: number[]) {finite(...values);}, clearRect(...values: number[]) {finite(...values);}, fillRect(...values: number[]) {finite(...values); calls.fills++;}, strokeRect(...values: number[]) {finite(...values);}, rect(...values: number[]) {finite(...values);},
    translate(...values: number[]) {finite(...values);}, scale(...values: number[]) {finite(...values);}, rotate(...values: number[]) {finite(...values);}, moveTo(...values: number[]) {finite(...values);}, lineTo(...values: number[]) {finite(...values); calls.lines++;}, arc(...values: number[]) {finite(...values);},
    fill() {calls.fills++;}, stroke() {}, fillText(text: string, ...values: number[]) {finite(...values); calls.text.push(text);}, measureText(text: string) {return {width: text.length * 6};},
    createLinearGradient(...values: number[]) {finite(...values); calls.gradients++; return {addColorStop(position: number) {assert.ok(position >= 0 && position <= 1);}};},
  } as unknown as CanvasRenderingContext2D;
  return {ctx, calls};
}

test('downloaded geometry is real multi-ring data, with verified provenance hashes', () => {
  assert.equal(mapWorld.features.length, 242); assert.equal(mapStates.features.length, 49); assert.equal(mapZones.features.length, 15);
  const manifest = JSON.parse(readFileSync('examples/data/map-data-provenance.json', 'utf8'));
  for (const asset of manifest.outputs) assert.equal(createHash('sha256').update(readFileSync(`examples/data/${asset.file}`)).digest('hex'), asset.sha256, asset.file);
  let vertices = 0, holes = 0;
  for (const feature of mapWorld.features) {const geometry = feature.geometry!; const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates; for (const polygon of polygons) {holes += polygon.length - 1; vertices += polygon.reduce((sum, ring) => sum + ring.length, 0); const projected = projectMapPolygon(polygon); assert.ok(Number.isFinite(projected.bounds.minX));}}
  assert.ok(vertices > 50000); assert.ok(holes > 0); assert.ok(mapRoads.length > 1000); assert.ok(mapRoads.every(road => road.points.length >= 2));
});

test('explicit geographic extents support the date line and invalid changes are atomic', () => {
  const chart = new MapChart({...options, projection: 'equirectangular'}).setViewBounds({west: 170, east: -170, south: -10, north: 10});
  near(Math.abs(chart.getView().center.longitude), 180); const west = chart.positionToScreen([175, 0]), east = chart.positionToScreen([-175, 0]); assert.ok(east.x > west.x); assert.ok(east.x - west.x < chart.width);
  const before = chart.getView(); assert.throws(() => chart.setViewBounds({west: 10, east: 10, south: -5, north: 5}), /span/); assert.throws(() => chart.setViewBounds({west: 0, east: 50, south: 6, north: 5}), /south/); assert.deepEqual(chart.getView(), before); chart.dispose();
});

test('public region picking works before rendering and world geometry draws with continuous gradient', () => {
  const chart = new MapChart({...options, projection: 'equirectangular'}).setGeoJSON(mapWorld).setViewBounds({west: -26, east: 46, south: 34, north: 72}).setRegionFillStyle(new LinearGradientFill());
  const paris = chart.positionToScreen([2.3522, 48.8566]), pick = chart.getRegionAt(paris)!; assert.equal(pick.key, 'FRA'); pick.feature.properties!.name = 'Changed externally'; assert.notEqual(chart.getRegionAt(paris)!.feature.properties!.name, 'Changed externally');
  const {ctx, calls} = recording(); chart.render(ctx); assert.ok(calls.fills > 20); assert.equal(calls.gradients, 1); assert.ok(calls.lines > 1000); chart.dispose();
});

test('a geographic overlay uses the same coordinate plane as boundary rings, including holes', () => {
  const rings: GeoPosition[][] = [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], [[3, 3], [3, 7], [7, 7], [7, 3], [3, 3]]];
  const chart = new MapChart({...options, projection: 'equirectangular'}).setGeoJSON({type: 'FeatureCollection', features: [{type: 'Feature', id: 'land', properties: {}, geometry: {type: 'Polygon', coordinates: rings}}]});
  assert.equal(chart.getRegionAt(chart.positionToScreen([5, 5])), undefined); assert.equal(chart.getRegionAt(chart.positionToScreen([1, 1]))?.key, 'land');
  assert.equal(pointInMapPolygon(projectMapPosition([5, 5], 'equirectangular'), projectMapPolygon(rings, 'equirectangular').rings), false); const p = chart.positionToScreen([-94, 38]), coordinate = chart.screenToPosition(p); near(coordinate[0], -94); near(coordinate[1], 38); chart.dispose();
});

test('historical data uses continent filters, dates and nulls without manufacturing observations', () => {
  const europe = populationGrowth(1965, 'Europe'); assert.ok(Object.keys(europe).length > 25); assert.equal(europe.USA, undefined); assert.notEqual(europe.FRA, populationGrowth(1978, 'Europe').FRA);
  const first = mapCovid.countries.DEU.rows.find(row => row[1] !== null)!; assert.equal(covidMetric('DEU', first[0] - 1, 0), undefined); near(covidMetric('DEU', first[0], 0)!, first[1]!);
  assert.equal(covidMetric('not-a-country', 100, 0), undefined); assert.equal(covidMetric('AFG', mapCovid.dates.length - 1, 3), undefined); assert.ok(!('AFG' in covidValues(-1)));
  const relative = covidHistory('DEU', 0, first[0], first[0]), actual = covidHistory('DEU', 0, first[0], first[0], true); near(actual[0].y, relative[0].y * mapCovid.countries.DEU.population! / 100, 1e-6);
});

test('PM2.5 route statistics count observed time and never bridge gaps', () => {
  near(routeDistance([0, 0, 0, 1], [1, 1, 0, 1]), 111195.0802335329, .001);
  const stats = airStatistics([[0, 0, 0, 20], [1, .001, 0, 10], [1000, 50, 40, 30], [1001, 50.001, 40, 0]]);
  near(stats.mean, 15); near(stats.peak, 30); assert.equal(stats.observedSeconds, 2); assert.equal(stats.exposureSeconds, 2); assert.equal(stats.exposurePercent, 100); assert.ok(stats.distanceMeters < 250);
  assert.equal(mapAirRoute.length, 2618); assert.ok(mapAirRoute.every((row, i) => row.every(Number.isFinite) && (!i || row[0] > mapAirRoute[i - 1][0]))); const recorded = airStatistics(mapAirRoute); near(recorded.mean, 11.010050038197097, 1e-9); near(recorded.peak, 44.571); assert.ok(recorded.observedSeconds < mapAirRoute.at(-1)![0] - mapAirRoute[0][0]);
});

test('independent hourly energy profiles conserve factual daily totals and respond to filtering', () => {
  for (const fact of energyZoneFacts) {const profile = energyProfile(fact.code), totals = energyTotals(profile, energySources.map(() => true)); near(totals.reduce((sum, value) => sum + value, 0), fact.volume * 1000, 1e-7); near(profile.prices.reduce((sum, value) => sum + value, 0) / 24, fact.price);
    const renewable = energyTotals(profile, energySources.map(source => source.renewable)); near(renewable.reduce((sum, value) => sum + value, 0) / (fact.volume * 1000) * 100, fact.renewable); assert.ok(totals.every(Number.isFinite)); assert.deepEqual(energyTotals(profile, energySources.map(() => false)), Array(24).fill(0));}
  assert.throws(() => energyProfile('invalid'), /Unknown/); assert.notDeepEqual(energyProfile('NO1').prices, energyProfile('SE3').prices);
});

test('animated temperature field reuses its numeric allocation and changes all finite registered samples', () => {
  const data = new Float32Array(500 * 400), first = temperatureFrame(data, 500, 400, 0).slice(); assert.equal(temperatureFrame(data, 500, 400, 4), data); assert.ok(data.every(value => Number.isFinite(value) && value >= 0 && value <= 100)); assert.notDeepEqual(data, first); assert.throws(() => temperatureFrame(data, 499, 400, 0), /dimensions/);
});

class ElementStub {
  style: Record<string, any> = {}; dataset: Record<string, string> = {}; children: ElementStub[] = []; parent?: ElementStub; clientWidth = 1000; clientHeight = 620;
  listeners = new Map<string, Set<(event: any) => void>>(); hidden = false; textContent = ''; value = ''; width = 0; height = 0;
  constructor(readonly tag: string) {}
  get tagName() {return this.tag.toUpperCase();}
  append(...children: ElementStub[]) {children.forEach(child => {child.parent = this; this.children.push(child);});} appendChild(child: ElementStub) {this.append(child);}
  remove() {if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.parent = undefined;}
  setAttribute() {} addEventListener(name: string, listener: (value: any) => void) {const listeners = this.listeners.get(name) ?? new Set(); listeners.add(listener); this.listeners.set(name, listeners);} removeEventListener(name: string, listener: (value: any) => void) {this.listeners.get(name)?.delete(listener);}
  getBoundingClientRect() {return {left: 0, top: 0, width: this.clientWidth, height: this.clientHeight};} getContext() {return recording().ctx;}
  dispatch(name: string, event: any = {}) {this.listeners.get(name)?.forEach(listener => listener({target: this, ...event}));}
  find(control: string): ElementStub | undefined {if (this.dataset.control === control) return this; for (const child of this.children) {const match = child.find(control); if (match) return match;}}
}
function dom<T>(run: (host: ElementStub) => T): T {const previous = globalThis.document, host = new ElementStub('host'); Object.assign(globalThis, {document: {createElement: (name: string) => new ElementStub(name), body: host}}); try {return run(host);} finally {if (previous === undefined) Reflect.deleteProperty(globalThis, 'document'); else Object.assign(globalThis, {document: previous});}}
function mount(id: string, host: ElementStub) {
  const headless = (Constructor: any, args: any) => {const previous = globalThis.document; Reflect.deleteProperty(globalThis, 'document'); try {return new Constructor({...args, ...options});} finally {Object.assign(globalThis, {document: previous});}};
  const engine = {MapChart: (args: any) => new MapChart({...args, ...options}), Pie: (args: any) => new Pie({...args, ...options}), ChartXY: (args: any) => headless(ChartXY, args), Chart3D: (args: any) => headless(Chart3D, args)};
  return mapEntries.find(entry => entry.id.includes(`-${id}-`))!.mount!({host: host as unknown as HTMLElement, engine, theme: Themes.darkGold});
}
function clean(mounted: ReturnType<typeof mount>) {mounted.dispose?.(); mounted.charts.forEach(chart => chart.dispose());}

test('population year and vaccination date controls update actual map values and pause playback', () => dom(host => {
  const mounted = mount('1102', host), before = mounted.snapshot!() as any; const slider = host.find('population-year')!; slider.value = '1978'; slider.dispatch('input'); const after = mounted.snapshot!() as any; assert.equal(after.year, 1978); assert.equal(after.playing, false); assert.notDeepEqual(after.maps[2].probes, before.maps[2].probes); clean(mounted);
  const vaccines = mount('1103', host), first = vaccines.snapshot!() as any; const date = host.find('vaccination-date')!; date.value = '350'; date.dispatch('input'); const next = vaccines.snapshot!() as any; assert.equal(next.dateIndex, 350); assert.ok(next.pointCount > first.pointCount); assert.ok(next.worldVaccinated > first.worldVaccinated); assert.equal(next.playing, false); clean(vaccines);
}));

test('temperature slider keeps geographic bounds and changes heatmap alpha without changing raw data', () => dom(host => {
  const mounted = mount('1110', host), first = mounted.snapshot!() as any; assert.equal(first.sampleCount, 200000); assert.ok(first.boundarySamples > 1000); const slider = host.find('temperature-transparency')!; slider.value = '80'; slider.dispatch('input'); const changed = mounted.snapshot!() as any; near(changed.alpha, .2); assert.deepEqual(changed.temperature, first.temperature); assert.deepEqual(changed.geographicBounds, first.geographicBounds); mounted.update!(2, .1); assert.notDeepEqual((mounted.snapshot!() as any).temperature, first.temperature); clean(mounted);
}));

test('Nordic sidebars and source filters update every mini chart and selected detail series', () => dom(host => {
  const mounted = mount('1714', host); host.find('zone-SE3')!.dispatch('click'); const selected = mounted.snapshot!() as any; assert.equal(selected.selectedZone, 'SE3'); assert.equal(selected.miniChartCount, 15); assert.equal(selected.priceSamples, 24); assert.ok(selected.stackSamples.some((count: number) => count === 24));
  host.find('energy-all')!.dispatch('click'); const hidden = mounted.snapshot!() as any; assert.equal(hidden.activeSources.length, 0); assert.equal(hidden.priceSamples, 24); assert.ok(hidden.activeGeneration.every((value: number) => value === 0)); assert.ok(hidden.stackSamples.every((count: number) => count === 0)); host.find('energy-5')!.dispatch('click'); assert.deepEqual((mounted.snapshot!() as any).activeSources, ['Nuclear']); clean(mounted);
}));

test('route replay shares actual measurements between 3D and geography and recomputes all statistics on seek', () => dom(host => {
  const mounted = mount('1715', host), first = mounted.snapshot!() as any; assert.equal(first.sharedDataset, true); assert.equal(first.count, 120); assert.equal(first.statistics.samples, 120); assert.ok(first.roadSegments > 1000);
  mounted.update!(10, 10); const advanced = mounted.snapshot!() as any; assert.equal(advanced.count, 520); assert.ok(advanced.statistics.observedSeconds > first.statistics.observedSeconds); const slider = host.find('route-samples')!; slider.value = '80'; slider.dispatch('input'); const sought = mounted.snapshot!() as any; assert.equal(sought.count, 80); assert.equal(sought.playing, false); assert.equal(sought.sharedDataset, true); near(sought.statistics.mean, airStatistics(mapAirRoute.slice(0, 80)).mean); assert.equal(sought.datasetSamples, sought.count + sought.routeBreaks); clean(mounted);
}));

test('COVID map supports continent and country drilldown, actual values and back navigation', () => dom(host => {
  const mounted = mount('1111', host), chart = mounted.charts[0] as MapChart, {ctx} = recording(); chart.render(ctx); chart.activateAt(chart.positionToScreen([2.3522, 48.8566])); assert.equal((mounted.snapshot!() as any).level, 'continent'); chart.render(ctx); chart.activateAt(chart.positionToScreen([2.3522, 48.8566])); assert.equal((mounted.snapshot!() as any).level, 'country'); assert.equal((mounted.snapshot!() as any).country, 'FRA');
  host.find('covid-actual')!.dispatch('click'); assert.equal((mounted.snapshot!() as any).actual, true); host.find('covid-back')!.dispatch('click'); assert.equal((mounted.snapshot!() as any).level, 'continent'); host.find('covid-back')!.dispatch('click'); assert.equal((mounted.snapshot!() as any).level, 'world'); clean(mounted);
}));
