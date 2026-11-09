import test from 'node:test';
import assert from 'node:assert/strict';
import {ChartXY} from '../src/chart';
import {confidenceEllipse,correlatedCloud,cytometryCloud,lineWalk,resizeAnnotation,spatialIndex,syncAxes} from '../examples/official/xy-data';

test('confidence ellipse obeys the covariance quadratic form and ignores only nonfinite rows',()=>{
 const result=confidenceEllipse({x:new Float64Array([2,-2,2,-2,NaN]),y:new Float64Array([1,1,-1,-1,999])});
 assert.equal(result.count,4);assert.deepEqual(result.mean,{x:0,y:0});assert.equal(result.covariance.xx,16/3);assert.ok(Math.abs(result.covariance.xy)<1e-12);assert.equal(result.covariance.yy,4/3);
 for(const p of result.points)assert.ok(Math.abs(p.x*p.x/result.covariance.xx+p.y*p.y/result.covariance.yy-result.threshold)<1e-10);
 assert.throws(()=>confidenceEllipse({x:new Float64Array([NaN]),y:new Float64Array([0])}));
 const correlated=confidenceEllipse(correlatedCloud(20000));assert.ok(correlated.covariance.xy>0);assert.ok(correlated.angle>0&&correlated.angle<Math.PI/2);assert.equal(correlated.count,20000);
});
test('spatial index finds the same point as exhaustive anisotropic distance across boundary cells',()=>{
 const data=correlatedCloud(1000,711),index=spatialIndex(data,17);assert.equal(index.size,1000);
 for(let i=0;i<150;i++){const x=(i%15-7)/4,y=(Math.floor(i/15)-4)/5,rx=.13+(i%3)*.09,ry=.07+(i%5)*.02;let best=1,expected:number|undefined;for(let j=0;j<data.x.length;j++){const distance=((data.x[j]-x)/rx)**2+((data.y[j]-y)/ry)**2;if(distance<best){best=distance;expected=j;}}assert.equal(index.nearest(x,y,rx,ry),expected);}
 assert.equal(index.nearest(99,99,.1,.1),undefined);assert.equal(spatialIndex({x:new Float64Array([NaN]),y:new Float64Array([0])}).size,0);
});
test('full sample generators retain exact counts and cytometry density counts actual neighbors',()=>{
 const walk=lineWalk(500000,17);assert.equal(walk.x.length,500000);assert.equal(walk.x[499999],499999);assert.ok(walk.y.every(Number.isFinite));
 const cloud=cytometryCloud(2000);assert.equal(cloud.count,2000);assert.ok(cloud.value.every(v=>v>=1&&v<=2000&&Number.isInteger(v)));
 const i=100,col=Math.max(0,Math.min(127,Math.floor(cloud.x[i]/10e6*128))),row=Math.max(0,Math.min(127,Math.floor((cloud.y[i]+.2e6)/2e6*128)));let expected=0;
 for(let j=0;j<2000;j++){const c=Math.max(0,Math.min(127,Math.floor(cloud.x[j]/10e6*128))),r=Math.max(0,Math.min(127,Math.floor((cloud.y[j]+.2e6)/2e6*128)));if(Math.abs(c-col)<=1&&Math.abs(r-row)<=1)expected++;}assert.equal(cloud.value[i],expected);
});
test('axis synchronization propagates actual intervals once and detaches without continuing to mutate peers',()=>{
 const charts=Array.from({length:4},()=>new ChartXY({headless:true})),axes=charts.map(c=>c.getDefaultAxisX()),unlink=syncAxes(axes);let changes=0;const token=axes[2].onIntervalChange(()=>changes++);
 axes[0].setInterval({start:123,end:567});for(const axis of axes)assert.deepEqual(axis.getInterval(),{start:123,end:567});assert.equal(changes,1);
 axes[3].setInterval({start:-10,end:1});assert.equal(changes,2);unlink();axes[0].setInterval({start:8,end:9});assert.deepEqual(axes[1].getInterval(),{start:-10,end:1});axes[2].offIntervalChange(token);charts.forEach(c=>c.dispose());
});
test('annotation boundaries cannot cross and invalid drags preserve a valid interval',()=>{
 const a={id:1,start:100,end:500,text:'Event',color:'#fff',lane:0};resizeAnnotation(a,'start',600,10);assert.equal(a.start,490);resizeAnnotation(a,'end',100,10);assert.equal(a.end,500);resizeAnnotation(a,'end',NaN,10);assert.equal(a.end,500);resizeAnnotation(a,'start',-50,10);assert.equal(a.start,-50);
});
