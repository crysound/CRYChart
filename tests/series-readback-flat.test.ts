import test from 'node:test';
import assert from 'node:assert/strict';
import {ChartXY} from '../src/chart.js';
import {DataSetXY} from '../src/core/data.js';

test('calibration PointLineAreaSeries readBack exposes the native flat XY contract', () => {
  const chart = new ChartXY();
  try {
    const series = chart.addPointLineAreaSeries({schema: {
      xValues: {storage: Float64Array, pattern:'progressive'},
      yValues: {storage: Float32Array},
    }});
    series.appendSamples({xValues: [0,180], yValues: [94,114]});
    const result = series.readBack({onlyInRange:{start:0,end:60000}});
    assert.deepEqual(Object.keys(result), ['xValues','yValues','iSampleFirst']);
    assert.ok(result.xValues instanceof Float64Array);
    assert.ok(result.yValues instanceof Float32Array);
    assert.deepEqual(Array.from(result.xValues), [0,180]);
    assert.deepEqual(Array.from(result.yValues), [94,114]);
    assert.equal(result.iSampleFirst,0);
    assert.deepEqual(Object.keys({...result}), ['xValues','yValues','iSampleFirst']);
  } finally { chart.dispose(); }
});

test('series readBack follows render mappings while DataSet preserves raw columns and retained index', () => {
  const chart = new ChartXY();
  try {
    const data = new DataSetXY({schema:{time:{storage:Float64Array,pattern:'progressive'},raw:{storage:Float64Array},render:{storage:Float32Array}}}).setMaxSampleCount(3);
    data.appendSamples({time:[0,10,20,30,40],raw:[1,2,30,40,50],render:[1,2,NaN,-0,5]});
    const series=chart.addLineSeries({schema:data.schema}).setDataSet(data).setDataMapping({x:'time',y:'render'});
    const result=series.readBack();
    assert.equal(result.iSampleFirst,2);
    assert.deepEqual(Array.from(result.xValues),[20,30,40]);
    assert.ok(Number.isNaN(result.yValues[0]));
    assert.ok(Object.is(result.yValues[1],-0));
    assert.equal(result.yValues[2],5);
    assert.deepEqual(Array.from(data.readBack().data.raw!),[30,40,50]);
    assert.deepEqual(Array.from(result.data.x!),[20,30,40]);
    assert.equal(result.data.y,result.yValues);
    assert.equal(Object.getOwnPropertyDescriptor(result,'data')!.enumerable,false);
    const clipped=series.readBack({onlyInRange:{start:30,end:40}});
    assert.deepEqual(Array.from(clipped.xValues),[30,40]);
    assert.ok(Object.is(clipped.yValues[0],-0));
  } finally { chart.dispose(); }
});

test('flat series readBack has empty arrays after clear and fresh coordinates after refill', () => {
  const chart=new ChartXY();
  try {
    const series=chart.addLineSeries();
    series.appendSamples({x:[1,2],y:[3,4]}).clear();
    const empty=series.readBack();
    assert.equal(empty.xValues.length,0);assert.equal(empty.yValues.length,0);assert.equal(empty.iSampleFirst,0);
    series.appendSamples({x:[10,20],y:[30,40]});
    const refilled=series.readBack();
    assert.deepEqual(Array.from(refilled.xValues),[10,20]);assert.deepEqual(Array.from(refilled.yValues),[30,40]);
  } finally { chart.dispose(); }
});

test('default PointLineAreaSeries consumes canonical native XY columns used by EQ and framework charts', () => {
  const chart=new ChartXY();
  try {
    const series=chart.addPointLineAreaSeries({dataPattern:null});
    const input=Object.freeze({xValues:new Float64Array([100,1000,10000]),yValues:new Float64Array([-3,6,0])});
    series.appendSamples(input);
    assert.deepEqual(series.getDataMapping(),{x:'xValues',y:'yValues'});
    assert.deepEqual(Object.keys(series.getDataSet().schema),['xValues','yValues']);
    const values=series.readBack();
    assert.deepEqual(Array.from(values.xValues),[100,1000,10000]);
    assert.deepEqual(Array.from(values.yValues),[-3,6,0]);
    assert.ok([...values.xValues,...values.yValues].every(Number.isFinite));
    assert.deepEqual(Array.from(input.xValues),[100,1000,10000]);
  } finally {chart.dispose();}
});

test('default native columns preserve legacy XY append input without changing explicit custom schemas', () => {
  const chart=new ChartXY();
  try {
    const line=chart.addLineSeries();
    line.appendSamples({x:[1,2],y:[3,4]});
    line.appendSamples({xValues:[5],yValues:[6]});
    assert.deepEqual(Array.from(line.readBack().xValues),[1,2,5]);
    assert.deepEqual(Array.from(line.readBack().data.y!),[3,4,6]);
    const custom=chart.addLineSeries({schema:{x:{storage:Float64Array},y:{storage:Float64Array}}});
    custom.appendSamples({x:[10,20],y:[30,40]});
    assert.deepEqual(custom.getDataMapping(),{x:'x',y:'y'});
    assert.deepEqual(Object.keys(custom.getDataSet().schema),['x','y']);
    assert.deepEqual(Array.from(custom.getDataSet().readBack().data.x!),[10,20]);
  } finally {chart.dispose();}
});

test('generator file Scope single Y schema derives native automatic X without adding a raw public column', () => {
  const chart=new ChartXY();
  try {
    const line=chart.addPointLineAreaSeries({schema:{yValues:{pattern:null}}});
    line.appendSamples({yValues:new Float32Array([.25,-.5,.75])},{step:1/48000});
    assert.deepEqual(line.getDataMapping(),{x:'_auto',y:'yValues'});
    assert.deepEqual(Object.keys(line.getDataSet().schema),['yValues']);
    assert.deepEqual(Object.keys(line.getDataSet().readBack().data),['yValues']);
    assert.deepEqual(Array.from(line.readBack().xValues),[0,1/48000,2/48000]);
    assert.deepEqual(Array.from(line.readBack().yValues),[.25,-.5,.75]);
    assert.deepEqual(line.getSample(1),{x:1/48000,y:-.5});
    assert.deepEqual(line.bounds('x'),{start:0,end:2/48000});
    assert.ok(line.drawPacket('line').positions.length>0);
    assert.ok(Array.from(line.drawPacket('line').positions).every(Number.isFinite));
  } finally {chart.dispose();}
});

test('automatic single-channel X retains exact batch origins through clipping, clear and replacement', () => {
  const chart=new ChartXY();
  try {
    const line=chart.addPointLineAreaSeries({schema:{yValues:{storage:Float64Array}}}).setMaxSampleCount(4);
    line.appendSamples({yValues:[1,2,3]},{start:10,step:.5});
    line.appendSamples({yValues:[4,5]},{step:2});
    assert.deepEqual(Array.from(line.readBack().xValues),[10.5,11,13,15]);
    assert.equal(line.readBack().iSampleFirst,1);
    const clipped=line.readBack({onlyInRange:{start:11,end:13}});
    assert.deepEqual(Array.from(clipped.xValues),[11,13]);
    assert.deepEqual(Array.from(clipped.yValues),[3,4]);
    assert.equal(clipped.iSampleFirst,2);
    line.getDataSet().replaceSamples({yValues:[6,7]},{start:100,step:3});
    assert.deepEqual(Array.from(line.readBack().xValues),[100,103]);
    assert.deepEqual(Array.from(line.readBack().yValues),[6,7]);
    line.clear().appendSamples({yValues:[8,9]},{step:.25});
    assert.deepEqual(Array.from(line.readBack().xValues),[0,.25]);
    assert.deepEqual(Object.keys(line.getDataSet().readBack().data),['yValues']);
  } finally {chart.dispose();}
});
