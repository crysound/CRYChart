import test from 'node:test';
import assert from 'node:assert/strict';
import {Polar,ChartXY} from '../src/chart';
import {ColorRGBA,SolidFill,SolidLine,DashedLine,emptyLine} from '../src/core/styles';

test('Polar native cursor defaults omit guides while XY keeps both crosshair guides',()=>{
  const polar=new Polar(),xy=new ChartXY();
  for(const cursor of [polar.getCursor(),xy.getCursor()])for(const style of [cursor.getGridStrokeXStyle(),cursor.getGridStrokeYStyle()]){
    assert.equal(style.getThickness(),cursor===polar.getCursor()?0:1);
    if(cursor===xy.getCursor())assert.deepEqual((style as DashedLine).getPattern(),[3,3]);
  }
  polar.dispose();xy.dispose();
});

test('Polar explicit guide styles and later emptyLine remain effective',()=>{
  const polar=new Polar(),cursor=polar.getCursor();
  const radial=new SolidLine({thickness:3,fillStyle:new SolidFill({color:ColorRGBA(255,0,0)})});
  const ring=new DashedLine({thickness:2,pattern:[5,2],fillStyle:new SolidFill({color:ColorRGBA(0,255,0)})});
  cursor.setGridStrokeXStyle(radial).setGridStrokeYStyle(ring);
  assert.equal(cursor.getGridStrokeXStyle(),radial);assert.equal(cursor.getGridStrokeYStyle(),ring);
  cursor.setGridStrokeYStyle(style=>(style as DashedLine).setThickness(4));assert.equal(cursor.getGridStrokeYStyle().getThickness(),4);
  cursor.setGridStrokeXStyle(emptyLine).setGridStrokeYStyle(emptyLine);
  assert.equal(cursor.getGridStrokeXStyle().getThickness(),0);assert.equal(cursor.getGridStrokeYStyle().getThickness(),0);polar.dispose();
});

test('Polar hover draws no default guide strokes but retains marker and formatted result rows',()=>{
  class Probe extends Polar{paint(point:{x:number;y:number},ctx:CanvasRenderingContext2D){this.pointer=point;this.drawCursor(ctx);}}
  const polar=new Probe();polar.resize(700,620);polar.getRadialAxis().setNorth(0).setClockwise(true).setUnits('deg',{displayOnAxis:false});
  polar.getAmplitudeAxis().setInterval({start:-40,end:0}).setUnits('dB',{displayOnAxis:false});
  const points=[{angle:40,amplitude:-15.875},{angle:230,amplitude:-27.125}],series=polar.addPointLineSeries().setName('Directivity').setData(points);
  series.setCursorFormattingOverride((hit,rows)=>{for(const row of rows)if(row[0]==='Amplitude')row[2].text=hit.amplitude.toFixed(3)+' dB';return rows;});
  polar.renderNow();
  const strokes:any[]=[],fills:any[]=[],labels:string[]=[],path:any[]=[];
  const context=new Proxy({measureText:(text:string)=>({width:text.length*7}),beginPath:()=>{path.length=0;},arc:(...args:any[])=>path.push(['arc',...args]),moveTo:(...args:any[])=>path.push(['moveTo',...args]),lineTo:(...args:any[])=>path.push(['lineTo',...args]),stroke:()=>strokes.push([...path]),fill:()=>fills.push([...path]),fillText:(text:string)=>labels.push(text)},{get:(target,key)=>key in target?(target as any)[key]:()=>{},set:(target,key,value)=>{(target as any)[key]=value;return true;}}) as unknown as CanvasRenderingContext2D;
  const pixel=polar.projectPolarPoint(points[0]!);polar.paint(pixel,context);
  assert.equal(strokes.length,0);assert.ok(fills.some(path=>path.some((item:any[])=>item[0]==='arc')));
  assert.ok(labels.some(text=>text.includes('-15.875 dB')));assert.ok(labels.some(text=>text.includes('40 deg')));assert.deepEqual(series.getData(),points);
  polar.getCursor().setGridStrokeXStyle(new SolidLine()).setGridStrokeYStyle(new SolidLine());polar.paint(pixel,context);
  assert.equal(strokes.length,2);assert.ok(strokes.some(path=>path.some((item:any[])=>item[0]==='arc')));assert.ok(strokes.some(path=>path.some((item:any[])=>item[0]==='lineTo')));
  series.setData([]);polar.paint(pixel,context);assert.equal(polar.getCursor().getResultTable().getContent().length,0);polar.dispose();
});
