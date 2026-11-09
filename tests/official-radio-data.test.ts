import test from 'node:test';
import assert from 'node:assert/strict';
import {maxHeatmapProjection,aggregationColumn,radioSpectrum,spectrumRanges,RadioDetector,regionalSales,summarizeSales,drillingSample,drillingAlerts} from '../examples/official/radio-data.js';
import {sweepSegments} from '../examples/official/additional-dashboards.js';

test('MAX projection agrees with independent rectangle intersection over every source cell, including crop and zoom',()=>{
  const source=Float32Array.from({length:7*11},(_,i)=>(i*17)%53-26);source[3]=NaN;source[20]=0;source[72]=Infinity;
  const bytes=Buffer.from(source.buffer).toString('hex');
  for(const view of[{x0:0,x1:7,y0:0,y1:11},{x0:1.3,x1:5.8,y0:3.1,y1:8.2},{x0:-2,x1:9,y0:-3,y1:13}])for(const [width,height]of[[2,3],[4,7],[13,19]]){
    const result=maxHeatmapProjection(source,7,11,view,width,height);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const left=view.x0+(view.x1-view.x0)*x/width,right=view.x0+(view.x1-view.x0)*(x+1)/width,bottom=view.y0+(view.y1-view.y0)*y/height,top=view.y0+(view.y1-view.y0)*(y+1)/height;
      const relevant=[];for(let row=0;row<11;row++)for(let col=0;col<7;col++)if(col<right&&col+1>left&&row<top&&row+1>bottom&&Number.isFinite(source[row*7+col]))relevant.push(source[row*7+col]);
      assert.equal(result.values[y*width+x],relevant.length?Math.max(...relevant):NaN);
    }
  }
  assert.equal(Buffer.from(source.buffer).toString('hex'),bytes,'Projection must not rewrite retained raw data');
});

test('aggregation retains a one-bin peak that nearest center sampling misses',()=>{
  const source=new Float32Array(1024);source.fill(-100);source[17]=-2;source[501]=-6;
  const result=maxHeatmapProjection(source,1,1024,{x0:0,x1:1,y0:0,y1:1024},1,64);
  assert.equal(result.values[1],-2);assert.equal(result.values[31],-6);assert.equal(source[Math.floor(1.5*1024/64)],-100);
  const missing=maxHeatmapProjection(new Float32Array([NaN,NaN,0,-4]),2,2,{x0:0,x1:2,y0:0,y1:2},2,2);assert.deepEqual([...missing.values],[NaN,NaN,0,-4]);
  for(const dimensions of[[0,2],[2,0],[-1,2],[1.5,2]])assert.throws(()=>maxHeatmapProjection(source,1,1024,{x0:0,x1:1,y0:0,y1:1024},dimensions[0],dimensions[1]));
});

test('all synthetic aggregation columns retain the exact two narrow raw maxima',()=>{
  for(const index of[0,1,17,95,96,10000]){const column=aggregationColumn(index);assert.equal(column.length,1024);assert.equal(column[(index*37+17)%1024],-15);assert.equal(column[(index*53+501)%1024],-28);assert.equal(Math.max(...column),-15);}
});

test('spectrum temporal average and smoothing follow finite arithmetic before noise thresholding',()=>{
  const rows=[new Float32Array([-100,-100,-50,-50,-100,NaN]),new Float32Array([-102,-102,-54,-54,-102,NaN])];
  const result=spectrumRanges(rows,10,1);assert.deepEqual([...result.average],[-101,-101,-52,-52,-101,NaN]);
  assert.deepEqual([...result.smooth],[-101,-254/3,-205/3,-205/3,-153/2,-101]);
  const sorted=[...result.smooth].sort((a,b)=>a-b);assert.equal(result.noise,sorted[1]);assert.equal(result.threshold,sorted[1]+10);
  assert.deepEqual(result.ranges.map(r=>[r.startBin,r.endBin]),[[1,5]]);
  assert.throws(()=>spectrumRanges([new Float32Array(3),new Float32Array(4)]));
});

test('RF detector requires persistence, expires old occupied ranges, and owns its input history',()=>{
  const detector=new RadioDetector(3,3),noise=new Float32Array(64).fill(-100),signal=noise.slice();signal.fill(-45,20,29);
  assert.deepEqual(detector.push(noise).ranges,[]);assert.deepEqual(detector.push(signal).ranges,[]);assert.deepEqual(detector.push(signal).ranges,[]);
  const result=detector.push(signal);assert.equal(result.ranges.length,1);assert.ok(result.ranges[0].startBin<=20&&result.ranges[0].endBin>=29);assert.equal(result.ranges[0].frames,3);
  signal.fill(123);for(let i=0;i<3;i++)detector.push(noise);assert.deepEqual(detector.push(noise).ranges,[]);
  detector.clear();assert.deepEqual(detector.push(noise).ranges,[]);assert.equal(detector.push(noise).retainedRows,2);
});

test('RF original spectrum is deterministic and hopping/bursts change finite raw samples',()=>{
  const a=radioSpectrum(0),b=radioSpectrum(0),c=radioSpectrum(72);assert.deepEqual(a,b);assert.notDeepEqual(a,c);assert.equal(a.length,512);assert.ok([...a,...c].every(v=>Number.isFinite(v)&&v>-120&&v<-10));
  const d=new RadioDetector();let result;for(let i=0;i<12;i++)result=d.push(radioSpectrum(i));assert.ok(result!.ranges.some(r=>r.startBin<.18*512&&r.endBin>.18*512));
});

test('sales drill paths preserve independently accumulated totals, monthly dual series, and top five',()=>{
  const rows=regionalSales(),before=JSON.stringify(rows);assert.equal(rows.length,432);
  for(const path of[[],['Europe'],['Asia','Technology'],['Americas','Home','Home Premium'],['absent']]){
    const selected=rows.filter(r=>(!path[0]||r.region===path[0])&&(!path[1]||r.category===path[1])&&(!path[2]||r.subcategory===path[2])),r=summarizeSales(rows,path);
    const revenue=selected.reduce((s,v)=>s+v.revenue,0),orders=selected.reduce((s,v)=>s+v.orders,0),profit=selected.reduce((s,v)=>s+v.profit,0);
    assert.deepEqual(r.total,{revenue,orders,profit,aov:orders?revenue/orders:0});assert.equal(r.count,selected.length);assert.equal(r.monthly.reduce((s,v)=>s+v.revenue,0),revenue);assert.equal(r.categories.reduce((s,v)=>s+v.profit,0),profit);assert.ok(r.top.every((v,i)=>i===0||r.top[i-1].value>=v.value));assert.ok(r.top.length<=5);
  }assert.equal(JSON.stringify(rows),before);
});

test('drilling alarms are derived from actual torque, flow loss, and pressure rather than replay position labels',()=>{
  const normal=drillingSample(10),critical=drillingSample(55),recovered=drillingSample(65);assert.deepEqual(drillingAlerts(normal),[]);assert.deepEqual(drillingAlerts(critical),['HIGH TORQUE','FLOW LOSS','HIGH PRESSURE']);assert.deepEqual(drillingAlerts(recovered),[]);
  assert.deepEqual(drillingAlerts({...normal,torque:32,flowIn:2300,flowOut:2150,pressure:4000}),[]);assert.deepEqual(drillingAlerts({...normal,torque:32.01}),['HIGH TORQUE']);assert.deepEqual(drillingAlerts({...normal,flowIn:2300,flowOut:2149}),['FLOW LOSS']);
  assert.equal(critical.depth,3450+.009*55);assert.equal(critical.north,.19*55);
});

test('sweep segments never duplicate an index or connect across a ring wrap',()=>{
  for(const next of[0,1,1000,4999,5000,5001,5089,5090,9999,10000,2712345]){const r=sweepSegments(next,5000,90),seen=new Set<number>();for(const section of[r.previous,r.current]){let prior=-1;for(let i=section.start;i<section.end;i++){assert.ok(i>=Math.max(0,next-5000)&&i<next);assert.ok(!seen.has(i));seen.add(i);if(prior>=0)assert.equal(i%5000,prior%5000+1);prior=i;}}assert.equal(r.phase,next%5000);assert.ok(seen.size<=5000);assert.equal(seen.size,Math.min(next,5000-90));for(let slot=0;slot<5000;slot++){const latest=slot+5000*Math.floor((next-1-slot)/5000),outsideGap=(slot-r.phase+5000)%5000>=90;assert.equal(seen.has(latest),latest>=0&&outsideGap);}}
});
