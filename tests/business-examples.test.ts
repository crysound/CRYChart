import test from 'node:test';
import assert from 'node:assert/strict';
import {businessEntries, businessFixtures, businessHourLabel, dashboardSample, animatedRadarFrame, companySectors, marketplaceTreeAt, pythonInstallationTree} from '../examples/official/business.js';
import {BarChart, Gauge, Pie, Spider, SpecialtyChart, TreeMapChart, type TreeMapNode} from '../src/specialty.js';
import {ChartXY} from '../src/chart.js';
import {Themes} from '../src/core/styles.js';

const options = {headless: true, width: 800, height: 500};
const near = (a: number, b: number, tolerance = 1e-7) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
function recording() {
  const calls = {text: [] as Array<{value: string; x: number; y: number}>, rectangles: [] as number[][], arcs: [] as number[][], fills: 0, lines: [] as number[][]};
  const check = (...values: number[]) => values.forEach(value => assert.ok(Number.isFinite(value), `non-finite drawing coordinate ${value}`));
  const ctx = {
    save() {}, restore() {}, setLineDash() {}, beginPath() {}, closePath() {}, clip() {}, stroke() {},
    setTransform(...values: number[]) {check(...values);}, clearRect(...values: number[]) {check(...values);},
    fillRect(...values: number[]) {check(...values); calls.rectangles.push(values);}, strokeRect(...values: number[]) {check(...values);},
    moveTo(...values: number[]) {check(...values); calls.lines.push(values);}, lineTo(...values: number[]) {check(...values); calls.lines.push(values);},
    rect(...values: number[]) {check(...values);}, roundRect(x: number, y: number, width: number, height: number, radius: number | number[]) {check(x, y, width, height, ...(Array.isArray(radius) ? radius : [radius])); calls.rectangles.push([x, y, width, height]);},
    translate(...values: number[]) {check(...values);}, rotate(...values: number[]) {check(...values);},
    arc(...values: any[]) {check(...values.filter(value => typeof value === 'number')); calls.arcs.push(values);},
    fill() {calls.fills++;}, measureText(value: string) {return {width: value.length * 6};},
    fillText(value: string, x: number, y: number, ...rest: number[]) {check(x, y, ...rest); calls.text.push({value, x, y});}, strokeText(_value: string, ...values: number[]) {check(...values);},
    createLinearGradient(...values: number[]) {check(...values); return {addColorStop(offset: number) {assert.ok(offset >= 0 && offset <= 1);}};},
  } as unknown as CanvasRenderingContext2D;
  return {ctx, calls};
}

/** Minimal DOM for candidate controls only. Chart instances use their actual Node data paths. */
class ElementStub {
  style: Record<string, any> = {}; dataset: Record<string, string> = {}; attributes = new Map<string, string>(); children: ElementStub[] = []; parent?: ElementStub;
  listeners = new Map<string, Set<(event: any) => void>>(); clientWidth = 800; clientHeight = 500; width = 0; height = 0;
  constructor(readonly tag: string, readonly text = '') {}
  append(...elements: ElementStub[]) {for (const element of elements) {element.parent = this; this.children.push(element);}}
  appendChild(element: ElementStub) {this.append(element); return element;}
  remove() {if (this.parent) {this.parent.children = this.parent.children.filter(child => child !== this); this.parent = undefined;}}
  setAttribute(name: string, value: string) {this.attributes.set(name, value);}
  addEventListener(name: string, listener: (event: any) => void) {const set = this.listeners.get(name) ?? new Set(); set.add(listener); this.listeners.set(name, set);}
  removeEventListener(name: string, listener: (event: any) => void) {this.listeners.get(name)?.delete(listener);}
  dispatch(name: string, event: any = {}) {this.listeners.get(name)?.forEach(listener => listener(event));}
  getBoundingClientRect() {return {left: 30, top: 40, width: 800, height: 500};}
  getContext() {return null;}
  find(tag: string): ElementStub[] {return [...(this.tag === tag ? [this] : []), ...this.children.flatMap(child => child.find(tag))];}
}
function dom<T>(run: (host: ElementStub) => T): T {
  const previous = globalThis.document, host = new ElementStub('host');
  Object.assign(globalThis, {document: {createElement: (tag: string) => new ElementStub(tag), createTextNode: (value: string) => new ElementStub('#text', value), body: host}});
  try {return run(host);} finally {if (previous === undefined) Reflect.deleteProperty(globalThis, 'document'); else Object.assign(globalThis, {document: previous});}
}
function mount(id: string, host: ElementStub) {
  const constructors: Record<string, any> = {BarChart, Gauge, Pie, Spider, TreeMapChart};
  const engine = Object.fromEntries(Object.entries(constructors).map(([name, Constructor]) => [name, (value: any) => new Constructor({...value, ...options})]));
  engine.ChartXY = (value: any) => {const document = globalThis.document; Reflect.deleteProperty(globalThis, 'document'); try {return new ChartXY(value);} finally {Object.assign(globalThis, {document});}};
  const entry = businessEntries.find(entry => entry.id.includes(`-${id}-`)); assert.ok(entry?.mount, `missing mount ${id}`);
  return entry.mount({host: host as unknown as HTMLElement, engine, theme: Themes.darkGold});
}
function flatten(nodes: TreeMapNode[], prefix = ''): Array<{path: string; value?: number}> {return nodes.flatMap(node => {const path = prefix + '/' + node.name; return [{path, value: node.value}, ...flatten(node.children ?? [], path)];});}

test('observed business fixtures retain signs, percentages, visitor total and distinct room reservations', () => {
  assert.deepEqual(businessFixtures.electricity, [20, 20, -25, 40, 28, -23, -40, 35, 17, 24, -29, 15]);
  assert.equal(businessFixtures.temperatures.length, 15); assert.ok(businessFixtures.temperatures.every((row, i, all) => i === 0 || all[i - 1][1] >= row[1]));
  const total = businessFixtures.projectTime.reduce((sum, item) => sum + item.value, 0);
  assert.deepEqual(businessFixtures.projectTime.map(item => (item.value / total * 100).toFixed(2)), ['11.98', '35.93', '17.96', '7.19', '26.95']);
  assert.equal(businessFixtures.visitors.reduce((sum, item) => sum + item.value, 0), 74199);
  assert.equal(businessFixtures.reservations.length, 9); assert.equal(new Set(businessFixtures.reservations.map(item => item.row)).size, 7);
  assert.deepEqual(businessFixtures.reservations.filter(item => item.row === 0).map(item => [item.start, item.end]), [[10, 13], [16, 18]]);
  assert.equal(businessHourLabel(0), '12AM'); assert.equal(businessHourLabel(12), '12PM'); assert.equal(businessHourLabel(20), '8PM');
});

test('horizontal value ticks advance across the top while range bars retain separate positions on one row', () => {
  const chart = new BarChart(options).setHorizontal(true).setCategories(['Shared room']).setValueInterval({start: 8, end: 20}).setTickCount(12).setValueFormatter(businessHourLabel).setValueAxisPlacement('start').setGridVisible(false)
    .setData([{category: 'Shared room', row: 0, start: 10, value: 3, label: 'First'}, {category: 'Shared room', row: 0, start: 16, value: 2, label: 'Second'}]);
  const {ctx, calls} = recording(); chart.render(ctx);
  const firstTick = calls.text.find(text => text.value === '8AM')!, lastTick = calls.text.find(text => text.value === '8PM')!;
  assert.ok(lastTick.x > firstTick.x); near(firstTick.y, lastTick.y);
  const rectangles = calls.rectangles.slice(1); assert.equal(rectangles.length, 2); near(rectangles[0][1], rectangles[1][1]); near(rectangles[0][2] / rectangles[1][2], 1.5);
  for (let i = 0; i < 2; i++) {const [x, y, width, height] = rectangles[i]; assert.equal(chart.activateAt({x: x + width / 2, y: y + height / 2})?.label, i ? 'Second' : 'First');}
  assert.equal(chart.activateAt({x: (rectangles[0][0] + rectangles[0][2] + rectangles[1][0]) / 2, y: rectangles[0][1] + 10}), undefined);
  const copy = chart.getData(); copy[0].start = 0; assert.equal(chart.getData()[0].start, 10); chart.dispose();
});

test('radar independent axis domains place different magnitudes at the same radius', () => {
  const chart = new Spider(options).setGridShape('circle').setTickCount(4).setTickLabels('all');
  const data = [{name: 'Percent', value: 100}, {name: 'Seconds', value: 10}, {name: 'Count', value: 1000}]; chart.addSeries().setData(data);
  data.forEach(item => chart.setAxisRange(item.name, {start: 0, end: item.value}));
  const {ctx, calls} = recording(); chart.render(ctx); const rings = calls.arcs.filter(arc => arc[2] > 3), markers = calls.arcs.filter(arc => arc[2] === 3);
  assert.equal(rings.length, 4); assert.equal(markers.length, 3); const outer = rings.at(-1)!;
  markers.forEach(point => near(Math.hypot(point[0] - outer[0], point[1] - outer[1]), outer[2]));
  assert.deepEqual(data.map(item => item.value), [100, 10, 1000]); chart.dispose();
});

test('pie and donut controls update actual slice visibility and center totals', () => dom(host => {
  const mounted = mount('0451', host), chart = mounted.charts[0] as Pie; const a = recording(); chart.render(a.ctx);
  assert.ok(a.calls.text.some(text => text.value === 'Total: 74199 visitors')); assert.equal(host.find('button').length, 6);
  host.find('button')[0].dispatch('click'); assert.equal(chart.slices[0].getVisible(), false);
  const b = recording(); chart.render(b.ctx); assert.ok(b.calls.text.some(text => text.value === 'Total: 59199 visitors'));
  assert.equal(mounted.snapshot!().total, 59199); mounted.dispose!(); chart.dispose(); assert.equal(host.children.length, 0);
}));

test('270 degree gauge preserves endpoints and places a half-value cursor at the top', () => {
  const gauge = new Gauge(options).setInterval({start: 0, end: 120}).setArc(135, 270).setProgressVisible(false).setCursorStyle('arc').setValueLabelPosition('center').setUnitLabel('km/h').setValue(60);
  const {ctx, calls} = recording(); gauge.render(ctx); assert.equal(calls.arcs.length, 1); near(calls.arcs[0][4] - calls.arcs[0][3], Math.PI * 1.5);
  const [cx, cy] = calls.arcs[0]; calls.lines.forEach(point => {near(point[0], cx); assert.ok(point[1] < cy);});
  assert.ok(calls.text.some(text => text.value === '0')); assert.ok(calls.text.some(text => text.value === '120')); assert.ok(calls.text.some(text => text.value === 'km/h')); gauge.dispose();
});

test('narrow dashboard gauges reserve horizontal room for endpoint tick text outside a thick arc', () => {
  const gauge = new Gauge({...options, width: 190, height: 125}).setPadding(4).setInterval({start: 0, end: 100}).setArc(-180, 180).setArcThickness(.28).setTickValues([0, 33, 67, 100]);
  const {ctx, calls} = recording(); gauge.render(ctx);
  for (const value of ['0', '100']) {const text = calls.text.find(text => text.value === value)!; assert.ok(text.x - value.length * 6 / 2 >= 4); assert.ok(text.x + value.length * 6 / 2 <= 186);}
  gauge.dispose();
});

test('hierarchy updates preserve a live path, nested labels and defensive copies', () => {
  const chart = new TreeMapChart(options).setHierarchyDepth(4).setData(companySectors()), {ctx, calls} = recording(); chart.render(ctx);
  assert.ok(calls.text.some(text => text.value === 'TECHNOLOGY')); assert.ok(calls.text.some(text => text.value === 'NVDA'));
  const heading = calls.text.find(text => text.value === 'TECHNOLOGY')!; chart.activateAt({x: heading.x + 2, y: heading.y + 2}); assert.deepEqual(chart.getPath(), ['TECHNOLOGY']);
  const b = recording(); chart.render(b.ctx); assert.ok(b.calls.text.some(text => text.value.includes('Go Back'))); chart.activateAt({x: 16, y: 16}); assert.deepEqual(chart.getPath(), []);
  chart.setData(marketplaceTreeAt()).drillDown('Smartphones'); assert.deepEqual(chart.getPath(), ['Electronics', 'Mobile Phones', 'Smartphones']);
  chart.setData(marketplaceTreeAt(8), {preservePath: true}); assert.deepEqual(chart.getPath(), ['Electronics', 'Mobile Phones', 'Smartphones']);
  const copied = chart.getData(); copied[0].name = 'Changed'; assert.notEqual(chart.getData()[0].name, 'Changed');
  const previous = chart.getData(); assert.throws(() => chart.setData({name: 'Bad', value: Infinity}), /finite/); assert.deepEqual(chart.getData(), previous);
  chart.dispose();
});

test('independent dynamic fixtures stay finite, positive and preserve hierarchy identities', () => {
  const start = flatten(marketplaceTreeAt()), later = flatten(marketplaceTreeAt(8));
  assert.deepEqual(start.map(item => item.path).sort(), later.map(item => item.path).sort());
  assert.notDeepEqual(start.map(item => item.value), later.map(item => item.value)); assert.ok(later.every(item => item.value === undefined || Number.isFinite(item.value) && item.value > 0));
  const files = pythonInstallationTree(); assert.equal(files[0].name, 'C:\\Python27'); assert.ok(flatten(files).length > 1000);
  for (let time = 0; time <= 90; time += .13) {for (let channel = 0; channel < 4; channel++) {const value = dashboardSample(channel, time); assert.ok(Number.isFinite(value) && value >= 0 && value <= 100);} assert.ok(animatedRadarFrame(time).every(value => Number.isFinite(value) && value >= 2 && value <= 100));}
  assert.notDeepEqual(animatedRadarFrame(0), animatedRadarFrame(2));
});

test('four dashboard channels keep gauge values, retained samples and time windows synchronized', () => dom(host => {
  const mounted = mount('1602', host);
  for (let second = 1; second <= 45; second++) mounted.update!(second, 1);
  const snapshot = mounted.snapshot!() as any;
  assert.deepEqual(snapshot.samples, [600, 600, 600, 600]); assert.deepEqual(snapshot.gaugeValues, snapshot.latestSamples);
  snapshot.gaugeValues.forEach((value: number, channel: number) => near(value, dashboardSample(channel, 44.95), 1e-4));
  snapshot.windows.forEach((window: {start: number; end: number}) => {near(window.start, 14.95); near(window.end, 44.95);});
  mounted.dispose!(); mounted.charts.forEach(chart => chart.dispose()); assert.equal(host.children.length, 0);
}));

test('all 13 observed candidates mount actual chart families, render finite geometry and dispose their controls', () => dom(host => {
  assert.equal(new Set(businessEntries.map(entry => entry.id)).size, 13);
  for (const entry of businessEntries) {
    assert.ok(entry.observed.length > 0 && entry.gaps.length > 0); const mounted = mount(entry.id.match(/-(\d{4})-/)![1], host);
    for (const chart of mounted.charts) if (chart instanceof SpecialtyChart) {const a = recording(); chart.render(a.ctx); assert.ok(a.calls.fills > 0 || a.calls.arcs.length > 0 || a.calls.rectangles.length > 1, `empty geometry ${entry.id}`);}
    mounted.update?.(3, 1); assert.ok(mounted.snapshot && Object.keys(mounted.snapshot()).length > 0);
    mounted.dispose?.(); mounted.charts.forEach(chart => chart.dispose()); assert.equal(host.children.length, 0, entry.id);
  }
}));

test('wheel handlers obtain their position directly from the wheel event without a previous pointer move', () => dom(host => {
  class WheelProbe extends SpecialtyChart {observed?: {x: number; y: number}; protected renderPlot() {} protected override wheel() {this.observed = {...this.pointer}; return true;}}
  const chart = new WheelProbe({container: host as unknown as HTMLElement}), canvas = host.find('canvas')[0]; let prevented = false;
  canvas.dispatch('wheel', {clientX: 157, clientY: 121, deltaY: -100, preventDefault() {prevented = true;}});
  assert.deepEqual(chart.observed, {x: 127, y: 81}); assert.equal(prevented, true); chart.dispose(); assert.equal([...canvas.listeners.values()].reduce((sum, listeners) => sum + listeners.size, 0), 0);
}));
