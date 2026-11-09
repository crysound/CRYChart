import assert from 'node:assert/strict';
import test from 'node:test';
import {reviewRecords,reviewEpoch,reviewDay,eventCrossings,eventSignal,dropCoordinate,imageHit,officeGrid,officeCategory} from '../examples/official/annotation-images-data';

test('review fixture has one immutable identity per source row and balanced categories on every day',()=>{
  const rows=reviewRecords();assert.equal(rows.length,360);assert.equal(new Set(rows.map(row=>row.id)).size,360);
  for(let day=0;day<30;day++){
    const group=rows.filter(row=>row.y>=reviewEpoch+day*reviewDay&&row.y<reviewEpoch+(day+1)*reviewDay);assert.equal(group.length,12);
    for(const kind of ['unhappy','neutral','happy'])assert.equal(group.filter(row=>row.kind===kind).length,4);
  }
  assert(rows.every(row=>row.x>=6&&row.x<23));assert.deepEqual(reviewRecords(),rows);
});
test('event symbols keep original crossing samples, ignore NaN gaps, and do not invent interpolated X',()=>{
  const input=[{x:0,y:69},{x:3,y:70},{x:9,y:80},{x:11,y:NaN},{x:20,y:88},{x:25,y:60},{x:30,y:71}];
  assert.deepEqual(eventCrossings(input).map(({x,y})=>({x,y})),[{x:3,y:70},{x:30,y:71}]);
  const points=Array.from({length:2000},(_,i)=>({x:i*20,y:eventSignal(i)})),hits=eventCrossings(points);
  assert(hits.length>5);for(const hit of hits){assert.deepEqual({x:hit.x,y:hit.y},points[hit.id]);assert(points[hit.id-1].y<70&&hit.y>=70);}
});
test('drop coordinates follow resized/reversed plots and reject a release outside',()=>{
  const axisX={start:100,end:200},axisY={start:-3,end:7};
  assert.deepEqual(dropCoordinate({x:60,y:45},{left:10,top:20,width:100,height:50},axisX,axisY),{x:150,y:2});
  assert.deepEqual(dropCoordinate({x:110,y:70},{left:10,top:20,width:200,height:100},axisX,axisY),{x:150,y:2});
  assert.deepEqual(dropCoordinate({x:10,y:20},{left:10,top:20,width:100,height:50},{start:200,end:100},{start:7,end:-3}),{x:200,y:-3});
  assert.equal(dropCoordinate({x:9,y:45},{left:10,top:20,width:100,height:50},axisX,axisY),undefined);
});
test('image hit respects plot clipping and the topmost drawn source identity',()=>{
  const datum={id:1,x:0,y:0,kind:'event'},top={...datum,id:2},bounds={left:-5,top:2,width:20,height:20},clip={left:0,top:0,width:100,height:100};
  assert.equal(imageHit({x:-1,y:5},[{datum,bounds,clip}]),undefined);
  assert.equal(imageHit({x:2,y:5},[{datum,bounds,clip},{datum:top,bounds,clip}])?.id,2);
  assert.equal(imageHit({x:16,y:5},[{datum,bounds,clip}]),undefined);
});
test('office categorical grid preserves transparent no-measurement cells and all three measured classes',()=>{
  const grid=officeGrid();assert.equal(grid.length,6300);assert.deepEqual([...new Set(grid)].sort(),[0,1,2,3]);
  assert.equal(officeCategory(61,14),3);assert.equal(officeCategory(6,69),1);assert.equal(officeCategory(0,0),0);
  for(let row=0;row<70;row++)for(let column=0;column<90;column++){const x=(column+.5)*100/90,y=(row+.5)*75/70;
    const inPlan=(x>=5&&x<40&&y>=5&&y<70)||(x>=40&&x<90&&y>=5&&y<70);
    assert.equal(grid[row*90+column]===0,!inPlan);
  }
});
