import test from 'node:test';
import assert from 'node:assert/strict';
import {Polar} from '../src/chart';
import type {DrawPacketHeatmap} from '../src/render-heatmap';
import {SolidFill,ColorRGBA} from '../src/core/styles';

function near(a:number,b:number,tolerance=1e-9){assert.ok(Math.abs(a-b)<tolerance,`${a} != ${b}`);}
test('Polar data, inverse, and opaque cursor scale share the centered layout radius',()=>{
  const chart=new Polar();chart.resize(760,650);chart.getRadialAxis().setTitle('').setNorth(0).setClockwise(true);chart.getAmplitudeAxis().setTitle('Amplitude').setUnits('dB').setInterval({start:-30,end:-5});chart.renderNow();
  const layout=chart.getPolarLayout();assert.deepEqual(layout.center,{x:380,y:325});near(layout.plot.width,2*layout.dataRadius);
  for(const angle of[0,45,90,180,270])for(const amplitude of[-30,-20,-5]){
    const pixel=chart.projectPolarPoint({angle,amplitude}),expected=(amplitude+30)/25*layout.dataRadius;
    near(Math.hypot(pixel.x-layout.center.x,pixel.y-layout.center.y),expected);
    const client=chart.translateCoordinate({angle,amplitude},chart.coordsClient),back=chart.translateCoordinate(client,chart.coordsAxis);near(back.amplitude,amplitude);if(amplitude!==-30)near(back.angle,angle);
    const cursor=chart.getPolarCursorPosition({angle,amplitude},chart.getAmplitudeAxis()),cursorPixel=chart.translatePoint(cursor.pointMarker,cursor.pointMarkerScale,chart.coordsPixel);near(cursorPixel.x,pixel.x);near(cursorPixel.y,pixel.y);
  }
  assert.equal(layout.labels.find(l=>l.kind==='amplitude'&&l.fraction===1)?.visible,true);chart.dispose();
});

test('Polar labels adapt after resize without applying XY gutters or a second radius factor',()=>{
  const chart=new Polar();chart.getAmplitudeAxis().setInterval({start:-30,end:-5});chart.resize(900,650);const first=chart.getPolarLayout();chart.resize(900,450);const second=chart.getPolarLayout();
  near(first.center.x,450);near(second.center.x,450);near(first.dataRadius-second.dataRadius,100);assert.equal(first.labels.filter(l=>l.kind==='angle').length,12);chart.dispose();
});

test('Polar heatmap CPU hit and GPU packet use the same data circle',()=>{
  class Probe extends Polar{packets(){this.renderData([]);}}
  const chart=new Probe();chart.resize(760,650);chart.getAmplitudeAxis().setInterval({start:-30,end:-5});chart.getRadialAxis().setNorth(0).setClockwise(true);chart.renderNow();
  const heat=chart.addHeatmapSeries({sectors:8,annuli:2,amplitudeStart:-30,amplitudeEnd:-5});heat.invalidateIntensityValues([[1,2,3,4,5,6,7,8],[11,12,13,14,15,16,17,18]]);
  const offset={left:11,top:20};Object.defineProperty(chart,'overlay',{value:{getBoundingClientRect:()=>offset}});
  const pixel=chart.projectPolarPoint({angle:22.5,amplitude:-23.75}),hit=heat.solveNearestFromScreen({clientX:pixel.x+offset.left,clientY:pixel.y+offset.top});
  assert.equal(hit?.intensity,1);assert.equal(hit?.iSector,0);assert.equal(hit?.iAnnulus,0);
  const outside=chart.projectPolarPoint({angle:22.5,amplitude:0});assert.equal(heat.solveNearestFromScreen({clientX:outside.x+offset.left,clientY:outside.y+offset.top}),undefined);
  let packets:DrawPacketHeatmap[]=[];Object.defineProperty(chart,'renderer',{value:{gl:{},render(){},dispose(){}}});
  (chart as any).heatmapRenderer={render(values:DrawPacketHeatmap[]){packets=values;},getUploadedRevision(){return undefined;},dispose(){}};
  chart.packets();assert.equal(packets.length,1);assert.equal(packets[0]!.polar?.radiusFraction,.5);assert.deepEqual(packets[0]!.extent,[0,1,0,1]);chart.dispose();
});

test('Polar line clips to the circle while boundary markers retain their complete footprint',()=>{
  class Probe extends Polar{paint(ctx:CanvasRenderingContext2D){this.drawSpecial(ctx);}}
  const chart=new Probe();chart.resize(760,650);chart.getAmplitudeAxis().setInterval({start:-30,end:-5});chart.renderNow();
  chart.addPointLineSeries().setPointSize(12).setPointFillStyle(new SolidFill({color:ColorRGBA(255,0,0)})).setData([{angle:0,amplitude:-20},{angle:0,amplitude:-5},{angle:0,amplitude:0}]);
  chart.addPointSeries().setPointSize(12).setData([{angle:90,amplitude:-5},{angle:90,amplitude:0}]);
  let shape='',clip='',path:any[]=[];const stack:string[]=[],commands:any[]=[];
  const ctx={save(){stack.push(clip);},restore(){clip=stack.pop()!;},beginPath(){path=[];shape='';},arc(...args:any[]){shape='circle';path.push(args);},rect(){shape='rect';},clip(){clip=shape;},moveTo(){},lineTo(){},closePath(){},setLineDash(){},fill(){commands.push({operation:'fill',clip,path:[...path]});},stroke(){commands.push({operation:'stroke',clip,path:[...path]});}} as unknown as CanvasRenderingContext2D;
  chart.paint(ctx);const markers=commands.filter(c=>c.operation==='fill'&&c.path.some((p:any[])=>p[2]===6));
  assert.equal(markers.length,3);assert.ok(markers.every(c=>c.clip==='rect'));assert.ok(commands.some(c=>c.operation==='stroke'&&c.clip==='circle'));chart.dispose();
});
