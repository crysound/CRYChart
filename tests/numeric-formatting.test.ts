// 白盒状态/布局检查读取保留的策略对象；公开类型getter由独立四型回归验证。
import test from 'node:test';
import assert from 'node:assert/strict';
import {Axis,NumericTickStrategy} from '../src/axis';
import {FormattingFunctions as format} from '../src/formatting-functions';
import {AxisTickStrategies} from '../src/core/styles';
import {Polar} from '../src/chart';

test('fixed public observations distinguish range-dependent decimals from significant rounding',()=>{
  for(const[range,value,expected]of[
    [{start:-2,end:2},1.23456789,'1.23'],[{start:-6,end:6},1.23456789,'1.2'],
    [{start:-30,end:30},-0,'0.0'],[{start:-50,end:50},-.123456789,'-0'],
    [{start:-.0005,end:.0005},1.23456789,'1.23457'],
    [{start:-5e-13,end:5e-13},12345.6789,'12345.67890000000079'],
    [{start:-2,end:2},1e12+.125,'1000000000000.13'],
  ]as const)assert.equal(format.Numeric(value,range),expected);
  assert.equal(format.Numeric(1.23456789,{start:60,end:0}),'1.2');
  assert.equal(format.Numeric(1.23456789,{start:1,end:1}),'1');
});
test('scientific zero uses endpoint magnitude; the all-zero interval is safely defined',()=>{
  assert.equal(format.Scientific(0,{start:0,end:60}),'0.00e+1');
  assert.equal(format.Scientific(-0,{start:100,end:160}),'0.00e+2');
  assert.equal(format.Scientific(0,{start:-160,end:-100}),'0.00e+2');
  assert.equal(format.Scientific(0,{start:60,end:0}),'0.00e+1');
  assert.equal(format.Scientific(0,{start:-.0005,end:.0005}),'0.00e-4');
  assert.equal(format.Scientific(0,{start:0,end:0}),'0.00e+0');
  assert.equal(format.Scientific(-.123456789,{start:0,end:60}),'-1.23e-1');
});
function axis(){return new Axis({plot:{width:640,height:495},invalidate(){},boundsFor(){return{start:-2,end:2};}},'y').setInterval({start:-2,end:2});}
test('formatter precedence, same-strategy reconfiguration and explicit reset follow public observations',()=>{
  const a=axis(),s=a.tickStrategy,all=(v:number)=>'all:'+v.toFixed(3),major=(v:number)=>'major:'+v.toFixed(2),cursor=(v:number)=>'cursor:'+v.toFixed(6);
  s.setFormattingFunction(all).setMajorFormattingFunction(major).setCursorFormatter(cursor);
  assert.equal(a.formatValue(1.23456789),'cursor:1.234568');
  assert.equal(s.getMajorFormattingFunction(),major);assert.equal(s.getMinorFormattingFunction(),all);assert.equal(s.getExtremeFormattingFunction(),all);
  s.setFormattingFunction(all);assert.equal(s.getMajorFormattingFunction(),all);assert.equal(s.getCursorFormatter(),all);
  assert.equal(a.formatValue(1.23456789),'all:1.235');
  s.setCursorFormatter(undefined);assert.equal(a.formatValue(1.23456789),'1.23');
  a.setTickStrategy(AxisTickStrategies.Numeric,(fresh:any)=>{assert.equal(fresh,s);return fresh;});
  assert.equal(a.tickStrategy.getMajorFormattingFunction(),all);
  assert.equal(a.tickStrategy.getCursorFormatter(),undefined);
});
test('configuration changes display only; each callback gets independent current range metadata',()=>{
  const a=axis(),source=new Float64Array([-.123456789,.12567891234567,1.23456789012345]),before=new Uint8Array(source.buffer.slice(0)),calls:any[]=[];
  a.tickStrategy.setFormattingOffset(1000).setFormattingFunction((v:number,range:any,locale:any,shiftInfo:any)=>{calls.push({v,range,locale,shiftInfo});range.start=100;return v.toFixed(3);});
  assert.equal(a.formatValue(source[1]),'1000.126');assert.equal(calls[0].v,1000+source[1]!);
  assert.deepEqual(a.getInterval(),{start:-2,end:2});assert.equal(calls[0].locale,undefined);assert.equal(calls[0].shiftInfo,undefined);
  a.tickStrategy.setFormattingOffset(undefined);assert.equal(a.formatValue(source[1]),'0.126');
  assert.deepEqual(new Uint8Array(source.buffer),before);
});
test('CRY numeric precision extension validates bounds and configures actual formatters',()=>{
  const s=new NumericTickStrategy().setNumericPrecision(3);
  assert.equal(s.getMajorFormattingFunction()!(1.23456),'1.235');
  assert.equal(s.getCursorFormatter()!(1.23456),'1.235');
  for(const invalid of[-1,101,NaN,Infinity,1.5])assert.throws(()=>s.setNumericPrecision(invalid),RangeError);
});

test('an unconfigured formatting offset preserves negative zero in every public callback path',()=>{
  const a=axis(),seen:number[]=[];
  a.tickStrategy.setFormattingFunction((value:number)=>{seen.push(value);return Object.is(value,-0)?'-zero':'other';});
  assert.equal(a.formatValue(-0),'-zero');assert.equal(a.formatCursorValue(-0),'-zero');
  a.tickStrategy.setCustomTickPlacement({major:()=>[{position:-0}],minor:()=>[]});
  assert.equal(a.tickLayout().major[0]!.label,'-zero');assert.equal(seen.length,3);assert.ok(seen.every(value=>Object.is(value,-0)));
});

test('equal offset updates preserve the existing signed zero without normalizing a first assignment',()=>{
  const a=axis(),s=a.tickStrategy,seen:number[]=[];s.setCursorFormatter((v:number)=>{seen.push(v);return String(v);});
  s.setFormattingOffset(-0);assert.ok(Object.is(s.getFormattingOffset(),-0));a.formatValue(-0);assert.ok(Object.is(seen.at(-1),-0));
  s.setFormattingOffset(0);assert.ok(Object.is(s.getFormattingOffset(),-0));a.formatValue(-0);assert.ok(Object.is(seen.at(-1),-0));
  s.setFormattingOffset(undefined).setFormattingOffset(0).setFormattingOffset(-0);assert.ok(Object.is(s.getFormattingOffset(),0));a.formatValue(-0);assert.ok(Object.is(seen.at(-1),0));
});

test('Polar degree cursor precision stays independent of fitted Cartesian range and preserves explicit overrides',()=>{
  const chart=new Polar({legend:{visible:false}});
  try{
    const radial=chart.getRadialAxis().setUnits('deg');
    for(const interval of[{start:0,end:1},{start:85,end:96},{start:354.4875,end:360.2625}]){
      radial.setInterval(interval);
      for(const[value,expected]of[[40.1256789,'40 deg'],[90.25,'90 deg'],[90.5,'91 deg'],[90.75,'91 deg'],[359.75,'360 deg']]as const)assert.equal(radial.formatCursorValue(value),expected);
    }
    const strategy=radial.tickStrategy;strategy.setCursorFormatter((value:number)=>'angle:'+value.toFixed(3));
    assert.equal(radial.formatCursorValue(90.25),'angle:90.250 deg');
    strategy.setFormattingOffset(1);assert.equal(radial.formatCursorValue(90.25),'angle:91.250 deg');
    strategy.setCursorFormatter(undefined);assert.equal(radial.formatCursorValue(90.25),'91 deg');
    radial.setUnits('deg',{displayInCursor:false});assert.equal(radial.formatCursorValue(90.25),'91');
    assert.equal(axis().formatCursorValue(90.25),'90.25','Cartesian Numeric precision retains its observed range rule');
  }finally{chart.dispose();}
});
