import test from 'node:test';
import assert from 'node:assert/strict';
import {BarChart, DataGrid, Gauge, ParallelCoordinateChart, Pie, Spider, TreeMapChart, layoutTreemap, pieAngles} from '../src/specialty.js';

function recording() {
  const calls = {rectangles: 0, arcs: 0, strokes: 0, text: [] as string[]};
  const finite = (...values: number[]) => values.forEach(value => assert.ok(Number.isFinite(value), `non-finite drawing coordinate ${value}`));
  const context = {
    save() {}, restore() {}, beginPath() {}, closePath() {}, clip() {}, setLineDash() {},
    setTransform(...values: number[]) { finite(...values); }, clearRect(...values: number[]) { finite(...values); },
    fillRect(...values: number[]) { finite(...values); calls.rectangles++; }, strokeRect(...values: number[]) { finite(...values); },
    moveTo(...values: number[]) { finite(...values); }, lineTo(...values: number[]) { finite(...values); }, rect(...values: number[]) { finite(...values); },
    arc(...values: any[]) { finite(...values.filter(value => typeof value === 'number')); calls.arcs++; }, fill() {}, stroke() { calls.strokes++; },
    measureText(text: string) {return {width: text.length * 7};}, fillText(text: string, ...values: number[]) { finite(...values); calls.text.push(text); },
  } as unknown as CanvasRenderingContext2D;
  return {context, calls};
}
const headless = {headless: true, width: 500, height: 320};

test('pie allocation closes one turn and rejects invalid mutable slice values', () => {
  const sectors = pieAngles([2, 3, 5]);
  assert.ok(Math.abs(sectors.at(-1)!.end - sectors[0].start - Math.PI * 2) < 1e-12);
  assert.equal(sectors[1].start, sectors[0].end);
  const pie = new Pie(headless).setTitle('Share'); pie.addSlice('A', 2); pie.addSlice('B', 3); const slice = pie.addSlice('C', 5);
  assert.throws(() => slice.setValue(-1), /nonnegative/);
  const {context, calls} = recording(); pie.render(context); assert.equal(calls.arcs, 3); assert.ok(calls.text.includes('Share'));
  let disposal = 0; pie.onDispose(() => {disposal++;}); pie.dispose().dispose(); assert.equal(disposal, 1);
});

test('treemap partitions preserve weighted area and do not overlap', () => {
  const input = [{name: 'A', value: 3}, {name: 'B', value: 2}, {name: 'C', value: 5}, {name: 'zero', value: 0}];
  const tiles = layoutTreemap(input, {left: 2, top: 4, width: 400, height: 200});
  assert.equal(tiles.length, 3);
  for (const tile of tiles) assert.ok(Math.abs(tile.width * tile.height - tile.weight / 10 * 80000) < 1e-8);
  for (let i = 0; i < tiles.length; i++) for (let j = i + 1; j < tiles.length; j++) {
    const a = tiles[i], b = tiles[j], width = Math.max(0, Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left)), height = Math.max(0, Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top));
    assert.equal(width * height, 0);
  }
  const tree = new TreeMapChart(headless).setData([{name: 'Group', children: input}]);
  const {context, calls} = recording(); tree.render(context); tree.activateAt({x: 100, y: 100}); tree.render(context);
  assert.ok(calls.text.some(text => text.includes('Back')));
});

test('bar, radar and parallel charts draw finite primitives with missing values', () => {
  const {context, calls} = recording();
  const bar = new BarChart(headless).setData([{category: 'A', value: -3}, {category: 'B', value: 7}, {category: 'C', value: NaN}]);
  bar.render(context); assert.ok(calls.rectangles >= 4);
  const spider = new Spider(headless); spider.addSeries().setName('Sensors').addPoints([{name: 'X', value: 2}, {name: 'Y', value: 4}, {name: 'Z', value: 3}]); spider.render(context);
  assert.ok(calls.text.includes('X'));
  const parallel = new ParallelCoordinateChart(headless).setData([{a: 1, b: 2, c: 3}, {a: 4, b: NaN, c: 5}], ['a', 'b', 'c']); parallel.render(context);
  assert.ok(calls.strokes >= 10);
});

test('gauge validates ranges and handles independent headless updates', () => {
  const gauge = new Gauge(headless).setInterval({start: -10, end: 10}).setValue(2).setUnitLabel('V');
  const {context, calls} = recording(); gauge.render(context); assert.ok(calls.text.includes('2 V'));
  assert.throws(() => gauge.setInterval({start: 1, end: 1}), /increase/);
  assert.throws(() => gauge.setValue(Infinity), /finite/);
});

test('grid header clicks sort copied input without changing caller records', () => {
  const input = [{name: 'A', value: 5}, {name: 'B', value: 2}, {name: 'C', value: 9}];
  const grid = new DataGrid(headless).setData(input); const {context} = recording(); grid.render(context);
  grid.activateAt({x: 300, y: 25});
  assert.deepEqual(grid.data.map(row => row.value), [2, 5, 9]);
  grid.activateAt({x: 300, y: 25});
  assert.deepEqual(grid.data.map(row => row.value), [9, 5, 2]);
  assert.deepEqual(input.map(row => row.value), [5, 2, 9]);
});
