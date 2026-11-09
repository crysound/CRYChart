import test from 'node:test';
import assert from 'node:assert/strict';
import {ChartXY} from '../src/chart.js';

const source = () => ({width:13,height:13,getContext:()=>null}) as unknown as HTMLCanvasElement;

test('actual engine owns immutable custom icon dimensions and derived icon lifetimes',()=>{
  const chart=new ChartXY();
  try {
    assert.equal(typeof chart.engine.addCustomIcon,'function');
    const icon=chart.engine.addCustomIcon(source(),{width:26});
    assert.equal(icon.type,'icon');assert.equal(icon.getWidth(),26);assert.equal(icon.getHeight(),undefined);
    const resized=icon.setSize(10,20);
    assert.notEqual(resized,icon);assert.equal(icon.getWidth(),26);assert.equal(resized.getWidth(),10);assert.equal(resized.getHeight(),20);
    icon.dispose();icon.dispose();assert.equal(icon.isDisposed(),true);assert.equal(resized.isDisposed(),false);
    chart.dispose();assert.equal(resized.isDisposed(),true);
    assert.throws(()=>chart.engine.addCustomIcon(source()),/disposed/i);
  } finally {chart.dispose();}
});

test('custom icon enters the actual point packet without replacing source data or numeric point shapes',()=>{
  const chart=new ChartXY();
  try {
    const icon=chart.engine.addCustomIcon(source(),{width:13,height:13});
    const series=chart.addPointSeries().setPointShape(icon).setPointSize(13).add([{x:1,y:2},{x:3,y:4}]);
    assert.equal(series.getPointShape(),icon);assert.equal(series.drawPacket('points').pointIcon,icon);
    assert.deepEqual(series.getDataSet().readBack().data.xValues,new Float64Array([1,3]));
    series.setPointShape(5);assert.equal(series.drawPacket('points').pointIcon,undefined);assert.equal(series.drawPacket('points').pointShape,5);
    assert.throws(()=>chart.engine.addCustomIcon(source(),{width:0}),/positive/i);
    assert.throws(()=>chart.engine.addCustomIcon(source(),{height:Number.NaN}),/positive/i);
  } finally {chart.dispose();}
});
