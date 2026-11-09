import test from "node:test";
import assert from "node:assert/strict";
import { ChartXY,Polar } from "../src/chart.js";
import { DataSetXY } from "../src/core/data.js";
import {AxisScrollStrategies} from '../src/core/styles.js';

test('progressive scrolling preserves window width and expansion never shrinks',()=>{
 const chart=new ChartXY(),x=chart.getDefaultAxisX(),y=chart.getDefaultAxisY(),s=chart.addLineSeries();x.setDefaultInterval({start:0,end:10,stopAxisAfter:false}).setScrollStrategy(AxisScrollStrategies.progressive);y.setInterval({start:-1,end:1,stopAxisAfter:false}).setScrollStrategy(AxisScrollStrategies.expansion);s.add([{x:1,y:-10},{x:14,y:20}]);chart.renderNow();assert.deepEqual(x.getInterval(),{start:4,end:14});const previous=y.getInterval();s.clear().add([{x:20,y:0},{x:21,y:1}]);chart.renderNow();assert.deepEqual(x.getInterval(),{start:11,end:21});assert.deepEqual(y.getInterval(),previous);x.setScrollStrategy(undefined);s.add({x:100,y:1});chart.renderNow();assert.deepEqual(x.getInterval(),{start:11,end:21});chart.dispose();
});
test('default interval callbacks receive data bounds and are restored by fit',()=>{
 const chart=new ChartXY(),s=chart.addLineSeries();s.add([{x:20,y:1},{x:45,y:2}]);const x=chart.getDefaultAxisX().setDefaultInterval((state:any)=>({start:state.dataMax-10,end:state.dataMax,stopAxisAfter:false}));assert.deepEqual(x.getInterval(),{start:35,end:45});x.setInterval({start:0,end:1});chart.fit();assert.deepEqual(x.getInterval(),{start:35,end:45});chart.dispose();
});

test("polar decibels map to radius and north-clockwise orientation preserves cardinal angles",()=>{
 const chart=new Polar().setPadding(0).setAngleOrigin(90).setClockwise(true);chart.resize(400,400);chart.getRadialAxis().setTitle('').setTickFormattingFunction(()=> '');chart.getAmplitudeAxis().setTitle('').setInterval({start:-40,end:0});chart.renderNow();
 // With no outside angular text, title or padding, the data circle must fill
 // the 400px square. These expected CSS coordinates do not call the helper.
 assert.deepEqual(chart.plot,{left:0,top:0,width:400,height:400});
 assert.deepEqual(chart.projectPolarPoint({angle:0,amplitude:-40}),{x:200,y:200});
 const north=chart.projectPolarPoint({angle:0,amplitude:-20}),east=chart.projectPolarPoint({angle:90,amplitude:0}),south=chart.projectPolarPoint({angle:180,amplitude:0}),west=chart.projectPolarPoint({angle:270,amplitude:0});
 for(const[actual,expected]of[[north,{x:200,y:100}],[east,{x:400,y:200}],[south,{x:200,y:400}],[west,{x:0,y:200}]]){assert.ok(Math.abs(actual.x-expected.x)<1e-9);assert.ok(Math.abs(actual.y-expected.y)<1e-9);}chart.dispose();
});

test("replacing an equal-revision dataset invalidates GPU and nearest-point caches",()=>{
 const a=new DataSetXY(),b=new DataSetXY(),chart=new ChartXY();a.appendSamples({x:[0,1,2],y:[0,1,2]});b.appendSamples({x:[0,10,5],y:[2,3,4]});assert.equal(a.revision,b.revision);
 const s=chart.addLineSeries({dataSet:a}),old=s.drawPacket().revision;s.findNearestX(1);s.setDataSet(b);const packet=s.drawPacket();assert.notEqual(packet.revision,old);assert.deepEqual([...packet.positions],[0,0,10,1,5,2]);assert.deepEqual(s.findNearestX(6),{x:5,y:4});chart.dispose();
});

test("ordinary nested heatmap arrays are data, even though Array.prototype has values()", () => {
  const chart = new ChartXY(),
    heat = chart.addHeatmapGridSeries({dataOrder: 'rows',  columns: 3, rows: 2 });
  heat.invalidateIntensityValues([
    [1, 2, 3],
    [4, 5, 6],
  ]);
  assert.deepEqual([...heat.data], [1, 2, 3, 4, 5, 6]);
  heat.invalidateIntensityValues({
    iColumn: 1,
    iRow: 0,
    values: [
      [20, 30],
      [50, 60],
    ],
  });
  assert.deepEqual([...heat.data], [1, 20, 30, 4, 50, 60]);
  chart.dispose();
});
test("scrolling heatmap retains temporal column order after multiple wraps", () => {
  const chart = new ChartXY(),
    heat = chart.addHeatmapScrollingGridSeries({ columns: 3, rows: 2 });
  heat.addIntensityValues([
    [1, 10],
    [2, 20],
    [3, 30],
    [4, 40],
    [5, 50],
  ]);
  assert.deepEqual([...heat.orderedData()], [3, 4, 5, 30, 40, 50]);
  assert.deepEqual(heat.bounds("x"), { start: 2, end: 5 });
  assert.equal(heat.getSampleCount(), 5);
  chart.dispose();
});
test("series removal preserves a dataset shared by another chart", () => {
  const data = new DataSetXY({ schema: { x: {}, y: {} } }),
    first = new ChartXY(),
    second = new ChartXY();
  data.appendSamples({ x: [1, 2], y: [3, 4] });
  first.addLineSeries({ dataSet: data });
  const remaining = second.addLineSeries({ dataSet: data });
  first.dispose();
  data.appendSamples({ x: [3], y: [5] });
  assert.equal(remaining.getSampleCount(), 3);
  assert.deepEqual(remaining.getSample(2), { x: 3, y: 5 });
  second.dispose();
});
test("independent axes preserve explicit viewport while automatic axis follows data", () => {
  const chart = new ChartXY(),
    secondY = chart.addAxisY({ opposite: true });
  chart.getDefaultAxisY().setInterval({ start: -2, end: 2 });
  const a = chart.addLineSeries(),
    b = chart.addLineSeries({ axisY: secondY });
  a.add([
    { x: 0, y: 1 },
    { x: 5, y: 2 },
  ]);
  b.add([
    { x: 0, y: 100 },
    { x: 5, y: 200 },
  ]);
  chart.renderNow();
  assert.deepEqual(chart.getDefaultAxisY().getInterval(), {
    start: -2,
    end: 2,
  });
  assert.ok(secondY.getInterval().end >= 200);
  chart.dispose();
});
test("relative GPU coordinates keep sub-unit deltas at epoch-scale origins", () => {
  const chart = new ChartXY(),
    s = chart.addLineSeries(),
    origin = 1700000000000;
  s.add([
    { x: origin, y: 0 },
    { x: origin + 0.25, y: 1 },
    { x: origin + 0.5, y: 2 },
  ]);
  const packet = s.drawPacket();
  assert.equal(packet.origin.x, origin);
  assert.deepEqual([...packet.positions], [0, 0, 0.25, 1, 0.5, 2]);
  chart.dispose();
});
test("nearest X handles both sorted waveforms and arbitrary trajectories", () => {
  const chart = new ChartXY(),
    line = chart.addLineSeries();
  line.add([
    { x: 0, y: 3 },
    { x: 2, y: 4 },
    { x: 5, y: 8 },
  ]);
  assert.deepEqual(line.findNearestX(1.8), { x: 2, y: 4 });
  line.clear().add([
    { x: 5, y: 8 },
    { x: 0, y: 3 },
    { x: 2, y: 4 },
  ]);
  assert.deepEqual(line.findNearestX(1.8), { x: 2, y: 4 });
  chart.dispose();
});
