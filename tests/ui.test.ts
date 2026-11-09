import test from 'node:test';
import assert from 'node:assert/strict';
import {Cursor, LegendBox, UIElement} from '../src/ui.js';
import {ColorHEX, SolidFill, SolidLine, UIElementBuilders, UIOrigins, emptyFill, AxisScrollStrategies} from '../src/core/styles.js';
import {makeCustomTheme} from '../src/themes.js';

function drawing() {
  const text: string[] = [], lines: Array<[number, number]> = [];
  const context = {
    save() {}, restore() {}, setLineDash() {}, beginPath() {}, rect() {}, clip() {}, arc() {}, fill() {}, stroke() {}, translate() {}, rotate() {},
    fillRect() {}, strokeRect() {}, measureText(value: string) { return {width: value.length * 7}; },
    fillText(value: string) { text.push(value); }, moveTo(x: number, y: number) { lines.push([x, y]); }, lineTo(x: number, y: number) { lines.push([x, y]); },
  } as unknown as CanvasRenderingContext2D;
  return {context, text, lines};
}
const rect = {left: 10, top: 10, width: 400, height: 200};

test('text UI applies origin, hit testing, checkbox interaction and disposal once', () => {
  let invalidations = 0, clicks = 0, disposals = 0;
  const ui = new UIElement({invalidate: () => { invalidations++; }}, UIElementBuilders.CheckBox);
  ui.setText('Enable').setPosition({x: 50, y: 50}).setOrigin(UIOrigins.Center);
  ui.onMouseClick(() => { clicks++; }); ui.onDispose(() => { disposals++; });
  const {context, text} = drawing(); ui.draw(context, rect);
  assert.deepEqual(text, ['Enable']);
  assert.ok(ui.hitTest({x: 210, y: 110}));
  ui.handlePointer('pointerup', {x: 210, y: 110});
  assert.equal(ui.getChecked(), false);
  ui.handlePointer('click', {x: 210, y: 110});
  assert.equal(ui.getChecked(), true); assert.equal(clicks, 1);
  ui.dispose().dispose(); assert.equal(disposals, 1); assert.ok(invalidations > 0);
  assert.equal(ui.hitTest({x: 210, y: 110}), false);
});

test('cursor draws only configured crosshair directions and independently hides results', () => {
  const cursor = new Cursor(); cursor.setPosition({x: 2, y: 3}).setTickMarkerXVisible(false).setTickMarkerYVisible(false).setResultTableVisible(false);
  cursor.setGridStrokeYStyle(new SolidLine({fillStyle: emptyFill}));
  cursor.setResultTable(table => table.setContent([['secret table']]));
  const {context, lines, text} = drawing(); cursor.draw(context, rect, p => ({x: p.x * 10, y: p.y * 10}));
  assert.deepEqual(lines, [[20, 10], [20, 210]]);
  assert.deepEqual(text, []);
  cursor.setResultTableVisible(true); cursor.draw(context, rect, p => ({x: p.x * 10, y: p.y * 10}));
  assert.ok(text.includes('secret table'));
  cursor.dispose(); assert.equal(cursor.resultTable.isDisposed(), true);
});

test('legend interacts with series visibility while retaining live names', () => {
  const series = {visible: true, getVisible() {return this.visible;}, setVisible(value: boolean) {this.visible = value;}, getName() {return 'Voltage';}, isDisposed() {return false;}, getStrokeStyle() {return new SolidLine();}};
  const legend = new LegendBox().add({getSeries: () => [series]});
  const {context, text} = drawing(); legend.draw(context, rect);
  assert.ok(text.includes('Voltage'));
  legend.handlePointer('pointerup', {x: legend.bounds.left + 12, y: legend.bounds.top + 12});
  assert.equal(series.visible, true);
  assert.equal(legend.handlePointer('click', {x: legend.bounds.left + 12, y: legend.bounds.top + 12}), true);
  assert.equal(series.visible, false);
  legend.handlePointer('click', {x: legend.bounds.left + 12, y: legend.bounds.top + 12});
  assert.equal(series.visible, true);
});

test('custom theme accepts transparent fill background and leaves editable consumer fields', () => {
  const fill = new SolidFill({color: ColorHEX('#11223300')});
  const theme = makeCustomTheme({isDark: false, backgroundColor: fill, textColor: ColorHEX('#123456'), fontSize: {axisTitle: 14}, effects: false});
  assert.equal(theme.backgroundFillStyle, fill);
  assert.equal(theme.axisTitleFont.size, 14);
  assert.equal(theme.effectsDisabled, true);
  theme.chartXYSeriesBackgroundStrokeStyle = new SolidLine({thickness: 4});
  assert.equal(theme.chartXYSeriesBackgroundStrokeStyle.getThickness(), 4);
  assert.equal(AxisScrollStrategies.fitting.kind, 'fitting');
  assert.deepEqual(AxisScrollStrategies.fitting({considerVisibleRangeOnly: true}), {kind: 'fitting', considerVisibleRangeOnly: true});
});
