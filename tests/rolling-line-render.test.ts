import test from 'node:test';
import assert from 'node:assert/strict';
import {ChartXY} from '../src/chart';
import {DataSetXY} from '../src/core/data';
import {DataRenderer} from '../src/render';
import type {DrawPacket} from '../src/contracts';
import type {LineBlockPacket} from '../src/line-block-cache';
import type {LineArenaPacket} from '../src/line-display-arena';
import {DashedLine, SolidLine, SolidFill, ColorRGBA, LUT, PalettedFill} from '../src/core/styles';

// A recording GL boundary, not a replacement for ChartXY's dispatch or either
// production geometry uploader. Browser tests separately verify raster output.
class CoverageRecordingGL {
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
class RecordingGL extends CoverageRecordingGL {
 createdBuffers=0;
 writes:{buffer:unknown;offset:number;bytes:number}[]=[];
 bufferAllocations:{buffer:unknown;bytes:number}[]=[];
 get deletedBuffers(){return [...this.deleted].filter(value=>value.type==='buffer').length;}
 override createBuffer(){this.createdBuffers++;return super.createBuffer();}
 override bufferData(_target=0,data:number|ArrayBufferView=0){this.bufferAllocations.push({buffer:this.parameters.get(this.ARRAY_BUFFER_BINDING),bytes:typeof data==='number'?data:data.byteLength});}
 override bufferSubData(_target:number,offset:number,values:Float32Array,first=0,length=values.length-first){this.writes.push({buffer:this.parameters.get(this.ARRAY_BUFFER_BINDING),offset,bytes:length*values.BYTES_PER_ELEMENT});}
 getAttribLocation(){return 0;}disableVertexAttribArray(){}vertexAttrib2f(){}uniform1fv(){}
}


function chartHarness(webgl=true,log=false){
 const chart=new ChartXY(log?{defaultAxisX:{type:'logarithmic',base:10}}:{});
 const gl=new RecordingGL();
 const canvas=Object.assign(new EventTarget(),{width:800,height:500,getContext:(kind:string)=>webgl&&kind==='webgl2'?gl:null});
 const renderer=new DataRenderer(canvas as unknown as HTMLCanvasElement,{renderer:webgl?'webgl2':'canvas2d'});
 let packets:DrawPacket[]=[];
 const original=renderer.render.bind(renderer);
 renderer.render=(...args:Parameters<DataRenderer['render']>)=>{packets=args[0].slice();return original(...args);};
 Object.defineProperty(chart,'renderer',{value:renderer});
 return{chart,renderer,gl,packets:()=>packets};
}
const capacity=100_000,base=1_700_000_000_000,step=.125;
function raw(index:number){return index%10003===7||index===32760||index===65521?NaN:Math.sin(index*.01)+index*1e-12;}
function source(count=capacity,maximum=capacity){
 const data=new DataSetXY({schema:{x:{storage:Float64Array,auto:true},y:{storage:Float64Array},alternate:{storage:Float64Array}}}).setMaxSampleCount(maximum);
 data.appendSamples({y:Float64Array.from({length:count},(_,i)=>raw(i)),alternate:Float64Array.from({length:count},(_,i)=>raw(i)*-2)},{start:base,step});return data;
}
function domains(chart:ChartXY,data:DataSetXY){
 const first=data.getNextSampleIndex()-data.getSampleCount(),last=data.getNextSampleIndex()-1;
 chart.getDefaultAxisX().setInterval({start:base+first*step,end:base+last*step,stopAxisAfter:true});
 chart.getDefaultAxisY().setInterval({start:-3,end:3,stopAxisAfter:true});
}
function verifyRaw(data:DataSetXY){
 const first=data.getNextSampleIndex()-data.getSampleCount(),back=data.readBack().data;
 assert.equal(back.y!.BYTES_PER_ELEMENT,8);
 for(let i=0;i<data.getSampleCount();i++){
  assert.ok(Object.is(data.getValue('x',i),base+(first+i)*step),`raw X index${first+i}`);
  assert.ok(Object.is(back.y![i],raw(first+i)),`raw Y index${first+i}`);
 }
}
function verifyBlocks(packets:DrawPacket[],data:DataSetXY,column='y'){
 const blocks=packets.filter(p=>p.mode==='line') as LineBlockPacket[];
 const first=data.getNextSampleIndex()-data.getSampleCount(),next=data.getNextSampleIndex();
 assert.ok(blocks.length>1&&blocks.every(p=>p.id<=-(2**40)),'Chart default dispatch must reach source-index blocks');
 assert.equal(blocks[0]!.firstOwnedSegment,first);assert.equal(blocks.at(-1)!.endOwnedSegment,next-1);
 assert.equal(blocks.reduce((n,p)=>n+p.endOwnedSegment-p.firstOwnedSegment,0),data.getSampleCount()-1,'Every retained source segment is owned once');
 for(let i=0;i<blocks.length;i++){
  const p=blocks[i]!;if(i)assert.equal(blocks[i-1]!.endOwnedSegment,p.firstOwnedSegment);
  for(let local=p.drawFirst;local<p.drawFirst+p.drawCount;local++){
   const index=p.sourceFirstSample+local,offset=index-first;
   assert.ok(index>=first&&index<next,'Halo storage never becomes an out-of-retention drawn sample');
   const x=data.getValue('x',offset)!,y=data.getValue(column,offset)!;
   assert.ok(Math.abs(p.positions[local*2]!+p.origin.x-x)<=p.precision.maximumXError+Number.EPSILON);
   if(Number.isFinite(y))assert.ok(Math.abs(p.positions[local*2+1]!+p.origin.y-y)<=p.precision.maximumYError+Number.EPSILON);
   else assert.ok(Number.isNaN(p.positions[local*2+1]!),`NaN source gap at${index} remains a gap`);
  }
 }
 return blocks;
}

test('default full bounded WebGL line retains every F64 row and source segment through ring wrap with tail-only projection/uploads',(context)=>{
 const h=chartHarness(),data=source(),line=h.chart.addLineSeries({dataSet:data});
 try{
  domains(h.chart,data);h.chart.renderNow();verifyRaw(data);
  assert.ok(line.getLineBlockStats(),JSON.stringify({n:line.getSampleCount(),max:line.getMaxSampleCount(),x:line.axisX.type,y:line.axisY.type,size:line.pointSize,kind:line.kind,packets:h.packets().map(p=>({id:p.id,count:p.count}))}));
  const first=verifyBlocks(h.packets(),data),stable=new Map(first.map(p=>[p.id,{origin:p.origin,storage:p.positions.buffer}]));
  assert.equal(data.getColumnRuns('x').kind,'affine');
  assert.equal(line.getLineBlockStats()!.sourceReduction,false);
  assert.ok(h.gl.writes.length>0,'Production DataRenderer really submitted uploads');
  const incrementalUploads:{pass:number;projected:number;uploaded:number;allocations:number;growBytes:number;steadyBytes:number;tailPacketCount:number}[]=[];
  for(let pass=0;pass<3;pass++){
   const next=data.getNextSampleIndex(),batch=137,writeStart=h.gl.writes.length,allocationStart=h.gl.bufferAllocations.length;
   data.appendSamples({y:Float64Array.from({length:batch},(_,i)=>raw(next+i)),alternate:Float64Array.from({length:batch},(_,i)=>raw(next+i)*-2)},{step});
   domains(h.chart,data);h.chart.renderNow();verifyRaw(data);
   const packets=verifyBlocks(h.packets(),data),stats=line.getLineBlockStats()!;
   assert.equal(data.getSampleCount(),capacity);assert.equal(data.getNextSampleIndex(),next+batch);
   assert.ok(stats.projectedSamplesThisUpdate<=batch+8,`projected${stats.projectedSamplesThisUpdate}`);
   const allocations=h.gl.bufferAllocations.slice(allocationStart),growing=new Set(allocations.map(a=>a.buffer)),writes=h.gl.writes.slice(writeStart);
   const growBytes=writes.filter(w=>growing.has(w.buffer)).reduce((n,w)=>n+w.bytes,0),steadyBytes=writes.filter(w=>!growing.has(w.buffer)).reduce((n,w)=>n+w.bytes,0);
   const tailPacketCount=packets.at(-1)!.count;
   incrementalUploads.push({pass,projected:stats.projectedSamplesThisUpdate,uploaded:growBytes+steadyBytes,allocations:allocations.length,growBytes,steadyBytes,tailPacketCount});
   if(pass<2)assert.equal(allocations.length,0,'The first two tail appends fit the existing GPU allocation');
   assert.ok(allocations.length<=1,'Only the small last packet may need a GPU growth allocation');
   // A genuine tail-buffer grow must initialize its old samples too. Bound it
   // by the actual last packet, never by the entire retained window. The 16
   // bytes/sample also covers the existing expanded-strip upload contract.
   if(allocations.length)assert.ok(growBytes<=tailPacketCount*16+64,'GPU grow copies only the actual small tail packet');
   for(const p of packets){const old=stable.get(p.id);if(old){assert.equal(p.origin,old.origin);assert.equal(p.positions.buffer,old.storage);}}
   const hit=line.findNearestX(base+(next+batch-2)*step)!;assert.equal(hit.x,base+(next+batch-2)*step);
   assert.ok(Object.is(hit.y,raw(next+batch-2)),'Nearest query keeps source F64 values');
  }
  context.diagnostic(JSON.stringify(incrementalUploads));
  assert.ok(incrementalUploads.every(row=>row.uploaded>0&&row.steadyBytes<=(137+16)*32),JSON.stringify(incrementalUploads)+' steady buffers must upload only appended tail/halos and clipped head cap');
 }finally{h.chart.dispose();assert.equal(data.isDisposed(),false);data.dispose();assert.equal(h.gl.createdBuffers,h.gl.deletedBuffers);}
});

test('small, not-full and non-WebGL lines keep the normal draw packet path',()=>{
 for(const [count,max,webgl]of [[1024,1024,true],[70000,capacity,true],[capacity,capacity,false]]as const){
  const h=chartHarness(webgl),data=source(count,max),line=h.chart.addLineSeries({dataSet:data});
  try{domains(h.chart,data);h.chart.renderNow();assert.equal(h.packets()[0]!.id,line.id);assert.equal(line.getLineBlockStats(),undefined);assert.equal(h.packets()[0]!.count,count);verifyRaw(data);}
  finally{h.chart.dispose();data.dispose();}
 }
});

test('default full-ring unsupported style, nonmonotonic X, points with area and logarithmic axes fall back without losing samples',()=>{
 for(const kind of ['dash','palette','nonmonotonic','points-area','log']as const){
  const h=chartHarness(true,kind==='log'),data=source(),line=h.chart.addLineSeries({dataSet:data});
  try{
   if(kind==='dash')line.setStrokeStyle(new DashedLine({pattern:[2,3]}));
   if(kind==='palette')line.setStrokeStyle(new SolidLine({fillStyle:new PalettedFill({lut:new LUT({steps:[{value:-3,color:ColorRGBA(0,0,255)},{value:3,color:ColorRGBA(255,0,0)}]})})}));
   if(kind==='points-area')line.setPointSize(4).setPointFillStyle(new SolidFill({color:ColorRGBA(30,80,180)})).setAreaFillStyle(new SolidFill({color:ColorRGBA(30,80,180,100)}));
   if(kind==='nonmonotonic'){
    const explicit=new DataSetXY({schema:{x:{storage:Float64Array},y:{storage:Float64Array}}}).setMaxSampleCount(capacity);
    const x=Float64Array.from({length:capacity},(_,i)=>base+i*step);x[10]=x[9]!;
    explicit.appendSamples({x,y:Float64Array.from({length:capacity},(_,i)=>raw(i))});line.setDataSet(explicit);
   }
   domains(h.chart,line.getDataSet());h.chart.renderNow();
   const packets=h.packets();assert.equal(line.getLineBlockStats(),undefined,kind);
   assert.ok(packets.length>0,kind);assert.equal(Math.abs(packets.find(p=>p.mode==='line')!.id),line.id,kind);assert.equal(packets[0]!.count,capacity);
   if(kind==='dash')assert.deepEqual(packets[0]!.dashPattern,[2,3]);
   if(kind==='points-area'){assert.ok(packets.some(p=>p.mode==='points'));assert.ok(line.getAreaFillStyle().getColor().a>0);}
   if(kind==='log')assert.ok(Math.abs(packets[0]!.positions[2000]!+packets[0]!.origin.x-Math.log10(base+1000*step))<1e-12,'Fallback packet contains the actual logarithmic projection');
   assert.equal(line.getDataSet().getSampleCount(),capacity);verifyRaw(data);
  }finally{const attached=line.getDataSet();h.chart.dispose();if(attached!==data)attached.dispose();data.dispose();}
 }
});

test('external clear/refill, remap, source replacement and disposal invalidate default block/GPU caches without owning caller data',()=>{
 const h=chartHarness(),data=source(),line=h.chart.addLineSeries({dataSet:data});let replacement:DataSetXY|undefined;
 try{
  domains(h.chart,data);h.chart.renderNow();const ids=new Set(h.packets().map(p=>p.id));
  data.clear();h.chart.renderNow();assert.equal(data.getSampleCount(),0);assert.ok(h.packets().every(p=>p.count===0));assert.equal(line.getXYProjectionStorageBytes(),0);assert.equal(h.gl.createdBuffers,h.gl.deletedBuffers,'Empty frame releases retained GPU packets');
  data.appendSamples({y:Float64Array.from({length:capacity},(_,i)=>raw(i)),alternate:Float64Array.from({length:capacity},(_,i)=>raw(i)*-2)},{start:base,step});
  domains(h.chart,data);h.chart.renderNow();assert.ok(h.packets().every(p=>!ids.has(p.id)));verifyBlocks(h.packets(),data);
  const refillIds=new Set(h.packets().map(p=>p.id));line.setDataMapping({y:'alternate'});assert.equal(line.getLineBlockStats(),undefined);h.chart.renderNow();
  assert.ok(h.packets().every(p=>!refillIds.has(p.id)));verifyBlocks(h.packets(),data,'alternate');verifyRaw(data);
  replacement=source();const oldIds=new Set(h.packets().map(p=>p.id));line.setDataSet(replacement).setDataMapping({y:'y'});h.chart.renderNow();
  assert.ok(h.packets().every(p=>!oldIds.has(p.id)));assert.equal(data.isDisposed(),false);verifyBlocks(h.packets(),replacement);
  line.dispose();assert.equal(line.getXYProjectionStorageBytes(),0);assert.equal(line.getLineBlockStats(),undefined);h.chart.renderNow();
  assert.equal(h.gl.createdBuffers,h.gl.deletedBuffers);assert.equal(replacement.isDisposed(),false);verifyRaw(data);
 }finally{h.chart.dispose();data.dispose();replacement?.dispose();}
});

test('default dense full ring reaches the actual arena uploader, preserves GL state through moving/wrapped views and returns to exact blocks on zoom',(context)=>{
 const h=chartHarness(),count=262144,data=new DataSetXY({schema:{x:{storage:Float64Array,auto:true},y:{storage:Float64Array}}}).setMaxSampleCount(count);
 const value=(i:number)=>i%10007===0?NaN:i%997===0?1.2:i%991===0?-1.2:.7*Math.sin(i*.019);
 data.appendSamples({y:Float64Array.from({length:count},(_,i)=>value(i))},{start:base,step});
 const line=h.chart.addLineSeries({dataSet:data}).setStrokeStyle(new SolidLine({thickness:2,fillStyle:new SolidFill({color:ColorRGBA(30,200,170,255)})}));
 const verifyFullSource=()=>{
  const first=data.getNextSampleIndex()-count,back=data.readBack().data;
  assert.equal(back.y!.BYTES_PER_ELEMENT,8);assert.equal(data.getSampleCount(),count);assert.equal(line.getDataSet(),data);
  for(let i=0;i<count;i++){assert.ok(Object.is(back.y![i],value(first+i)));assert.equal(data.getValue('x',i),base+(first+i)*step);}
 };
 const frame=()=>{
  domains(h.chart,data);h.gl.bindFramebuffer(h.gl.DRAW_FRAMEBUFFER,null);
  const state=h.gl.snapshot(),writeStart=h.gl.writes.length,drawStart=h.gl.draws.length;
  h.chart.renderNow();assert.equal(h.gl.snapshot(),state,'Default arena path restores the actual incoming GL framebuffer/texture/VAO/blend state');
  const stats=line.getLineDisplayStats();assert.ok(stats&&stats.arena,'Actual default Chart dispatch must publish arena display diagnostics');
  assert.equal(stats.retainedSourceSamples,count);assert.equal(stats.sourceReduction,false);assert.ok(stats.displayReduction);
  const packets=h.packets() as LineArenaPacket[];assert.ok(packets.length>0&&packets.every(p=>p.arenaStorage));
  assert.ok(h.gl.draws.slice(drawStart).some(draw=>draw.kind==='mask'),'Actual production DataRenderer submitted geometry');
  const projected=packets.flatMap(p=>Array.from({length:p.count},(_,i)=>p.positions[i*2+1]!+p.origin.y));
  assert.ok(projected.some(v=>Math.abs(v-1.2)<1e-6));assert.ok(projected.some(v=>Math.abs(v+1.2)<1e-6));assert.ok(projected.some(v=>!Number.isFinite(v)));
  return{head:stats.arena.head,wrapped:stats.arena.wrapped,views:packets.length,uploaded:h.gl.writes.slice(writeStart).reduce((n,w)=>n+w.bytes,0)};
 };
 try{
  const initial=frame();verifyFullSource();
  let next=data.getNextSampleIndex();data.appendSamples({y:Float64Array.from({length:137},(_,i)=>value(next+i))},{step});
  const advanced=frame();verifyFullSource();assert.notEqual(advanced.head,initial.head,'Source append must advance the actual arena head');
  assert.ok(advanced.uploaded>0&&advanced.uploaded<count*8/4,'137-point append must not upload the entire source window');
  // Exercise a physical arena wrap with an explicit bounded source sequence,
  // rather than fabricating arena offsets or calling the uploader directly.
  let wrapped=advanced.wrapped&&advanced.views===2;
  for(let i=0;i<32&&!wrapped;i++){
   next=data.getNextSampleIndex();data.appendSamples({y:Float64Array.from({length:8192},(_,j)=>value(next+j))},{step});
   const current=frame();wrapped=current.wrapped&&current.views===2;
  }
  assert.ok(wrapped,'Bounded source appends must reach two real draw views of the cyclic arena');verifyFullSource();
  const first=data.getNextSampleIndex()-count;
  h.chart.getDefaultAxisX().setInterval({start:base+(first+200)*step,end:base+(first+300)*step,stopAxisAfter:true});h.chart.renderNow();
  assert.equal(line.getLineDisplayStats(),undefined,'Zoom leaves display reduction and restores source-index blocks');
  assert.ok(h.packets().every(p=>p.id<=-(2**40)&&!('arenaStorage' in p)));verifyFullSource();
  context.diagnostic(JSON.stringify({initial,advanced,physicalArenaWrapObserved:wrapped}));
 }finally{h.chart.dispose();assert.equal(data.isDisposed(),false);data.dispose();assert.equal(h.gl.createdBuffers,h.gl.deletedBuffers);}
});

test('external retention shrink or expansion exits default blocks and releases stale projection caches on the normal line path',(context)=>{
 const h=chartHarness(),data=source(),line=h.chart.addLineSeries({dataSet:data});
 const observations:{transition:string;count:number;blockCache:boolean;displayCache:boolean;projectionBytes:number;maximumNormalProjectionBytes:number}[]=[];
 const observe=(transition:string)=>{
  domains(h.chart,data);h.chart.renderNow();const count=data.getSampleCount();
  assert.equal(h.packets().find(p=>p.mode==='line')!.id,line.id,'The actual normal line path was selected');
  assert.equal(h.packets()[0]!.count,count);verifyRaw(data);
  observations.push({transition,count,blockCache:line.getLineBlockStats()!==undefined,displayCache:line.getLineDisplayStats()!==undefined,projectionBytes:line.getXYProjectionStorageBytes(),maximumNormalProjectionBytes:Math.max(512,2**Math.ceil(Math.log2(count*2)))*4});
 };
 try{
  domains(h.chart,data);h.chart.renderNow();assert.ok(line.getLineBlockStats());
  data.setMaxSampleCount(1024);observe('external full100k -> full1024 legacy');
  data.clear();data.setMaxSampleCount(capacity);
  data.appendSamples({y:Float64Array.from({length:capacity},(_,i)=>raw(i)),alternate:Float64Array.from({length:capacity},(_,i)=>raw(i)*-2)},{start:base,step});
  domains(h.chart,data);h.chart.renderNow();assert.ok(line.getLineBlockStats());
  data.setMaxSampleCount(capacity*2);observe('external full100k -> not-full100k/200k legacy');
  context.diagnostic(JSON.stringify(observations));
  for(const row of observations){
   assert.equal(row.blockCache,false,row.transition+' releases the obsolete source-block cache');
   assert.equal(row.displayCache,false,row.transition+' releases the obsolete display cache');
   assert.ok(row.projectionBytes<=row.maximumNormalProjectionBytes,JSON.stringify(row)+' retains only its current normal packet allocation');
  }
 }finally{h.chart.dispose();assert.equal(data.isDisposed(),false);data.dispose();}
});

test('default 1px bounded growing window reaches the real arena before capacity and preserves uploads, source gaps and first full wrap',(context)=>{
 const h=chartHarness(),initial=262144,limit=524288,batch=960;
 const data=new DataSetXY({schema:{x:{storage:Float64Array,auto:true},y:{storage:Float64Array}}}).setMaxSampleCount(limit);
 const value=(i:number)=>i%10007===7?NaN:i%997===0?1.2:i%991===0?-1.2:.7*Math.sin(i*.019)+i*1e-13;
 data.appendSamples({y:Float64Array.from({length:initial},(_,i)=>value(i))},{start:base,step});
 const line=h.chart.addLineSeries({dataSet:data}).setStrokeStyle(new SolidLine({thickness:1,fillStyle:new SolidFill({color:ColorRGBA(30,200,170,255)})}));
 const verifySource=()=>{
  const count=data.getSampleCount(),next=data.getNextSampleIndex(),first=next-count,back=data.readBack().data;
  assert.equal(back.y!.BYTES_PER_ELEMENT,8);assert.equal(line.getDataSet(),data);
  for(let i=0;i<count;i++){
   assert.equal(data.getValue('x',i),base+(first+i)*step);
   assert.ok(Object.is(back.y![i],value(first+i)),`complete raw F64 source index${first+i}`);
  }
  const index=next-3,x=base+index*step;
  assert.deepEqual(line.findNearestX(x),line.getSample(index-first),'Nearest query uses the retained source index, not a reduced display index');
  assert.ok(Object.is(line.findNearestX(x)!.y,value(index)));
 };
 const frame=()=>{
  const first=data.getNextSampleIndex()-data.getSampleCount();
  // A fixed declared retention-width viewport also covers the empty future
  // region while growing; view geometry is independent from current count.
  h.chart.getDefaultAxisX().setInterval({start:base+first*step,end:base+(first+limit-1)*step,stopAxisAfter:true});
  h.chart.getDefaultAxisY().setInterval({start:-1.5,end:1.5,stopAxisAfter:true});
  h.gl.bindFramebuffer(h.gl.DRAW_FRAMEBUFFER,null);
  const state=h.gl.snapshot(),writeStart=h.gl.writes.length,allocationStart=h.gl.bufferAllocations.length,drawStart=h.gl.draws.length;
  h.chart.renderNow();assert.equal(h.gl.snapshot(),state,'Growing default arena restores borrowed GL state');
  const stats=line.getLineDisplayStats();assert.ok(stats?.arena,'Actual Chart default dispatch admits a bounded not-full 1px window');
  assert.equal(stats.retainedSourceSamples,data.getSampleCount());assert.equal(stats.sourceReduction,false);assert.ok(stats.displayReduction);
  assert.equal(stats.displaySelectionPolicy,'original-v4','The 1px path must not borrow the 2px extrema-pair proof');
  const packets=h.packets() as LineArenaPacket[];
  assert.ok(packets.length>0&&packets.every(p=>p.arenaStorage),'Actual DataRenderer consumes the arena packet format');
  assert.ok(h.gl.draws.slice(drawStart).some(draw=>draw.kind==='mask'),'Production geometry reaches GL');
  const projected=packets.flatMap(p=>Array.from({length:p.count},(_,i)=>({x:p.positions[i*2]!+p.origin.x,y:p.positions[i*2+1]!+p.origin.y})));
  assert.ok(projected.some(p=>Math.abs(p.y-1.2)<1e-6));assert.ok(projected.some(p=>Math.abs(p.y+1.2)<1e-6));
  const gaps=new Set(projected.filter(p=>Number.isNaN(p.y)).map(p=>Math.round((p.x-base)/step)));
  for(let i=Math.ceil((first-7)/10007)*10007+7;i<data.getNextSampleIndex();i+=10007)assert.ok(gaps.has(i),`Actual draw packets retain source NaN gap${i}`);
  const allocations=h.gl.bufferAllocations.slice(allocationStart),growing=new Set(allocations.map(a=>a.buffer)),writes=h.gl.writes.slice(writeStart);
  return{count:data.getSampleCount(),next:data.getNextSampleIndex(),allocations:allocations.length,growBytes:writes.filter(w=>growing.has(w.buffer)).reduce((n,w)=>n+w.bytes,0),steadyBytes:writes.filter(w=>!growing.has(w.buffer)).reduce((n,w)=>n+w.bytes,0),arenaBytes:packets[0]!.arenaStorage.values.byteLength};
 };
 try{
  frame();verifySource();assert.ok(data.getSampleCount()<data.getMaxSampleCount()!);
  const growingUploads=[];
  for(let pass=0;pass<3;pass++){
   const next=data.getNextSampleIndex();data.appendSamples({y:Float64Array.from({length:batch},(_,i)=>value(next+i))},{step});
   const observation=frame();growingUploads.push(observation);verifySource();
   assert.ok(observation.count<limit);assert.equal(observation.next,next+batch);
   assert.ok(observation.steadyBytes>0&&observation.steadyBytes<=batch*8+4096,'960 appended rows upload only a bounded tail, not the old source window');
   assert.ok(observation.allocations<=1,'Only the actual arena VBO can grow');
   assert.ok(observation.growBytes<=observation.arenaBytes,'A genuine grow copies at most the actual display arena, never all retained raw rows');
  }
  h.chart.getDefaultAxisX().setInterval({start:base+400*step,end:base+500*step,stopAxisAfter:true});
  const zoomState=h.gl.snapshot();h.chart.renderNow();assert.equal(h.gl.snapshot(),zoomState);
  assert.equal(line.getLineDisplayStats(),undefined);assert.ok(line.getLineBlockStats());
  assert.ok(h.packets().every(p=>p.id<=-(2**40)&&!('arenaStorage'in p)),'Zoom returns to exact source blocks');verifySource();
  let next=data.getNextSampleIndex();data.appendSamples({y:Float64Array.from({length:limit-data.getSampleCount()},(_,i)=>value(next+i))},{step});
  frame();verifySource();assert.equal(data.getSampleCount(),limit);assert.equal(data.getNextSampleIndex(),limit);
  next=data.getNextSampleIndex();data.appendSamples({y:Float64Array.from({length:batch},(_,i)=>value(next+i))},{step});
  const wrapped=frame();verifySource();assert.equal(data.getSampleCount(),limit);assert.equal(data.getNextSampleIndex()-data.getSampleCount(),batch);
  assert.deepEqual(line.findNearestX(base+batch*step),line.getSample(0),'The first full-ring wrap expires the original prefix without shifting source identities');
  context.diagnostic(JSON.stringify({growingUploads,firstFullWrap:wrapped}));
 }finally{h.chart.dispose();assert.equal(data.isDisposed(),false);data.dispose();assert.equal(h.gl.createdBuffers,h.gl.deletedBuffers);}
});
