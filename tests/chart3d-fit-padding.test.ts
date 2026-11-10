import test from 'node:test';
import assert from 'node:assert/strict';
import {Chart3D} from '../src/chart.js';

test('automatic perspective framing is independent of plot padding',()=>{
  // Independent public observations of the same 1440x749 control, with
  // padding 0/7/14. All three settings retain the same fitting radii.
  const poses=[
    {pose:{x:.4269448779169913,y:.2681753168677113,z:.863597169196002},radius:.93017578125},
    {pose:{x:.004273623452751,y:.454837860880289,z:.8905640103060684},radius:.92529296875},
    {pose:{x:.7,y:.5,z:.5},radius:1.279296875},
    {pose:{x:.01,y:.7,z:.7},radius:1.0009765625},
  ];
  const chart=new Chart3D().setTitle('').setBoundingBox({x:1440/749,y:1,z:1}).resize(1440,749);
  try{
    for(const {pose,radius} of poses){
      const measured:number[]=[];
      for(const padding of [0,7,14]){
        chart.setPadding(padding).setCameraLocation(pose).setCameraAutomaticFittingEnabled(true);
        const position=chart.getCameraLocation(),actual=Math.hypot(position.x,position.y,position.z);
        measured.push(actual);
        assert(Math.abs(actual-radius)<.002,`padding ${padding}: ${actual} vs ${radius}`);
      }
      assert(Math.max(...measured)-Math.min(...measured)<1e-10,'Padding must affect rendering, independently of automatic framing');
    }
  }finally{chart.dispose();}
});
