import test from 'node:test';
import assert from 'node:assert/strict';
import {EventHub} from '../src/core/events.js';
import {PublicEventAdapter, AxisPosition, getChartAxes, getChartSizePixels} from '../src/chart-events.js';

test('Waterfall resize listener sees CSS dimensions and removes by the original callback identity', () => {
  const hub = new EventHub(), size = {width: 640, height: 360, engineWidth: 1280, engineHeight: 720};
  const api = new PublicEventAdapter(hub, {kind: 'chart', getSize: () => size});
  const events: any[] = [], callback = (event: any) => events.push(event), tokenEvents: any[] = [];
  const token = hub.on('layoutchange', event => tokenEvents.push(event));
  api.addEventListener('resize', callback); api.addEventListener('resize', callback);
  hub.emit('layoutchange', {chart: {}, width: 800, height: 450});
  assert.deepEqual(events, [{width: 800, height: 450, engineWidth: 1280, engineHeight: 720}]);
  assert.equal(api.listenerCount('resize'), 1); assert.deepEqual(getChartSizePixels(size), {x: 640, y: 360});
  api.removeEventListener('resize', () => {}); hub.emit('layoutchange', {width: 810, height: 460}); assert.equal(events.length, 2);
  api.removeEventListener('resize', callback); hub.emit('layoutchange', {width: 820, height: 470});
  assert.equal(events.length, 2); assert.equal(tokenEvents.length, 3); assert.equal(hub.listenerCount(), 1); hub.off(token);
});

test('history intervalchange payload does not leak owner internals and independent listener removal works', () => {
  const hub = new EventHub(), api = new PublicEventAdapter(hub, {kind: 'axis'}), values: any[] = [];
  const callback = (event: any) => values.push(event), other = (event: any) => values.push({other: event});
  api.addEventListener('intervalchange', callback); api.addEventListener('intervalchange', other);
  hub.emit('intervalchange', {axis: {}, start: -10, end: 25}); api.removeEventListener('intervalchange', callback);
  hub.emit('intervalchange', {axis: {}, start: 5, end: 20});
  assert.deepEqual(values, [{start: -10, end: 25}, {other: {start: -10, end: 25}}, {other: {start: 5, end: 20}}]);
  api.dispose(); assert.equal(hub.listenerCount(), 0);
});

test('once removal precedes recursive emission and callback failures do not strand once subscriptions', () => {
  const hub = new EventHub(), api = new PublicEventAdapter(hub, {kind: 'axis'}), calls: string[] = [];
  api.addEventListener('intervalchange', () => {calls.push('once'); hub.emit('intervalchange', {start: 0, end: 2}); throw new Error('listener failure');}, {once: true});
  api.addEventListener('intervalchange', () => {calls.push('regular');});
  assert.throws(() => hub.emit('intervalchange', {start: 0, end: 1}), /listener failure/);
  assert.deepEqual(calls, ['once', 'regular', 'regular']); assert.equal(api.listenerCount(), 1); api.dispose();
});

test('listeners added or removed during delivery use deterministic callback snapshots', () => {
  const hub = new EventHub(), api = new PublicEventAdapter(hub, {kind: 'chart'}), calls: string[] = [];
  const second = () => {calls.push('second');}, later = () => {calls.push('later');};
  api.addEventListener('visiblechange', () => {calls.push('first'); api.removeEventListener('visiblechange', second); api.addEventListener('visiblechange', later);});
  api.addEventListener('visiblechange', second); hub.emit('visiblechange', {visible: false});
  assert.deepEqual(calls, ['first']); hub.emit('visiblechange', {visible: true}); assert.deepEqual(calls, ['first', 'first', 'later']); api.dispose();
});

test('actual DOM events preserve identity, coordinates and preventDefault through internal and direct routes', () => {
  const hub = new EventHub(), api = new PublicEventAdapter(hub, {kind: 'axis'}), event = new Event('dblclick', {cancelable: true}), info = {axis: 'left'};
  Object.defineProperties(event, {clientX: {value: 120.5}, clientY: {value: 80.25}});
  const events: any[] = []; api.addEventListener('dblclick', (received, details) => {received.preventDefault(); events.push({received, details});});
  hub.emit('dblclick', {chart: {}, event}, info); api.emitInteraction('dblclick', event, info);
  assert.equal(events.length, 2); assert.ok(events.every(item => item.received === event && item.details === info));
  assert.equal(events[0].received.clientX, 120.5); assert.equal(event.defaultPrevented, true); api.dispose();
});

test('DOM binding applies owner hit testing and releases native listeners on unbind and disposal', () => {
  const hub = new EventHub(), api = new PublicEventAdapter(hub, {kind: 'axis'}), target = new EventTarget(), events: any[] = [];
  api.addEventListener('dblclick', (event, info) => events.push({event, info}));
  const accepted = new Event('dblclick'), ignored = new Event('dblclick');
  const unbind = api.bindDOM(target, ['dblclick', 'dblclick'], {accept: event => event === accepted, info: () => ({axis: 'only-one'})});
  target.dispatchEvent(ignored); target.dispatchEvent(accepted); assert.equal(events.length, 1); assert.deepEqual(events[0].info, {axis: 'only-one'});
  unbind(); unbind(); target.dispatchEvent(accepted); assert.equal(events.length, 1);
  api.bindDOM(target, ['dblclick']); target.dispatchEvent(accepted); assert.equal(events.length, 2);
  api.dispose(); target.dispatchEvent(accepted); assert.equal(events.length, 2); assert.equal(api.listenerCount(), 0); assert.equal(hub.listenerCount(), 0);
});

test('failed multi-event DOM binding rolls back earlier bindings', () => {
  const active = new Map<string, EventListenerOrEventListenerObject>();
  const target = {addEventListener(type: string, listener: EventListenerOrEventListenerObject | null) {if (type === 'wheel') throw new Error('binding failed'); active.set(type, listener!);}, removeEventListener(type: string) {active.delete(type);}};
  const api = new PublicEventAdapter(new EventHub(), {kind: 'chart'});
  assert.throws(() => api.bindDOM(target, ['click', 'wheel']), /binding failed/); assert.equal(active.size, 0); api.dispose();
});

test('owner disposal finally removes every public binding even when public dispose callback throws', () => {
  const hub = new EventHub(), api = new PublicEventAdapter(hub, {kind: 'chart'}), legacy = hub.on('render', () => {});
  api.addEventListener('dispose', () => {throw new Error('user callback');}); api.addEventListener('resize', () => {});
  assert.throws(() => {try {hub.emit('dispose', {});} finally {api.dispose();}}, /user callback/);
  assert.equal(api.listenerCount(), 0); assert.equal(hub.listenerCount(), 1); api.addEventListener('resize', () => {}); assert.equal(api.listenerCount(), 0); hub.off(legacy);
});

test('getAxes returns live references in increasing iStack order, preserves hidden axes and filters exact sides', () => {
  const bottom = {direction: 'x' as const, iStack: 0, opposite: false}, top = {direction: 'x' as const, iStack: -1, opposite: true};
  const left = {direction: 'y' as const, iStack: -2, opposite: false, visible: false}, right = {direction: 'y' as const, iStack: 3, opposite: true};
  const removed = {direction: 'y' as const, iStack: -9, disposed: true}, z = {direction: 'z' as const, iStack: 1};
  const host = {axesX: [bottom, top], axesY: [left, removed, right, left], axesZ: [z]};
  assert.deepEqual(getChartAxes(host), [left, top, bottom, z, right]);
  assert.deepEqual(getChartAxes(host, AxisPosition.Left, AxisPosition.Top), [left, top]);
  assert.deepEqual(getChartAxes(host, AxisPosition.Bottom), [bottom]); assert.deepEqual(getChartAxes(host, AxisPosition.Right), [right]);
  const result = getChartAxes(host); result.pop(); assert.equal(getChartAxes(host).length, 5);
  assert.throws(() => getChartAxes(host, 99 as AxisPosition), /axis position/);
});
