import test from 'node:test';
import assert from 'node:assert/strict';
import {WorldZoomInput,WorldZoomInstantInput,normalizeWorldZoomDelta} from '../src/zoom-clock.js';
const near=(a:number,b:number,t=2e-12)=>assert.ok(Math.abs(a-b)<=t,`${a} != ${b}`);

test('same-frame discrete scales use latest camera and one final clamp, preserving public command observations',()=>{
  // Frozen public observations: instant-order-public-visible/2026-11-03T05-01-25-448Z.
  const instant=new WorldZoomInstantInput(),inertia=new WorldZoomInput();
  instant.enqueue(120,4);instant.enqueue(-120,4);assert.equal(instant.getStoredScalarCount(),1);
  near(inertia.advance({x:0,y:0,z:2.99},1000/60,instant.takeFactor()).position.z,2.8704);
  assert.equal(instant.getStoredScalarCount(),0);
  instant.enqueue(120,4);
  // An intervening explicit setter is represented by the latest input pose2.
  near(inertia.advance({x:0,y:0,z:2},1000/60,instant.takeFactor()).position.z,2.4);
});

test('existing opposite inertia is applied before the combined radius is clamped',()=>{
  // Public discriminator: final-clamp-order-public-visible/2026-11-03T05-09-29-003Z.
  const inertia=new WorldZoomInput(),instant=new WorldZoomInstantInput();inertia.enqueue(-120);instant.enqueue(120,4);
  const value=inertia.advance({x:0,y:0,z:2.99},1000/60,instant.takeFactor());
  near(value.position.z,3);assert.ok(value.pendingAfter<0,'Discrete input must not cancel existing animation');
  const next=inertia.advance(value.position,1000/60);assert.ok(next.position.z<3);
});

test('bounded zoom input preserves sign semantics, finite atomic state and explicit long-frame policy',()=>{
  const model=new WorldZoomInput();model.enqueue(1);model.enqueue(120);assert.equal(model.getPending(),2);model.enqueue(-210);assert.equal(model.getPending(),-1);
  assert.throws(()=>model.enqueue(Infinity),RangeError);assert.equal(model.getPending(),-1);
  const queued=new WorldZoomInstantInput();queued.enqueue(1);const before=queued.getPendingFactor();assert.throws(()=>queued.enqueue(1,Infinity),RangeError);assert.equal(queued.getPendingFactor(),before);
  // Observation brackets49.8..50.1ms; exact50ms is this original documented policy.
  near(normalizeWorldZoomDelta(49.8),49.8);near(normalizeWorldZoomDelta(50),50);near(normalizeWorldZoomDelta(50.1),1000/60);
  near(normalizeWorldZoomDelta(undefined),1000/60);model.clear();queued.clear();assert.equal(model.getPending(),0);assert.equal(queued.hasPending(),false);
});
