import test from 'node:test';
import assert from 'node:assert/strict';
import {ResultTable, UIElement} from '../src/ui.js';

function context(initialAlign: CanvasTextAlign = 'center', fail = false) {
  const calls: Array<{text: string; x: number; y: number; align: CanvasTextAlign; width: number}> = [];
  const stack: any[] = [];
  const value: any = {
    textAlign: initialAlign, textBaseline: 'middle', font: '20px serif', fillStyle: 'orange', strokeStyle: 'blue', lineWidth: 7,
    save() {stack.push({textAlign: this.textAlign, textBaseline: this.textBaseline, font: this.font, fillStyle: this.fillStyle, strokeStyle: this.strokeStyle, lineWidth: this.lineWidth});},
    restore() {Object.assign(this, stack.pop());},
    measureText(text: string) {return {width: text.length * 7};},
    fillText(text: string, x: number, y: number) {if (fail) throw new Error('paint failed'); calls.push({text, x, y, align: this.textAlign, width: text.length * 7});},
    fillRect() {}, strokeRect() {}, setLineDash() {}, translate() {}, rotate() {},
  };
  return {ctx: value as CanvasRenderingContext2D, calls, stack};
}

test('native result table paints from its left padding even when Polar axes left a centered text alignment', () => {
  const table = new ResultTable().setContent([['Angle', '', {text: '90°'}], ['Amplitude', '', {text: '-20 dB'}]]);
  const drawing = context('center'); table.draw(drawing.ctx, {left: 0, top: 0, width: 600, height: 400}, () => ({x: 200, y: 120}));
  assert.deepEqual(drawing.calls.map(call => call.text), ['Angle', '', '90°', 'Amplitude', '', '-20 dB']);
  const left = table.bounds.left + table.padding;
  const right = table.bounds.left + table.bounds.width - table.padding;
  assert.equal(drawing.calls[0].x, left); assert.equal(drawing.calls[3].x, left);
  assert.equal(drawing.calls[1].x, drawing.calls[4].x, 'empty middle cells share their column');
  assert.equal(drawing.calls[2].x + drawing.calls[2].width, right);
  assert.equal(drawing.calls[5].x + drawing.calls[5].width, right, 'value cells share the right edge');
  assert.equal(drawing.calls[0].y, drawing.calls[1].y); assert.equal(drawing.calls[1].y, drawing.calls[2].y);
  assert.equal(drawing.calls[3].y, drawing.calls[4].y); assert.equal(drawing.calls[4].y, drawing.calls[5].y);
  assert.ok(drawing.calls[3].y > drawing.calls[0].y, 'rows remain vertically separated');
  for (const call of drawing.calls) {
    assert.equal(call.align, 'left'); assert.ok(call.x >= left);
    assert.ok(call.x + call.width <= right);
  }
  assert.equal(drawing.ctx.textAlign, 'center'); assert.equal(drawing.ctx.textBaseline, 'middle');
  assert.equal(drawing.ctx.font, '20px serif'); assert.equal(drawing.ctx.fillStyle, 'orange'); assert.equal(drawing.stack.length, 0);
});

test('UI text and component-name result cells use left alignment without changing the following object state', () => {
  const drawing = context('right'), label = new UIElement().setText('Channel 01');
  label.draw(drawing.ctx, {left: 0, top: 0, width: 400, height: 200});
  const table = new ResultTable().setContent([[{component: {getName: () => 'Pressure'}}, {text: '12.5 Pa'}]]);
  table.draw(drawing.ctx, {left: 0, top: 0, width: 400, height: 200});
  assert.deepEqual(drawing.calls.map(call => call.align), ['left', 'left', 'left']);
  assert.deepEqual(drawing.calls.map(call => call.text), ['Channel 01', 'Pressure', '12.5 Pa']);
  assert.equal(drawing.calls[1].x, table.bounds.left + table.padding);
  assert.equal(drawing.calls[2].x + drawing.calls[2].width, table.bounds.left + table.bounds.width - table.padding);
  assert.equal(drawing.calls[1].y, drawing.calls[2].y); assert.equal(drawing.ctx.textAlign, 'right');
  assert.equal(drawing.ctx.textBaseline, 'middle'); assert.equal(drawing.ctx.font, '20px serif');
  assert.equal(drawing.ctx.fillStyle, 'orange'); assert.equal(drawing.stack.length, 0);
});

test('failed Canvas paint restores inherited state and the result table temporary text', () => {
  const drawing = context('center', true), table = new ResultTable().setText('original').setContent([['Actual', 'table']]);
  assert.throws(() => table.draw(drawing.ctx, {left: 0, top: 0, width: 400, height: 200}), /paint failed/);
  assert.equal(table.getText(), 'original'); assert.equal(drawing.ctx.textAlign, 'center');
  assert.equal(drawing.ctx.textBaseline, 'middle'); assert.equal(drawing.stack.length, 0);
});
