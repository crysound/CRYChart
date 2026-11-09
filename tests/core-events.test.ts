import test from 'node:test';
import assert from 'node:assert/strict';
import {EventHub} from '../src/core/events.js';

test('tokens distinguish duplicate subscriptions and event names', () => {
  const events = new EventHub(), values: number[] = [];
  const listener = (n: number) => values.push(n);
  const first = events.on('change', listener), second = events.on('change', listener);
  assert.equal(events.off('other', first), false);
  assert.equal(events.off(first), true);
  events.emit('change', 4);
  assert.deepEqual(values, [4]);
  assert.equal(events.off('change', second), true);
  assert.equal(events.listenerCount(), 0);
});

test('listeners removed during delivery stay removed; additions await the next delivery', () => {
  const events = new EventHub(), values: string[] = [];
  let later: symbol;
  events.once('event', () => { values.push('first'); events.off(later); events.on('event', () => values.push('new')); });
  later = events.on('event', () => values.push('removed'));
  events.emit('event');
  assert.deepEqual(values, ['first']);
  events.emit('event');
  assert.deepEqual(values, ['first', 'new']);
  events.clear(); events.emit('event');
  assert.equal(events.listenerCount(), 0);
});

test('once handlers cannot fire again during recursive emission', () => {
  const events = new EventHub(); let calls = 0;
  events.once('event', () => { calls++; events.emit('event'); });
  events.emit('event');
  assert.equal(calls, 1);
});
