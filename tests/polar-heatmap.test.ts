import test from 'node:test';
import assert from 'node:assert/strict';
import {Polar} from '../src/chart.js';
import {sampleHeatmapIntensity} from '../src/render-heatmap.js';

test('polar annuli and sector matrices address the same cells and partial updates preserve other cells',()=>{
  const c=new Polar(),a=c.addHeatmapSeries({sectors:3,annuli:2,amplitudeStart:2,amplitudeEnd:8,amplitudeStep:100}),b=c.addHeatmapSeries({sectors:3,annuli:2,amplitudeEnd:8,dataOrder:'sectors'});
  a.invalidateIntensityValues([[1,2,3],[4,5,6]]);b.invalidateIntensityValues([[1,4],[2,5],[3,6]]);assert.deepEqual(a.data,b.data);assert.deepEqual(a.bounds('y'),{start:2,end:8});
  b.invalidateIntensityValues({iSector:1,iAnnulus:1,values:[[9],[10]]});assert.deepEqual([...b.data],[1,2,3,4,9,10]);assert.equal(a.getIntensityAt(480,6),5);
  const previous=b.data.slice(),revision=b.dataRevision;assert.throws(()=>b.invalidateIntensityValues({iSector:2,iAnnulus:1,values:[[11],[12]]}),/exceeds/);assert.deepEqual(b.data,previous);assert.equal(b.dataRevision,revision);c.dispose();
});

test('polar bilinear interpolation wraps angular seam while preserving annulus boundaries and gaps',()=>{
  const values=new Float32Array([0,10,20,30]);assert.equal(sampleHeatmapIntensity(values,4,1,0,.5,'bilinear',{x:0,y:0},true),15);assert.equal(sampleHeatmapIntensity(values,4,1,0,.5,'bilinear'),0);
  values[3]=NaN;assert.ok(Number.isNaN(sampleHeatmapIntensity(values,4,1,0,.5,'bilinear',{x:0,y:0},true)));assert.equal(sampleHeatmapIntensity(values,4,1,.5,.5,'bilinear',{x:0,y:0},true),0);
});
