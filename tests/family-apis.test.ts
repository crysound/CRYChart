import test from 'node:test';
import assert from 'node:assert/strict';
import {Polar,Chart3D} from '../src/chart';
import {PointStyle3D,SolidFill,ColorRGBA} from '../src/core/styles';

test('the OpenTest radial-axis chain keeps zero north, clockwise degrees and radians-only tick formatting',()=>{
  const chart=new Polar(),axis=chart.getRadialAxis();assert.equal(axis.getNorth(),90);axis.setNorth(0).setClockwise(true).setTickFormattingFunction(radians=>`${Math.round(radians*180/Math.PI)} deg`);
  assert.equal(axis.getNorth(),0);assert.equal(axis.getClockwise(),true);assert.equal(axis.getTickFormattingFunction()(Math.PI/2),'90 deg');
  chart.getAmplitudeAxis().setInterval({start:-40,end:0});chart.renderNow();const r=chart.plot,center={x:r.left+r.width/2,y:r.top+r.height/2};
  const north=chart.projectPolarPoint({angle:0,amplitude:0}),east=chart.projectPolarPoint({angle:90,amplitude:0}),closure=chart.projectPolarPoint({angle:360,amplitude:0});
  assert.ok(Math.abs(north.x-center.x)<1e-10&&north.y<center.y);assert.ok(east.x>center.x&&Math.abs(east.y-center.y)<1e-10);assert.ok(Math.hypot(closure.x-north.x,closure.y-north.y)<1e-10);
  axis.setNorth(45).setClockwise(false);assert.equal(axis.getNorth(),45);const at45=chart.projectPolarPoint({angle:45,amplitude:0});assert.ok(Math.abs(at45.x-center.x)<1e-10&&at45.y<center.y);chart.dispose();
});

test('the original 3D endpoint style call controls actual marker shape, size and color',()=>{
  const chart=new Chart3D(),marker=chart.addPointSeries(),fill=new SolidFill({color:ColorRGBA(241,83,62)});
  marker.setPointStyle(new PointStyle3D.Triangulated({size:9,shape:'sphere',fillStyle:fill}));assert.equal(marker.getPointSize(),9);assert.equal(marker.getPointShape(),'sphere');assert.equal(marker.getPointFillStyle(),fill);
  marker.setPointStyle(previous=>previous.setSize(12));assert.equal(marker.getPointStyle().getSize(),12);assert.equal(marker.getPointStyle().getFillStyle(),fill);assert.equal(marker.getPointShape(),'sphere');
  assert.throws(()=>marker.setPointStyle(new PointStyle3D.Triangulated({size:NaN})),/nonnegative/);assert.equal(marker.getPointSize(),12);chart.dispose();
});
