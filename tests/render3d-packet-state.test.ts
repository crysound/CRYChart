import test from 'node:test';
import assert from 'node:assert/strict';
import {DataRenderer3D, type DrawPacket3D} from '../src/render3d.js';

class RecordingGL {
  VERTEX_SHADER = 1; FRAGMENT_SHADER = 2; COMPILE_STATUS = 3; LINK_STATUS = 4; ALIASED_POINT_SIZE_RANGE = 5;
  ARRAY_BUFFER = 6; DYNAMIC_DRAW = 7; FLOAT = 8; SCISSOR_TEST = 9; DEPTH_TEST = 10; CULL_FACE = 11; BLEND = 12;
  LEQUAL = 13; SRC_ALPHA = 14; ONE_MINUS_SRC_ALPHA = 15; COLOR_BUFFER_BIT = 16; DEPTH_BUFFER_BIT = 32; POINTS = 64; TRIANGLES = 65; ONE = 66;
  ELEMENT_ARRAY_BUFFER = 67; UNSIGNED_INT = 68; FRONT = 69; BACK = 70;
  uploads: Array<Float32Array | Uint32Array> = []; subUploads: Float32Array[] = []; subOffsets: number[] = []; rotations: number[][] = []; viewportValues: number[] = [];
  uniforms = new Map<string, unknown>(); draws: Array<{mode: number; count: number; instances: number; depthWrite: boolean}> = [];
  deletedBuffers = 0; deletedArrays = 0; deletedPrograms = 0; depthWrite = true; blendFactors: number[] = []; private identity = 0;
  createShader() {return {id: ++this.identity};} shaderSource(_shader: unknown, text: string) {this.shaderTexts.push(text);} compileShader() {} getShaderParameter() {return true;} getShaderInfoLog() {return '';} deleteShader() {}
  createProgram() {return {id: ++this.identity};} attachShader() {} linkProgram() {} getProgramParameter() {return true;} getProgramInfoLog() {return '';} deleteProgram() {this.deletedPrograms++;}
  getUniformLocation(_program: unknown, name: string) {return name;} getParameter() {return new Float32Array([1, 64]);}
  createBuffer() {return {id: ++this.identity};} createVertexArray() {return {id: ++this.identity};}
  deleteBuffer() {this.deletedBuffers++;} deleteVertexArray() {this.deletedArrays++;} bindVertexArray() {} bindBuffer() {}
  bufferData(_target: number, data: Float32Array | Uint32Array) {this.uploads.push(data.slice());}
  bufferSubData(_target: number, offset: number, data: Float32Array) {this.subUploads.push(data.slice()); this.subOffsets.push(offset);}
  enableVertexAttribArray() {} disableVertexAttribArray() {} vertexAttribPointer() {} vertexAttribDivisor() {}
  enabled = new Set<number>(); cull = this.BACK; shaderTexts: string[] = [];
  states: Array<{depth: boolean; cull: boolean; face: number; unshaded: unknown}> = [];
  failDraw = false;
  enable(value: number) {this.enabled.add(value);} disable(value: number) {this.enabled.delete(value);}
  cullFace(value: number) {this.cull = value;}
  recordState() {this.states.push({depth: this.enabled.has(this.DEPTH_TEST), cull: this.enabled.has(this.CULL_FACE), face: this.cull, unshaded: this.uniforms.get('u_unshaded')}); if(this.failDraw) throw new Error('injected draw failure');} colorMask() {} depthMask(value: boolean) {this.depthWrite = value;} clearColor() {} clearDepth() {} clear() {}
  viewport(...values: number[]) {this.viewportValues = values;} scissor() {} depthFunc() {} blendFuncSeparate(...values: number[]) {this.blendFactors = values;} useProgram() {} isContextLost() {return false;}
  uniformMatrix3fv(_location: string, _transpose: boolean, value: Float32Array) {this.rotations.push([...value]);}
  uniform2f(location: string, ...values: number[]) {this.uniforms.set(location, values);}
  uniform4f(location: string, ...values: number[]) {this.uniforms.set(location, values);}
  uniform1f(location: string, value: number) {this.uniforms.set(location, value);}
  uniform1i(location: string, value: number) {this.uniforms.set(location, value);}
  drawArrays(mode: number, _start: number, count: number) {this.recordState();this.draws.push({mode, count, instances: 1, depthWrite: this.depthWrite});}
  drawArraysInstanced(mode: number, _start: number, count: number, instances: number) {this.draws.push({mode, count, instances, depthWrite: this.depthWrite});}
  drawElements(mode: number, count: number, type: number, offset: number) {this.recordState();assert.equal(type, this.UNSIGNED_INT); assert.equal(offset, 0); this.draws.push({mode, count, instances: 1, depthWrite: this.depthWrite});}
}
function fixture() {
 const gl = new RecordingGL(), canvas = Object.assign(new EventTarget(), {width: 500, height: 400});
 return {gl, gpu: new DataRenderer3D(gl as any, canvas as any)};
}
const rect = {left: 0, top: 0, width: 500, height: 400}, camera = {azimuth: 0, elevation: 0, zoom: 1};
const packet = (id: number, extra: object = {}): DrawPacket3D => ({id, revision: 1, positions: new Float32Array([0,0,0, 1,0,0, 0,1,0]), count: 3, mode: 'triangles', color: [1,.5,.2,1], thickness: 1, pointSize: 5, ...extra});
test('packet depth/cull and explicit Simple apply per draw without leaking into the next packet or frame', () => {
 const {gl, gpu} = fixture();
 gpu.render([packet(1, {depthTestEnabled: false, backfaceCullingMode: 'cull-front', unshaded: true}), packet(2)], rect, 1, camera);
 assert.deepEqual(gl.states, [
  {depth: false, cull: true, face: gl.FRONT, unshaded: 1},
  {depth: true, cull: false, face: gl.FRONT, unshaded: 0},
 ]);
 assert.equal(gl.enabled.has(gl.DEPTH_TEST), false);
 assert.equal(gl.enabled.has(gl.CULL_FACE), false);
 assert.equal(gl.depthWrite, true);
 const uploaded = gpu.stats.uploadedBytes;
 gpu.render([packet(1, {backfaceCullingMode: 'cull-back'})], rect, 1, camera);
 assert.deepEqual(gl.states.at(-1), {depth: true, cull: true, face: gl.BACK, unshaded: 0});
 assert.equal(gpu.stats.uploadedBytes, uploaded, 'State-only edits do not reupload vertices');
 assert.equal(gl.enabled.has(gl.CULL_FACE), false);
 gpu.dispose();
});
test('explicit Simple disables Sphere lighting while an ordinary lighting=false retains legacy Sphere shading', () => {
 const {gl, gpu} = fixture();
 gpu.render([packet(1, {mode: 'points', pointShape: 'sphere', lighting: false, unshaded: true})], rect, 1, camera);
 assert.equal(gl.uniforms.get('u_unshaded'), 1);
 assert.ok(gl.shaderTexts.some(text => text.includes('u_unshaded') && text.includes('u_pointShape == 2')));
 gpu.render([packet(1, {mode: 'points', pointShape: 'sphere', lighting: false})], rect, 1, camera);
 assert.equal(gl.uniforms.get('u_unshaded'), 0);
 gl.failDraw = true;
 assert.throws(() => gpu.render([packet(1, {backfaceCullingMode: 'cull-back'})], rect, 1, camera), /injected/);
 assert.equal(gl.enabled.has(gl.CULL_FACE), false);
 assert.equal(gl.enabled.has(gl.DEPTH_TEST), false);
 assert.equal(gl.depthWrite, true);
 gpu.dispose();
});
