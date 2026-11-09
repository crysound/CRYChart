import test from 'node:test';
import assert from 'node:assert/strict';
import {ChartXY} from '../src/chart.js';
import {ColorHEX,SolidFill,emptyLine} from '../src/core/styles.js';

function scene(){
 const chart=new ChartXY({width:640,height:400}),painted:string[]=[];
 const target:Record<string,unknown>={fill(){painted.push(String(target.fillStyle));}};
 const context=new Proxy(target,{get:(value,key)=>key in value?value[key as string]:()=>{}}) as unknown as CanvasRenderingContext2D;
 (chart as any).underlayContext=context;
 chart.axisX.setInterval({start:0,end:10});chart.axisY.setInterval({start:0,end:10});
 const add=(color:string)=>{const series=chart.addRectangleSeries().setFillStyle(new SolidFill({color:ColorHEX(color)})).setStrokeStyle(emptyLine);series.add({x:1,y:1,width:2,height:2});return series;};
 const draw=()=>{painted.length=0;chart.renderNow();return [...painted];};
 return{chart,add,draw};
}
const css=(color:string)=>ColorHEX(color).toCSS();

test('actual overlapping rectangles paint by numeric draw order with stable insertion ties',()=>{
 const s=scene();try{
  const a=s.add('#ff0000'),b=s.add('#00ff00'),c=s.add('#0000ff');
  const original=s.chart.getSeries();
  a.setDrawOrder({seriesDrawOrderIndex:10});b.setDrawOrder({seriesDrawOrderIndex:-1.5});c.setDrawOrder({seriesDrawOrderIndex:10});
  assert.deepEqual(s.draw(),[css('#00ff00'),css('#ff0000'),css('#0000ff')]);
  a.setDrawOrder({seriesDrawOrderIndex:-2});assert.deepEqual(s.draw(),[css('#ff0000'),css('#00ff00'),css('#0000ff')]);
  assert.deepEqual(s.chart.getSeries(),original);assert.deepEqual(a.getFigures()[0]!.getDimensionsPositionAndSize(),{x:1,y:1,width:2,height:2});
  b.setVisible(false);assert.deepEqual(s.draw(),[css('#ff0000'),css('#0000ff')]);
 }finally{s.chart.dispose();}
});

test('default series counters survive disposal and share the original chart creation sequence',()=>{
 const s=scene();try{
  const a=s.add('#ff0000'),removed=s.add('#00ff00');
  s.chart.addLineSeries();removed.dispose();
  a.setDrawOrder({seriesDrawOrderIndex:2.5});s.add('#0000ff');
  assert.deepEqual(s.draw(),[css('#ff0000'),css('#0000ff')]);
 }finally{s.chart.dispose();}
});

test('invalid draw order is rejected before changing the actual paint sequence',()=>{
 const s=scene();try{
  const a=s.add('#ff0000');s.add('#0000ff');a.setDrawOrder({seriesDrawOrderIndex:10});
  for(const value of [NaN,Infinity,undefined])assert.throws(()=>a.setDrawOrder({seriesDrawOrderIndex:value as number}));
  assert.deepEqual(s.draw(),[css('#0000ff'),css('#ff0000')]);
 }finally{s.chart.dispose();}
});
