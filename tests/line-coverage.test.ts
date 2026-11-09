import test from 'node:test';
import assert from 'node:assert/strict';
import {capsuleQuad, segmentCoverage, strokeCoverage, strokeRegion, type StrokePixel} from '../src/line-coverage-geometry.js';
import {LineCoverageRenderer} from '../src/render-line-coverage.js';
import {LineStripRenderer} from '../src/render-line-strip.js';
import type {DrawPacket} from '../src/contracts.js';
import {containedRasterClip, rasterTargetForRect} from '../src/raster-clip.js';

const cross=(a:StrokePixel,b:StrokePixel,c:StrokePixel)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
const triangle=(p:StrokePixel,a:StrokePixel,b:StrokePixel,c:StrokePixel)=>{const values=[cross(a,b,p),cross(b,c,p),cross(c,a,p)];return values.every(v=>v>=-1e-8)||values.every(v=>v<=1e-8);};
const inside=(p:StrokePixel,quad:readonly StrokePixel[])=>quad.length===4&&(triangle(p,quad[0]!,quad[1]!,quad[2]!)||triangle(p,quad[1]!,quad[2]!,quad[3]!));

test('independent capsule hull covers the documented sharp-spike counterexample and all 96 original probes',()=>{
  const point={x:100.5,y:99.5},a={x:99.98,y:0},b={x:100,y:100},c={x:100.02,y:0};
  assert.equal(strokeCoverage(point,[a,b,c],2),1);
  assert.ok(inside(point,capsuleQuad(a,b,2))&&inside(point,capsuleQuad(b,c,2)));
  const signal=(i:number)=>i%997===0?1.2:i%991===0?-1.2:.7*Math.sin(i*.19);
  const projected=(i:number)=>({x:100+i/47999*800,y:100+(signal(i)+1.3)/2.6*420});
  let checked=0;
  for(let i=2;i<47998;i++)if(i%997===0||i%991===0){const p=projected(i),pixel={x:Math.floor(p.x)+.5,y:Math.floor(p.y)+.5};
    assert.equal(strokeCoverage(pixel,[projected(i-1),p,projected(i+1)],2),1);
    assert.ok(inside(pixel,capsuleQuad(projected(i-1),p,2))||inside(pixel,capsuleQuad(p,projected(i+1),2)));checked++;
  }
  assert.equal(checked,96);
});

test('bounded capsule hull covers AA support at every direction, short segment and DPR-scaled width',()=>{
  for(const width of [.5,2,8])for(const distance of [0,1e-4,10,100])for(let angle=0;angle<Math.PI*2;angle+=.37){
    const a={x:42.3,y:56.7},b={x:a.x+Math.cos(angle)*distance,y:a.y+Math.sin(angle)*distance},quad=capsuleQuad(a,b,width);
    const radius=width/2+.499;
    for(const t of [0,.5,1])for(let phase=0;phase<Math.PI*2;phase+=.43){
      const point={x:a.x+(b.x-a.x)*t+Math.cos(phase)*radius,y:a.y+(b.y-a.y)*t+Math.sin(phase)*radius};
      if(segmentCoverage(point,a,b,width)>0)assert.ok(inside(point,quad));
    }
    const xs=quad.map(v=>v.x),ys=quad.map(v=>v.y);
    assert.ok(Math.max(...xs)-Math.min(...xs)<=Math.abs(b.x-a.x)+(width+2)*Math.SQRT2+1e-8);
    assert.ok(Math.max(...ys)-Math.min(...ys)<=Math.abs(b.y-a.y)+(width+2)*Math.SQRT2+1e-8);
  }
});

test('coverage union applies alpha once for overlapping segments and preserves NaN/Infinity gaps',()=>{
  const points=[{x:0,y:0},{x:1,y:100},{x:2,y:0},{x:3,y:100}],pixel={x:1.5,y:50};
  assert.equal(strokeCoverage(pixel,points,8)*.5,.5);
  assert.equal(strokeCoverage(pixel,[...points,...points.slice().reverse()],8)*.5,.5);
  const gap=[{x:0,y:0},{x:2,y:0},{x:3,y:NaN},{x:6,y:0},{x:8,y:0}];
  assert.equal(strokeCoverage({x:4,y:0},gap,2),0);
  assert.equal(strokeCoverage({x:2.5,y:0},gap,2),1);
  assert.equal(segmentCoverage(pixel,{x:0,y:0},{x:Infinity,y:0},2),0);
});

test('scratch ROI uses backing-pixel clip intersection, bottom origin, and stacked/DPR bounds',()=>{
  const region=strokeRegion({left:10,top:20,width:200,height:100},{left:10,top:70,width:200,height:10},2,500,400)!;
  assert.deepEqual(region,{viewport:{x:20,y:160,width:400,height:200},region:{x:20,y:240,width:400,height:20},offsetX:0,offsetY:80});
  assert.equal(strokeRegion({left:0,top:0,width:100,height:100},{left:200,top:0,width:10,height:10},1,100,100),undefined);
  assert.deepEqual(strokeRegion({left:-20,top:-10,width:100,height:100},{left:-20,top:-10,width:100,height:100},1,100,100)?.region,{x:0,y:10,width:80,height:90});
});

/** Records API/state semantics only. The separate visible test compiles GLSL
 * and checks real pixels; this mock deliberately does not pretend to rasterize. */
class GL {
  [key:string]:any;
  drawingBufferWidth=1000;drawingBufferHeight=600;identity=0;
  enabled=new Set<number>();parameters=new Map<number,any>();textures=new Map<number,any>();samplers=new Map<number,any>();
  deleted=new Set<any>();draws:any[]=[];uploads:any[]=[];allocations:any[]=[];clears:any[]=[];uniforms=new Map<string,any>();
  failFramebuffer=false;failDraw=false;createdTextures=0;
  constructor(){
    const names='VERTEX_SHADER FRAGMENT_SHADER COMPILE_STATUS LINK_STATUS DRAW_FRAMEBUFFER READ_FRAMEBUFFER DRAW_FRAMEBUFFER_BINDING READ_FRAMEBUFFER_BINDING VIEWPORT SCISSOR_BOX COLOR_CLEAR_VALUE COLOR_WRITEMASK CURRENT_PROGRAM VERTEX_ARRAY_BINDING ARRAY_BUFFER_BINDING ACTIVE_TEXTURE TEXTURE_BINDING_2D SAMPLER_BINDING SCISSOR_TEST BLEND DEPTH_TEST STENCIL_TEST CULL_FACE RASTERIZER_DISCARD SAMPLE_ALPHA_TO_COVERAGE SAMPLE_COVERAGE DITHER BLEND_SRC_RGB BLEND_SRC_ALPHA BLEND_DST_RGB BLEND_DST_ALPHA BLEND_EQUATION_RGB BLEND_EQUATION_ALPHA TEXTURE0 TEXTURE_2D COLOR_ATTACHMENT0 FRAMEBUFFER_COMPLETE MAX_TEXTURE_SIZE TEXTURE_MIN_FILTER TEXTURE_MAG_FILTER TEXTURE_WRAP_S TEXTURE_WRAP_T NEAREST CLAMP_TO_EDGE R8 MAX ONE FUNC_ADD SRC_ALPHA ONE_MINUS_SRC_ALPHA ARRAY_BUFFER DYNAMIC_DRAW FLOAT TRIANGLE_STRIP COLOR_BUFFER_BIT'.split(' ');
    names.forEach((name,index)=>this[name]=index+1);
    this.parameters.set(this.ACTIVE_TEXTURE,this.TEXTURE0+3);
    this.parameters.set(this.DRAW_FRAMEBUFFER_BINDING,{external:'draw'});this.parameters.set(this.READ_FRAMEBUFFER_BINDING,{external:'read'});
    this.parameters.set(this.VIEWPORT,[2,3,100,101]);this.parameters.set(this.SCISSOR_BOX,[1,2,99,100]);
    this.parameters.set(this.COLOR_CLEAR_VALUE,[.2,.3,.4,.5]);this.parameters.set(this.COLOR_WRITEMASK,[false,true,false,true]);
    for(const key of [this.CURRENT_PROGRAM,this.VERTEX_ARRAY_BINDING,this.ARRAY_BUFFER_BINDING])this.parameters.set(key,{external:key});
    for(const key of [this.BLEND_SRC_RGB,this.BLEND_SRC_ALPHA,this.BLEND_DST_RGB,this.BLEND_DST_ALPHA,this.BLEND_EQUATION_RGB,this.BLEND_EQUATION_ALPHA])this.parameters.set(key,key*7);
    this.parameters.set(this.MAX_TEXTURE_SIZE,4096);this.textures.set(this.TEXTURE0,{external:'texture0'});this.samplers.set(0,{external:'sampler0'});
    this.enabled.add(this.DEPTH_TEST);this.enabled.add(this.STENCIL_TEST);this.enabled.add(this.DITHER);this.enabled.add(this.SCISSOR_TEST);
  }
  snapshot(){return JSON.stringify({parameters:[...this.parameters],textures:[...this.textures],samplers:[...this.samplers],enabled:[...this.enabled].sort()});}
  getParameter(key:number){if(key===this.TEXTURE_BINDING_2D)return this.textures.get(this.parameters.get(this.ACTIVE_TEXTURE))??null;if(key===this.SAMPLER_BINDING)return this.samplers.get(this.parameters.get(this.ACTIVE_TEXTURE)-this.TEXTURE0)??null;if(!this.parameters.has(key))throw Error('Unknown GL parameter '+key);return this.parameters.get(key);}
  isEnabled(key:number){return this.enabled.has(key);}enable(key:number){this.enabled.add(key);}disable(key:number){this.enabled.delete(key);}isContextLost(){return false;}
  make(type:string){return{type,id:++this.identity};}
  createShader(){return this.make('shader');}shaderSource(){}compileShader(){}getShaderParameter(){return true;}getShaderInfoLog(){return'';}deleteShader(value:any){this.deleted.add(value);}
  createProgram(){return this.make('program');}attachShader(){}linkProgram(){}getProgramParameter(){return true;}getProgramInfoLog(){return'';}deleteProgram(value:any){this.deleted.add(value);}
  createVertexArray(){return this.make('vao');}deleteVertexArray(value:any){this.deleted.add(value);}bindVertexArray(value:any){this.parameters.set(this.VERTEX_ARRAY_BINDING,value);}
  createFramebuffer(){return this.make('fbo');}deleteFramebuffer(value:any){this.deleted.add(value);}bindFramebuffer(target:number,value:any){this.parameters.set(target===this.DRAW_FRAMEBUFFER?this.DRAW_FRAMEBUFFER_BINDING:this.READ_FRAMEBUFFER_BINDING,value);}
  framebufferTexture2D(){}checkFramebufferStatus(){return this.failFramebuffer?0:this.FRAMEBUFFER_COMPLETE;}
  createTexture(){this.createdTextures++;return this.make('texture');}deleteTexture(value:any){this.deleted.add(value);}texParameteri(){}texStorage2D(...values:any[]){this.allocations.push(values);}
  activeTexture(value:number){this.parameters.set(this.ACTIVE_TEXTURE,value);}bindTexture(_target:number,value:any){this.textures.set(this.parameters.get(this.ACTIVE_TEXTURE),value);}bindSampler(unit:number,value:any){this.samplers.set(unit,value);}
  createBuffer(){return this.make('buffer');}deleteBuffer(value:any){this.deleted.add(value);}bindBuffer(_target:number,value:any){this.parameters.set(this.ARRAY_BUFFER_BINDING,value);}
  bufferData(){}bufferSubData(_target:number,offset:number,values:Float32Array,first:number,length:number){this.uploads.push({offset,values:[...values.subarray(first,first+length)]});}
  enableVertexAttribArray(){}vertexAttribDivisor(){}vertexAttribPointer(){}
  viewport(...values:number[]){this.parameters.set(this.VIEWPORT,values);}scissor(...values:number[]){this.parameters.set(this.SCISSOR_BOX,values);}
  clearColor(...values:number[]){this.parameters.set(this.COLOR_CLEAR_VALUE,values);}colorMask(...values:boolean[]){this.parameters.set(this.COLOR_WRITEMASK,values);}
  clear(){this.clears.push({framebuffer:this.parameters.get(this.DRAW_FRAMEBUFFER_BINDING),scissor:this.parameters.get(this.SCISSOR_BOX)});}
  blendEquationSeparate(rgb:number,alpha:number){this.parameters.set(this.BLEND_EQUATION_RGB,rgb);this.parameters.set(this.BLEND_EQUATION_ALPHA,alpha);}
  blendFuncSeparate(sr:number,dr:number,sa:number,da:number){this.parameters.set(this.BLEND_SRC_RGB,sr);this.parameters.set(this.BLEND_DST_RGB,dr);this.parameters.set(this.BLEND_SRC_ALPHA,sa);this.parameters.set(this.BLEND_DST_ALPHA,da);}
  useProgram(value:any){this.parameters.set(this.CURRENT_PROGRAM,value);}getUniformLocation(_program:any,name:string){return name;}
  uniform1f(name:string,value:number){this.uniforms.set(name,value);}uniform1i(name:string,value:number){this.uniforms.set(name,value);}uniform2f(name:string,...values:number[]){this.uniforms.set(name,values);}uniform4f(name:string,...values:number[]){this.uniforms.set(name,values);}uniform4fv(name:string,values:number[]){this.uniforms.set(name,[...values]);}
  drawArraysInstanced(_mode:number,_start:number,count:number,instances:number){if(this.failDraw)throw Error('injected draw failure');this.draws.push({kind:'mask',count,instances,equation:this.parameters.get(this.BLEND_EQUATION_RGB),framebuffer:this.parameters.get(this.DRAW_FRAMEBUFFER_BINDING)});}
  drawArrays(_mode:number,_start:number,count:number){this.draws.push({kind:'composite',count,equation:this.parameters.get(this.BLEND_EQUATION_RGB),framebuffer:this.parameters.get(this.DRAW_FRAMEBUFFER_BINDING),viewport:this.parameters.get(this.VIEWPORT),scissor:this.parameters.get(this.SCISSOR_BOX)});}
}
const rect={left:100,top:80,width:800,height:420};
const packet=(overrides:Partial<DrawPacket>={}):DrawPacket=>({id:1,revision:1,strokeGroup:17,positions:new Float32Array([0,0,1,1,2,0,3,1,4,0]),count:5,dimensions:2,mode:'line',color:[1,0,0,.5],thickness:2,pointSize:0,origin:{x:0,y:0,z:0},domain:{x:{start:0,end:4},y:{start:-1,end:2}},monotonicX:true,strictlyMonotonicX:true,...overrides});
const setup=()=>{const gl=new GL(),renderer=new LineCoverageRenderer(gl as unknown as WebGL2RenderingContext);return{gl,renderer};};

test('multiple same-stroke blocks accumulate one MAX mask and one alpha composite, then restore GL state',()=>{
  const {gl,renderer}=setup(),before=gl.snapshot();renderer.beginFrame();
  const one=packet({drawFirst:1,drawCount:3}),two=packet({id:2,drawFirst:1,drawCount:2});
  assert.equal(renderer.drawGroup([one,two],rect,1),true);
  assert.deepEqual(gl.draws.map(d=>[d.kind,d.instances??1,d.equation]),[['mask',2,gl.MAX],['mask',1,gl.MAX],['composite',1,gl.FUNC_ADD]]);
  assert.equal(renderer.stats.compositePasses,1);assert.equal(renderer.stats.submittedSamples,5);assert.equal(gl.clears.length,1);
  assert.deepEqual(gl.draws.at(-1).framebuffer,{external:'draw'});assert.equal(gl.snapshot(),before);
  renderer.dispose();assert.equal(renderer.stats.scratchBytes,0);assert.equal(renderer.stats.residentBufferBytes,0);
});

test('candidate keeps one reusable bounded ROI texture and updates only appended position bytes',()=>{
  const {gl,renderer}=setup(),input=packet({clipRect:{left:100,top:100,width:800,height:10}});
  renderer.beginFrame();renderer.draw(input,rect,1);renderer.endFrame();
  assert.equal(renderer.stats.scratchBytes,1024*16);assert.equal(gl.createdTextures,1);
  renderer.beginFrame();renderer.draw(input,rect,1);renderer.endFrame();assert.equal(gl.uploads.length,1);assert.equal(gl.createdTextures,1);
  const positions=new Float32Array([0,0,1,1,2,0,3,1,4,0,5,1]);
  renderer.draw({...input,revision:2,previousRevision:1,updateFrom:4,count:6,positions},rect,1);
  assert.deepEqual(gl.uploads.at(-1),{offset:32,values:[4,0,5,1]});
  renderer.beginFrame();renderer.endFrame();assert.equal(renderer.stats.residentBufferBytes,0);renderer.dispose();
});

test('mixed group/style and invalid ranges fail before GL changes; dashed lines retain fallback',()=>{
  const {gl,renderer}=setup(),before=gl.snapshot();
  assert.throws(()=>renderer.drawGroup([packet(),packet({id:2,strokeGroup:18})],rect,1),/one stroke/);
  assert.throws(()=>renderer.drawGroup([packet(),packet({id:2,color:[0,1,0,.5]})],rect,1),/one stroke/);
  assert.throws(()=>renderer.draw(packet(),rect,1,{first:4,count:3}),/range/);
  assert.equal(renderer.canDraw(packet({dashPattern:[2,2]})),false);assert.equal(renderer.draw(packet({dashPattern:[2,2]}),rect,1),false);
  assert.equal(gl.snapshot(),before);assert.equal(gl.draws.length,0);renderer.dispose();
});

test('failed texture setup and thrown draw restore framebuffer/viewport/scissor/blend/texture state',()=>{
  const {gl,renderer}=setup(),before=gl.snapshot();gl.failFramebuffer=true;
  assert.throws(()=>renderer.draw(packet(),rect,1),/incomplete/);assert.equal(gl.snapshot(),before);assert.equal(renderer.stats.scratchBytes,0);
  assert.equal([...gl.deleted].filter(value=>value.type==='texture').length,1);
  gl.failFramebuffer=false;gl.failDraw=true;assert.throws(()=>renderer.draw(packet(),rect,1),/draw failure/);assert.equal(gl.snapshot(),before);
  gl.failDraw=false;renderer.draw(packet(),rect,1);assert.equal(gl.snapshot(),before);renderer.dispose();
});

test('explicit LineStrip coverage option delegates without activating the old miter offset cache',()=>{
  const gl=new GL(),renderer=new LineStripRenderer(gl as unknown as WebGL2RenderingContext,{coverageUnion:true,cacheOffsets:true});
  renderer.beginFrame();assert.equal(renderer.draw(packet(),rect,1),true);renderer.endFrame();
  assert.equal(renderer.getCoverageStats()?.compositePasses,1);assert.equal(renderer.getOffsetStats(),undefined);
  renderer.dispose();assert.equal(renderer.canDraw(packet()),false);
});

test('contained coverage requires actual target metadata and restores a smaller custom FBO',()=>{
  const gl=new GL(),renderer=new LineCoverageRenderer(gl as unknown as WebGL2RenderingContext,{clipPolicy:'contained'}),before=gl.snapshot();
  const small={left:3.2,top:4.1,width:80,height:50},clip={left:5.2,top:10.2,width:40.4,height:9.7};
  assert.throws(()=>renderer.draw(packet(),small,1),/explicit/);assert.equal(gl.snapshot(),before);
  const target=rasterTargetForRect(gl.parameters.get(gl.DRAW_FRAMEBUFFER_BINDING),128,64,small,1),input=packet({clipRect:clip});
  renderer.beginFrame();renderer.draw(input,small,1,undefined,target);renderer.endFrame();
  const expected=containedRasterClip(small,clip,target)!;
  assert.deepEqual(expected,{x:6,y:45,width:39,height:8});
  assert.deepEqual(gl.draws.at(-1).scissor,[expected.x,expected.y,expected.width,expected.height]);
  assert.deepEqual(gl.draws.at(-1).viewport,gl.draws.at(-1).scissor);assert.equal(gl.snapshot(),before);
  assert.equal(renderer.stats.scratchBytes,64*8);
  assert.throws(()=>renderer.draw(input,small,1,undefined,{...target,framebuffer:null}),/destination framebuffer/);
  assert.equal(gl.snapshot(),before);renderer.dispose();assert.equal(renderer.stats.scratchBytes,0);
});

test('contained empty pane does not expand or allocate, retains live data and releases on actual removal',()=>{
  const gl=new GL(),renderer=new LineCoverageRenderer(gl as unknown as WebGL2RenderingContext,{clipPolicy:'contained',stateScope:'frame'});
  const target=rasterTargetForRect(gl.parameters.get(gl.DRAW_FRAMEBUFFER_BINDING),1000,600,rect,1),input=packet();
  renderer.beginFrame();renderer.draw(input,rect,1,undefined,target);renderer.endFrame();
  const bytes=renderer.stats.residentBufferBytes,allocations=gl.allocations.length;
  renderer.beginFrame();renderer.draw({...input,clipRect:{left:110.1,top:90,width:.8,height:30}},rect,1,undefined,target);renderer.endFrame();
  assert.equal(renderer.stats.drawCalls,0);assert.equal(renderer.stats.stateCaptures,0);assert.equal(gl.allocations.length,allocations);assert.equal(renderer.stats.residentBufferBytes,bytes);
  renderer.beginFrame();renderer.endFrame();assert.equal(renderer.stats.residentBufferBytes,0);renderer.dispose();
});

// 追加到 tests/line-coverage.test.ts；复用其中真实renderer导入及GL调用记录器。
test('default strip uses conservative coverage and composites translucent joins once with its original VBO',()=>{
  const gl=new GL(),uploads:any[]=[];gl.bufferSubData=(_target:number,offset:number,data:Float32Array,first=0,count=data.length-first)=>uploads.push({offset,values:[...data.subarray(first,first+count)]});
  const renderer=new LineStripRenderer(gl as unknown as WebGL2RenderingContext),input=packet();
  const before=gl.snapshot();renderer.beginFrame();renderer.draw(input,rect,1);renderer.endFrame();
  assert.equal(renderer.getCoverageStats()?.maskPasses,1);assert.equal(renderer.getCoverageStats()?.compositePasses,1);
  assert.deepEqual(gl.draws.map(v=>[v.kind,v.count,v.instances??1,v.equation]),[['mask',4,4,gl.MAX],['composite',4,1,gl.FUNC_ADD]]);
  assert.deepEqual(uploads,[{offset:0,values:[0,0,0,0,0,0,0,0,1,1,1,1,2,0,2,0,3,1,3,1,4,0,4,0,4,0,4,0]}]);
  assert.equal(renderer.stats.vertices,20);assert.equal(renderer.stats.uploadedBytes,112);assert.equal(gl.snapshot(),before);renderer.dispose();assert.equal(renderer.getCoverageStats()?.scratchBytes,0);
});

test('default strip pan and zoom reuse its buffer and append keeps the original duplicated-tail offsets',()=>{
  const gl=new GL(),uploads:any[]=[];gl.bufferSubData=(_target:number,offset:number,data:Float32Array,first=0,count=data.length-first)=>uploads.push({offset,values:[...data.subarray(first,first+count)]});
  const renderer=new LineStripRenderer(gl as unknown as WebGL2RenderingContext),input=packet();
  for(const domain of [input.domain,{x:{start:1,end:3},y:{start:-2,end:4}},{x:{start:2,end:4},y:{start:-1,end:2}}]){renderer.beginFrame();renderer.draw({...input,domain},rect,1);renderer.endFrame();}
  assert.equal(uploads.length,1);assert.equal(renderer.stats.uploads,1);
  const appended=packet({revision:2,previousRevision:1,updateFrom:4,count:6,positions:new Float32Array([0,0,1,1,2,0,3,1,4,0,5,1])});
  renderer.beginFrame();renderer.draw(appended,rect,1);renderer.endFrame();
  assert.deepEqual(uploads.at(-1),{offset:80,values:[4,0,4,0,5,1,5,1,5,1,5,1]});assert.equal(renderer.stats.uploads,2);assert.equal(renderer.stats.uploadedBytes,160);
  renderer.beginFrame();renderer.endFrame();assert.equal([...gl.deleted].filter(v=>v.type==='buffer').length,1);renderer.dispose();
});

test('default strip groups one logical stroke into one coverage union while separate strokes composite separately',()=>{
  const gl=new GL(),renderer=new LineStripRenderer(gl as unknown as WebGL2RenderingContext);renderer.beginFrame();
  renderer.drawGroup([packet(),packet({id:2})],rect,1);assert.equal(renderer.getCoverageStats()?.maskPasses,1);assert.equal(renderer.getCoverageStats()?.compositePasses,1);
  renderer.draw(packet({id:3,strokeGroup:18,color:[0,1,0,.5]}),rect,1);assert.equal(renderer.getCoverageStats()?.compositePasses,2);
  renderer.endFrame();renderer.dispose();assert.equal([...gl.deleted].filter(v=>v.type==='buffer').length,3);
});

test('default strip failed draw restores caller GL state and releases the retained upload on disposal',()=>{
  const gl=new GL(),renderer=new LineStripRenderer(gl as unknown as WebGL2RenderingContext),before=gl.snapshot();gl.failDraw=true;renderer.beginFrame();
  assert.throws(()=>renderer.draw(packet(),rect,1),/injected draw failure/);assert.equal(gl.snapshot(),before);renderer.dispose();assert.equal([...gl.deleted].filter(v=>v.type==='buffer').length,1);assert.equal(renderer.getCoverageStats()?.scratchBytes,0);
});
