import test from 'node:test';
import assert from 'node:assert/strict';
import {cryChart,DataSetXY} from '../src/index';

test('a long-lived chart context releases disposed charts and keeps shared sample data usable',()=>{
 const engine=cryChart(),data=new DataSetXY({schema:{x:{storage:Float64Array},y:{storage:Float64Array}}});data.appendSamples({x:[0,1,2],y:[3,4,5]});
 const survivor=engine.ChartXY({headless:true}),line=survivor.addLineSeries({dataSet:data});let staleDisposals=0;
 for(let cycle=0;cycle<256;cycle++){const chart=engine.ChartXY({headless:true});chart.addLineSeries({dataSet:data});assert.equal(engine.getChartCount(),2);chart.dispose();chart.dispose=()=>{staleDisposals++;return chart;};assert.equal(engine.getChartCount(),1);}
 assert.equal(line.getSampleCount(),3);data.appendSamples({x:[3],y:[6]});assert.equal(line.getSample(3).y,6);engine.dispose();assert.equal(staleDisposals,0);assert.equal(engine.getChartCount(),0);assert.equal(data.getSampleCount(),4);
});
test('one throwing disposal callback does not prevent releasing the remaining charts',()=>{
 const engine=cryChart(),first=engine.ChartXY({headless:true}),second=engine.ChartXY({headless:true}),pie=engine.Pie({headless:true});let disposed=0;
 first.onDispose(()=>{throw new Error('consumer callback');});second.onDispose(()=>disposed++);pie.onDispose(()=>disposed++);
 assert.throws(()=>engine.dispose(),AggregateError);assert.equal(disposed,2);assert.equal(engine.getChartCount(),0);assert.equal(second.isDisposed(),true);assert.equal(pie.isDisposed(),true);assert.equal(first.events.listenerCount(),0);assert.throws(()=>engine.ChartXY(),/disposed/);engine.dispose();
});

test('internally created data stays alive across shared series and is released after its last binding',()=>{
 const engine=cryChart(),first=engine.ChartXY(),second=engine.ChartXY(),line=first.addLineSeries(),data=line.getDataSet();line.addArraysXY(new Float64Array(100_000),new Float64Array(100_000));
 second.addLineSeries({dataSet:data});first.dispose();assert.equal(data.isDisposed(),false);assert.equal(data.getSampleCount(),100_000);
 second.dispose();assert.equal(data.isDisposed(),true);assert.equal(data.getStorageStats().denseTypedArrayBytes,0);assert.equal(data.getStorageStats().snapshotBytes,0);engine.dispose();
});

test('rebinding releases an unshared internal source but never disposes an external dataset',()=>{
 const engine=cryChart(),chart=engine.ChartXY(),line=chart.addLineSeries(),internal=line.getDataSet(),external=new DataSetXY().appendSamples({x:[1],y:[2]});
 line.setDataSet(internal);assert.equal(internal.isDisposed(),false);line.setDataSet(external);assert.equal(internal.isDisposed(),true);chart.dispose();assert.equal(external.isDisposed(),false);external.appendSamples({x:[2],y:[3]});assert.equal(external.getSampleCount(),2);external.dispose();engine.dispose();
});

test('a failing data-disposal callback cannot strand other chart data or rectangle allocations',()=>{
 const engine=cryChart(),chart=engine.ChartXY(),first=chart.addLineSeries(),second=chart.addLineSeries(),rectangles=chart.addRectangleSeries();first.add({x:0,y:1});second.add({x:0,y:2});rectangles.add({x:0,y:0,width:1,height:1});
 first.getDataSet().onChange(()=>{if(first.getDataSet().isDisposed())throw new Error('consumer data cleanup');});assert.throws(()=>chart.dispose(),AggregateError);
 assert.equal(second.getDataSet().isDisposed(),true);assert.equal(rectangles.isDisposed(),true);assert.equal(rectangles.rows.values.byteLength,0);assert.equal(rectangles.rows.flags.byteLength,0);assert.equal(chart.events.listenerCount(),0);assert.equal(engine.getChartCount(),0);engine.dispose();
});
