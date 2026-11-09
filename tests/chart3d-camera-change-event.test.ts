import test from 'node:test';
import assert from 'node:assert/strict';
import {Chart3D} from '../src/chart.js';

class Probe extends Chart3D{
 rotate(dx:number,dy:number){this.rotate3DCamera(dx,dy);}
 wheel(delta:number){this.zoom3DCamera(delta);}
 advanceAndRender(timestamp:number){this.beforeScheduledAnimationFrame(timestamp);this.renderNow();}
}
function fixture(){
 const chart=new Probe({width:800,height:500});
 for(const axis of chart.getAxes())axis.setInterval({start:0,end:10});
 chart.setProjection('orthographic').setCameraAutomaticFittingEnabled(false).setCameraLocation({x:3,y:2,z:4});
 chart.renderNow();return chart;
}

test('camera changes publish the actual copied cameraLocation after effective rendering, not on unchanged setters',()=>{
 const chart=fixture(),events:any[]=[];try{
  chart.addEventListener('camerachange',event=>events.push(event));
  chart.setCameraLocation({x:4,y:3,z:5});assert.equal(events.length,0);chart.renderNow();
  assert.equal(events.length,1);assert.deepEqual(events[0].cameraLocation,chart.getCameraLocation());
  const actual=chart.getCameraLocation();events[0].cameraLocation.x=999;assert.deepEqual(chart.getCameraLocation(),actual);
  chart.setCameraLocation({x:4,y:3,z:5});chart.invalidate();chart.renderNow();assert.equal(events.length,1);
 }finally{chart.dispose();}
});

test('actual rotate and wheel camera paths publish view changes while disabled gestures do not',()=>{
 const chart=fixture(),events:any[]=[];try{
  chart.addEventListener('camerachange',event=>events.push(event));
  chart.rotate(55,28);chart.renderNow();assert.equal(events.length,1);const rotated=chart.getCameraLocation();
  chart.setAnimationsEnabled(false);chart.wheel(120);chart.advanceAndRender(1000);assert.equal(events.length,2);
  assert.notDeepEqual(chart.getCameraLocation(),rotated);assert.deepEqual(events[1].cameraLocation,chart.getCameraLocation());
  chart.setUserInteractions({rotate:false,zoom:{wheel:false}});chart.rotate(55,28);chart.wheel(120);chart.advanceAndRender(1020);assert.equal(events.length,2);
 }finally{chart.dispose();}
});

test('viewport and coordinate-domain changes publish once without looping on the page mesh updates or pure data changes',()=>{
 const chart=fixture(),events:any[]=[];try{
  const mesh=chart.addMeshModel().setModelGeometry({vertices:[0,0,0,1,0,0,0,1,0]});
  chart.renderNow();
  chart.addEventListener('camerachange',event=>{events.push(event);mesh.setScale(mesh.getScale());chart.invalidate();});
  chart.resize(900,600);chart.renderNow();assert.equal(events.length,1);chart.renderNow();assert.equal(events.length,1);
  chart.axisX.setInterval({start:0,end:20});chart.renderNow();assert.equal(events.length,2);
  const series=chart.addLineSeries().add({x:1,y:2,z:3});chart.renderNow();series.add({x:2,y:3,z:4});chart.renderNow();assert.equal(events.length,2);
  chart.setBoundingBox({x:2,y:1,z:1});chart.renderNow();assert.equal(events.length,3);chart.renderNow();assert.equal(events.length,3);
 }finally{chart.dispose();}
});

test('removed camera listeners and disposed charts no longer publish',()=>{
 const chart=fixture();let calls=0;const listener=()=>calls++;
 chart.addEventListener('camerachange',listener);chart.removeEventListener('camerachange',listener);
 chart.setCameraLocation({x:5,y:3,z:4});chart.renderNow();assert.equal(calls,0);chart.dispose();chart.renderNow();assert.equal(calls,0);
});
