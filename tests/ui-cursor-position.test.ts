import test from 'node:test';
import assert from 'node:assert/strict';
import {Cursor, type CursorPositionXY} from '../src/ui.js';
import {ColorRGBA, SolidFill, SolidLine, emptyFill, emptyLine, PointShape} from '../src/core/styles.js';

// Node Canvas-call oracle. This records actual coordinates and draw commands;
// it does not claim a browser screenshot, GPU or original-application test.
function drawing() {
  type Command = {op: string; values: number[]};
  const path: Command[] = [], stack: any[] = [], clips: Command[][] = [];
  const fills: Array<{path: Command[]; style: any}> = [], strokes: Array<{path: Command[]; style: any; thickness: number}> = [];
  const labels: Array<{text: string; x: number; y: number}> = [];
  const rectangles: number[][] = [];
  const copy = () => path.map(command => ({op: command.op, values: [...command.values]}));
  const context: any = {
    font: '', fillStyle: '', strokeStyle: '', lineWidth: 1,
    save() {stack.push({font: this.font, fillStyle: this.fillStyle, strokeStyle: this.strokeStyle, lineWidth: this.lineWidth});},
    restore() {Object.assign(this, stack.pop());}, beginPath() {path.length = 0;},
    rect(...values: number[]) {path.push({op: 'rect', values});}, clip() {clips.push(copy());},
    arc(...values: number[]) {path.push({op: 'arc', values});}, ellipse(...values: number[]) {path.push({op: 'ellipse', values});},
    moveTo(...values: number[]) {path.push({op: 'moveTo', values});}, lineTo(...values: number[]) {path.push({op: 'lineTo', values});},
    closePath() {path.push({op: 'close', values: []});}, translate() {}, rotate() {}, setLineDash() {},
    fill() {fills.push({path: copy(), style: this.fillStyle});}, stroke() {strokes.push({path: copy(), style: this.strokeStyle, thickness: this.lineWidth});},
    fillRect(...values: number[]) {rectangles.push(values);}, strokeRect() {},
    measureText(text: string) {return {width: String(text).length * 7};},
    fillText(text: string, x: number, y: number) {labels.push({text, x, y});},
  };
  return {context: context as CanvasRenderingContext2D, fills, strokes, labels, rectangles, stack, clips};
}
const rect = {left: 10, top: 20, width: 400, height: 240};
const arcs = (capture: ReturnType<typeof drawing>) => capture.fills.flatMap(fill => fill.path.filter(p => p.op === 'arc').map(p => p.values.slice(0, 3)));

test('Histogram native position list projects each series axis and one result table at its separate mouse coordinates', () => {
  const x = {factor: 10}, yA = {factor: 10}, yB = {factor: 20}, yDefault = {factor: 2};
  const cursor = new Cursor().setTickMarkerXVisible(false).setTickMarkerYVisible(false);
  const mouse = {x: 15, y: 10}, positions: CursorPositionXY[] = [
    {pointMarker: {x: 2, y: 3}, pointMarkerScale: {x, y: yA}, resultTable: mouse, resultTableScale: {x, y: yDefault}},
    {pointMarker: {x: 2, y: 5}, pointMarkerScale: {x, y: yB}, resultTable: mouse, resultTableScale: {x, y: yDefault}},
  ];
  const a = {getName: () => 'Pressure'}, b = {getName: () => 'Voltage'};
  cursor.setPosition(...positions).setResultTable(table => table.setContent([[{component: a}, {text: '3 Pa'}], [{component: b}, {text: '5 V'}]]));
  const calls: Array<{point: {x: number; y: number}; scale: any}> = [], capture = drawing();
  cursor.draw(capture.context, rect, (point, scale) => {calls.push({point: {...point}, scale}); return {x: rect.left + point.x * scale.x.factor, y: rect.top + rect.height - point.y * scale.y.factor};});
  assert.deepEqual(arcs(capture), [[30, 230, 3], [30, 160, 3]]);
  assert.equal(calls.length, 3); assert.equal(calls[0].scale.y, yA); assert.equal(calls[1].scale.y, yDefault); assert.equal(calls[2].scale.y, yB);
  assert.deepEqual(calls[1].point, mouse);
  assert.equal(cursor.getResultTable().bounds.left, 172); assert.equal(cursor.getResultTable().bounds.top, 205);
  assert.deepEqual(capture.labels.map(label => label.text), ['Pressure', '3 Pa', 'Voltage', '5 V']);
  const table = cursor.getResultTable(), left = table.bounds.left + table.padding, right = table.bounds.left + table.bounds.width - table.padding;
  assert.equal(capture.labels[0].x, left); assert.equal(capture.labels[2].x, left);
  assert.equal(capture.labels[1].x + '3 Pa'.length * 7, right);
  assert.equal(capture.labels[3].x + '5 V'.length * 7, right);
  assert.equal(capture.labels[0].y, capture.labels[1].y); assert.equal(capture.labels[2].y, capture.labels[3].y);
  assert.ok(capture.labels[2].y > capture.labels[0].y);
  assert.equal(capture.strokes.filter(stroke => stroke.path[0]?.op === 'moveTo').length, 3, 'one shared X gridline and two Y gridlines');
  assert.equal(capture.stack.length, 0);
});

test('multiple positions clip crosshairs to their own stacked panes and format ticks with their own axes', () => {
  const x = {formatValue: (value: number) => `X:${value}`};
  const low = {getScreenRange: () => ({start: 0, end: .5}), formatValue: (value: number) => `low:${value}`};
  const high = {getScreenRange: () => ({start: .5, end: 1}), formatValue: (value: number) => `high:${value}`};
  const cursor = new Cursor().setResultTableVisible(false).setPosition(
    {pointMarker: {x: 2, y: 5}, pointMarkerScale: {x, y: low}},
    {pointMarker: {x: 2, y: 5}, pointMarkerScale: {x, y: high}},
  );
  const capture = drawing();
  cursor.draw(capture.context, rect, (point, scale) => ({x: 30, y: scale.y === low ? 200 : 80}));
  assert.deepEqual(arcs(capture), [[30, 200, 3], [30, 80, 3]]);
  assert.deepEqual(capture.clips.map(clip => clip[0].values), [[10, 140, 400, 120], [10, 20, 400, 120]]);
  const lines = capture.strokes.filter(stroke => stroke.path[0]?.op === 'moveTo').map(stroke => stroke.path.map(command => command.values));
  assert.deepEqual(lines, [[[30, 140], [30, 260]], [[10, 200], [410, 200]], [[30, 20], [30, 140]], [[10, 80], [410, 80]]]);
  assert.deepEqual(capture.labels.map(label => label.text), ['X:2', 'low:5', 'X:2', 'high:5']);
  cursor.setTickMarkerXVisible(false); const onlyY = drawing(); cursor.draw(onlyY.context, rect, (_point, scale) => ({x: 30, y: scale.y === low ? 200 : 80}));
  assert.deepEqual(onlyY.labels.map(label => label.text), ['low:5', 'high:5']);
});

test('per-position point marker style overrides draw independently while mutator defaults remain reusable', () => {
  const orange = new SolidFill({color: ColorRGBA(255, 120, 0)}), blue = new SolidFill({color: ColorRGBA(0, 30, 255)}), red = new SolidFill({color: ColorRGBA(255, 0, 0)});
  const cursor = new Cursor().setGridStrokeXStyle(emptyLine).setGridStrokeYStyle(emptyLine).setTickMarkerXVisible(false).setTickMarkerYVisible(false).setResultTableVisible(false);
  cursor.setPointMarker(marker => {marker.setShape(PointShape.Circle).setSize({x: 8, y: 8}).setFillStyle(orange); return marker;});
  cursor.setPosition({x: 50, y: 50}, {pointMarker: {x: 100, y: 80}, pointMarkerShape: PointShape.Square, pointMarkerSize: {x: 12, y: 8}, pointMarkerFillStyle: blue, pointMarkerStrokeStyle: new SolidLine({thickness: 3, fillStyle: red})});
  const capture = drawing(); cursor.draw(capture.context, rect);
  assert.deepEqual(arcs(capture), [[50, 50, 4]]);
  assert.deepEqual(capture.fills[1].path, [{op: 'rect', values: [94, 76, 12, 8]}]);
  assert.equal(capture.fills[0].style, orange.getColor().toCSS()); assert.equal(capture.fills[1].style, blue.getColor().toCSS());
  assert.equal(capture.strokes.length, 1); assert.equal(capture.strokes[0].style, red.getColor().toCSS()); assert.equal(capture.strokes[0].thickness, 3);
  assert.deepEqual(cursor.getPointMarker().getSize(), {x: 8, y: 8}); assert.equal(cursor.getPointMarker().getShape(), PointShape.Circle);
  cursor.setPosition({pointMarker: {x: 150, y: 100}, pointMarkerShape: PointShape.Plus, pointMarkerFillStyle: emptyFill, pointMarkerStrokeStyle: new SolidLine({fillStyle: red})});
  const plus = drawing(); cursor.draw(plus.context, rect); assert.equal(plus.fills.length, 0); assert.equal(plus.strokes[0].path.filter(p => p.op === 'rect').length, 2);
});

test('PNG hide and restore preserve the full position list and independently toggle result table and markers', () => {
  const cursor = new Cursor().setTickMarkerXVisible(false).setTickMarkerYVisible(false).setPosition({x: 80, y: 100}, {x: 120, y: 140}).setResultTable(table => table.setContent([['Visible table']]));
  const before = cursor.getPositions(), wasVisible = cursor.getVisible();
  cursor.setVisible(false); const hidden = drawing(); cursor.draw(hidden.context, rect);
  assert.equal(hidden.fills.length + hidden.labels.length + hidden.strokes.length, 0); assert.deepEqual(cursor.getPositions(), before);
  cursor.setVisible(wasVisible); const restored = drawing(); cursor.draw(restored.context, rect);
  assert.equal(arcs(restored).length, 2); assert.equal(restored.labels.length, 1);
  cursor.setResultTableVisible(false).setPointMarkerVisible(false); const linesOnly = drawing(); cursor.draw(linesOnly.context, rect);
  assert.equal(linesOnly.fills.length + linesOnly.labels.length, 0); assert.ok(linesOnly.strokes.length > 0);
  assert.equal(cursor.getPointMarkerVisible(), false); assert.equal(cursor.getResultTableVisible(), false);
});

test('position snapshots do not borrow point objects, clearing invalidates once, and legacy direct chart positions still draw', () => {
  let invalidations = 0, events = 0;
  const axis = {}, source = {pointMarker: {x: 90, y: 100}, pointMarkerScale: {x: axis, y: axis}, resultTable: {x: 180, y: 140}};
  const cursor = new Cursor({invalidate() {invalidations++;}}).setTickMarkerXVisible(false).setTickMarkerYVisible(false).setResultTableVisible(false);
  cursor.onPositionChange(() => events++); cursor.setPosition(source);
  source.pointMarker.x = 999; source.resultTable.y = 999; source.pointMarkerScale.y = {};
  const returned = cursor.getPositions(); returned[0].pointMarker.y = 999;
  assert.deepEqual(cursor.getPosition(), {x: 90, y: 100}); assert.equal(cursor.getPositions()[0].pointMarkerScale.y, axis);
  const capture = drawing(); cursor.draw(capture.context, rect); assert.deepEqual(arcs(capture), [[90, 100, 3]]);
  const count = invalidations; cursor.setPosition();
  assert.equal(invalidations, count + 1); assert.equal(events, 2); assert.equal(cursor.positioned, false);
  assert.deepEqual(cursor.getPositions(), []); assert.deepEqual(cursor.points, []);
  const cleared = drawing(); cursor.draw(cleared.context, rect); assert.equal(cleared.fills.length, 0);
  cursor.position = {x: 125, y: 130}; cursor.positioned = true;
  const direct = drawing(); cursor.draw(direct.context, rect); assert.deepEqual(arcs(direct), [[125, 130, 3]]);
});

test('throwing input getters fail before replacing previous cursor positions or publishing a change', () => {
  let invalidations = 0;
  const cursor = new Cursor({invalidate() {invalidations++;}}).setPosition({x: 50, y: 80});
  const before = cursor.getPositions(), count = invalidations;
  const bad = {pointMarker: {x: 1, get y(): number {throw new Error('point accessor');}}};
  assert.throws(() => cursor.setPosition({x: 2, y: 3}, bad), /point accessor/);
  assert.deepEqual(cursor.getPositions(), before); assert.equal(invalidations, count);
});

test('opaque chart scale identities survive position storage and both marker/table projections', () => {
  const token = Object.freeze({}), cursor = new Cursor().setTickMarkerXVisible(false).setTickMarkerYVisible(false);
  cursor.setPosition({pointMarker: {x: 4, y: 6}, pointMarkerScale: token, resultTable: {x: 7, y: 9}, resultTableScale: token}).setResultTable(table => table.setContent([['Opaque scale']]));
  const state = cursor.getPositions()[0]; assert.equal(state.pointMarkerScale, token); assert.equal(state.resultTableScale, token);
  const capture = drawing(), calls: any[] = [];
  cursor.draw(capture.context, rect, (point, scale) => {assert.equal(scale, token); calls.push(point); return {x: 50 + point.x * 10, y: 40 + point.y * 10};});
  assert.deepEqual(arcs(capture), [[90, 100, 3]]); assert.deepEqual(calls, [{x: 4, y: 6}, {x: 7, y: 9}]);
  assert.equal(cursor.resultTable.bounds.left, 132); assert.equal(cursor.resultTable.bounds.top, 95);
});

test('non-finite markers do not poison other markers and the result table remains independently positioned', () => {
  const cursor = new Cursor().setTickMarkerXVisible(false).setTickMarkerYVisible(false).setPosition(
    {pointMarker: {x: NaN, y: 3}, resultTable: {x: 190, y: 160}}, {x: 80, y: 90}, {x: 1, y: Infinity},
  ).setResultTable(table => table.setContent([['Finite table']]));
  const capture = drawing(); cursor.draw(capture.context, rect);
  assert.deepEqual(arcs(capture), [[80, 90, 3]]); assert.equal(cursor.getResultTable().bounds.left, 202); assert.equal(cursor.getResultTable().bounds.top, 125);
  for (const command of [...capture.fills, ...capture.strokes].flatMap(item => item.path)) assert.ok(command.values.every(Number.isFinite));
  assert.ok(capture.labels.every(label => Number.isFinite(label.x) && Number.isFinite(label.y)));
});

test('result table auto-fit uses its actual measured content and can be constrained to its pointed pane or disabled', () => {
  const upper = {getScreenRange: () => ({start: .5, end: 1})};
  const cursor = new Cursor().setTickMarkerXVisible(false).setTickMarkerYVisible(false).setPosition({pointMarker: {x: 380, y: 80}, pointMarkerScale: {y: upper}, resultTable: {x: 400, y: 150}}).setResultTable(table => table.setContent([['A reasonably wide result table'], ['Second value']]));
  const capture = drawing(); cursor.setKeepWithinAxisBoundaries(true).draw(capture.context, rect);
  const bounds = cursor.getResultTable().bounds;
  assert.ok(bounds.left >= rect.left && bounds.left + bounds.width <= rect.left + rect.width);
  assert.ok(bounds.top >= rect.top && bounds.top + bounds.height <= rect.top + rect.height / 2);
  cursor.setAutoFit(false); const raw = drawing(); cursor.draw(raw.context, rect);
  assert.equal(cursor.getResultTable().bounds.left, 412); assert.equal(cursor.getResultTable().bounds.top, 115);
});

test('dispose releases position scales, table component rows and event subscriptions even when user callbacks throw', () => {
  const axis = {disposed: false}, component = {getName: () => 'Series'};
  const cursor = new Cursor().setPosition({pointMarker: {x: 1, y: 2}, pointMarkerScale: {x: axis, y: axis}, resultTable: {x: 3, y: 4}, resultTableScale: {x: axis, y: axis}});
  cursor.setResultTable(table => table.setContent([[{component}]]));
  cursor.resultTable.onDispose(() => {throw new Error('dispose callback');}); cursor.onDispose(() => {});
  assert.throws(() => cursor.dispose(), /dispose callback/);
  assert.equal(cursor.isDisposed(), true); assert.equal(cursor.resultTable.isDisposed(), true); assert.equal(axis.disposed, false);
  assert.deepEqual(cursor.getPositions(), []); assert.deepEqual(cursor.points, []); assert.deepEqual(cursor.resultTable.content, []);
  assert.equal(cursor.events.listenerCount() + cursor.resultTable.events.listenerCount(), 0);
  cursor.setPosition({x: 400, y: 500}); assert.deepEqual(cursor.getPositions(), []);
  cursor.dispose();
});
