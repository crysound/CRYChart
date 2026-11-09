import test from 'node:test';
import assert from 'node:assert/strict';
import {ChartXY} from '../src/chart.js';

test('scrolling heatmap appends preserve logical order and describe only the physical changed region',()=>{
  const chart=new ChartXY(),heat=chart.addHeatmapScrollingGridSeries({rows:2,columns:3,scrollDimension:'columns'});
  heat.addIntensityValues([[1,10],[2,20]]);
  assert.deepEqual(heat.dataUpdate,{x:0,y:0,width:2,height:2,previousRevision:0});
  assert.deepEqual([...heat.orderedData()],[1,2,NaN,10,20,NaN]);
  heat.addIntensityValues([3,30]);assert.deepEqual([...heat.orderedData()],[1,2,3,10,20,30]);
  heat.acknowledgeDataRevision(heat.dataRevision);
  heat.addIntensityValues([4,40]);assert.deepEqual(heat.dataUpdate,{x:0,y:0,width:1,height:2,previousRevision:2});assert.deepEqual([...heat.orderedData()],[2,3,4,20,30,40]);
  heat.addIntensityValues([[5,50],[6,60],[7,70]]);assert.equal(heat.dataUpdate,undefined);assert.deepEqual([...heat.orderedData()],[5,6,7,50,60,70]);chart.dispose();
});

test('multiple patches before a render retain every edited cell in one bounding upload region',()=>{
  const chart=new ChartXY(),heat=chart.addHeatmapGridSeries({dataOrder: 'rows', columns:8,rows:5});
  heat.invalidateIntensityValues(new Float32Array(40));heat.acknowledgeDataRevision(heat.dataRevision);const uploaded=heat.dataRevision;
  heat.invalidateIntensityValues({iColumn:1,iRow:2,values:[[11],[12]]});
  heat.invalidateIntensityValues({iColumn:2,iRow:2,values:[[21],[22]]});
  heat.invalidateIntensityValues({iColumn:5,iRow:1,values:[[31,32]]});
  assert.deepEqual(heat.dataUpdate,{x:1,y:1,width:6,height:3,previousRevision:uploaded});
  assert.equal(heat.data[2*8+1],11);assert.equal(heat.data[3*8+2],22);assert.equal(heat.data[1*8+6],32);assert.equal(heat.data[2*8+4],0);
  const pending=heat.dataUpdate;heat.acknowledgeDataRevision(uploaded+1);assert.equal(heat.dataUpdate,pending);
  heat.acknowledgeDataRevision(heat.dataRevision);assert.equal(heat.dataUpdate,undefined);
  heat.invalidateIntensityValues({iColumn:4,iRow:4,values:[[42]]});assert.deepEqual(heat.dataUpdate,{x:4,y:4,width:1,height:1,previousRevision:uploaded+3});chart.dispose();
});

test('full replacement and clear cannot be narrowed by a later patch before upload acknowledgement',()=>{
  const chart=new ChartXY(),heat=chart.addHeatmapGridSeries({dataOrder: 'rows', columns:3,rows:2});
  heat.invalidateIntensityValues(new Float32Array([1,2,3,4,5,6]));
  heat.invalidateIntensityValues({iColumn:1,iRow:0,values:[[9]]});
  assert.equal(heat.dataUpdate,undefined);assert.deepEqual([...heat.data],[1,9,3,4,5,6]);
  heat.acknowledgeDataRevision(heat.dataRevision);
  heat.invalidateIntensityValues({iColumn:2,iRow:1,values:[[10]]});assert.deepEqual(heat.dataUpdate,{x:2,y:1,width:1,height:1,previousRevision:2});
  heat.clear();heat.invalidateIntensityValues({iColumn:0,iRow:1,values:[[11]]});assert.equal(heat.dataUpdate,undefined);assert.deepEqual([...heat.data],[0,0,0,11,0,0]);chart.dispose();
});

test('separate scrolling appends merge before a frame and wrapped writes remain full until acknowledged',()=>{
  const chart=new ChartXY(),heat=chart.addHeatmapScrollingGridSeries({columns:4,rows:2,scrollDimension:'columns'});
  heat.addIntensityValues([1,10]);heat.addIntensityValues([2,20]);assert.deepEqual(heat.dataUpdate,{x:0,y:0,width:2,height:2,previousRevision:0});heat.acknowledgeDataRevision(heat.dataRevision);
  heat.addIntensityValues([[3,30],[4,40],[5,50]]);assert.equal(heat.dataUpdate,undefined);
  heat.addIntensityValues([6,60]);assert.equal(heat.dataUpdate,undefined);assert.deepEqual([...heat.orderedData()],[3,4,5,6,30,40,50,60]);
  heat.acknowledgeDataRevision(heat.dataRevision);heat.addIntensityValues([7,70]);assert.deepEqual(heat.dataUpdate,{x:2,y:0,width:1,height:2,previousRevision:4});chart.dispose();
});

test('row scrolling records a contiguous upload range; no-op append does not invalidate it',()=>{
  const chart=new ChartXY(),heat=chart.addHeatmapScrollingGridSeries({columns:2,rows:3,scrollDimension:'rows'});
  heat.addIntensityValues([[1,10],[2,20]]);const revision=heat.dataRevision,region=heat.dataUpdate;
  heat.addIntensityValues([]);assert.equal(heat.dataRevision,revision);assert.equal(heat.dataUpdate,region);
  assert.deepEqual(region,{x:0,y:0,width:2,height:2,previousRevision:0});
  heat.addIntensityValues([[3,30],[4,40]]);assert.equal(heat.dataUpdate,undefined);assert.deepEqual([...heat.orderedData()],[2,20,3,30,4,40]);chart.dispose();
});

test('fixed heatmap clear resets every public cell to zero and streaming clear removes all samples',()=>{
  const chart=new ChartXY(),fixed=chart.addHeatmapGridSeries({dataOrder:'rows',columns:3,rows:2});
  const stream=chart.addHeatmapScrollingGridSeries({resolution:2});
  try{
    chart.axisX.setInterval({start:0,end:3});chart.axisY.setInterval({start:0,end:2});
    fixed.invalidateIntensityValues([[1,NaN,3],[4,0,6]]);stream.addIntensityValues([[5,NaN],[0,7]]);
    const at=(x:number,y:number)=>chart.translatePoint({x,y},chart.coordsAxis,chart.coordsClient);
    assert.ok(Number.isNaN(fixed.solveNearest(at(1.5,.5))!.intensity));
    assert.equal(fixed.clear(),fixed);assert.equal(fixed.clear(),fixed);
    for(let column=0;column<3;column++)for(let row=0;row<2;row++){
      const hit=fixed.solveNearest(at(column+.5,row+.5),'show-pointed')!;
      assert.deepEqual([hit.column,hit.row,hit.intensity],[column,row,0]);
    }
    fixed.invalidateIntensityValues({iColumn:1,iRow:0,values:[[NaN]]});
    assert.ok(Number.isNaN(fixed.solveNearest(at(1.5,.5))!.intensity));
    assert.equal(fixed.solveNearest(at(2.5,1.5))!.intensity,0);
    stream.clear();assert.equal(stream.getSampleCount(),0);assert.equal(stream.solveNearest(at(.5,.5)),undefined);
    stream.addIntensityValues([[0,NaN]]);assert.equal(stream.solveNearest(at(.5,.5))!.intensity,0);
    assert.ok(Number.isNaN(stream.solveNearest(at(.5,1.5))!.intensity));
  }finally{chart.dispose();}
});
