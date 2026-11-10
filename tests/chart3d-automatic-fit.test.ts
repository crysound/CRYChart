import test from 'node:test';
import assert from 'node:assert/strict';
import observations from './fixtures/public-perspective-fit.json';
import {createWorldCameraFrame, projectWorld3D} from '../src/world-camera.js';

test('perspective automatic fitting retains framing across public rotations, aspect ratios and flat boxes',()=>{
  for(const c of observations.cases){
    const frame=createWorldCameraFrame({position:c.pose,projection:'perspective',autoFit:true,box:c.box,
      viewport:{left:0,top:0,width:c.width,height:c.height},
      clip:{left:50,top:50,width:c.width-100,height:c.height-100}});
    const identity=JSON.stringify({size:[c.width,c.height],box:c.box,pose:c.pose});
    // The reference has a coarse fit search and a measured centering residual.
    // Compare the visible projection within that residual plus two CSS pixels,
    // rather than requiring its approximate radius or off-center target.
    const xs=c.corners.map(p=>p.client.clientX),ys=c.corners.map(p=>p.client.clientY);
    const referenceResidual=Math.hypot((Math.min(...xs)+Math.max(...xs)-c.width)/2,(Math.min(...ys)+Math.max(...ys)-c.height)/2);
    assert(Number.isFinite(frame.radius)&&frame.radius>0);
    for(const p of c.corners){
      const actual=projectWorld3D(p.world,frame);
      assert(Math.hypot(actual.x-p.client.clientX,actual.y-p.client.clientY)<referenceResidual+2,`Projected corner: ${identity}`);
      assert(actual.x>=frame.safe.left-1e-7&&actual.x<=frame.safe.left+frame.safe.width+1e-7,`Safe X: ${identity}`);
      assert(actual.y>=frame.safe.top-1e-7&&actual.y<=frame.safe.top+frame.safe.height+1e-7,`Safe Y: ${identity}`);
    }
    assert.equal(frame.fit.verified,true);
  }
});
