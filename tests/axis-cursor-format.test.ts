// 白盒状态/布局检查读取保留的策略对象；公开类型getter由独立四型回归验证。
import test from 'node:test';
import assert from 'node:assert/strict';
import {ChartXY} from '../src/chart';

test('independent Numeric tick and cursor formatters keep precise values without changing major labels',()=>{
  const chart=new ChartXY(),axis=chart.axisX.setInterval({start:0,end:2}).setUnits('s',{displayOnAxis:false,displayInCursor:true}),ticks=axis.tickStrategy;
  ticks.setFormattingFunction((value:number)=>value.toFixed(1)).setCursorFormatter((value:number)=>value.toFixed(6));
  assert.equal(axis.formatValue(.123456),'0.123456');assert.equal(axis.formatCursorValue(.123456),'0.123456 s');assert.ok(axis.ticks().every(t=>/^\d+\.\d$/.test(t.label)));
  // Public undefined restores the range-dependent Numeric default; it does not
  // fall back to the independent major formatter installed above.
  ticks.setCursorFormatter(undefined);assert.equal(axis.formatCursorValue(.123456),'0.12 s');assert.throws(()=>ticks.setCursorFormatter(4),TypeError);assert.equal(axis.formatCursorValue(.123456),'0.12 s');chart.dispose();
});
