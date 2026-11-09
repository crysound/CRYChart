// 白盒状态/布局检查读取保留的策略对象；公开类型getter由独立四型回归验证。
import assert from 'node:assert/strict';
import test from 'node:test';
import {timeTickPositions} from '../src/time-grid.js';
import {numericTickPositions} from '../src/grid-layout.js';
import {Axis,type AxisHost} from '../src/axis.js';

const MINUTE=60_000,HOUR=60*MINUTE,DAY=24*HOUR;
const host:AxisHost={plot:{width:620,height:500},invalidate(){},boundsFor(){return undefined;}};

test('captured eight-hour major grid stays at one hour across public resize inputs',()=>{
  for(const pixels of[319.7607439863349,601.6318385467601,619.7607439863349,919.7607439863349]){
    const grid=timeTickPositions(0,8*HOUR,pixels);assert.equal(grid.step,HOUR);
    assert.deepEqual(grid.major,Array.from({length:9},(_,i)=>i*HOUR));
  }
});
test('captured 15/30/48 minute major grids use exact quarter-hour boundaries',()=>{
  for(const minutes of[15,30,48])for(const pixels of[319.7607439863349,619.7607439863349,919.7607439863349]){
    const grid=timeTickPositions(0,minutes*MINUTE,pixels);assert.equal(grid.step,15*MINUTE);
    assert.deepEqual(grid.major,Array.from({length:Math.floor(minutes/15)+1},(_,i)=>i*15*MINUTE));
  }
});
test('captured one-hour and two-hour ranges retain hour anchors',()=>{
  for(const hours of[1,2])assert.deepEqual(timeTickPositions(0,hours*HOUR,620).major,Array.from({length:hours+1},(_,i)=>i*HOUR));
});
test('both raw real-rectangle intervals retain 04:15,04:30,04:45 without rewriting endpoints',()=>{
  for(const input of[{start:14400001.523322968,end:17280001.218658373},{start:14400007.602994438,end:17280003.64943733}]){
    const before={...input};assert.deepEqual(timeTickPositions(input.start,input.end,620).major,[15300000,16200000,17100000]);assert.deepEqual(input,before);
  }
});
test('captured negative and cross-zero domains share the same zero-anchored clock lattice',()=>{
  assert.deepEqual(timeTickPositions(-8*HOUR,0,620).major,Array.from({length:9},(_,i)=>(i-8)*HOUR));
  assert.deepEqual(timeTickPositions(-HOUR,HOUR,620).major,[-HOUR,0,HOUR]);
  const forward=timeTickPositions(-2*HOUR,3*HOUR,620),reverse=timeTickPositions(3*HOUR,-2*HOUR,620);
  assert.deepEqual(forward,reverse);assert.ok(!forward.major.some(value=>Object.is(value,-0)));
});
test('15-second lower fallback and day upper fallback preserve the bounded interval policy',()=>{
  for(const span of[15_000-1,DAY,DAY+1])assert.deepEqual(timeTickPositions(0,span,620),numericTickPositions(0,span,620));
  assert.equal(timeTickPositions(0,15*MINUTE,620).step,15*MINUTE);
  assert.equal(timeTickPositions(0,HOUR-1,620).step,15*MINUTE);
  assert.equal(timeTickPositions(0,HOUR,620).step,HOUR);
  assert.equal(timeTickPositions(0,DAY-1,620).step,HOUR);
});
test('unobserved small, microsecond, nanosecond, zero and nonfinite domains preserve existing behavior',()=>{
  for(const [start,end]of [[-1,1],[0,.001],[0,.000001],[0,1e-16],[0,1e-200],[1.7e12,1.7e12+1],[4,4],[NaN,1],[0,Infinity]]){
    assert.deepEqual(timeTickPositions(start,end,620),numericTickPositions(start,end,620));
  }
});
test('minor positions preserve the old policy except exact duplicates of new majors',()=>{
  for(const span of[15*MINUTE,48*MINUTE,HOUR,8*HOUR]){
    const old=numericTickPositions(0,span,620),next=timeTickPositions(0,span,620),major=new Set(next.major);
    assert.deepEqual(next.minor,old.minor.filter(value=>!major.has(value)));
    assert.equal(new Set([...next.major,...next.minor]).size,next.major.length+next.minor.length);
  }
});
test('Numeric and DateTime Axis dispatch retain existing placement',()=>{
  const numeric=new Axis(host,'x').setInterval({start:0,end:8*HOUR}).setTickStrategy('numeric');
  assert.deepEqual(numeric.tickLayout(620).major.map(t=>t.value),numericTickPositions(0,8*HOUR,620).major);
  const date=new Axis(host,'x').setInterval({start:Date.UTC(2022,0,1),end:Date.UTC(2022,0,29)}).setTickStrategy('datetime',(s:any)=>s.setUTC(true));
  assert.deepEqual(date.tickLayout(620).major.map(t=>t.value),[3,10,17,24].map(day=>Date.UTC(2022,0,day)));
});
test('Time Axis uses clock majors without changing callbacks or cursor formatting',()=>{
  const calls:number[]=[],axis=new Axis(host,'x').setInterval({start:0,end:8*HOUR}).setTickStrategy('time',(s:any)=>s.setMajorFormattingFunction((value:number)=>{calls.push(value);return'raw:'+value;}).setCursorFormatter((value:number)=>'cursor:'+value));
  const ticks=axis.tickLayout(620).major;assert.deepEqual(ticks.map(t=>t.value),Array.from({length:9},(_,i)=>i*HOUR));
  assert.deepEqual(ticks.map(t=>t.label),ticks.map(t=>'raw:'+t.value));assert.deepEqual(calls,ticks.map(t=>t.value));assert.equal(axis.formatValue(.9999),'cursor:0.9999');
});
test('standard custom Time placement preserves exact positions and text',()=>{
  const axis=new Axis(host,'x').setInterval({start:0,end:8*HOUR}).setTickStrategy('time');
  axis.tickStrategy.setCustomTickPlacement({major:()=>[{position:123.25,label:'原标签'},{position:789.125,label:'保持'}],minor:()=>[{position:456.5,label:'小刻度'}]});
  assert.deepEqual(axis.tickLayout(620),{major:[{value:123.25,label:'原标签'},{value:789.125,label:'保持'}],minor:[{value:456.5,label:'小刻度'}]});
});
test('one custom Time level preserves the old automatic peer',()=>{
  const previous=numericTickPositions(0,8*HOUR,620),axis=new Axis(host,'x').setInterval({start:0,end:8*HOUR}).setTickStrategy('time');
  axis.tickStrategy.setMajorTickPlacement(()=>[{position:1,label:'custom'}]);
  assert.deepEqual(axis.tickLayout(620).minor.map(t=>t.value),previous.minor);
  const other=new Axis(host,'x').setInterval({start:0,end:8*HOUR}).setTickStrategy('time');other.tickStrategy.setMinorTickPlacement(()=>[{position:1,label:'custom'}]);
  assert.deepEqual(other.tickLayout(620).major.map(t=>t.value),previous.major);
});
test('tick computation leaves original float bytes unchanged',()=>{
  const values=new Float64Array([-.5,0,.5,.000001,1e-16,1700000000000.125]),before=Buffer.from(values.buffer).toString('hex');
  for(const span of[48*MINUTE,8*HOUR])timeTickPositions(0,span,620);
  assert.equal(Buffer.from(values.buffer).toString('hex'),before);
});
