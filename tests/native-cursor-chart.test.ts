import test from 'node:test';
import assert from 'node:assert/strict';
import {ChartXY,Chart3D,Polar} from '../src/chart';

function canvas(){const labels:string[]=[],ctx=new Proxy({measureText:(text:string)=>({width:String(text).length*7}),fillText:(text:string)=>labels.push(String(text))},{get:(target,key)=>key in target?(target as any)[key]:()=>{},set:(target,key,value)=>{(target as any)[key]=value;return true;}}) as unknown as CanvasRenderingContext2D;return{ctx,labels};}
class Probe extends ChartXY{drawAt(point:{x:number;y:number}|undefined,ctx:CanvasRenderingContext2D){this.pointer=point;this.drawCursor(ctx);}}

test('native line solving keeps original values, ignores NaN gaps, and finds a closer screen point beyond the nearest X',()=>{
  const chart=new ChartXY({legend:{visible:false}});chart.axisX.setInterval({start:0,end:10});chart.axisY.setInterval({start:0,end:100});chart.renderNow();
  const line=chart.addLineSeries().add([{x:0,y:1.0000000000000002},{x:1,y:NaN},{x:5,y:100},{x:6,y:1}]);
  const at=chart.translatePoint({x:5,y:1},chart.coordsAxis,chart.coordsClient),hit=line.solveNearest(at);
  assert.equal(hit.x,6);assert.equal(hit.y,1);assert.equal(hit.axisY,chart.axisY);assert.equal(hit.series,line);
  assert.equal(hit.iSample,3);assert.equal(hit.pointShape,line.getPointShape());assert.equal(line.solveNearest({x:5,y:1}).x,6);
  assert.equal(line.solveNearest(chart.translatePoint({x:0,y:1},chart.coordsAxis,chart.coordsClient)).y,1.0000000000000002);
  assert.deepEqual(chart.translatePoint(hit.cursorPosition.pointMarker,hit.cursorPosition.pointMarkerScale,chart.coordsClient),chart.translatePoint({x:6,y:1},chart.coordsAxis,chart.coordsClient));
  line.setCursorEnabled(false);assert.deepEqual(chart.solveNearest(at),[]);chart.dispose();
});

test('observed progressive X and Y nearest modes preserve their designated plane and series-level NaN samples',()=>{
  const chart=new ChartXY({legend:{visible:false}});chart.axisX.setInterval({start:0,end:10});chart.axisY.setInterval({start:0,end:100});chart.renderNow();
  const line=chart.addLineSeries({schema:{xValues:{storage:Float64Array,pattern:'progressive'},yValues:{storage:Float64Array}}}).setDataMapping({x:'xValues',y:'yValues'}).appendSamples({xValues:[0,1,5,6],yValues:[1,NaN,100,1]});
  for(const mode of ['show-nearest','show-all','show-pointed'] as const){const hit=line.solveNearest({x:5,y:1},mode);assert.equal(hit.x,5);assert.equal(hit.y,100);assert.ok(Number.isNaN(line.solveNearest({x:2,y:1},mode).y));}
  assert.deepEqual(chart.solveNearest(chart.translatePoint({x:2,y:1},chart.coordsAxis,chart.coordsClient)),[]);assert.deepEqual(chart.solveNearest(chart.translatePoint({x:6,y:1},chart.coordsAxis,chart.coordsClient),'show-pointed'),[]);
  line.dispose();const vertical=chart.addLineSeries({schema:{x:{storage:Float64Array},y:{storage:Float64Array,pattern:'progressive'}}}).appendSamples({x:[0,5,6,1],y:[1,25,50,100]});
  assert.equal(vertical.solveNearest({x:5,y:1}).x,0);assert.equal(vertical.solveNearest({x:5,y:100}).x,1);chart.dispose();
});

test('TDF native hits expose NaN holes and zero dB with absolute streaming indexes and cell centers',()=>{
  const chart=new ChartXY({legend:{visible:false}});chart.axisX.setInterval({start:0,end:200});chart.axisY.setInterval({start:0,end:200});chart.renderNow();
  const heat=chart.addHeatmapScrollingGridSeries({resolution:2,scrollDimension:'columns'}).setStep({x:10,y:100});
  heat.invalidateIntensityValues({iSample:0,values:[[NaN,NaN]]});heat.invalidateIntensityValues({iSample:10,values:[[0,-30]]});
  const hitAt=(x:number,y:number)=>heat.solveNearest(chart.translatePoint({x,y},chart.coordsAxis,chart.coordsClient))!;
  const gap=hitAt(95,50),zero=hitAt(105,50);assert.ok(Number.isNaN(gap.intensity));assert.equal(gap.column,9);assert.equal(gap.row,0);assert.equal(gap.x,95);assert.equal(gap.y,50);
  assert.equal(zero.intensity,0);assert.equal(zero.column,10);assert.equal(zero.x,105);assert.equal(zero.axisX,chart.axisX);
  heat.setDataCleaning({maxDataPointCount:2});assert.equal(hitAt(105,150).intensity,-30);
  heat.clear();assert.equal(hitAt(105,50),undefined);chart.dispose();
});

test('OpenTest native override edits actual heatmap row and XY unit rows; undefined hides the table',()=>{
  const chart=new Probe({legend:{visible:false}});chart.axisX.setInterval({start:0,end:3});chart.axisY.setInterval({start:0,end:3});
  const heat=chart.addHeatmapGridSeries({dataOrder: 'rows', columns:2,rows:2}).invalidateIntensityValues([[NaN,0],[-40,-30]]);
  heat.setCursorFormattingOverride((hit,before)=>{before[3][0]='Level';before[3][2].text=Number.isNaN(hit.intensity)?'N/A':`${hit.intensity} dB`;return before;});chart.renderNow();
  const {ctx,labels}=canvas(),at=chart.translatePoint({x:.5,y:.5},chart.coordsAxis,chart.coordsPixel);chart.drawAt(at,ctx);
  assert.equal(chart.getCursor().getResultTable().getContent()[3]![2].text,'N/A');assert.ok(labels.some(text=>text.includes('N/A')));
  heat.setCursorFormattingOverride(()=>undefined);chart.drawAt(at,ctx);assert.deepEqual(chart.getCursor().getResultTable().getContent(),[]);
  // The OpenTest waveform adapter declares monotonic X; that public schema
  // selects the compact one-row series override instead of full XY rows.
  heat.dispose();const line=chart.addLineSeries({schema:{x:{storage:Float64Array,pattern:'progressive'},y:{storage:Float64Array}}}).add([{x:1,y:2}]).setCursorFormattingOverride((hit,before)=>{assert.equal(before.length,1);before[0][2].text=`${hit.y} Pa`;return before;});chart.drawAt(at,ctx);
  assert.equal(chart.getCursor().getResultTable().getContent()[1]![2].text,'2 Pa');assert.equal(line.getSampleCount(),1);chart.dispose();
});

test('Histogram custom cursor receives real figure hits, client location, and an empty event after leaving',()=>{
  const chart=new Probe({legend:{visible:false}}).setCursorMode('show-all');chart.axisX.setInterval({start:0,end:4});chart.axisY.setInterval({start:0,end:4});
  const upper=chart.addRectangleSeries().add({x:1,y:0,width:1,height:3,xValue:1.5,yValue:3});chart.renderNow();
  const events:any[]=[],manual=chart.addCursor().setTickMarkerXVisible(false).setTickMarkerYVisible(false);
  chart.setCustomCursor(info=>{events.push(info);if(info.hit){manual.setVisible(true).setPosition(info.hit.cursorPosition);}else manual.setVisible(false);});
  const at=chart.translatePoint({x:1.5,y:2},chart.coordsAxis,chart.coordsPixel),{ctx}=canvas();chart.drawAt(at,ctx);
  assert.equal(events.length,1);assert.equal(events[0].hit.xValue,1.5);assert.equal(events[0].hit.yValue,3);assert.ok(events[0].hit.figure);assert.equal(events[0].hits.length,1);
  assert.deepEqual(chart.translateCoordinate(events[0].mouseLocation,chart.coordsAxis),{x:1.5,y:2});assert.equal(manual.getVisible(),true);
  chart.drawAt(chart.translatePoint({x:1.5,y:3.8},chart.coordsAxis,chart.coordsPixel),ctx);assert.equal(events.at(-1).hit.xValue,1.5);assert.equal(events.at(-1).hit.y,1.5);assert.equal(manual.getVisible(),true);
  chart.drawAt(undefined,ctx);assert.equal(events.at(-1).hit,undefined);assert.equal(manual.getVisible(),false);
  assert.ok(Number.isFinite(events.at(-1).mouseLocation.clientX));const count=events.length;chart.drawAt(undefined,ctx);assert.equal(events.length,count);chart.dispose();
});

test('Rectangle nearest returns the closest center and complete dimensions outside the figure, while native pointed is coverage-bound',()=>{
  const chart=new Probe({legend:{visible:false}}).setCursorMode('show-nearest');chart.axisX.setInterval({start:0,end:10});chart.axisY.setInterval({start:0,end:100});
  const series=chart.addRectangleSeries().add([{x:1,y:0,width:1,height:20},{x:4,y:0,width:1,height:40}]);chart.renderNow();
  const client=(x:number,y:number)=>chart.translatePoint({x,y},chart.coordsAxis,chart.coordsClient),hit=series.solveNearest(client(1.5,80));
  assert.equal(hit.x,1.5);assert.equal(hit.y,10);assert.deepEqual(hit.positionAndSize,{x:1,y:0,width:1,height:20});assert.equal(hit.x2,2);
  assert.equal(series.solveNearest(client(11,10)).x,4.5);assert.deepEqual(chart.solveNearest(client(1.5,10),'show-pointed'),[]);
  const events:any[]=[],{ctx}=canvas();chart.setCursorMode('show-pointed').setCustomCursor(info=>events.push(info));chart.drawAt(chart.translatePoint({x:1.5,y:80},chart.coordsAxis,chart.coordsPixel),ctx);assert.equal(events.at(-1).hit,undefined);
  chart.drawAt(chart.translatePoint({x:1.5,y:10},chart.coordsAxis,chart.coordsPixel),ctx);assert.equal(events.at(-1).hit.y,10);chart.dispose();
});

test('actual trajectory duck typing accepts row-oriented 2D appends and exposes Z only for 3D charts',()=>{
  const chart=new ChartXY(),space=new Chart3D();assert.equal('axisZ'in chart,false);assert.equal('axisZ'in space,true);assert.equal(space.axisZ,space.getDefaultAxisZ());
  const line=chart.addLineSeries(),trajectory=space.addLineSeries();assert.ok('appendJSON'in line);
  const append=(series:any,points:any[])=>{if('appendJSON'in series)series.appendJSON(points);else{if(!points.every(p=>typeof p.z==='number'))throw new Error('3D trajectory requires z');series.add(points);}};
  append(line,[{x:0,y:2},{x:1,y:3}]);append(trajectory,[{x:0,y:2,z:4},{x:1,y:3,z:5}]);assert.equal(line.getSampleCount(),2);assert.equal(trajectory.getSample(1).z,5);
  chart.dispose();space.dispose();
});

test('chart-native legend owns registration only and respects per-series exclusion and independent disposal',()=>{
  const chart=new ChartXY();const line=chart.addLineSeries().setName('A'),hidden=chart.addPointSeries({legend:null});
  assert.equal(chart.legend.getEntries().length,1);assert.equal(chart.legend.getEntries()[0]!.component,line);
  line.dispose();assert.equal(chart.legend.getEntries().length,0);const heat=chart.addHeatmapGridSeries();assert.equal(chart.legend.getEntries().length,1);
  chart.legend.dispose();assert.equal(heat.disposed,false);assert.equal(hidden.disposed,false);chart.dispose();assert.equal(heat.disposed,true);assert.equal(hidden.disposed,true);
});

test('a throwing legend pointerleave callback cannot retain disposed line data or chart registration',()=>{
  const chart=new ChartXY(),line=chart.addLineSeries().add([{x:0,y:1},{x:1,y:2}]),data=line.getDataSet(),{ctx}=canvas();
  chart.legend.setEntryOptions(line,{events:{pointerleave:()=>{throw new Error('consumer hover cleanup');}}});
  const area={left:0,top:0,width:800,height:500},entry=chart.legend.getLayout(ctx,area).entries[0]!.bounds;
  chart.legend.handlePointer('pointermove',{x:entry.left+2,y:entry.top+2});
  assert.throws(()=>line.dispose(),AggregateError);assert.equal(line.isDisposed(),true);assert.equal(data.getSampleCount(),0);
  assert.deepEqual(chart.getSeries(),[]);assert.deepEqual(chart.legend.getEntries(),[]);chart.dispose();
});

test('recreating manual cursors releases chart UI references and chart disposal visits all remaining cursors',()=>{
  const chart=new ChartXY();for(let i=0;i<100;i++){const cursor=chart.addCursor();assert.equal(chart.ui.length,1);cursor.dispose();assert.equal(chart.ui.length,0);}
  const cursors=Array.from({length:5},()=>chart.addCursor());chart.dispose();assert.equal(chart.ui.length,0);assert.ok(cursors.every(cursor=>cursor.disposed&&cursor.getResultTable().disposed));
});

test('Polar custom cursor emits one finite empty hit on moving to axis margins and disables without leaving a stale manual cursor',()=>{
  class PolarProbe extends Polar{drawAt(point:{x:number;y:number}|undefined,ctx:CanvasRenderingContext2D){this.pointer=point;this.drawCursor(ctx);}}
  const chart=new PolarProbe();chart.getAmplitudeAxis().setInterval({start:-40,end:0});chart.addLineSeries().setData([{angle:90,amplitude:-20}]);chart.renderNow();
  const events:any[]=[],{ctx}=canvas();chart.setCustomCursor(event=>events.push(event));const inside=chart.projectPolarPoint({angle:90,amplitude:-20});chart.drawAt(inside,ctx);assert.ok(events.at(-1).hit);
  chart.drawAt({x:0,y:0},ctx);assert.equal(events.at(-1).hit,undefined);assert.ok(Number.isFinite(events.at(-1).mouseLocation.clientX));const count=events.length;chart.drawAt(undefined,ctx);assert.equal(events.length,count);
  chart.drawAt(inside,ctx);chart.setCursorMode(undefined);chart.drawAt(inside,ctx);assert.equal(events.at(-1).hit,undefined);chart.dispose();
});

test('Polar hit scales are opaque and translate back to the actual displayed coordinate after negative-amplitude offset',()=>{
  const chart=new Polar({legend:{visible:false}});chart.getRadialAxis().setNorth(0).setClockwise(true);chart.getAmplitudeAxis().setInterval({start:-40,end:0});chart.renderNow();
  const series=chart.addPointSeries().setPointSize(14).setData([{angle:90,amplitude:-20}]);const client=chart.translateCoordinate({angle:90,amplitude:-20},chart.coordsClient),hit=series.solveNearest(client)!;
  assert.ok(Math.abs(hit.cursorPosition.pointMarker.x-20)<1e-12);assert.ok(Math.abs(hit.cursorPosition.pointMarker.y)<1e-12);assert.notEqual(hit.cursorPosition.pointMarkerScale,chart.coordsPixel);
  assert.equal(hit.cursorPosition.pointMarkerScale,hit.cursorPosition.resultTableScale);assert.deepEqual(chart.translatePoint(hit.cursorPosition.pointMarker,hit.cursorPosition.pointMarkerScale,chart.coordsClient),client);
  assert.deepEqual(chart.solveNearest(client,'show-pointed'),[]);assert.equal(series.solveNearest(client,'show-pointed')!.angle,90);chart.dispose();
});
