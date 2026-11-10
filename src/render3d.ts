import type {Rect} from './contracts.js';
import type {WorldCameraFrame} from './world-camera.js';

/** Public silhouette-constrained world-size unit; no vendor implementation constant is assumed. */
export const NORMALIZED_WORLD_STYLE_UNIT = 1e-3;
export function worldStylePixels3D(size:number,depth:number,frame:WorldCameraFrame):number {
  if(!Number.isFinite(size)||size<=0||!Number.isFinite(depth)||depth<=0)return 0;
  return size*NORMALIZED_WORLD_STYLE_UNIT*(frame.projection==='perspective'?frame.focal/depth:frame.viewport.width/frame.radius);
}
export interface DrawPacket3D {
  id: number;
  revision: number;
  /** Normalized XYZ coordinates. Certified constant dimensions use zero placeholders. */
  positions: Float32Array;
  /** Source-certified constant coordinates, normalized with exact Float32 rounding. */
  constantCoordinates?:Readonly<Partial<{x:number;y:number;z:number}>>;
  count: number;
  mode: 'line' | 'points' | 'triangles' | 'boxes';
  color: readonly [number, number, number, number];
  /** Optional absolute per-vertex RGBA colors, in [0, 1]. */
  colors?: Float32Array;
  indices?: Uint32Array;
  indexRevision?: number;
  /** Producer has checked that every position in this revision is finite. */
  allFinite?: boolean;
  normals?: Float32Array;
  lighting?: boolean;
  /** Explicit Simple shading also disables the legacy Sphere highlight. */
  unshaded?: boolean;
  depthTestEnabled?: boolean;
  backfaceCullingMode?: 'disabled' | 'cull-back' | 'cull-front';
  pointSizes?: Float32Array;
  /** World-camera positive line/Sphere sizes; surface/box/pixel paths omit this flag. */
  worldStyleUnits?: boolean;
  pointShape?: 'circle' | 'square' | 'sphere';
  /** Per-instance normalized XYZ dimensions for procedural, instanced cuboids. */
  boxSizes?: Float32Array;
  boxTopColors?: Float32Array;
  /** Corner radius as a fraction of the smallest full box dimension, in [0, .5]. */
  roundness?: number;
  /** Optional partial uploads; coordinates are float-element offsets, not byte offsets. */
  positionUpdateRanges?: readonly {start: number; count: number}[];
  colorUpdateRanges?: readonly {start: number; count: number}[];
  normalUpdateRanges?: readonly {start: number; count: number}[];
  previousRevision?: number;
  thickness: number;
  pointSize: number;
}
export type Packet3D = DrawPacket3D;
export interface Camera3D {worldFrame?:WorldCameraFrame;azimuth: number; elevation: number; zoom: number; boundingBox?:{x:number;y:number;z:number}; }
/** Bounding dimensions describe ratios, so a uniform multiplier has no effect. */
export function cameraVolumeScale(camera:Camera3D):{x:number;y:number;z:number}{
  const box=camera.boundingBox??{x:1,y:1,z:1};
  if(![box.x,box.y,box.z].every(v=>Number.isFinite(v)&&v>0))throw new RangeError('3D bounding box dimensions must be positive and finite');
  const maximum=Math.max(box.x,box.y,box.z);return{x:box.x/maximum,y:box.y/maximum,z:box.z/maximum};
}
export interface PreparedVertices3D {positions: Float32Array; colors?: Float32Array; count: number; }

/** Column-major rotation: first azimuth around Y, then elevation around X. */
export function cameraRotationMatrix(camera: Camera3D): Float32Array {
  if (!Number.isFinite(camera.azimuth) || !Number.isFinite(camera.elevation)) throw new RangeError('3D camera angles must be finite');
  const a = camera.azimuth, e = camera.elevation, ca = Math.cos(a), sa = Math.sin(a), ce = Math.cos(e), se = Math.sin(e);
  return new Float32Array([ca, -se * sa, ce * sa, 0, ce, se, -sa, -se * ca, ce * ca]);
}

export function cameraProjectionScales(camera: Camera3D, rect: Pick<Rect, 'width' | 'height'>): {x: number; y: number} {
  if (!Number.isFinite(camera.zoom) || camera.zoom <= 0) throw new RangeError('3D camera zoom must be positive and finite');
  if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height) || rect.width <= 0 || rect.height <= 0) throw new RangeError('3D viewport dimensions must be positive and finite');
  const scale = Math.min(rect.width, rect.height) * .34 * camera.zoom;
  return {x: 2 * scale / rect.width, y: 2 * scale / rect.height};
}

/** CPU equivalent for picking and tests; drawing uses the same transform on the GPU. */
export function projectNormalized3D(point: {x: number; y: number; z: number}, rect: Rect, camera: Camera3D): {x: number; y: number; depth: number} {
  const rotation = cameraRotationMatrix(camera), scale = cameraProjectionScales(camera, rect);
  const volume=cameraVolumeScale(camera),x=point.x*volume.x,y=point.y*volume.y,z=point.z*volume.z;
  const rx = rotation[0] * x + rotation[3] * y + rotation[6] * z;
  const ry = rotation[1] * x + rotation[4] * y + rotation[7] * z;
  const depth = rotation[2] * x + rotation[5] * y + rotation[8] * z;
  return {x: rect.left + rect.width * (.5 + rx * scale.x / 2), y: rect.top + rect.height * (.5 - ry * scale.y / 2), depth};
}

const finiteVertex = (values: Float32Array, index: number) => Number.isFinite(values[index]) && Number.isFinite(values[index + 1]) && Number.isFinite(values[index + 2]);

/** Remove complete invalid triangles, preserving color alignment and valid input buffers. */
export function prepareTriangles3D(positions: Float32Array, colors?: Float32Array, count = positions.length / 3): PreparedVertices3D {
  if (!Number.isSafeInteger(count) || count < 0 || count * 3 > positions.length || (colors && count * 4 > colors.length)) throw new RangeError('Invalid triangle vertex count');
  const usable = Math.floor(count / 3) * 3;
  let valid = 0;
  for (let i = 0; i < usable; i += 3) if (finiteVertex(positions, i * 3) && finiteVertex(positions, i * 3 + 3) && finiteVertex(positions, i * 3 + 6)) valid += 3;
  if (valid === usable) return {positions: positions.length === usable * 3 ? positions : positions.subarray(0, usable * 3), colors: colors ? colors.length === usable * 4 ? colors : colors.subarray(0, usable * 4) : undefined, count: usable};
  const vertices = new Float32Array(valid * 3), palette = colors ? new Float32Array(valid * 4) : undefined;
  let next = 0;
  for (let i = 0; i < usable; i += 3) {
    const offset = i * 3;
    if (!finiteVertex(positions, offset) || !finiteVertex(positions, offset + 3) || !finiteVertex(positions, offset + 6)) continue;
    vertices.set(positions.subarray(offset, offset + 9), next * 3);
    if (palette && colors) palette.set(colors.subarray(i * 4, i * 4 + 12), next * 4);
    next += 3;
  }
  return {positions: vertices, colors: palette, count: valid};
}

const vertexSource = `#version 300 es
precision highp float;
precision highp int;
layout(location=0) in vec3 a_position;
layout(location=1) in vec3 a_end;
layout(location=2) in vec4 a_color;
layout(location=3) in vec4 a_endColor;
layout(location=4) in float a_size;
layout(location=5) in vec3 a_normal;
layout(location=6) in vec3 a_boxSize;
uniform mat3 u_rotation;
uniform vec4 u_volume;
uniform vec2 u_scale;
uniform vec2 u_viewport;
uniform vec4 u_color;
uniform float u_width;
uniform float u_pointSize;
uniform int u_segment;
uniform int u_vertexColors;
uniform int u_vertexSizes;
uniform int u_box;
uniform int u_boxTopColors;
uniform int u_boxSegments;
uniform float u_roundness;
uniform float u_dpr;
uniform float u_maxPointSize;
uniform int u_constantMask;
uniform vec3 u_constantCoordinates;
out vec4 v_color;
out vec3 v_normal;
flat out int v_valid;
bool finite3(vec3 value) { return !any(isnan(value)) && !any(isinf(value)); }
vec3 project(vec3 value) {
  if((u_constantMask&1)!=0)value.x=u_constantCoordinates.x;if((u_constantMask&2)!=0)value.y=u_constantCoordinates.y;if((u_constantMask&4)!=0)value.z=u_constantCoordinates.z;
  vec3 rotated = u_rotation * (value * u_volume.xyz);
  // A rotated unit cube lies inside +/-sqrt(3); a fixed depth slab avoids zoom clipping.
  return vec3(rotated.xy * u_scale, rotated.z * 0.5);
}
void main() {
  bool valid = finite3(a_position);
  vec3 position = valid ? project(a_position) : vec3(0.0);
  vec4 vertexColor = u_vertexColors != 0 ? a_color : u_color;
  v_normal = u_rotation * (a_normal / u_volume.xyz);
  if (u_box != 0) {
    valid = valid && finite3(a_boxSize) && all(greaterThan(a_boxSize, vec3(0.0)));
    int n = u_boxSegments;
    int triangleCorner = gl_VertexID % 6;
    int cornerU = triangleCorner == 1 || triangleCorner == 2 || triangleCorner == 4 ? 1 : 0;
    int cornerV = triangleCorner == 2 || triangleCorner == 4 || triangleCorner == 5 ? 1 : 0;
    int cell = gl_VertexID / 6;
    int face = cell / (n * n);
    int col = cell % n, row = (cell / n) % n;
    float u = float(col + cornerU) / float(n) * 2.0 - 1.0;
    float v = float(row + cornerV) / float(n) * 2.0 - 1.0;
    int axis = face / 2;
    float side = face % 2 == 0 ? -1.0 : 1.0;
    vec3 cube = axis == 0 ? vec3(side, u, v) : axis == 1 ? vec3(u, side, v) : vec3(u, v, side);
    vec3 halfSize = abs(a_boxSize) * 0.5;
    float radius = u_roundness * min(a_boxSize.x, min(a_boxSize.y, a_boxSize.z));
    vec3 local = cube * halfSize;
    vec3 normal = axis == 0 ? vec3(side, 0, 0) : axis == 1 ? vec3(0, side, 0) : vec3(0, 0, side);
    if (radius > 0.0) {
      vec3 core = max(vec3(0.0), halfSize - vec3(radius));
      vec3 closest = clamp(local, -core, core);
      vec3 delta = local - closest;
      normal = normalize(delta);
      local = closest + normal * radius;
    }
    position = valid ? project(a_position + local) : vec3(0.0);
    v_normal = u_rotation * (normal / u_volume.xyz);
    if (u_boxTopColors != 0) vertexColor = mix(vertexColor, a_endColor, clamp(local.y / max(0.000001, a_boxSize.y) + 0.5, 0.0, 1.0));
  } else if (u_segment != 0) {
    valid = valid && finite3(a_end);
    vec3 endingPosition = valid ? project(a_end) : position;
    vec2 delta = (endingPosition.xy - position.xy) * u_viewport;
    float lengthPixels = length(delta);
    valid = valid && lengthPixels > 0.00001;
    vec2 normal = lengthPixels > 0.00001 ? vec2(-delta.y, delta.x) / lengthPixels : vec2(0.0, 1.0);
    int corner = gl_VertexID;
    bool ending = corner == 1 || corner == 4 || corner == 5;
    float side = corner == 0 || corner == 1 || corner == 4 ? -1.0 : 1.0;
    position = ending ? endingPosition : position;
    position.xy += normal * side * u_width / u_viewport;
    if (u_vertexColors != 0 && ending) vertexColor = a_endColor;
  }
  v_valid = valid ? 1 : 0;
  v_color = vertexColor;
  gl_Position = valid ? vec4(position, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
  float size = u_vertexSizes != 0 ? a_size * u_dpr : u_pointSize;
  if (u_vertexSizes != 0 && (isnan(size) || isinf(size) || size <= 0.0)) { valid = false; v_valid = 0; }
  gl_PointSize = clamp(size, 1.0, u_maxPointSize);
}`;

const worldVertexSource = `#version 300 es
precision highp float;
precision highp int;
layout(location=0) in vec3 a_position;
layout(location=1) in vec3 a_end;
layout(location=2) in vec4 a_color;
layout(location=3) in vec4 a_endColor;
layout(location=4) in float a_size;
layout(location=5) in vec3 a_normal;
layout(location=6) in vec3 a_boxSize;
uniform mat4 u_worldMatrix;
uniform mat3 u_rotation;
uniform vec4 u_volume;
uniform vec2 u_scale;
uniform vec2 u_viewport;
uniform vec4 u_color;
uniform float u_width;
uniform float u_worldStyleScale;
uniform float u_pointSize;
uniform int u_segment;
uniform int u_vertexColors;
uniform int u_vertexSizes;
uniform int u_box;
uniform int u_boxTopColors;
uniform int u_boxSegments;
uniform float u_roundness;
uniform float u_dpr;
uniform float u_maxPointSize;
uniform int u_constantMask;
uniform vec3 u_constantCoordinates;
out vec4 v_color;
out vec3 v_normal;
flat out int v_valid;
bool finite3(vec3 value) { return !any(isnan(value)) && !any(isinf(value)); }
vec4 project(vec3 value) {if((u_constantMask&1)!=0)value.x=u_constantCoordinates.x;if((u_constantMask&2)!=0)value.y=u_constantCoordinates.y;if((u_constantMask&4)!=0)value.z=u_constantCoordinates.z;return u_worldMatrix * vec4(value,1.0);}
bool clipDepth(vec4 first,vec4 last,inout float low,inout float high){
  vec2 a=vec2(first.z+first.w,first.w-first.z),b=vec2(last.z+last.w,last.w-last.z);
  for(int i=0;i<2;i++){if(a[i]<0.0&&b[i]<0.0)return false;if(a[i]<0.0)low=max(low,a[i]/(a[i]-b[i]));else if(b[i]<0.0)high=min(high,a[i]/(a[i]-b[i]));}
  return low<=high;
}
void main() {
  bool valid = finite3(a_position);
  vec4 position = valid ? project(a_position) : vec4(0.0,0.0,0.0,1.0);
  vec4 vertexColor = u_vertexColors != 0 ? a_color : u_color;
  v_normal = u_rotation * (a_normal / u_volume.xyz);
  if (u_box != 0) {
    valid = valid && finite3(a_boxSize) && all(greaterThan(a_boxSize, vec3(0.0)));
    int n = u_boxSegments;
    int triangleCorner = gl_VertexID % 6;
    int cornerU = triangleCorner == 1 || triangleCorner == 2 || triangleCorner == 4 ? 1 : 0;
    int cornerV = triangleCorner == 2 || triangleCorner == 4 || triangleCorner == 5 ? 1 : 0;
    int cell = gl_VertexID / 6;
    int face = cell / (n * n);
    int col = cell % n, row = (cell / n) % n;
    float u = float(col + cornerU) / float(n) * 2.0 - 1.0;
    float v = float(row + cornerV) / float(n) * 2.0 - 1.0;
    int axis = face / 2;
    float side = face % 2 == 0 ? -1.0 : 1.0;
    vec3 cube = axis == 0 ? vec3(side, u, v) : axis == 1 ? vec3(u, side, v) : vec3(u, v, side);
    vec3 halfSize = abs(a_boxSize) * 0.5;
    float radius = u_roundness * min(a_boxSize.x, min(a_boxSize.y, a_boxSize.z));
    vec3 local = cube * halfSize;
    vec3 normal = axis == 0 ? vec3(side, 0, 0) : axis == 1 ? vec3(0, side, 0) : vec3(0, 0, side);
    if (radius > 0.0) {
      vec3 core = max(vec3(0.0), halfSize - vec3(radius));
      vec3 closest = clamp(local, -core, core);
      vec3 delta = local - closest;
      normal = normalize(delta);
      local = closest + normal * radius;
    }
    position = valid ? project(a_position + local) : vec4(0.0,0.0,0.0,1.0);
    v_normal = u_rotation * (normal / u_volume.xyz);
    if (u_boxTopColors != 0) vertexColor = mix(vertexColor, a_endColor, clamp(local.y / max(0.000001, a_boxSize.y) + 0.5, 0.0, 1.0));
  } else if (u_segment != 0) {
    valid = valid && finite3(a_end);
    vec4 endingPosition = valid ? project(a_end) : position;
    float firstT=0.0,lastT=1.0;valid=valid&&clipDepth(position,endingPosition,firstT,lastT);
    vec4 originalFirst=position,originalLast=endingPosition;
    position=mix(originalFirst,originalLast,firstT);endingPosition=mix(originalFirst,originalLast,lastT);
    valid=valid&&position.w>0.0&&endingPosition.w>0.0;
    vec2 delta = (endingPosition.xy / max(endingPosition.w,0.0000001) - position.xy / max(position.w,0.0000001)) * u_viewport;
    float lengthPixels = length(delta);
    valid = valid && lengthPixels > 0.00001;
    vec2 normal = lengthPixels > 0.00001 ? vec2(-delta.y, delta.x) / lengthPixels : vec2(0.0, 1.0);
    int corner = gl_VertexID;
    bool ending = corner == 1 || corner == 4 || corner == 5;
    float side = corner == 0 || corner == 1 || corner == 4 ? -1.0 : 1.0;
    position = ending ? endingPosition : position;
    float width = u_worldStyleScale > 0.0 ? u_width * u_worldStyleScale / max(position.w,0.0000001) : u_width;
    position.xy += normal * side * width / u_viewport * position.w;
    if (u_vertexColors != 0) vertexColor = mix(a_color,a_endColor,ending?lastT:firstT);
  }
  v_valid = valid ? 1 : 0;
  v_color = vertexColor;
  gl_Position = valid ? position : vec4(2.0, 2.0, 2.0, 1.0);
  float size = u_vertexSizes != 0 ? a_size * u_dpr : u_pointSize;
  if(u_worldStyleScale > 0.0) size *= u_worldStyleScale / max(position.w,0.0000001);
  if (u_vertexSizes != 0 && (isnan(size) || isinf(size) || size <= 0.0)) { valid = false; v_valid = 0; }
  gl_PointSize = clamp(size, 1.0, u_maxPointSize);
}`;

const fragmentSource = `#version 300 es
precision highp float;
precision highp int;
in vec4 v_color;
in vec3 v_normal;
flat in int v_valid;
uniform int u_points;
uniform int u_pointShape;
uniform int u_lighting;
uniform int u_unshaded;
out vec4 color;
void main() {
  if (v_valid == 0) discard;
  float brightness = 1.0;
  if (u_points != 0) {
    vec2 offset = gl_PointCoord - vec2(0.5);
    if (u_pointShape != 1 && dot(offset, offset) > 0.25) discard;
    if (u_pointShape == 2 && u_unshaded == 0) {
      vec3 normal = vec3(offset.x * 2.0, -offset.y * 2.0, sqrt(max(0.0, 1.0 - 4.0 * dot(offset, offset))));
      brightness = 0.25 + 0.75 * max(0.0, dot(normal, normalize(vec3(-0.5, 0.7, 1.0))));
    }
  } else if (u_lighting != 0 && u_unshaded == 0) {
    float magnitude = length(v_normal);
    if (magnitude > 0.00001) brightness = 0.3 + 0.7 * abs(dot(v_normal / magnitude, normalize(vec3(-0.5, 0.8, 1.0))));
  }
  if (any(isnan(v_color)) || any(isinf(v_color)) || v_color.a <= 0.0) discard;
  color = vec4(v_color.rgb * brightness, v_color.a);
}`;

interface BufferEntry {
  position: WebGLBuffer;
  color?: WebGLBuffer;
  plain: WebGLVertexArrayObject;
  segments: WebGLVertexArrayObject;
  revision: number;
  sourceCount: number;
  sourceTriangles: boolean;
  count: number;
  positionBytes: number;
  colorBytes: number;
  hasColors: boolean;
  hasTransparency: boolean;
  mode: DrawPacket3D['mode'];
  indices?: WebGLBuffer;
  indexSource?: Uint32Array;
  sourceIndices?: Uint32Array;
  indexRevision: number;
  indexCount: number;
  indexBytes: number;
  attributes: Map<'normal' | 'size' | 'boxSize' | 'topColor', {buffer: WebGLBuffer; bytes: number}>;
}

/** GPU 3D renderer with an explicit camera-uniform/data-upload separation. */
export class DataRenderer3D {
  readonly backend = 'webgl2';
  readonly stats = {frames: 0, uploads: 0, bufferUploads: 0, uploadedBytes: 0, drawCalls: 0, vertices: 0, submittedVertices: 0, renderTimeMs: 0, cachedBuffers: 0, cacheBytes: 0, contextRestores: 0};
  private program?: WebGLProgram;
  private legacyProgram?:{program:WebGLProgram;uniforms:Record<string,WebGLUniformLocation|null>};
  private worldProgram?:{program:WebGLProgram;uniforms:Record<string,WebGLUniformLocation|null>};
  private readonly buffers = new Map<number, BufferEntry>();
  private uniforms: Record<string, WebGLUniformLocation | null> = {};
  private worldStyleScale = 0;
  private maximumPointSize = 64;
  private lost = false;
  private disposed = false;

  constructor(readonly gl: WebGL2RenderingContext, readonly canvas: HTMLCanvasElement) {
    this.initialize();
    canvas.addEventListener('webglcontextlost', this.contextLost);
    canvas.addEventListener('webglcontextrestored', this.contextRestored);
  }

  private contextLost = (event: Event): void => { event.preventDefault(); this.lost = true; };
  private contextRestored = (): void => {
    if (this.disposed) return;
    this.buffers.clear(); this.program = undefined;this.legacyProgram=undefined;this.worldProgram=undefined; this.stats.cachedBuffers = 0; this.stats.cacheBytes = 0;
    this.initialize(); this.lost = false; this.stats.contextRestores++;
    this.canvas.dispatchEvent(new Event('crychartcontextrestored'));
  };

  private initialize(world=false): void {
    const gl = this.gl;
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type); if (!shader) throw new Error('Unable to allocate a 3D shader');
      gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { const message = gl.getShaderInfoLog(shader); gl.deleteShader(shader); throw new Error(`3D shader compilation failed: ${message ?? 'unknown error'}`); }
      return shader;
    };
    let vertex: WebGLShader | undefined, fragment: WebGLShader | undefined, program: WebGLProgram | undefined;
    try {
      vertex = compile(gl.VERTEX_SHADER, world?worldVertexSource:vertexSource); fragment = compile(gl.FRAGMENT_SHADER, fragmentSource);
      program = gl.createProgram() ?? undefined; if (!program) throw new Error('Unable to allocate a 3D program');
      gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`3D shader link failed: ${gl.getProgramInfoLog(program) ?? 'unknown error'}`);
      this.program = program;
      this.uniforms = Object.fromEntries(['worldStyleScale', 'worldMatrix', 'rotation', 'volume', 'scale', 'viewport', 'color', 'width', 'pointSize', 'segment', 'vertexColors', 'points', 'vertexSizes', 'box', 'boxTopColors', 'boxSegments', 'roundness', 'dpr', 'maxPointSize', 'pointShape', 'lighting', 'unshaded', 'constantMask', 'constantCoordinates'].map(name => [name, gl.getUniformLocation(program!, `u_${name}`)]));
      if(world)this.worldProgram={program,uniforms:this.uniforms};else this.legacyProgram={program,uniforms:this.uniforms};
      const range = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE) as Float32Array | number[] | null;
      this.maximumPointSize = range?.[1] ?? 64;
    } catch (error) { if (program) gl.deleteProgram(program); throw error; }
    finally { if (vertex) gl.deleteShader(vertex); if (fragment) gl.deleteShader(fragment); }
  }

  render(packets: readonly DrawPacket3D[], rect: Rect, dpr: number, camera: Camera3D): void {
    if (this.disposed) throw new Error('DataRenderer3D is disposed');
    const started = performance.now(); this.stats.frames++; this.stats.drawCalls = 0; this.stats.vertices = 0; this.stats.submittedVertices = 0;
    if (this.lost || this.gl.isContextLost()) { this.stats.renderTimeMs = performance.now() - started; return; }
    if (!Number.isFinite(dpr) || dpr <= 0 || !Number.isFinite(rect.left) || !Number.isFinite(rect.top)) throw new RangeError('3D viewport coordinates and DPR must be finite');
    const frame=camera.worldFrame;
    this.worldStyleScale=frame?NORMALIZED_WORLD_STYLE_UNIT*(frame.projection==='perspective'?frame.focal:frame.viewport.width/frame.radius):0;
    if(frame&&!this.worldProgram)this.initialize(true);
    const selected=frame?this.worldProgram!:this.legacyProgram!;this.program=selected.program;this.uniforms=selected.uniforms;
    const rotation = frame?.rotation??cameraRotationMatrix(camera), scale = cameraProjectionScales(camera, rect), volume=frame?.scale??cameraVolumeScale(camera), gl = this.gl;
    const x = Math.round(rect.left * dpr), y = Math.round(this.canvas.height - (rect.top + rect.height) * dpr), width = Math.max(1, Math.round(rect.width * dpr)), height = Math.max(1, Math.round(rect.height * dpr));
    gl.bindVertexArray(null); gl.disable(gl.SCISSOR_TEST); gl.colorMask(true, true, true, true); gl.depthMask(true);
    gl.clearColor(0, 0, 0, 0); gl.clearDepth(1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.viewport(x, y, width, height);
    if(frame){const clip=frame.clip,left=Math.max(0,Math.ceil(clip.left*dpr)),bottom=Math.max(0,Math.ceil(this.canvas.height-(clip.top+clip.height)*dpr)),right=Math.min(this.canvas.width,Math.floor((clip.left+clip.width)*dpr)),top=Math.min(this.canvas.height,Math.floor(this.canvas.height-clip.top*dpr));gl.scissor(left,bottom,Math.max(0,right-left),Math.max(0,top-bottom));}
    else gl.scissor(x, y, width, height);gl.enable(gl.SCISSOR_TEST);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.program!);if(frame)gl.uniformMatrix4fv(this.uniforms.worldMatrix,false,frame.matrix); gl.uniformMatrix3fv(this.uniforms.rotation, false, rotation);
    gl.uniform4f(this.uniforms.volume,volume.x,volume.y,volume.z,1);
    gl.uniform2f(this.uniforms.scale, scale.x, scale.y); gl.uniform2f(this.uniforms.viewport, width, height);
    const live = new Set<number>();
    const opaque: Array<{packet: DrawPacket3D; entry: BufferEntry}> = [], transparent: Array<{packet: DrawPacket3D; entry: BufferEntry}> = [];
    try {
      for (const packet of packets) {
        this.validatePacket(packet);
        if (!packet.count || (packet.mode === 'line' && (packet.count < 2 || packet.thickness <= 0)) || (!packet.colors && packet.color[3] <= 0)) continue;
        live.add(packet.id);
        const entry = this.upload(packet);
        if (!entry.count) continue;
        const item = {packet, entry};
        (entry.hasTransparency || (!entry.hasColors && packet.color[3] < 1) ? transparent : opaque).push(item);
      }
      for (const item of opaque) this.draw(item.packet, item.entry, dpr);
      // Translucent vertices still test against opaque depth, without obscuring later layers.
      // Exact ordering of intersecting translucent surfaces is intentionally not inferred here.
      gl.depthMask(false);
      for (const item of transparent) this.draw(item.packet, item.entry, dpr);
      for (const [id, entry] of this.buffers) if (!live.has(id)) { this.deleteEntry(entry); this.buffers.delete(id); }
    } finally {
      gl.bindVertexArray(null); gl.depthMask(true); gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.disable(gl.SCISSOR_TEST);
      this.stats.cachedBuffers = this.buffers.size;
      this.stats.cacheBytes = [...this.buffers.values()].reduce((sum, entry) => sum + entry.positionBytes + entry.colorBytes + entry.indexBytes + [...entry.attributes.values()].reduce((n, attribute) => n + attribute.bytes, 0), 0);
      this.stats.renderTimeMs = performance.now() - started;
    }
  }

  private validatePacket(packet: DrawPacket3D): void {
    if(packet.constantCoordinates!==undefined&&(!['line','points'].includes(packet.mode)||Object.entries(packet.constantCoordinates).some(([key,value])=>!['x','y','z'].includes(key)||typeof value!=='number'||!Number.isFinite(Math.fround(value)))))throw new RangeError('3D constant coordinates require finite Float32 XYZ values on lines or points');
    if (!Number.isFinite(packet.id) || !Number.isFinite(packet.revision)) throw new RangeError('3D packet identity and revision must be finite');
    if (!(packet.positions instanceof Float32Array) || !Number.isSafeInteger(packet.count) || packet.count < 0 || packet.count * 3 > packet.positions.length) throw new RangeError('3D packet positions do not match the vertex count');
    if (packet.colors && (!(packet.colors instanceof Float32Array) || packet.count * 4 > packet.colors.length)) throw new RangeError('3D packet colors do not match the vertex count');
    if (!['points', 'line', 'triangles', 'boxes'].includes(packet.mode)) throw new TypeError('Unsupported 3D primitive mode');
    for (const [name, values, width] of [['normals', packet.normals, 3], ['pointSizes', packet.pointSizes, 1], ['boxSizes', packet.boxSizes, 3], ['boxTopColors', packet.boxTopColors, 4]] as const) if (values && (!(values instanceof Float32Array) || packet.count * width > values.length)) throw new RangeError(`3D ${name} do not match the vertex count`);
    if (packet.mode === 'boxes' && !packet.boxSizes) throw new RangeError('3D boxes require per-instance dimensions');
    if (packet.indices && (packet.mode !== 'triangles' || !(packet.indices instanceof Uint32Array) || packet.indices.length % 3 !== 0)) throw new RangeError('3D triangle indices must be complete Uint32 triangles');
    if (packet.roundness !== undefined && (!Number.isFinite(packet.roundness) || packet.roundness < 0 || packet.roundness > .5)) throw new RangeError('Box roundness must be in [0, .5]');
    if (packet.color.length !== 4 || !packet.color.every(Number.isFinite)) throw new RangeError('3D packet color requires four finite channels');
  }

  private upload(packet: DrawPacket3D): BufferEntry {
    const gl = this.gl; let entry = this.buffers.get(packet.id);
    if (!entry) {
      const position = gl.createBuffer(), plain = gl.createVertexArray(), segments = gl.createVertexArray();
      if (!position || !plain || !segments) { if (position) gl.deleteBuffer(position); if (plain) gl.deleteVertexArray(plain); if (segments) gl.deleteVertexArray(segments); throw new Error('Unable to allocate 3D geometry buffers'); }
      entry = {position, plain, segments, revision: NaN, sourceCount: 0, sourceTriangles: false, count: 0, positionBytes: 0, colorBytes: 0, hasColors: false, hasTransparency: false, mode: packet.mode, indexCount: 0, indexBytes: 0, indexRevision: NaN, attributes: new Map()};
      this.buffers.set(packet.id, entry);
    }
    const triangles = packet.mode === 'triangles';
    if (entry.revision === packet.revision && entry.sourceCount === packet.count && entry.sourceTriangles === triangles && (entry.mode === 'boxes') === (packet.mode === 'boxes') && entry.hasColors === Boolean(packet.colors) && entry.sourceIndices === packet.indices && entry.attributes.has('normal') === Boolean(packet.normals) && entry.attributes.has('size') === Boolean(packet.pointSizes) && entry.attributes.has('boxSize') === Boolean(packet.boxSizes) && entry.attributes.has('topColor') === Boolean(packet.boxTopColors)) return entry;
    if (packet.indices && (entry.sourceIndices !== packet.indices || entry.indexRevision !== (packet.indexRevision ?? packet.revision))) for (const index of packet.indices) if (index >= packet.count) throw new RangeError('3D triangle index is outside the vertex buffer');
    const prepared = triangles && !packet.indices ? prepareTriangles3D(packet.positions, packet.colors, packet.count) : {positions: packet.positions.length === packet.count * 3 ? packet.positions : packet.positions.subarray(0, packet.count * 3), colors: packet.colors ? packet.colors.length === packet.count * 4 ? packet.colors : packet.colors.subarray(0, packet.count * 4) : undefined, count: packet.count};
    const partial = entry.revision === packet.previousRevision && entry.count === prepared.count;
    const uploadFloats = (values: Float32Array, previousBytes: number, ranges?: readonly {start: number; count: number}[]): number => {
      if (previousBytes === values.byteLength && previousBytes !== 0) {
        if (partial && ranges) {
          let bytes = 0; for (const range of ranges) {if (!Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.count) || range.start < 0 || range.count < 0 || range.start + range.count > values.length) throw new RangeError('3D partial update range is outside its attribute'); if (!range.count) continue; const part = values.subarray(range.start, range.start + range.count); gl.bufferSubData(gl.ARRAY_BUFFER, range.start * 4, part); bytes += part.byteLength; this.stats.bufferUploads++;} this.stats.uploadedBytes += bytes;
        } else {gl.bufferSubData(gl.ARRAY_BUFFER, 0, values); this.stats.uploadedBytes += values.byteLength; this.stats.bufferUploads++;}
      } else {gl.bufferData(gl.ARRAY_BUFFER, values, gl.DYNAMIC_DRAW); this.stats.uploadedBytes += values.byteLength; this.stats.bufferUploads++;}
      return values.byteLength;
    };
    gl.bindBuffer(gl.ARRAY_BUFFER, entry.position);
    entry.positionBytes = uploadFloats(prepared.positions, entry.positionBytes, packet.positionUpdateRanges);
    entry.hasColors = Boolean(prepared.colors); entry.hasTransparency = false;
    if (prepared.colors) {
      if (!entry.color) { entry.color = gl.createBuffer() ?? undefined; if (!entry.color) throw new Error('Unable to allocate 3D vertex colors'); }
      gl.bindBuffer(gl.ARRAY_BUFFER, entry.color);
      entry.colorBytes = uploadFloats(prepared.colors, entry.colorBytes, packet.colorUpdateRanges);
      for (let i = 3; i < prepared.colors.length; i += 4) if (prepared.colors[i] < 1) { entry.hasTransparency = true; break; }
    } else if (entry.color) { gl.deleteBuffer(entry.color); entry.color = undefined; entry.colorBytes = 0; }
    for (const [name, source, width, ranges] of [['normal', packet.normals, 3, packet.normalUpdateRanges], ['size', packet.pointSizes, 1, undefined], ['boxSize', packet.boxSizes, 3, undefined], ['topColor', packet.boxTopColors, 4, undefined]] as const) {
      const attribute = entry.attributes.get(name);
      if (!source) {if (attribute) {gl.deleteBuffer(attribute.buffer); entry.attributes.delete(name);} continue;}
      const buffer = attribute?.buffer ?? gl.createBuffer(); if (!buffer) throw new Error(`Unable to allocate 3D ${name} attribute`);
      let values = source.length === prepared.count * width ? source : source.subarray(0, prepared.count * width);
      if (triangles && !packet.indices && prepared.count < Math.floor(packet.count / 3) * 3) {values = new Float32Array(prepared.count * width); let next = 0; for (let i = 0; i + 2 < packet.count; i += 3) if (finiteVertex(packet.positions, i * 3) && finiteVertex(packet.positions, i * 3 + 3) && finiteVertex(packet.positions, i * 3 + 6)) {values.set(source.subarray(i * width, (i + 3) * width), next); next += 3 * width;}}
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer); const bytes = uploadFloats(values, attribute?.bytes ?? 0, ranges); entry.attributes.set(name, {buffer, bytes});
      if (name === 'topColor') for (let i = 3; i < values.length; i += 4) if (values[i] < 1) {entry.hasTransparency = true; break;}
    }
    if (packet.indices) {
      let valid = packet.allFinite ? packet.indices.length : 0; if (!packet.allFinite) for (let i = 0; i < packet.indices.length; i += 3) if (finiteVertex(packet.positions, packet.indices[i] * 3) && finiteVertex(packet.positions, packet.indices[i + 1] * 3) && finiteVertex(packet.positions, packet.indices[i + 2] * 3)) valid += 3;
      let indices = packet.indices;
      if (valid !== indices.length) {indices = new Uint32Array(valid); let next = 0; for (let i = 0; i < packet.indices.length; i += 3) if (finiteVertex(packet.positions, packet.indices[i] * 3) && finiteVertex(packet.positions, packet.indices[i + 1] * 3) && finiteVertex(packet.positions, packet.indices[i + 2] * 3)) {indices.set(packet.indices.subarray(i, i + 3), next); next += 3;}}
      if (!entry.indices) {entry.indices = gl.createBuffer() ?? undefined; if (!entry.indices) throw new Error('Unable to allocate 3D triangle indices');}
      // Index binding belongs to a VAO. Leave the current VAO before modifying it.
      gl.bindVertexArray(null); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, entry.indices);
      if (entry.indexSource !== indices || valid !== entry.indexCount || entry.indexRevision !== (packet.indexRevision ?? packet.revision)) {gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.DYNAMIC_DRAW); this.stats.bufferUploads++; this.stats.uploadedBytes += indices.byteLength;}
      entry.indexCount = valid; entry.indexBytes = indices.byteLength; entry.indexSource = indices; entry.sourceIndices = packet.indices; entry.indexRevision = packet.indexRevision ?? packet.revision;
    } else if (entry.indices) {gl.deleteBuffer(entry.indices); entry.indices = undefined; entry.indexSource = undefined; entry.sourceIndices = undefined; entry.indexCount = 0; entry.indexBytes = 0;}
    entry.revision = packet.revision; entry.sourceCount = packet.count; entry.sourceTriangles = triangles; entry.count = prepared.count;
    entry.mode = packet.mode;
    this.configureArray(entry, false); this.configureArray(entry, true); this.stats.uploads++;
    return entry;
  }

  private configureArray(entry: BufferEntry, segments: boolean): void {
    const gl = this.gl, divisor = segments || entry.mode === 'boxes' ? 1 : 0;
    gl.bindVertexArray(segments ? entry.segments : entry.plain); gl.bindBuffer(gl.ARRAY_BUFFER, entry.position);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0); gl.vertexAttribDivisor(0, divisor);
    if (segments) { gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 12, 12); gl.vertexAttribDivisor(1, 1); }
    else { gl.disableVertexAttribArray(1); gl.vertexAttribDivisor(1, 0); }
    if (entry.hasColors && entry.color) {
      gl.bindBuffer(gl.ARRAY_BUFFER, entry.color); gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 16, 0); gl.vertexAttribDivisor(2, divisor);
      if (segments) { gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 4, gl.FLOAT, false, 16, 16); gl.vertexAttribDivisor(3, 1); }
      else { gl.disableVertexAttribArray(3); gl.vertexAttribDivisor(3, 0); }
    } else { gl.disableVertexAttribArray(2); gl.disableVertexAttribArray(3); gl.vertexAttribDivisor(2, 0); gl.vertexAttribDivisor(3, 0); }
    for (const [name, index, width] of [['size', 4, 1], ['normal', 5, 3], ['boxSize', 6, 3], ['topColor', 3, 4]] as const) {
      const attribute = entry.attributes.get(name);
      if (name === 'topColor' && segments) continue;
      if (attribute && !segments) {gl.bindBuffer(gl.ARRAY_BUFFER, attribute.buffer); gl.enableVertexAttribArray(index); gl.vertexAttribPointer(index, width, gl.FLOAT, false, width * 4, 0); gl.vertexAttribDivisor(index, divisor);}
      else if (name !== 'topColor' || !segments) {gl.disableVertexAttribArray(index); gl.vertexAttribDivisor(index, 0);}
    }
    if (!segments) gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, entry.indices ?? null);
  }

  private draw(packet: DrawPacket3D, entry: BufferEntry, dpr: number): void {
    const gl = this.gl, segment = packet.mode === 'line';
    if (packet.depthTestEnabled === false) gl.disable(gl.DEPTH_TEST); else gl.enable(gl.DEPTH_TEST);
    if (packet.backfaceCullingMode === 'cull-back' || packet.backfaceCullingMode === 'cull-front') {
      gl.enable(gl.CULL_FACE); gl.cullFace(packet.backfaceCullingMode === 'cull-back' ? gl.BACK : gl.FRONT);
    } else gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(segment ? entry.segments : entry.plain);
    gl.uniform4f(this.uniforms.color, packet.color[0], packet.color[1], packet.color[2], packet.color[3]);
    const constant=packet.constantCoordinates;gl.uniform1i(this.uniforms.constantMask,(constant?.x===undefined?0:1)|(constant?.y===undefined?0:2)|(constant?.z===undefined?0:4));gl.uniform3f(this.uniforms.constantCoordinates,constant?.x??0,constant?.y??0,constant?.z??0);
    gl.uniform1i(this.uniforms.vertexColors, entry.hasColors ? 1 : 0); gl.uniform1i(this.uniforms.segment, segment ? 1 : 0); gl.uniform1i(this.uniforms.points, packet.mode === 'points' ? 1 : 0);
    const worldStyle=packet.worldStyleUnits===true&&this.worldStyleScale>0;
    gl.uniform1f(this.uniforms.worldStyleScale,worldStyle?this.worldStyleScale:0);
    gl.uniform1f(this.uniforms.width, Number.isFinite(packet.thickness) ? (worldStyle?Math.max(0,packet.thickness*dpr):Math.max(.5,packet.thickness*dpr)) : dpr);
    gl.uniform1f(this.uniforms.pointSize, Number.isFinite(packet.pointSize) ? (worldStyle?Math.max(0,packet.pointSize*dpr):Math.max(1,Math.min(this.maximumPointSize,packet.pointSize*dpr))) : dpr);
    gl.uniform1i(this.uniforms.vertexSizes, entry.attributes.has('size') ? 1 : 0); gl.uniform1f(this.uniforms.dpr, dpr); gl.uniform1f(this.uniforms.maxPointSize, this.maximumPointSize);
    gl.uniform1i(this.uniforms.pointShape, packet.pointShape === 'square' ? 1 : packet.pointShape === 'sphere' ? 2 : 0);
    gl.uniform1i(this.uniforms.lighting, packet.lighting ? 1 : 0); gl.uniform1i(this.uniforms.unshaded, packet.unshaded ? 1 : 0); gl.uniform1i(this.uniforms.box, packet.mode === 'boxes' ? 1 : 0); gl.uniform1i(this.uniforms.boxTopColors, entry.attributes.has('topColor') ? 1 : 0);
    const boxSegments = packet.roundness ? 8 : 1; gl.uniform1i(this.uniforms.boxSegments, boxSegments); gl.uniform1f(this.uniforms.roundness, packet.roundness ?? 0);
    if (segment) { if (entry.count < 2) return; gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, entry.count - 1); this.stats.submittedVertices += (entry.count - 1) * 6; }
    else if (packet.mode === 'boxes') {const vertices = 36 * boxSegments * boxSegments; gl.drawArraysInstanced(gl.TRIANGLES, 0, vertices, entry.count); this.stats.submittedVertices += vertices * entry.count;}
    else if (entry.indices) {if (!entry.indexCount) return; gl.drawElements(gl.TRIANGLES, entry.indexCount, gl.UNSIGNED_INT, 0); this.stats.submittedVertices += entry.indexCount;}
    else { gl.drawArrays(packet.mode === 'points' ? gl.POINTS : gl.TRIANGLES, 0, entry.count); this.stats.submittedVertices += entry.count; }
    this.stats.drawCalls++; this.stats.vertices += entry.count;
  }

  private deleteEntry(entry: BufferEntry): void { const gl = this.gl; gl.deleteBuffer(entry.position); if (entry.color) gl.deleteBuffer(entry.color); if (entry.indices) gl.deleteBuffer(entry.indices); entry.attributes.forEach(attribute => gl.deleteBuffer(attribute.buffer)); gl.deleteVertexArray(entry.plain); gl.deleteVertexArray(entry.segments); }

  dispose(): void {
    if (this.disposed) return; this.disposed = true;
    for (const entry of this.buffers.values()) this.deleteEntry(entry);
    this.buffers.clear();for(const program of new Set([this.legacyProgram?.program,this.worldProgram?.program]))if(program)this.gl.deleteProgram(program);this.program=undefined;this.legacyProgram=undefined;this.worldProgram=undefined;
    this.stats.cachedBuffers = 0; this.stats.cacheBytes = 0;
    this.canvas.removeEventListener('webglcontextlost', this.contextLost); this.canvas.removeEventListener('webglcontextrestored', this.contextRestored);
  }
}
