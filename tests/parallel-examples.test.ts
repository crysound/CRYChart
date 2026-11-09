import test from 'node:test';
import assert from 'node:assert/strict';
import {ParallelCoordinateChart, DataGrid, BarChart, SpecialtyChart, formatParallelDuration} from '../src/specialty.js';
import {ChartXY} from '../src/chart.js';
import {ColorHEX, LUT, Themes} from '../src/core/styles.js';
import {parallelEntries, parallelFixtures, heavyParallelData, lookupParallelData, trainingParallelData, streamingParallelRow, carParallelData, parallelQuartiles, summarizeCars} from '../examples/official/parallel.js';

const options = {headless: true, width: 1000, height: 600};
const near = (a: number, b: number, tolerance = 1e-6) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
function recording() {
  const calls = {lines: 0, curves: 0, fills: 0, text: [] as Array<{text: string; x: number; y: number}>, strokes: [] as unknown[], gradients: 0};
  const check = (...values: number[]) => values.forEach(value => assert.ok(Number.isFinite(value), `nonfinite coordinate ${value}`));
  const ctx = {
    save() {}, restore() {}, beginPath() {}, closePath() {}, clip() {}, setLineDash() {},
    setTransform(...values: number[]) {check(...values);}, clearRect(...values: number[]) {check(...values);},
    fillRect(...values: number[]) {check(...values); calls.fills++;}, strokeRect(...values: number[]) {check(...values);}, rect(...values: number[]) {check(...values);},
    roundRect(x: number, y: number, w: number, h: number, r: number | number[]) {check(x, y, w, h, ...(Array.isArray(r) ? r : [r]));},
    moveTo(...values: number[]) {check(...values);}, lineTo(...values: number[]) {check(...values); calls.lines++;}, bezierCurveTo(...values: number[]) {check(...values); calls.curves++;},
    translate(...values: number[]) {check(...values);}, rotate(...values: number[]) {check(...values);},
    arc(...values: any[]) {check(...values.filter(value => typeof value === 'number'));}, fill() {calls.fills++;}, stroke() {calls.strokes.push((this as any).strokeStyle);},
    measureText(value: string) {return {width: value.length * 6};}, fillText(text: string, x: number, y: number, ...rest: number[]) {check(x, y, ...rest); calls.text.push({text, x, y});}, strokeText(_value: string, ...rest: number[]) {check(...rest);},
    createLinearGradient(...values: number[]) {check(...values); calls.gradients++; return {addColorStop(offset: number) {assert.ok(offset >= 0 && offset <= 1);}};},
  } as unknown as CanvasRenderingContext2D;
  return {ctx, calls};
}
class InteractiveParallel extends ParallelCoordinateChart {
  hoverAt(point: {x: number; y: number}) {this.pointer = point; this.hovered = [...this.hits].reverse().find(hit => hit.contains(point));}
  drag(points: Array<{x: number; y: number}>) {points.forEach(point => this.dragAt(point)); this.endDragAt(points.at(-1)!); this.activateAt(points.at(-1)!);}
}
class InteractiveGrid extends DataGrid {scrollWheel(delta: number) {return this.wheel(delta);} press(key: string) {return this.key(key);}}

test('outer parallel axis titles fit within the canvas while middle titles stay centered', () => {
  const chart = new ParallelCoordinateChart(options).setData([{first_variable: 1, center: 2, embedding_dim: 3}], ['first_variable', 'center', 'embedding_dim']);
  const {ctx, calls} = recording(); chart.render(ctx);
  for (const name of chart.dimensions) {const label = calls.text.find(item => item.text === name)!; assert.ok(label); assert.ok(label.x - name.length * 3 >= 4); assert.ok(label.x + name.length * 3 <= options.width - 4);}
  near(calls.text.find(item => item.text === 'center')!.x, chart.getAxisScreenPosition('center', 2)!.x); chart.dispose();
});

class ElementStub {
  style: Record<string, any> = {}; dataset: Record<string, string> = {}; children: ElementStub[] = []; parent?: ElementStub; clientWidth = 1000; clientHeight = 600;
  listeners = new Map<string, Set<(value: any) => void>>();
  constructor(readonly tag: string) {}
  append(...children: ElementStub[]) {children.forEach(child => {child.parent = this; this.children.push(child);});} appendChild(child: ElementStub) {this.append(child);}
  remove() {if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.parent = undefined;}
  setAttribute() {} addEventListener(name: string, listener: (value: any) => void) {const listeners = this.listeners.get(name) ?? new Set(); listeners.add(listener); this.listeners.set(name, listeners);} removeEventListener(name: string, listener: (value: any) => void) {this.listeners.get(name)?.delete(listener);}
  getBoundingClientRect() {return {left: 10, top: 20, width: 1000, height: 600};} getContext() {return null;}
  dispatch(name: string, event: any) {this.listeners.get(name)?.forEach(listener => listener(event));}
}
function dom<T>(run: (host: ElementStub) => T): T {const previous = globalThis.document, host = new ElementStub('host'); Object.assign(globalThis, {document: {createElement: (name: string) => new ElementStub(name), body: host}}); try {return run(host);} finally {if (previous === undefined) Reflect.deleteProperty(globalThis, 'document'); else Object.assign(globalThis, {document: previous});}}
function mount(id: string, host: ElementStub) {const constructors: Record<string, any> = {ParallelCoordinateChart, DataGrid, BarChart}; const engine = Object.fromEntries(Object.entries(constructors).map(([key, Constructor]) => [key, (args: any) => new Constructor({...args, ...options})])); engine.ChartXY = (args: any) => {const doc = globalThis.document; Reflect.deleteProperty(globalThis, 'document'); try {return new ChartXY(args);} finally {Object.assign(globalThis, {document: doc});}}; return parallelEntries.find(entry => entry.id.includes(`-${id}-`))!.mount!({host: host as unknown as HTMLElement, engine, theme: Themes.darkGold});}

test('mixed numeric, categorical, datetime and duration axes preserve source values and filter with AND semantics', () => {
  const first = new Date('2020-01-01T00:00:00Z'), second = new Date('2022-01-01T00:00:00Z'), input = [{id: 1, score: 20, brand: 'A', date: first, elapsed: 60_000}, {id: 2, score: 80, brand: 'B', date: second, elapsed: 5_520_000}, {id: 3, score: NaN, brand: 'A', date: second, elapsed: 0}];
  const chart = new ParallelCoordinateChart(options).setData(input, ['score', 'brand', 'date', 'elapsed']).setAxisOptions('score', {range: {start: 0, end: 100}}).setAxisOptions('brand', {type: 'category', categories: ['A', 'B']}).setAxisOptions('date', {type: 'datetime'}).setAxisOptions('elapsed', {type: 'duration'});
  assert.deepEqual(chart.getAxisDomain('brand')?.categories, ['A', 'B']); assert.equal(chart.getData()[0].date.getTime(), first.getTime()); assert.notEqual(chart.getData()[0].date, first);
  chart.setRangeFilter('brand', {start: 'B', end: 'B'}).setRangeFilter('date', {start: new Date('2021-01-01Z'), end: new Date('2023-01-01Z')}); assert.deepEqual(chart.getFilteredData().map(row => row.id), [2]);
  chart.setRangeFilter('score', {start: 0, end: 50}); assert.equal(chart.getFilteredCount(), 0); chart.clearRangeFilters().setRangeFilter('score', {start: 0, end: 100}); assert.deepEqual(chart.getFilteredData().map(row => row.id), [1, 2]);
  assert.ok(Number.isNaN(input[2].score)); assert.equal(input[0].date, first); assert.equal(formatParallelDuration(5_520_000), '01:32:00'); chart.dispose();
});

test('actual range selector drag changes bounds, keeps source rows, and double click removes the filter', () => {
  const chart = new InteractiveParallel(options).setData(Array.from({length: 11}, (_, id) => ({id, x: id * 10, y: 100 - id * 10})), ['x', 'y']).setAxisOptions('x', {range: {start: 0, end: 100}}).setAxisOptions('y', {range: {start: 0, end: 100}}).setRangeSelectorsEnabled(true);
  const {ctx} = recording(); chart.render(ctx); let changes = 0; chart.on('filterchange', () => changes++);
  chart.doubleClickAt(chart.getAxisScreenPosition('x', 50)!); assert.deepEqual(chart.getRangeFilters().x, {start: 40, end: 60}); assert.equal(chart.getFilteredCount(), 3);
  chart.drag([chart.getAxisScreenPosition('x', 60)!, chart.getAxisScreenPosition('x', 80)!]); near(chart.getRangeFilters().x.end, 80); assert.equal(chart.getFilteredCount(), 5);
  chart.drag([chart.getAxisScreenPosition('x', 60)!, chart.getAxisScreenPosition('x', 70)!]); near(chart.getRangeFilters().x.start, 50); near(chart.getRangeFilters().x.end, 90);
  chart.doubleClickAt(chart.getAxisScreenPosition('x', 60)!); assert.deepEqual(chart.getRangeFilters(), {}); assert.equal(chart.getSampleCount(), 11); assert.ok(changes >= 4); chart.dispose();
});

test('smooth row picking uses the drawn curve, retains hover tooltip after redraw and honors NaN gaps', () => {
  const chart = new InteractiveParallel(options).setData([{id: 'rise', a: 0, b: 100, c: 0}, {id: 'gap', a: 80, b: NaN, c: 80}], ['a', 'b', 'c']).setInterpolation('smooth'); ['a', 'b', 'c'].forEach(key => chart.setAxisOptions(key, {range: {start: 0, end: 100}}));
  const first = recording(); chart.render(first.ctx); assert.equal(first.calls.curves, 2);
  const a = chart.getAxisScreenPosition('a', 0)!, b = chart.getAxisScreenPosition('b', 100)!, point = {x: (a.x + b.x) / 2, y: (a.y + b.y) / 2};
  assert.equal(chart.activateAt(point)?.id, 'rise'); chart.hoverAt(point); const second = recording(); chart.render(second.ctx); assert.ok(second.calls.text.some(text => text.text === 'Sample 1')); assert.ok(second.calls.text.some(text => text.text === 'b: 100'));
  chart.clear().setData([{id: 'gap', a: 80, b: NaN, c: 80}], ['a', 'b', 'c']); const third = recording(); chart.render(third.ctx); assert.equal(third.calls.curves, 0); chart.dispose();
});

test('projection revisions are cached and large data sets are never silently truncated to 512', () => {
  const input = heavyParallelData(), chart = new ParallelCoordinateChart(options).setData(input, parallelFixtures.heavyDimensions).setLineColor('#ffff00').setLineOpacity(.02), {ctx} = recording();
  chart.render(ctx); const projected = chart.renderStats.projectionBuilds, paths = chart.renderStats.pathBuilds; assert.equal(chart.getSampleCount(), 8192); assert.equal(chart.renderStats.renderedSegments, 8192 * 11);
  chart.render(ctx); assert.equal(chart.renderStats.projectionBuilds, projected); assert.equal(chart.renderStats.pathBuilds, paths);
  chart.setRangeFilter('pool_size', {start: 2, end: 2}); chart.render(ctx); assert.equal(chart.renderStats.projectionBuilds, projected); assert.equal(chart.renderStats.pathBuilds, paths); assert.ok(chart.getFilteredCount() > 512);
  chart.addData([input[0]]); chart.render(ctx); assert.equal(chart.renderStats.projectionBuilds, projected + 1); chart.dispose();
});

test('LUT color, axis threshold segments and color legend produce actual canvas draws', () => {
  const lut = new LUT({steps: [{value: 0, color: ColorHEX('#ff0000')}, {value: 1, color: ColorHEX('#00ff00')}]}), chart = new ParallelCoordinateChart(options).setData([{a: 0, b: 0}, {a: 1, b: 1}], ['a', 'b']).setColorMapping('b', lut).setThresholds('a', [{start: .5, end: 1, color: '#123456'}]);
  const {ctx, calls} = recording(); chart.render(ctx); assert.ok(calls.strokes.includes('rgba(255, 0, 0, 1)')); assert.ok(calls.strokes.includes('rgba(0, 255, 0, 1)')); assert.ok(calls.strokes.includes('#123456')); assert.equal(calls.gradients, 1);
  assert.throws(() => chart.setRangeFilter('missing', {start: 0, end: 1}), /Unknown/); assert.throws(() => chart.setThresholds('a', [{start: Infinity, end: 2}]), /finite/); chart.dispose();
});

test('streaming retention drops full old rows while logical sample indices and raw NaN values remain valid', () => {
  const chart = new ParallelCoordinateChart(options).setData(Array.from({length: 5}, (_, i) => streamingParallelRow(i)), ['A', 'B', 'C', 'D', 'E']).setMaxSampleCount(4).setSelectedRow(2);
  chart.addData(Array.from({length: 10}, (_, i) => streamingParallelRow(i + 5))); assert.equal(chart.getNextSampleIndex(), 15); assert.deepEqual(chart.getData().map(row => row.id), [11, 12, 13, 14]); assert.equal(chart.getSelectedRow(), undefined);
  chart.addData([{id: 15, A: NaN, B: 1, C: 2, D: 3, E: 4}]); assert.ok(Number.isNaN(chart.getData().at(-1)!.A)); chart.clear(); assert.equal(chart.getNextSampleIndex(), 0); assert.equal(chart.getSampleCount(), 0); chart.dispose();
});

test('DataGrid sorting, formatting, scroll and preserved row selection do not mutate caller records', () => {
  const data = Array.from({length: 40}, (_, id) => ({id, accuracy: id / 40, when: new Date(Date.UTC(2020, 0, id + 1))})), grid = new InteractiveGrid({...options, width: 500, height: 220}).setData(data, ['accuracy', 'when']).setColumnFormatter('accuracy', value => value.toFixed(3)).setScrollbarVisible(true).setRowId('id').setSelectedRow(5).sortBy('accuracy', false);
  assert.equal(grid.getData()[0].id, 39); assert.equal(data[0].id, 0); grid.scrollWheel(100); assert.equal(grid.scrollOffset, 3); grid.press('End'); assert.ok(grid.scrollOffset > 30); grid.press('Home'); assert.equal(grid.scrollOffset, 0);
  const {ctx, calls} = recording(); grid.render(ctx); assert.ok(calls.text.some(text => text.text === '0.975')); assert.ok(calls.text.some(text => text.text === '▲'));
  grid.activateAt({x: 40, y: 25}); assert.equal(grid.getSelectedRow()?.id, 5); grid.render(ctx); const rowPosition = grid.getRowScreenPosition(0); assert.ok(rowPosition); grid.activateAt(rowPosition); assert.equal(grid.getSelectedRow()?.id, 0); grid.setSelectedRow(5);
  grid.setData(data.slice(0, 20), ['accuracy', 'when'], {preserveSelection: true}); assert.equal(grid.getSelectedRow()?.id, 5); grid.sortBy('when', true); assert.equal(grid.getData()[0].id, 0); grid.dispose();
});

test('official range/table mount filters the actual grid and row selection highlights the same curve', () => dom(host => {
  const mounted = mount('1705', host), chart = mounted.charts[0] as ParallelCoordinateChart, grid = mounted.charts[1] as DataGrid;
  assert.equal(grid.getRowCount(), chart.getFilteredCount()); assert.equal(grid.getData()[0].accuracy, .961);
  chart.setRangeFilter('batch_size', {start: 450, end: 600}); assert.ok(grid.getData().every(row => row.batch_size >= 450)); assert.equal(grid.getRowCount(), chart.getFilteredCount());
  const {ctx} = recording(); grid.render(ctx); const position = grid.getRowScreenPosition(grid.getData()[0].id)!; const selected = grid.activateAt(position); assert.equal(chart.getSelectedRow()?.id, selected.id); grid.activateAt(position); assert.equal(chart.getSelectedRow(), undefined);
  mounted.dispose!(); mounted.charts.forEach(chart => chart.dispose()); assert.equal(host.children.length, 0);
}));

test('linked car dashboard recomputes all four bottom panels from the same filtered raw records', () => dom(host => {
  const mounted = mount('1707', host), chart = mounted.charts[0] as ParallelCoordinateChart, original = carParallelData();
  chart.setRangeFilter('Price', {start: 90, end: 100}); const rows = chart.getFilteredData() as any[], state = mounted.snapshot!() as any, expected = summarizeCars(rows);
  assert.equal(state.selectedCars, rows.length); assert.equal(state.scatterSamples, rows.length); assert.deepEqual(state.manufacturerCounts, expected.counts); assert.deepEqual(state.averages, expected.averages);
  assert.equal(state.manufacturerCounts.reduce((sum: number, row: any) => sum + row.fuels.reduce((a: number, b: number) => a + b, 0), 0), rows.length);
  assert.deepEqual(original, carParallelData()); chart.setRangeFilter('Price', {start: -10, end: -1}); const empty = mounted.snapshot!() as any; assert.equal(empty.selectedCars, 0); assert.equal(empty.scatterSamples, 0); assert.deepEqual(empty.boxes, [0, 0, 0, 0]);
  mounted.dispose!(); mounted.charts.forEach(chart => chart.dispose()); assert.equal(host.children.length, 0);
}));

test('quartiles distinguish outliers and fixture categories are derived consistently', () => {
  const source = [100, 2, 3, 4, 1], stats = parallelQuartiles(source)!; assert.deepEqual(stats, {min: 1, lowerQuartile: 2, median: 3, upperQuartile: 4, max: 4, outliers: [100]}); assert.deepEqual(source, [100, 2, 3, 4, 1]); assert.equal(parallelQuartiles([]), undefined);
  const data = trainingParallelData(); assert.ok(data.every(row => row['Short or long'] === (row['Miles run'] < 5 ? '< 5 miles' : '> 5 miles'))); assert.ok(data.every(row => row['Time period'] === (row['Training date'].getTime() < Date.UTC(2020, 0, 1) ? 'Before 2020' : 'After 2020'))); assert.equal(lookupParallelData().length, 80);
});

test('all eight independent candidates mount real charts with finite draws and retained provenance', () => dom(host => {
  assert.equal(parallelEntries.length, 8); for (const entry of parallelEntries) {const mounted = mount(entry.id.match(/-(\d{4})-/)![1], host); for (const chart of mounted.charts) if (chart instanceof SpecialtyChart) {const {ctx} = recording(); chart.render(ctx);} mounted.update?.(2, 1); assert.ok(mounted.snapshot!().dataProvenance); mounted.dispose!(); mounted.charts.forEach(chart => chart.dispose()); assert.equal(host.children.length, 0);}
}));

test('DOM double click and pointer drag dispatch into the actual range filter implementation', () => dom(host => {
  const chart = new ParallelCoordinateChart({container: host as unknown as HTMLElement, width: 1000, height: 600}).setData([{a: 0, b: 0}, {a: 50, b: 50}, {a: 100, b: 100}], ['a', 'b']).setRangeSelectorsEnabled(true), canvas = host.children[0];
  const {ctx} = recording(); chart.render(ctx); const point = chart.getAxisScreenPosition('a', 50)!; canvas.dispatch('dblclick', {clientX: point.x + 10, clientY: point.y + 20}); assert.equal(chart.getFilteredCount(), 1);
  const end = chart.getAxisScreenPosition('a', 60)!, moved = chart.getAxisScreenPosition('a', 100)!; canvas.dispatch('pointerdown', {clientX: end.x + 10, clientY: end.y + 20, pointerId: 1}); canvas.dispatch('pointermove', {clientX: moved.x + 10, clientY: moved.y + 20, pointerId: 1}); canvas.dispatch('pointerup', {clientX: moved.x + 10, clientY: moved.y + 20, pointerId: 1}); near(chart.getRangeFilters().a.end, 100); assert.equal(chart.getFilteredCount(), 2); chart.dispose();
}));
