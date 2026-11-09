import type {DrawPacket, Rect} from './contracts.js';
import {relativeOffsetVertex, type LineDirectionMode} from './render-line-direction.js';

export interface LinePositionBuffer {
  buffer: WebGLBuffer;
  /** Bytes between adjacent source samples, not between strip vertices. */
  strideBytes: number;
  /** Byte offset of sample 0. One real or duplicated neighbor must precede it. */
  centerOffsetBytes: number;
}
export interface LineOffsetBuffer {
  buffer: WebGLBuffer;
  /** Per sample: left.x, left.y, right.x, right.y in clip-space offsets. */
  bytesPerSample: 16;
  count: number;
  revision: number;
  computedFrom: number;
  computedCount: number;
  reused: boolean;
}
interface Entry {
  buffer: WebGLBuffer;
  capacityBytes: number;
  revision: number;
  count: number;
  scaleKey: string;
}

const vertex = `#version 300 es
precision highp float;
precision highp int;
layout(location=0) in vec2 a_previous;
layout(location=1) in vec2 a_center;
layout(location=2) in vec2 a_next;
uniform vec4 u_domain;
uniform vec2 u_size;
uniform float u_width;
out vec4 v_offsets;
bool finite(vec2 p){return !any(isnan(p))&&!any(isinf(p));}
vec2 project(vec2 p){return (p-u_domain.xy)/u_domain.zw*2.0-1.0;}
void main(){
  vec2 p=project(a_center),before=project(a_previous),after=project(a_next);
  vec2 incoming=(p-before)*u_size,outgoing=(after-p)*u_size;
  float incomingLength=length(incoming),outgoingLength=length(outgoing);
  bool hasPrevious=finite(a_previous)&&incomingLength>0.00001;
  bool hasNext=finite(a_next)&&outgoingLength>0.00001;
  vec2 incomingNormal=hasPrevious?vec2(-incoming.y,incoming.x)/incomingLength:vec2(0.,1.);
  vec2 outgoingNormal=hasNext?vec2(-outgoing.y,outgoing.x)/outgoingLength:incomingNormal;
  if(!hasPrevious)incomingNormal=outgoingNormal;
  vec2 sum=incomingNormal+outgoingNormal;
  vec2 miter=length(sum)>.00001?normalize(sum):incomingNormal;
  miter/=max(.25,dot(miter,incomingNormal));
  vec2 cap=vec2(0.);
  if(!hasPrevious&&hasNext)cap-=outgoing/outgoingLength;
  if(hasPrevious&&!hasNext)cap+=incoming/incomingLength;
  vec2 scale=(u_width+2.)/u_size;
  v_offsets=finite(a_center)?vec4((-miter+cap)*scale,(miter+cap)*scale):vec4(0.);
  gl_Position=vec4(0.,0.,0.,1.);
}`;
const fragment = `#version 300 es
precision highp float;
out vec4 color;
void main(){color=vec4(0.);}
`;

/** Experimental transform-feedback cache. Not enabled by this module itself.
 * The owner supplies a GPU position buffer with both endpoint neighbors. This
 * class never uploads or resamples source positions and never clears a canvas.
 * update() leaves its program active, a null VAO/TF, and RASTERIZER_DISCARD off.
 * Source: https://registry.khronos.org/webgl/specs/latest/2.0/#3.7.15
 *
 * Translation is omitted from the cache key because offsets are mathematically
 * translation invariant. The current projected-subtraction shader can still
 * round differently after panning. Pixel comparisons across pan/epoch/extreme
 * aspect ratio are required before enabling this candidate in the renderer.
 */
export class LineOffsetCache {
  readonly stats = {computations: 0, computedSamples: 0, allocations: 0, allocatedBytes: 0, residentAllocatedBytes: 0, peakResidentAllocatedBytes: 0, cacheHits: 0};
  private program?: WebGLProgram;
  private vao?: WebGLVertexArrayObject;
  private feedback?: WebGLTransformFeedback;
  private uniforms: Record<string, WebGLUniformLocation | null> = {};
  private entries = new Map<number, Entry>();
  private live = new Set<number>();
  private disposed = false;

  constructor(readonly gl: WebGL2RenderingContext, readonly options: {directionMode?: LineDirectionMode} = {}) {this.initialize();}

  beginFrame(): void {
    this.live.clear();
    this.stats.computations = 0; this.stats.computedSamples = 0; this.stats.cacheHits = 0;
  }

  update(packet: DrawPacket, rect: Rect, dpr: number, positions: LinePositionBuffer): LineOffsetBuffer {
    if (this.disposed) throw new Error('Line offset cache is disposed');
    if (this.gl.isContextLost()) throw new Error('Line offset cache context is lost');
    if (packet.mode !== 'line' || packet.dimensions !== 2 || packet.strictlyMonotonicX !== true || packet.colors || packet.dashPattern?.length)
      throw new TypeError('Line offsets require a verified increasing-X solid line');
    if (!Number.isSafeInteger(packet.count) || packet.count < 1) throw new RangeError('Line offset sample count must be positive');
    if (!Number.isSafeInteger(positions.strideBytes) || positions.strideBytes < 8 || positions.strideBytes % 4 !== 0 ||
      !Number.isSafeInteger(positions.centerOffsetBytes) || positions.centerOffsetBytes < positions.strideBytes || positions.centerOffsetBytes % 4 !== 0)
      throw new RangeError('Line position layout must include a preceding neighbor');
    const width = Math.max(1, Math.round(rect.width * dpr)), height = Math.max(1, Math.round(rect.height * dpr));
    const spanX = packet.domain.x.end - packet.domain.x.start, spanY = packet.domain.y.end - packet.domain.y.start;
    const lineWidth = packet.thickness * dpr;
    if (![width, height, spanX, spanY, lineWidth].every(Number.isFinite) || spanX === 0 || spanY === 0 || lineWidth <= 0)
      throw new RangeError('Line offset scale must be finite and nonzero');
    const scaleKey = [width, height, spanX, spanY, lineWidth, positions.strideBytes, positions.centerOffsetBytes].join(':');
    this.live.add(packet.id);
    const gl = this.gl;
    let entry = this.entries.get(packet.id);
    if (!entry) {
      const buffer = gl.createBuffer();
      if (!buffer) throw new Error('Line offset buffer allocation failed');
      entry = {buffer, capacityBytes: 0, revision: -1, count: 0, scaleKey: ''};
      this.entries.set(packet.id, entry);
    }
    const unchanged = entry.scaleKey === scaleKey && entry.revision === packet.revision && entry.count === packet.count;
    if (unchanged) {
      this.stats.cacheHits++;
      return {buffer: entry.buffer, bytesPerSample: 16, count: entry.count, revision: entry.revision, computedFrom: 0, computedCount: 0, reused: true};
    }
    const required = packet.count * 16, grow = entry.capacityBytes < required;
    if (grow) {
      let capacity = Math.max(256, entry.capacityBytes);
      while (capacity < required) capacity *= 2;
      gl.bindBuffer(gl.ARRAY_BUFFER, entry.buffer); gl.bufferData(gl.ARRAY_BUFFER, capacity, gl.DYNAMIC_COPY);
      this.stats.allocations++; this.stats.allocatedBytes += capacity;
      this.stats.residentAllocatedBytes += capacity - entry.capacityBytes;
      this.stats.peakResidentAllocatedBytes = Math.max(this.stats.peakResidentAllocatedBytes, this.stats.residentAllocatedBytes);
      entry.capacityBytes = capacity;
    }
    const incremental = !grow && entry.scaleKey === scaleKey && entry.revision === packet.previousRevision &&
      packet.updateFrom !== undefined && Number.isSafeInteger(packet.updateFrom) && packet.updateFrom >= 0 && packet.updateFrom <= entry.count && packet.count >= entry.count;
    const first = incremental ? Math.max(0, packet.updateFrom! - 1) : 0, count = packet.count - first;
    gl.useProgram(this.program!); gl.bindVertexArray(this.vao!); gl.bindBuffer(gl.ARRAY_BUFFER, positions.buffer);
    for (let location = 0; location < 3; location++) {
      gl.enableVertexAttribArray(location); gl.vertexAttribDivisor(location, 0);
      gl.vertexAttribPointer(location, 2, gl.FLOAT, false, positions.strideBytes, positions.centerOffsetBytes + (location - 1) * positions.strideBytes);
    }
    gl.uniform4f(this.uniforms.domain!, packet.domain.x.start - packet.origin.x, packet.domain.y.start - packet.origin.y, spanX, spanY);
    gl.uniform2f(this.uniforms.size!, width, height); gl.uniform1f(this.uniforms.width!, lineWidth);
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, this.feedback!);
    gl.bindBufferRange(gl.TRANSFORM_FEEDBACK_BUFFER, 0, entry.buffer, first * 16, count * 16);
    gl.enable(gl.RASTERIZER_DISCARD);
    let started = false;
    try {
      gl.beginTransformFeedback(gl.POINTS); started = true;
      gl.drawArrays(gl.POINTS, first, count);
    } finally {
      if (started) gl.endTransformFeedback();
      gl.disable(gl.RASTERIZER_DISCARD);
      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);
      gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null); gl.bindVertexArray(null);
    }
    entry.revision = packet.revision; entry.count = packet.count; entry.scaleKey = scaleKey;
    this.stats.computations++; this.stats.computedSamples += count;
    return {buffer: entry.buffer, bytesPerSample: 16, count: packet.count, revision: packet.revision, computedFrom: first, computedCount: count, reused: false};
  }

  endFrame(): void {
    for (const [id, entry] of this.entries) if (!this.live.has(id)) {this.gl.deleteBuffer(entry.buffer); this.stats.residentAllocatedBytes -= entry.capacityBytes; this.entries.delete(id);}
  }

  restoreContext(): void {
    if (this.disposed) return;
    this.entries.clear(); this.live.clear(); this.stats.residentAllocatedBytes = 0; this.program = undefined; this.vao = undefined; this.feedback = undefined;
    this.initialize();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const entry of this.entries.values()) this.gl.deleteBuffer(entry.buffer);
    this.entries.clear(); this.live.clear(); this.stats.residentAllocatedBytes = 0;
    if (this.feedback) this.gl.deleteTransformFeedback(this.feedback);
    if (this.vao) this.gl.deleteVertexArray(this.vao);
    if (this.program) this.gl.deleteProgram(this.program);
    this.feedback = undefined; this.vao = undefined; this.program = undefined;
  }

  private initialize(): void {
    const gl = this.gl, shaders: WebGLShader[] = [];
    const program = gl.createProgram();
    if (!program) throw new Error('Line offset program allocation failed');
    try {
      for (const [type, source] of [[gl.VERTEX_SHADER, this.options.directionMode === 'relative' ? relativeOffsetVertex : vertex], [gl.FRAGMENT_SHADER, fragment]] as const) {
        const shader = gl.createShader(type);
        if (!shader) throw new Error('Line offset shader allocation failed');
        shaders.push(shader); gl.shaderSource(shader, source); gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'Line offset shader compilation failed');
        gl.attachShader(program, shader);
      }
      gl.transformFeedbackVaryings(program, ['v_offsets'], gl.INTERLEAVED_ATTRIBS);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'Line offset shader linking failed');
      this.vao = gl.createVertexArray() ?? undefined; this.feedback = gl.createTransformFeedback() ?? undefined;
      if (!this.vao || !this.feedback) throw new Error('Line offset transform-feedback allocation failed');
      this.program = program;
      for (const name of ['domain', 'size', 'width']) this.uniforms[name] = gl.getUniformLocation(program, `u_${name}`);
    } catch (error) {
      if (this.vao) gl.deleteVertexArray(this.vao);
      if (this.feedback) gl.deleteTransformFeedback(this.feedback);
      this.vao = undefined; this.feedback = undefined;
      gl.deleteProgram(program); throw error;
    } finally {for (const shader of shaders) gl.deleteShader(shader);}
  }
}
