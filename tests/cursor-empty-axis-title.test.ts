import test from 'node:test';
import assert from 'node:assert/strict';
import {ChartXY} from '../src/chart';
import {AxisTickStrategies, ColorRGBA, LUT, PalettedFill} from '../src/core/styles';

const cell=(text:string)=>({text,font:{weight:'bold'}});
function fixture() {
  const chart=new ChartXY({legend:{visible:false}}).setCursorMode('show-nearest');
  chart.axisX.setInterval({start:0,end:4});chart.axisY.setInterval({start:0,end:8});
  for(const axis of [chart.axisX,chart.axisY])axis.setTickStrategy(AxisTickStrategies.Numeric,ticks=>ticks.setCursorFormatter((value:number)=>value.toFixed(2)));
  const series=chart.addLineSeries({schema:{x:{storage:Float64Array},y:{storage:Float64Array}}})
    .setDataMapping({x:'x',y:'y'}).setName('Series').appendSamples({x:[0,2,4],y:[1,3.5,6]});
  return{chart,series};
}
function result(chart:ChartXY,point={x:2,y:3.5},mode:'show-nearest'|'show-all'='show-nearest') {
  chart.renderNow();
  const hits=chart.solveNearest(chart.translateCoordinate(point,chart.coordsAxis,chart.coordsClient),mode);
  assert.ok(hits.length>0);
  const rows=chart.getCursorFormatting()(chart,hits[0],hits)!;
  assert.ok(Array.isArray(rows));
  return{hits,rows};
}

test('无标题坐标行在百万点命中时保持单值结构',()=>{
  const {chart,series}=fixture();
  try{
    chart.axisX.setTickStrategy(AxisTickStrategies.Numeric,t=>t.setCursorFormatter((v:number)=>v.toFixed(0)));
    const y=0.6377996831227095;series.clear().appendSamples({x:[0],y:[y]});
    const {hits,rows}=result(chart,{x:0,y});
    assert.equal(rows[0][0].component,series);
    assert.deepEqual(rows.slice(1),[[cell('0')],[cell('0.64')]]);
    assert.equal(hits[0].x,0);assert.equal(hits[0].y,y);
    assert.deepEqual(series.getSample(0),{x:0,y});
  }finally{chart.dispose();}
});

test('标题和单位分别配置时各轴独立选列，显式X/Y标题继续显示',()=>{
  // Titles select three-cell rows; untitled axes use one cell with the unit suffix.
  const cases=[
    {titles:['',''],units:['',''],expected:[[cell('2.00')],[cell('3.50')]]},
    {titles:['X',''],units:['',''],expected:[['X','',cell('2.00')],[cell('3.50')]]},
    {titles:['','Y'],units:['',''],expected:[[cell('2.00')],['Y','',cell('3.50')]]},
    {titles:['Elapsed','Voltage'],units:['',''],expected:[['Elapsed','',cell('2.00')],['Voltage','',cell('3.50')]]},
    {titles:['',''],units:['ms',''],expected:[[cell('2.00 ms')],[cell('3.50')]]},
    {titles:['',''],units:['','mV'],expected:[[cell('2.00')],[cell('3.50 mV')]]},
    {titles:['',''],units:['ms','mV'],expected:[[cell('2.00 ms')],[cell('3.50 mV')]]},
    {titles:['Time',''],units:['ms','mV'],expected:[['Time','',cell('2.00 ms')],[cell('3.50 mV')]]},
    {titles:['','Voltage'],units:['ms','mV'],expected:[[cell('2.00 ms')],['Voltage','',cell('3.50 mV')]]},
    {titles:['X','Y'],units:['ms','mV'],expected:[['X','',cell('2.00 ms')],['Y','',cell('3.50 mV')]]},
  ];
  for(const specification of cases){const {chart,series}=fixture();try{
    chart.axisX.setTitle(specification.titles[0]!).setUnits(specification.units[0]);
    chart.axisY.setTitle(specification.titles[1]!).setUnits(specification.units[1]);
    const {rows}=result(chart);assert.equal(rows[0][0].component,series);
    assert.deepEqual(rows.slice(1),specification.expected,JSON.stringify(specification));
    assert.deepEqual(series.getSample(1),{x:2,y:3.5});
  }finally{chart.dispose();}}
});

test('隐藏游标单位不会新增标签，清空与重设标题立即恢复对应结构',()=>{
  const {chart}=fixture();try{
    chart.axisX.setTitle('X').setUnits('ms',{displayInCursor:false});
    chart.axisY.setTitle('Y').setUnits('mV',{displayInCursor:false});
    assert.deepEqual(result(chart).rows.slice(1),[['X','',cell('2.00')],['Y','',cell('3.50')]]);
    chart.axisX.setTitle('');chart.axisY.setTitle('');
    assert.deepEqual(result(chart).rows.slice(1),[[cell('2.00')],[cell('3.50')]]);
    chart.axisY.setTitle('Y').setUnits('mV',{displayInCursor:true});
    assert.deepEqual(result(chart).rows.slice(1),[[cell('2.00')],['Y','',cell('3.50 mV')]]);
  }finally{chart.dispose();}
});

test('共享单调X仍使用原生X标题行和保留空中列的组件行',()=>{
  const {chart,series}=fixture();try{
    series.dispose();chart.axisX.setUnits('ms');chart.axisY.setUnits('mV');
    const a=chart.addLineSeries({schema:{x:{storage:Float64Array,pattern:'progressive'},y:{storage:Float64Array}}}).setDataMapping({x:'x',y:'y'}).setName('A').appendSamples({x:[0,2,4],y:[1,3.5,6]});
    const b=chart.addLineSeries({schema:{x:{storage:Float64Array,pattern:'progressive'},y:{storage:Float64Array}}}).setDataMapping({x:'x',y:'y'}).setName('B').appendSamples({x:[0,2,4],y:[2,4.5,7]});
    const {rows}=result(chart,undefined,'show-all');assert.equal(rows.length,3);
    assert.deepEqual(rows[0],[{text:'2.00 ms'}]);
    for(const [row,component,text]of [[rows[1],a,'3.50 mV'],[rows[2],b,'4.50 mV']] as const){assert.equal(row.length,3);assert.equal(row[0].component,component);assert.equal(row[1],'');assert.deepEqual(row[2],cell(text));}
  }finally{chart.dispose();}
});

test('混合schema与不同X轴保留各自坐标行及独立标题单位',()=>{
  const {chart,series}=fixture();try{
    chart.axisX.setUnits('ms');chart.axisY.setUnits('Pa');
    const x2=chart.addAxisX({opposite:true}).setTitle('Elapsed').setUnits('s').setInterval({start:0,end:4});
    x2.setTickStrategy(AxisTickStrategies.Numeric,t=>t.setCursorFormatter((v:number)=>v.toFixed(2)));
    const y2=chart.addAxisY({opposite:true}).setTitle('Voltage').setUnits('mV').setInterval({start:0,end:8});
    y2.setTickStrategy(AxisTickStrategies.Numeric,t=>t.setCursorFormatter((v:number)=>v.toFixed(2)));
    const other=chart.addLineSeries({axisX:x2,axisY:y2,schema:{x:{storage:Float64Array,pattern:'progressive'},y:{storage:Float64Array}}})
      .setDataMapping({x:'x',y:'y'}).setName('Other').appendSamples({x:[0,2,4],y:[2,4.5,7]});
    const {rows}=result(chart,undefined,'show-all');assert.equal(rows.length,6);
    assert.equal(rows[0][0].component,series);assert.deepEqual(rows.slice(1,3),[[cell('2.00 ms')],[cell('3.50 Pa')]]);
    assert.equal(rows[3][0].component,other);assert.deepEqual(rows.slice(4),[['Elapsed','',cell('2.00 s')],['Voltage','',cell('4.50 mV')]]);
    assert.deepEqual(other.getSample(1),{x:2,y:4.5});
  }finally{chart.dispose();}
});

test('热图保持空标题X/Y回退及第四行强度结构，消费者覆盖仍可修改第四行',()=>{
  const {chart,series}=fixture();try{
    series.dispose();chart.axisX.setInterval({start:0,end:1}).setUnits('ms');chart.axisY.setInterval({start:0,end:1}).setUnits('Hz');
    const lut=new LUT({steps:[{value:0,color:ColorRGBA(10,20,30)},{value:10,color:ColorRGBA(40,50,60)}]}).setUnits('dB');
    const heat=chart.addHeatmapGridSeries({columns:1,rows:1}).setFillStyle(new PalettedFill({lut})).invalidateIntensityValues([[3.5]]);
    let calls=0;heat.setCursorFormattingOverride((_hit,before)=>{calls++;assert.equal(before.length,4);assert.equal(before[3][0],'Value');before[3][0]='Measured';return before;});
    const {rows}=result(chart,{x:.5,y:.5});assert.equal(calls,1);assert.equal(rows[0][0].component,heat);
    assert.deepEqual(rows.slice(1),[['X','',cell('0.50 ms')],['Y','',cell('0.50 Hz')],['Measured','',cell('3.5 dB')]]);
    assert.equal(heat.solveNearest(chart.translateCoordinate({x:.5,y:.5},chart.coordsAxis,chart.coordsClient))!.intensity,3.5);
  }finally{chart.dispose();}
});

test('单系列覆盖收到正确单值行，显式图表formatter仍完全控制用户结构',()=>{
  const {chart,series}=fixture();let calls=0;try{
    series.setCursorFormattingOverride((hit,before)=>{calls++;assert.equal(before[0][0].component,series);assert.deepEqual(before.slice(1),[[cell('2.00')],[cell('3.50')]]);before[2][0].text=`raw:${hit.y}`;return before;});
    assert.deepEqual(result(chart).rows.slice(1),[[cell('2.00')],[cell('raw:3.5')]]);assert.equal(calls,1);
    const consumer=[['X','custom unit','consumer value'],['Y']];chart.setCursorFormatting(()=>consumer);
    assert.equal(result(chart).rows,consumer);assert.equal(calls,1);assert.deepEqual(series.getSample(1),{x:2,y:3.5});
  }finally{chart.dispose();}
});
