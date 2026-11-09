import test from 'node:test';
import assert from 'node:assert/strict';
import type {DrawPacket} from '../src/contracts';
import {visibleSampleRange} from '../src/viewport';
const packet=():DrawPacket=>({id:1,revision:1,positions:new Float32Array([-1,0,0,0,1,1,2,0,3,1,4,0,5,0]),count:7,drawFirst:1,drawCount:5,dimensions:2,mode:'line',color:[1,1,1,1],thickness:1,pointSize:0,monotonicX:true,strictlyMonotonicX:true,origin:{x:0,y:0,z:0},domain:{x:{start:-10,end:10},y:{start:-1,end:1}}});
test('line visibility never draws stored halo segments and retains owned boundary crossings',()=>{
 const p=packet();assert.deepEqual(visibleSampleRange(p,800),{first:1,count:5});p.domain.x={start:1.4,end:1.6};assert.deepEqual(visibleSampleRange(p,800),{first:2,count:2});p.domain.x={start:10,end:20};assert.equal(visibleSampleRange(p,800).count,0);p.monotonicX=false;assert.deepEqual(visibleSampleRange(p,800),{first:1,count:5});
});
test('empty draw ownership remains empty and invalid ownership cannot expose unowned geometry',()=>{
 const p=packet();p.drawCount=0;assert.deepEqual(visibleSampleRange(p,800),{first:1,count:0});p.drawCount=7;assert.throws(()=>visibleSampleRange(p,800),/Draw range/);p.drawCount=3;p.drawFirst=-1;assert.throws(()=>visibleSampleRange(p,800),/Draw range/);
});
