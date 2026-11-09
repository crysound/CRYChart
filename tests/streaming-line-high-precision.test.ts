import test from 'node:test';
import assert from 'node:assert/strict';
import {ChartXY} from '../src/chart.js';
import {DataSetXY} from '../src/core/data.js';
import {SolidLine,SolidFill,ColorRGBA} from '../src/core/styles.js';
import {relativeProjectionPixelError} from '../src/streaming-line-policy.js';

const rect={left:0,top:0,width:463,height:119.55},dpr=1.75,count=262144;
function setup(base:number,step:number){
  const chart=new ChartXY({defaultAxisX:{type:'linear-highPrecision'}});
  const data=new DataSetXY({schema:{xValues:{storage:Float64Array,auto:true,pattern:'progressive'},yValues:{storage:Float32Array,pattern:null},renderYValues:{storage:Float32Array,autoX:true}}}).setMaxSampleCount(count);
  const values=Float32Array.from({length:count},(_,i)=>i%10007===0?NaN:i%997===0?1.125:i%991===0?-1.125:Math.sin(i*.019)*.7);
  data.appendSamples({yValues:values,renderYValues:values},{start:base,step});
  const series=chart.addPointLineAreaSeries({schema:data.schema}).setDataSet(data).setDataMapping({x:'xValues',y:'renderYValues'}).setStrokeStyle(new SolidLine({thickness:1,fillStyle:new SolidFill({color:ColorRGBA(30,200,170)})}));
  chart.axisX.setInterval({start:base,end:base+(count-1)*step,stopAxisAfter:true});chart.axisY.setInterval({start:-1.5,end:1.5,stopAxisAfter:true});
  return{chart,data,series};
}
for(const [name,base,step]of [['actual relative milliseconds',0,1000/48000],['epoch with original 48k batch step',1735721641000,1000/48000],['epoch with representable microsteps',1735721641000,1/4096]] as const){
  test(`high-precision ${name} uses a certified dense view without changing source or cursor`,()=>{
    const{chart,data,series}=setup(base,step);
    try{
      const before=data.readBack().data,packets=series.drawStreamingLinePackets(rect,rect,dpr),stats=series.getLineDisplayStats();
      assert.ok(stats,'linear-highPrecision must enter the dense pipeline when its projection is safe');
      assert.equal(stats.displaySelectionPolicy,'original-v4');assert.equal(stats.extremaNeighborsRetained,true);
      assert.ok(stats.submittedDisplaySamples<count/4);assert.ok(stats.largestSimplifiedPixelSpan<=.5);
      assert.equal(chart.axisX.type,'linear-highPrecision');
      const ys=packets.flatMap(p=>Array.from({length:p.count},(_,i)=>p.positions[i*2+1]!+p.origin.y));
      assert.ok(ys.includes(1.125));assert.ok(ys.includes(-1.125));assert.ok(ys.some(v=>!Number.isFinite(v)));
      assert.deepEqual(data.readBack().data,before);
      const hit=series.solveNearest({x:base+12345*step,y:0});assert.equal(hit.x,before.xValues![12345]);assert.equal(hit.y,before.renderYValues![12345]);
      const values=new Float32Array(137).fill(.3125);data.appendSamples({yValues:values,renderYValues:values},{start:base+count*step,step});
      chart.axisX.setInterval({start:base+137*step,end:base+(count+136)*step,stopAxisAfter:true});
      series.drawStreamingLinePackets(rect,rect,dpr);assert.ok(series.getLineDisplayStats());assert.equal(data.getSampleCount(),count);
      chart.axisX.setInterval({start:base+10000*step,end:base+10100*step,stopAxisAfter:true});
      const zoomPackets=series.drawStreamingLinePackets(rect,rect,dpr);assert.equal(series.getLineDisplayStats(),undefined,'sparse zoom keeps lossless source geometry');
      assert.ok(zoomPackets.length);assert.equal(series.getSampleCount(),count);
      series.setDataMapping({x:'xValues',y:'yValues'});assert.equal(series.getLineDisplayStats(),undefined);
    }finally{chart.dispose();data.dispose();}
  });
}

test('precision budget bounds actual Float32 shader arithmetic without re-adding an epoch',()=>{
  const pixels=rect.width*dpr;
  for(const [origin,start,span]of [[0,1000,60000],[1735721641000,1735721641000+.125,64],[1735721641000,1735721641000+.125,.0625]] as const){
    const end=start+span,magnitude=Math.max(Math.abs(start-origin),Math.abs(end-origin));
    const bound=relativeProjectionPixelError(origin,start,end,magnitude,pixels);
    assert.ok(bound<=.125,'representable near-origin windows qualify');
    for(let i=0;i<=64;i++){
      const raw=start+(end-start)*i/64,p=Math.fround(raw-origin),offset=Math.fround(start-origin),width=Math.fround(end-start);
      const clip=Math.fround(Math.fround(Math.fround(Math.fround(p-offset)/width)*2)-1);
      const error=Math.abs((clip+1)/2-(raw-start)/(end-start))*pixels;
      assert.ok(error<=bound,`GPU arithmetic ${error} must be bounded by ${bound}`);
    }
  }
  const origin=1735721641000,start=origin+1e8,end=start+.125;
  const bound=relativeProjectionPixelError(origin,start,end,1e8+.125,pixels);
  assert.ok(bound>.125,'long-lived origin with a narrow current window must reject');
  const raw=start+.0625,p=Math.fround(raw-origin),offset=Math.fround(start-origin),width=Math.fround(end-start);
  const clip=Math.fround(Math.fround(Math.fround(Math.fround(p-offset)/width)*2)-1);
  const error=Math.abs((clip+1)/2-(raw-start)/(end-start))*pixels;
  assert.ok(error>100,'the rejected old-origin input actually produces a large GPU error');
  assert.ok(error<=bound);
});

test('precision admission rejects FTZ/division domains and budgets rounded physical viewports',()=>{
  assert.equal(relativeProjectionPixelError(0,0,1e-40,1e-40,810),Infinity);
  assert.equal(relativeProjectionPixelError(0,0,2**127,2**127,810),Infinity);
  const fractional=relativeProjectionPixelError(0,0,60000,60000,463*1.75);
  assert.equal(fractional,relativeProjectionPixelError(0,0,60000,60000,Math.ceil(463*1.75)));
  assert.ok(fractional<=.125);
});
