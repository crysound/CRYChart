import test from 'node:test';
import assert from 'node:assert/strict';
import {ParallelCoordinateChart} from '../src/specialty.js';

test('fractional pointer hover survives a differently rounded click on a dynamic parallel hit', () => {
  const prior = {document: globalThis.document, raf: globalThis.requestAnimationFrame, cancel: globalThis.cancelAnimationFrame};
  const listeners = new Map<string, Function[]>(), texts: string[] = [], frames = new Map<number, FrameRequestCallback>(); let sequence = 0;
  const context = new Proxy({measureText: (value: string) => ({width: value.length * 7}), fillText: (value: string) => texts.push(value), clearRect: () => {texts.length = 0;}}, {get: (target, key) => key in target ? target[key as keyof typeof target] : () => {}, set: (target, key, value) => {Reflect.set(target, key, value); return true;}}) as unknown as CanvasRenderingContext2D;
  const canvas = {style: {}, width: 0, height: 0, setAttribute() {}, remove() {}, getContext: () => context, setPointerCapture() {}, releasePointerCapture() {}, getBoundingClientRect: () => ({left: 0, top: 0, width: 500, height: 320}), addEventListener: (name: string, fn: Function) => listeners.set(name, [...listeners.get(name) ?? [], fn]), removeEventListener() {}};
  const host = {clientWidth: 500, clientHeight: 320, appendChild() {}};
  Object.assign(globalThis, {document: {createElement: () => canvas, body: host}, requestAnimationFrame: (fn: FrameRequestCallback) => {frames.set(++sequence, fn); return sequence;}, cancelAnimationFrame: (id: number) => frames.delete(id)});
  const fire = (name: string, x: number, y: number) => {for (const fn of listeners.get(name) ?? []) fn({clientX: x, clientY: y, pointerId: 1});};
  const flush = () => {const queued = [...frames]; frames.clear(); for (const [, fn] of queued) fn(16);};
  let chart: ParallelCoordinateChart | undefined;
  try {
    chart = new ParallelCoordinateChart().setData([{id: 'move', a: 1, b: 1}, {id: 'click', a: 2, b: 2}], ['a', 'b']);
    chart.setAxisOptions('a', {range: {start: 0, end: 300}}).setAxisOptions('b', {range: {start: 0, end: 300}});
    flush();
    const originalMove = chart.getAxisScreenPosition('a', 1)!, zero = chart.getAxisScreenPosition('a', 0)!, end = chart.getAxisScreenPosition('a', 300)!;
    const click = {x: Math.floor(originalMove.x + 1.45), y: Math.floor(originalMove.y)};
    const clickValue = (zero.y - click.y) / (zero.y - end.y) * 300;
    chart.setData([{id: 'move', a: 1, b: 1}, {id: 'click', a: clickValue, b: clickValue}], ['a', 'b']); flush();
    const move = {...chart.getAxisScreenPosition('a', 1)!, x: originalMove.x + 1.45};
    // Two nearby lines deliberately straddle the subpixel/rounded event positions.
    assert.ok(Math.abs(move.y - click.y) < 1);
    fire('pointermove', move.x, move.y); flush();
    assert.ok(texts.includes('a: 1'));
    const before = chart.getData();
    fire('pointerdown', move.x, move.y); fire('pointerup', move.x, move.y);
    // Match the observed browser sequence: a fractional move was retained while
    // the discrete click resolver received another coordinate. No extra move.
    fire('click', click.x, click.y); flush();
    assert.equal(chart.getSelectedRow()?.id, 'click');
    assert.equal((chart as any).hovered?.data.id, 'move');
    assert.ok(texts.includes('a: 1'), 'Last pointer tooltip remains visible after another row is selected');
    assert.deepEqual(chart.getData(), before);
    // A second render must also keep a snapshot instead of re-aliasing the hit.
    chart.render(); chart.activateAt(click); chart.render();
    assert.equal((chart as any).hovered?.data.id, 'move');
    fire('pointerleave', 0, 0); flush(); assert.equal((chart as any).hovered, undefined);
    assert.equal(frames.size, 0);
  } finally {chart?.dispose(); Object.assign(globalThis, {document: prior.document, requestAnimationFrame: prior.raf, cancelAnimationFrame: prior.cancel});}
});
