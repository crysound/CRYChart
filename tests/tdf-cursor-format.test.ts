// 白盒状态/布局检查读取保留的策略对象；公开类型getter由独立四型回归验证。
import test from'node:test';
import assert from'node:assert/strict';
import{ChartXY}from'../src/chart';
import type{TickStyle}from'../src/axis';
import{AxisTickStrategies,ColorHEX,LUT,PalettedFill}from'../src/core/styles';
import{defaultXYCursorRows}from'../src/cursor-api';

test('a TDF-sized Time interval preserves signed milliseconds and unbounded hours in public formatting',()=>{
  const chart=new ChartXY(),axis=chart.axisX.setTickStrategy(AxisTickStrategies.Time).setInterval({start:0,end:30}),cases:[number,string][]=[
    [0,'00:00:00.000'],[45,'00:00:00.045'],[-45,'-00:00:00.045'],[999,'00:00:00.999'],[1000,'00:00:01.000'],[59999,'00:00:59.999'],[60000,'00:01:00.000'],[3599999,'00:59:59.999'],[3600000,'01:00:00.000'],[86399999,'23:59:59.999'],[86400000,'24:00:00.000'],[90061001,'25:01:01.001'],[-3600001,'-01:00:00.001'],[1.25,'00:00:00.001'],[.9999,'00:00:00.000'],[-.25,'-00:00:00.000']];
  try{for(const[value,expected]of cases){assert.equal(axis.formatCursorValue(value),expected,String(value));assert.equal(axis.formatValue(value),expected,String(value));}assert.equal(axis.formatCursorValue(NaN),'NaN');assert.equal(axis.formatCursorValue(Infinity),'Infinity');}finally{chart.dispose();}
});

test('default Time cursor offsets timeOrigin, resets undefined, and explicit formatters receive the original value',()=>{
  const chart=new ChartXY(),axis=chart.axisX.setTickStrategy(AxisTickStrategies.Time).setInterval({start:0,end:30}),strategy=axis.tickStrategy;
  try{
    for(const[origin,expected]of[[0,'00:00:00.045'],[86400000,'24:00:00.045'],[-3600000,'-00:59:59.955'],[1234.5,'00:00:01.279']]as const){strategy.setTimeOrigin(origin);assert.equal(axis.formatCursorValue(45),expected);}
    strategy.setTimeOrigin(undefined);assert.equal(axis.formatCursorValue(45),'00:00:00.045');
    strategy.setTimeOrigin(86400000).setFormattingFunction((value:number)=>`all:${value}`);assert.equal(axis.formatCursorValue(45),'all:45');assert.equal(axis.formatValue(45),'all:45');
    strategy.setCursorFormatter((value:number)=>`cursor:${value}`);assert.equal(axis.formatCursorValue(45),'cursor:45');assert.equal(axis.formatValue(45),'cursor:45');
    strategy.setCursorFormatter(undefined);assert.equal(axis.formatCursorValue(45),'24:00:00.045');
    axis.setTickStrategy(AxisTickStrategies.Time,s=>s.setMajorFormattingFunction((value:number)=>`major:${value}`));assert.equal(axis.formatValue(45),'24:00:00.045');assert.equal(axis.formatCursorValue(45),'24:00:00.045');assert.ok(axis.ticks().every(t=>t.label.startsWith('major:')));
    axis.setTickStrategy(AxisTickStrategies.Time);assert.equal(axis.tickStrategy,strategy);assert.equal(axis.formatValue(45),'24:00:00.045');assert.ok(axis.ticks().every(t=>t.label.startsWith('major:')));
    strategy.setTimeOrigin(undefined);
    axis.setUnits('ms',{displayOnAxis:false,displayInCursor:true});assert.equal(axis.formatCursorValue(45),'00:00:00.045 ms');axis.setUnits('ms',{displayInCursor:false});assert.equal(axis.formatCursorValue(45),'00:00:00.045');
  }finally{chart.dispose();}
});

test('the CRY tick-label extension remains local to tick labels and does not override the public cursor formatter',()=>{
  const chart=new ChartXY(),axis=chart.axisX.setTickStrategy(AxisTickStrategies.Time,s=>s.setMajorTickStyle((t:TickStyle)=>t.setLabelFormatter((value:number)=>`label:${value}`))).setInterval({start:0,end:30}),strategy=axis.tickStrategy;
  try{
    assert.equal(axis.formatValue(45),'00:00:00.045');assert.equal(axis.formatCursorValue(45),'00:00:00.045');assert.ok(axis.ticks().every(t=>t.label.startsWith('label:')));
    strategy.setTimeOrigin(86400000);assert.equal(axis.formatCursorValue(45),'24:00:00.045');
    strategy.setFormattingFunction((value:number)=>`all:${value}`);assert.equal(axis.formatCursorValue(45),'all:45');
    strategy.setCursorFormatter((value:number)=>`cursor:${value}`);assert.equal(axis.formatCursorValue(45),'cursor:45');
    strategy.setCursorFormatter(undefined);assert.equal(axis.formatCursorValue(45),'24:00:00.045');
    strategy.setFormattingFunction(undefined);assert.equal(axis.formatCursorValue(45),'24:00:00.045');assert.ok(axis.ticks().every(t=>t.label.startsWith('label:')));
    strategy.getMajorTickStyle().setLabelFormatter(undefined);assert.equal(axis.formatCursorValue(45),'24:00:00.045');
    strategy.setTimeOrigin(undefined);assert.equal(axis.formatCursorValue(45),'00:00:00.045');
  }finally{chart.dispose();}
});

function heatFixture(){
  const chart=new ChartXY({legend:{visible:false}});chart.axisX.setTitle('Time(ms)').setTickStrategy(AxisTickStrategies.Time).setInterval({start:0,end:30});chart.axisY.setTitle('Frequency(Hz)').setInterval({start:0,end:200});
  const colors=['#192d96','#03bbc9','#f0cb3c','#eb4155'],lut=new LUT({steps:[0,20,40,60].map((value,i)=>({value,color:ColorHEX(colors[i]!)})),interpolate:true}),heat=chart.addHeatmapScrollingGridSeries({resolution:2,scrollDimension:'columns'}).setStart({x:0,y:0}).setStep({x:10,y:100}).setName('Measured spectrum').setFillStyle(new PalettedFill({lut}));
  heat.invalidateIntensityValues({iSample:0,values:[[40,0],[27.625,NaN],[1.25,-1.25]]});chart.renderNow();
  const hit=(x:number,y:number)=>heat.solveNearest(chart.translateCoordinate({x,y},chart.coordsAxis,chart.coordsClient))!;
  return{chart,heat,lut,hit};
}

test('finite heat header uses the hit LUT color and one-decimal display without changing the hit or source intensity',()=>{
  const{chart,heat,hit}=heatFixture();try{
    const value=hit(15,50),rows=defaultXYCursorRows(chart,value,[value]),color=rows[0]![0].componentColor;
    assert.equal(rows[0]![0].component,heat);for(const[actual,expected]of[[color.getR(),93.35625],[color.getG(),193.1],[color.getB(),147.24375],[color.getA(),255]])assert.ok(Math.abs(actual-expected)<1e-12);
    assert.equal(rows[1]![2].text,'00:00:00.015');assert.equal(rows[2]![0],'Frequency(Hz)');assert.equal(rows[3]![0],'Value');assert.equal(rows[3]![2].text,'27.6');assert.equal(value.intensity,27.625);assert.equal(heat.getIntensityValue(1,0),27.625);
    assert.equal(defaultXYCursorRows(chart,hit(25,50),[])[3]![2].text,'1.3');assert.equal(defaultXYCursorRows(chart,hit(25,150),[])[3]![2].text,'-1.3');
  }finally{chart.dispose();}
});

test('zero is a finite color and NaN keeps its raw identity without a misleading maximum-color marker',()=>{
  const{chart,hit}=heatFixture();try{
    const zero=hit(5,150),missing=hit(15,150),rows0=defaultXYCursorRows(chart,zero,[]),rowsNaN=defaultXYCursorRows(chart,missing,[]);
    assert.equal(rows0[3]![2].text,'0.0');assert.equal(rows0[0]![0].componentColor.getB(),150);assert.equal(zero.intensity,0);
    assert.equal(rowsNaN[3]![2].text,'NaN');assert.equal('componentColor'in rowsNaN[0]![0],false);assert.ok(Number.isNaN(missing.intensity));
  }finally{chart.dispose();}
});

test('heatmap default value rows carry the active LUT units for finite, zero and missing values',()=>{
  const {chart,heat,lut,hit}=heatFixture();
  try{
    heat.setFillStyle(new PalettedFill({lut:lut.setUnits('dB')}));
    for(const [x,y,text] of [[15,50,'27.6 dB'],[5,150,'0.0 dB'],[15,150,'NaN dB']] as const){
      const value=hit(x,y),rows=defaultXYCursorRows(chart,value,[]);
      assert.equal(rows[3]![2].text,text);
    }
    assert.equal(heat.getIntensityValue(1,0),27.625);
    assert.ok(Number.isNaN(heat.getIntensityValue(1,1)));
    heat.setFillStyle(new PalettedFill({lut:lut.setUnits('mV')}));
    assert.equal(defaultXYCursorRows(chart,hit(15,50),[])[3]![2].text,'27.6 mV');
    heat.setCursorFormattingOverride((_value,before)=>{assert.equal(before[3]![2].text,'27.6 mV');before[3]![2].text='custom';return before;});
    assert.equal(defaultXYCursorRows(chart,hit(15,50),[])[3]![2].text,'custom');
    heat.setCursorFormattingOverride(undefined).setFillStyle(new PalettedFill({lut:lut.setUnits('')}));
    assert.equal(defaultXYCursorRows(chart,hit(15,50),[])[3]![2].text,'27.6');
  }finally{chart.dispose();}
});

test('consumer fourth-row override and hidden titles keep their structure, rich cell styles and exact raw input',()=>{
  const{chart,heat,hit}=heatFixture();let calls=0;try{
    chart.axisX.setTitle('');chart.axisY.setTitle('');heat.setCursorFormattingOverride((value,before)=>{calls++;assert.equal(before.length,4);before[3]![0]='Level(dB)';before[3]![2].text=Number.isNaN(value.intensity)?'N/A':(value.intensity-40).toFixed(3);return before;});
    const value=hit(15,50),rows=defaultXYCursorRows(chart,value,[value]);assert.equal(calls,1);assert.equal(rows[1]![0],'X');assert.equal(rows[2]![0],'Y');assert.equal(rows[3]![2].text,'-12.375');assert.deepEqual(rows[3]![2].font,{weight:'bold'});assert.equal(value.intensity,27.625);
    assert.equal(defaultXYCursorRows(chart,hit(15,150),[])[3]![2].text,'N/A');assert.equal(calls,2);
  }finally{chart.dispose();}
});
