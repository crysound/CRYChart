import test from 'node:test';
import assert from 'node:assert/strict';
import {ChartXY} from '../src/chart.js';
import {DataSetXY} from '../src/core/data.js';
import {SolidLine, SolidFill, ColorRGBA} from '../src/core/styles.js';

const rect = {left: 100, top: 80, width: 800, height: 420};
function setup() {
  const chart = new ChartXY({experimentalLineDisplayPixels: 1});
  chart.getDefaultAxisX().setInterval({start: 0, end: 1000});
  chart.getDefaultAxisY().setInterval({start: -1.5, end: 1.5});
  const data = new DataSetXY({schema: {x: {storage: Float64Array, auto: true, pattern: 'progressive'}, y: {storage: Float64Array}}});
  data.setMaxSampleCount(48000);
  data.appendSamples({y: Float64Array.from({length: 48000}, (_,i) => i % 997 ? Math.sin(i * .017) : NaN)}, {start: 0, step: 1000 / 48000});
  const series = chart.addLineSeries({schema: data.schema}).setDataSet(data).setDataMapping({x:'x',y:'y'});
  series.setStrokeStyle(new SolidLine({thickness:2,fillStyle:new SolidFill({color:ColorRGBA(30,200,170,255)})}));
  return {chart,data,series};
}

test('display integration keeps complete raw readback and bounds while publishing reduced diagnostic packets', () => {
  const {chart,data,series} = setup(), before = data.readBack();
  const packets = series.drawLineDisplayPackets(rect,rect,1,1), stats=series.getLineDisplayStats()!;
  assert.equal(packets.length,1); assert.equal(stats.retainedSourceSamples,48000); assert.ok(stats.submittedDisplaySamples<10000);
  assert.equal(series.getSampleCount(),48000); assert.deepEqual(data.readBack(),before);
  assert.ok(series.getXYProjectionStorageBytes()>0); assert.equal(series.getLineBlockStats(),undefined);
  assert.ok(series.bounds('y')!.start<-0.99&&series.bounds('y')!.end>0.99);
  chart.dispose(); assert.equal(data.getSampleCount(),48000); data.dispose();
});

test('display caches release on hide, remapping, external clear, fallback and series disposal', () => {
  const {chart,data,series} = setup();
  const prepare=()=>{series.drawLineDisplayPackets(rect);assert.ok(series.getLineDisplayStats());};
  prepare();series.setVisible(false);assert.equal(series.getLineDisplayStats(),undefined);series.setVisible(true);
  prepare();series.setDataMapping({x:'x',y:'y'});assert.equal(series.getLineDisplayStats(),undefined);
  prepare();series.drawLinePackets(rect);assert.equal(series.getLineDisplayStats(),undefined);
  prepare();data.clear();assert.equal(series.getLineDisplayStats(),undefined);assert.equal(series.getSampleCount(),0);
  data.appendSamples({y:new Float64Array(48000).fill(.2)},{start:0,step:1000/48000});prepare();
  series.dispose();assert.equal(series.getLineDisplayStats(),undefined);assert.equal(series.getXYProjectionStorageBytes(),0);assert.equal(data.getSampleCount(),48000);
  chart.dispose();data.dispose();
});

test('display options reject invalid pixel limits and sparse source falls back without fabricated reduction', () => {
  for(const value of [0,-1,NaN,Infinity,5])assert.throws(()=>new ChartXY({experimentalLineDisplayPixels:value}),RangeError);
  const chart=new ChartXY(),series=chart.addLineSeries();series.addArraysXY([0,1,2],[1,2,1]);
  const packets=series.drawLineDisplayPackets(rect);assert.equal(packets[0]!.count,3);assert.equal(series.getLineDisplayStats(),undefined);chart.dispose();
});

test('dense bounded stream view keeps raw precision, spikes and gaps through wrap and zoom', () => {
  const chart=new ChartXY(),count=262144,base=1700000000000,step=.125;
  const data=new DataSetXY({schema:{x:{storage:Float64Array,auto:true},y:{storage:Float64Array}}}).setMaxSampleCount(count);
  const value=(i:number)=>i%10007===0?NaN:i%997===0?1.2:i%991===0?-1.2:.7*Math.sin(i*.019);
  data.appendSamples({y:Float64Array.from({length:count},(_,i)=>value(i))},{start:base,step});
  const series=chart.addLineSeries({schema:data.schema}).setDataSet(data).setDataMapping({x:'x',y:'y'});
  series.setStrokeStyle(new SolidLine({thickness:2,fillStyle:new SolidFill({color:ColorRGBA(30,200,170,255)})}));
  chart.getDefaultAxisY().setInterval({start:-1.5,end:1.5,stopAxisAfter:true});
  const prepare=()=>{
    const first=data.getNextSampleIndex()-count;
    chart.getDefaultAxisX().setInterval({start:base+first*step,end:base+(first+count-1)*step,stopAxisAfter:true});
    const packets=series.drawStreamingLinePackets(rect,rect,1),stats=series.getLineDisplayStats()!;
    assert.ok(stats&&stats.displayReduction);assert.equal(stats.retainedSourceSamples,count);assert.equal(stats.sourceReduction,false);
    const projected=packets.flatMap(p=>Array.from({length:p.count},(_,i)=>p.positions[i*2+1]!+p.origin.y));
    assert.ok(projected.some(v=>Math.abs(v-1.2)<1e-6));assert.ok(projected.some(v=>Math.abs(v+1.2)<1e-6));
    assert.ok(projected.some(v=>!Number.isFinite(v)),'source gaps survive view preparation');
    const raw=data.readBack().data;
    for(let i=0;i<count;i++){assert.ok(Object.is(raw.y![i],value(first+i)));assert.equal(data.getValue('x',i),base+(first+i)*step);}
    assert.deepEqual(series.bounds('y'),{start:-1.2,end:1.2});
  };
  prepare();data.appendSamples({y:Float64Array.from({length:137},(_,i)=>value(count+i))},{start:base+count*step,step});prepare();
  chart.getDefaultAxisX().setInterval({start:base+200*step,end:base+300*step,stopAxisAfter:true});
  series.drawStreamingLinePackets(rect);assert.equal(series.getLineDisplayStats(),undefined,'zoom restores exact source blocks');
  series.dispose();assert.equal(series.getXYProjectionStorageBytes(),0);assert.equal(data.getSampleCount(),count);chart.dispose();data.dispose();
});

test('automatic dense view excludes transparent strokes, areas and unbounded retention', () => {
  const chart=new ChartXY(),count=262144;
  const data=new DataSetXY({schema:{x:{storage:Float64Array,auto:true},y:{storage:Float64Array}}});
  data.appendSamples({y:new Float64Array(count).fill(.25)},{start:0,step:1});
  const series=chart.addLineSeries({schema:data.schema}).setDataSet(data).setDataMapping({x:'x',y:'y'});
  chart.getDefaultAxisX().setInterval({start:0,end:count,stopAxisAfter:true});chart.getDefaultAxisY().setInterval({start:-1,end:1,stopAxisAfter:true});
  const style=(alpha:number)=>new SolidLine({thickness:2,fillStyle:new SolidFill({color:ColorRGBA(30,200,170,alpha)})});
  series.setStrokeStyle(style(255));series.drawStreamingLinePackets(rect);assert.equal(series.getLineDisplayStats(),undefined);
  data.setMaxSampleCount(count);
  series.setStrokeStyle(style(128));series.drawStreamingLinePackets(rect);assert.equal(series.getLineDisplayStats(),undefined);
  series.setStrokeStyle(style(255)).setAreaFillStyle(new SolidFill({color:ColorRGBA(20,30,40,255)}));
  series.drawStreamingLinePackets(rect);assert.equal(series.getLineDisplayStats(),undefined);
  chart.dispose();data.dispose();
});

test('explicit display view preserves ordinary translucent raster and complete source geometry',()=>{
 const{chart,data,series}=setup();
 try{
  const before=data.readBack();series.drawLineDisplayPackets(rect);assert.ok(series.getLineDisplayStats());
  series.setStrokeStyle(new SolidLine({thickness:2,fillStyle:new SolidFill({color:ColorRGBA(30,200,170,128)})}));
  const packets=series.drawLineDisplayPackets(rect);
  assert.equal(series.getLineDisplayStats(),undefined);assert.equal(series.getLineBlockStats(),undefined);
  assert.equal(packets.length,1);assert.equal(packets[0].count,data.getSampleCount());
  assert.deepEqual(data.readBack(),before);
 }finally{chart.dispose();data.dispose();}
});

// Real Monitor retention and sample spacing. The first projection origin stays
// behind the rolling window until the tail crosses Float32's 2^16-ms boundary.
test('192kHz 60-second rolling waveform keeps display reduction across Float32 origin drift', () => {
  const count = 192000 * 60, batch = 192000 * 6, step = 1000 / 192000;
  const chart = new ChartXY({experimentalLineDisplayPixels: 1, experimentalLineDisplayPackets: true, experimentalLineCoverage: true});
  const data = new DataSetXY({schema: {x: {storage: Float64Array, auto: true, pattern: 'progressive'}, y: {storage: Float64Array}}});
  data.setMaxSampleCount(count);
  // Isolated peaks retain adjacent samples, including those that collide in
  // Float32. Constant data would omit the close neighbors and miss this bug.
  const values = (length: number, first = 0) => Float64Array.from({length}, (_, i) => (i + first) % 997 === 0 ? 1 : 0);
  data.appendSamples({y: values(count)}, {start: 1811059, step});
  const series = chart.addLineSeries({schema: data.schema}).setDataSet(data).setDataMapping({x: 'x', y: 'y'});
  series.setStrokeStyle(new SolidLine({thickness: 1, fillStyle: new SolidFill({color: ColorRGBA(30, 200, 170, 255)})}));
  chart.getDefaultAxisY().setInterval({start: -0.2, end: 1.2});
  try {
    let previousOrigin: number | undefined, originChanges = 0;
    for (let pass = 0; pass <= 7; pass++) {
      if (pass) data.appendSamples({y: values(batch, data.getNextSampleIndex())});
      chart.getDefaultAxisX().setInterval({start: data.getValue('x', 0)!, end: data.getValue('x', count - 1)!});
      const packets = series.drawLineDisplayPackets(rect, rect, 1.5, 1, true);
      const stats = series.getLineDisplayStats();
      assert.ok(stats, `pass ${pass}: display cache must not fall back to all ${count} raw samples`);
      assert.equal(series.getLineBlockStats(), undefined);
      assert.equal(data.getSampleCount(), count);
      assert.ok(stats.submittedDisplaySamples < 100000);
      if (pass) assert.ok(stats.sourceSamplesScannedThisUpdate <= batch + 32, 'old summary pages must survive a projection rebase');
      const origin = packets[0]!.origin.x;
      if (previousOrigin !== undefined && previousOrigin !== origin) originChanges++;
      previousOrigin = origin;
      for (const packet of packets) {
        assert.ok(packet.strictlyMonotonicX);
        for (let i = 1; i < packet.count; i++) assert.ok(packet.positions[i * 2]! > packet.positions[(i - 1) * 2]!);
      }
    }
    assert.ok(originChanges >= 2, 'exercise repeated origin recovery, not just initial projection');
  } finally {chart.dispose(); data.dispose();}
});
