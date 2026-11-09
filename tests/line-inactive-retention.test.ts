import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {ChartXY} from '../src/chart';
import {DataSetXY} from '../src/core/data';
import {DataRenderer} from '../src/render';
import {SolidLine,SolidFill,ColorRGBA} from '../src/core/styles';
const hash=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
type Matrix=[number,number,number,number,number,number];
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
class ResourcesGL extends RecordingGL {
 buffers=new Map<any,Uint8Array>();peakBytes=0;lost=false;
 override createBuffer(){const b=super.createBuffer();this.buffers.set(b,new Uint8Array());return b;}
 override deleteBuffer(b:any){super.deleteBuffer(b);this.buffers.delete(b);}
 override bufferData(t=0,input:number|ArrayBufferView=0){super.bufferData(t,input);const b=this.parameters.get(this.ARRAY_BUFFER_BINDING),a=typeof input==='number'?new Uint8Array(input):new Uint8Array(input.buffer,input.byteOffset,input.byteLength).slice();this.buffers.set(b,a);this.peakBytes=Math.max(this.peakBytes,this.liveBytes());}
 override bufferSubData(t:number,offset:number,a:Float32Array,first=0,length=a.length-first){super.bufferSubData(t,offset,a,first,length);const b=this.parameters.get(this.ARRAY_BUFFER_BINDING),storage=this.buffers.get(b);assert.ok(storage,'Only a live buffer may receive uploads');storage.set(new Uint8Array(a.buffer,a.byteOffset+first*a.BYTES_PER_ELEMENT,length*a.BYTES_PER_ELEMENT),offset);}
 override isContextLost(){return this.lost;}
 liveBytes(){return [...this.buffers.values()].reduce((n,a)=>n+a.byteLength,0);}
 lose(){this.lost=true;for(const b of this.buffers.keys())this.deleted.add(b);this.buffers.clear();}
}

test('default real Chart VBO reuse keeps geometry exact and bounds inactive ownership lifetime',()=>{
const chart=new ChartXY().setTitle(''),gl=new ResourcesGL();gl.parameters.set(gl.DRAW_FRAMEBUFFER_BINDING,null);gl.parameters.set(gl.READ_FRAMEBUFFER_BINDING,null);
const canvas=Object.assign(new EventTarget(),{width:1000,height:600,getContext:(kind:string)=>kind==='webgl2'?gl:null});const renderer=new DataRenderer(canvas as any,{renderer:'webgl2'});Object.defineProperty(chart,'renderer',{value:renderer});chart.resize(1000,600);
function fixedInput(count:number){const bytes=Buffer.alloc(count*16);for(let channel=0;channel<2;channel++)for(let i=0;i<count;i++)bytes.writeDoubleLE(((i*17)%127-63)/128+channel/16,(channel*count+i)*8);return bytes;}
const rawBytes=fixedInput(8192),interpolationBytes=fixedInput(32768);
const packetLog:any[]=[],frames:any[]=[],cases:any[]=[];let packets:any[]=[];
const actualRender=renderer.render.bind(renderer);renderer.render=(...args:Parameters<DataRenderer['render']>)=>{
 // Actual Chart forwards owner identity; this spy only records submitted packets.
 packets=args[0];return actualRender(...args);
};
const color=(c:number)=>new SolidLine({thickness:1,fillStyle:new SolidFill({color:c?ColorRGBA(194,65,12):ColorRGBA(111,97,151)})});
function make(count:number,channel:number,blob:Buffer,isMain:boolean){
 const n=blob.byteLength/16,raw=Float32Array.from({length:count},(_,i)=>blob.readDoubleLE((channel*n+i)*8));
 const ds=new DataSetXY({schema:{xValues:{storage:Float64Array},yValues:{storage:Float32Array},renderYValues:{storage:Float32Array},alternate:{storage:Float32Array}}});ds.appendSamples({xValues:Float64Array.from({length:count},(_,i)=>i*(1000/48000)),yValues:raw,renderYValues:raw,alternate:Float32Array.from(raw,x=>-x)});
 const s=chart.addLineSeries({dataSet:ds}).setDataMapping({x:'xValues',y:'renderYValues'}).setStrokeStyle(color(channel));if(isMain)s.setCurvePreprocessing({type:'spline',resolution:0});return{s,ds,initialDigest:hash(Buffer.concat(Object.values(ds.readBack().data).map((a:any)=>Buffer.from(a.buffer,a.byteOffset,a.byteLength))))};
}
const main=[make(8192,0,rawBytes,true),make(8192,1,rawBytes,true)],interpolation=[make(32768,0,interpolationBytes,false),make(32768,1,interpolationBytes,false)];
chart.getDefaultAxisX().setInterval({start:0,end:(8192-1)*(1000/48000),stopAxisAfter:true});chart.getDefaultAxisY().setInterval({start:-1,end:1,stopAxisAfter:true});
const all=[...main,...interpolation];function visibility(show:boolean){for(let i=0;i<2;i++){main[i].s.setVisible(!show);interpolation[i].s.setVisible(show);}}
function staging(){const strip=(renderer as any).lineStrip;return strip?[...strip.buffers.values()].reduce((n:number,e:any)=>n+e.storage.byteLength,0):0;}
function verifyGPU(){
 const strip=(renderer as any).lineStrip;for(const p of packets){if(!p.count)continue;const entry=strip?.buffers.get(p.id);assert.ok(entry,'Actual default LineStrip upload entry');assert.equal(entry.revision,p.revision);const bytes=gl.buffers.get(entry.buffer);assert.ok(bytes);const actual=new Float32Array(bytes.buffer,bytes.byteOffset,bytes.byteLength/4),n=p.count;
 const expected=new Float32Array((n+2)*4);for(let i=-1;i<=n;i++){const sample=Math.max(0,Math.min(n-1,i)),at=(i+1)*4;expected[at]=expected[at+2]=p.positions[sample*2];expected[at+1]=expected[at+3]=p.positions[sample*2+1];}
 assert.deepEqual(actual.subarray(0,expected.length),expected,'Actual uploaded duplicate vertex/prefix/suffix positions must remain exact');assert.ok(!gl.deleted.has(entry.buffer));}
}
function draw(label:string){const uploads=gl.writes.length,allocations=gl.bufferAllocations.length,draws=gl.draws.length;chart.renderNow();verifyGPU();const frame={label,uploads:gl.writes.slice(uploads).reduce((n,x)=>n+x.bytes,0),allocatedBytes:gl.bufferAllocations.slice(allocations).reduce((n,x)=>n+x.bytes,0),draws:gl.draws.length-draws,CPUStagingBytes:staging(),GPURequestedLiveBytes:gl.liveBytes(),packets:packets.map(p=>({count:p.count,positionsSHA256:hash(Buffer.from(p.positions.buffer,p.positions.byteOffset,p.positions.byteLength)),origin:p.origin,domain:p.domain,color:p.color,thickness:p.thickness}))};frames.push(frame);return frame;}
visibility(false);draw('initial-main');for(let i=0;i<120;i++){visibility(i%2===0);draw('static-toggle-'+i);}
const steady=frames.filter(f=>f.label.startsWith('static-toggle-')&&f.label!=='static-toggle-0');
for(const item of all){const back=item.ds.readBack().data,digest=hash(Buffer.concat(Object.values(back).map((a:any)=>Buffer.from(a.buffer,a.byteOffset,a.byteLength))));assert.equal(digest,item.initialDigest,'Toggles must not change any raw F64/F32/alternate column');}
cases.push({name:'same raw/data/vertices/count/style through120default actualChart dispatch toggles',passed:true});
// Change hidden data, binding and style: unchanged revision must never admit stale content.
main[0].s.setVisible(false);draw('before-hidden-mutation');main[0].ds.clear();main[0].ds.appendSamples({xValues:Float64Array.from({length:100},(_,i)=>i*.25),yValues:Float32Array.from({length:100},(_,i)=>i/100),renderYValues:Float32Array.from({length:100},(_,i)=>i/100),alternate:Float32Array.from({length:100},(_,i)=>i===41?NaN:-i/100)});main[0].s.setDataMapping({y:'alternate'});main[0].s.setStrokeStyle(new SolidLine({thickness:2,fillStyle:new SolidFill({color:ColorRGBA(15,30,220)})}));main[0].s.setVisible(true);const mutation=draw('restore-after-hidden-data-mapping-style-change');assert.ok(mutation.uploads>0);assert.equal(packets.find(p=>p.id===main[0].s.id)?.count,100);cases.push({name:'hidden data/NaN/mapping/style changes reupload exact new geometry',passed:true});
main[0].s.setVisible(false);draw('hidden-before-same-revision-rebind');
const oldData=main[0].s.getDataSet(),sameRevision=new DataSetXY({schema:{xValues:{storage:Float64Array},yValues:{storage:Float32Array},renderYValues:{storage:Float32Array},alternate:{storage:Float32Array}}});
const replacementColumns={xValues:Float64Array.from({length:100},(_,i)=>i*.2+1),yValues:Float32Array.from({length:100},(_,i)=>i*.02),renderYValues:Float32Array.from({length:100},(_,i)=>i*.02),alternate:Float32Array.from({length:100},(_,i)=>-i*.02)};
sameRevision.appendSamples(replacementColumns);while(sameRevision.revision<oldData.revision){sameRevision.clear();sameRevision.appendSamples(replacementColumns);}assert.equal(sameRevision.revision,oldData.revision,'Distinct bindings share a real revision number');
main[0].s.setDataSet(sameRevision);main[0].s.setVisible(true);const rebound=draw('restore-after-same-revision-dataset-rebind');assert.ok(rebound.uploads>0);assert.equal(packets.find(p=>p.id===main[0].s.id)?.origin.x,1);cases.push({name:'hidden distinct DataSet at same numeric revision never reuses old geometry',passed:true});
main[0].ds=sameRevision;
main[0].s.setVisible(false);draw('hidden-before-domain-change');chart.getDefaultAxisX().setInterval({start:0,end:30,stopAxisAfter:true});chart.getDefaultAxisY().setInterval({start:-2,end:2,stopAxisAfter:true});chart.resize(1024,720);main[0].s.setVisible(true);draw('restore-after-resize-domain-change');assert.equal(packets.find(p=>p.id===main[0].s.id)?.domain.x.end,30);cases.push({name:'resize/domain updates use current packet uniforms with exact uploaded vertices',passed:true});
main[0].s.setVisible(false);draw('hidden-one-frame-grace');assert.ok((renderer as any).lineStrip.buffers.has(main[0].s.id),'One immediately previous drawing frame may retain a live hidden owner');
draw('hidden-two-frame-grace-expired');assert.ok(!(renderer as any).lineStrip.buffers.has(main[0].s.id),'Long-hidden geometry must not remain resident without a recent actual draw');
main[0].s.setVisible(true);assert.ok(draw('restored-after-grace-expired').uploads>0);
main[0].s.setVisible(false);draw('hidden-before-external-clear');main[0].ds.clear();draw('hidden-cleared-pruned');assert.ok(!(renderer as any).lineStrip.buffers.has(main[0].s.id));cases.push({name:'clear hidden live owner releases its staging/buffer next render',passed:true});
main[1].s.setVisible(false);draw('hidden-before-dispose');const deadId=main[1].s.id;main[1].s.dispose();draw('dead-owner-pruned');assert.ok(!(renderer as any).lineStrip.buffers.has(deadId));cases.push({name:'disposed owner never retained by grace rule',passed:true});
const replacement=make(8192,0,rawBytes,true);replacement.s.setVisible(true);draw('new-owner-generation');assert.notEqual(replacement.s.id,deadId);assert.ok(!(renderer as any).lineStrip.buffers.has(deadId));cases.push({name:'new source owner generation does not alias deleted owner',passed:true});
const beforeLostDraws=gl.draws.length;gl.lose();canvas.dispatchEvent(new Event('webglcontextlost',{cancelable:true}));chart.renderNow();assert.equal(gl.draws.length,beforeLostDraws);gl.lost=false;canvas.dispatchEvent(new Event('webglcontextrestored'));draw('after-context-restoration');cases.push({name:'actual renderer context-event restoration rebuilds fresh GL handles and geometry',passed:true,qualification:'RecordingGL standard event simulation; not a browser/driver context restoration test'});
chart.dispose();assert.equal(gl.liveBytes(),0);assert.equal(staging(),0);cases.push({name:'engine/chart disposal frees all recorded standard buffers and CPU staging',passed:true});

assert.equal(steady.every(f=>f.uploads===0&&f.allocatedBytes===0),true,'After both static sets have drawn, actual default Chart visibility toggles reuse unchanged VBOs');

});
