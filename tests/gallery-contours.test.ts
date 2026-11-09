import test from 'node:test';
import assert from 'node:assert/strict';
import { marchingSquares } from '../examples/contours';

test('contours of an affine field interpolate to the exact analytic level', () => {
  const grid = Array.from({length: 7}, (_,y) => Array.from({length: 8}, (_,x) => 2 * x + 3 * y));
  const segments = marchingSquares(grid, 12.5);
  assert.ok(segments.length > 0);
  for (const segment of segments) for (const point of [segment.start,segment.end]) assert.ok(Math.abs(2 * point.x + 3 * point.y - 12.5) < 1e-12);
});

test('stride preserves boundary cells and contours do not bridge nonfinite measurements', () => {
  const grid = Array.from({length: 8}, () => Array.from({length: 6}, (_,x) => x));
  const segments = marchingSquares(grid, 2.5, 3);
  assert.equal(segments.length, 3);
  const yValues = segments.flatMap(segment => [segment.start.y,segment.end.y]);
  assert.equal(Math.min(...yValues),0); assert.equal(Math.max(...yValues),7);
  assert.ok(segments.every(segment => segment.start.x === 2.5 && segment.end.x === 2.5));
  assert.deepEqual(marchingSquares([[0,NaN],[0,2]],1),[]);
});

test('saddles produce two finite separate contours and flat grids do not invent edges', () => {
  const segments = marchingSquares([[2,0],[0,2]],1);
  assert.equal(segments.length,2);
  for (const segment of segments) for (const point of [segment.start,segment.end]) assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
  assert.deepEqual(marchingSquares([[1,1],[1,1]],1),[]);
  assert.throws(() => marchingSquares([[0,1],[2]],1),RangeError);
  assert.throws(() => marchingSquares([[0,1],[2,3]],1,0),RangeError);
});
