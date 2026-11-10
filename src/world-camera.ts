import type {Rect} from './contracts.js';

export interface Vec3 {x:number;y:number;z:number;}
export type Projection3D='perspective'|'orthographic';
export interface WorldCameraFrame {
  readonly position:Vec3;readonly forward:Vec3;readonly right:Vec3;readonly up:Vec3;
  readonly viewport:Rect;readonly clip:Rect;readonly safe:Rect;readonly box:Vec3;
  readonly projection:Projection3D;readonly scale:Vec3;readonly radius:number;
  readonly near:number;readonly far:number;readonly focal:number;
  readonly matrix:Float32Array;readonly rotation:Float32Array;
  readonly fit:{enabled:boolean;iterations:number;verified:boolean;fallback:boolean;};
}
const add=(a:Vec3,b:Vec3):Vec3=>({x:a.x+b.x,y:a.y+b.y,z:a.z+b.z});
const mul=(a:Vec3,n:number):Vec3=>({x:a.x*n,y:a.y*n,z:a.z*n});
const sub=(a:Vec3,b:Vec3):Vec3=>({x:a.x-b.x,y:a.y-b.y,z:a.z-b.z});
const dot=(a:Vec3,b:Vec3)=>a.x*b.x+a.y*b.y+a.z*b.z;
const cross=(a:Vec3,b:Vec3):Vec3=>({x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x});
export function unit3(a:Vec3):Vec3 {const n=Math.hypot(a.x,a.y,a.z);if(!Number.isFinite(n)||n===0)throw new RangeError('3D direction must be finite and nonzero');return mul(a,1/n);}
export const DEFAULT_WORLD_ORBIT:Readonly<Vec3>=Object.freeze({x:.4269448779169913,y:.2681753168677113,z:.863597169196002});
export function validateBox3D(box:Vec3):Vec3 {if(![box.x,box.y,box.z].every(v=>Number.isFinite(v)&&v>0))throw new RangeError('3D bounding dimensions must be positive and finite');return {...box};}
export function worldScale3D(box:Vec3):Vec3 {validateBox3D(box);const maximum=Math.max(box.x,box.y,box.z),x=box.x/maximum,y=box.y/maximum,z=box.z/maximum,n=Math.hypot(x,y,z);return{x:x/(2*n),y:y/(2*n),z:-z/(2*n)};}
export function normalizedToWorld3D(point:Vec3,box:Vec3):Vec3 {const s=worldScale3D(box);return{x:point.x*s.x,y:point.y*s.y,z:point.z*s.z};}
export function worldToNormalized3D(point:Vec3,box:Vec3):Vec3 {const s=worldScale3D(box);return{x:point.x/s.x,y:point.y/s.y,z:point.z/s.z};}
export function clampManualCamera3D(value:Vec3):Vec3 {const direction=unit3(value),radius=Math.max(.8,Math.min(3,Math.hypot(value.x,value.y,value.z)));return mul(direction,radius);}
export function lookAtBasis3D(forward:Vec3):{forward:Vec3;right:Vec3;up:Vec3}{
  const f=unit3(forward);let r=cross(f,{x:0,y:1,z:0});
  // An explicit pole policy avoids the reference's NaN projection at +/-Y.
  if(Math.hypot(r.x,r.y,r.z)<1e-12)r=cross(f,{x:0,y:0,z:1});
  r=unit3(r);return{forward:f,right:r,up:unit3(cross(r,f))};
}
/** Camera input scale independently measured from public single-step positions.
 * It is not derived from a vendor shader or controller implementation. */
export const CAMERA_ORBIT_RADIANS_PER_CSS_PIXEL=Math.PI/1080;
/** Rodrigues rotation around a normalized local camera basis vector. */
export function rotateVectorAroundAxis3D(value:Vec3,axis:Vec3,angle:number):Vec3{
  if(![value.x,value.y,value.z,angle].every(Number.isFinite))throw new RangeError('3D rotation inputs must be finite');
  const a=unit3(axis),c=Math.cos(angle),s=Math.sin(angle),parallel=dot(a,value)*(1-c),perpendicular=cross(a,value);
  return{x:value.x*c+perpendicular.x*s+a.x*parallel,y:value.y*c+perpendicular.y*s+a.y*parallel,z:value.z*c+perpendicular.z*s+a.z*parallel};
}
/** Original local-basis orbit. Horizontal rotation changes global elevation.
 * The vertical pole margin is a deliberate finite-projection boundary policy. */
export function orbitWorldCamera3D(position:Vec3,dx:number,dy:number,sensitivity=1):Vec3{
  if(![dx,dy,sensitivity].every(Number.isFinite))throw new RangeError('3D drag input must be finite');
  const radius=Math.hypot(position.x,position.y,position.z),direction=unit3(position);
  if(dx===0&&dy===0||sensitivity===0)return{...position};
  const radians=CAMERA_ORBIT_RADIANS_PER_CSS_PIXEL*sensitivity;
  const horizontalAngle=-dx*radians*Math.acos(Math.min(1,Math.abs(direction.y))),verticalAngle=-dy*radians;
  if(!Number.isFinite(horizontalAngle)||!Number.isFinite(verticalAngle))throw new RangeError('3D drag angle is out of range');
  // One DOM event is one local-basis operation. Keeping its two axes fixed
  // also matches independently observed simultaneous horizontal/vertical input.
  const basis=lookAtBasis3D(mul(direction,-1));let rotated={...position};
  if(horizontalAngle!==0)rotated=rotateVectorAroundAxis3D(rotated,basis.up,horizontalAngle);
  if(verticalAngle!==0){
    const pitch=Math.asin(Math.max(-1,Math.min(1,direction.y))),limit=Math.PI/2-1e-6;
    const nextPitch=Math.max(-limit,Math.min(limit,pitch-verticalAngle));
    rotated=rotateVectorAroundAxis3D(rotated,basis.right,pitch-nextPitch);
  }
  return mul(unit3(rotated),radius);
}
/** An unanimated wheel event changes radius once; magnitude does not affect it. */
export function zoomWorldCameraStep3D(position:Vec3,deltaY:number,sensitivity=1):Vec3{
  if(!Number.isFinite(deltaY)||!Number.isFinite(sensitivity))throw new RangeError('3D wheel input must be finite');
  const direction=unit3(position),radius=Math.hypot(position.x,position.y,position.z);
  if(deltaY===0||sensitivity===0)return{...position};
  const factor=1+Math.sign(deltaY)*.05*sensitivity,target=radius*factor;
  if(!Number.isFinite(target))throw new RangeError('3D wheel radius is out of range');
  return mul(direction,Math.max(.8,Math.min(3,target)));
}
export function boxCorners3D(box:Vec3):Vec3[]{const s=worldScale3D(box),out:Vec3[]=[];for(const x of [-1,1])for(const y of [-1,1])for(const z of [-1,1])out.push({x:x*s.x,y:y*s.y,z:z*s.z});return out;}
function validateRect(rect:Rect){if(![rect.left,rect.top,rect.width,rect.height].every(Number.isFinite)||rect.width<=0||rect.height<=0)throw new RangeError('3D camera viewport must be finite with positive dimensions');}
export function symmetricFitRect3D(viewport:Rect,clip:Rect):Rect{
  const mx=Math.max(0,clip.left-viewport.left,viewport.left+viewport.width-clip.left-clip.width),my=Math.max(0,clip.top-viewport.top,viewport.top+viewport.height-clip.top-clip.height);
  const halfX=Math.max(.5,viewport.width/2-Math.min(mx,viewport.width/2-.5)),halfY=Math.max(.5,viewport.height/2-Math.min(my,viewport.height/2-.5));
  return{left:viewport.left+viewport.width/2-halfX,top:viewport.top+viewport.height/2-halfY,width:halfX*2,height:halfY*2};
}
interface Basis {forward:Vec3;right:Vec3;up:Vec3;}
function projectedRatios(corners:readonly Vec3[],eye:Vec3,basis:Basis,projection:Projection3D){
  let xMin=Infinity,xMax=-Infinity,yMin=Infinity,yMax=-Infinity,depthMin=Infinity;
  for(const p of corners){const q=sub(p,eye),depth=dot(q,basis.forward),divisor=projection==='perspective'?depth:1,x=dot(q,basis.right)/divisor,y=dot(q,basis.up)/divisor;xMin=Math.min(xMin,x);xMax=Math.max(xMax,x);yMin=Math.min(yMin,y);yMax=Math.max(yMax,y);depthMin=Math.min(depthMin,depth);}
  return{xMin,xMax,yMin,yMax,depthMin};
}
/** Geometric fit based only on control dimensions and camera direction. */
function fitEye(box:Vec3,orbit:Vec3,viewport:Rect,safe:Rect,projection:Projection3D){
  const corners=boxCorners3D(box),direction=unit3(orbit),focal=viewport.height/(2*Math.tan(Math.PI/8));let iterations=0;
  const evaluate=(radius:number)=>{
    const position=mul(direction,radius);let basis=lookAtBasis3D(mul(direction,-1));
    if(projection==='perspective')for(let i=0;i<12;i++){
      const b=projectedRatios(corners,position,basis,projection);iterations++;if(b.depthMin<=.005)break;
      const cx=(b.xMin+b.xMax)/2,cy=(b.yMin+b.yMax)/2;if(Math.abs(cx)+Math.abs(cy)<1e-12)break;
      basis=lookAtBasis3D(add(basis.forward,add(mul(basis.right,cx),mul(basis.up,cy))));
    }
    const b=projectedRatios(corners,position,basis,projection),pixels=projection==='perspective'?focal:viewport.width/radius;
    const fits=b.depthMin>.005&&Math.max(Math.abs(b.xMin),Math.abs(b.xMax))*pixels<=safe.width/2&&Math.max(Math.abs(b.yMin),Math.abs(b.yMax))*pixels<=safe.height/2;
    return{position,...basis,fits};
  };
  let lo=.50001,hi=1,result=evaluate(hi);while(!result.fits&&hi<4096){hi*=2;result=evaluate(hi);}
  if(!result.fits)throw new RangeError('3D fit area cannot contain the bounding volume');
  for(let i=0;i<40;i++){const mid=(lo+hi)/2,value=evaluate(mid);if(value.fits){hi=mid;result=value;}else lo=mid;}
  if(projection==='perspective'){
    // A 16-sided elliptical cylinder encloses all four XZ box corners. Fit its
    // projected span before centering the actual box: fitting a centered box
    // alone makes orbiting shrink the camera radius and unexpectedly zoom in.
    // This geometry follows independent public-coordinate observations, with
    // no sampled radius table or pose-dependent scale correction.
    const scale=worldScale3D(box),envelope:Vec3[]=[],basis=lookAtBasis3D(mul(direction,-1));
    for(let j=0;j<16;j++)for(const y of [-1,1])envelope.push({
      x:Math.SQRT2*scale.x*Math.cos(j*Math.PI/8),y:y*scale.y,z:Math.SQRT2*scale.z*Math.sin(j*Math.PI/8)
    });
    const fitsSpan=(radius:number)=>{
      iterations++;
      const b=projectedRatios(envelope,mul(direction,radius),basis,projection);
      return b.depthMin>.005&&(b.xMax-b.xMin)*focal<=safe.width&&(b.yMax-b.yMin)*focal<=safe.height;
    };
    let low=.50001,high=Math.max(1,hi);
    while(!fitsSpan(high)&&high<4096)high*=2;
    if(!fitsSpan(high))throw new RangeError('3D fit area cannot contain the fitting envelope');
    for(let i=0;i<40;i++){const mid=(low+high)/2;if(fitsSpan(mid))high=mid;else low=mid;}
    // Retain the verified eight-corner lower bound as well: centering must not
    // push any actual control corner beyond the safe rectangle.
    hi=Math.max(hi,high);
  }
  // Retain a numerical margin, not a screenshot-derived scale factor.
  result=evaluate(hi*(1+2e-12));return{...result,iterations,fallback:false};
}
function clipMatrix(frame:Omit<WorldCameraFrame,'matrix'|'rotation'>):Float32Array{
  const {right:r,up:u,forward:f,position:p,scale:s,viewport:v,radius,near:n,far:z}=frame;
  const perspective=frame.projection==='perspective',kx=perspective?2*frame.focal/v.width:2/radius,ky=perspective?2*frame.focal/v.height:2*v.width/(radius*v.height),a=perspective?(z+n)/(z-n):2/(z-n),b=perspective?-2*z*n/(z-n):-(z+n)/(z-n);
  return new Float32Array([kx*r.x*s.x,ky*u.x*s.x,a*f.x*s.x,perspective?f.x*s.x:0,kx*r.y*s.y,ky*u.y*s.y,a*f.y*s.y,perspective?f.y*s.y:0,kx*r.z*s.z,ky*u.z*s.z,a*f.z*s.z,perspective?f.z*s.z:0,-kx*dot(r,p),-ky*dot(u,p),b-a*dot(f,p),perspective?-dot(f,p):1]);
}
export function createWorldCameraFrame(options:{position:Vec3;forward?:Vec3;projection:Projection3D;autoFit:boolean;box:Vec3;viewport:Rect;clip:Rect}):WorldCameraFrame{
  const {projection,autoFit}=options;if(projection!=='perspective'&&projection!=='orthographic')throw new TypeError('Unknown 3D projection');
  validateRect(options.viewport);validateRect(options.clip);const box=validateBox3D(options.box),viewport={...options.viewport},clip={...options.clip},safe=symmetricFitRect3D(viewport,clip);
  const solved=autoFit?fitEye(box,options.position,viewport,safe,projection):{position:clampManualCamera3D(options.position),...lookAtBasis3D(options.forward??mul(unit3(options.position),-1)),iterations:0,fits:true,fallback:false};
  const radius=Math.hypot(solved.position.x,solved.position.y,solved.position.z),near=.005,far=Math.max(8,radius+2),frame={position:solved.position,forward:solved.forward,right:solved.right,up:solved.up,viewport,clip,safe,box,projection,scale:worldScale3D(box),radius,near,far,focal:viewport.height/(2*Math.tan(Math.PI/8)),fit:{enabled:autoFit,iterations:solved.iterations,verified:solved.fits,fallback:solved.fallback}};
  const {right:r,up:u,forward:f}=frame;
  return Object.freeze({...frame,matrix:clipMatrix(frame),rotation:new Float32Array([r.x,u.x,f.x,r.y,u.y,f.y,r.z,u.z,f.z])});
}
export function projectWorld3D(point:Vec3,frame:WorldCameraFrame):{x:number;y:number;depth:number;visible:boolean}{
  const q=sub(point,frame.position),depth=dot(q,frame.forward),scale=frame.projection==='perspective'?frame.focal/depth:frame.viewport.width/frame.radius;
  const x=frame.viewport.left+frame.viewport.width/2+dot(q,frame.right)*scale,y=frame.viewport.top+frame.viewport.height/2-dot(q,frame.up)*scale;
  return{x,y,depth,visible:Number.isFinite(x+y+depth)&&depth>=frame.near&&depth<=frame.far};
}
export function projectWorldNormalized3D(point:Vec3,frame:WorldCameraFrame){return projectWorld3D({x:point.x*frame.scale.x,y:point.y*frame.scale.y,z:point.z*frame.scale.z},frame);}
export function clipWorldSegment3D(a:Vec3,b:Vec3,frame:WorldCameraFrame):[{x:number;y:number;depth:number;visible:boolean},{x:number;y:number;depth:number;visible:boolean}]|undefined{
  if(![a.x,a.y,a.z,b.x,b.y,b.z].every(Number.isFinite))return;
  const worldA={x:a.x*frame.scale.x,y:a.y*frame.scale.y,z:a.z*frame.scale.z},worldB={x:b.x*frame.scale.x,y:b.y*frame.scale.y,z:b.z*frame.scale.z};
  const da=dot(sub(worldA,frame.position),frame.forward),db=dot(sub(worldB,frame.position),frame.forward),delta=db-da;let low=0,high=1;
  if(delta===0){if(da<frame.near||da>frame.far)return;}else{let lo=(frame.near-da)/delta,hi=(frame.far-da)/delta;if(lo>hi)[lo,hi]=[hi,lo];low=Math.max(low,lo);high=Math.min(high,hi);if(low>high)return;}
  const d=sub(worldB,worldA);return[projectWorld3D(add(worldA,mul(d,low)),frame),projectWorld3D(add(worldA,mul(d,high)),frame)];
}
