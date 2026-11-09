import test from 'node:test';
import assert from 'node:assert/strict';
import {Polar} from '../src/chart.js';
import {samplePolarHeatmapIntensity} from '../src/render-heatmap.js';

const values=Float32Array.from({length:24},(_,i)=>Math.floor(i/8)*20+i%8);
const near=(actual:number,expected:number)=>assert.ok(Math.abs(actual-expected)<1e-10,`${actual} != ${expected}`);

test('Polar public amplitude end fixes the last retained node, while legacy cell queries retain their contract',()=>{
  const chart=new Polar();chart.resize(700,600);chart.getAmplitudeAxis().setInterval({start:0,end:45});
  const step=chart.addHeatmapSeries({sectors:8,annuli:3,amplitudeStart:5,amplitudeStep:10}).invalidateIntensityValues(values);
  const end=chart.addHeatmapSeries({sectors:8,annuli:3,amplitudeStart:5,amplitudeEnd:35,amplitudeStep:100}).invalidateIntensityValues(values);
  assert.deepEqual(step.getRadialNodeRange(),{start:5,end:25});assert.deepEqual(end.getRadialNodeRange(),{start:5,end:35});
  assert.deepEqual([end.getAmplitudeMin(),end.getAmplitudeMax()],[5,35]);
  assert.deepEqual(step.bounds('y'),{start:5,end:35});assert.deepEqual(end.bounds('y'),{start:5,end:35});
  for(const [amplitude,index]of[[5,0],[20,1],[35,2]]){
    const hit=end.solveNearest(chart.translateCoordinate({angle:90,amplitude},chart.coordsClient));
    assert.deepEqual([hit.amplitude,hit.annulus,hit.intensity],[amplitude,index,index*20+2]);
  }
  assert.deepEqual([...end.data],[...values]);assert.equal(end.getSampleCount(),24);chart.dispose();
});

test('disabled radial node sampling draws two bands for three nodes and never invents a third band',()=>{
  const sample=(angle:number,radius:number)=>samplePolarHeatmapIntensity(values,8,3,angle/45,radius,5,25);
  assert.equal(sample(65,3),0);assert.equal(sample(65,7),1);assert.equal(sample(65,12),1);
  assert.equal(sample(65,17),21);assert.equal(sample(65,22),21);assert.equal(sample(65,25),41);
  assert.ok(Number.isNaN(sample(65,25.001)));assert.ok(Number.isNaN(sample(65,32)));
  assert.deepEqual([...values],Array.from({length:24},(_,i)=>Math.floor(i/8)*20+i%8));
});

test('bilinear radial interpolation uses original neighboring nodes and the final row, without half-cell displacement',()=>{
  const sample=(angle:number,radius:number)=>samplePolarHeatmapIntensity(values,8,3,angle/45,radius,5,25,'bilinear');
  near(sample(15,7),4+1/3);near(sample(15,12),14+1/3);near(sample(15,22),34+1/3);near(sample(15,25),40+1/3);
  near(sample(65,7),4+65/45);near(sample(15,3),(15/45)*3/5);
  near(sample(360,15),20);near(sample(-45,15),27);
});

test('missing source nodes remain missing and only nonzero interpolation contributors can create a gap',()=>{
  const data=values.slice();data[8]=NaN;
  assert.equal(samplePolarHeatmapIntensity(data,8,3,0,5,5,25,'bilinear'),0);
  assert.ok(Number.isNaN(samplePolarHeatmapIntensity(data,8,3,0,6,5,25,'bilinear')));
  assert.equal(samplePolarHeatmapIntensity(data,8,3,1,15,5,25,'bilinear'),21);
  assert.ok(Number.isNaN(samplePolarHeatmapIntensity(data,8,3,0,15,5,25)));
  data[0]=NaN;assert.ok(Number.isNaN(samplePolarHeatmapIntensity(data,8,3,4,3,5,25)));
  assert.equal(samplePolarHeatmapIntensity(new Float32Array([0,10]),2,1,0,0,0,0,'bilinear'),0);
});

test('Canvas sampling and public node queries remain separate, preserving signed zero and partial-update source identity',()=>{
  const chart=new Polar();chart.getAmplitudeAxis().setInterval({start:0,end:45});
  const series=chart.addHeatmapSeries({sectors:8,annuli:3,amplitudeStart:5,amplitudeStep:10}).invalidateIntensityValues(values);
  assert.equal(series.sampleRenderedIntensity(65,12),1);
  const point=chart.translateCoordinate({angle:65,amplitude:12},chart.coordsClient);
  assert.equal(series.solveNearest(point).intensity,21);
  series.invalidateIntensityValues({iSector:1,iAnnulus:1,values:[[-0]]});assert.ok(Object.is(series.data[9],-0));
  assert.ok(Object.is(series.sampleRenderedIntensity(65,17),-0));assert.equal(series.getIntensityAt(65,17),-0);
  series.clear();assert.ok([...series.data].every(Number.isNaN));assert.equal(series.getSampleCount(),24,'Clearing removes values, not the fixed grid dimensions');
  assert.ok(Number.isNaN(series.sampleRenderedIntensity(65,17)));
  series.invalidateIntensityValues(values);assert.deepEqual([...series.data],[...values]);assert.equal(series.getSampleCount(),24);chart.dispose();
});
