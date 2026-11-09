import assert from 'node:assert/strict';
import test from 'node:test';
import {polygonContains,withTimeGaps,alignedIntersections} from '../examples/official/interactions-data';

test('lasso treats corners and closed edges consistently while retaining concave holes',()=>{
  const polygon=[{x:0,y:0},{x:3,y:0},{x:3,y:3},{x:2,y:3},{x:2,y:1},{x:1,y:1},{x:1,y:3},{x:0,y:3}];
  assert.equal(polygonContains({x:.5,y:2},polygon),true);assert.equal(polygonContains({x:1.5,y:2},polygon),false);assert.equal(polygonContains({x:2,y:1.5},polygon),true);assert.equal(polygonContains({x:3,y:3},polygon),true);assert.equal(polygonContains({x:3.1,y:3},polygon),false);assert.equal(polygonContains({x:NaN,y:1},polygon),false);
});
test('time gap insertion preserves source values and existing missing values',()=>{
  const points=[{x:0,y:3},{x:30,y:4},{x:61,y:7},{x:70,y:NaN},{x:130,y:8}],result=withTimeGaps(points,30);
  assert.equal(result.length,6);assert.deepEqual(result[2],{x:45.5,y:NaN});assert.deepEqual(result.filter(point=>Number.isFinite(point.y)),points.filter(point=>Number.isFinite(point.y)));assert.equal(points.length,5);assert.throws(()=>withTimeGaps([{x:3,y:0},{x:2,y:0}],1),RangeError);
});
test('intersection markers locate crossings, deduplicate exact contacts, and never cross missing data',()=>{
  const first=[{x:0,y:-1},{x:1,y:1},{x:2,y:0},{x:3,y:1},{x:4,y:NaN},{x:5,y:-1}],second=first.map(point=>({x:point.x,y:0}));
  assert.deepEqual(alignedIntersections(first,second),[{x:.5,y:0},{x:2,y:0}]);assert.deepEqual(alignedIntersections([{x:0,y:0},{x:1,y:0}],[{x:0,y:0},{x:1,y:0}]),[]);
});
