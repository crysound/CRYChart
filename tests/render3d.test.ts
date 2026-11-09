import test from 'node:test';
import assert from 'node:assert/strict';
import {DataRenderer3D, cameraProjectionScales, cameraRotationMatrix, prepareTriangles3D, projectNormalized3D, type DrawPacket3D} from '../src/render3d.js';
import {Chart3D} from '../src/chart.js';

const close = (a: number, b: number, tolerance = 1e-5) => assert.ok(Math.abs(a - b) <= tolerance, `${a} differs from ${b}`);

test('3D projection agrees with independent quarter-turn and zero-angle camera cases', () => {
  const rect = {left: 10, top: 20, width: 200, height: 100};
  let p = projectNormalized3D({x: 1, y: 1, z: 1}, rect, {azimuth: 0, elevation: 0, zoom: 1});
  close(p.x, 144); close(p.y, 36); close(p.depth, 1);
  p = projectNormalized3D({x: 1, y: 0, z: 0}, rect, {azimuth: Math.PI / 2, elevation: 0, zoom: 1});
  close(p.x, 110); close(p.y, 70); close(p.depth, 1);
  p = projectNormalized3D({x: 0, y: 0, z: 1}, rect, {azimuth: 0, elevation: Math.PI / 2, zoom: 2});
  close(p.x, 110); close(p.y, 138); close(p.depth, 0);
});

test('camera rotation stays orthonormal and the normalized cube fits the fixed depth slab', () => {
  const rect = {left: 0, top: 0, width: 900, height: 300};
  for (let i = 0; i < 20; i++) {
    const camera = {azimuth: i * .31 - 2, elevation: i * .13 - 1, zoom: 1.5}, matrix = cameraRotationMatrix(camera);
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) { let dot = 0; for (let row = 0; row < 3; row++) dot += matrix[a * 3 + row] * matrix[b * 3 + row]; close(dot, a === b ? 1 : 0, 2e-7); }
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
      const p = projectNormalized3D({x, y, z}, rect, camera);
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y)); assert.ok(Math.abs(p.depth * .5) < 1);
    }
  }
  const scale = cameraProjectionScales({azimuth: 0, elevation: 0, zoom: 1}, rect);
  close(scale.x * rect.width, scale.y * rect.height);
  assert.throws(() => cameraProjectionScales({azimuth: 0, elevation: 0, zoom: NaN}, rect), /zoom/);
  assert.throws(() => cameraRotationMatrix({azimuth: Infinity, elevation: 0, zoom: 1}), /angles/);
});

test('invalid surface vertices remove their entire triangle and matching colors only', () => {
  const positions = new Float32Array([
    0, 0, 0, 1, 0, 0, 0, 1, 0,
    0, 0, 1, NaN, 0, 1, 0, 1, 1,
    -1, 0, 0, 0, 0, 0, -1, 1, 0,
  ]);
  const colors = Float32Array.from({length: 36}, (_, index) => index / 36);
  const result = prepareTriangles3D(positions, colors);
  assert.equal(result.count, 6);
  assert.deepEqual([...result.positions], [...positions.slice(0, 9), ...positions.slice(18, 27)]);
  assert.deepEqual([...result.colors!], [...colors.slice(0, 12), ...colors.slice(24, 36)]);
  assert.ok(Number.isNaN(positions[12]));
  assert.equal(positions.length, 27);
  const clean = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  assert.equal(prepareTriangles3D(clean).positions, clean);
  assert.throws(() => prepareTriangles3D(clean, new Float32Array(2)), /count/);
});

/** Records resource and draw behavior; browser tests separately compile the real GLSL. */
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
  uniformMatrix3fv(_location: string, _transpose: boolean, value: Float32Array) {this.rotations.push([...value]);}
  uniform2f(location: string, ...values: number[]) {this.uniforms.set(location, values);}
  uniform4f(location: string, ...values: number[]) {this.uniforms.set(location, values);}
  uniform1f(location: string, value: number) {this.uniforms.set(location, value);}
  uniform1i(location: string, value: number) {this.uniforms.set(location, value);}
  drawArrays(mode: number, _start: number, count: number) {this.draws.push({mode, count, instances: 1, depthWrite: this.depthWrite});}
  drawArraysInstanced(mode: number, _start: number, count: number, instances: number) {this.draws.push({mode, count, instances, depthWrite: this.depthWrite});}
  drawElements(mode: number, count: number, type: number, offset: number) {assert.equal(type, this.UNSIGNED_INT); assert.equal(offset, 0); this.draws.push({mode, count, instances: 1, depthWrite: this.depthWrite});}
}
function renderer() {
  const gl = new RecordingGL(), canvas = Object.assign(new EventTarget(), {width: 1000, height: 640});
  return {gl, canvas, renderer: new DataRenderer3D(gl as unknown as WebGL2RenderingContext, canvas as unknown as HTMLCanvasElement)};
}
function packet(overrides: Partial<DrawPacket3D> = {}): DrawPacket3D {
  return {id: 1, revision: 1, positions: new Float32Array([0, 0, 0, 1, 1, 1, -1, 1, 0]), count: 3, mode: 'points', color: [1, .5, .2, 1], thickness: 3, pointSize: 6, ...overrides};
}
const viewport = {left: 10, top: 20, width: 200, height: 100};
const camera = {azimuth: -.65, elevation: .48, zoom: 1};

test('bounding-box ratios change projection uniformly on CPU and GPU without changing camera or uploading geometry',()=>{
  const {gl,renderer:gpu}=renderer(),input=packet();gpu.render([input],viewport,1,camera);const uploaded=gpu.stats.uploadedBytes;
  gpu.render([input],viewport,1,{...camera,boundingBox:{x:3,y:1,z:1}});assert.deepEqual(gl.uniforms.get('u_volume'),[1,1/3,1/3,1]);assert.equal(gpu.stats.uploadedBytes,uploaded);
  const pose={azimuth:0,elevation:0,zoom:1,boundingBox:{x:3,y:1,z:1}},center=projectNormalized3D({x:0,y:0,z:0},viewport,pose),px=projectNormalized3D({x:1,y:0,z:0},viewport,pose),py=projectNormalized3D({x:0,y:1,z:0},viewport,pose);
  assert.ok(Math.abs((px.x-center.x)/(center.y-py.y)-3)<1e-10);
  assert.deepEqual(projectNormalized3D({x:1,y:1,z:1},viewport,pose),projectNormalized3D({x:1,y:1,z:1},viewport,{...pose,boundingBox:{x:30,y:10,z:10}}));
  const chart=new Chart3D().setCameraLocation(camera),before=chart.getCameraLocation();chart.setBoundingBox({x:3,y:1,z:1});assert.deepEqual(chart.getCameraLocation(),before);const box=chart.getBoundingBox();box.x=99;assert.equal(chart.getBoundingBox().x,3);assert.throws(()=>chart.setBoundingBox({x:0,y:1,z:1}),/positive/);chart.dispose();gpu.dispose();
});

test('indexed meshes retain shared vertices, filter whole invalid faces and do not reupload on rotation', () => {
  const {gl, renderer: gpu} = renderer();
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]), indices = new Uint32Array([0, 1, 2, 0, 2, 3]);
  const input = packet({mode: 'triangles', positions, indices, indexRevision: 1, count: 4, normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]), lighting: true});
  gpu.render([input], viewport, 1, camera); assert.equal(gl.draws.at(-1)!.count, 6); assert.equal(gl.uniforms.get('u_lighting'), 1); const bytes = gpu.stats.uploadedBytes;
  gpu.render([input], viewport, 1, {...camera, azimuth: 1}); assert.equal(gpu.stats.uploadedBytes, bytes); assert.equal(gl.uploads.length, 3);
  positions[9] = NaN; gpu.render([{...input, revision: 2}], viewport, 1, camera); assert.equal(gl.draws.at(-1)!.count, 3); const after = gpu.stats.uploadedBytes;
  gpu.render([{...input, revision: 2}], viewport, 1, {...camera, azimuth: 2}); assert.equal(gpu.stats.uploadedBytes, after, 'filtered index arrays must not defeat camera caching'); gpu.dispose(); assert.equal(gl.deletedBuffers, 3);
});

test('cuboids use one procedural instanced draw and rounded geometry changes only uniforms', () => {
  const {gl, renderer: gpu} = renderer(), input = packet({mode: 'boxes', boxSizes: new Float32Array([.3, .4, .2, .1, .8, .4, .2, .2, .2]), colors: new Float32Array(12).fill(1), boxTopColors: new Float32Array(12).fill(.8), lighting: true});
  gpu.render([input], viewport, 1, camera); assert.equal(gl.draws.at(-1)!.count, 36); assert.equal(gl.draws.at(-1)!.instances, 3); assert.equal(gl.uniforms.get('u_box'), 1); const uploaded = gpu.stats.uploadedBytes;
  gpu.render([{...input, roundness: .12}], viewport, 1, camera); assert.equal(gl.draws.at(-1)!.count, 36 * 64); assert.equal(gpu.stats.uploadedBytes, uploaded); assert.equal(gl.uniforms.get('u_boxTopColors'), 1); assert.equal(gl.uniforms.get('u_roundness'), .12); gpu.dispose();
});

test('per-point diameters and sphere shading use real vertex attributes without expanding point storage', () => {
  const {gl, renderer: gpu} = renderer(), input = packet({pointSizes: new Float32Array([3, 9, 18]), pointShape: 'sphere'});
  gpu.render([input], viewport, 2, camera); assert.equal(gl.draws.at(-1)!.count, 3); assert.equal(gl.uniforms.get('u_vertexSizes'), 1); assert.equal(gl.uniforms.get('u_dpr'), 2); assert.equal(gl.uniforms.get('u_pointShape'), 2); assert.equal(gl.uploads.length, 2); assert.deepEqual([...gl.uploads[1]], [3, 9, 18]); gpu.dispose();
});

test('same-size partial mesh updates upload only the requested position range and preserve index buffers', () => {
  const {gl, renderer: gpu} = renderer(), positions = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]), input = packet({mode: 'triangles', positions, count: 4, indices: new Uint32Array([0, 1, 2, 0, 2, 3]), indexRevision: 1, allFinite: true});
  gpu.render([input], viewport, 1, camera); const uploaded = gpu.stats.uploadedBytes; positions[4] = .3;
  gpu.render([{...input, revision: 2, previousRevision: 1, positionUpdateRanges: [{start: 3, count: 3}]}], viewport, 1, camera); assert.equal(gpu.stats.uploadedBytes - uploaded, 12); assert.equal(gl.subOffsets.at(-1), 12); assert.equal(gl.subUploads.at(-1)!.length, 3); assert.equal(gl.uploads.length, 2); gpu.dispose();
});

test('camera rotation reuses geometry and colors; revised same-size data uses sub-upload', () => {
  const scene = renderer(), data = packet({colors: new Float32Array([1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 1])});
  scene.renderer.render([data], viewport, 2, camera);
  assert.equal(scene.renderer.stats.uploads, 1); assert.equal(scene.gl.uploads.length, 2);
  assert.deepEqual(scene.gl.viewportValues, [20, 400, 400, 200]);
  assert.equal(scene.gl.uniforms.get('u_pointSize'), 12);
  scene.renderer.render([data], viewport, 2, {...camera, azimuth: .3});
  assert.equal(scene.renderer.stats.uploads, 1); assert.equal(scene.gl.uploads.length, 2);
  assert.notDeepEqual(scene.gl.rotations[0], scene.gl.rotations[1]);
  scene.renderer.render([{...data, revision: 2}], viewport, 2, camera);
  assert.equal(scene.renderer.stats.uploads, 2); assert.equal(scene.gl.subUploads.length, 2);
  scene.renderer.render([], viewport, 2, camera);
  assert.equal(scene.renderer.stats.cachedBuffers, 0); assert.equal(scene.renderer.stats.cacheBytes, 0);
  assert.equal(scene.gl.deletedBuffers, 2); assert.equal(scene.gl.deletedArrays, 2);
});

test('3D lines draw thick segment instances and share buffers with point markers', () => {
  const scene = renderer(), data = packet({mode: 'line'});
  scene.renderer.render([data, {...data, mode: 'points'}], viewport, 1, camera);
  assert.equal(scene.renderer.stats.uploads, 1);
  assert.deepEqual(scene.gl.draws.map(draw => [draw.mode, draw.count, draw.instances]), [[scene.gl.TRIANGLES, 6, 2], [scene.gl.POINTS, 3, 1]]);
  assert.equal(scene.renderer.stats.drawCalls, 2); assert.equal(scene.renderer.stats.submittedVertices, 15);
  assert.equal(scene.gl.depthWrite, true);
});

test('opaque geometry writes depth; transparent geometry tests without replacing it', () => {
  const scene = renderer();
  scene.renderer.render([packet({id: 2, color: [1, 0, 0, .5]}), packet({id: 1})], viewport, 1, camera);
  assert.deepEqual(scene.gl.draws.map(draw => draw.depthWrite), [true, false]);
  assert.equal(scene.gl.depthWrite, true);
  assert.deepEqual(scene.gl.blendFactors, [scene.gl.SRC_ALPHA, scene.gl.ONE_MINUS_SRC_ALPHA, scene.gl.ONE, scene.gl.ONE_MINUS_SRC_ALPHA]);
});

test('context restoration rebuilds resources and disposal removes listeners and buffers once', () => {
  const scene = renderer(), data = packet();
  scene.renderer.render([data], viewport, 1, camera);
  const lost = new Event('webglcontextlost', {cancelable: true}); scene.canvas.dispatchEvent(lost);
  assert.equal(lost.defaultPrevented, true);
  scene.renderer.render([data], viewport, 1, camera); assert.equal(scene.renderer.stats.drawCalls, 0);
  scene.canvas.dispatchEvent(new Event('webglcontextrestored'));
  scene.renderer.render([data], viewport, 1, camera);
  assert.equal(scene.renderer.stats.contextRestores, 1); assert.equal(scene.renderer.stats.uploads, 2);
  scene.renderer.dispose(); const deleted = scene.gl.deletedBuffers; scene.renderer.dispose();
  assert.equal(scene.gl.deletedBuffers, deleted); assert.equal(scene.renderer.stats.cacheBytes, 0);
  assert.throws(() => scene.renderer.render([data], viewport, 1, camera), /disposed/);
});

test('invalid packets fail with explicit bounds before uploading unsafe memory', () => {
  const scene = renderer();
  assert.throws(() => scene.renderer.render([packet({count: 100})], viewport, 1, camera), /positions/);
  assert.equal(scene.gl.uploads.length, 0);
  assert.throws(() => scene.renderer.render([packet({colors: new Float32Array(1)})], viewport, 1, camera), /colors/);
  assert.equal(scene.gl.depthWrite, true);
});
