import test from 'node:test';
import assert from 'node:assert/strict';
import {MapChart, pointInMapPolygon, projectMapPolygon, projectMapPosition, unprojectMapPosition, type GeoJSONFeatureCollection, type GeoPosition, type MapRegionClick} from '../src/map.js';
import {ColorRGBA, LUT, SolidFill} from '../src/core/styles.js';

const near = (a: number, b: number, tolerance = 1e-9) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
const square: GeoPosition[] = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
const hole: GeoPosition[] = [[3, 3], [7, 3], [7, 7], [3, 7], [3, 3]];
function geoJSON(): GeoJSONFeatureCollection {return {type: 'FeatureCollection', features: [{type: 'Feature', id: 'A', properties: {name: 'Alpha', nested: {value: 4}}, geometry: {type: 'Polygon', coordinates: [square.map(p => [...p] as GeoPosition), hole.map(p => [...p] as GeoPosition)]}}]};}
const options = {headless: true, width: 640, height: 400};
function context() {
  const calls = {fills: [] as unknown[], strokes: 0, arcs: 0, text: [] as string[], colors: [] as unknown[]};
  const check = (...values: number[]) => values.forEach(value => assert.ok(Number.isFinite(value)));
  const ctx = {
    save() {}, restore() {}, setLineDash() {}, beginPath() {}, closePath() {}, clip() {},
    setTransform(...values: number[]) {check(...values);}, clearRect(...values: number[]) {check(...values);},
    fillRect(...values: number[]) {check(...values);}, strokeRect(...values: number[]) {check(...values);},
    moveTo(...values: number[]) {check(...values);}, lineTo(...values: number[]) {check(...values);}, rect(...values: number[]) {check(...values);},
    translate(...values: number[]) {check(...values);}, scale(...values: number[]) {check(...values);},
    arc(...values: number[]) {check(...values); calls.arcs++;},
    fill(...args: unknown[]) {calls.fills.push(args); calls.colors.push((this as any).fillStyle);}, stroke() {calls.strokes++;},
    fillText(value: string, ...values: number[]) {check(...values); calls.text.push(value);}, measureText(value: string) {return {width: value.length * 6};},
  } as unknown as CanvasRenderingContext2D;
  return {ctx, calls};
}
class InteractiveMap extends MapChart {
  hoverAt(point: {x: number; y: number}) {this.pointer = point; this.hovered = [...this.hits].reverse().find(hit => hit.contains(point));}
  drag(points: Array<{x: number; y: number}>) {points.forEach(point => this.dragAt(point));}
  zoomWheel(point: {x: number; y: number}, delta: number) {this.pointer = point; return this.wheel(delta);}
}

test('Mercator and equirectangular projections round-trip known coordinates and clamp the poles', () => {
  for (const projection of ['mercator', 'equirectangular'] as const) for (const p of [[0, 0], [123.25, 48], [-179, -70]] as GeoPosition[]) {
    const projected = projectMapPosition(p, projection), restored = unprojectMapPosition(projected, projection);
    near(restored[0], p[0]); near(restored[1], p[1]);
  }
  near(projectMapPosition([0, 0]).y, 0); near(projectMapPosition([0, 90]).y, -.5);
  near(projectMapPosition([180, -90], 'equirectangular').x, .5); near(projectMapPosition([180, -90], 'equirectangular').y, .25);
  assert.throws(() => projectMapPosition([0, NaN]), /finite/); assert.throws(() => projectMapPosition([0, 91]), /latitude/);
});

test('polygon hit testing excludes holes and their boundaries independently of winding order', () => {
  const polygon = projectMapPolygon([square, hole], 'equirectangular');
  assert.equal(pointInMapPolygon(projectMapPosition([1, 1], 'equirectangular'), polygon.rings), true);
  assert.equal(pointInMapPolygon(projectMapPosition([5, 5], 'equirectangular'), polygon.rings), false);
  assert.equal(pointInMapPolygon(projectMapPosition([3, 5], 'equirectangular'), polygon.rings), false);
  assert.equal(pointInMapPolygon(projectMapPosition([0, 5], 'equirectangular'), polygon.rings), true);
  const reversed = polygon.rings.map(ring => [...ring].reverse());
  assert.equal(pointInMapPolygon(projectMapPosition([1, 1], 'equirectangular'), reversed), true);
  assert.equal(pointInMapPolygon(projectMapPosition([5, 5], 'equirectangular'), reversed), false);
});

test('antimeridian polygons use short edges while an explicit whole-world rectangle keeps its width', () => {
  const ring: GeoPosition[] = [[170, -10], [-170, -10], [-170, 10], [170, 10], [170, -10]], original = JSON.stringify(ring);
  const polygon = projectMapPolygon([ring], 'equirectangular');
  near(polygon.bounds.maxX - polygon.bounds.minX, 20 / 360);
  assert.equal(pointInMapPolygon(projectMapPosition([179, 0], 'equirectangular'), polygon.rings), true);
  const western = projectMapPosition([-179, 0], 'equirectangular'); western.x += 1;
  assert.equal(pointInMapPolygon(western, polygon.rings), true); assert.equal(JSON.stringify(ring), original);
  const world = projectMapPolygon([[[-180, -90], [180, -90], [180, 90], [-180, 90], [-180, -90]]], 'equirectangular');
  near(world.bounds.maxX - world.bounds.minX, 1);
});

test('GeoJSON is defensively copied and invalid updates retain the previous geometry', () => {
  const input = geoJSON(), chart = new MapChart(options).setGeoJSON(input);
  (input.features[0].geometry as any).coordinates[0][0][0] = 99; (input.features[0].properties!.nested as any).value = 88;
  const stored = chart.getGeoJSON(); assert.equal((stored.features[0].geometry as any).coordinates[0][0][0], 0); assert.equal((stored.features[0].properties!.nested as any).value, 4);
  (stored.features[0].geometry as any).coordinates[0][0][0] = 77;
  assert.equal((chart.getGeoJSON().features[0].geometry as any).coordinates[0][0][0], 0);
  const invalid = geoJSON(); (invalid.features[0].geometry as any).coordinates[0][1][1] = Infinity;
  assert.throws(() => chart.setGeoJSON(invalid), /finite/); assert.equal(chart.getRegionCount(), 1);
  const cyclic: any = geoJSON(); cyclic.features[0].properties.cycle = cyclic;
  assert.throws(() => chart.setGeoJSON(cyclic), /cycle/);
  assert.throws(() => chart.setGeoJSON({type: 'FeatureCollection', features: [{type: 'Feature', properties: null, geometry: {type: 'Point', coordinates: [0, 0]}}]} as any), /Polygon/);
});

test('actual drawn regions preserve holes, emit copied selection records and show hover values', () => {
  const chart = new InteractiveMap(options).setGeoJSON(geoJSON()).setRegionValues({A: 25}, new LUT({steps: [{value: 0, color: ColorRGBA(0, 0, 255)}, {value: 50, color: ColorRGBA(255, 0, 0)}]}));
  const {ctx, calls} = context(), clicks: MapRegionClick[] = []; chart.onRegionClick(event => clicks.push(event)); chart.render(ctx);
  assert.deepEqual(calls.fills[0], ['evenodd']); assert.equal(calls.colors[0], 'rgba(128, 0, 128, 1)');
  const region = chart.positionToScreen([1, 1]), cutout = chart.positionToScreen([5, 5]);
  chart.activateAt(cutout); assert.equal(clicks.length, 0); assert.equal(chart.getSelectedRegion(), undefined);
  chart.activateAt(region); assert.equal(chart.getSelectedRegion(), 'A'); assert.equal(clicks[0].value, 25); assert.equal(clicks[0].selected, true);
  (clicks[0].feature.geometry as any).coordinates[0][0][0] = 100;
  assert.equal((chart.getGeoJSON().features[0].geometry as any).coordinates[0][0][0], 0);
  chart.hoverAt(region); chart.render(ctx); assert.ok(calls.text.includes('Alpha')); assert.ok(calls.text.includes('25'));
  chart.activateAt(region); assert.equal(chart.getSelectedRegion(), undefined); assert.equal(clicks[1].selected, false);
});

test('MultiPolygon components around the antimeridian fit together and select one region', () => {
  const chart = new MapChart({...options, projection: 'equirectangular'}).setGeoJSON({type: 'FeatureCollection', features: [{type: 'Feature', properties: {code: 'FJ'}, geometry: {type: 'MultiPolygon', coordinates: [[[[178, -2], [180, -2], [180, 2], [178, 2], [178, -2]]], [[[-180, -2], [-178, -2], [-178, 2], [-180, 2], [-180, -2]]]]}}]}, {key: 'code'});
  const west = chart.positionToScreen([179, 0]), east = chart.positionToScreen([-179, 0]); assert.ok(Math.abs(west.x - east.x) < chart.width / 2);
  const {ctx} = context(); chart.render(ctx); chart.activateAt(west); assert.equal(chart.getSelectedRegion(), 'FJ'); chart.activateAt(east); assert.equal(chart.getSelectedRegion(), undefined);
  const center = Math.abs(chart.getView().center.longitude); near(center, 180);
});

test('zoom holds the geographic anchor stationary and panning moves projected positions by pixels', () => {
  const chart = new MapChart(options).setGeoJSON(geoJSON()), anchor = {x: 220, y: 130}, before = chart.screenToPosition(anchor);
  chart.zoomAt(anchor, 2); const after = chart.screenToPosition(anchor); near(after[0], before[0]); near(after[1], before[1]); assert.equal(chart.getView().zoom, 2);
  const position = chart.positionToScreen([1, 1]); chart.panBy(30, -20); const moved = chart.positionToScreen([1, 1]); near(moved.x - position.x, 30); near(moved.y - position.y, -20);
  chart.fit(); assert.equal(chart.getView().zoom, 1); chart.setProjection('equirectangular'); assert.equal(chart.getProjection(), 'equirectangular');
  assert.throws(() => chart.zoomAt(anchor, 0), /positive/); assert.throws(() => chart.panBy(Infinity, 0), /finite/);
});

test('point and line overlays retain original coordinates and provide separate picking and disposal', () => {
  const chart = new MapChart(options).setGeoJSON(geoJSON()), input = [{longitude: 2, latitude: 2, name: 'Port', value: 7}], original = JSON.stringify(input);
  const line = chart.addLineSeries().setName('Route').add([[179, 0], [-179, 0]]), points = chart.addPointSeries().setName('Ports').add(input).setPointSize(12).setPointFillStyle(new SolidFill({color: ColorRGBA(0, 255, 0)}));
  const projected = line.projected('mercator').points; near(projected[1].x - projected[0].x, 2 / 360); assert.deepEqual(line.getPoints(), [[179, 0], [-179, 0]]);
  const events: any[] = []; chart.on('overlayclick', event => events.push(event)); const {ctx, calls} = context(); chart.render(ctx); assert.equal(calls.arcs, 1);
  chart.activateAt(chart.positionToScreen([2, 2])); assert.equal(events.length, 1); assert.equal(events[0].series, points); assert.equal(events[0].point.name, 'Port');
  chart.panBy(20, 5).zoomAt({x: 300, y: 200}, 1.2); assert.equal(JSON.stringify(input), original); assert.equal(line.projected('mercator').points, projected);
  assert.throws(() => points.add([{x: 3, y: 3}, {x: 4, y: Infinity}]), /finite/); assert.equal(points.getSampleCount(), 1);
  points.dispose(); assert.equal(chart.getSeries().length, 1); assert.throws(() => points.add(input), /disposed/);
  chart.dispose(); assert.equal(line.isDisposed(), true); assert.equal(chart.getSeries().length, 0);
});

test('drag panning suppresses the following click, while wheel zoom and later clicks remain active', () => {
  const chart = new InteractiveMap(options).setGeoJSON(geoJSON()), {ctx} = context(); chart.render(ctx);
  chart.drag([{x: 300, y: 200}, {x: 330, y: 210}]); chart.render(ctx);
  const hit = chart.positionToScreen([1, 1]); chart.activateAt(hit); assert.equal(chart.getSelectedRegion(), undefined);
  chart.activateAt(hit); assert.equal(chart.getSelectedRegion(), 'A'); const previous = chart.getView().zoom;
  assert.equal(chart.zoomWheel(hit, -100), true); assert.ok(chart.getView().zoom > previous);
});

test('pan redraws reuse formatted region labels and null values clear choropleth data', () => {
  let calls = 0; const chart = new MapChart(options).setGeoJSON(geoJSON()).setTooltipFormatter((_feature, value, key) => {calls++; return `${key}: ${value}`;});
  const {ctx} = context(); chart.render(ctx); chart.panBy(5, 2); chart.render(ctx); assert.equal(calls, 1);
  chart.setRegionValues({A: 12}); assert.equal(calls, 2); assert.equal(chart.getRegionValue('A'), 12);
  chart.setRegionValues(new Map([['A', null]])); assert.equal(chart.getRegionValue('A'), undefined);
  assert.throws(() => chart.setRegionValues({A: NaN}), /finite/); assert.equal(chart.getRegionValue('A'), undefined);
});

test('point-only fitting aligns dateline neighbors and preserves per-point immutable colors', () => {
  const chart = new MapChart(options), red = ColorRGBA(255, 0, 0), input = [{longitude: 179, latitude: 0, color: red}, {longitude: -179, latitude: 0}];
  const points = chart.addPointSeries().add(input); chart.fit();
  near(Math.abs(chart.getView().center.longitude), 180);
  const left = chart.positionToScreen([179, 0]), right = chart.positionToScreen([-179, 0]);
  assert.ok(left.x >= 18 && right.x <= chart.width - 18);
  const {ctx, calls} = context(); chart.render(ctx); assert.equal(calls.arcs, 2); assert.equal(calls.colors[0], red.toCSS());
  assert.equal((points.getPoints()[0] as any).color, red); assert.equal(input[0].longitude, 179);
  chart.dispose(); assert.equal(chart.getSelectedRegion(), undefined);
});
