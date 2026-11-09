// 白盒状态/布局检查读取保留的策略对象；公开类型getter由独立四型回归验证。
import test from 'node:test';
import assert from 'node:assert/strict';
import {DateTimeFormatting} from '../src/date-time-formatting.js';
import {Axis,DateTimeTickStrategy,type AxisHost} from '../src/axis.js';

const range={start:0,end:259200000};
const origin=Date.UTC(2022,0,1);

test('DateTime label callbacks receive origin-adjusted timestamps, relative range and configured locale',()=>{
  const formatting=new DateTimeFormatting(), calls:any[]=[];
  formatting.setUTC(true);formatting.setLocale('en-US');formatting.setDateOrigin(new Date(origin));
  const callback=(level:string)=>(value:number,interval:any,locale?:string)=>{calls.push({level,value,interval,locale});interval.start=99;return `${level}:${value}`;};
  formatting.setFormatting(callback('great'),callback('major'),callback('minor'));
  for(const level of ['great','major','minor'] as const)assert.equal(formatting.formatTick(45,range,level,'day'),`${level}:${origin+45}`);
  assert.deepEqual(calls.map(({level,value,locale})=>({level,value,locale})),['great','major','minor'].map(level=>({level,value:origin+45,locale:'en-US'})));
  assert.deepEqual(range,{start:0,end:259200000});
});

test('DateTime origin resets to epoch and a cursor callback is independent of label formatting',()=>{
  const formatting=new DateTimeFormatting();formatting.setLocale('en-US');formatting.setDateOrigin(new Date(origin));
  const calls:any[]=[];const cursor=(value:number,r:any,locale?:string)=>{calls.push({value,r,locale});return `cursor:${value}`;};
  assert.equal(formatting.formatCursor(-3600000,range,cursor),`cursor:${origin-3600000}`);
  formatting.setFormatting({year:'numeric'},{month:'short',day:'2-digit'});
  assert.equal(formatting.formatCursor(45,range,cursor),`cursor:${origin+45}`);
  formatting.setDateOrigin(undefined);
  assert.equal(formatting.getDateOrigin(),undefined);assert.equal(formatting.getOriginTimestamp(),0);
  assert.equal(formatting.formatCursor(45,range,cursor),'cursor:45');
  assert.ok(calls.every(call=>call.locale===undefined&&call.r.start===0&&call.r.end===259200000));
  assert.doesNotThrow(()=>formatting.formatCursor(45,range));
});

test('Intl label options honor locale and UTC, retain subsecond precision and do not retain caller objects',()=>{
  const formatting=new DateTimeFormatting(),options:Intl.DateTimeFormatOptions={month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',fractionalSecondDigits:3};
  formatting.setUTC(true);formatting.setLocale('en-US');formatting.setDateOrigin(new Date(origin));
  formatting.setFormatting(undefined,options);const expected=new Intl.DateTimeFormat('en-US',{...options,timeZone:'UTC'}).format(origin+45);
  options.month='long';
  assert.equal(formatting.formatTick(45,range,'major','second'),expected);
  formatting.setLocale('de-DE');
  assert.equal(formatting.formatTick(45,range,'major','second'),new Intl.DateTimeFormat('de-DE',{month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',fractionalSecondDigits:3,timeZone:'UTC'}).format(origin+45));
});

test('zoom overrides reset to defaults and setting all levels replaces earlier zoom overrides',()=>{
  const formatting=new DateTimeFormatting();formatting.setUTC(true);formatting.setLocale('en-US');
  formatting.setFormatting(()=> 'global-great',()=> 'global-major',()=> 'global-minor');
  formatting.setZoomFormatting('day',()=> 'day-great',()=> 'day-major',()=> 'day-minor');
  assert.equal(formatting.formatTick(0,range,'major','day'),'day-major');
  assert.equal(formatting.formatTick(0,range,'major','month'),'global-major');
  formatting.setZoomFormatting('day',undefined,undefined);
  assert.equal(formatting.formatTick(0,range,'major','day'),new Intl.DateTimeFormat('en-US',{day:'numeric',timeZone:'UTC'}).format(0));
  formatting.setFormatting(undefined,()=> 'new-major');
  assert.equal(formatting.formatTick(0,range,'major','day'),'new-major');
});

test('invalid DateTime configuration leaves all prior formatting and origin intact',()=>{
  let invalidations=0;const formatting=new DateTimeFormatting(()=>invalidations++);
  formatting.setDateOrigin(new Date(origin));formatting.setFormatting(undefined,()=> 'valid');const before=invalidations;
  assert.throws(()=>formatting.setFormatting(()=> 'new', {month:'bad'} as any),RangeError);
  assert.throws(()=>formatting.setDateOrigin(new Date(NaN)),RangeError);
  assert.throws(()=>formatting.setLocale('not_a_locale'),RangeError);
  assert.equal(invalidations,before);assert.equal(formatting.getOriginTimestamp(),origin);
  assert.equal(formatting.formatTick(0,range,'major','day'),'valid');
  const received=formatting.getDateOrigin()!;received.setFullYear(1999);assert.equal(formatting.getOriginTimestamp(),origin);
});

test('default DateTime cursor keeps local calendar fields and nonfinite values remain explicit',()=>{
  const formatting=new DateTimeFormatting();formatting.setUTC(true);formatting.setLocale('en-US');
  const date=new Date(origin+45),pad=(n:number)=>String(n).padStart(2,'0');
  assert.equal(formatting.formatCursor(origin+45,range),`${date.getFullYear()}/${date.getMonth()+1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`);
  for(const value of [NaN,Infinity,-Infinity])assert.equal(formatting.formatCursor(value,range),String(value));
});

test('Axis DateTime configuration reaches rendered tick labels and public cursor formatting after reset',()=>{
  let paints=0;
  const host:AxisHost={plot:{left:0,top:0,width:800,height:400},invalidate(){paints++;},boundsFor(){return undefined;}};
  const axis=new Axis(host,'x').setInterval(range);
  const seen:any[]=[];
  axis.setTickStrategy('DateTime',(strategy:DateTimeTickStrategy)=>strategy.setUTC(true).setLocale('en-US').setDateOrigin(new Date(origin))
    .setFormatting(undefined,(value,interval,locale)=>{seen.push({value,interval,locale});return `D${value}`;},value=>`m${value}`)
    .setCustomTickPlacement({major:()=>[0,86400000],minor:()=>[3600000]})
    .setCursorFormatter((value:number)=>`C${value}`));
  assert.deepEqual(axis.tickLayout(800),{major:[{value:0,label:`D${origin}`},{value:86400000,label:`D${origin+86400000}`}],minor:[{value:3600000,label:`m${origin+3600000}`} ]});
  assert.equal(axis.formatValue(45),`C${origin+45}`);
  assert.equal(seen[0].locale,'en-US');assert.deepEqual(seen[0].interval,range);
  const strategy=axis.tickStrategy as DateTimeTickStrategy,before=paints;
  axis.setTickStrategy('DateTime',(current:DateTimeTickStrategy)=>current.setDateOrigin(undefined));
  assert.equal(axis.tickStrategy,strategy);assert.equal(strategy.getDateOrigin(),undefined);
  assert.equal(axis.formatValue(45),'C45');assert.equal(axis.tickLayout().major[0]!.label,'D0');assert.ok(paints>before);
  axis.setTickStrategy('DateTime',(current:DateTimeTickStrategy)=>current.setFormatting(undefined,undefined,undefined).setCursorFormatter(undefined));
  assert.doesNotThrow(()=>axis.formatValue(45));assert.doesNotThrow(()=>axis.tickLayout());
});

test('DateTime formatter calls cannot mutate the actual axis interval or its typed source values',()=>{
  const host:AxisHost={plot:{left:0,top:0,width:800,height:400},invalidate(){},boundsFor(){return undefined;}};
  const source=new Float64Array([0,45,86400000]),before=new Uint8Array(source.buffer).slice();
  const axis=new Axis(host,'x').setInterval(range).setTickStrategy('DateTime',(s:DateTimeTickStrategy)=>s
    .setDateOrigin(new Date(origin)).setCursorFormatter((value:number,interval:any)=>{interval.end=-1;return `${value}`;}));
  assert.deepEqual(Array.from(source,value=>axis.formatValue(value)),Array.from(source,value=>String(value+origin)));
  assert.deepEqual(axis.getInterval(),range);assert.deepEqual(new Uint8Array(source.buffer),before);
});

test('DateTime default week and month labels use the selected calendar layer and public locale options',()=>{
  const host:AxisHost={plot:{left:0,top:0,width:700,height:400},invalidate(){},boundsFor(){return undefined;}};
  const week=new Axis(host,'x').setInterval({start:Date.UTC(2022,0,1),end:Date.UTC(2022,0,29)})
    .setTickStrategy('DateTime',(s:DateTimeTickStrategy)=>s.setUTC(true).setLocale('en-US'));
  const weekTicks=week.tickLayout(640,undefined,()=>30);
  assert.deepEqual(weekTicks.major.map(t=>t.value),[3,10,17,24].map(d=>Date.UTC(2022,0,d)));
  assert.deepEqual(weekTicks.major.map(t=>t.label),['3 Mon','10 Mon','17 Mon','24 Mon']);
  assert.equal(weekTicks.great?.length,1);assert.equal(weekTicks.great?.[0]?.anchor,Date.UTC(2022,0,1));
  const months=new Axis(host,'x').setInterval({start:Date.UTC(2022,6,1),end:Date.UTC(2022,8,28)})
    .setTickStrategy('DateTime',(s:DateTimeTickStrategy)=>s.setUTC(true).setLocale('en-US'));
  assert.deepEqual(months.tickLayout(640,undefined,()=>40).major.map(t=>({value:t.value,label:t.label})),[
    {value:Date.UTC(2022,6,1),label:'July'},{value:Date.UTC(2022,7,1),label:'August'},{value:Date.UTC(2022,8,1),label:'September'},
  ]);
});

test('DateTime great style is independent, defaults hidden, and all-level style changes affect three styles',()=>{
  const strategy=new DateTimeTickStrategy();
  assert.equal(strategy.getGreatTickStyle().getLabelFillStyle().kind,'empty');
  assert.equal(strategy.getGreatTickStyle().getGridStrokeStyle().getThickness(),0);
  assert.equal(strategy.getMajorTickStyle().getLabelFont().getSize(),14);
  assert.equal(strategy.getMinorTickStyle().getLabelFont().getSize(),10);
  assert.equal(strategy.getMinorTickStyle().getLabelFillStyle(),strategy.getMajorTickStyle().getLabelFillStyle());
  assert.ok(strategy.getMinorTickStyle().hasLabelFontOverride());
  const major=strategy.getMajorTickStyle(),minor=strategy.getMinorTickStyle();
  strategy.setGreatTickStyle(tick=>tick.setTickLength(13));
  assert.equal(strategy.getGreatTickStyle().getTickLength(),13);assert.equal(major.getTickLength(),7);assert.equal(minor.getTickLength(),4);
  let calls=0;strategy.setTickStyle(tick=>{calls++;return tick.setTickLength(9);});
  assert.equal(calls,3);for(const tick of[strategy.getGreatTickStyle(),major,minor])assert.equal(tick.getTickLength(),9);
});

test('calendar placement keeps callback values/range/locale and zoom-specific overrides',()=>{
  const host:AxisHost={plot:{left:0,top:0,width:800,height:400},invalidate(){},boundsFor(){return undefined;}};
  const end=28*86400000,seen:any[]=[];
  const axis=new Axis(host,'x').setInterval({start:0,end}).setTickStrategy('DateTime',(s:DateTimeTickStrategy)=>s
    .setUTC(true).setLocale('en-US').setDateOrigin(new Date(origin))
    .setFormattingWeek(()=> 'great',(value,r,locale)=>{seen.push({value,r:{...r},locale});r.end=-1;return `W${value}`;},()=>''));
  const ticks=axis.tickLayout(800,undefined,()=>1);
  assert.deepEqual(ticks.major.map(t=>t.value),[2,9,16,23].map(n=>n*86400000));
  assert.deepEqual(ticks.major.map(t=>t.label),[2,9,16,23].map(n=>`W${origin+n*86400000}`));
  assert.ok(seen.every(call=>call.locale==='en-US'&&call.r.start===0&&call.r.end===end));
  assert.deepEqual(axis.getInterval(),{start:0,end});
});
