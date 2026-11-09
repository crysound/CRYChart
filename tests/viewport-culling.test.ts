import test from 'node:test';
import assert from 'node:assert/strict';
import {ChartXY} from '../src/chart.js';
import {DataSetXY} from '../src/core/data.js';
import {visibleSampleRange} from '../src/viewport.js';

test('offscreen precision blocks retain data but avoid projection until entering the viewport',()=>{
  const c=new ChartXY(),left=c.addLineSeries().add([{x:0,y:1},{x:1,y:2}]),right=c.addLineSeries().add([{x:100,y:3},{x:101,y:4}]);
  c.getDefaultAxisX().setInterval({start:0,end:2});c.getDefaultAxisY().setInterval({start:0,end:5});
  let leftDraws=0,rightDraws=0;const l=left.drawPacket.bind(left),r=right.drawPacket.bind(right);left.drawPacket=(...args)=>{leftDraws++;return l(...args);};right.drawPacket=(...args)=>{rightDraws++;return r(...args);};
  c.renderNow();assert.equal(leftDraws,1);assert.equal(rightDraws,0);assert.equal(right.getSampleCount(),2);
  c.getDefaultAxisX().setInterval({start:99,end:102});c.renderNow();assert.equal(leftDraws,1);assert.equal(rightDraws,1);assert.equal(left.getSampleCount(),2);c.dispose();
});

test('culling keeps thick markers at the boundary and lines crossing a viewport',()=>{
  const c=new ChartXY(),point=c.addPointSeries().setPointSize(50).add({x:-.01,y:1}),line=c.addLineSeries().add([{x:-5,y:0},{x:5,y:2}]);
  c.getDefaultAxisX().setInterval({start:0,end:1});c.getDefaultAxisY().setInterval({start:0,end:2});
  const drawn:number[]=[];for(const s of [point,line]){const original=s.drawPacket.bind(s);s.drawPacket=(...args)=>{drawn.push(s.id);return original(...args);};}
  c.renderNow();assert.ok(drawn.includes(point.id));assert.ok(drawn.includes(line.id));c.dispose();
});

test('bounds extend on append and recompute after clear, retention wrap, and data rebinding',()=>{
  const c=new ChartXY(),s=c.addLineSeries().add([{x:1,y:3},{x:2,y:4}]);assert.deepEqual(s.bounds('y'),{start:3,end:4});
  s.add({x:3,y:-2});assert.deepEqual(s.bounds('y'),{start:-2,end:4});s.clear().add({x:10,y:100});assert.deepEqual(s.bounds('y'),{start:100,end:100});
  s.setMaxSampleCount(2).add([{x:11,y:5},{x:12,y:6}]);assert.deepEqual(s.bounds('y'),{start:5,end:6});
  s.setDataSet(new DataSetXY({schema:{xValues:{storage:Float64Array},yValues:{storage:Float64Array}}}).appendSamples({xValues:[20],yValues:[9]}));assert.deepEqual(s.bounds('x'),{start:20,end:20});assert.deepEqual(s.bounds('y'),{start:9,end:9});c.dispose();
});

test('visible line range keeps both crossing neighbors, raw counts, and inverse-axis equivalence',()=>{
  const c=new ChartXY(),s=c.addLineSeries().addArraysXY(Float64Array.from({length:10001},(_,i)=>1e12+i),Float64Array.from({length:10001},(_,i)=>Math.sin(i)));
  c.getDefaultAxisX().setInterval({start:1e12+5000.25,end:1e12+5009.75});
  const packet=s.drawPacket(),range=visibleSampleRange(packet,800);
  assert.equal(packet.monotonicX,true);assert.equal(range.first,5000);assert.equal(range.count,11);assert.equal(s.getSampleCount(),10001);
  assert.deepEqual(visibleSampleRange({...packet,domain:{...packet.domain,x:{start:packet.domain.x.end,end:packet.domain.x.start}}},800),range);
  const buffer=packet.positions.buffer;c.getDefaultAxisX().setInterval({start:1e12+200,end:1e12+205});const panned=s.drawPacket();assert.equal(panned.positions.buffer,buffer);assert.equal(panned.revision,packet.revision);c.dispose();
});

test('unordered trajectories and unknown point radii keep all geometry; sorted append remains cullable',()=>{
  const c=new ChartXY(),s=c.addLineSeries().addArraysXY([0,1,2],[0,1,2]);c.getDefaultAxisX().setInterval({start:0,end:1});
  assert.equal(s.drawPacket().monotonicX,true);s.add({x:3,y:0});assert.equal(s.drawPacket().monotonicX,true);s.add({x:.5,y:1});let p=s.drawPacket();assert.equal(p.monotonicX,false);assert.deepEqual(visibleSampleRange(p,800),{first:0,count:5});
  s.clear().addArraysXY([0,1,2],[0,1,2]);p=s.drawPacket();assert.equal(p.monotonicX,true);assert.deepEqual(visibleSampleRange({...p,pointSizes:new Float32Array([10,5000,10])},800),{first:0,count:3});c.dispose();
});
