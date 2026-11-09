import test from 'node:test';
import assert from 'node:assert/strict';
import{ChartXY}from'../src/chart';
const close=(a:number,b:number)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
test('public XY relative coordinates are control-bottom-left pixels rather than plot percentages',()=>{
 const chart=new ChartXY();try{
  chart.resize(800,500);chart.renderNow();Object.assign(chart,{overlay:{getBoundingClientRect:()=>({left:37,top:91})}});
  assert.deepEqual(chart.translateCoordinate({x:0,y:0},chart.coordsRelative,chart.coordsClient),{clientX:37,clientY:591});
  assert.deepEqual(chart.translateCoordinate({x:800,y:500},chart.coordsRelative,chart.coordsClient),{clientX:837,clientY:91});
  assert.deepEqual(chart.translateCoordinate({clientX:137,clientY:241},chart.coordsRelative),{x:100,y:350});
  assert.deepEqual(chart.translateCoordinate({x:24,y:80},chart.coordsRelative,chart.coordsPixel),{x:24,y:420});
 }finally{chart.dispose();}
});
test('control-relative label anchors use public plot margins and retain pixel placement after padding/resize',async()=>{
 const chart=new ChartXY();try{
  for(const size of[{width:800,height:500},{width:942,height:760}]){
   chart.resize(size.width,size.height).setPadding({left:19,right:23,bottom:31,top:13});chart.renderNow();
   const layout=await chart.getLayout();
   const anchor={x:layout.margins.left+17,y:layout.margins.bottom+29};
   const pixel=chart.translateCoordinate(anchor,chart.coordsRelative,chart.coordsPixel);
   close(pixel.x,chart.plot.left+17);close(pixel.y,chart.plot.top+chart.plot.height-29);
   assert.deepEqual(chart.translateCoordinate(pixel,chart.coordsPixel,chart.coordsRelative),anchor);
  }
 }finally{chart.dispose();}
});
test('legacy default Legend uses its independent plot-percentage projection while explicit public UI uses pixels',()=>{
 const chart=new ChartXY();try{
  const context=new Proxy({measureText:(text:string)=>({width:text.length*7})},{get:(target,key)=>key in target?(target as any)[key]:()=>{},set:(target,key,value)=>{(target as any)[key]=value;return true;}})as unknown as CanvasRenderingContext2D;
  Object.assign(chart,{overlayContext:context});
  const legend=chart.addLegendBox(),label=chart.addUIElement('TextBox',chart.coordsRelative).setPosition({x:20,y:30});
  let legendPixel:any,labelPixel:any;
  legend.draw=(_ctx,_rect,project)=>{legendPixel=project!(legend.getPosition());};
  label.draw=(_ctx,_rect,project)=>{labelPixel=project!(label.getPosition(),label.coordinates);};
  chart.renderNow();assert.deepEqual(legendPixel,{x:chart.plot.left+chart.plot.width,y:chart.plot.top});assert.deepEqual(labelPixel,{x:20,y:chart.height-30});
 }finally{chart.dispose();}
});
