import test from 'node:test';
import assert from 'node:assert/strict';
import {Polar} from '../src/chart';
import {PolarPointLineSeries} from '../src/polar-series';

test('Polar setData replaces atomically on the same dataset and preserves source precision, order and style',()=>{
  const chart=new Polar(),series=chart.addPointLineSeries().setName('Directivity').setPointSize(4),data=series.getDataSet(),style=series.getStrokeStyle();
  assert.ok(series instanceof PolarPointLineSeries);
  const original=[{angle:0,amplitude:-1.0000000000000002},{angle:90,amplitude:-12},{angle:360,amplitude:-1.0000000000000002}];
  assert.equal(series.setData(original),series);assert.equal(series.getDataSet(),data);assert.deepEqual(series.getData(),original);
  const revision=data.revision,epoch=data.getContentEpoch();let events=0;data.onChange(()=>events++);
  assert.throws(()=>series.setData([{angle:45,get amplitude():number{throw new Error('bad accessor');}}]),/bad accessor/);
  assert.deepEqual(series.getData(),original);assert.equal(data.revision,revision);assert.equal(events,0);
  series.setData([{angle:180,amplitude:-0}]);assert.equal(events,1);assert.equal(data.getContentEpoch(),epoch+1);assert.ok(Object.is(series.getData()[0]!.amplitude,-0));
  assert.equal(series.getName(),'Directivity');assert.equal(series.getStrokeStyle(),style);assert.equal(series.getPointSize(),4);
  series.setData([]);assert.equal(series.getSampleCount(),0);assert.equal(series.getNextSampleIndex(),0);assert.equal(events,2);chart.dispose();
});

test('Polar public coordinate overloads use degree/amplitude and control-relative bottom-left pixels',()=>{
  const chart=new Polar();chart.resize(800,650);chart.getRadialAxis().setNorth(0).setClockwise(true);chart.getAmplitudeAxis().setInterval({start:-40,end:0});
  for(const angle of [0,90,180,270,-30,390]){
    const point={angle,amplitude:-10},client=chart.translateCoordinate(point,chart.coordsClient),back=chart.translateCoordinate(client,chart.coordsAxis),relative=chart.translateCoordinate(point,chart.coordsRelative);
    assert.ok(Number.isFinite(client.clientX)&&Number.isFinite(client.clientY));assert.ok(Math.abs(back.angle-((angle%360)+360)%360)<1e-10);assert.ok(Math.abs(back.amplitude+10)<1e-10);
    const fromRelative=chart.translateCoordinate(relative,chart.coordsRelative,chart.coordsClient);
    assert.ok(Math.abs(fromRelative.clientX-client.clientX)<1e-10&&Math.abs(fromRelative.clientY-client.clientY)<1e-10);
  }
  assert.deepEqual(chart.translateCoordinate({x:0,y:0},chart.coordsRelative,chart.coordsClient),{clientX:0,clientY:650});
  assert.deepEqual(chart.translateCoordinate({x:800,y:650},chart.coordsRelative,chart.coordsClient),{clientX:800,clientY:0});
  const center=chart.translateCoordinate({angle:0,amplitude:-40},chart.coordsClient);assert.deepEqual(chart.translateCoordinate(center,chart.coordsAxis),{angle:0,amplitude:-40});
  chart.dispose();
});

test('Polar nearest hits retain negative amplitude and the OpenTest series cursor override formats native rows',()=>{
  class Probe extends Polar{cursorAt(point:{x:number;y:number},context:CanvasRenderingContext2D){this.pointer=point;this.drawCursor(context);return this.getCursor().getResultTable().getContent();}}
  const chart=new Probe();chart.getRadialAxis().setNorth(0).setClockwise(true).setUnits('deg',{displayOnAxis:false});chart.getAmplitudeAxis().setInterval({start:-40,end:0}).setUnits('dB',{displayOnAxis:false});chart.setCursorMode('show-nearest');
  const series=chart.addPointLineSeries().setName('A').setData([{angle:0,amplitude:-5},{angle:90,amplitude:-20},{angle:180,amplitude:-30},{angle:360,amplitude:-5}]);
  const second=chart.addLineSeries().setName('B').setData([{angle:90,amplitude:-10}]);chart.renderNow();
  const client=chart.translateCoordinate({angle:90,amplitude:-20},chart.coordsClient),hit=chart.solveNearest(client)[0]!;
  assert.equal(hit.series,series);assert.equal(hit.angle,90);assert.equal(hit.amplitude,-20);assert.equal(chart.solveNearest(client,'show-all').length,2);
  assert.ok(chart.solveNearest({clientX:5000,clientY:5000}).length===1);second.setVisible(false);assert.equal(chart.solveNearest(client,'show-all').length,1);
  series.setCursorFormattingOverride((actual,before)=>{assert.equal(actual.series,series);for(const row of before)if(row[0]==='Amplitude')row[2].text=`${actual.amplitude.toFixed(1)} dB`;return before;});
  const labels:string[]=[],ctx=new Proxy({measureText:(text:string)=>({width:text.length*7}),fillText:(text:string)=>labels.push(text)},{get:(target,key)=>key in target?(target as any)[key]:()=>{},set:(target,key,value)=>{(target as any)[key]=value;return true;}}) as unknown as CanvasRenderingContext2D;
  const rows=chart.cursorAt(chart.translatePoint(client,chart.coordsClient,chart.coordsPixel),ctx);
  assert.equal(rows.find(row=>row[0]==='Amplitude')![2].text,'-20.0 dB');assert.ok(labels.some(label=>label.includes('-20.0 dB')));assert.ok(labels.some(label=>label.includes('90 deg')));
  chart.setCursorMode(undefined);assert.equal(chart.getCursorMode(),undefined);assert.equal(chart.getCursor().positioned,false);chart.dispose();
});

test('Polar amplitude tick placement stays physically right when north and clockwise change',()=>{
  class Probe extends Polar{axes(ctx:CanvasRenderingContext2D){this.drawAxes(ctx);}}
  const chart=new Probe();chart.getAmplitudeAxis().setInterval({start:-40,end:0});chart.renderNow();
  const labels:{text:string;x:number;y:number}[]=[],ctx=new Proxy({fillText:(text:string,x:number,y:number)=>labels.push({text,x,y})},{get:(target,key)=>key in target?(target as any)[key]:()=>{},set:(target,key,value)=>{(target as any)[key]=value;return true;}}) as unknown as CanvasRenderingContext2D;
  // The public Numeric formatter uses one decimal over this 40-unit interval.
  // This test still checks the actual drawn label and its unchanged position.
  chart.axes(ctx);const before=labels.find(label=>label.text==='-10.0');assert.ok(before,'Amplitude -10.0 must be drawn');
  labels.length=0;chart.getRadialAxis().setNorth(0).setClockwise(true);chart.axes(ctx);
  const after=labels.find(label=>label.text==='-10.0');assert.ok(after,'Amplitude -10.0 must remain drawn after changing direction');
  assert.deepEqual(after,before);assert.ok(before.x>chart.plot.left+chart.plot.width/2);chart.dispose();
});
