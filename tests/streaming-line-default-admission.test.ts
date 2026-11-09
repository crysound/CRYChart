import test from 'node:test';
import assert from 'node:assert/strict';
import {ChartXY} from '../src/chart.js';
import {DataSetXY} from '../src/core/data.js';
import {SolidLine,DashedLine,SolidFill,ColorRGBA} from '../src/core/styles.js';

const rect={left:0,top:0,width:463,height:260},dpr=1.75,count=262144,base=1700000000000,step=.125;
const value=(i:number)=>i%10007===0?NaN:i%997===0?1.125:i%991===0?-1.125:.123456789012345+Math.sin(i*.019)*.7;
function setup(){
  const chart=new ChartXY();
  const data=new DataSetXY({schema:{xValues:{storage:Float64Array,pattern:'progressive',auto:true},yValues:{storage:Float64Array,pattern:null},renderYValues:{storage:Float64Array,autoX:true}}}).setMaxSampleCount(2880000);
  const values=Float64Array.from({length:count},(_,i)=>value(i));
  data.appendSamples({yValues:values,renderYValues:values},{start:base,step});
  const series=chart.addPointLineAreaSeries({schema:data.schema}).setDataSet(data).setDataMapping({x:'xValues',y:'renderYValues'});
  chart.axisX.setInterval({start:base,end:base+(count-1)*step,stopAxisAfter:true});
  chart.axisY.setInterval({start:-1.5,end:1.5,stopAxisAfter:true});
  return{chart,data,series};
}

test('ordinary default 1.5px line admits a dense not-yet-full F64 stream at DPR1.75',()=>{
  const{chart,data,series}=setup();
  try{
    assert.equal(series.getStrokeStyle().getThickness(),1.5);
    const packets=series.drawStreamingLinePackets(rect,rect,dpr),stats=series.getLineDisplayStats();
    assert.ok(stats,'ordinary default line must use the dense view without an application flag');
    assert.ok(stats.displayReduction);assert.equal(stats.sourceReduction,false);
    assert.ok(stats.submittedDisplaySamples<count/4);assert.ok(stats.largestSimplifiedPixelSpan<=.5);
    assert.ok(packets.every(packet=>packet.thickness===1.5));
    const projected=packets.flatMap(packet=>Array.from({length:packet.count},(_,i)=>packet.positions[i*2+1]!+packet.origin.y));
    assert.ok(projected.includes(1.125));assert.ok(projected.includes(-1.125));
    assert.ok(projected.some(y=>!Number.isFinite(y)),'NaN break remains in the rendered path');
    const raw=data.readBack().data;
    assert.ok(raw.xValues instanceof Float64Array);assert.ok(raw.renderYValues instanceof Float64Array);
    for(let i=0;i<count;i++){
      assert.equal(raw.xValues![i],base+i*step);assert.ok(Object.is(raw.yValues![i],value(i)));assert.ok(Object.is(raw.renderYValues![i],value(i)));
    }
    const hit=series.solveNearest({x:base+12345*step,y:0});
    assert.equal(hit.x,base+12345*step);assert.equal(hit.y,value(12345),'cursor resolves the full F64 source, not display vertices');
    assert.equal(series.getSampleCount(),count);assert.equal(data.getMaxSampleCount(),2880000);
  }finally{chart.dispose();data.dispose();}
});

test('fractional positive solid widths retain exact style and unchanged view reuses projected pages',()=>{
  const{chart,data,series}=setup();
  try{
    for(const thickness of [.75,2.5,3]){
      series.setStrokeStyle(new SolidLine({thickness,fillStyle:new SolidFill({color:ColorRGBA(30,200,170)})}));
      const packets=series.drawStreamingLinePackets(rect,rect,dpr);assert.ok(series.getLineDisplayStats());
      assert.ok(packets.every(packet=>packet.thickness===thickness));
      series.drawStreamingLinePackets(rect,rect,dpr);
      assert.equal(series.getLineDisplayStats()!.projectedSamplesThisUpdate,0);
    }
    series.drawPacket('line');assert.equal(series.getLineDisplayStats(),undefined,'public raw packet remains an exact source path');
  }finally{chart.dispose();data.dispose();}
});

test('transparent, dashed, area, nonmonotone and zoomed-in paths retain the original fallback',()=>{
  const{chart,data,series}=setup();
  const solid=(alpha=255)=>new SolidLine({thickness:1.5,fillStyle:new SolidFill({color:ColorRGBA(30,200,170,alpha)})});
  const fallback=()=>{series.drawStreamingLinePackets(rect,rect,dpr);assert.equal(series.getLineDisplayStats(),undefined);assert.equal(series.getSampleCount(),count);};
  try{
    series.setStrokeStyle(solid(128));fallback();
    series.setStrokeStyle(new DashedLine({thickness:1.5,pattern:[3,2]}));fallback();
    series.setStrokeStyle(solid()).setAreaFillStyle(new SolidFill({color:ColorRGBA(20,30,40)}));fallback();
    series.setAreaFillStyle(new SolidFill({color:ColorRGBA(0,0,0,0)}));
    chart.axisX.setInterval({start:base+200*step,end:base+300*step,stopAxisAfter:true});fallback();
    chart.axisX.setInterval({start:base,end:base+(count-1)*step,stopAxisAfter:true});
    const xs=Float64Array.from({length:count},(_,i)=>base+i*step);xs[128]=xs[127]!;
    const ys=Float64Array.from({length:count},(_,i)=>value(i));data.replaceSamples({xValues:xs,yValues:ys,renderYValues:ys});fallback();
  }finally{chart.dispose();data.dispose();}
});
