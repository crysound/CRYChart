import type {LineArenaPacket} from './line-display-arena.js';
import type {DrawPacket, Rect} from './contracts.js';
import {visibleSampleRange} from './viewport.js';
import {strokeRegion, type StrokeRegion} from './line-coverage-geometry.js';
import {lineCapsuleVertex, lineCoverageFragment} from './render-line-direction.js';
import {requireRasterTarget, type GpuClipPolicy, type RasterTarget} from './raster-clip.js';

interface Range {first: number; count: number;}
interface BufferEntry {buffer: WebGLBuffer; revision: number; count: number; bytes: number;}
interface Program {program: WebGLProgram; uniforms: Record<string, WebGLUniformLocation | null>;}
/** Reuse patches only against an exact retained GPU revision. Growth or missed
 * revisions require full initialization, including every halo and NaN pair. */
export function linePositionUploadRanges(packet: DrawPacket, revision: number, count: number, grow: boolean): readonly Range[] {
  const full = () => [{first: 0, count: packet.count}];
  if (grow || packet.previousRevision !== revision || packet.count < count) return full();
  const valid = (range: Range) => Number.isSafeInteger(range.first) && Number.isSafeInteger(range.count) && range.first >= 0 && range.count >= 0 && range.first + range.count <= packet.count;
  if (packet.dirtySampleRanges) {
    if (!packet.dirtySampleRanges.every(valid)) return full();
    const ranges = packet.dirtySampleRanges.filter(range => range.count > 0).map(range => ({...range}));
    if (packet.count > count) ranges.push({first: count, count: packet.count - count});
    ranges.sort((a, b) => a.first - b.first);
    const merged: Range[] = [];
    for (const range of ranges) {
      const last = merged.at(-1);
      if (last && range.first <= last.first + last.count) last.count = Math.max(last.first + last.count, range.first + range.count) - last.first;
      else merged.push(range);
    }
    return merged;
  }
  const first = packet.updateFrom;
  return first !== undefined && Number.isSafeInteger(first) && first >= 0 && first <= count
    ? [{first, count: packet.count - first}] : full();
}
interface GLState {
  drawFramebuffer: WebGLFramebuffer | null; readFramebuffer: WebGLFramebuffer | null;
  viewport: Int32Array; scissor: Int32Array; clearColor: Float32Array; colorMask: boolean[];
  program: WebGLProgram | null; vao: WebGLVertexArrayObject | null; arrayBuffer: WebGLBuffer | null;
  activeTexture: number; texture0: WebGLTexture | null; sampler0: WebGLSampler | null;
  enabled: readonly [number, boolean][];
  blendSourceRGB: number; blendSourceAlpha: number; blendDestinationRGB: number; blendDestinationAlpha: number;
  blendEquationRGB: number; blendEquationAlpha: number;
}

const compositeVertex = `#version 300 es
precision highp float;
void main(){gl_Position=vec4(gl_VertexID%2==0?-1.:1.,gl_VertexID<2?-1.:1.,0.,1.);}`;
const compositeFragment = `#version 300 es
precision highp float;
uniform sampler2D u_mask;
uniform vec2 u_origin;
uniform vec4 u_color;
out vec4 color;
void main(){
  float coverage=texelFetch(u_mask,ivec2(gl_FragCoord.xy-u_origin),0).r;
  if(coverage<=0.)discard;
  color=vec4(u_color.rgb,u_color.a*coverage);
}`;

/** Explicit candidate: conservative capsule bounds, a per-stroke coverage
 * union, and exactly one color/alpha composite. One lazily grown R8 scratch
 * texture is reused across every line and clipped to its visible ROI. Source
 * data and display selection are not changed here. All modified GL state is
 * restored before returning, including when allocation or drawing throws. */
export class LineCoverageRenderer {
  readonly stats = {
    uploads: 0, uploadedBytes: 0, drawCalls: 0, vertices: 0, submittedSamples: 0,
    maskPasses: 0, compositePasses: 0, maskPixels: 0, scratchBytes: 0,
    residentBufferBytes: 0,
    stateCaptures: 0, stateRestores: 0, knownFrameBaselines: 0,
  };
  private maskProgram?: Program;
  private compositeProgram?: Program;
  private vao?: WebGLVertexArrayObject;
  private compositeVAO?: WebGLVertexArrayObject;
  private framebuffer?: WebGLFramebuffer;
  private texture?: WebGLTexture;
  private textureWidth = 0;
  private textureHeight = 0;
  private buffers = new Map<number, BufferEntry>();
  private live = new Set<number>();
  private disposed = false;
  private frameState?: GLState;
  private capturedFrameActive = false;
  private knownFrameActive=false;
  // Valid only inside the existing explicitly admitted private-owned frame.
  // No uniforms, geometry or draw/clear commands are cached here.
  private ownedMaskStateReady=false;

  /** Frame scope is an explicit exclusive-GL contract: the caller must invoke
   * flushState() before another renderer reads or changes context state. The
   * default continues to restore every individual stroke immediately. */
  constructor(readonly gl: WebGL2RenderingContext, readonly options: {stateScope?: 'draw' | 'frame'; clipPolicy?: GpuClipPolicy; positionSource?: (packet: DrawPacket) => {buffer: WebGLBuffer; strideBytes: number; offsetBytes: number} | undefined} = {}) {
    try {this.initialize();} catch (error) {this.dispose(); throw error;}
  }

  canDraw(packet: DrawPacket): boolean {
    return !this.disposed && packet.strictlyMonotonicX === true && packet.mode === 'line' && packet.dimensions === 2 &&
      Number.isSafeInteger(packet.count) && packet.count >= 2 && packet.positions.length >= packet.count * 2 &&
      Number.isFinite(packet.thickness) && packet.thickness > 0 && !packet.colors && !packet.dashPattern?.length;
  }

  beginFrame(): void {
    this.flushState();
    this.live.clear();
    this.stats.drawCalls = this.stats.vertices = this.stats.submittedSamples = 0;
    this.stats.maskPasses = this.stats.compositePasses = this.stats.maskPixels = 0;
    this.stats.stateCaptures = this.stats.stateRestores = this.stats.knownFrameBaselines = 0;
  }

  /** Synchronous all-coverage batch: capture actual incoming state, never an
   * assumed private-context baseline. No other renderer may enter until flush. */
  beginCapturedFrame(): void {
    if (this.disposed || this.frameState) throw new Error('Captured coverage frame requires a fresh frame');
    this.frameState = this.saveState();
    this.capturedFrameActive = true;
  }

  /** Internal capability, only after DataRenderer established this exact private
   * default-target baseline. Standalone draw()/frame users keep full capture.
   * This record is ephemeral and cleared by every flush/end/context/dispose. */
  beginKnownOwnedFrame(program:WebGLProgram,viewport:readonly[number,number,number,number]):void {
    if(this.disposed||this.options.stateScope!=='frame'||this.frameState)throw new Error('Known coverage frame requires a fresh exclusive frame');
    const gl=this.gl;
    this.frameState={drawFramebuffer:null,readFramebuffer:null,
      viewport:Int32Array.from(viewport),scissor:Int32Array.from(viewport),clearColor:new Float32Array(4),colorMask:[true,true,true,true],
      program,vao:null,arrayBuffer:null,activeTexture:gl.TEXTURE0,texture0:null,sampler0:null,
      enabled:[[gl.SCISSOR_TEST,true],[gl.BLEND,true],[gl.DEPTH_TEST,false],[gl.STENCIL_TEST,false],[gl.CULL_FACE,false],[gl.RASTERIZER_DISCARD,false],[gl.SAMPLE_ALPHA_TO_COVERAGE,false],[gl.SAMPLE_COVERAGE,false],[gl.DITHER,true]],
      blendSourceRGB:gl.SRC_ALPHA,blendSourceAlpha:gl.ONE,blendDestinationRGB:gl.ONE_MINUS_SRC_ALPHA,blendDestinationAlpha:gl.ONE_MINUS_SRC_ALPHA,
      blendEquationRGB:gl.FUNC_ADD,blendEquationAlpha:gl.FUNC_ADD};
    this.ownedMaskStateReady=false;this.knownFrameActive=true;this.stats.knownFrameBaselines++;
  }

  draw(packet: DrawPacket, rect: Rect, dpr: number, range?: Range, rasterTarget?: RasterTarget): boolean {
    return this.drawGroup([packet], rect, dpr, range ? [range] : undefined, rasterTarget);
  }

  drawGroup(packets: readonly DrawPacket[], rect: Rect, dpr: number, ranges?: readonly Range[], rasterTarget?: RasterTarget): boolean {
    try {
    if (this.disposed || this.gl.isContextLost() || packets.some(packet => !this.canDraw(packet))) {this.ownedMaskStateReady=false;this.knownFrameActive=false;return false;}
    if (!packets.length) return true;
    const first = packets[0]!;
    this.validateGroup(packets, rect);
    const selections = packets.map((packet, index) => ranges?.[index] ?? visibleSampleRange(packet, rect.width));
    selections.forEach((range, index) => {
      if (!Number.isSafeInteger(range.first) || !Number.isSafeInteger(range.count) || range.first < 0 || range.count < 0 || range.first + range.count > packets[index]!.count)
        throw new RangeError('Line coverage sample range exceeds the packet');
    });
    for (const packet of packets) this.live.add(packet.id);
    const target = this.options.clipPolicy === 'contained' ? requireRasterTarget(rasterTarget) : undefined;
    const area = strokeRegion(rect, first.clipRect ?? rect, dpr, this.gl.drawingBufferWidth, this.gl.drawingBufferHeight, target);
    if (!area || first.color[3] <= 0 || selections.every(range => range.count < 2)) return true;
    const gl = this.gl, state = this.frameState ?? this.saveState();
    if (this.options.stateScope === 'frame') this.frameState = state;
    let complete = false;
    try {
      if (target && state.drawFramebuffer !== target.framebuffer) throw new Error('Raster target does not match the destination framebuffer; flush before switching targets');
      this.ensureScratch(area.region.width, area.region.height);
      const fixedMaskStateKnown=this.knownFrameActive&&this.frameState!==undefined&&this.ownedMaskStateReady;
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.framebuffer!);
      gl.viewport(-area.offsetX, -area.offsetY, area.viewport.width, area.viewport.height);
      if(!fixedMaskStateKnown)gl.enable(gl.SCISSOR_TEST); gl.scissor(0, 0, area.region.width, area.region.height);
      if(!fixedMaskStateKnown)gl.colorMask(true, true, true, true);
      if(!fixedMaskStateKnown)gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      if(!fixedMaskStateKnown){
        for (const capability of [gl.DEPTH_TEST, gl.STENCIL_TEST, gl.CULL_FACE, gl.RASTERIZER_DISCARD, gl.SAMPLE_ALPHA_TO_COVERAGE, gl.SAMPLE_COVERAGE, gl.DITHER]) gl.disable(capability);
        gl.enable(gl.BLEND);
        this.ownedMaskStateReady=this.knownFrameActive&&this.frameState!==undefined;
      }
      gl.blendEquationSeparate(gl.MAX, gl.MAX); gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ONE, gl.ONE);
      gl.useProgram(this.maskProgram!.program); gl.bindVertexArray(this.vao!);
      gl.uniform2f(this.maskProgram!.uniforms.size!, area.viewport.width, area.viewport.height);
      gl.uniform2f(this.maskProgram!.uniforms.plotOrigin!, -area.offsetX, -area.offsetY);
      gl.uniform1f(this.maskProgram!.uniforms.width!, first.thickness * dpr);
      packets.forEach((packet, index) => this.drawMask(packet, selections[index]!));
      this.stats.maskPasses++; this.stats.maskPixels += area.region.width * area.region.height;
      this.composite(first, area, state.drawFramebuffer);
      complete = true;
      return true;
    } finally {
      if (!complete || (this.options.stateScope !== 'frame' && !this.capturedFrameActive)) {this.ownedMaskStateReady=false;this.restoreState(state); this.frameState = undefined;}
    }
    } catch(error) {this.ownedMaskStateReady=false;this.knownFrameActive=false;throw error;}
  }

  /** Finish the current exclusive batch before any mixed-pipeline operation. */
  flushState(): boolean {
    const state = this.frameState;
    this.frameState = undefined;this.capturedFrameActive=false;this.knownFrameActive=false;this.ownedMaskStateReady=false;
    if (state && !this.gl.isContextLost()) this.restoreState(state);
    return state !== undefined;
  }

  endFrame(): void {
    this.flushState();
    for (const [id, entry] of this.buffers) if (!this.live.has(id)) {
      this.gl.deleteBuffer(entry.buffer); this.stats.residentBufferBytes -= entry.bytes; this.buffers.delete(id);
    }
  }

  restoreContext(): void {
    if (this.disposed) return;
    this.frameState = undefined;this.capturedFrameActive=false;this.knownFrameActive=false;this.ownedMaskStateReady=false;
    this.buffers.clear(); this.live.clear();
    this.maskProgram = this.compositeProgram = undefined;
    this.vao = this.compositeVAO = undefined; this.framebuffer = undefined; this.texture = undefined;
    this.textureWidth = this.textureHeight = this.stats.scratchBytes = this.stats.residentBufferBytes = 0;
    this.initialize();
  }

  dispose(): void {
    if (this.disposed) return;
    this.flushState();
    this.disposed = true;
    const gl = this.gl;
    for (const entry of this.buffers.values()) gl.deleteBuffer(entry.buffer);
    this.buffers.clear(); this.live.clear();
    if (this.texture) gl.deleteTexture(this.texture);
    if (this.framebuffer) gl.deleteFramebuffer(this.framebuffer);
    if (this.vao) gl.deleteVertexArray(this.vao);
    if (this.compositeVAO) gl.deleteVertexArray(this.compositeVAO);
    if (this.maskProgram) gl.deleteProgram(this.maskProgram.program);
    if (this.compositeProgram) gl.deleteProgram(this.compositeProgram.program);
    this.texture = undefined; this.framebuffer = undefined; this.vao = this.compositeVAO = undefined;
    this.maskProgram = this.compositeProgram = undefined;
    this.textureWidth = this.textureHeight = this.stats.scratchBytes = this.stats.residentBufferBytes = 0;
  }

  private validateGroup(packets: readonly DrawPacket[], rect: Rect): void {
    const first = packets[0]!, clip = first.clipRect ?? rect;
    for (const packet of packets.slice(1)) {
      const other = packet.clipRect ?? rect;
      if (first.strokeGroup === undefined || packet.strokeGroup !== first.strokeGroup || packet.thickness !== first.thickness ||
          packet.color.some((value, index) => value !== first.color[index]) ||
          packet.domain.x.start !== first.domain.x.start || packet.domain.x.end !== first.domain.x.end ||
          packet.domain.y.start !== first.domain.y.start || packet.domain.y.end !== first.domain.y.end ||
          other.left !== clip.left || other.top !== clip.top || other.width !== clip.width || other.height !== clip.height)
        throw new TypeError('Line coverage groups require one stroke identity, style, domain and clipping rectangle');
    }
  }

  private drawMask(packet: DrawPacket, range: Range): void {
    if (range.count < 2) return;
    const gl = this.gl, source = this.options.positionSource?.(packet);
    const buffer = source?.buffer ?? this.upload(packet).buffer, stride = source?.strideBytes ?? 8;
    const offset = source?.offsetBytes ?? (((packet as Partial<LineArenaPacket>).arenaFirst ?? 0) * 8);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    for (let location = 0; location < 2; location++) {
      gl.enableVertexAttribArray(location); gl.vertexAttribDivisor(location, 1);
      gl.vertexAttribPointer(location, 2, gl.FLOAT, false, stride, offset + (range.first + location) * stride);
    }
    gl.uniform4f(this.maskProgram!.uniforms.domain!, packet.domain.x.start - packet.origin.x, packet.domain.y.start - packet.origin.y, packet.domain.x.end - packet.domain.x.start, packet.domain.y.end - packet.domain.y.start);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, range.count - 1);
    this.stats.drawCalls++; this.stats.vertices += (range.count - 1) * 4; this.stats.submittedSamples += range.count;
  }

  private composite(packet: DrawPacket, area: StrokeRegion, destination: WebGLFramebuffer | null): void {
    const gl = this.gl, roi = area.region;
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, destination);
    gl.viewport(roi.x, roi.y, roi.width, roi.height); gl.scissor(roi.x, roi.y, roi.width, roi.height);
    gl.blendEquationSeparate(gl.FUNC_ADD, gl.FUNC_ADD);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.compositeProgram!.program); gl.bindVertexArray(this.compositeVAO!);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texture!); gl.bindSampler(0, null);
    gl.uniform1i(this.compositeProgram!.uniforms.mask!, 0);
    gl.uniform2f(this.compositeProgram!.uniforms.origin!, roi.x, roi.y);
    gl.uniform4fv(this.compositeProgram!.uniforms.color!, packet.color);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    this.stats.drawCalls++; this.stats.vertices += 4; this.stats.compositePasses++;
  }

  private uploadArena(packet: LineArenaPacket): BufferEntry {
    const gl=this.gl,storage=packet.arenaStorage;
    let entry=this.buffers.get(storage.id);
    if(!entry){const buffer=gl.createBuffer();if(!buffer)throw new Error('Arena VBO allocation failed');entry={buffer,revision:-1,count:0,bytes:0};this.buffers.set(storage.id,entry);}
    if(entry.revision===storage.revision)return entry;
    gl.bindBuffer(gl.ARRAY_BUFFER,entry.buffer);
    const required=storage.values.byteLength,grow=entry.bytes<required;
    if(grow){gl.bufferData(gl.ARRAY_BUFFER,required,gl.DYNAMIC_DRAW);this.stats.residentBufferBytes+=required-entry.bytes;entry.bytes=required;}
    const incremental=!grow&&entry.revision===storage.previousRevision;
    const ranges=incremental?storage.dirtyRanges:[{first:0,count:storage.capacity+1}];
    for(const range of ranges){gl.bufferSubData(gl.ARRAY_BUFFER,range.first*8,storage.values,range.first*2,range.count*2);this.stats.uploads++;this.stats.uploadedBytes+=range.count*8;}
    entry.revision=storage.revision;entry.count=storage.capacity+1;return entry;
  }

  private upload(packet: DrawPacket): BufferEntry {
    if('arenaStorage' in packet)return this.uploadArena(packet as LineArenaPacket);
    const gl = this.gl;
    let entry = this.buffers.get(packet.id);
    if (!entry) {
      const buffer = gl.createBuffer();
      if (!buffer) throw new Error('Line coverage position buffer allocation failed');
      entry = {buffer, revision: -1, count: 0, bytes: 0}; this.buffers.set(packet.id, entry);
    }
    if (entry.revision === packet.revision) return entry;
    const required = packet.count * 8, grow = entry.bytes < required;
    gl.bindBuffer(gl.ARRAY_BUFFER, entry.buffer);
    if (grow) {
      let capacity = Math.max(256, entry.bytes);
      while (capacity < required) capacity *= 2;
      gl.bufferData(gl.ARRAY_BUFFER, capacity, gl.DYNAMIC_DRAW);
      this.stats.residentBufferBytes += capacity - entry.bytes; entry.bytes = capacity;
    }
    const ranges = linePositionUploadRanges(packet, entry.revision, entry.count, grow);
    for (const range of ranges) {
      gl.bufferSubData(gl.ARRAY_BUFFER, range.first * 8, packet.positions, range.first * 2, range.count * 2);
      this.stats.uploads++; this.stats.uploadedBytes += range.count * 8;
    }
    entry.revision = packet.revision; entry.count = packet.count;
    return entry;
  }

  private ensureScratch(width: number, height: number): void {
    if (this.texture && width <= this.textureWidth && height <= this.textureHeight) return;
    this.ownedMaskStateReady=false;
    const gl = this.gl, limit = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    if (width > limit || height > limit) throw new RangeError('Line coverage ROI exceeds the WebGL texture size limit');
    const grow = (needed: number, previous: number) => {let size = Math.max(1, previous); while (size < needed) size = Math.min(limit, size * 2); return size;};
    const nextWidth = grow(width, this.textureWidth), nextHeight = grow(height, this.textureHeight);
    const texture = gl.createTexture();
    if (!texture) throw new Error('Line coverage scratch texture allocation failed');
    try {
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R8, nextWidth, nextHeight);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.framebuffer!);
      gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      if (gl.checkFramebufferStatus(gl.DRAW_FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Line coverage scratch framebuffer is incomplete');
    } catch (error) {
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.framebuffer!);
      gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texture ?? null, 0);
      gl.deleteTexture(texture); throw error;
    }
    if (this.texture) gl.deleteTexture(this.texture);
    this.texture = texture; this.textureWidth = nextWidth; this.textureHeight = nextHeight;
    this.stats.scratchBytes = nextWidth * nextHeight;
  }

  private initialize(): void {
    this.maskProgram = this.createProgram(lineCapsuleVertex, lineCoverageFragment, ['domain', 'size', 'plotOrigin', 'width']);
    this.compositeProgram = this.createProgram(compositeVertex, compositeFragment, ['mask', 'origin', 'color']);
    this.vao = this.gl.createVertexArray() ?? undefined;
    this.compositeVAO = this.gl.createVertexArray() ?? undefined;
    this.framebuffer = this.gl.createFramebuffer() ?? undefined;
    if (!this.vao || !this.compositeVAO || !this.framebuffer) throw new Error('Line coverage render resource allocation failed');
  }

  private createProgram(vertex: string, fragment: string, uniformNames: readonly string[]): Program {
    const gl = this.gl, program = gl.createProgram(), shaders: WebGLShader[] = [];
    if (!program) throw new Error('Line coverage program allocation failed');
    try {
      for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]] as const) {
        const shader = gl.createShader(type);
        if (!shader) throw new Error('Line coverage shader allocation failed');
        shaders.push(shader); gl.shaderSource(shader, source); gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'Line coverage shader compilation failed');
        gl.attachShader(program, shader);
      }
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'Line coverage program linking failed');
      return {program, uniforms: Object.fromEntries(uniformNames.map(name => [name, gl.getUniformLocation(program, `u_${name}`)]))};
    } catch (error) {gl.deleteProgram(program); throw error;}
    finally {for (const shader of shaders) gl.deleteShader(shader);}
  }

  private saveState(): GLState {
    this.stats.stateCaptures++;
    const gl = this.gl;
    const activeTexture = gl.getParameter(gl.ACTIVE_TEXTURE) as number;
    gl.activeTexture(gl.TEXTURE0);
    const texture0 = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null, sampler0 = gl.getParameter(gl.SAMPLER_BINDING) as WebGLSampler | null;
    gl.activeTexture(activeTexture);
    return {
      drawFramebuffer: gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING), readFramebuffer: gl.getParameter(gl.READ_FRAMEBUFFER_BINDING),
      viewport: gl.getParameter(gl.VIEWPORT), scissor: gl.getParameter(gl.SCISSOR_BOX), clearColor: gl.getParameter(gl.COLOR_CLEAR_VALUE), colorMask: gl.getParameter(gl.COLOR_WRITEMASK),
      program: gl.getParameter(gl.CURRENT_PROGRAM), vao: gl.getParameter(gl.VERTEX_ARRAY_BINDING), arrayBuffer: gl.getParameter(gl.ARRAY_BUFFER_BINDING),
      activeTexture, texture0, sampler0,
      enabled: [gl.SCISSOR_TEST, gl.BLEND, gl.DEPTH_TEST, gl.STENCIL_TEST, gl.CULL_FACE, gl.RASTERIZER_DISCARD, gl.SAMPLE_ALPHA_TO_COVERAGE, gl.SAMPLE_COVERAGE, gl.DITHER].map(capability => [capability, gl.isEnabled(capability)]),
      blendSourceRGB: gl.getParameter(gl.BLEND_SRC_RGB), blendSourceAlpha: gl.getParameter(gl.BLEND_SRC_ALPHA),
      blendDestinationRGB: gl.getParameter(gl.BLEND_DST_RGB), blendDestinationAlpha: gl.getParameter(gl.BLEND_DST_ALPHA),
      blendEquationRGB: gl.getParameter(gl.BLEND_EQUATION_RGB), blendEquationAlpha: gl.getParameter(gl.BLEND_EQUATION_ALPHA),
    };
  }

  private restoreState(state: GLState): void {
    this.stats.stateRestores++;
    const gl = this.gl;
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, state.drawFramebuffer); gl.bindFramebuffer(gl.READ_FRAMEBUFFER, state.readFramebuffer);
    gl.viewport(state.viewport[0]!, state.viewport[1]!, state.viewport[2]!, state.viewport[3]!);
    gl.scissor(state.scissor[0]!, state.scissor[1]!, state.scissor[2]!, state.scissor[3]!);
    gl.clearColor(state.clearColor[0]!, state.clearColor[1]!, state.clearColor[2]!, state.clearColor[3]!);
    gl.colorMask(state.colorMask[0]!, state.colorMask[1]!, state.colorMask[2]!, state.colorMask[3]!);
    gl.blendFuncSeparate(state.blendSourceRGB, state.blendDestinationRGB, state.blendSourceAlpha, state.blendDestinationAlpha);
    gl.blendEquationSeparate(state.blendEquationRGB, state.blendEquationAlpha);
    for (const [capability, enabled] of state.enabled) enabled ? gl.enable(capability) : gl.disable(capability);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, state.texture0); gl.bindSampler(0, state.sampler0); gl.activeTexture(state.activeTexture);
    gl.useProgram(state.program); gl.bindVertexArray(state.vao); gl.bindBuffer(gl.ARRAY_BUFFER, state.arrayBuffer);
  }
}
