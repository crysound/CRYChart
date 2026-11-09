import test from 'node:test';
import assert from 'node:assert/strict';
import {DataRenderer} from '../src/render.js';
import type {DrawPacket} from '../src/contracts.js';

type P = {x:number;y:number};
type Path = {points:P[];closed:boolean;arc?:{center:P;radius:number}};
class RecordingContext {
  matrix=[1,0,0,1,0,0]; stack:number[][]=[]; paths:Path[]=[]; fills:Path[][]=[];
  save(){this.stack.push([...this.matrix]);}
  restore(){this.matrix=this.stack.pop()!;}
  setTransform(...m:number[]){this.matrix=m;}
  translate(x:number,y:number){const [a,b,c,d,e,f]=this.matrix;this.matrix=[a!,b!,c!,d!,e!+a!*x+c!*y,f!+b!*x+d!*y];}
  rotate(angle:number){const [a,b,c,d,e,f]=this.matrix,co=Math.cos(angle),si=Math.sin(angle);this.matrix=[a!*co+c!*si,b!*co+d!*si,c!*co-a!*si,d!*co-b!*si,e!,f!];}
  project(x:number,y:number):P{const [a,b,c,d,e,f]=this.matrix;return{x:a!*x+c!*y+e!,y:b!*x+d!*y+f!};}
  beginPath(){this.paths=[];}
  moveTo(x:number,y:number){this.paths.push({points:[this.project(x,y)],closed:false});}
  lineTo(x:number,y:number){this.paths.at(-1)!.points.push(this.project(x,y));}
  closePath(){this.paths.at(-1)!.closed=true;}
  rect(x:number,y:number,w:number,h:number){this.moveTo(x,y);this.lineTo(x+w,y);this.lineTo(x+w,y+h);this.lineTo(x,y+h);this.closePath();}
  arc(x:number,y:number,r:number){const scale=Math.hypot(this.matrix[0]!,this.matrix[1]!);this.paths.at(-1)!.arc={center:this.project(x,y),radius:r*scale};}
  fill(){this.fills.push(structuredClone(this.paths));}
  clearRect(){} clip(){} setLineDash(){} stroke(){}
}
const rect={left:10,top:20,width:600,height:400};
function packet(options:Partial<DrawPacket>={}):DrawPacket{return{id:1,revision:1,positions:new Float32Array([0,0]),count:1,dimensions:2,mode:'points',color:[1,0,1,1],thickness:0,pointSize:48,pointShape:2,pointRotation:0,origin:{x:0,y:0,z:0},domain:{x:{start:-10,end:10},y:{start:-10,end:10}},...options};}
function draw(p:DrawPacket,dpr=1){
  const ctx=new RecordingContext(),canvas={width:640*dpr,height:480*dpr,getContext:(kind:string)=>kind==='2d'?ctx:null,addEventListener(){},removeEventListener(){}} as unknown as HTMLCanvasElement;
  const renderer=new DataRenderer(canvas,{renderer:'canvas2d'});renderer.render([p],rect,dpr);renderer.dispose();return ctx;
}
const near=(actual:number,expected:number,tolerance=1e-9)=>assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} differs from ${expected}`);
function triangle(path:Path,center:P,size:number,rotation:number){
  assert.equal(path.points.length,3);assert.equal(path.closed,true);
  near(path.points.reduce((n,p)=>n+p.x,0)/3,center.x);near(path.points.reduce((n,p)=>n+p.y,0)/3,center.y);
  const edge=2*size/Math.sqrt(3);
  for(let i=0;i<3;i++)near(Math.hypot(path.points[i]!.x-path.points[(i+1)%3]!.x,path.points[i]!.y-path.points[(i+1)%3]!.y),edge);
  const angle=rotation*Math.PI/180,down={x:-Math.sin(angle),y:Math.cos(angle)};
  const along=path.points.map(p=>(p.x-center.x)*down.x+(p.y-center.y)*down.y).sort((a,b)=>a-b);
  near(along[0]!, -size/3);near(along[1]!, -size/3);near(along[2]!, 2*size/3);
  const [a,b,c]=path.points;
  near(Math.abs((b!.x-a!.x)*(c!.y-a!.y)-(b!.y-a!.y)*(c!.x-a!.x))/2,size*size/Math.sqrt(3));
}

test('Triangle point size is altitude, source position is its centroid, and cardinal rotation is clockwise',()=>{
  for(const rotation of [0,90,180,270])triangle(draw(packet({pointRotation:rotation})).fills[0]![0]!,{x:310,y:220},48,rotation);
});
test('Triangle geometry preserves the same equilateral definition for small, arbitrary and negative rotations at DPR 2',()=>{
  for(const size of [1,12,96])for(const rotation of [-90,22.5,45,450])triangle(draw(packet({pointSize:size,pointRotation:rotation}),2).fills[0]![0]!,{x:620,y:440},size*2,rotation);
});
test('Per-sample size and rotation affect the actual Canvas paths without rewriting source positions or attributes',()=>{
  const p=packet({positions:new Float32Array([-4,2,0,0,4,-2]),count:3,pointSizes:new Float32Array([12,24,36]),pointRotations:new Float32Array([0,90,270])});
  const before={positions:[...p.positions],sizes:[...p.pointSizes!],rotations:[...p.pointRotations!]};const paths=draw(p).fills[0]!;
  assert.equal(paths.length,3);triangle(paths[0]!,{x:190,y:180},12,0);triangle(paths[1]!,{x:310,y:220},24,90);triangle(paths[2]!,{x:430,y:260},36,270);
  assert.deepEqual({positions:[...p.positions],sizes:[...p.pointSizes!],rotations:[...p.pointRotations!]},before);
});
test('NaN source points stay gaps and the next finite triangle has a fresh transform',()=>{
  const p=packet({positions:new Float32Array([NaN,0,2,-3]),count:2,pointRotation:180}),ctx=draw(p);
  assert.equal(ctx.fills[0]!.length,1);triangle(ctx.fills[0]![0]!,{x:370,y:280},48,180);assert.equal(Number.isNaN(p.positions[0]),true);
  assert.equal(ctx.stack.length,0);assert.deepEqual(ctx.matrix,[1,0,0,1,0,0]);
});
test('Existing circle, square, arrow and star Canvas shapes keep their previous size and direction',()=>{
  const circle=draw(packet({pointShape:1})).fills[0]![0]!;near(circle.arc!.center.x,310);near(circle.arc!.center.y,220);near(circle.arc!.radius,24);
  const square=draw(packet({pointShape:0})).fills[0]![0]!;assert.equal(square.points.length,4);near(Math.max(...square.points.map(p=>p.x))-Math.min(...square.points.map(p=>p.x)),48);
  const arrow=draw(packet({pointShape:7})).fills[0]![0]!;assert.equal(arrow.points.length,7);assert.deepEqual(arrow.points[0],{x:310,y:196});
  const star=draw(packet({pointShape:8})).fills[0]![0]!;assert.equal(star.points.length,10);near(star.points[0]!.x,310);near(star.points[0]!.y,196);
});
