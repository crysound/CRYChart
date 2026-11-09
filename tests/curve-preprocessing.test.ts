import test from 'node:test';
import assert from 'node:assert/strict';
import {ChartXY} from '../src/chart';

test('OpenTest resolution-zero spline configuration preserves all samples and unchanged line coordinates',()=>{
  const chart=new ChartXY(),line=chart.addLineSeries();
  line.add([{x:0,y:0},{x:.01,y:1},{x:.02,y:-2},{x:.03,y:NaN},{x:.04,y:0}]);
  const data=line.getDataSet(),revision=data.revision,before=line.drawPacket('line').positions.slice(),points=line.getPoints();
  assert.equal(line.setCurvePreprocessing({type:'spline',resolution:0}),line);assert.deepEqual(line.getCurvePreprocessing(),{type:'spline',resolution:0});
  const after=line.drawPacket('line');assert.deepEqual(after.positions,before);assert.deepEqual(line.getPoints(),points);assert.equal(after.count,5);assert.equal(data.revision,revision);
  assert.throws(()=>line.setCurvePreprocessing({type:'spline',resolution:20}),/resolution 0/);assert.deepEqual(line.getCurvePreprocessing(),{type:'spline',resolution:0});
  line.setCurvePreprocessing(undefined);assert.equal(line.getCurvePreprocessing(),undefined);chart.dispose();
});
