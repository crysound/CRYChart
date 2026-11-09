import assert from 'node:assert/strict';
import test from 'node:test';
import {advanceCalendar,calendarBoundaries,calendarTickGrid,floorCalendar,selectCalendarUnit} from '../src/date-time-grid.js';

const DAY=86400000,iso=(value:number)=>new Date(value).toISOString();
const range=(start:number,days:number)=>({start,end:start+days*DAY});

test('basic 0000 places all four January 2022 Mondays, not fixed millisecond nice ticks',()=>{
  const interval=range(Date.UTC(2022,0,1),28);
  assert.equal(selectCalendarUnit(interval,true),'week');
  const actual=calendarBoundaries(interval,'week',true).values.map(iso);
  assert.deepEqual(actual,['2022-01-03T00:00:00.000Z','2022-01-10T00:00:00.000Z','2022-01-17T00:00:00.000Z','2022-01-24T00:00:00.000Z']);
  const grid=calendarTickGrid({interval,utc:true,axisSizePixels:620,format:v=>iso(v).slice(0,10),measure:()=>70,minorVisible:false});
  assert.deepEqual(grid.major.map(t=>iso(t.value)),actual);assert.equal(grid.majorStep,1);assert.equal(grid.great.length,1);
  assert.equal(grid.great[0]!.anchor,interval.start);assert.deepEqual(interval,range(Date.UTC(2022,0,1),28));
});

test('basic 0001 places July, August and September boundaries across unequal month lengths',()=>{
  const interval=range(Date.UTC(2022,6,1),89);
  assert.equal(selectCalendarUnit(interval,true),'month');
  const grid=calendarTickGrid({interval,utc:true,axisSizePixels:620,format:v=>iso(v).slice(0,10),measure:()=>70,minorVisible:false});
  assert.deepEqual(grid.major.map(t=>iso(t.value)),['2022-07-01T00:00:00.000Z','2022-08-01T00:00:00.000Z','2022-09-01T00:00:00.000Z']);
  assert.deepEqual(grid.major.slice(1).map((t,i)=>(t.value-grid.major[i]!.value)/DAY),[31,31]);
});

test('calendar months respect leap February and real year boundaries',()=>{
  const values=calendarBoundaries({start:Date.UTC(2024,0,1),end:Date.UTC(2024,3,1)},'month',true).values;
  assert.deepEqual(values.map(iso),['2024-01-01T00:00:00.000Z','2024-02-01T00:00:00.000Z','2024-03-01T00:00:00.000Z','2024-04-01T00:00:00.000Z']);
  assert.deepEqual(values.slice(1).map((v,i)=>(v-values[i]!)/DAY),[31,29,31]);
  assert.equal(iso(advanceCalendar(Date.UTC(2023,0,1),'year',1,true)),'2024-01-01T00:00:00.000Z');
});

test('origin is added for calendar arithmetic once, reverse intervals preserve the same value set',()=>{
  const origin=Date.UTC(2022,0,1),relative={start:0,end:28*DAY},absolute={start:origin,end:origin+28*DAY};
  const wanted=calendarBoundaries(absolute,'week',true).values;
  assert.deepEqual(calendarBoundaries(relative,'week',true,origin).values.map(v=>v+origin),wanted);
  assert.deepEqual(calendarBoundaries({start:relative.end,end:relative.start},'week',true,origin).values.map(v=>v+origin),wanted);
});

test('UTC and local midnight differ by local offset; DST days and weeks use civil increments',()=>{
  const saved=process.env.TZ;process.env.TZ='America/New_York';
  try{
    const first=new Date(2024,2,9).getTime(),last=new Date(2024,2,12).getTime();
    const days=calendarBoundaries({start:first,end:last},'day',false).values;
    assert.deepEqual(days.map(iso),['2024-03-09T05:00:00.000Z','2024-03-10T05:00:00.000Z','2024-03-11T04:00:00.000Z','2024-03-12T04:00:00.000Z']);
    assert.deepEqual(days.slice(1).map((v,i)=>(v-days[i]!)/3600000),[24,23,24]);
    const monday=new Date(2024,2,4).getTime();assert.equal((advanceCalendar(monday,'week',1,false)-monday)/3600000,167);
    const repeated=new Date('2024-11-03T06:30:00Z').getTime();
    assert.equal(iso(floorCalendar(repeated,'hour',false)),'2024-11-03T06:00:00.000Z');
  }finally{if(saved===undefined)delete process.env.TZ;else process.env.TZ=saved;}
});

test('Gregorian year below 100 is not silently converted into the twentieth century',()=>{
  const d=new Date(0);d.setUTCFullYear(25,7,16);d.setUTCHours(12,34,56,789);
  assert.equal(iso(floorCalendar(d.getTime(),'year',true)),'0025-01-01T00:00:00.000Z');
  assert.equal(iso(floorCalendar(d.getTime(),'decade',true)),'0020-01-01T00:00:00.000Z');
});

test('label widths and viewport determine whole-calendar stride without shortening label text',()=>{
  const interval={start:Date.UTC(2022,0,1),end:Date.UTC(2023,0,1)};
  const options={interval,utc:true,gapPixels:8,format:(v:number)=>iso(v).slice(0,7),measure:()=>68,minorVisible:false};
  const wide=calendarTickGrid({...options,axisSizePixels:741}),narrow=calendarTickGrid({...options,axisSizePixels:341});
  assert.equal(wide.zoom,'month');assert.equal(wide.majorStep,2);assert.equal(narrow.majorStep,3);
  assert.deepEqual(wide.major.map(t=>new Date(t.value).getUTCMonth()+1),[2,4,6,8,10,12]);
  assert.deepEqual(narrow.major.map(t=>new Date(t.value).getUTCMonth()+1),[3,6,9,12]);
  assert.ok(wide.major.every(t=>t.label===iso(t.value).slice(0,7)));
});

test('minor levels share the selected calendar zoom, have unique values, and never overlap major labels',()=>{
  const interval=range(Date.UTC(2022,0,1),3),seen:Array<{level:string;zoom:string}>=[];
  const grid=calendarTickGrid({interval,utc:true,axisSizePixels:740,gapPixels:8,format:(v,level,zoom)=>{seen.push({level,zoom});return level+':'+iso(v);},measure:(_label,level)=>level==='major'?30:38});
  assert.equal(grid.zoom,'day');assert.ok(grid.minor.length>0);
  assert.equal(new Set([...grid.major,...grid.minor].map(t=>t.value)).size,grid.major.length+grid.minor.length);
  assert.ok(seen.every(s=>s.zoom==='day'));
  for(const minor of grid.minor)for(const major of grid.major)assert.ok(Math.abs(minor.value-major.value)/(3*DAY)*740>=42);
});

test('monthly minor weeks remain Mondays including the first Monday after a midweek month boundary',()=>{
  const interval=range(Date.UTC(2022,6,1),89);
  const grid=calendarTickGrid({interval,utc:true,axisSizePixels:1000,gapPixels:0,format:()=>'',measure:()=>0});
  assert.equal(grid.zoom,'month');assert.equal(grid.minorStep,1);
  assert.ok(grid.minor.some(t=>t.value===Date.UTC(2022,6,4)));
  assert.ok(grid.minor.every(t=>new Date(t.value).getUTCDay()===1));
  assert.equal(new Set(grid.minor.map(t=>t.value)).size,grid.minor.length);
});

test('one-second and ten-second supported views remain finite and nonempty with bounded candidates',()=>{
  const first=Date.UTC(2022,0,1);
  for(const span of[1000,10000])for(const axisSizePixels of[400,800]){
    const grid=calendarTickGrid({interval:{start:first,end:first+span},utc:true,axisSizePixels,format:v=>String(v-first),measure:()=>40});
    assert.ok(grid.major.length>0);assert.equal(grid.truncated,false);
    assert.ok(grid.major.length<=1000&&grid.major.every(t=>Number.isFinite(t.value)&&t.value>=first&&t.value<=first+span));
  }
  const tinyBudget=calendarTickGrid({interval:{start:0,end:1000},utc:true,axisSizePixels:500,format:()=>'',measure:()=>0,maxTicks:4});
  assert.equal(tinyBudget.truncated,false);assert.ok(tinyBudget.major.length>0&&tinyBudget.major.length<=4);
});

test('minor density is evaluated before crossing-label suppression and responds to minor font size',()=>{
  const interval={start:Date.UTC(2022,0,1),end:Date.UTC(2022,1,1)};
  const base={interval,utc:true,axisSizePixels:698,gapPixels:16,format:(v:number)=>iso(v).slice(0,10)};
  const grid=calendarTickGrid({...base,minorGapPixels:20,measure:(_text,level)=>level==='major'?40:27});
  assert.equal(grid.minorStep,3);
  assert.deepEqual(grid.minor.map(t=>new Date(t.value).getUTCDate()),[6,13,20,27]);
  const large=calendarTickGrid({...base,minorGapPixels:48,measure:(_text,level)=>level==='major'?40:60});
  assert.ok(large.minor.length<grid.minor.length);
  assert.deepEqual(large.major.map(t=>t.value),grid.major.map(t=>t.value));
});

test('malformed and enormous candidate sets stop deterministically without changing input',()=>{
  assert.deepEqual(calendarBoundaries({start:NaN,end:Infinity},'day',true),{values:[],truncated:false});
  assert.equal(calendarBoundaries({start:0,end:100000},'millisecond',true,0,5).truncated,true);
  const common={utc:true,axisSizePixels:500,format:()=>'',measure:()=>0};
  for(const interval of [{start:0,end:0},{start:Infinity,end:1},{start:0,end:1e30}])assert.equal(calendarTickGrid({...common,interval}).major.length,0);
  assert.equal(calendarTickGrid({...common,interval:{start:0,end:1000},maxTicks:4}).truncated,false);
});
