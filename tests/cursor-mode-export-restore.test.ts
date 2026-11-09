import test from 'node:test';
import assert from 'node:assert/strict';
import {ChartXY,AutoCursorModes} from '../src/chart.js';

class Probe extends ChartXY {
  drawCursorNow(context:CanvasRenderingContext2D){this.drawCursor(context);}
}
const context=new Proxy({},{get:()=>()=>{}}) as CanvasRenderingContext2D;
test('original BaseChart export order hides then restores a positioned default cursor without a new pointer event',()=>{
 const chart=new Probe();
 try{
  chart.setCursorMode('show-nearest');
  const cursor=chart.getCursor().setVisible(true).setResultTableVisible(true).setPosition({pointMarker:{x:2,y:3},pointMarkerScale:chart.coordsAxis});
  const originalPositions=cursor.getPositions(),snapshot={mode:chart.getCursorMode(),visible:cursor.getVisible(),resultVisible:cursor.getResultTableVisible()};
  assert.equal(snapshot.visible,true);
  // Unmodified BaseChartV2.prepareForImageExport/restoreAfterImageExport order.
  chart.setCursorMode(undefined);cursor.setVisible(false);cursor.setResultTableVisible(false);
  chart.drawCursorNow(context);assert.equal(cursor.getVisible(),false);
  cursor.setResultTableVisible(snapshot.resultVisible);cursor.setVisible(snapshot.visible);chart.setCursorMode(snapshot.mode);
  assert.equal(chart.getCursorMode(),'show-nearest');assert.equal(cursor.getVisible(),true);
  assert.equal(cursor.getResultTableVisible(),true);assert.deepEqual(cursor.getPositions(),originalPositions);
 }finally{chart.dispose();}
});
test('native mode transitions do not invent positions or override explicitly hidden cursor visibility',()=>{
 const chart=new Probe();
 try{
  const cursor=chart.getCursor();chart.setCursorMode(undefined);chart.drawCursorNow(context);chart.setCursorMode('show-nearest');assert.equal(cursor.getVisible(),false);
  cursor.setPosition({pointMarker:{x:2,y:3}}).setVisible(false);
  chart.setCursorMode(undefined);chart.drawCursorNow(context);chart.setCursorMode('show-all');assert.equal(cursor.getVisible(),false);
  cursor.clearPosition().setVisible(true);chart.setCursorMode(undefined);chart.setCursorMode('show-nearest');assert.equal(cursor.getVisible(),false);
 }finally{chart.dispose();}
});
test('legacy auto cursor disable keeps its existing explicit position-reset behavior',()=>{
 const chart=new Probe();
 try{
  const cursor=chart.getCursor().setPosition({pointMarker:{x:2,y:3}});assert.equal(cursor.getVisible(),true);
  chart.setAutoCursorMode(AutoCursorModes.disabled);assert.equal(cursor.getVisible(),false);
 }finally{chart.dispose();}
});
