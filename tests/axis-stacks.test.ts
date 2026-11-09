import test from 'node:test';
import assert from 'node:assert/strict';
import {ChartXY} from '../src/chart';
import type {DrawPacket} from '../src/contracts';
class Capture extends ChartXY {packets:DrawPacket[]=[];protected override renderData(packets:DrawPacket[]){this.packets=packets;}}
const close=(a:number,b:number)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);

test('128 axis stacks share one plot and retain exact ordering, data counts, screen coordinates and clipping',()=>{
 const chart=new Capture();chart.getDefaultAxisY().dispose();chart.getDefaultAxisX().setInterval({start:0,end:2});
 const series=Array.from({length:128},(_,i)=>{const axis=chart.addAxisY({iStack:-i}).setInterval({start:-2,end:2}).setTitleRotation(0);return chart.addLineSeries({axisY:axis}).add([{x:0,y:0},{x:1,y:1},{x:2,y:0}]);});chart.renderNow();assert.equal(chart.packets.length,128);assert.ok(chart.plot.width>600);
 series.forEach((s,i)=>{const r=chart.getSeriesScreenRect(s);close(r.height,chart.plot.height/128);close(r.top,chart.plot.top+i*chart.plot.height/128);assert.equal(s.getSampleCount(),3);const p=chart.translatePoint({x:1,y:0},{x:s.axisX,y:s.axisY},chart.coordsPixel);close(p.y!,r.top+r.height/2);const restored=chart.translatePoint(p,chart.coordsPixel,{x:s.axisX,y:s.axisY});close(restored.x!,1);close(restored.y!,0);const packet=chart.packets[i],renderFraction=(0-packet.domain.y.start)/(packet.domain.y.end-packet.domain.y.start);close(renderFraction,s.axisY.valueToScreenFraction(0));assert.deepEqual(packet.clipRect,r);});chart.dispose();
});
test('relative and fixed stack sizes match public black-box proportions and parallel groups remain independent',()=>{
 const chart=new Capture();chart.getDefaultAxisY().dispose();const axes=[0,-1,-2].map(iStack=>chart.addAxisY({iStack}).setInterval({start:-1,end:1}));axes[0].setLength({relative:2});chart.renderNow();close(axes[0].getScreenRange().end-axes[0].getScreenRange().start,.5);close(axes[1].getScreenRange().end-axes[1].getScreenRange().start,.25);
 axes[0].setLength({pixels:150});chart.renderNow();close((axes[0].getScreenRange().end-axes[0].getScreenRange().start)*chart.plot.height,150);
 const parallel=chart.addAxisY({iParallel:1,iStack:-1}).setInterval({start:0,end:100});chart.renderNow();assert.deepEqual(parallel.getScreenRange(),{start:0,end:1});assert.equal(parallel.parallelLane,1);assert.equal(axes[1].parallelLane,0);chart.dispose();
});
test('stack transforms preserve logarithms, inversion and automatic independent parallel axes',()=>{
 const chart=new Capture();chart.getDefaultAxisY().dispose();const top=chart.addAxisY({iStack:0,type:'logarithmic'}).setInterval({start:1,end:100}).setInverted(true),bottom=chart.addAxisY({iStack:-1}).setInterval({start:-1,end:1});chart.getDefaultAxisX().setInterval({start:0,end:1});const series=chart.addLineSeries({axisY:top}).add([{x:0,y:1},{x:1,y:100}]);chart.renderNow();close(top.valueToFraction(10),.5);close(top.valueToScreenFraction(10),.75);close(top.screenFractionToValue(.75),10);const packet=chart.packets[0];close((Math.log10(10)-packet.domain.y.start)/(packet.domain.y.end-packet.domain.y.start),.75);bottom.dispose();chart.renderNow();assert.deepEqual(top.getScreenRange(),{start:0,end:1});series.dispose();chart.dispose();
 const ordinary=new ChartXY(),second=ordinary.addAxisY();ordinary.renderNow();assert.equal(second.iParallel,1);assert.deepEqual(second.getScreenRange(),{start:0,end:1});assert.deepEqual(ordinary.getDefaultAxisY().getScreenRange(),{start:0,end:1});ordinary.dispose();
});
test('client/event coordinate overloads account for DOM offset and preserve the selected stacked axes',()=>{
 const chart=new ChartXY();chart.getDefaultAxisY().dispose();chart.getDefaultAxisX().setInterval({start:100,end:200});chart.addAxisY({iStack:0}).setInterval({start:0,end:10});const lower=chart.addAxisY({iStack:-1}).setInterval({start:-20,end:20});chart.renderNow();Object.assign(chart,{overlay:{getBoundingClientRect:()=>({left:37,top:91})}});
 const axes={x:chart.getDefaultAxisX(),y:lower},client=chart.translateCoordinate({x:150,y:0},axes,chart.coordsClient),r=chart.getSeriesScreenRect({axisX:axes.x,axisY:lower});close(client.clientX,37+r.left+r.width/2);close(client.clientY,91+r.top+r.height/2);
 const point=chart.translateCoordinate({clientX:client.clientX,clientY:client.clientY},axes);close(point.x,150);close(point.y,0);const relative=chart.translateCoordinate({x:150,y:0},axes,chart.coordsRelative);close(relative.x,r.left+r.width/2);close(relative.y,chart.height-(r.top+r.height/2));const restored=chart.translateCoordinate(relative,chart.coordsRelative,axes);close(restored.x,150);close(restored.y,0);chart.dispose();
});
