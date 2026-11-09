import test from 'node:test';
import assert from 'node:assert/strict';
import {normalDistribution,normalSamples} from '../examples/official/statistics';
import {interpolateRanking,mosaicGroups,stackedValues} from '../examples/official/categorical';
import {BoxSeries} from '../src/geometry';
import {BarChart} from '../src/specialty';

test('integrated normal CDF, quartiles and generated sample statistics agree with analytical values',()=>{
  const normal=normalDistribution();assert.ok(Math.abs(normal.pdf[400]-1/Math.sqrt(2*Math.PI))<1e-12);assert.ok(Math.abs(normal.cdf[400]-.5)<1e-12);assert.ok(Math.abs(normal.q1+.67448975)<.0001);assert.ok(Math.abs(normal.q3-.67448975)<.0001);
  for(let i=1;i<normal.count;i++)assert.ok(normal.cdf[i]>=normal.cdf[i-1]);
  const values=normalSamples(50000,21402),mean=values.reduce((sum,value)=>sum+value,0)/values.length,variance=values.reduce((sum,value)=>sum+(value-mean)**2,0)/values.length;assert.ok(Math.abs(mean)<.02);assert.ok(Math.abs(variance-1)<.03);
});

test('ranking interpolates measurements independently of smooth row positions and keeps ties stable',()=>{
  assert.deepEqual(interpolateRanking([10,20],[30,15],0),[{value:10,row:1},{value:20,row:0}]);assert.deepEqual(interpolateRanking([10,20],[30,15],1),[{value:30,row:0},{value:15,row:1}]);assert.deepEqual(interpolateRanking([10,20],[30,15],.5),[{value:20,row:.5},{value:17.5,row:.5}]);assert.deepEqual(interpolateRanking([5,5],[5,5],.7).map(item=>item.row),[0,1]);
  assert.equal(mosaicGroups.reduce((sum,group)=>sum+group.width,0),100);for(const group of mosaicGroups)assert.equal(group.parts.reduce((sum,v)=>sum+v,0),100);for(const values of stackedValues)assert.equal(values.reduce((sum,v)=>sum+v,0),100);
});

test('horizontal box preserves quantile geometry and swaps bounds without altering statistics',()=>{
  const axis={type:'linear',valueToFraction:(value:number)=>value/10},host={getDefaultAxisX:()=>axis,getDefaultAxisY:()=>axis,invalidate(){},removeSeries(){}},box=new BoxSeries(host).setHorizontal(true),bodies:number[][]=[],points:number[][]=[];
  box.add({start:1,end:2,lowerExtreme:2,lowerQuartile:3,median:4,upperQuartile:6,upperExtreme:9});assert.deepEqual(box.bounds('x'),{start:2,end:9});assert.deepEqual(box.bounds('y'),{start:1,end:2});
  const context={save(){},restore(){},beginPath(){},rect(){},clip(){},setLineDash(){},fillRect(...values:number[]){bodies.push(values);},strokeRect(){},moveTo(...values:number[]){points.push(values);},lineTo(...values:number[]){points.push(values);},stroke(){}} as unknown as CanvasRenderingContext2D;
  box.draw(context,{left:0,top:0,width:200,height:100});assert.deepEqual(bodies,[[60,80,60,10]]);assert.ok(points.some(([x,y])=>x===80&&y===90));box.setHorizontal(false);assert.deepEqual(box.bounds('x'),{start:1,end:2});
});

test('fractional category slots keep grouped bars separate and hit testing follows their width',()=>{
  const chart=new BarChart({headless:true,width:600,height:300}).setCategories(['A']).setValueInterval({start:0,end:10}).setData([{row:0,barSize:.5,value:5,name:'first'},{row:.5,barSize:.5,value:8,name:'second'}]),bodies:number[][]=[];
  const context={save(){},restore(){},setTransform(){},clearRect(){},fillRect(...values:number[]){bodies.push(values);},beginPath(){},moveTo(){},lineTo(){},stroke(){},rect(){},clip(){},fillText(){},measureText(value:string){return{width:value.length*6};}} as unknown as CanvasRenderingContext2D;
  chart.render(context);const [first,second]=bodies.slice(1);assert.ok(first[0]+first[2]<second[0]);assert.equal(first[2],second[2]);assert.equal(chart.activateAt({x:first[0]+first[2]/2,y:first[1]+first[3]/2})?.name,'first');assert.equal(chart.activateAt({x:second[0]+second[2]/2,y:second[1]+second[3]/2})?.name,'second');assert.equal(chart.activateAt({x:(first[0]+first[2]+second[0])/2,y:first[1]+first[3]/2}),undefined);chart.dispose();
});
