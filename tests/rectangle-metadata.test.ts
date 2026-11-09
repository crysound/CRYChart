import test from 'node:test';
import assert from 'node:assert/strict';
import {ChartXY} from '../src/chart';

test('histogram rectangle getter and public hit retain submitted values while geometry updates and clear remain authoritative',()=>{
 const chart=new ChartXY();
 try{
  chart.getDefaultAxisX().setInterval({start:0,end:40});
  chart.getDefaultAxisY().setInterval({start:-20,end:30});
  const series=chart.addRectangleSeries(),input={x1:7.5,x2:15,y1:0,y2:20,xValue:10,yValue:20};
  const figure=series.add(input);
  assert.deepEqual(figure.getDimensionsTwoPoints(),input,'Actual original Histogram passes its xValue/yValue in the rectangle add call');
  assert.deepEqual(series.getFigures()[0].getDimensionsTwoPoints(),input,'A new public figure handle reads retained series output');
  (figure.getDimensionsTwoPoints() as any).xValue=999;
  assert.equal((figure.getDimensionsTwoPoints() as any).xValue,10,'Public result mutations do not overwrite retained metadata');
  figure.setDimensions({x1:8,x2:16,y1:-1,y2:19});
  assert.deepEqual(figure.getDimensionsTwoPoints(),{x1:8,x2:16,y1:-1,y2:19,xValue:10,yValue:20},'Current packed coordinates override stale original coordinates in retained metadata');
  chart.renderNow();
  const client=chart.translateCoordinate({x:12,y:9},chart.coordsAxis,chart.coordsClient),hit=series.solveNearest(client);
  assert.equal(hit.xValue,10);assert.equal(hit.yValue,20);
  assert.deepEqual(hit.figure.getDimensionsTwoPoints(),figure.getDimensionsTwoPoints(),'A real public hit and getter agree on the source rectangle identity and values');
  series.clear();
  assert.deepEqual(series.getFigures(),[]);
  const replacement=series.add({x1:1,x2:2,y1:3,y2:4});
  assert.deepEqual(replacement.getDimensionsTwoPoints(),{x1:1,x2:2,y1:3,y2:4},'Cleared metadata does not leak into a reused packed slot');
 }finally{chart.dispose();}
});
