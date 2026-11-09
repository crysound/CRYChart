import test from 'node:test';
import assert from 'node:assert/strict';
import {ChartXY,type ChartXYLayoutInfo,type ChartXYLayoutChangedEvent} from '../src/chart.js';

function fixture(){
 const chart=new ChartXY({legend:{visible:false}}).setTitle('');
 chart.getDefaultAxisX().setInterval({start:0,end:10,stopAxisAfter:true});
 chart.getDefaultAxisY().setInterval({start:0,end:1,stopAxisAfter:true});
 const series=chart.addLineSeries().add([{x:0,y:0},{x:10,y:1}]);
 return{chart,series};
}
function assertViewport(chart:ChartXY,layout:ChartXYLayoutInfo){
 const rect=chart.getSeriesScreenRect({axisX:chart.getDefaultAxisX(),axisY:chart.getDefaultAxisY()});
 assert.equal(layout.viewportWidth,rect.width);assert.equal(layout.viewportHeight,rect.height);
 assert.equal(layout.margins.left,rect.left);assert.equal(layout.margins.top,rect.top);
 assert.equal(layout.margins.right,layout.chartWidth-rect.left-rect.width);
 assert.equal(layout.margins.bottom,layout.chartHeight-rect.top-rect.height);
 // Exact field pattern consumed by original calibration getOffsetMarkerPlotBounds.
 const {margins,viewportWidth,viewportHeight}=layout;
 const bounds={left:margins.left??0,right:(margins.left??0)+viewportWidth,bottom:margins.bottom??0,top:(margins.bottom??0)+viewportHeight};
 assert.equal(bounds.right,layout.chartWidth-margins.right);
 assert.equal(bounds.top,layout.chartHeight-margins.top);
}
test('real layoutchange payload supports original calibration viewport bounds and actual axis positions',()=>{
 const{chart,series}=fixture();let event:ChartXYLayoutChangedEvent|undefined;
 try{
  chart.addEventListener('layoutchange',value=>{event=value;});chart.resize(680,420);
  assert.ok(event);assertViewport(chart,event);assert.equal(event.chartWidth,680);assert.equal(event.chartHeight,420);
  assert.equal(typeof event.userChangedLayout,'function');assert.ok(event.axes instanceof Map);
  const x=event.axes.get(series.getAxisX())!,y=event.axes.get(series.getAxisY())!;
  assert.equal(x.width,event.viewportWidth);assert.equal(x.height,0);
  assert.equal(y.height,event.viewportHeight);assert.equal(y.width,0);
  assert.equal(x.left,event.margins.left);assert.equal(y.bottom,event.margins.bottom);
 }finally{chart.dispose();}
});
test('padding/render and resize events plus Promise getLayout remain current independent snapshots',async()=>{
 const{chart}=fixture(),events:ChartXYLayoutChangedEvent[]=[];
 try{
  chart.addEventListener('layoutchange',e=>events.push(e));chart.resize(680,420);
  const first=events.at(-1)!;chart.setPadding({left:37,right:19,top:13,bottom:23});chart.renderNow();
  assert.ok(events.length>=2);assertViewport(chart,events.at(-1)!);
  assert.notEqual(events.at(-1)!.margins.left,first.margins.left);
  const promise=chart.getLayout();assert.ok(promise instanceof Promise);const layout=await promise;assertViewport(chart,layout);
  layout.margins.left=-100;layout.axes.clear();const actual=await chart.getLayout();assertViewport(chart,actual);assert.ok(actual.axes.size>0);
  chart.resize(760,460);assertViewport(chart,events.at(-1)!);assert.equal(events.at(-1)!.chartWidth,760);
 }finally{chart.dispose();}
});
test('stacked axes map uses real physical endpoints and excludes disposed axes',async()=>{
 const chart=new ChartXY({legend:{visible:false}}).setTitle('');
 try{
  const disposed=chart.getDefaultAxisY();disposed.dispose();
  const top=chart.addAxisY({iStack:0}).setInterval({start:0,end:1}),bottom=chart.addAxisY({iStack:-1}).setInterval({start:0,end:1});
  const a=chart.addLineSeries({axisY:top}).add([{x:0,y:0},{x:1,y:1}]),b=chart.addLineSeries({axisY:bottom}).add([{x:0,y:0},{x:1,y:1}]);
  chart.resize(680,420);const layout=await chart.getLayout();assert.equal(layout.axes.has(disposed),false);
  for(const series of[a,b]){const rect=chart.getSeriesScreenRect(series),axis=layout.axes.get(series.getAxisY())!;assert.equal(axis.top,rect.top);assert.equal(axis.height,rect.height);assert.equal(axis.bottom,420-rect.top-rect.height);}
  assert.equal(a.getAxisY(),top);assert.equal(b.getAxisY(),bottom);
 }finally{chart.dispose();}
});
test('userChangedLayout really applies a host size change inside the layout callback without recursive notification',async()=>{
 const{chart}=fixture();let hostWidth=680,calls=0;
 // Controlled DOM size boundary; real Chart resize/layout paths remain intact.
 Object.assign(chart,{container:{getBoundingClientRect:()=>({width:hostWidth,height:420})}});
 try{
  chart.addEventListener('layoutchange',event=>{calls++;hostWidth=760;chart.setPadding({left:31});event.userChangedLayout();},{once:true});
  chart.resize(680,420);assert.equal(calls,1);
  const layout=await chart.getLayout();assert.equal(layout.chartWidth,760);assertViewport(chart,layout);
  assert.equal(layout.margins.left,chart.getSeriesScreenRect({axisX:chart.getDefaultAxisX(),axisY:chart.getDefaultAxisY()}).left);
 }finally{chart.dispose();}
});
