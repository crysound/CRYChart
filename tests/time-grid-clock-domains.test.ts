import assert from 'node:assert/strict';
import test from 'node:test';
import {timeTickPositions} from '../src/time-grid.js';
const pixels=619.7607439863349;
test('原60秒及60001ms均保留15秒格线，不能退回numeric十秒格线',()=>{
  for(const end of[60000,60001]){const actual=timeTickPositions(0,end,pixels);assert.equal(actual.step,15000);assert.deepEqual(actual.major,[0,15000,30000,45000,60000]);}
});
test('89999到90000ms的已观察主步长边界',()=>{
  assert.deepEqual(timeTickPositions(0,89999,pixels).major,[0,15000,30000,45000,60000,75000]);
  const next=timeTickPositions(0,90000,pixels);assert.equal(next.step,60000);assert.deepEqual(next.major,[0,60000]);
});
test('完整2/3/4/5/6分钟原间隔为一分钟主格线',()=>{
  for(const minutes of[2,3,4,5,6]){const result=timeTickPositions(0,minutes*60000,pixels);assert.equal(result.step,60000);assert.deepEqual(result.major,Array.from({length:minutes+1},(_,i)=>i*60000));}
});
test('599999到600000ms已观察边界，区间外900000回调不能变成可见格线',()=>{
  const before=timeTickPositions(0,599999,pixels),after=timeTickPositions(0,600000,pixels);assert.equal(before.step,60000);assert.deepEqual(before.major,Array.from({length:10},(_,i)=>i*60000));assert.equal(after.step,900000);assert.deepEqual(after.major,[0]);assert.ok(!after.major.includes(900000));
});
test('15秒到小时内的主格线不随字号或有效宽度改变',()=>{
  for(const width of[319.7607439863349,619.7607439863349,919.7607439863349])for(const [end,step]of[[15000,15000],[30000,15000],[60001,15000],[90000,60000],[300000,60000],[600000,900000],[2880000,900000],[3599999,900000],[3600000,3600000]])assert.equal(timeTickPositions(0,end,width).step,step);
});
test('负区间、跨零、反向区间保持时钟零原点且不改输入字节',()=>{
  const a=new Float64Array([-90001,-60001,-15000,0,15000,60001]),before=Buffer.from(a.buffer).toString('hex');
  assert.deepEqual(timeTickPositions(-60001,0,pixels).major,[-60000,-45000,-30000,-15000,0]);
  assert.deepEqual(timeTickPositions(-30000,30000,pixels).major,[-30000,-15000,0,15000,30000]);
  assert.deepEqual(timeTickPositions(30000,-30000,pixels),timeTickPositions(-30000,30000,pixels));assert.equal(Buffer.from(a.buffer).toString('hex'),before);
});
test('新主格线仍去除minor精确重合，未宣称minor已等价',()=>{
  for(const end of[60000,90000,300000,600000,2880000,3600000]){const grid=timeTickPositions(0,end,pixels);assert.equal(new Set([...grid.major,...grid.minor]).size,grid.major.length+grid.minor.length);assert.ok(grid.major.every(v=>v>=0&&v<=end));}
});
