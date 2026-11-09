import test from 'node:test';
import assert from 'node:assert/strict';
import {DataRendererHeatmap, buildHeatmapPalette, heatmapTextureIndex, normalizeHeatmapValue, sampleHeatmapIntensity, type DrawPacketHeatmap} from '../src/render-heatmap.js';
import {ChartXY} from '../src/chart.js';
import {containedRasterClip,rasterTargetForRect} from '../src/raster-clip.js';

test('bilinear interpolation blends intensities before the LUT, clamps logical edges and preserves missing samples',()=>{
  const values=new Float32Array([0,0,0,1]);assert.equal(sampleHeatmapIntensity(values,2,2,1,1,'bilinear'),.25);assert.equal(sampleHeatmapIntensity(values,2,2,.1,.1,'bilinear'),0);assert.equal(sampleHeatmapIntensity(values,2,2,1.1,1.1,'disabled'),1);
  values[3]=NaN;assert.ok(Number.isNaN(sampleHeatmapIntensity(values,2,2,1,1,'bilinear')));assert.equal(sampleHeatmapIntensity(values,2,2,.5,.5,'bilinear'),0);
  const ring=new Float32Array([2,3,0,1]);assert.equal(sampleHeatmapIntensity(ring,4,1,.1,.5,'bilinear',{x:2,y:0}),0);assert.equal(sampleHeatmapIntensity(ring,4,1,1,.5,'bilinear',{x:2,y:0}),.5);
  assert.ok(Number.isNaN(sampleHeatmapIntensity(ring,4,1,-.1,.5,'bilinear')));
});

test('palette sampling includes both endpoints, normalized channels and alpha', () => {
  const seen: number[] = [];
  const values = buildHeatmapPalette(value => {seen.push(value); return {r: value / 10, g: 2, b: -1, a: value / 20};}, 0, 10, 3);
  assert.deepEqual(seen, [0, 5, 10]);
  assert.deepEqual([...values], [0, 255, 0, 0, 128, 255, 0, 64, 255, 255, 0, 128]);
  assert.throws(() => buildHeatmapPalette(() => ({r: NaN, g: 0, b: 0}), 0, 1), /channels/);
  assert.throws(() => buildHeatmapPalette(() => ({r: 0, g: 0, b: 0}), 0, 1, 1), /size/);
});

test('ring coordinates preserve row-major orientation across wrap and negative offsets', () => {
  const indices = Array.from({length: 6}, (_, i) => heatmapTextureIndex(i % 3, Math.floor(i / 3), 3, 2, {x: 2, y: 1}));
  assert.deepEqual(indices, [5, 3, 4, 2, 0, 1]);
  assert.equal(heatmapTextureIndex(0, 0, 3, 2, {x: -1, y: -1}), 5);
  assert.equal(heatmapTextureIndex(2, 1, 3, 2), 5);
  assert.throws(() => heatmapTextureIndex(3, 0, 3, 2), /existing cell/);
});

test('intensity normalization handles reversed, constant and large ranges without infinite spans', () => {
  assert.equal(normalizeHeatmapValue(5, {start: 0, end: 10}), .5);
  assert.equal(normalizeHeatmapValue(20, {start: 0, end: 10}), 1);
  assert.equal(normalizeHeatmapValue(0, {start: 10, end: 0}), 1);
  assert.equal(normalizeHeatmapValue(100, {start: 2, end: 2}), .5);
  assert.equal(normalizeHeatmapValue(0, {start: -3e38, end: 3e38}), .5);
  assert.equal(normalizeHeatmapValue(3e38, {start: -3e38, end: 3e38}), 1);
  assert.ok(Number.isNaN(normalizeHeatmapValue(Infinity, {start: 0, end: 1})));
  assert.ok(Number.isNaN(normalizeHeatmapValue(NaN, {start: 0, end: 1})));
});

/** Records GL calls only. Real shader compilation and pixels are checked in visible Chrome. */
class RecordingGL {
  VERTEX_SHADER = 1; FRAGMENT_SHADER = 2; COMPILE_STATUS = 3; LINK_STATUS = 4; MAX_TEXTURE_SIZE = 5;
  SCISSOR_TEST = 6; DEPTH_TEST = 7; CULL_FACE = 8; STENCIL_TEST = 9; BLEND = 10; SRC_ALPHA = 11;
  ONE_MINUS_SRC_ALPHA = 12; ONE = 13; COLOR_BUFFER_BIT = 14; TEXTURE0 = 15; TEXTURE1 = 16; TEXTURE_2D = 17;
  TEXTURE_MIN_FILTER = 18; TEXTURE_MAG_FILTER = 19; TEXTURE_WRAP_S = 20; TEXTURE_WRAP_T = 21; CLAMP_TO_EDGE = 22;
  NEAREST = 23; LINEAR = 24; R32UI = 25; RED_INTEGER = 26; UNSIGNED_INT = 27; RGBA8 = 28; RGBA = 29; UNSIGNED_BYTE = 30;
  TRIANGLES = 31; UNPACK_ALIGNMENT = 32; UNPACK_ROW_LENGTH = 33; UNPACK_SKIP_PIXELS = 34; UNPACK_SKIP_ROWS = 35;
  TEXTURE2=36;R32F=37;RED=38;FLOAT=39;
  DRAW_FRAMEBUFFER_BINDING=40;
  framebuffer:WebGLFramebuffer|null=null;scissors:number[][]=[];
  uniforms = new Map<string, unknown>(); enabled = new Set<number>(); pixelStore = new Map<number, number>();
  transfers: Array<{mode: 'allocate' | 'update'; width: number; height: number; format: number; data: unknown; unit: number}> = [];
  filters: Array<{unit: number; parameter: number; value: number}> = [];
  createdTextures = 0; deletedTextures = 0; deletedPrograms = 0; deletedShaders = 0; deletedArrays = 0;
  clearCount = 0; drawCount = 0; depthWrite = true; activeUnit = 15; viewportValues: number[] = []; blendFactors: number[] = []; vao: unknown;
  failShader = false; failLink = false; private identity = 0;
  createShader() {return {id: ++this.identity};} shaderSource() {} compileShader() {} getShaderParameter() {return !this.failShader;} getShaderInfoLog() {return 'Shader failed';} deleteShader() {this.deletedShaders++;}
  createProgram() {return {id: ++this.identity};} attachShader() {} linkProgram() {} getProgramParameter() {return !this.failLink;} getProgramInfoLog() {return 'Link failed';} deleteProgram() {this.deletedPrograms++;}
  createVertexArray() {return {id: ++this.identity};} bindVertexArray(value: unknown) {this.vao = value;} deleteVertexArray() {this.deletedArrays++;}
  getParameter(key:number) {return key===this.DRAW_FRAMEBUFFER_BINDING?this.framebuffer:4096;} getUniformLocation(_program: unknown, name: string) {return name;} isContextLost() {return false;}
  enable(value: number) {this.enabled.add(value);} disable(value: number) {this.enabled.delete(value);} colorMask() {} depthMask(value: boolean) {this.depthWrite = value;}
  clearColor() {} clear() {this.clearCount++;} viewport(...values: number[]) {this.viewportValues = values;} scissor(...values:number[]) {this.scissors.push(values);} blendFuncSeparate(...values: number[]) {this.blendFactors = values;} useProgram() {}
  uniform1i(name: string, value: number) {this.uniforms.set(name, value);} uniform1f(name: string, value: number) {this.uniforms.set(name, value);}
  uniform2i(name: string, ...value: number[]) {this.uniforms.set(name, value);} uniform2f(name: string, ...value: number[]) {this.uniforms.set(name,value);} uniform3f(name: string, ...value: number[]) {this.uniforms.set(name, value);} uniform4f(name: string, ...value: number[]) {this.uniforms.set(name, value);}
  pixelStorei(name: number, value: number) {this.pixelStore.set(name, value);} activeTexture(unit: number) {this.activeUnit = unit;} bindTexture() {}
  createTexture() {this.createdTextures++; return {id: ++this.identity};} deleteTexture() {this.deletedTextures++;}
  texParameteri(_target: number, parameter: number, value: number) {this.filters.push({unit: this.activeUnit, parameter, value});}
  texImage2D(_target: number, _level: number, format: number, width: number, height: number, _border: number, _format: number, _type: number, data: unknown) {this.transfers.push({mode: 'allocate', width, height, format, data, unit: this.activeUnit});}
  texSubImage2D(_target: number, _level: number, _x: number, _y: number, width: number, height: number, format: number, _type: number, data: unknown) {this.transfers.push({mode: 'update', width, height, format, data, unit: this.activeUnit});}
  drawArrays(mode: number, _start: number, count: number) {assert.equal(mode, this.TRIANGLES); assert.equal(count, 6); this.drawCount++;}
}

function scene(gl = new RecordingGL()) {
  const canvas = Object.assign(new EventTarget(), {width: 1000, height: 640});
  return {gl, canvas, renderer: new DataRendererHeatmap(gl as unknown as WebGL2RenderingContext, canvas as unknown as HTMLCanvasElement)};
}
function packet(overrides: Partial<DrawPacketHeatmap> = {}): DrawPacketHeatmap {
  return {id: 1, revision: 1, values: new Float32Array([0, 1, 2, NaN, Infinity, 5]), columns: 3, rows: 2, extent: [0, 1, 0, 1], intensityRange: {start: 0, end: 5}, palette: new Uint8Array([0, 0, 255, 255, 255, 0, 0, 255]), ...overrides};
}
const rect = {left: 10, top: 20, width: 200, height: 100};

test('contained heatmap uses per-grid complete-pixel clips, actual FBO dimensions and clears empty frames',()=>{
  const gl=new RecordingGL(),canvas=Object.assign(new EventTarget(),{width:1000,height:640});
  const renderer=new DataRendererHeatmap(gl as unknown as WebGL2RenderingContext,canvas as unknown as HTMLCanvasElement,{clipPolicy:'contained'});
  const target=rasterTargetForRect(null,240,140,rect,1),data=packet({clipRect:{left:15.2,top:50.1,width:70.4,height:10.5}});
  renderer.render([data],rect,1,{rasterTarget:target});
  const clip=containedRasterClip(rect,data.clipRect,target)!;
  assert.deepEqual(gl.scissors.at(-1),[clip.x,clip.y,clip.width,clip.height]);
  assert.deepEqual(gl.viewportValues,[10,20,200,100]);assert.equal(gl.drawCount,1);
  renderer.render([{...data,clipRect:{left:15.2,top:50.1,width:.2,height:10}}],rect,1,{rasterTarget:target});
  assert.equal(gl.drawCount,1);assert.equal(gl.clearCount,2);assert.equal(renderer.stats.cachedTextures,2);
  const cleared=gl.clearCount;
  assert.throws(()=>renderer.render([data],rect,1),/explicit/);assert.equal(gl.clearCount,cleared);
  assert.throws(()=>renderer.render([data],rect,1,{rasterTarget:{...target,framebuffer:{} as WebGLFramebuffer}}),/destination framebuffer/);assert.equal(gl.clearCount,cleared);
  renderer.render([],rect,1,{rasterTarget:target});assert.equal(renderer.stats.cachedTextures,0);renderer.dispose();
});

test('polar orientation and radius changes reuse intensity and palette textures',()=>{
  const {gl,renderer}=scene(),data=packet({polar:{angleOrigin:0,direction:1,innerRadius:0,outerRadius:1}});renderer.render([data],rect,2);const before=renderer.stats.textureUploads;
  renderer.render([{...data,polar:{angleOrigin:Math.PI/2,direction:-1,innerRadius:.2,outerRadius:.8}}],rect,2);
  assert.equal(renderer.stats.textureUploads,before);assert.deepEqual(gl.uniforms.get('u_polarCoordinates'),[Math.PI/2,-1,.2,.8]);assert.equal(gl.uniforms.get('u_polar'),1);renderer.dispose();
});

test('partial intensity upload requires the exact prior revision and otherwise resends the complete grid',()=>{
  const {gl,renderer}=scene(),data=packet();renderer.render([data],rect,1);const before=renderer.stats.uploadedBytes;
  data.values[1]=42;renderer.render([{...data,revision:2,update:{x:1,y:0,width:1,height:1,previousRevision:1}}],rect,1);assert.equal(renderer.stats.uploadedBytes-before,4);assert.equal(gl.transfers.at(-1)?.width,1);assert.equal(gl.transfers.at(-1)?.height,1);assert.equal(gl.pixelStore.get(gl.UNPACK_ROW_LENGTH),0);assert.equal(gl.pixelStore.get(gl.UNPACK_SKIP_PIXELS),0);
  const next=renderer.stats.uploadedBytes;renderer.render([{...data,revision:4,update:{x:2,y:1,width:1,height:1,previousRevision:3}}],rect,1);assert.equal(renderer.stats.uploadedBytes-next,data.values.byteLength);assert.equal(gl.transfers.at(-1)?.width,3);renderer.dispose();
});

test('pan, axis reversal and ring offsets change uniforms without copying or uploading intensities', () => {
  const {gl, renderer} = scene(), data = packet();
  renderer.render([data], rect, 2);
  assert.equal(renderer.stats.uploads, 1); assert.equal(renderer.stats.paletteUploads, 1); assert.equal(gl.transfers.length, 2);
  const bits = gl.transfers[0].data as Uint32Array;
  assert.ok(bits instanceof Uint32Array); assert.equal(bits.buffer, data.values.buffer); assert.equal(bits.byteOffset, data.values.byteOffset); assert.equal(bits.length, data.values.length);
  assert.equal(gl.transfers[0].format, gl.R32UI);
  assert.equal(bits[3] & 0x7f800000, 0x7f800000); assert.equal(bits[4] & 0x7f800000, 0x7f800000);
  assert.deepEqual(gl.viewportValues, [20, 400, 400, 200]);
  renderer.render([{...data, extent: [1.5, -.5, 0, 1], scrollOffset: {x: -1, y: 3}}], rect, 2, {clear: false});
  assert.equal(gl.transfers.length, 2); assert.equal(gl.clearCount, 1);
  assert.deepEqual(gl.uniforms.get('u_extent'), [1.5, -.5, 0, 1]); assert.deepEqual(gl.uniforms.get('u_offset'), [2, 1]);
  assert.equal(renderer.stats.drawCalls, 1); assert.equal(renderer.stats.cells, 6);
  assert.equal(gl.depthWrite, true); assert.equal(gl.vao, null); assert.equal(gl.activeUnit, gl.TEXTURE0); assert.equal(gl.enabled.has(gl.SCISSOR_TEST), false);
  assert.deepEqual(gl.blendFactors, [gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA]);
});

test('intensity and palette revisions update their own textures; discrete filter changes do not upload', () => {
  const {gl, renderer} = scene(), data = packet(); renderer.render([data], rect, 1);
  data.values[0] = 9; renderer.render([{...data, revision: 2}], rect, 1);
  assert.equal(gl.transfers.length, 3); assert.equal(gl.transfers[2].mode, 'update'); assert.equal(gl.transfers[2].unit, gl.TEXTURE0);
  renderer.render([{...data, revision: 2, paletteFilter: 'nearest'}], rect, 1);
  assert.equal(gl.transfers.length, 3); assert.ok(gl.filters.some(value => value.unit === gl.TEXTURE1 && value.parameter === gl.TEXTURE_MIN_FILTER && value.value === gl.NEAREST));
  renderer.render([{...data, revision: 2, paletteRevision: 2, paletteFilter: 'nearest'}], rect, 1);
  assert.equal(gl.transfers.length, 4); assert.equal(gl.transfers[3].unit, gl.TEXTURE1);
  assert.equal(renderer.stats.uploads, 2); assert.equal(renderer.stats.paletteUploads, 2);
});

test('replaced arrays and resized textures remain correct even when the caller keeps the same revision', () => {
  const {gl, renderer} = scene(), data = packet(); renderer.render([data], rect, 1);
  const replacement = {...data, values: data.values.slice()}; renderer.render([replacement], rect, 1);
  assert.equal(renderer.stats.uploads, 2); assert.equal(gl.transfers[2].mode, 'update');
  renderer.render([{...replacement, columns: 2, rows: 3}], rect, 1);
  assert.equal(gl.transfers[3].mode, 'allocate'); assert.deepEqual([gl.transfers[3].width, gl.transfers[3].height], [2, 3]);
  assert.equal(renderer.stats.cachedTextures, 2); assert.equal(renderer.stats.cacheBytes, 32);
  renderer.render([], rect, 1); assert.equal(gl.deletedTextures, 2); assert.equal(renderer.stats.cacheBytes, 0);
});

test('invalid packet storage and dimensions fail before texture allocation', () => {
  const {gl, renderer} = scene();
  assert.throws(() => renderer.render([packet({values: new Float32Array(5)})], rect, 1), /storage/);
  assert.throws(() => renderer.render([packet({columns: 4097})], rect, 1), /dimensions/);
  assert.throws(() => renderer.render([packet({palette: new Uint8Array(3)})], rect, 1), /palette/);
  assert.throws(() => renderer.render([packet({scrollOffset: {x: .5, y: 0}})], rect, 1), /integer/);
  assert.equal(gl.createdTextures, 0); assert.equal(gl.clearCount, 0);
});

test('context restoration rebuilds textures and disposal releases resources and listeners once', () => {
  const {gl, canvas, renderer} = scene(), data = packet(); renderer.render([data], rect, 1);
  assert.equal(renderer.getUploadedRevision(data.id),data.revision);
  const lost = new Event('webglcontextlost', {cancelable: true}); canvas.dispatchEvent(lost); assert.equal(lost.defaultPrevented, true);
  assert.equal(renderer.getUploadedRevision(data.id),undefined);
  renderer.render([data], rect, 1); assert.equal(renderer.stats.drawCalls, 0);
  canvas.dispatchEvent(new Event('webglcontextrestored'));assert.equal(renderer.getUploadedRevision(data.id),undefined); renderer.render([data], rect, 1);
  assert.equal(renderer.getUploadedRevision(data.id),data.revision);
  assert.equal(renderer.stats.contextRestores, 1); assert.equal(renderer.stats.uploads, 2); assert.equal(renderer.stats.paletteUploads, 2);
  renderer.dispose(); assert.equal(renderer.stats.cacheBytes, 0); assert.equal(gl.deletedTextures, 2);
  assert.equal(renderer.getUploadedRevision(data.id),undefined);
  const deleted = gl.deletedTextures; renderer.dispose(); canvas.dispatchEvent(new Event('webglcontextrestored'));
  assert.equal(gl.deletedTextures, deleted); assert.equal(renderer.stats.contextRestores, 1);
  assert.throws(() => renderer.render([data], rect, 1), /disposed/);
});

test('acknowledged heatmap patches upload their union once while hidden and whole-grid changes stay safe',()=>{
  const chart=new ChartXY(),heat=chart.addHeatmapGridSeries({dataOrder: 'rows', columns:250,rows:1000}),{renderer,gl}=scene(),palette=new Uint8Array([0,0,255,255,255,0,0,255]);
  const current=()=>packet({id:heat.id,columns:heat.columns,rows:heat.rows,values:heat.data,revision:heat.dataRevision,update:heat.dataUpdate,palette});
  const draw=()=>{const data=current();renderer.render([data],rect,1);if(renderer.getUploadedRevision(heat.id)===data.revision)heat.acknowledgeDataRevision(data.revision);};
  heat.invalidateIntensityValues(new Float32Array(250000));draw();const first=renderer.stats.uploadedBytes;
  heat.invalidateIntensityValues({iColumn:2,iRow:0,values:Array.from({length:1000},()=>[11])});
  heat.invalidateIntensityValues({iColumn:3,iRow:0,values:Array.from({length:1000},()=>[22])});
  draw();assert.equal(renderer.stats.uploadedBytes-first,8000);assert.deepEqual([gl.transfers.at(-1)?.width,gl.transfers.at(-1)?.height],[2,1000]);assert.equal(heat.dataUpdate,undefined);
  renderer.render([],rect,1);assert.equal(renderer.getUploadedRevision(heat.id),undefined);
  heat.invalidateIntensityValues({iColumn:4,iRow:0,values:[[33]]});const beforeShow=renderer.stats.uploadedBytes;draw();assert.equal(renderer.stats.uploadedBytes-beforeShow,250000*4+palette.length);assert.equal(heat.data[4],33);
  const beforeFull=renderer.stats.uploadedBytes;heat.invalidateIntensityValues(new Float32Array(250000).fill(44));heat.invalidateIntensityValues({iColumn:5,iRow:0,values:[[55]]});draw();assert.equal(renderer.stats.uploadedBytes-beforeFull,250000*4);assert.equal(heat.data[0],44);assert.equal(heat.data[5],55);
  renderer.dispose();chart.dispose();
});

test('shader and linking failures delete every successfully allocated resource', () => {
  const shaderFailure = new RecordingGL(); shaderFailure.failShader = true;
  assert.throws(() => scene(shaderFailure), /Shader failed/); assert.equal(shaderFailure.deletedShaders, 1);
  const linkFailure = new RecordingGL(); linkFailure.failLink = true;
  assert.throws(() => scene(linkFailure), /Link failed/); assert.equal(linkFailure.deletedShaders, 2); assert.equal(linkFailure.deletedPrograms, 1);
});

test('integer upload preserves NaN payloads, signed infinities and nonzero typed-array offsets without copying', () => {
  const source = new Uint32Array([0xdeadbeef, 0x00000000, 0x3f800000, 0x7f800001, 0x7fc12345, 0xff800000, 0x7f800000, 0xcafebabe]);
  const values = new Float32Array(source.buffer, 4, 6), snapshot = source.slice(), {gl, renderer} = scene();
  renderer.render([packet({values})], rect, 1);
  const transfer = gl.transfers[0].data as Uint32Array;
  assert.equal(transfer.buffer, source.buffer); assert.equal(transfer.byteOffset, 4);
  assert.deepEqual([...transfer], [...source.subarray(1, 7)]); assert.deepEqual(source, snapshot);
  assert.deepEqual([...transfer].map(bits => (bits & 0x7f800000) === 0x7f800000), [false, false, true, true, true, true]);
});
