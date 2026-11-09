import test from 'node:test';
import assert from 'node:assert/strict';
import {ChartXY,Chart3D,Polar} from '../src/chart';
import {SolidLine,SolidFill,ColorRGBA} from '../src/core/styles';
function scene(){
 const chart=new ChartXY().setTitle('');chart.resize(1000,600);
 const points=chart.addPointSeries().setPointSize(12).setPointStrokeStyle(new SolidLine({thickness:2,fillStyle:new SolidFill({color:ColorRGBA(255,255,255)})}));
 points.add([{x:0,y:-6},{x:10,y:6}]);const x=chart.getDefaultAxisX(),y=chart.getDefaultAxisY();x.fit(false,false);y.fit(false,false);chart.renderNow();
 return{chart,points,x,y};
}
function inset(chart:ChartXY,x:number,y:number){
 const p=chart.translateCoordinate({x,y},chart.coordsAxis,chart.coordsPixel);
 return{left:p.x-chart.plot.left,right:chart.plot.left+chart.plot.width-p.x,top:p.y-chart.plot.top,bottom:chart.plot.top+chart.plot.height-p.y,p};
}
test('automatic raw XY fit retains actual point geometry in both public projection and render packet domain',()=>{
 const{chart,points,x,y}=scene();try{
  const low=inset(chart,0,-6),high=inset(chart,10,6);
  assert.ok(low.left>=7-1e-9&&low.bottom>=7-1e-9&&high.right>=7-1e-9&&high.top>=7-1e-9,'Actual point radius6+outline halfwidth1 must remain inside the unchanged physical viewport');
  assert.deepEqual(x.getInterval(),{start:0,end:10});assert.deepEqual(y.getInterval(),{start:-6,end:6});
  const back=chart.translateCoordinate(high.p,chart.coordsPixel,chart.coordsAxis);assert.ok(Math.abs(back.x-10)<1e-12&&Math.abs(back.y-6)<1e-12);
  const packet=points.drawPacket('points');assert.ok(packet.domain!.x.start<0&&packet.domain!.x.end>10&&packet.domain!.y.start< -6&&packet.domain!.y.end>6,'The real GPU packet must use the same effective domain, not just change the public getter');
  assert.deepEqual(packet.domain!.x,x.getRenderInterval());assert.deepEqual(packet.domain!.y,y.getRenderInterval());
 }finally{chart.dispose();}
});
test('dynamic constant marker size, resize, hidden state and external clear refresh automatic geometry without stale data bounds',()=>{
 const{chart,points,x,y}=scene();try{
  points.setPointSize(20);x.fit(false,false);y.fit(false,false);chart.resize(620,450);chart.renderNow();
  const high=inset(chart,10,6);assert.ok(high.right>=11-1e-9&&high.top>=11-1e-9);
  x.setInverted(true);y.setInverted(true);chart.renderNow();const p=inset(chart,10,6);const back=chart.translateCoordinate(p.p,chart.coordsPixel,chart.coordsAxis);assert.ok(Math.abs(back.x-10)<1e-12&&Math.abs(back.y-6)<1e-12);
  x.setInverted(false);y.setInverted(false);points.setVisible(false);chart.renderNow();assert.deepEqual(x.getRenderInterval(),x.getInterval());
  points.setVisible(true);x.fit(false,false);y.fit(false,false);chart.renderNow();assert.ok(inset(chart,10,6).right>=11-1e-9);
  points.getDataSet().clear();chart.renderNow();assert.deepEqual(x.getRenderInterval(),x.getInterval());assert.deepEqual(y.getRenderInterval(),y.getInterval());
 }finally{chart.dispose();}
});
test('explicit interval/default and existing false/true/custom scroll margins never receive the new automatic geometry layer twice',()=>{
 for(const mode of['interval','default','false','true','custom']as const){const{chart,x}=scene();try{
  if(mode==='interval')x.setInterval({start:0,end:10,stopAxisAfter:true});
  if(mode==='default')x.setDefaultInterval({start:0,end:10});
  if(mode==='false')x.setScrollMargins(false);
  if(mode==='true')x.setScrollMargins(true);
  if(mode==='custom')x.setScrollMargins({start:10,end:20});
  if(mode!=='interval'&&mode!=='default')x.fit(false,false);chart.renderNow();
  assert.deepEqual(x.getRenderInterval(),x.getInterval(),mode+' keeps its established raw configuration behavior');
  assert.equal(x.valueToFraction(x.getInterval().start),0);assert.equal(x.valueToFraction(x.getInterval().end),1);
 }finally{chart.dispose();}}
});
test('Polar and world3D retain their independent coordinate policies without the XY geometry layer',()=>{
 const polar=new Polar(),world=new Chart3D({cameraModel:'world'});
 try{
  const radial=polar.addLineSeries();radial.add([{x:0,y:1},{x:90,y:3}]);polar.renderNow();
  const points=world.addPointSeries().setPointSize(12);points.add([{x:0,y:1,z:2},{x:10,y:11,z:12}]);world.getDefaultAxisX().fit(false,false);world.renderNow();
  for(const axis of[polar.getAmplitudeAxis(),world.getDefaultAxisX(),world.getDefaultAxisY()])assert.deepEqual(axis.getRenderInterval(),axis.getInterval());
 }finally{polar.dispose();world.dispose();}
});
