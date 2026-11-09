import type {DrawPacket, Rect} from './contracts.js';
import {visibleSampleRange} from './viewport.js';
import {LineOffsetCache} from './render-line-offsets.js';
import {relativeLineVertex, relativeCachedLineVertex, type LineDirectionMode} from './render-line-direction.js';
import {LineCoverageRenderer, linePositionUploadRanges} from './render-line-coverage.js';
import {containedRasterClip, requireRasterTarget, type GpuClipPolicy, type RasterTarget} from './raster-clip.js';

export interface LineStripRange {first: number; count: number;}
export interface LineStripStats {
  uploads: number;
  uploadedBytes: number;
  drawCalls: number;
  vertices: number;
  submittedSamples: number;
}
interface StripBuffer {
  buffer: WebGLBuffer;
  revision: number;
  count: number;
  storage: Float32Array;
}

// Each source sample supplies the left and right edge once. Flat interpolation
// uses the strip's last provoking vertex: both triangles belonging to a segment
// therefore receive that segment's end sample and its real predecessor.
const vertex = `#version 300 es
precision highp float;
precision highp int;
layout(location=0) in vec2 a_previous;
layout(location=1) in vec2 a_center;
layout(location=2) in vec2 a_next;
uniform vec4 u_domain;
uniform vec2 u_size;
uniform float u_width;
flat out vec2 v_lineStart;
flat out vec2 v_lineEnd;
flat out float v_valid;
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
  float side=gl_VertexID%2==0?-1.:1.;
  vec2 edge=miter*side;
  if(!hasPrevious&&hasNext)edge-=outgoing/outgoingLength;
  if(hasPrevious&&!hasNext)edge+=incoming/incomingLength;
  v_lineStart=(before+1.)*.5*u_size;
  v_lineEnd=(p+1.)*.5*u_size;
  v_valid=finite(a_center)&&hasPrevious?1.:0.;
  p+=edge*(u_width+2.)/u_size;
  gl_Position=finite(a_center)?vec4(p,0.,1.):vec4(2.,2.,2.,1.);
}`;

const fragment = `#version 300 es
precision highp float;
uniform vec4 u_color;
uniform vec2 u_plotOrigin;
uniform float u_width;
flat in vec2 v_lineStart;
flat in vec2 v_lineEnd;
flat in float v_valid;
out vec4 color;
void main(){
  if(v_valid<.5)discard;
  vec2 pixel=gl_FragCoord.xy-u_plotOrigin,delta=v_lineEnd-v_lineStart;
  float squared=dot(delta,delta);
  float t=clamp(squared>0.000001?dot(pixel-v_lineStart,delta)/squared:0.,0.,1.);
  float distance=length(pixel-mix(v_lineStart,v_lineEnd,t));
  float coverage=clamp(u_width*.5+.5-distance,0.,1.);
  if(coverage<=0.)discard;
  color=u_color;
  color.a*=coverage;
}`;

/** Original sources shared with isolated diagnostic renderers. */
export const lineStripShaderSources = {vertex, fragment, relativeVertex: relativeLineVertex, relativeCachedVertex: relativeCachedLineVertex} as const;

const cachedVertex = `#version 300 es
precision highp float;
precision highp int;
layout(location=0) in vec2 a_previous;
layout(location=1) in vec2 a_center;
layout(location=2) in vec2 a_offset;
uniform vec4 u_domain;
uniform vec2 u_size;
flat out vec2 v_lineStart;
flat out vec2 v_lineEnd;
flat out float v_valid;
bool finite(vec2 p){return !any(isnan(p))&&!any(isinf(p));}
vec2 project(vec2 p){return (p-u_domain.xy)/u_domain.zw*2.0-1.0;}
void main(){
  vec2 p=project(a_center),before=project(a_previous);
  v_lineStart=(before+1.)*.5*u_size;
  v_lineEnd=(p+1.)*.5*u_size;
  v_valid=finite(a_center)&&finite(a_previous)&&length((p-before)*u_size)>0.00001?1.:0.;
  gl_Position=finite(a_center)?vec4(p+a_offset,0.,1.):vec4(2.,2.,2.,1.);
}`;

/** Strictly increasing-X solid XY line candidate. The caller owns clearing,
 * ordering and context events. Duplicate/reversing/nonfinite X stays on the
 * general pipeline; nonfinite Y is allowed and produces disconnected segments.
 * draw() leaves this program active and unbinds its private VAO. The caller must
 * restore its program before drawing with another pipeline. No source samples
 * are removed: the optional range changes submitted vertices only.
 */
export class LineStripRenderer {
  readonly stats: LineStripStats = {uploads: 0, uploadedBytes: 0, drawCalls: 0, vertices: 0, submittedSamples: 0};
  private program?: WebGLProgram;
  private vao?: WebGLVertexArrayObject;
  private uniforms: Record<string, WebGLUniformLocation | null> = {};
  private buffers = new Map<number, StripBuffer>();
  private live = new Set<number>();
  private experimentalFrame=0;
  private experimentalAliveOwners?:ReadonlySet<number>;
  private experimentalLastUsed=new WeakMap<StripBuffer,number>();
  setExperimentalAliveOwners(ids:ReadonlySet<number>){this.experimentalAliveOwners=new Set(ids);}

  private disposed = false;
  private offsetCache?: LineOffsetCache;
  private coverage?: LineCoverageRenderer;
  private checkedRasterTarget?: RasterTarget;

  constructor(readonly gl: WebGL2RenderingContext, readonly options: {cacheOffsets?: boolean; directionMode?: LineDirectionMode; coverageUnion?: boolean; coverageStateScope?: 'draw' | 'frame'; clipPolicy?: GpuClipPolicy} = {}) {
    try {
      // Default solid lines need conservative segment bounds and one alpha
      // composite. Keep the original strip VBO, revision and tail-upload path.
      if (options.coverageUnion || (!options.directionMode && !options.cacheOffsets)) {
        this.coverage = new LineCoverageRenderer(gl, {
          stateScope: options.coverageUnion ? options.coverageStateScope : 'draw', clipPolicy: options.clipPolicy,
          // Stable block packets already carry exact coverage position pairs.
          // Ordinary strip packets keep their existing expanded VBO layout.
          positionSource: options.coverageUnion ? undefined : packet => 'arenaStorage' in packet || (packet.strokeGroup !== undefined && packet.dirtySampleRanges !== undefined) ? undefined : ({
            buffer: this.upload(packet).buffer, strideBytes: 16, offsetBytes: 16,
          }),
        });
        this.stats = this.coverage.stats;
        return;
      }
      this.initialize();
      if (options.cacheOffsets) this.offsetCache = new LineOffsetCache(gl, options.directionMode ? {directionMode: options.directionMode} : {});
    } catch (error) {this.dispose(); throw error;}
  }

  getOffsetStats() {return this.offsetCache ? {...this.offsetCache.stats} : undefined;}
  /** Coverage candidates use independent segment bounds, not miter offsets. */
  getCoverageStats() {return this.coverage ? {...this.coverage.stats} : undefined;}
  /** Call before entering a different pipeline during an exclusive frame. */
  flushCoverageState(): boolean {return this.coverage?.flushState() ?? false;}

  beginCapturedCoverageFrame(): void {
    if (!this.coverage) throw new Error('Captured frame requires coverage rendering');
    this.coverage.beginCapturedFrame();
  }

  canDraw(packet: DrawPacket): boolean {
    if (this.coverage) return this.coverage.canDraw(packet);
    return !this.disposed && packet.strictlyMonotonicX === true && packet.mode === 'line' && packet.dimensions === 2 &&
      packet.count >= 2 && packet.thickness > 0 && !packet.colors &&
      !packet.dashPattern?.length && packet.positions.length >= packet.count * 2;
  }

  beginFrame(): void {
    this.experimentalFrame++;
    this.checkedRasterTarget = undefined;
    this.live.clear();
    if (this.coverage) {this.coverage.beginFrame(); return;}
    this.stats.drawCalls = 0;
    this.stats.vertices = 0;
    this.stats.submittedSamples = 0;
    this.offsetCache?.beginFrame();
  }

  draw(packet: DrawPacket, rect: Rect, dpr: number, range?: LineStripRange, rasterTarget?: RasterTarget): boolean {
    if (this.coverage) {this.live.add(packet.id); return this.coverage.draw(packet, rect, dpr, range, rasterTarget);}
    if (!this.canDraw(packet) || this.gl.isContextLost()) return false;
    this.live.add(packet.id);
    const selection = range ?? visibleSampleRange(packet, rect.width);
    if (!Number.isSafeInteger(selection.first) || !Number.isSafeInteger(selection.count) || selection.first < 0 || selection.count < 0 || selection.first + selection.count > packet.count)
      throw new RangeError('Line strip sample range exceeds the packet');
    if (selection.count < 2 || packet.color[3] === 0) return true;
    const target = this.options.clipPolicy === 'contained' ? requireRasterTarget(rasterTarget) : undefined;
    const contained = target ? containedRasterClip(rect, packet.clipRect, target) : undefined;
    if (target && !contained) return true;
    if (target && this.checkedRasterTarget !== target) {
      if (this.gl.getParameter(this.gl.DRAW_FRAMEBUFFER_BINDING) !== target.framebuffer) throw new Error('Raster target does not match the destination framebuffer');
      this.checkedRasterTarget = target;
    }
    const gl = this.gl, entry = this.upload(packet);
    const offsets = this.offsetCache?.update(packet, rect, dpr, {buffer: entry.buffer, strideBytes: 16, centerOffsetBytes: 16});
    const x = target?.viewport.x ?? Math.round(rect.left * dpr), y = target?.viewport.y ?? Math.round(gl.drawingBufferHeight - (rect.top + rect.height) * dpr);
    const width = target?.viewport.width ?? Math.max(1, Math.round(rect.width * dpr)), height = target?.viewport.height ?? Math.max(1, Math.round(rect.height * dpr));
    gl.viewport(x, y, width, height);
    const clip = packet.clipRect ?? rect;
    const clipLeft = Math.round(clip.left * dpr), clipRight = Math.round((clip.left + clip.width) * dpr);
    const clipBottom = Math.round(gl.drawingBufferHeight - (clip.top + clip.height) * dpr), clipTop = Math.round(gl.drawingBufferHeight - clip.top * dpr);
    gl.enable(gl.SCISSOR_TEST);
    if (contained) gl.scissor(contained.x, contained.y, contained.width, contained.height);
    else gl.scissor(clipLeft, clipBottom, Math.max(0, clipRight - clipLeft), Math.max(0, clipTop - clipBottom));
    gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.CULL_FACE);
    gl.useProgram(this.program!);
    gl.bindVertexArray(this.vao!);
    gl.bindBuffer(gl.ARRAY_BUFFER, entry.buffer);
    // A pair occupies 16 bytes; its two vertices have an 8-byte stride.
    // Prefix/suffix pairs preserve actual neighbors when the view is cropped.
    for (let location = 0; location < (offsets ? 2 : 3); location++) {
      gl.enableVertexAttribArray(location);
      gl.vertexAttribDivisor(location, 0);
      gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 8, selection.first * 16 + location * 16);
    }
    if (offsets) {
      gl.bindBuffer(gl.ARRAY_BUFFER, offsets.buffer);
      gl.enableVertexAttribArray(2); gl.vertexAttribDivisor(2, 0);
      gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 8, selection.first * 16);
    }
    gl.uniform4f(this.uniforms.domain!, packet.domain.x.start - packet.origin.x, packet.domain.y.start - packet.origin.y, packet.domain.x.end - packet.domain.x.start, packet.domain.y.end - packet.domain.y.start);
    gl.uniform2f(this.uniforms.size!, width, height);
    gl.uniform2f(this.uniforms.plotOrigin!, x, y);
    gl.uniform1f(this.uniforms.width!, packet.thickness * dpr);
    gl.uniform4fv(this.uniforms.color!, packet.color);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, selection.count * 2);
    gl.bindVertexArray(null);
    this.stats.drawCalls++;
    this.stats.vertices += selection.count * 2;
    this.stats.submittedSamples += selection.count;
    return true;
  }

  /** Consecutive blocks of one stroke share a coverage union when the explicit
   * candidate is enabled. The baseline preserves its original per-packet draw. */
  drawGroup(packets: readonly DrawPacket[], rect: Rect, dpr: number, rasterTarget?: RasterTarget): boolean {
    if (this.coverage) {for (const packet of packets) this.live.add(packet.id); return this.coverage.drawGroup(packets, rect, dpr, undefined, rasterTarget);}
    if (packets.some(packet => !this.canDraw(packet))) return false;
    for (const packet of packets) if (!this.draw(packet, rect, dpr, undefined, rasterTarget)) return false;
    return true;
  }

  /** Internal Chart-owned default-target entry; ordinary low-level calls do
   * not activate it and continue saving/restoring arbitrary incoming state. */
  beginKnownOwnedFrame(program:WebGLProgram,viewport:readonly[number,number,number,number]):void {
    if(!this.coverage)throw new Error('Known coverage frame requires coverage union');
    this.coverage.beginKnownOwnedFrame(program,viewport);
  }

  endFrame(): void {
    if (this.coverage) this.coverage.endFrame();
    this.offsetCache?.endFrame();
    for (const [id, entry] of this.buffers) if (!this.live.has(id)&&!(this.experimentalAliveOwners?.has(id)&&this.experimentalLastUsed.get(entry)===this.experimentalFrame-1)) {
      this.gl.deleteBuffer(entry.buffer); this.buffers.delete(id);
    }
  }

  /** Call only after WebGL context restoration; old handles are invalid. */
  restoreContext(): void {
    this.experimentalAliveOwners=undefined;this.experimentalLastUsed=new WeakMap();this.experimentalFrame=0;
    if (this.disposed) return;
    this.buffers.clear(); this.live.clear();
    if (this.coverage) {this.coverage.restoreContext(); return;}
    this.program = undefined; this.vao = undefined;
    this.offsetCache?.restoreContext();
    this.initialize();
  }

  dispose(): void {
    this.experimentalAliveOwners=undefined;this.experimentalLastUsed=new WeakMap();
    if (this.disposed) return;
    this.disposed = true;
    this.coverage?.dispose();
    this.offsetCache?.dispose();
    for (const entry of this.buffers.values()) this.gl.deleteBuffer(entry.buffer);
    this.buffers.clear(); this.live.clear();
    if (this.vao) this.gl.deleteVertexArray(this.vao);
    if (this.program) this.gl.deleteProgram(this.program);
    this.vao = undefined; this.program = undefined;
  }

  private upload(packet: DrawPacket): StripBuffer {
    const gl = this.gl;
    let entry = this.buffers.get(packet.id);
    if (!entry) {
      const buffer = gl.createBuffer();
      if (!buffer) throw new Error('Line strip buffer allocation failed');
      entry = {buffer, revision: -1, count: 0, storage: new Float32Array(0)};
      this.buffers.set(packet.id, entry);
    }
    this.experimentalLastUsed.set(entry,this.experimentalFrame);
    if (entry.revision === packet.revision) return entry;
    const required = (packet.count + 2) * 4;
    const grow = entry.storage.length < required;
    if (grow) {
      let capacity = Math.max(64, entry.storage.length);
      while (capacity < required) capacity *= 2;
      entry.storage = new Float32Array(capacity);
    }
    const ranges = linePositionUploadRanges(packet, entry.revision, entry.count, grow);
    const values = packet.positions, expanded = entry.storage;
    const pair = (offset: number, x: number, y: number) => {expanded[offset] = x; expanded[offset + 1] = y; expanded[offset + 2] = x; expanded[offset + 3] = y;};
    gl.bindBuffer(gl.ARRAY_BUFFER, entry.buffer);
    if (grow) gl.bufferData(gl.ARRAY_BUFFER, expanded.byteLength, gl.DYNAMIC_DRAW);
    for (const range of ranges) {
      const end = range.first + range.count;
      if (range.first === 0) pair(0, values[0]!, values[1]!);
      for (let i = range.first; i < end; i++) pair((i + 1) * 4, values[i * 2]!, values[i * 2 + 1]!);
      if (end === packet.count) pair((packet.count + 1) * 4, values[packet.count * 2 - 2]!, values[packet.count * 2 - 1]!);
      const start = range.first === 0 ? 0 : (range.first + 1) * 4;
      const finish = end === packet.count ? required : (end + 1) * 4;
      const changed = expanded.subarray(start, finish);
      gl.bufferSubData(gl.ARRAY_BUFFER, start * 4, changed);
      this.stats.uploads++; this.stats.uploadedBytes += changed.byteLength;
    }
    entry.revision = packet.revision; entry.count = packet.count;
    return entry;
  }

  private initialize(): void {
    const gl = this.gl, shaders: WebGLShader[] = [];
    const program = gl.createProgram();
    if (!program) throw new Error('Line strip program allocation failed');
    try {
      const vertexSource = this.options.directionMode === 'relative'
        ? this.options.cacheOffsets ? relativeCachedLineVertex : relativeLineVertex
        : this.options.cacheOffsets ? cachedVertex : vertex;
      for (const [type, source] of [[gl.VERTEX_SHADER, vertexSource], [gl.FRAGMENT_SHADER, fragment]] as const) {
        const shader = gl.createShader(type);
        if (!shader) throw new Error('Line strip shader allocation failed');
        shaders.push(shader); gl.shaderSource(shader, source); gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'Line strip shader compilation failed');
        gl.attachShader(program, shader);
      }
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'Line strip shader linking failed');
      this.vao = gl.createVertexArray() ?? undefined;
      if (!this.vao) throw new Error('Line strip vertex-array allocation failed');
      this.program = program;
      for (const name of ['domain', 'size', 'width', 'color', 'plotOrigin']) this.uniforms[name] = gl.getUniformLocation(program, `u_${name}`);
    } catch (error) {gl.deleteProgram(program); throw error;}
    finally {for (const shader of shaders) gl.deleteShader(shader);}
  }
}
