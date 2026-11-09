import test from 'node:test';
import assert from 'node:assert/strict';
import { elapsedLabel, durationTicks, calendarTicks, visibleExtent, formatNanosecondTimestamp } from '../examples/official/temporal-data';

test('elapsed labels carry rounding through minute/hour boundaries and preserve signed microseconds',()=>{
  assert.equal(elapsedLabel(3_599_999.9996,3),'01:00:00.000');
  assert.equal(elapsedLabel(-0.001,6),'-00:00:00.000001');
  assert.equal(elapsedLabel(360_000_000,0),'100:00:00');
  const ticks=durationTicks(4*3600000,4.5*3600000);
  assert.ok(ticks.length>=5&&ticks.length<=10);
  assert.ok(ticks.every(tick=>/^04:[0-5]\d:00$/.test(tick.label)));
  const fine=durationTicks(.000010,.000050);
  assert.equal(new Set(fine.map(tick=>tick.label)).size,fine.length);
  assert.ok(fine.every(tick=>/\.\d{9}$/.test(tick.label)));
});

test('calendar ticks use actual UTC month boundaries including a leap year',()=>{
  const ticks=calendarTicks(Date.UTC(2023,11,1),Date.UTC(2024,5,1),'en-US');
  assert.ok(ticks.some(tick=>tick.position===Date.UTC(2024,1,1)));
  assert.ok(ticks.some(tick=>tick.position===Date.UTC(2024,2,1)));
  const feb=ticks.findIndex(tick=>tick.position===Date.UTC(2024,1,1));
  assert.equal((ticks[feb+1].position-ticks[feb].position)/86400000,29);
});

test('visible fitting includes interpolated boundaries and excludes outside extreme values',()=>{
  const points=[{x:0,y:-1000},{x:10,y:0},{x:20,y:100},{x:30,y:5000}];
  const visible=visibleExtent(points.length,i=>points[i],12,18)!;
  assert.equal(visible.dataMin,20);assert.equal(visible.dataMax,80);
  assert.ok(visible.start<20&&visible.end>80&&visible.start>-100&&visible.end<200);
  assert.equal(visibleExtent(points.length,i=>points[i],31,32),undefined);
});

test('nanosecond timestamps never round-trip through a full epoch Number',()=>{
  const epoch=BigInt(Date.UTC(2026,10,2,21,55,59))*1_000_000n+532_557_620n;
  assert.equal(formatNanosecondTimestamp(epoch),'21:55:59.532557620');
  assert.equal(formatNanosecondTimestamp(epoch+1n),'21:55:59.532557621');
  assert.equal(Number(epoch),Number(epoch+1n),'the test is beyond exact Number epoch precision');
});
