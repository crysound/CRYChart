import test from 'node:test';
import assert from 'node:assert/strict';
import {Chart3D,ChartXY,Polar} from '../src/chart.js';
import {Axis} from '../src/axis.js';

const near=(actual:number,expected:number,tolerance=1e-12)=>assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} != ${expected}`);
const axes=(chart:Chart3D)=>[chart.axisX,chart.axisY,chart.axisZ];
function addBounds(chart:Chart3D,bounds:readonly(readonly[number,number])[]){
  return chart.addLineSeries().add([{x:bounds[0]![0],y:bounds[1]![0],z:bounds[2]![0]},{x:bounds[0]![1],y:bounds[1]![1],z:bounds[2]![1]}]);
}
const observations=[
  [[-5.235498326714536,5.087145143173758],[-4.230661939423552,4.212271724641794],[-2.726503382412921,2.4180506621556326]],
  [[-5.26886936344257,5.2861149424752005],[-4.06288946838822,4.192243551862022],[-2.6383803661062917,2.6612474737185945]],
] as const;

test('default world3D fit preserves frozen initial/replacement extrema exactly',()=>{
  // Frozen expectations do not call the production projection or margin helper.
  const chart=new Chart3D();try{
    const line=addBounds(chart,observations[0]);
    for(const bounds of observations){
      line.clear().add([{x:bounds[0][0],y:bounds[1][0],z:bounds[2][0]},{x:bounds[0][1],y:bounds[1][1],z:bounds[2][1]}]);
      axes(chart).forEach((axis,i)=>{axis.fit(false,false);assert.deepEqual(axis.getInterval(),{start:bounds[i]![0],end:bounds[i]![1]});assert.equal(axis.getStopped(),false);});
      axes(chart).forEach(axis=>axis.fit(false,true));assert.ok(axes(chart).every(axis=>axis.getStopped()));
    }
  }finally{chart.dispose();}
});

test('world3D retains effective geometry margin independently of public raw fit bounds',()=>{
  const chart=new Chart3D();try{
    const line=addBounds(chart,[[0,1],[0,1],[0,1]]).setStrokeStyle((style:import('../src/core/styles.js').SolidLine)=>style.setThickness(2));
    axes(chart).forEach(axis=>axis.fit(false,false));
    assert.deepEqual(chart.axisX.getInterval(),{start:0,end:1});
    near(chart.translateCoordinate({x:1,y:1,z:1},chart.coordsAxis,chart.coordsWorld).x,.28668889566180467,2e-14);
    line.setStrokeStyle((style:import('../src/core/styles.js').SolidLine)=>style.setThickness(8));chart.axisX.fit(false,false);
    near(chart.translateCoordinate({x:1,y:1,z:1},chart.coordsAxis,chart.coordsWorld).x,.28089085877435155,2e-14);
    chart.axisX.setScrollMargins(false).fit(false,false);
    near(chart.translateCoordinate({x:1,y:1,z:1},chart.coordsAxis,chart.coordsWorld).x,.2886751345948129,2e-14);
    assert.deepEqual(chart.axisX.getInterval(),{start:0,end:1});
  }finally{chart.dispose();}
});

test('explicit fractional fit margins include explicit legacy 0.05 and asymmetric settings',()=>{
  const chart=new Chart3D();try{
    addBounds(chart,[[10,20],[10,20],[10,20]]);
    chart.axisX.setMargins(.05).fit(false,false);assert.deepEqual(chart.axisX.getInterval(),{start:9.5,end:20.5});
    chart.axisY.setMargins({start:.1,end:.2}).fit(false,false);assert.deepEqual(chart.axisY.getInterval(),{start:9,end:22});
    chart.axisZ.margins={start:.3,end:.4};chart.axisZ.fit(false,false);assert.deepEqual(chart.axisZ.getInterval(),{start:7,end:24});
  }finally{chart.dispose();}
});

test('explicit pixel scroll margins retain their existing arithmetic',()=>{
  const chart=new Chart3D();try{
    (chart as any).plot={left:0,top:0,width:200,height:100};addBounds(chart,[[10,20],[10,20],[10,20]]);
    chart.axisX.setScrollMargins({start:10,end:20}).fit(false,false);
    near(chart.axisX.getInterval().start,10-10/.85*.05);near(chart.axisX.getInterval().end,20+10/.85*.1);
    chart.axisY.setScrollMargins(false).fit(false,false);assert.deepEqual(chart.axisY.getInterval(),{start:10,end:20});
  }finally{chart.dispose();}
});

test('XY defaults use raw bounds while explicit legacy 5 percent margins keep the original padded interval',()=>{
  const chart=new ChartXY();try{
    chart.addLineSeries().add([{x:10,y:0},{x:20,y:1}]);
    chart.axisX.fit(false,false);assert.deepEqual(chart.axisX.getInterval(),{start:10,end:20});
    // Preserve the old XY padded expectation for an explicitly requested
    // legacy margin, separately from the newly observed Native default policy.
    chart.axisX.setMargins(.05).fit(false,false);assert.deepEqual(chart.axisX.getInterval(),{start:9.5,end:20.5});
  }finally{chart.dispose();}
});

for(const [name,create] of[
  ['Polar',()=>new Polar()],
  ['explicit legacy3D',()=>new Chart3D({experimental3DCameraModel:'legacy'})],
] as const)test(`${name} keeps the original default 5 percent fit policy`,()=>{
  const chart=create();try{
    // An Axis attached to each real host isolates the policy from series-specific
    // radial bounds. No mocked new-world callback supplies expected values.
    const axis=new Axis(chart,'x');const original=chart.boundsFor;
    chart.boundsFor=()=>({start:10,end:20});try{axis.fit(false,false);assert.deepEqual(axis.getInterval(),{start:9.5,end:20.5});}finally{chart.boundsFor=original;axis.dispose();}
  }finally{chart.dispose();}
});

test('switching into explicit angular legacy mode restores original default fit arithmetic',()=>{
  const chart=new Chart3D();try{
    addBounds(chart,[[10,20],[10,20],[10,20]]);chart.axisX.fit(false,false);assert.deepEqual(chart.axisX.getInterval(),{start:10,end:20});
    chart.setCameraLocation({azimuth:30,elevation:20});chart.axisX.fit(false,false);assert.deepEqual(chart.axisX.getInterval(),{start:9.5,end:20.5});
  }finally{chart.dispose();}
});

test('degenerate, logarithmic and explicit default interval safety policies are unchanged',()=>{
  const world=new Chart3D(),legacy=new Chart3D({experimental3DCameraModel:'legacy'});
  try{
    for(const chart of[world,legacy]){
      addBounds(chart,[[10,10],[0,0],[1,1]]);chart.axisX.fit(false,false);chart.axisY.fit(false,false);
      assert.deepEqual(chart.axisX.getInterval(),{start:9.45,end:10.55});assert.deepEqual(chart.axisY.getInterval(),{start:-1.1,end:1.1});
      chart.axisZ.setDefaultInterval({start:3,end:9}).fit(false,false);assert.deepEqual(chart.axisZ.getInterval(),{start:3,end:9});
    }
  }finally{world.dispose();legacy.dispose();}
  for(const model of['world','legacy'] as const){const chart=new Chart3D({experimental3DCameraModel:model,defaultAxisX:{type:'logarithmic'}});try{
    addBounds(chart,[[1,2],[0,1],[0,1]]);chart.axisX.fit(false,false);assert.deepEqual(chart.axisX.getInterval(),{start:1,end:10});
  }finally{chart.dispose();}}
});

test('inverted axes and auxiliary world axes fit raw bounds without changing manual reversed intervals',()=>{
  const chart=new Chart3D();try{
    addBounds(chart,[[10,20],[10,20],[10,20]]);chart.axisX.setInverted(true).fit(false,false);assert.deepEqual(chart.axisX.getInterval(),{start:10,end:20});assert.equal(chart.axisX.getInverted(),true);
    const axis=new Axis(chart,'x'),original=chart.boundsFor;chart.boundsFor=a=>a===axis?{start:-7,end:9}:original.call(chart,a);
    try{axis.fit(false,false);assert.deepEqual(axis.getInterval(),{start:-7,end:9});axis.setInterval({start:20,end:-10});assert.deepEqual(axis.getInterval(),{start:20,end:-10});}finally{chart.boundsFor=original;axis.dispose();}
  }finally{chart.dispose();}
});
