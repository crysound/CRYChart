import test from 'node:test';
import assert from 'node:assert/strict';
import {ChartXY} from '../src/chart';
import {AxisTickStrategies} from '../src/index';
import {ColorRGBA,SolidFill,SolidLine} from '../src/core/styles';

function canvas(){const labels:string[]=[],ctx=new Proxy({measureText:(value:string)=>({width:String(value).length*7}),fillText:(value:string)=>labels.push(String(value))},{get:(target,key)=>key in target?(target as any)[key]:()=>{},set:(target,key,value)=>{(target as any)[key]=value;return true;}}) as unknown as CanvasRenderingContext2D;return{ctx,labels};}
class Probe extends ChartXY{drawAt(point:{x:number;y:number}|undefined,ctx:CanvasRenderingContext2D){this.pointer=point;this.drawCursor(ctx);}}
function setup(){
  const chart=new Probe({legend:{visible:false}}).setCursorMode('show-all'),x=chart.axisX.setTitle('Time').setUnits('ms').setInterval({start:0,end:10}),pressure=chart.axisY.setTitle('Pressure').setUnits('Pa').setInterval({start:0,end:1000}),voltage=chart.addAxisY({opposite:true}).setTitle('Voltage').setUnits('mV').setInterval({start:0,end:1});
  const series=[pressure,voltage].map((axis,index)=>chart.addLineSeries({axisY:axis,schema:{xValues:{storage:Float64Array,pattern:'progressive'},yValues:{storage:Float64Array}}}).setDataMapping({x:'xValues',y:'yValues'}).setName(index?'Voltage channel':'Pressure channel').setStrokeStyle(new SolidLine({fillStyle:new SolidFill({color:ColorRGBA(index?237:55,index?138:109,index?47:236)})})).appendSamples({xValues:[0,4,8],yValues:index?[.1,.3,.2]:[100,300,200]}));
  chart.renderNow();const drawing=canvas(),at=chart.translatePoint({x:4,y:300},{x,y:pressure},chart.coordsPixel),draw=()=>chart.drawAt(at,drawing.ctx),rows=()=>chart.getCursor().getResultTable().getContent();return{chart,x,pressure,voltage,series,draw,rows,...drawing};
}

test('show-all retains both original samples and formats each value with its own axis and units',()=>{
  const t=setup();t.pressure.setTickStrategy(AxisTickStrategies.Numeric,s=>s.setCursorFormatter((value:number)=>value.toFixed(2)));t.voltage.setTickStrategy(AxisTickStrategies.Numeric,s=>s.setCursorFormatter((value:number)=>value.toFixed(4)));t.draw();
  assert.equal(t.rows().length,3);assert.equal(t.rows()[0]![0].text,'4.0 ms');assert.equal(t.rows()[1]![0].component,t.series[0]);assert.equal(t.rows()[2]![0].component,t.series[1]);assert.equal(t.rows()[1]![2].text,'300.00 Pa');assert.equal(t.rows()[2]![2].text,'0.3000 mV');
  assert.equal(t.rows()[1]![0].componentColor.toCSS(),ColorRGBA(55,109,236).toCSS());assert.equal(t.rows()[2]![0].componentColor.toCSS(),ColorRGBA(237,138,47).toCSS());
  const positions=t.chart.getCursor().getPositions();assert.equal(positions.length,2);assert.equal(positions[0]!.pointMarker.y,300);assert.equal(positions[1]!.pointMarker.y,.3);assert.equal(positions[1]!.pointMarkerScale.y,t.voltage);assert.equal(t.series[1]!.getSample(1)!.y,.3);t.chart.dispose();
});

test('each series receives only its own one-row default exactly once and can edit or suppress independently',()=>{
  const t=setup(),calls:any[]=[];for(let index=0;index<2;index++)t.series[index]!.setCursorFormattingOverride((hit,before)=>{calls.push({index,hit,before:before.map(row=>row.slice())});assert.equal(before.length,1);assert.equal(before[0]![0].component,t.series[index]);before[0]![2]={text:`S${index}:${before[0]![2].text}`,font:{size:index?12:20,weight:index?'normal':'bold'}};return before;});
  t.draw();assert.deepEqual(calls.map(call=>call.index),[0,1]);assert.equal(calls[1].hit.y,.3);assert.equal(t.rows()[1]![2].text,'S0:300 Pa');assert.equal(t.rows()[2]![2].text,'S1:0.30 mV');
  t.series[1]!.setCursorFormattingOverride(()=>undefined);t.draw();assert.equal(t.rows().length,2);assert.equal(t.rows()[1]![0].component,t.series[0]);
  t.series[0]!.setCursorFormattingOverride(()=>undefined);t.draw();assert.deepEqual(t.rows(),[]);
  t.series[0]!.setCursorFormattingOverride(undefined);t.series[1]!.setCursorFormattingOverride(undefined);t.draw();assert.equal(t.rows().length,3);t.chart.dispose();
});

test('explicit chart formatter owns the complete table; restoring the default restores both series',()=>{
  const t=setup();let seriesCalls=0,chartCalls=0;for(const series of t.series)series.setCursorFormattingOverride(()=>{seriesCalls++;return [['wrong replacement']];});
  const content=[['Explicit chart','300 Pa / 0.30 mV']];t.chart.setCursorFormatting((chart,hit,hits)=>{chartCalls++;assert.equal(chart,t.chart);assert.equal(hit.series,t.series[0]);assert.equal(hits.length,2);return content;});t.draw();assert.equal(chartCalls,1);assert.equal(seriesCalls,0);assert.deepEqual(t.rows(),content);
  t.chart.setCursorFormatting(()=>undefined);t.draw();assert.deepEqual(t.rows(),[]);assert.equal(seriesCalls,0);
  t.chart.setCursorFormatting(undefined);for(const series of t.series)series.setCursorFormattingOverride(undefined);t.draw();assert.equal(t.rows().length,3);t.chart.dispose();
});

test('nearest uses the observed X heading plus one component row and invokes its formatter once',()=>{
  const t=setup();let calls=0;t.series[0]!.setCursorFormattingOverride((_hit,before)=>{calls++;assert.equal(before.length,1);return before;});t.chart.setCursorMode('show-nearest');t.draw();assert.equal(calls,1);assert.equal(t.rows().length,2);assert.equal(t.rows()[0]![0].text,'4.0 ms');assert.equal(t.rows()[1]![2].text,'300 Pa');assert.equal(t.chart.getCursor().getPositions().length,1);
  t.chart.setCursorMode('show-all');t.draw();assert.equal(t.rows().length,3);t.chart.setCursorMode('show-nearest');t.draw();assert.equal(t.rows().length,2);t.chart.dispose();
});

test('a shared axis uses the anchor X heading without rewriting a second series source X',()=>{
  const t=setup();t.series[1]!.clear().appendSamples({xValues:[0,4.5,8],yValues:[.1,.3,.2]});let secondX=0;t.series[1]!.setCursorFormattingOverride((hit,before)=>{secondX=hit.x;return before;});t.draw();assert.equal(t.rows()[0]![0].text,'4.0 ms');assert.equal(secondX,4.5);assert.equal(t.chart.getCursor().getPositions()[1]!.pointMarker.x,4.5);assert.equal(t.series[1]!.getSample(1)!.x,4.5);t.chart.dispose();
});

test('different X axes keep separate formatted coordinate values instead of inventing a shared X',()=>{
  const t=setup();t.series[1]!.dispose();const x2=t.chart.addAxisX({opposite:true}).setTitle('Elapsed').setUnits('s').setInterval({start:0,end:1});
  const other=t.chart.addLineSeries({axisX:x2,axisY:t.voltage}).setName('Other timebase').add([{x:.4,y:.3}]);let called=0;other.setCursorFormattingOverride((hit,before)=>{called++;assert.equal(hit.axisX,x2);assert.equal(before[1]![2].text,'0.40 s');return before;});t.chart.renderNow();t.draw();assert.equal(called,1);const text=JSON.stringify(t.rows().map(row=>row.map(cell=>cell?.text??(typeof cell==='string'?cell:''))));assert.match(text,/4\.0 ms/);assert.match(text,/0\.40 s/);assert.match(text,/300 Pa/);assert.match(text,/0\.30 mV/);t.chart.dispose();
});

test('heatmap missing/zero intensity override keeps its coordinate rows; fixed clear resets values to zero and disposal removes hits',()=>{
  const t=setup();for(const series of t.series)series.dispose();t.x.setInterval({start:0,end:2});t.pressure.setInterval({start:0,end:2});
  const heat=t.chart.addHeatmapGridSeries({dataOrder: 'rows', columns:2,rows:2}).invalidateIntensityValues([[NaN,0],[-20,-30]]);let calls=0;heat.setCursorFormattingOverride((hit,before)=>{calls++;assert.equal(before[3]![0],'Value');before[3]![2].text=Number.isNaN(hit.intensity)?'N/A':hit.intensity.toFixed(1)+' dB';return before;});t.chart.setCursorMode('show-nearest');t.chart.renderNow();
  for(const [point,expected] of [[{x:.5,y:.5},'N/A'],[{x:1.5,y:.5},'0.0 dB']] as const){const at=t.chart.translatePoint(point,t.chart.coordsAxis,t.chart.coordsPixel);t.chart.drawAt(at,t.ctx);assert.equal(t.rows()[3]![2].text,expected);}assert.equal(calls,2);
  // A fixed grid retains its cells after clear and reports zero for each one.
  // That differs from disposing the series, which removes cursor targets.
  heat.clear();t.draw();assert.equal(heat.getSampleCount(),4);assert.equal(heat.solveNearest(t.chart.translatePoint({x:.5,y:.5},t.chart.coordsAxis,t.chart.coordsClient))!.intensity,0);assert.equal(t.rows()[3]![2].text,'0.0 dB');
  heat.dispose();t.draw();assert.equal(t.rows().length,0);t.chart.dispose();
});

test('native default table uses compact rows only when every selected X column declares a monotonic pattern',()=>{
  for(const patterns of [[undefined,undefined],['progressive',undefined],[undefined,'progressive'],['regressive','progressive']] as const){
    const chart=new Probe({legend:{visible:false}}).setCursorMode('show-all');
    chart.axisX.setTitle('Time').setInterval({start:0,end:4});chart.axisY.setTitle('Value').setInterval({start:0,end:10});
    for(const axis of [chart.axisX,chart.axisY])axis.setTickStrategy(AxisTickStrategies.Numeric,ticks=>ticks.setCursorFormatter((value:number)=>value.toFixed(2)));
    const rows=()=>chart.getCursor().getResultTable().getContent(),drawing=canvas();
    const series=patterns.map((pattern,index)=>chart.addLineSeries({schema:{stamp:{storage:Float64Array,pattern},sample:{storage:Float64Array}}})
      .setDataMapping({x:'stamp',y:'sample'}).setName(index?'B':'A')
      .appendSamples({stamp:pattern==='regressive'?[4,2,0]:[0,2,4],sample:index?[5.2,5.2,5.2]:[2.2,2.2,2.2]}));
    chart.renderNow();const at=chart.translatePoint({x:2,y:2.2},chart.coordsAxis,chart.coordsPixel);
    chart.drawAt(at,drawing.ctx);
    const compact=patterns.every(pattern=>pattern==='progressive'||pattern==='regressive');
    assert.equal(rows().length,compact?3:6);
    if(!compact){assert.equal(rows()[0]![0].component,series[0]);assert.equal(rows()[1]![0],'Time');assert.equal(rows()[2]![0],'Value');assert.equal(rows()[3]![0].component,series[1]);assert.equal(rows()[4]![2].text,'2.00');assert.equal(rows()[5]![2].text,'5.20');}
    chart.setCursorMode('show-nearest');chart.drawAt(at,drawing.ctx);
    assert.equal(rows().length,patterns[0]===undefined?3:2);
    assert.equal(series[0]!.getSample(1)!.x,2);assert.equal(series[1]!.getSample(1)!.y,5.2);
    chart.dispose();
  }
});

test('unordered series overrides receive all three coordinate rows once and can suppress the whole result',()=>{
  const chart=new Probe({legend:{visible:false}}).setCursorMode('show-nearest'),drawing=canvas();
  chart.axisX.setTitle('Sample time').setInterval({start:0,end:4});chart.axisY.setTitle('Voltage').setUnits('mV').setInterval({start:0,end:10});
  let calls=0;
  const series=chart.addLineSeries().add([{x:3,y:8},{x:1,y:2}]).setName('Irregular')
    .setCursorFormattingOverride((hit,before)=>{calls++;assert.equal(before.length,3);assert.equal(before[0][0].component,series);assert.equal(before[1][0],'Sample time');assert.equal(before[2][0],'Voltage');before[2][2].text=`raw:${hit.y} mV`;return before;});
  chart.renderNow();const at=chart.translatePoint({x:1,y:2},chart.coordsAxis,chart.coordsPixel);chart.drawAt(at,drawing.ctx);
  assert.equal(calls,1);assert.equal(chart.getCursor().getResultTable().getContent()[2]![2].text,'raw:2 mV');
  assert.deepEqual(series.getSample(1),{x:1,y:2});
  series.setCursorFormattingOverride(()=>undefined);chart.drawAt(at,drawing.ctx);assert.deepEqual(chart.getCursor().getResultTable().getContent(),[]);chart.dispose();
});

test('native cursor visibility follows actual hit/leave while manual visibility remains caller controlled',()=>{
  const t=setup(),cursor=t.chart.getCursor(),manual=t.chart.addCursor().setVisible(true);
  assert.equal(cursor.getVisible(),false);assert.equal(manual.getVisible(),true);
  t.draw();assert.equal(cursor.getVisible(),true);
  t.chart.drawAt(undefined,t.ctx);assert.equal(cursor.getVisible(),false);assert.deepEqual(t.rows(),[]);assert.equal(manual.getVisible(),true);
  t.draw();assert.equal(cursor.getVisible(),true);
  cursor.setVisible(false);t.draw();assert.equal(cursor.getVisible(),false);assert.deepEqual(t.rows(),[]);
  cursor.setVisible(true);t.draw();assert.equal(cursor.getVisible(),true);
  for(const series of t.series)series.clear();t.draw();assert.equal(cursor.getVisible(),false);
  manual.setVisible(false);assert.equal(manual.getVisible(),false);t.chart.dispose();assert.equal(cursor.getVisible(),false);
});
