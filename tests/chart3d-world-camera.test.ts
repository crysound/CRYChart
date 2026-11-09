import test from 'node:test';
import assert from 'node:assert/strict';
import {Chart3D} from '../src/chart.js';
import {orbitWorldCamera3D} from '../src/world-camera.js';

const near=(a:number,b:number,t=2e-10)=>assert.ok(Math.abs(a-b)<=t,`${a} != ${b}`);
test('manual world projection follows independent whole-control perspective and orthographic equations',()=>{
  const chart=new Chart3D(),fixture=chart as any,oldOverlay=fixture.overlay;
  try{
    fixture.width=1060;fixture.height=620;fixture.plot={left:66,top:52,width:972,height:515};
    fixture.overlay={getBoundingClientRect:()=>({left:123.25,top:67.5})};
    chart.setCameraAutomaticFittingEnabled(false).setCameraLocation({x:0,y:0,z:2});
    const point={x:.2,y:.1,z:.3};
    for(const projection of ['perspective','orthographic'] as const){
      chart.setProjection(projection);
      // Independent look-at camera at (0,0,2), forward -Z, FOV45deg. No use of
      // the implementation's matrix/project helper to calculate expected pixels.
      const factor=projection==='perspective'?620/(2*Math.tan(Math.PI/8))/(2-point.z):1060/2;
      const x=530+point.x*factor,y=310-point.y*factor;
      const pixel=chart.translateCoordinate(point,chart.coordsWorld,chart.coordsPixel),client=chart.translateCoordinate(point,chart.coordsWorld,chart.coordsClient);
      near(pixel.x,x);near(pixel.y,y);near(client.clientX,x+123.25);near(client.clientY,y+67.5);
    }
    const before=chart.getCameraLocation();assert.throws(()=>chart.setCameraLocation({x:0,y:0,z:0}),RangeError);assert.deepEqual(chart.getCameraLocation(),before);
  }finally{fixture.overlay=oldOverlay;chart.dispose();}
});

test('local-basis rotation retains frozen public one-event coordinates rather than global-Y yaw',()=>{
  // These fixed coordinates guard the local-basis rotation convention.
  const result=orbitWorldCamera3D({x:.8,y:.6,z:1.8},10,-5);
  near(result.x,.7331290046543905,2e-13);near(result.y,.5708954390934571,2e-13);near(result.z,1.8375527911210474,2e-13);
  const horizontal=orbitWorldCamera3D({x:.8,y:.6,z:1.8},10,0);
  near(horizontal.y,.5995873074578338,2e-13);assert.notEqual(horizontal.y,.6);
});

test('requested interval remains public while an explicit equal request updates 3D geometry margins',()=>{
  // Public line-width observations: unit-box maxX at widths0/2/8.
  const chart=new Chart3D();
  try{
    chart.axisX.setInterval({start:0,end:1});let events=0;chart.axisX.onIntervalChange(()=>events++);
    const series=chart.addLineSeries().setStrokeStyle(style=>style.setThickness(2)).add([{x:0,y:0,z:0},{x:1,y:1,z:1}]);
    const x=()=>chart.translateCoordinate({x:1,y:1,z:1},chart.coordsAxis,chart.coordsWorld).x;
    near(x(),.2886751345948129,2e-14);chart.axisX.setInterval({start:0,end:1});near(x(),.28668889566180467,2e-14);
    series.setStrokeStyle(style=>style.setThickness(8));near(x(),.28668889566180467,2e-14);
    chart.axisX.setInterval({start:0,end:1});near(x(),.28089085877435155,2e-14);
    assert.deepEqual(chart.axisX.getInterval(),{start:0,end:1});assert.equal(events,0);
    chart.axisX.setScrollMargins(false).setInterval({start:0,end:1});near(x(),.2886751345948129,2e-14);
  }finally{chart.dispose();}
});
