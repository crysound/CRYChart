import test from 'node:test';
import assert from 'node:assert/strict';
import {ChartXY, Polar} from '../src/chart.js';
import type {SolveNearestMode} from '../src/cursor-api.js';

const modes:SolveNearestMode[]=['show-pointed','show-nearest','show-all'];
const start={x:10,y:20};
function setup(){
  const chart=new ChartXY({legend:{visible:false}});
  chart.getDefaultAxisX().setInterval({start:-100,end:100});
  chart.getDefaultAxisY().setInterval({start:-100,end:100});
  chart.renderNow();
  return chart;
}
function client(chart:ChartXY,step:{x:number;y:number},column:number,row:number){
  return chart.translateCoordinate({x:start.x+column*step.x,y:start.y+row*step.y},chart.coordsAxis,chart.coordsClient);
}
function cell(hit:any){return hit&&{column:hit.column,row:hit.row,x:hit.x,y:hit.y,intensity:hit.intensity};}

test('new fixed grids expose zero in every unwritten cell and preserve explicit NaN patches',()=>{
  for(const sx of [1,-1])for(const sy of [1,-1]){
    const chart=setup(),step={x:2*sx,y:3*sy};
    const heat=chart.addHeatmapGridSeries({columns:4,rows:3,dataOrder:'rows'}).setStart(start).setStep(step);
    try{
      assert.deepEqual([...heat.data],Array(12).fill(0));
      for(const mode of modes)for(let column=0;column<4;column++)for(let row=0;row<3;row++)
        assert.equal(heat.solveNearest(client(chart,step,column+.5,row+.5),mode)!.intensity,0);
      heat.invalidateIntensityValues({iColumn:1,iRow:1,values:[[NaN,7]]});
      for(const mode of modes){
        assert.ok(Number.isNaN(heat.solveNearest(client(chart,step,1.5,1.5),mode)!.intensity));
        assert.equal(heat.solveNearest(client(chart,step,2.5,1.5),mode)!.intensity,7);
        assert.equal(heat.solveNearest(client(chart,step,.5,.5),mode)!.intensity,0);
      }
      heat.clear();assert.deepEqual([...heat.data],Array(12).fill(0));
    }finally{chart.dispose();}
  }
});

test('fixed grid public min and max sort signed steps without reversing texture coordinates',()=>{
  const chart=setup(),heat=chart.addHeatmapGridSeries({columns:4,rows:3,dataOrder:'rows'}).setStart(start);
  try{
    for(const sx of [1,-1])for(const sy of [1,-1]){
      heat.setStep({x:2*sx,y:3*sy});
      assert.deepEqual([heat.getXMin(),heat.getXMax(),heat.getYMin(),heat.getYMax()],
        [sx>0?10:2,sx>0?18:10,sy>0?20:11,sy>0?29:20]);
      assert.deepEqual(heat.textureBounds('x'),{start:10,end:10+8*sx});
      assert.deepEqual(heat.textureBounds('y'),{start:20,end:20+9*sy});
    }
    heat.setStart({x:0,y:-20}).setStep({x:-2,y:-3});
    assert.deepEqual([heat.getXMin(),heat.getXMax(),heat.getYMin(),heat.getYMax()],[-8,0,-29,-20]);
  }finally{chart.dispose();}
});

test('scrolling negative-step public endpoints retain their observed direction',()=>{
  const chart=setup();
  try{
    for(const dimension of ['columns','rows'] as const){
      const heat=chart.addHeatmapScrollingGridSeries({resolution:3,scrollDimension:dimension}).setStart(start).setStep({x:-2,y:-3});
      assert.deepEqual([heat.getXMin(),heat.getXMax(),heat.getYMin(),heat.getYMax()],dimension==='columns'?[10,10,20,11]:[10,4,20,20]);
      heat.addIntensityValues([[1,2,3],[4,5,6]]);
      assert.deepEqual([heat.getXMin(),heat.getXMax(),heat.getYMin(),heat.getYMax()],dimension==='columns'?[10,6,20,11]:[10,4,20,14]);
    }
  }finally{chart.dispose();}
});

test('polar heatmaps preserve NaN initialization and clear independently from XY fixed grids',()=>{
  const chart=new Polar(),heat=chart.addHeatmapSeries({sectors:4,annuli:2,amplitudeStart:0,amplitudeStep:1,dataOrder:'annuli'});
  try{
    assert.equal(heat.data.length,8);assert.ok([...heat.data].every(Number.isNaN));
    heat.invalidateIntensityValues([[0,1,2,3],[4,5,6,7]]);assert.equal(heat.data[0],0);
    heat.clear();assert.ok([...heat.data].every(Number.isNaN));
  }finally{chart.dispose();}
});

test('XY extrema normalization preserves Polar inherited getters for a reversed amplitude range',()=>{
  const chart=new Polar(),heat=chart.addHeatmapSeries({sectors:4,annuli:2,amplitudeStart:20,amplitudeStep:-3,dataOrder:'annuli'});
  try{
    const original=heat.bounds('y')!;
    assert.deepEqual([heat.getYMin(),heat.getYMax()],[original.start,original.end]);
    assert.ok(original.start>original.end);
    assert.ok([...heat.data].every(Number.isNaN));
  }finally{chart.dispose();}
});

test('fixed heatmap public queries clamp all boundaries for every supported solve mode and step direction',()=>{
  for(const sx of [1,-1])for(const sy of [1,-1]){
    const chart=setup(),step={x:2*sx,y:3*sy};
    const heat=chart.addHeatmapGridSeries({columns:4,rows:3,dataOrder:'rows'}).setStart(start).setStep(step);
    const values=[[0,1,2,3],[10,11,12,13],[20,21,22,23]];
    try{
      heat.invalidateIntensityValues(values);
      const queries=[[-10.5,.5,0,0],[-.5,1.5,0,1],[4.5,.5,3,0],[14.5,2.5,3,2],[.5,-.5,0,0],[1.5,3.5,1,2],[2.5,1.5,2,1]];
      for(const mode of modes)for(const [x,y,column,row]of queries){
        assert.deepEqual(cell(heat.solveNearest(client(chart,step,x!,y!),mode)),{
          column,row,x:start.x+(column!+.5)*step.x,y:start.y+(row!+.5)*step.y,intensity:values[row!]![column!],
        },`${mode}: step ${sx}/${sy}, query ${x}/${y}`);
      }
      heat.invalidateIntensityValues({iColumn:0,iRow:0,values:[[NaN]]});
      assert.ok(Number.isNaN(heat.solveNearest(client(chart,step,-.5,-.5),'show-pointed')!.intensity));
      heat.clear();
      for(const mode of modes)assert.equal(heat.solveNearest(client(chart,step,10.5,10.5),mode)!.intensity,0);
    }finally{chart.dispose();}
  }
});

test('scrolling public queries clamp the first retained sample and transverse edge but never invent future samples',()=>{
  for(const dimension of ['columns','rows'] as const)for(const sign of [1,-1]){
    const chart=setup(),step={x:2*sign,y:3*sign};
    const heat=chart.addHeatmapScrollingGridSeries({resolution:3,scrollDimension:dimension}).setStart(start).setStep(step);
    const at=(sample:number,transverse:number)=>client(chart,step,...(dimension==='columns'?[sample,transverse]:[transverse,sample]) as [number,number]);
    try{
      for(const mode of modes)assert.equal(heat.solveNearest(at(.5,.5),mode),undefined);
      heat.addIntensityValues([[0,1,2],[10,11,12],[20,21,22],[30,31,32]]);
      for(const mode of modes){
        const first=heat.solveNearest(at(-10.5,-.5),mode)!;
        assert.equal(first.intensity,0);assert.equal(first.column,0);assert.equal(first.row,0);
        assert.equal(heat.solveNearest(at(.5,10.5),mode)!.intensity,2);
        assert.equal(heat.solveNearest(at(4.5,.5),mode),undefined);
        assert.equal(heat.solveNearest(at(100.5,.5),mode),undefined);
      }
      // Queries use the retained prefix after data cleaning changes its boundary.
      heat.setDataCleaning({maxDataPointCount:2});
      assert.equal(heat.getFirstRetainedSampleIndex(),2);
      for(const mode of modes){
        const first=heat.solveNearest(at(-.5,1.5),mode)!;
        assert.equal(first.intensity,21);
        assert.equal(dimension==='columns'?first.column:first.row,2);
        assert.equal(heat.solveNearest(at(4.5,1.5),mode),undefined);
      }
      heat.clear();
      for(const mode of modes)assert.equal(heat.solveNearest(at(-.5,.5),mode),undefined);
      heat.addIntensityValues([[0,NaN,2]]);
      for(const mode of modes){
        assert.equal(heat.solveNearest(at(-.5,-.5),mode)!.intensity,0);
        assert.ok(Number.isNaN(heat.solveNearest(at(-.5,1.5),mode)!.intensity));
        assert.equal(heat.solveNearest(at(1.5,.5),mode),undefined);
      }
    }finally{chart.dispose();}
  }
});

class CursorProbe extends ChartXY{
  drawAt(point:{x:number;y:number},ctx:CanvasRenderingContext2D){this.pointer=point;this.drawCursor(ctx);}
}
test('public heatmap boundary clamping does not extend native pointed cursor coverage',()=>{
  const chart=new CursorProbe({legend:{visible:false}}).setCursorMode('show-pointed');
  chart.getDefaultAxisX().setInterval({start:0,end:10});chart.getDefaultAxisY().setInterval({start:0,end:10});
  const heat=chart.addHeatmapGridSeries({columns:2,rows:2,dataOrder:'rows'}).setStart({x:2,y:2}).invalidateIntensityValues([[0,1],[2,3]]);
  const seen:any[]=[];chart.setCustomCursor(info=>seen.push(info));chart.renderNow();
  const ctx=new Proxy({measureText:(text:string)=>({width:String(text).length*7})},{get:(target,key)=>key in target?(target as any)[key]:()=>{},set:(target,key,value)=>{(target as any)[key]=value;return true;}}) as unknown as CanvasRenderingContext2D;
  try{
    const outside=chart.translateCoordinate({x:1.5,y:2.5},chart.coordsAxis,chart.coordsClient);
    assert.equal(heat.solveNearest(outside,'show-pointed')!.intensity,0);
    chart.drawAt(chart.translatePoint({x:2.5,y:2.5},chart.coordsAxis,chart.coordsPixel),ctx);
    assert.equal(seen.at(-1).hit.intensity,0);
    chart.drawAt(chart.translatePoint({x:1.5,y:2.5},chart.coordsAxis,chart.coordsPixel),ctx);
    assert.equal(seen.at(-1).hit,undefined);assert.deepEqual(seen.at(-1).hits,[]);
  }finally{chart.dispose();}
});
