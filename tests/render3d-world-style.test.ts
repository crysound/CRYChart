import test from 'node:test';
import assert from 'node:assert/strict';
import {DataRenderer3D,worldStylePixels3D} from '../src/render3d.js';
import {createWorldCameraFrame} from '../src/world-camera.js';
class RecordingGL {
  VERTEX_SHADER = 1; FRAGMENT_SHADER = 2; COMPILE_STATUS = 3; LINK_STATUS = 4; ALIASED_POINT_SIZE_RANGE = 5;
  ARRAY_BUFFER = 6; DYNAMIC_DRAW = 7; FLOAT = 8; SCISSOR_TEST = 9; DEPTH_TEST = 10; CULL_FACE = 11; BLEND = 12;
  LEQUAL = 13; SRC_ALPHA = 14; ONE_MINUS_SRC_ALPHA = 15; COLOR_BUFFER_BIT = 16; DEPTH_BUFFER_BIT = 32; POINTS = 64; TRIANGLES = 65; ONE = 66;
  ELEMENT_ARRAY_BUFFER = 67; UNSIGNED_INT = 68;
  uploads: Array<Float32Array | Uint32Array> = []; subUploads: Float32Array[] = []; subOffsets: number[] = []; rotations: number[][] = []; viewportValues: number[] = [];
  uniforms = new Map<string, unknown>(); draws: Array<{mode: number; count: number; instances: number; depthWrite: boolean}> = [];
  deletedBuffers = 0; deletedArrays = 0; deletedPrograms = 0; depthWrite = true; blendFactors: number[] = []; private identity = 0;
  createShader() {return {id: ++this.identity};} shaderSource() {} compileShader() {} getShaderParameter() {return true;} getShaderInfoLog() {return '';} deleteShader() {}
  createProgram() {return {id: ++this.identity};} attachShader() {} linkProgram() {} getProgramParameter() {return true;} getProgramInfoLog() {return '';} deleteProgram() {this.deletedPrograms++;}
  getUniformLocation(_program: unknown, name: string) {return name;} getParameter() {return new Float32Array([1, 64]);}
  createBuffer() {return {id: ++this.identity};} createVertexArray() {return {id: ++this.identity};}
  deleteBuffer() {this.deletedBuffers++;} deleteVertexArray() {this.deletedArrays++;} bindVertexArray() {} bindBuffer() {}
  bufferData(_target: number, data: Float32Array | Uint32Array) {this.uploads.push(data.slice());}
  bufferSubData(_target: number, offset: number, data: Float32Array) {this.subUploads.push(data.slice()); this.subOffsets.push(offset);}
  enableVertexAttribArray() {} disableVertexAttribArray() {} vertexAttribPointer() {} vertexAttribDivisor() {}
  enable() {} disable() {} colorMask() {} depthMask(value: boolean) {this.depthWrite = value;} clearColor() {} clearDepth() {} clear() {}
  viewport(...values: number[]) {this.viewportValues = values;} scissor() {} depthFunc() {} blendFuncSeparate(...values: number[]) {this.blendFactors = values;} useProgram() {} isContextLost() {return false;}
  uniformMatrix4fv() {}
  uniformMatrix3fv(_location: string, _transpose: boolean, value: Float32Array) {this.rotations.push([...value]);}
  uniform2f(location: string, ...values: number[]) {this.uniforms.set(location, values);}
  uniform4f(location: string, ...values: number[]) {this.uniforms.set(location, values);}
  uniform1f(location: string, value: number) {this.uniforms.set(location, value);}
  uniform1i(location: string, value: number) {this.uniforms.set(location, value);}
  drawArrays(mode: number, _start: number, count: number) {this.draws.push({mode, count, instances: 1, depthWrite: this.depthWrite});}
  drawArraysInstanced(mode: number, _start: number, count: number, instances: number) {this.draws.push({mode, count, instances, depthWrite: this.depthWrite});}
  drawElements(mode: number, count: number, type: number, offset: number) {assert.equal(type, this.UNSIGNED_INT); assert.equal(offset, 0); this.draws.push({mode, count, instances: 1, depthWrite: this.depthWrite});}
}
test('world3D positive style projection preserves batching, raw gaps, opt-out and lifecycle',()=>{
const viewport={left:0,top:0,width:1000,height:600},make=(height=600,radius=1.2)=>createWorldCameraFrame({position:{x:0,y:0,z:radius},projection:'perspective',autoFit:false,box:{x:1,y:1,z:1},viewport:{...viewport,height},clip:{...viewport,height}}),frame=make();
assert.equal(worldStylePixels3D(80,1,frame),80*.001*frame.focal);
assert.equal(worldStylePixels3D(80,2,frame),worldStylePixels3D(80,1,frame)/2);
assert.equal(worldStylePixels3D(80,1,make(300)),worldStylePixels3D(80,1,frame)/2);
const ortho={...frame,projection:'orthographic' as const};assert.equal(worldStylePixels3D(80,1,ortho),worldStylePixels3D(80,2,ortho));
const gl=new RecordingGL(),canvas=Object.assign(new EventTarget(),{width:1000,height:600}),gpu=new DataRenderer3D(gl as any,canvas as any);
const positions=Float32Array.from({length:32768*3},(_,i)=>i===300?NaN:(i%31)/31-.5),copy=positions.slice();
const packet={id:1,revision:1,positions,count:32768,mode:'line' as const,color:[1,.5,.2,1] as const,thickness:2,pointSize:10,worldStyleUnits:true};
gpu.render([packet],viewport,1,{azimuth:0,elevation:0,zoom:1,worldFrame:frame});
assert.equal(gl.draws.length,1);assert.deepEqual(gl.draws[0],{mode:gl.TRIANGLES,count:6,instances:32767,depthWrite:true});assert.equal(gl.uniforms.get('u_worldStyleScale'),.001*frame.focal);
const uploaded=gpu.stats.uploadedBytes;
gpu.render([packet],viewport,2,{azimuth:0,elevation:0,zoom:1,worldFrame:make(300,1.8)});
assert.equal(gpu.stats.uploadedBytes,uploaded);assert.equal(gl.uniforms.get('u_width'),4);assert.equal(gl.uniforms.get('u_worldStyleScale'),.001*make(300,1.8).focal);assert.deepEqual(positions,copy);
gpu.render([{...packet,worldStyleUnits:false}],viewport,1,{azimuth:0,elevation:0,zoom:1,worldFrame:frame});assert.equal(gl.uniforms.get('u_worldStyleScale'),0);assert.equal(gl.uniforms.get('u_width'),2);
const beforeNegative=gl.draws.length;gpu.render([{...packet,worldStyleUnits:false,thickness:-1}],viewport,1,{azimuth:0,elevation:0,zoom:1,worldFrame:frame});assert.equal(gl.draws.length,beforeNegative,'Existing negative primitive skip remains unchanged');
gpu.render([{...packet,mode:'points',pointSize:80,pointShape:'sphere'}],viewport,1,{azimuth:0,elevation:0,zoom:1,worldFrame:frame});assert.equal(gl.uniforms.get('u_pointSize'),80,'Nominal world diameter must not be clamped to GL screen maximum before projection');assert.equal(gl.uniforms.get('u_pointShape'),2);assert.equal(gl.uniforms.get('u_worldStyleScale'),.001*frame.focal);
gpu.render([],viewport,1,{azimuth:0,elevation:0,zoom:1,worldFrame:frame});assert.equal(gpu.stats.cachedBuffers,0);assert.equal(gpu.stats.cacheBytes,0);gpu.dispose();assert.equal(gl.deletedBuffers,gl.uploads.length);

});
