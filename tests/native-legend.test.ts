import test from 'node:test';
import assert from 'node:assert/strict';
import {EventHub} from '../src/core/events.js';
import {ColorRGBA, LUT, PalettedFill, SolidFill, SolidLine, Themes, emptyFill} from '../src/core/styles.js';
import {NativeLegend, LegendPosition, LegendOrientation, LegendEntryClickBehaviors} from '../src/native-legend.js';

const area = {left: 0, top: 30, width: 700, height: 430};
function canvas() {
  const texts: Array<{text: string; x: number; y: number; alpha: number}> = [];
  const rectangles: Array<{x: number; y: number; width: number; height: number; fill: any}> = [];
  const gradients: Array<{points: number[]; stops: Array<{offset: number; color: string}>; addColorStop(offset: number, color: string): void}> = [];
  const stack: any[] = [];
  const context: any = {
    font: '', fillStyle: '', globalAlpha: 1,
    save() {stack.push({font: this.font, fillStyle: this.fillStyle, globalAlpha: this.globalAlpha});},
    restore() {Object.assign(this, stack.pop());},
    measureText(value: string) {return {width: String(value).length * 7};},
    fillText(text: string, x: number, y: number) {texts.push({text, x, y, alpha: this.globalAlpha});},
    fillRect(x: number, y: number, width: number, height: number) {rectangles.push({x, y, width, height, fill: this.fillStyle});},
    createLinearGradient(...points: number[]) {const gradient = {points, stops: [] as Array<{offset: number; color: string}>, addColorStop(offset: number, color: string) {this.stops.push({offset, color});}}; gradients.push(gradient); return gradient;},
    beginPath() {}, rect() {}, clip() {}, arc() {}, moveTo() {}, lineTo() {}, closePath() {}, fill() {}, stroke() {},
    strokeRect() {}, translate() {}, rotate() {},
  };
  return {context: context as CanvasRenderingContext2D, texts, rectangles, gradients, stack};
}
function makeSeries(name = 'Channel A') {
  return {
    name, visible: true, disposed: false, highlight: .2, events: new EventHub(),
    fill: emptyFill as any, stroke: new SolidLine({fillStyle: new SolidFill({color: ColorRGBA(255, 50, 0)})}),
    getName() {return this.name;}, getVisible() {return this.visible;}, setVisible(value: boolean) {this.visible = value; return this;},
    getFillStyle() {return this.fill;}, getStrokeStyle() {return this.stroke;}, getPointFillStyle() {return emptyFill;},
    setHighlight(value: number) {this.highlight = value; return this;}, isDisposed() {return this.disposed;},
    on(type: string, listener: (...args: any[]) => void) {return this.events.on(type, listener);}, off(token: symbol) {return this.events.off(token);},
  };
}
function atEntry(legend: NativeLegend, context: CanvasRenderingContext2D, index = 0) {
  const bounds = legend.getLayout(context, area).entries[index].bounds;
  return {x: bounds.left + 4, y: bounds.top + bounds.height / 2};
}
const palette = () => new LUT({steps: [
  {value: 100, color: ColorRGBA(0, 0, 255)}, {value: 125, color: ColorRGBA(0, 255, 0)}, {value: 200, color: ColorRGBA(255, 0, 0)},
]});

test('native legend registers live series, respects per-series opt-out and toggles only on click', () => {
  let invalidations = 0;
  const legend = new NativeLegend({invalidate() {invalidations++;}, theme: Themes.light});
  const a = makeSeries(), omitted = makeSeries('Omitted');
  legend.registerSeries(a).registerSeries(omitted, null);
  assert.equal(legend.getEntries().length, 1);
  assert.equal(legend.getEntries()[0].component, a);
  const drawing = canvas(), p = atEntry(legend, drawing.context);
  legend.draw(drawing.context, area);
  assert.equal(drawing.texts.at(-1)?.text, 'Channel A');
  assert.equal(legend.handlePointer('pointerdown', p), true);
  legend.handlePointer('pointerup', p); assert.equal(a.visible, true);
  legend.handlePointer('click', p); assert.equal(a.visible, false);
  a.name = 'Renamed channel'; legend.draw(drawing.context, area);
  assert.equal(drawing.texts.at(-1)?.text, 'Renamed channel'); assert.equal(drawing.texts.at(-1)?.alpha, .38);
  legend.handlePointer('click', atEntry(legend, drawing.context)); assert.equal(a.visible, true);
  assert.ok(invalidations >= 4);
  assert.equal(drawing.stack.length, 0);
});

test('8.2 observed auto mode only affects future registrations and preserves existing entries', () => {
  const legend = new NativeLegend({invalidate() {}}), a = makeSeries(), b = makeSeries('Late'), c = makeSeries('Later'), optedOut = makeSeries('Never auto');
  legend.registerSeries(a).registerSeries(optedOut, null).setOptions({addEntriesAutomatically: false}).registerSeries(b);
  assert.deepEqual(legend.getEntries().map(e => e.component), [a]);
  legend.setOptions({addEntriesAutomatically: true}); assert.deepEqual(legend.getEntries().map(e => e.component), [a]);
  legend.registerSeries(c).setOptions({addEntriesAutomatically: false}).add(b);
  assert.deepEqual(legend.getEntries().map(e => e.component), [a, c, b]);
});

test('TDF getEntries/remove/add loop uses LUT removal handles and draws live offset formatters', () => {
  const legend = new NativeLegend({invalidate() {}}, {addEntriesAutomatically: false, position: LegendPosition.BottomCenter});
  let offset = 100;
  for (let i = 0; i < 4; i++) {
    for (const entry of legend.getEntries()) if (entry.component) legend.remove(entry.component);
    const lut = palette(); legend.add(lut, {lutLength: 200, lutStepValueFormatter: step => String(step.value - offset)});
    const entry = legend.getEntries()[0];
    assert.equal(legend.getEntries().length, 1); assert.notEqual(entry.component, lut);
    assert.equal(entry.options.lut, undefined); assert.equal(legend.getEntryOptions(lut), entry.options);
    assert.equal(legend.getEntryOptions(entry.component!), entry.options);
  }
  const drawing = canvas(); legend.draw(drawing.context, area);
  const strip = legend.getLayout(drawing.context, area).entries[0].palette!;
  assert.equal(strip.rect.width, 200); assert.equal(strip.rect.height, 12);
  assert.deepEqual(drawing.gradients[0].stops.map(s => s.offset), [0, .25, 1]);
  assert.deepEqual(drawing.texts.map(t => t.text).sort(), ['0', '100', '25']);
  assert.ok(legend.getLayout(drawing.context, area).margin.bottom > 0);
  offset = 125; const updated = canvas(); legend.draw(updated.context, area);
  assert.deepEqual(updated.texts.map(t => t.text).sort(), ['-25', '0', '75']);
});

test('paletted series infer their colorbar; lut:null suppresses it and live style changes are respected', () => {
  const series = makeSeries(), first = palette();
  series.stroke = new SolidLine({fillStyle: new PalettedFill({lut: first})});
  const legend = new NativeLegend({invalidate() {}}, {entries: {matchStyleExactly: true}}).registerSeries(series);
  const drawing = canvas();
  assert.equal(legend.getLayout(drawing.context, area).entries[0].palette?.lut, first);
  const next = first.setSteps([{value: 5, color: ColorRGBA(30, 40, 50)}]);
  series.stroke = new SolidLine({fillStyle: new PalettedFill({lut: next})});
  assert.equal(legend.getLayout(drawing.context, area).entries[0].palette?.lut, next);
  legend.setEntryOptions(series, {lut: null});
  assert.equal(legend.getLayout(drawing.context, area).entries[0].palette, undefined);
  legend.draw(drawing.context, area); assert.equal(drawing.gradients.length, 0);
});

test('discrete LUT uses exact proportional spans or equally spaced thresholds, without interpolated paint', () => {
  const lut = palette().setInterpolation(false);
  const legend = new NativeLegend({invalidate() {}}, {position: LegendPosition.BottomLeft}).add(lut, {lutLength: 200});
  const drawing = canvas(); legend.draw(drawing.context, area);
  assert.equal(drawing.gradients.length, 0);
  assert.deepEqual(drawing.rectangles.map(r => r.width), [50, 150]);
  assert.deepEqual(drawing.rectangles.map(r => r.fill), ['rgba(0, 0, 255, 1)', 'rgba(0, 255, 0, 1)']);
  legend.setEntryOptions(lut, {lutDisplayProportionalSteps: false}); const uniform = canvas(); legend.draw(uniform.context, area);
  assert.deepEqual(uniform.rectangles.map(r => r.width), [100, 100]);
  legend.setOptions({orientation: LegendOrientation.Vertical, position: LegendPosition.LeftCenter}); const vertical = canvas(); legend.draw(vertical.context, area);
  assert.deepEqual(vertical.rectangles.map(r => r.height), [100, 100]);
  assert.ok(vertical.rectangles[0].y > vertical.rectangles[1].y);
});

test('native callbacks receive original event and entry snapshots; custom click replaces default behavior', () => {
  const a = makeSeries(), b = makeSeries('Channel B'), calls: any[] = [];
  const legend = new NativeLegend({invalidate() {}}, {entries: {events: {click: (event, info) => calls.push({event, info})}}}).registerSeries(a).registerSeries(b);
  const context = canvas().context, point = atEntry(legend, context), event = {type: 'click', button: 0};
  legend.handlePointer('click', point, event);
  assert.equal(a.visible, true); assert.equal(calls[0].event, event);
  assert.equal(calls[0].info.entry.component, a); assert.equal(calls[0].info.allEntries.length, 2);
  legend.setEntryOptions(a, {events: {click: LegendEntryClickBehaviors.focusClicked}});
  legend.handlePointer('click', atEntry(legend, context), event); assert.equal(a.visible, true); assert.equal(b.visible, false);
  legend.setEntryOptions(a, {events: {click: LegendEntryClickBehaviors.toggleIndividualVisibility}});
  legend.handlePointer('click', atEntry(legend, context), event); assert.equal(a.visible, false);
});

test('hover preserves prior highlight and departure dispatches even outside legend bounds', () => {
  const series = makeSeries(), calls: string[] = [];
  const legend = new NativeLegend({invalidate() {}}, {entries: {events: {
    pointerenter: () => calls.push('enter'), pointermove: () => calls.push('move'), pointerleave: () => calls.push('leave'),
  }}}).registerSeries(series);
  const context = canvas().context, point = atEntry(legend, context);
  legend.handlePointer('pointermove', point); legend.handlePointer('pointermove', point);
  assert.equal(series.highlight, 1); assert.deepEqual(calls, ['enter', 'move', 'move']);
  assert.equal(legend.handlePointer('pointermove', {x: -10, y: -10}), false);
  assert.equal(series.highlight, .2); assert.deepEqual(calls, ['enter', 'move', 'move', 'leave']);
});

test('title/background listeners use callback identity and disposal releases all subscriptions without destroying series', () => {
  let titleClicks = 0, backgroundClicks = 0;
  const series = makeSeries(), legend = new NativeLegend({invalidate() {}}, {title: 'Signals', backgroundVisible: true}).registerSeries(series);
  const click = () => titleClicks++;
  legend.title.addEventListener('click', click); legend.title.addEventListener('click', click);
  legend.background.addEventListener('click', () => backgroundClicks++);
  const context = canvas().context, layout = legend.getLayout(context, area);
  legend.handlePointer('click', {x: layout.titleRect!.left + 2, y: layout.titleRect!.top + 2}); assert.equal(titleClicks, 1);
  legend.title.removeEventListener('click', click);
  const second = legend.getLayout(context, area);
  legend.handlePointer('click', {x: second.titleRect!.left + 2, y: second.titleRect!.top + 2}); assert.equal(titleClicks, 1);
  const third = legend.getLayout(context, area);
  legend.handlePointer('click', {x: third.bounds.left + 1, y: third.bounds.top + 1}); assert.equal(backgroundClicks, 1);
  assert.equal(series.events.listenerCount(), 1);
  legend.dispose().dispose();
  assert.equal(series.disposed, false); assert.equal(series.events.listenerCount(), 0);
  assert.equal(legend.title.listenerCount() + legend.background.listenerCount(), 0);
  assert.equal(legend.getEntries().length, 0); assert.equal(legend.getVisible(), false);
  legend.registerSeries(makeSeries()).add(palette()); assert.equal(legend.getEntries().length, 0);
});

test('disposed/removal paths release entry references, and throwing departure still cleans legend resources', () => {
  const a = makeSeries(), b = makeSeries('Other');
  const legend = new NativeLegend({invalidate() {}}, {entries: {events: {pointerleave() {throw new Error('consumer callback');}}}}).registerSeries(a).registerSeries(b);
  const context = canvas().context; legend.handlePointer('pointermove', atEntry(legend, context));
  assert.throws(() => legend.dispose(), /consumer callback/);
  assert.equal(a.events.listenerCount() + b.events.listenerCount(), 0); assert.equal(legend.getEntries().length, 0);
  const fresh = new NativeLegend({invalidate() {}}).registerSeries(a).registerSeries(b);
  a.disposed = true; assert.deepEqual(fresh.getEntries().map(e => e.component), [b]); assert.equal(a.events.listenerCount(), 0);
  fresh.removeSeries(b); assert.equal(fresh.getEntries().length, 0); assert.equal(b.events.listenerCount(), 0);
});

test('hidden legends reserve no space, manual pixel origins do not shrink plot and entry rows wrap', () => {
  const legend = new NativeLegend({invalidate() {}}, {visible: false}).registerSeries(makeSeries());
  const context = canvas().context;
  assert.equal(legend.getLayout(context, area).hidden, true); assert.deepEqual(legend.getLayout(context, area).margin, {left: 0, right: 0, top: 0, bottom: 0});
  legend.setOptions({visible: true, position: {x: 300, y: 200, origin: {x: .5, y: .5}}});
  const manual = legend.getLayout(context, area);
  assert.equal(manual.bounds.left + manual.bounds.width / 2, 300);
  assert.equal(manual.bounds.top + manual.bounds.height / 2, area.top + area.height - 200);
  assert.deepEqual(manual.margin, {left: 0, right: 0, top: 0, bottom: 0});
  legend.setOptions({position: LegendPosition.BottomLeft, orientation: LegendOrientation.Horizontal, renderOnTop: true});
  for (let i = 0; i < 10; i++) legend.registerSeries(makeSeries(`Long channel name ${i}`));
  const wrapped = legend.getLayout(context, area); assert.equal(wrapped.hidden, false);
  assert.ok(new Set(wrapped.entries.map(entry => entry.bounds.top)).size > 1);
  assert.ok(wrapped.entries.every(entry => entry.bounds.left >= 0 && entry.bounds.left + entry.bounds.width <= area.width));
  assert.deepEqual(wrapped.margin, {left: 0, right: 0, top: 0, bottom: 0});
});

test('entry options have stable public identity, input options are copied and clear permits explicit add', () => {
  const a = makeSeries(), b = makeSeries('B');
  const defaults = {textFont: {size: 14}, events: {click: LegendEntryClickBehaviors.doNothing}};
  const legend = new NativeLegend({invalidate() {}}, {entries: defaults}).add({getSeries: () => [a, b]});
  legend.setEntryOptions(a, {show: false});
  const entries = legend.getEntries(); defaults.textFont.size = 99;
  assert.equal(legend.getEntryOptions(b), entries[1].options);
  assert.equal(legend.getEntryOptions(b)?.textFont?.size, 14);
  assert.equal(legend.getEntryOptions(b)?.events?.click, LegendEntryClickBehaviors.doNothing);
  assert.equal(legend.getEntries().length, 2); assert.equal(legend.getLayout(canvas().context, area).entries.length, 1);
  legend.clear(); assert.equal(legend.getEntries().length, 0); assert.equal(a.events.listenerCount() + b.events.listenerCount(), 0);
  legend.add(a); assert.equal(legend.getEntries()[0].component, a);
});

test('8.2 observed default layout changes to right center for a direct LUT and LUT handle removal releases both aliases', () => {
  const legend = new NativeLegend({invalidate() {}}), lut = palette();
  const options = legend.getOptions();
  assert.equal(options.position, LegendPosition.BottomCenter); assert.equal(options.orientation, undefined);
  assert.equal(options.entryMargin, 5); assert.equal(options.marginInner, 7); assert.equal(options.autoHideThreshold, .5);
  assert.equal(legend.add(lut, {lutLength: 200}), legend);
  assert.equal(legend.getOptions().position, LegendPosition.RightCenter);
  const entry = legend.getEntries()[0]; assert.notEqual(entry.component, lut); assert.equal(entry.options.lut, undefined);
  assert.equal(legend.getEntryOptions(lut), legend.getEntryOptions(entry.component!));
  legend.remove(lut); assert.equal(legend.getEntries().length, 1);
  legend.remove(entry.component!); assert.equal(legend.getEntries().length, 0);
  assert.equal(legend.getEntryOptions(lut), undefined); assert.equal(legend.getEntryOptions(entry.component!), undefined);
  assert.equal(legend.getOptions().position, LegendPosition.RightCenter);
});

test('throwing formatter restores canvas state and can be corrected without replacing the legend', () => {
  const lut = palette(), legend = new NativeLegend({invalidate() {}}).add(lut, {lutStepValueFormatter() {throw new Error('invalid format');}});
  const drawing = canvas();
  assert.throws(() => legend.getLayout(drawing.context, area), /invalid format/);
  assert.equal(drawing.stack.length, 0);
  legend.setEntryOptions(lut, {lutStepValueFormatter: step => String(step.value)});
  legend.draw(drawing.context, area); assert.ok(drawing.texts.length > 0); assert.equal(drawing.stack.length, 0);
});
