import type {DrawPacket, Rect} from './contracts.js';
import {visibleSampleRange} from './viewport.js';
import {lineStripShaderSources, type LineStripRange, type LineStripStats} from './render-line-strip.js';

interface TextureEntry {
  texture: WebGLTexture;
  rows: number;
  revision: number;
  count: number;
}

// This experiment changes only where identical Float32 coordinates are fetched.
// The original projection, miter, cap and analytic-AA expressions are retained.
const vertex = lineStripShaderSources.vertex
  .replace('layout(location=0) in vec2 a_previous;\nlayout(location=1) in vec2 a_center;\nlayout(location=2) in vec2 a_next;', `
uniform highp sampler2D u_positions;
uniform int u_textureMask;
uniform int u_textureShift;
uniform int u_first;
uniform int u_count;
vec2 sampleAt(int index){
  index=clamp(index,0,u_count-1);
  return texelFetch(u_positions,ivec2(index&u_textureMask,index>>u_textureShift),0).rg;
}`)
  .replace('void main(){', `void main(){
  int sampleIndex=u_first+(gl_VertexID>>1);
  vec2 a_previous=sampleAt(sampleIndex-1),a_center=sampleAt(sampleIndex),a_next=sampleAt(sampleIndex+1);`);

/** Experimental RG32F coordinate fetcher, deliberately not used by DataRenderer.
 * No resampling, coordinate quantization, or source reduction is performed.
 * Like LineStripRenderer, draw() leaves its program active and unbinds its VAO.
 * It additionally leaves TEXTURE0 active with its private texture bound. A host
 * that mixes pipelines must restore the texture state required by the next one.
 */
export class TextureLineRenderer {
  readonly stats: LineStripStats = {uploads: 0, uploadedBytes: 0, drawCalls: 0, vertices: 0, submittedSamples: 0};
  readonly uploadKind = 'RG32F-texture' as const;
  private program?: WebGLProgram;
  private vao?: WebGLVertexArrayObject;
  private uniforms: Record<string, WebGLUniformLocation | null> = {};
  private textures = new Map<number, TextureEntry>();
  private live = new Set<number>();
  private disposed = false;
  private textureWidth = 2048;
  private maxTextureSize = 0;

  constructor(readonly gl: WebGL2RenderingContext) {this.initialize();}

  canDraw(packet: DrawPacket): boolean {
    return !this.disposed && packet.strictlyMonotonicX === true && packet.mode === 'line' && packet.dimensions === 2 &&
      Number.isSafeInteger(packet.count) && packet.count >= 2 && packet.count <= this.textureWidth * this.maxTextureSize &&
      packet.thickness > 0 && !packet.colors && !packet.dashPattern?.length && packet.positions.length >= packet.count * 2;
  }

  beginFrame(): void {
    this.live.clear(); this.stats.drawCalls = 0; this.stats.vertices = 0; this.stats.submittedSamples = 0;
  }

  draw(packet: DrawPacket, rect: Rect, dpr: number, range?: LineStripRange): boolean {
    if (!this.canDraw(packet) || this.gl.isContextLost()) return false;
    this.live.add(packet.id);
    const selection = range ?? visibleSampleRange(packet, rect.width);
    if (!Number.isSafeInteger(selection.first) || !Number.isSafeInteger(selection.count) || selection.first < 0 || selection.count < 0 || selection.first + selection.count > packet.count)
      throw new RangeError('Texture line sample range exceeds the packet');
    if (selection.count < 2 || packet.color[3] === 0) return true;
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    const entry = this.upload(packet);
    gl.bindTexture(gl.TEXTURE_2D, entry.texture);
    const x = Math.round(rect.left * dpr), y = Math.round(gl.drawingBufferHeight - (rect.top + rect.height) * dpr);
    const width = Math.max(1, Math.round(rect.width * dpr)), height = Math.max(1, Math.round(rect.height * dpr));
    gl.viewport(x, y, width, height); gl.enable(gl.SCISSOR_TEST); gl.scissor(x, y, width, height);
    gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.disable(gl.CULL_FACE);
    gl.useProgram(this.program!); gl.bindVertexArray(this.vao!);
    gl.uniform4f(this.uniforms.domain!, packet.domain.x.start - packet.origin.x, packet.domain.y.start - packet.origin.y, packet.domain.x.end - packet.domain.x.start, packet.domain.y.end - packet.domain.y.start);
    gl.uniform2f(this.uniforms.size!, width, height); gl.uniform2f(this.uniforms.plotOrigin!, x, y);
    gl.uniform1f(this.uniforms.width!, packet.thickness * dpr); gl.uniform4fv(this.uniforms.color!, packet.color);
    gl.uniform1i(this.uniforms.positions!, 0); gl.uniform1i(this.uniforms.textureMask!, this.textureWidth - 1);
    gl.uniform1i(this.uniforms.textureShift!, Math.log2(this.textureWidth));
    gl.uniform1i(this.uniforms.first!, selection.first); gl.uniform1i(this.uniforms.count!, packet.count);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, selection.count * 2); gl.bindVertexArray(null);
    this.stats.drawCalls++; this.stats.vertices += selection.count * 2; this.stats.submittedSamples += selection.count;
    return true;
  }

  endFrame(): void {
    for (const [id, entry] of this.textures) if (!this.live.has(id)) {this.gl.deleteTexture(entry.texture); this.textures.delete(id);}
  }

  restoreContext(): void {
    if (this.disposed) return;
    this.textures.clear(); this.live.clear(); this.program = undefined; this.vao = undefined;
    this.initialize();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const entry of this.textures.values()) this.gl.deleteTexture(entry.texture);
    this.textures.clear(); this.live.clear();
    if (this.vao) this.gl.deleteVertexArray(this.vao);
    if (this.program) this.gl.deleteProgram(this.program);
    this.vao = undefined; this.program = undefined;
  }

  private upload(packet: DrawPacket): TextureEntry {
    const gl = this.gl;
    let entry = this.textures.get(packet.id);
    const rowsRequired = Math.ceil(packet.count / this.textureWidth);
    const grow = !entry || entry.rows < rowsRequired;
    if (grow) {
      let rows = Math.max(1, entry?.rows ?? 1);
      while (rows < rowsRequired) rows *= 2;
      rows = Math.min(rows, this.maxTextureSize);
      const texture = gl.createTexture();
      if (!texture) throw new Error('Line position texture allocation failed');
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RG32F, this.textureWidth, rows);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      if (entry) gl.deleteTexture(entry.texture);
      entry = {texture, rows, revision: -1, count: 0}; this.textures.set(packet.id, entry);
    }
    if (entry!.revision === packet.revision) return entry!;
    const incremental = !grow && packet.previousRevision === entry!.revision && packet.updateFrom !== undefined && Number.isSafeInteger(packet.updateFrom) && packet.updateFrom >= 0 && packet.updateFrom <= entry!.count && packet.count >= entry!.count;
    const first = incremental ? packet.updateFrom! : 0;
    gl.bindTexture(gl.TEXTURE_2D, entry!.texture);
    const names = [gl.UNPACK_ALIGNMENT, gl.UNPACK_ROW_LENGTH, gl.UNPACK_SKIP_PIXELS, gl.UNPACK_SKIP_ROWS, gl.UNPACK_FLIP_Y_WEBGL, gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL];
    const previous = names.map(name => gl.getParameter(name));
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1); gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0); gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0); gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
    try {
      let index = first;
      while (index < packet.count) {
        const column = index % this.textureWidth, remaining = packet.count - index;
        const rows = column === 0 ? Math.floor(remaining / this.textureWidth) : 0;
        const count = rows > 0 ? rows * this.textureWidth : Math.min(remaining, this.textureWidth - column);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, column, Math.floor(index / this.textureWidth), rows > 0 ? this.textureWidth : count, rows > 0 ? rows : 1, gl.RG, gl.FLOAT, packet.positions.subarray(index * 2, (index + count) * 2));
        index += count;
      }
    } finally {for (let i = 0; i < names.length; i++) gl.pixelStorei(names[i]!, previous[i]);}
    entry!.revision = packet.revision; entry!.count = packet.count;
    this.stats.uploads++; this.stats.uploadedBytes += (packet.count - first) * 8;
    return entry!;
  }

  private initialize(): void {
    const gl = this.gl, shaders: WebGLShader[] = [];
    this.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    this.textureWidth = 2 ** Math.floor(Math.log2(Math.min(2048, this.maxTextureSize)));
    const program = gl.createProgram();
    if (!program) throw new Error('Texture line program allocation failed');
    try {
      for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, lineStripShaderSources.fragment]] as const) {
        const shader = gl.createShader(type); if (!shader) throw new Error('Texture line shader allocation failed');
        shaders.push(shader); gl.shaderSource(shader, source); gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'Texture line shader compilation failed');
        gl.attachShader(program, shader);
      }
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'Texture line shader linking failed');
      this.vao = gl.createVertexArray() ?? undefined;
      if (!this.vao) throw new Error('Texture line vertex-array allocation failed');
      this.program = program;
      for (const name of ['domain', 'size', 'width', 'color', 'plotOrigin', 'positions', 'textureMask', 'textureShift', 'first', 'count']) this.uniforms[name] = gl.getUniformLocation(program, `u_${name}`);
    } catch (error) {
      if (this.vao) gl.deleteVertexArray(this.vao); this.vao = undefined;
      gl.deleteProgram(program); throw error;
    } finally {for (const shader of shaders) gl.deleteShader(shader);}
  }
}
