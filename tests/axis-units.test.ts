// 白盒状态/布局检查读取保留的策略对象；公开类型getter由独立四型回归验证。
import test from 'node:test';
import assert from 'node:assert/strict';
import {ChartXY,Polar,AutoCursorModes} from '../src/chart';

test('axis units match observed 8.2 independent display flags and reset omitted options',()=>{
  const chart=new ChartXY(),axis=chart.getDefaultAxisY().setInterval({start:0,end:1}).setTitle('Voltage');assert.equal(axis.getUnits(),undefined);
  // Public Numeric formatting and cursor callback precedence were verified in
  // numeric-formatting/2026-11-03T15-19-10-878Z; units do not trim its decimals.
  axis.setUnits('V');assert.equal(axis.getTitle(),'Voltage');assert.equal(axis.getDisplayTitle(),'Voltage (V)');assert.equal(axis.formatValue(.5),'0.50');assert.equal(axis.formatCursorValue(.5),'0.50 V');
  axis.setUnits('V',{displayInCursor:true,displayOnAxis:false});assert.equal(axis.getDisplayTitle(),'Voltage');assert.equal(axis.formatCursorValue(.5),'0.50 V');
  axis.setUnits('V',{displayInCursor:false,displayOnAxis:true});assert.equal(axis.getDisplayTitle(),'Voltage (V)');assert.equal(axis.formatCursorValue(.5),'0.50');
  axis.setUnits('mV');assert.equal(axis.getDisplayTitle(),'Voltage (mV)');assert.equal(axis.formatCursorValue(.5),'0.50 mV');
  axis.tickStrategy.setCursorFormatter((value:number)=>`custom:${value}`);assert.equal(axis.formatValue(.5),'custom:0.5');assert.equal(axis.formatCursorValue(.5),'custom:0.5 mV');
  axis.setUnits('');assert.equal(axis.getUnits(),'');assert.equal(axis.getDisplayTitle(),'Voltage');axis.setUnits(undefined);assert.equal(axis.getUnits(),undefined);chart.dispose();
});

test('legacy cursor displays series-axis units even when the original default Y axis is disposed',()=>{
  class Probe extends ChartXY{cursorAt(x:number,y:number,ctx:CanvasRenderingContext2D){this.pointer={x,y};this.drawCursor(ctx);return this.getAutoCursor().getResultTable().getContent();}}
  const chart=new Probe();chart.setAutoCursorMode(AutoCursorModes.snapToClosest);chart.getDefaultAxisY().dispose();chart.getDefaultAxisX().setInterval({start:0,end:2});
  chart.addAxisY({iStack:0}).setInterval({start:-1,end:1});const lower=chart.addAxisY({iStack:-1}).setInterval({start:-20,end:20}).setUnits('Pa',{displayOnAxis:false});
  const line=chart.addLineSeries({axisY:lower}).setName('Pressure').add([{x:0,y:3},{x:1,y:4},{x:2,y:5}]);chart.renderNow();
  const labels:string[]=[],ctx=new Proxy({measureText:(s:string)=>({width:s.length*7}),fillText:(s:string)=>labels.push(s)},{get:(target,key)=>key in target?(target as any)[key]:()=>{},set:(target,key,value)=>{(target as any)[key]=value;return true;}}) as unknown as CanvasRenderingContext2D;
  const pixel=chart.translatePoint({x:1,y:0},{x:line.axisX,y:lower},chart.coordsPixel),rows=chart.cursorAt(pixel.x!,pixel.y!,ctx);
  assert.deepEqual(rows,[['X','1.00'],['Pressure','4.0 Pa']]);assert.ok(labels.includes('0.0'));assert.ok(!labels.includes('0.0 Pa'));assert.ok(labels.includes('Pressure    4.0 Pa'));chart.dispose();
});

test('polar units follow observed 8.2 behavior: axis title only, independently of cursor units',()=>{
  class Probe extends Polar{paintAxes(ctx:CanvasRenderingContext2D){this.renderNow();this.drawAxes(ctx);}}
  const chart=new Probe(),axis=chart.getDefaultAxisY().setInterval({start:-40,end:0}).setTitle('Level');
  const labels:string[]=[],ctx=new Proxy({fillText:(s:string)=>labels.push(s)},{get:(target,key)=>key in target?(target as any)[key]:()=>{},set:(target,key,value)=>{(target as any)[key]=value;return true;}}) as unknown as CanvasRenderingContext2D;
  axis.setUnits('dB',{displayOnAxis:false,displayInCursor:true});chart.paintAxes(ctx);
  assert.ok(labels.includes('-10.0'));assert.ok(labels.includes('0.0'));assert.ok(labels.every(label=>!label.includes('dB')));assert.equal(axis.formatCursorValue(-10),'-10.0 dB');
  labels.length=0;axis.setUnits('dB',{displayOnAxis:true,displayInCursor:false});chart.paintAxes(ctx);
  assert.ok(labels.includes('-10.0'));assert.ok(labels.includes('0.0'));assert.ok(!labels.includes('-10.0 dB'));assert.ok(labels.includes('Level (dB)'));assert.equal(axis.formatCursorValue(-10),'-10.0');
  labels.length=0;axis.setUnits(undefined);chart.paintAxes(ctx);assert.ok(labels.every(label=>!label.includes('dB')));chart.dispose();
});
