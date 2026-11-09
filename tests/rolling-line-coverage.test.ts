import test from 'node:test';
import assert from 'node:assert/strict';
import {LineStripRenderer} from '../src/render-line-strip.js';
import {DataRenderer} from '../src/render.js';
import {LineDisplayArena} from '../src/line-display-arena.js';
import {LineDisplayCache, type LineDisplayRequest} from '../src/line-display-cache.js';
import {DataSetXY} from '../src/core/data.js';
import {PagedColumns} from '../src/core/paged-columns.js';
import {getColumnOrder} from '../src/data-order.js';
import type {DrawPacket} from '../src/contracts.js';
import {rasterTargetForRect} from '../src/raster-clip.js';
// Recording boundary copied from the established coverage tests. It records
// state, source buffers and raster commands, and does not simulate rasterization.
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
  bufferData(_target:number,_data:number|Float32Array){}bufferSubData(_target:number,offset:number,values:Float32Array,first:number,length:number){this.uploads.push({offset,values:[...values.subarray(first,first+length)]});}
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

class RecordingGL extends GL {
  storage=new Map<any,Float32Array>(); attribs:any[]=[]; masks:any[]=[]; composites:any[]=[]; throwAt=Infinity; queries=0;
  getParameter(key:number){this.queries++;return super.getParameter(key);}
  getAttribLocation(){return 0;} disableVertexAttribArray(){} vertexAttrib2f(){} uniform1fv(){}
  bufferData(_target:number,data:number|Float32Array){const values=typeof data==='number'?new Float32Array(data/4):data.slice();this.storage.set(this.parameters.get(this.ARRAY_BUFFER_BINDING),values);this.allocations.push({bytes:values.byteLength});}
  bufferSubData(_target:number,offset:number,values:Float32Array,first=0,length=values.length-first){const data=values.subarray(first,first+length);this.storage.get(this.parameters.get(this.ARRAY_BUFFER_BINDING))!.set(data,offset/4);this.uploads.push({offset,values:[...data]});}
  vertexAttribPointer(...args:any[]){this.attribs.push(args);}
  drawArraysInstanced(mode:number,start:number,count:number,instances:number){
    if(this.masks.length===this.throwAt)throw Error('later stroke failure');
    this.masks.push({count,instances,positions:[...this.storage.get(this.parameters.get(this.ARRAY_BUFFER_BINDING))!],domain:this.uniforms.get('u_domain'),viewport:this.parameters.get(this.VIEWPORT),scissor:this.parameters.get(this.SCISSOR_BOX)});
    super.drawArraysInstanced(mode,start,count,instances);
  }
  drawArrays(mode:number,start:number,count:number){this.composites.push({color:this.uniforms.get('u_color'),viewport:this.parameters.get(this.VIEWPORT),scissor:this.parameters.get(this.SCISSOR_BOX)});super.drawArrays(mode,start,count);}
}
const rect={left:100,top:80,width:800,height:420};
const packet=(overrides:Partial<DrawPacket>={}):DrawPacket=>({id:1,revision:1,strokeGroup:17,dirtySampleRanges:[{first:0,count:5}],positions:new Float32Array([0,0,1,1,2,NaN,3,1,4,0]),count:5,dimensions:2,mode:'line',color:[1,0,0,.5],thickness:2,pointSize:0,origin:{x:0,y:0,z:0},domain:{x:{start:0,end:4},y:{start:-1,end:2}},monotonicX:true,strictlyMonotonicX:true,...overrides});
function dataRenderer(gl:RecordingGL){const canvas=Object.assign(new EventTarget(),{width:1000,height:600,getContext:()=>gl});return new DataRenderer(canvas as unknown as HTMLCanvasElement,{renderer:'webgl2'});}
function groups(){return [packet(),packet({id:2,drawFirst:1,drawCount:3}),packet({id:3,strokeGroup:18,color:[0,1,0,.3],clipRect:{left:100,top:290,width:800,height:100}})];}
function stats(renderer:DataRenderer){return (renderer as any).lineStrip.getCoverageStats();}
function defaultTarget(gl:RecordingGL){gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,null);}

test('block coverage uploads exact two-float positions, retains NaNs, and unions block alpha once',()=>{
 const gl=new RecordingGL(),r=new LineStripRenderer(gl as unknown as WebGL2RenderingContext),before=gl.snapshot(),p=packet();
 r.beginFrame();r.drawGroup([p,packet({id:2})],rect,1);r.endFrame();
 assert.deepEqual(gl.uploads.map(x=>x.values),[[...p.positions],[...p.positions]]);
 assert.equal(r.stats.uploadedBytes,80);assert.ok(gl.attribs.every(a=>a[4]===8));
 assert.deepEqual(gl.draws.map(d=>[d.kind,d.instances??1]),[['mask',4],['mask',4],['composite',1]]);
 assert.equal(gl.snapshot(),before);r.dispose();
});

test('disjoint cap and tail patches update exact cached GPU positions in coverage and legacy strip uploaders',()=>{
 for(const legacy of [false,true]){
  const gl=new RecordingGL(),r=new LineStripRenderer(gl as unknown as WebGL2RenderingContext,legacy?{directionMode:'relative'}:{});
  const positions=Float32Array.from({length:200},(_,i)=>i%2?Math.sin(i):i/2);
  const initial=packet({positions,count:100,dirtySampleRanges:[{first:0,count:100}]});
  r.beginFrame();r.draw(initial,rect,1);r.endFrame();const oldUploads=gl.uploads.length;
  const changed=positions.slice();changed[2]=.75;changed[3]=NaN;changed[196]=98.5;changed[197]=.8;
  const update={...initial,revision:2,previousRevision:1,positions:changed,dirtySampleRanges:[{first:98,count:1},{first:1,count:1}]};
  r.beginFrame();r.draw(update,rect,1);r.endFrame();
  assert.equal(gl.uploads.length-oldUploads,2);assert.equal(gl.uploads.slice(oldUploads).reduce((n,u)=>n+u.values.length*4,0),legacy?32:16);
  const retained=[...gl.storage.values()][0]!;
  for(let i=0;i<100;i++)for(let c=0;c<2;c++)assert.ok(Object.is(retained[legacy?(i+1)*4+c:i*2+c],changed[i*2+c]));
  const beforeMiss=gl.uploads.length;
  r.beginFrame();r.draw({...update,revision:4,previousRevision:3},rect,1);r.endFrame();
  assert.equal(gl.uploads.length-beforeMiss,1);assert.equal(gl.uploads.at(-1)!.values.length,legacy?408:200);
  r.dispose();
 }
});

test('growing coverage VBO fully initializes retained values even when patches only describe the tail',()=>{
 const gl=new RecordingGL(),r=new LineStripRenderer(gl as unknown as WebGL2RenderingContext),a=packet();
 r.beginFrame();r.draw(a,rect,1);r.endFrame();const values=Float32Array.from({length:200},(_,i)=>i);
 r.beginFrame();r.draw({...a,revision:2,previousRevision:1,positions:values,count:100,dirtySampleRanges:[{first:99,count:1}]},rect,1);r.endFrame();
 assert.deepEqual(gl.uploads.at(-1)!.values,[...values]);r.dispose();
});

test('all-block DataRenderer captures actual GL once and restores arbitrary state after ordered stroke groups',()=>{
 const gl=new RecordingGL(),r=dataRenderer(gl);defaultTarget(gl);const before=gl.snapshot();
 r.render(groups(),rect,1,{clear:false});
 assert.equal(stats(r).stateCaptures,1);assert.equal(stats(r).stateRestores,1);assert.equal(stats(r).knownFrameBaselines,0);assert.equal(gl.snapshot(),before);
 assert.deepEqual(gl.draws.map(d=>d.kind),['mask','mask','composite','mask','composite']);
 const uploads=gl.uploads.length;r.render(groups(),rect,1,{clear:false});assert.equal(gl.uploads.length,uploads);assert.equal(stats(r).stateCaptures,1);assert.equal(gl.snapshot(),before);r.dispose();
});

test('ordinary monotone lines capture real incoming GL once without block or dirty metadata',()=>{
 const gl=new RecordingGL(),r=dataRenderer(gl);defaultTarget(gl);const before=gl.snapshot();
 const ordinary=groups().map(p=>({...p,strokeGroup:undefined,dirtySampleRanges:undefined}));
 const queriesBefore=gl.queries;r.render(ordinary,rect,1,{clear:false});const queries=gl.queries-queriesBefore;
 console.log(JSON.stringify({case:'ordinary-coverage-current-queries',queries,captures:stats(r).stateCaptures}));
 assert.equal(stats(r).stateCaptures,1);assert.equal(stats(r).stateRestores,1);assert.equal(stats(r).knownFrameBaselines,0);assert.equal(gl.snapshot(),before);
 assert.equal(gl.masks.length,3);assert.equal(gl.composites.length,3);
 // A caller-supplied target deliberately selects the existing safe fallback.
 const fallbackGL=new RecordingGL(),fallback=dataRenderer(fallbackGL);defaultTarget(fallbackGL);const q=fallbackGL.queries;
 fallback.render(ordinary,rect,1,{clear:false,rasterTarget:rasterTargetForRect(null,1000,600,rect,1)});
 const fallbackQueries=fallbackGL.queries-q;
 assert.equal(stats(fallback).stateCaptures,3);assert.equal(stats(fallback).stateRestores,3);
 assert.ok(queries<fallbackQueries,`${queries} queries must be below per-stroke ${fallbackQueries}`);
 assert.deepEqual(gl.masks,fallbackGL.masks);assert.deepEqual(gl.composites,fallbackGL.composites);
 assert.deepEqual(gl.uploads,fallbackGL.uploads);
 console.log(JSON.stringify({case:'ordinary-coverage-state-queries',batched:queries,perStroke:fallbackQueries,batchedCaptures:stats(r).stateCaptures,perStrokeCaptures:stats(fallback).stateCaptures}));
 r.dispose();fallback.dispose();
});

test('ordinary captured batch restores arbitrary state after a later draw throws and starts fresh',()=>{
 const gl=new RecordingGL(),r=dataRenderer(gl);defaultTarget(gl);const before=gl.snapshot();
 const ordinary=groups().map(p=>({...p,strokeGroup:undefined,dirtySampleRanges:undefined}));gl.throwAt=1;
 assert.throws(()=>r.render(ordinary,rect,1,{clear:false}),/later stroke failure/);
 assert.equal(gl.snapshot(),before);assert.equal(stats(r).stateCaptures,1);assert.equal(stats(r).stateRestores,1);
 gl.throwAt=Infinity;r.render(ordinary,rect,1,{clear:false});assert.equal(gl.snapshot(),before);assert.equal(stats(r).stateCaptures,1);r.dispose();
});

test('mixed point and ordinary-line draws keep per-stroke capture and the original command sequence',()=>{
 const results:any[]=[];
 for(const explicitTarget of [false,true]){
  const gl=new RecordingGL(),r=dataRenderer(gl);defaultTarget(gl);
  const ordinary=packet({strokeGroup:undefined,dirtySampleRanges:undefined});
  const packets=[ordinary,packet({id:4,mode:'points',strokeGroup:undefined,dirtySampleRanges:undefined}),{...ordinary,id:5}];
  r.render(packets,rect,1,{clear:false,...(explicitTarget?{rasterTarget:rasterTargetForRect(null,1000,600,rect,1)}:{})});
  assert.equal(stats(r).stateCaptures,2);assert.equal(stats(r).stateRestores,2);assert.equal(stats(r).knownFrameBaselines,0);
  results.push({masks:gl.masks,composites:gl.composites,uploads:gl.uploads,final:gl.snapshot()});r.dispose();
 }
 assert.deepEqual(results[0],results[1]);
});

test('context loss discards a captured batch and restoration captures only the new context state',()=>{
 const gl=new RecordingGL(),canvas=Object.assign(new EventTarget(),{width:1000,height:600,getContext:()=>gl});
 const r=new DataRenderer(canvas as unknown as HTMLCanvasElement,{renderer:'webgl2'});defaultTarget(gl);
 const ordinary=groups().map(p=>({...p,strokeGroup:undefined,dirtySampleRanges:undefined}));
 let lost=false,inject=true;gl.isContextLost=()=>lost;
 const draw=gl.drawArraysInstanced.bind(gl);
 gl.drawArraysInstanced=(...args:Parameters<typeof draw>)=>{
  draw(...args);
  if(inject){inject=false;lost=true;const event=new Event('webglcontextlost',{cancelable:true});canvas.dispatchEvent(event);assert.equal(event.defaultPrevented,true);}
 };
 r.render(ordinary,rect,1,{clear:false});assert.equal(stats(r).stateCaptures,1);assert.equal(stats(r).stateRestores,0);
 const oldDraws=gl.draws.length;r.render(ordinary,rect,1,{clear:false});assert.equal(gl.draws.length,oldDraws);
 lost=false;canvas.dispatchEvent(new Event('webglcontextrestored'));defaultTarget(gl);
 const current=gl.snapshot();r.render(ordinary,rect,1,{clear:false});
 assert.equal(stats(r).stateCaptures,1);assert.equal(stats(r).stateRestores,1);assert.equal(gl.snapshot(),current);r.dispose();
});

test('all-block batch preserves the per-stroke mask/composite geometry, clips and draw order of the safe fallback',()=>{
 const all:any[]=[];
 for(const batch of [false,true]){const gl=new RecordingGL(),r=dataRenderer(gl);defaultTarget(gl);
  r.render(groups(),rect,1,{clear:false,...(batch?{}:{rasterTarget:rasterTargetForRect(null,1000,600,rect,1)})});
  assert.equal(stats(r).stateCaptures,batch?1:2);all.push({masks:gl.masks,composites:gl.composites,draws:gl.draws.map(d=>({...d,framebuffer:d.kind==='mask'?'mask':null})),clears:gl.clears.map(c=>({...c,framebuffer:'mask'}))});r.dispose();}
 assert.deepEqual(all[0],all[1]);
});

test('batch exception on a later stroke restores real incoming state and next invocation starts clean',()=>{
 const gl=new RecordingGL(),r=dataRenderer(gl);defaultTarget(gl);const before=gl.snapshot();gl.throwAt=2;
 assert.throws(()=>r.render(groups(),rect,1,{clear:false}),/later stroke failure/);assert.equal(gl.snapshot(),before);assert.equal(stats(r).stateCaptures,1);assert.equal(stats(r).stateRestores,1);
 gl.throwAt=Infinity;r.render(groups(),rect,1,{clear:false});assert.equal(gl.snapshot(),before);assert.equal(stats(r).stateCaptures,1);assert.equal(stats(r).stateRestores,1);r.dispose();
});

test('standalone, incompatible attributes and externally bound FBO renders retain per-stroke state captures',()=>{
 const gl=new RecordingGL(),s=new LineStripRenderer(gl as unknown as WebGL2RenderingContext),before=gl.snapshot();s.beginFrame();s.draw(packet(),rect,1);s.draw(packet({id:2,strokeGroup:18}),rect,1);s.endFrame();assert.equal(s.getCoverageStats()!.stateCaptures,2);assert.equal(gl.snapshot(),before);s.dispose();
 for(const mixed of [false,true]){const g=new RecordingGL(),r=dataRenderer(g);if(mixed)defaultTarget(g);
  const packets=[packet(),packet({id:2,strokeGroup:18,...(mixed?{pointRotations:new Float32Array(5)}:{})})];r.render(packets,rect,1,{clear:false});
  assert.equal(stats(r).stateCaptures,2);assert.equal(stats(r).stateRestores,2);assert.equal(stats(r).knownFrameBaselines,0);r.dispose();}
});

test('batch validation and framebuffer allocation failures also restore incoming state before propagating',()=>{
 for(const allocation of [false,true]){const gl=new RecordingGL(),r=dataRenderer(gl);defaultTarget(gl);const before=gl.snapshot();
  gl.failFramebuffer=allocation;
  const packets=allocation?groups():[packet(),packet({id:2,color:[0,1,0,.5]})];
  assert.throws(()=>r.render(packets,rect,1,{clear:false}),allocation?/incomplete/:/one stroke/);
  assert.equal(gl.snapshot(),before);assert.equal(stats(r).stateCaptures,1);assert.equal(stats(r).stateRestores,1);r.dispose();}
});

test('default strip sends wrapped shared arena views through one exact two-float GPU allocation',()=>{
 const gl=new RecordingGL(),r=new LineStripRenderer(gl as unknown as WebGL2RenderingContext),arena=new LineDisplayArena(8);
 const values=Float32Array.from({length:20},(_,i)=>i%2?(i===9?NaN:Math.sin(i)):i/2);
 const p=packet(),template={strokeGroup:p.strokeGroup!,origin:p.origin,domain:{x:{start:0,end:10},y:p.domain.y},color:p.color,thickness:p.thickness};
 const first=arena.update([{key:'stable',positions:values,first:0,count:8,strictlyMonotonicX:true}],template,1);
 const before=gl.snapshot();r.beginFrame();r.drawGroup(first.packets,rect,1);r.endFrame();assert.equal(gl.snapshot(),before);
 assert.equal(r.stats.uploadedBytes,72);assert.equal(gl.storage.size,1);const uploads=gl.uploads.length,allocations=gl.allocations.length;
 const wrapped=arena.update([{key:'stable',positions:values,first:2,count:8,strictlyMonotonicX:true}],template,1);
 assert.equal(wrapped.stats.wrapped,true);assert.equal(wrapped.packets.length,2);assert.ok(wrapped.packets.every(p=>p.dirtySampleRanges===undefined));
 assert.equal(wrapped.packets[0]!.id,wrapped.packets[1]!.id);
 r.beginFrame();r.drawGroup(wrapped.packets,rect,1);r.endFrame();
 assert.equal(gl.snapshot(),before);assert.equal(gl.storage.size,1);assert.equal(gl.allocations.length,allocations);
 assert.equal(gl.uploads.length-uploads,2);assert.equal(gl.uploads.slice(uploads).reduce((n,u)=>n+u.values.length*4,0),24);
 assert.deepEqual([...gl.storage.values()][0],wrapped.storage!.values);assert.deepEqual(gl.masks.map(m=>m.instances),[7,6,1]);
 assert.deepEqual(gl.attribs.slice(-4).map(a=>a.slice(4)),[[8,16],[8,24],[8,0],[8,8]]);
 assert.equal(r.getCoverageStats()!.residentBufferBytes,72);r.dispose();assert.equal([...gl.deleted].filter(v=>v.type==='buffer').length,1);arena.dispose();
});

test('default DataRenderer admits wrapped arena packets into one captured-state batch without experimental flags',()=>{
 const gl=new RecordingGL(),r=dataRenderer(gl),arena=new LineDisplayArena(8);defaultTarget(gl);const before=gl.snapshot();
 const p=packet(),values=Float32Array.from({length:20},(_,i)=>i%2?0:i/2),template={strokeGroup:p.strokeGroup!,origin:p.origin,domain:{x:{start:0,end:10},y:p.domain.y},color:p.color,thickness:p.thickness};
 arena.update([{key:'stable',positions:values,first:0,count:8,strictlyMonotonicX:true}],template,1);
 const wrapped=arena.update([{key:'stable',positions:values,first:2,count:8,strictlyMonotonicX:true}],template,1);
 r.render([...wrapped.packets],rect,1,{clear:false});assert.equal(stats(r).stateCaptures,1);assert.equal(stats(r).stateRestores,1);assert.equal(stats(r).knownFrameBaselines,0);assert.equal(gl.snapshot(),before);
 assert.equal(gl.storage.size,1);assert.equal(gl.uploads.length,1);assert.equal(gl.uploads[0]!.values.length,18);assert.deepEqual(gl.masks.map(m=>m.instances),[6,1]);r.dispose();arena.dispose();
});

test('dense summary spans match independent paged reads for nonuniform X, signed-zero ties, gaps and retention seams',()=>{
 const capacity=4097;
 const x=(i:number)=>1e12+i*.125+(i%7)*.00390625;
 const y=(i:number)=>i%97===0?NaN:i%103===0?Infinity:i%109===0?-Infinity:i%43===0?-0:i%43===1?0:i%19<3?-8:i%23<3?9:.7*Math.sin(i*.19);
 for(const mode of ['flat','arena']as const){
  const data=new DataSetXY({schema:{x:{storage:Float64Array},y:{storage:Float64Array}}}).setMaxSampleCount(capacity);
  const paged=new PagedColumns({schema:{y:{storage:Float64Array}},capacity,pageSize:256});
  const denseCache=new LineDisplayCache({pageSize:64,leafSize:8}),pagedCache=new LineDisplayCache({pageSize:64,leafSize:8});
  let next=0,sawTwoSpans=false,sawSingleSpan=false;
  const append=(n:number)=>{const xs=Float64Array.from({length:n},(_,i)=>x(next+i)),ys=Float64Array.from({length:n},(_,i)=>y(next+i));data.appendSamples({x:xs,y:ys});paged.appendSamples({y:ys});next+=n;};
  try{
   for(const n of [capacity,17,5,128,capacity+3]){
    append(n);const first=next-capacity,view=data.getColumnRuns('y');assert.equal(view.kind,'dense');if(view.kind!=='dense')throw Error('dense source required');
    sawTwoSpans ||= view.slices.length===2;sawSingleSpan ||= view.slices.length===1;
    assert.equal(getColumnOrder(data,'x').strict,true);
    const req:LineDisplayRequest={source:{identity:data,contentEpoch:data.getContentEpoch(),revision:data.revision,firstSampleIndex:first,nextSampleIndex:next,x:data.getColumnRuns('x'),y:view},coordinateMode:'linear',bindingRevision:0,styleRevision:0,projectionKey:'nonuniform-linear',monotonicX:'verified-strict',visibleSegments:{first,end:next-1},domain:{x:{start:x(first),end:x(next-1)},y:{start:-12,end:12}},plotRect:{left:0,top:0,width:32,height:420},devicePixelRatio:1,maximumPixelSpan:.5,style:{color:[0,1,1,1],thickness:2},strokeGroup:321,collectAudit:true,packetMode:mode};
    const a=denseCache.update(req),b=pagedCache.update({...req,source:{...req.source,identity:paged,y:paged.getColumnView('y')}});
    assert.equal(a.kind,'display');assert.equal(b.kind,'display');if(a.kind!=='display'||b.kind!=='display')throw Error('unexpected fallback');
    assert.deepEqual(a.sourceIndices,b.sourceIndices);assert.deepEqual(a.audit,b.audit);assert.equal(a.stats.sourceSamplesScannedThisUpdate,b.stats.sourceSamplesScannedThisUpdate);
    const geometry=(r:typeof a)=>(r.packets??(r.packet?[r.packet]:[])).map(p=>({positions:p.positions,count:p.count,drawFirst:p.drawFirst,drawCount:p.drawCount}));
    assert.deepEqual(geometry(a),geometry(b));
    // Independent source audit preserves earliest min/max ties and nonfinite gaps.
    for(const cell of a.audit??[]){if(!cell.finite)continue;let min=cell.first,max=cell.first;
     for(let i=cell.first;i<=cell.last;i++){if(y(i)<y(min))min=i;if(y(i)>y(max))max=i;}
     assert.equal(cell.minimum,min);assert.equal(cell.maximum,max);
    }
    const back=data.readBack().data;for(let i=0;i<capacity;i++){assert.ok(Object.is(back.x![i],x(first+i)));assert.ok(Object.is(back.y![i],y(first+i)));}
   }
   assert.equal(sawTwoSpans,true);assert.equal(sawSingleSpan,true);
  }finally{denseCache.dispose();pagedCache.dispose();data.dispose();paged.dispose();}
 }
});
