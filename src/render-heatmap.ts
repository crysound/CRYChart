import type {Rect} from './contracts.js';
import {containedRasterClip, requireRasterTarget, type GpuClipPolicy, type RasterTarget} from './raster-clip.js';

export interface HeatmapRange {start: number; end: number;}
export interface HeatmapOffset {x: number; y: number;}
export interface DrawPacketHeatmap {
  id: number;
  /** Increment after modifying intensity values in place. */
  revision: number;
  /** Physical row-major storage. Row zero is the lower data row. */
  values: Float32Array;
  columns: number;
  rows: number;
  /** Grid edges as fractions of the plot: [x0, x1, y0, y1]. Reversed axes are supported. */
  extent: readonly [number, number, number, number];
  /** CSS data-pane clip, used by the explicit contained GPU policy. */
  clipRect?: Rect;
  intensityRange: HeatmapRange;
  /** Consecutive RGBA bytes sampled across intensityRange. Treat as immutable between revisions. */
  palette: Uint8Array;
  paletteRevision?: number;
  /** Exact scalar breakpoints for piecewise palettes, avoiding sampled threshold drift. */
  paletteStops?: Float32Array;
  paletteFilter?: 'nearest' | 'linear';
  intensityInterpolation?: 'disabled' | 'bilinear';
  /** Actual XY wireframe style. Width is in CSS pixels; values/palette textures stay unchanged. */
  wireframe?: {thickness: number; color: readonly [number, number, number, number]};
  /** Logical cell (0, 0) starts here in the physical ring; no CPU rotation is needed. */
  scrollOffset?: HeatmapOffset;
  update?:{x:number;y:number;width:number;height:number;previousRevision:number};
  /** Polar projection in plot fractions. Angles use radians; direction is 1 or -1. */
  polar?: {angleOrigin:number;direction:1|-1;innerRadius:number;outerRadius:number;radiusFraction?:number;nodeSampling?:boolean};
}
export type HeatmapPacket = DrawPacketHeatmap;
export interface HeatmapRenderOptions {clear?: boolean; rasterTarget?: RasterTarget;}
export interface NormalizedRGBA {r: number; g: number; b: number; a?: number;}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const wrap = (value: number, size: number) => ((value % size) + size) % size;

/** Palette sampling is performed only when style or range changes, never once per grid cell. */
export function buildHeatmapPalette(sample: (value: number) => NormalizedRGBA, min: number, max: number, size = 1024): Uint8Array {
  if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(max - min)) throw new RangeError('Heatmap palette range must be finite');
  if (!Number.isSafeInteger(size) || size < 2 || size > 65536) throw new RangeError('Heatmap palette size must be between 2 and 65536');
  const result = new Uint8Array(size * 4);
  for (let i = 0; i < size; i++) {
    const color = sample(min + (max - min) * i / (size - 1));
    const channels = [color.r, color.g, color.b, color.a ?? 1];
    if (!channels.every(Number.isFinite)) throw new RangeError('Heatmap palette channels must be finite normalized values');
    for (let channel = 0; channel < 4; channel++) result[i * 4 + channel] = Math.round(clamp01(channels[channel]) * 255);
  }
  return result;
}

/** CPU equivalent of the intensity normalization used by the fragment shader. */
export function normalizeHeatmapValue(value: number, range: HeatmapRange): number {
  if (!Number.isFinite(range.start) || !Number.isFinite(range.end)) throw new RangeError('Heatmap range must be finite');
  if (!Number.isFinite(value)) return NaN;
  if (range.start === range.end) return .5;
  const scale = Math.max(Math.abs(range.start), Math.abs(range.end), 1e-30);
  return clamp01((value / scale - range.start / scale) / (range.end / scale - range.start / scale));
}

/** Logical coordinates resolve to physical ring storage in the same order as the shader. */
export function heatmapTextureIndex(column: number, row: number, columns: number, rows: number, offset: HeatmapOffset = {x: 0, y: 0}): number {
  if (![column, row, columns, rows, offset.x, offset.y].every(Number.isSafeInteger) || columns < 1 || rows < 1 || column < 0 || column >= columns || row < 0 || row >= rows) throw new RangeError('Heatmap cell coordinates must address an existing cell');
  return wrap(row + offset.y, rows) * columns + wrap(column + offset.x, columns);
}

/** Coordinates address cell edges; integer + 0.5 is the center of each sample. */
export function sampleHeatmapIntensity(values:Float32Array,columns:number,rows:number,column:number,row:number,interpolation:'disabled'|'bilinear'='disabled',offset:HeatmapOffset={x:0,y:0},wrapColumns=false):number {
  if(!Number.isFinite(column)||!Number.isFinite(row)||column<0||column>=columns||row<0||row>=rows)return NaN;
  const sample=(x:number,y:number)=>values[wrap(Math.max(0,Math.min(rows-1,y))+offset.y,rows)*columns+wrap((wrapColumns?x:Math.max(0,Math.min(columns-1,x)))+offset.x,columns)]!;
  if(interpolation==='disabled')return sample(Math.floor(column),Math.floor(row));
  const x=Math.floor(column-.5),y=Math.floor(row-.5),tx=column-.5-x,ty=row-.5-y;
  let total=0;
  for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){const weight=(dx?tx:1-tx)*(dy?ty:1-ty);if(weight===0)continue;const value=sample(x+dx,y+dy);if(!Number.isFinite(value))return NaN;total+=value*weight;}
  return total;
}

/** Polar nodes span rings, not rectangular cells. The final ring is an interpolation endpoint. */
export function samplePolarHeatmapIntensity(values:Float32Array,columns:number,rows:number,column:number,radius:number,firstRadius:number,lastRadius:number,interpolation:'disabled'|'bilinear'='disabled'):number {
  if(![column,radius,firstRadius,lastRadius].every(Number.isFinite)||columns<1||rows<1||radius<0||radius>Math.max(firstRadius,lastRadius))return NaN;
  const low=Math.min(firstRadius,lastRadius),span=lastRadius-firstRadius,fan=radius<low||span===0,fanRow=firstRadius<=lastRadius?0:rows-1;
  const row=fan?fanRow:(radius-firstRadius)/span*(rows-1),x=wrap(column,columns);
  const sample=(c:number,r:number)=>values[Math.max(0,Math.min(rows-1,r))*columns+wrap(c,columns)]!;
  if(interpolation==='disabled')return sample(fan?0:Math.floor(x),Math.floor(row));
  const baseX=Math.floor(x),baseY=Math.floor(row),tx=x-baseX,ty=row-baseY;let total=0;
  for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){
    const weight=(dx?tx:1-tx)*(dy?ty:1-ty);if(weight===0)continue;
    const value=sample(baseX+dx,baseY+dy);if(!Number.isFinite(value))return NaN;total+=value*weight;
  }
  if(fan){const center=sample(0,fanRow);if(!Number.isFinite(center))return NaN;const amount=low>0?radius/low:0;total=center+(total-center)*amount;}
  return total;
}

const vertexSource = `#version 300 es
precision highp float;
precision highp int;
uniform vec4 u_extent;
out vec2 v_uv;
const vec2 corners[6] = vec2[6](vec2(0.,0.),vec2(1.,0.),vec2(0.,1.),vec2(0.,1.),vec2(1.,0.),vec2(1.,1.));
void main() {
  v_uv = corners[gl_VertexID];
  vec2 position = vec2(mix(u_extent.x,u_extent.y,v_uv.x),mix(u_extent.z,u_extent.w,v_uv.y));
  gl_Position = vec4(position*2.-1.,0.,1.);
}`;

const fragmentSource = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp usampler2D;
uniform usampler2D u_values;
uniform sampler2D u_palette;
uniform sampler2D u_stops;
uniform bool u_exactPalette;
uniform bool u_paletteLinear;
uniform int u_stopCount;
uniform ivec2 u_dimensions;
uniform ivec2 u_offset;
uniform vec3 u_range;
uniform float u_paletteSize;
uniform bool u_bilinear;
uniform float u_wireframeWidth;
uniform vec4 u_wireframeColor;
uniform bool u_polar;
uniform bool u_polarNodeSampling;
uniform vec4 u_polarCoordinates;
uniform vec2 u_polarScale;
in vec2 v_uv;
out vec4 color;
bool readIntensity(ivec2 cell,out float value){
  cell.y=clamp(cell.y,0,u_dimensions.y-1);
  cell.x=u_polar?(cell.x%u_dimensions.x+u_dimensions.x)%u_dimensions.x:clamp(cell.x,0,u_dimensions.x-1);
  cell = (cell + u_offset) % u_dimensions;
  uint bits = texelFetch(u_values,cell,0).r;
  // Test the stored IEEE-754 bits before any floating operation. Some drivers canonicalize
  // NaN during float-texture reads, which can otherwise turn a missing cell into zero.
  if ((bits & 0x7f800000u) == 0x7f800000u)return false;
  value=uintBitsToFloat(bits);return true;
}
void main() {
  vec2 uv=v_uv;vec2 nodePosition=vec2(0.);bool nodeFan=false;int nodeFanRow=0;float nodeFanAmount=0.;
  if(u_polar){
    vec2 position=(v_uv-.5)*u_polarScale;float radius=length(position);
    float angle=atan(position.y,position.x);
    float angular=mod((angle-u_polarCoordinates.x)*u_polarCoordinates.y,6.28318530718)/6.28318530718;
    if(u_polarNodeSampling){
      float first=u_polarCoordinates.z,last=u_polarCoordinates.w,low=min(first,last),span=last-first;
      if(radius>1.||radius>max(first,last))discard;
      nodeFan=radius<low||span==0.;nodeFanRow=first<=last?0:u_dimensions.y-1;
      nodeFanAmount=low>0.?radius/low:0.;
      float row=nodeFan?float(nodeFanRow):(radius-first)/span*float(u_dimensions.y-1);
      nodePosition=vec2(angular*float(u_dimensions.x),row);
    }else{
      float radial=(radius-u_polarCoordinates.z)/(u_polarCoordinates.w-u_polarCoordinates.z);
      if(radius>1.||radial<0.||radial>=1.)discard;
      uv=vec2(angular,radial);
    }
  }
  float value=0.;
  if(u_polar&&u_polarNodeSampling){
    if(u_bilinear){
      ivec2 base=ivec2(floor(nodePosition));vec2 fraction=fract(nodePosition);
      for(int y=0;y<2;y++)for(int x=0;x<2;x++){float weight=(x==0?1.-fraction.x:fraction.x)*(y==0?1.-fraction.y:fraction.y);if(weight<=0.)continue;float sampleValue=0.;if(!readIntensity(base+ivec2(x,y),sampleValue))discard;value+=sampleValue*weight;}
      if(nodeFan){float center=0.;if(!readIntensity(ivec2(0,nodeFanRow),center))discard;value=mix(center,value,nodeFanAmount);}
    }else if(!readIntensity(nodeFan?ivec2(0,nodeFanRow):ivec2(floor(nodePosition)),value))discard;
  }else if(u_bilinear){
    vec2 position=uv*vec2(u_dimensions)-.5;ivec2 base=ivec2(floor(position));vec2 fraction=fract(position);
    for(int y=0;y<2;y++)for(int x=0;x<2;x++){float weight=(x==0?1.-fraction.x:fraction.x)*(y==0?1.-fraction.y:fraction.y);if(weight<=0.)continue;float sampleValue=0.;if(!readIntensity(base+ivec2(x,y),sampleValue))discard;value+=sampleValue*weight;}
  }else if(!readIntensity(ivec2(floor(uv*vec2(u_dimensions))),value))discard;
  if(u_exactPalette){
    int low=0,high=u_stopCount;
    for(int i=0;i<16;i++){if(low>=high)break;int mid=(low+high)/2;if(value<texelFetch(u_stops,ivec2(mid,0),0).r)high=mid;else low=mid+1;}
    int first=max(0,low-1),last=min(u_stopCount-1,low);color=texelFetch(u_palette,ivec2(first,0),0);
    if(u_paletteLinear&&first!=last){float a=texelFetch(u_stops,ivec2(first,0),0).r/u_range.z,b=texelFetch(u_stops,ivec2(last,0),0).r/u_range.z;float t=b==a?1.:clamp((value/u_range.z-a)/(b-a),0.,1.);color=mix(color,texelFetch(u_palette,ivec2(last,0),0),t);}
  }else{
    float t = u_range.y == 0. ? .5 : clamp((value/u_range.z-u_range.x)/u_range.y,0.,1.);
    float coordinate = (.5+t*(u_paletteSize-1.))/u_paletteSize;
    color = texture(u_palette,vec2(coordinate,.5));
  }
  if(!u_polar && u_wireframeWidth > 0. && u_wireframeColor.a > 0.){
    // Distance to each logical cell edge in device pixels. Derivatives also
    // cover subpixel cells without expanding one million CPU line segments.
    vec2 cell=uv*vec2(u_dimensions), period=max(fwidth(cell),vec2(1e-6));
    vec2 distance=min(fract(cell),1.-fract(cell))/period;
    vec2 coverage=1.-smoothstep(vec2(max(0.,u_wireframeWidth*.5-.5)),vec2(u_wireframeWidth*.5+.5),distance);
    vec2 edgeAlpha=coverage*u_wireframeColor.a;
    float alpha=1.-(1.-edgeAlpha.x)*(1.-edgeAlpha.y);
    float combined=alpha+color.a*(1.-alpha);
    color=vec4(combined>0.?(u_wireframeColor.rgb*alpha+color.rgb*color.a*(1.-alpha))/combined:vec3(0.),combined);
  }
  if (color.a == 0.) discard;
}`;

interface TextureEntry {
  intensity: WebGLTexture;
  palette: WebGLTexture;
  columns: number;
  rows: number;
  values?: Float32Array;
  revision?: number;
  paletteValues?: Uint8Array;
  paletteRevision?: number;
  paletteSize: number;
  paletteFilter?: 'nearest' | 'linear';
  stops?:WebGLTexture;
  stopsValues?:Float32Array;
}

/** One quad per grid. R32UI preserves float bit patterns, including NaN and both infinities. */
export class DataRendererHeatmap {
  readonly stats = {frames: 0, uploads: 0, textureUploads: 0, paletteUploads: 0, uploadedBytes: 0, drawCalls: 0, cells: 0, renderTimeMs: 0, cachedTextures: 0, cacheBytes: 0, contextRestores: 0};
  private readonly entries = new Map<number, TextureEntry>();
  private uniforms: Record<string, WebGLUniformLocation | null> = {};
  private program?: WebGLProgram;
  private vao?: WebGLVertexArrayObject;
  private maxTextureSize = 0;
  private lost = false;
  private disposed = false;

  constructor(readonly gl: WebGL2RenderingContext, readonly canvas: HTMLCanvasElement, readonly options: {clipPolicy?: GpuClipPolicy} = {}) {
    this.initialize();
    canvas.addEventListener('webglcontextlost', this.contextLost);
    canvas.addEventListener('webglcontextrestored', this.contextRestored);
  }

  /** Undefined until data has reached the current, live WebGL context. */
  getUploadedRevision(id:number):number|undefined {
    return this.lost||this.disposed||this.gl.isContextLost?.()?undefined:this.entries.get(id)?.revision;
  }

  private contextLost = (event: Event): void => {event.preventDefault(); this.lost = true;};
  private contextRestored = (): void => {
    if (this.disposed) return;
    this.entries.clear(); this.program = undefined; this.vao = undefined;
    this.stats.cachedTextures = 0; this.stats.cacheBytes = 0;
    this.initialize(); this.lost = false; this.stats.contextRestores++;
    this.canvas.dispatchEvent(new Event('crychartcontextrestored'));
  };

  private initialize(): void {
    const gl = this.gl, shaders: WebGLShader[] = [];
    let program: WebGLProgram | null = null, vao: WebGLVertexArrayObject | null = null;
    try {
      const shader = (type: number, source: string) => {
        const result = gl.createShader(type); if (!result) throw new Error('Unable to allocate a heatmap shader'); shaders.push(result);
        gl.shaderSource(result, source); gl.compileShader(result);
        if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(result) ?? 'Heatmap shader compilation failed');
        return result;
      };
      const vertex = shader(gl.VERTEX_SHADER, vertexSource), fragment = shader(gl.FRAGMENT_SHADER, fragmentSource);
      program = gl.createProgram(); if (!program) throw new Error('Unable to allocate the heatmap program');
      gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'Heatmap shader linking failed');
      vao = gl.createVertexArray(); if (!vao) throw new Error('Unable to allocate the heatmap vertex array');
      this.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
      this.uniforms = Object.fromEntries(['extent', 'values', 'palette','stops','exactPalette','paletteLinear','stopCount', 'dimensions', 'offset', 'range', 'paletteSize','bilinear','wireframeWidth','wireframeColor','polar','polarNodeSampling','polarCoordinates','polarScale'].map(name => [name, gl.getUniformLocation(program!, `u_${name}`)]));
      this.program = program; this.vao = vao;
    } catch (error) {
      if (program) gl.deleteProgram(program); if (vao) gl.deleteVertexArray(vao); throw error;
    } finally {shaders.forEach(shader => gl.deleteShader(shader));}
  }

  render(packets: readonly DrawPacketHeatmap[], rect: Rect, dpr: number, options: HeatmapRenderOptions = {}): void {
    if (this.disposed) throw new Error('DataRendererHeatmap is disposed');
    const started = performance.now(); this.stats.frames++; this.stats.drawCalls = 0; this.stats.cells = 0;
    if (this.lost || this.gl.isContextLost()) {this.stats.renderTimeMs = performance.now() - started; return;}
    if (![rect.left, rect.top, rect.width, rect.height, dpr].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0 || dpr <= 0) throw new RangeError('Heatmap viewport and DPR must be positive and finite');
    // Validate before changing shared GL state or allocating any texture.
    packets.forEach(packet => this.validate(packet));
    const target = this.options.clipPolicy === 'contained' ? requireRasterTarget(options.rasterTarget) : undefined;
    const clips = target ? packets.map(packet => containedRasterClip(rect, packet.clipRect, target)) : undefined;
    const gl = this.gl;
    if (target && gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING) !== target.framebuffer) throw new Error('Raster target does not match the destination framebuffer');
    const x = target?.viewport.x ?? Math.round(rect.left * dpr), y = target?.viewport.y ?? Math.round(this.canvas.height - (rect.top + rect.height) * dpr);
    const width = target?.viewport.width ?? Math.max(1, Math.round(rect.width * dpr)), height = target?.viewport.height ?? Math.max(1, Math.round(rect.height * dpr));
    gl.bindVertexArray(this.vao!); gl.disable(gl.SCISSOR_TEST); gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.disable(gl.STENCIL_TEST);
    gl.colorMask(true, true, true, true); gl.depthMask(false);
    if (options.clear !== false) {gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);}
    gl.viewport(x, y, width, height); gl.scissor(x, y, width, height); gl.enable(gl.SCISSOR_TEST);
    gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.program!); gl.uniform1i(this.uniforms.values, 0); gl.uniform1i(this.uniforms.palette, 1);gl.uniform1i(this.uniforms.stops,2);
    // All rows have four-byte components, so default alignment is sufficient for both formats.
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4); gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0); gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0); gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
    const live = new Set<number>();
    try {
      for (let index = 0; index < packets.length; index++) {
        const packet = packets[index]!;
        live.add(packet.id);
        if (target) {
          const clip = clips![index];
          if (!clip) continue;
          gl.scissor(clip.x, clip.y, clip.width, clip.height);
        }
        if (packet.extent[0] === packet.extent[1] || packet.extent[2] === packet.extent[3]) continue;
        const entry = this.upload(packet), offset = packet.scrollOffset ?? {x: 0, y: 0};
        const range = packet.intensityRange, scale = Math.max(Math.abs(range.start), Math.abs(range.end), 1e-30);
        gl.uniform4f(this.uniforms.extent, ...packet.extent);
        gl.uniform2i(this.uniforms.dimensions, packet.columns, packet.rows);
        gl.uniform2i(this.uniforms.offset, wrap(offset.x, packet.columns), wrap(offset.y, packet.rows));
        gl.uniform3f(this.uniforms.range, range.start / scale, range.end / scale - range.start / scale, scale);
        gl.uniform1f(this.uniforms.paletteSize, entry.paletteSize);
        gl.uniform1i(this.uniforms.exactPalette,packet.paletteStops?1:0);gl.uniform1i(this.uniforms.stopCount,packet.paletteStops?.length??0);gl.uniform1i(this.uniforms.paletteLinear,packet.paletteFilter!=='nearest'?1:0);
        gl.uniform1i(this.uniforms.bilinear,packet.intensityInterpolation==='bilinear'?1:0);
        gl.uniform1f(this.uniforms.wireframeWidth,(packet.wireframe?.thickness??0)*dpr);
        gl.uniform4f(this.uniforms.wireframeColor,...(packet.wireframe?.color??[0,0,0,0] as const));
        gl.uniform1i(this.uniforms.polar,packet.polar?1:0);
        gl.uniform1i(this.uniforms.polarNodeSampling,packet.polar?.nodeSampling?1:0);
        if(packet.polar){const p=packet.polar,radius=Math.min(width,height)*(p.radiusFraction??.45);gl.uniform4f(this.uniforms.polarCoordinates,p.angleOrigin,p.direction,p.innerRadius,p.outerRadius);gl.uniform2f(this.uniforms.polarScale,width/radius,height/radius);}
        gl.drawArrays(gl.TRIANGLES, 0, 6); this.stats.drawCalls++; this.stats.cells += packet.columns * packet.rows;
      }
      for (const [id, entry] of this.entries) if (!live.has(id)) {this.deleteEntry(entry); this.entries.delete(id);}
    } finally {
      gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,null);gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, null); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, null);
      gl.bindVertexArray(null); gl.depthMask(true); gl.disable(gl.SCISSOR_TEST);
      // The shared canvas uses premultiplied alpha; alpha itself is never multiplied twice.
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      this.stats.cachedTextures = [...this.entries.values()].reduce((sum,entry)=>sum+2+(entry.stops?1:0),0);
      this.stats.cacheBytes = [...this.entries.values()].reduce((total, entry) => total + entry.columns * entry.rows * 4 + entry.paletteSize * 4+(entry.stopsValues?.byteLength??0), 0);
      this.stats.renderTimeMs = performance.now() - started;
    }
  }

  private validate(packet: DrawPacketHeatmap): void {
    if (!Number.isFinite(packet.id) || !Number.isFinite(packet.revision) || packet.paletteRevision !== undefined && !Number.isFinite(packet.paletteRevision)) throw new RangeError('Heatmap packet identity and revisions must be finite');
    if (!Number.isSafeInteger(packet.columns) || !Number.isSafeInteger(packet.rows) || packet.columns < 1 || packet.rows < 1 || packet.columns > this.maxTextureSize || packet.rows > this.maxTextureSize) throw new RangeError(`Heatmap dimensions must be between 1 and ${this.maxTextureSize}`);
    if (!(packet.values instanceof Float32Array) || packet.values.length !== packet.columns * packet.rows) throw new RangeError('Heatmap dimensions do not match intensity storage');
    if (packet.extent.length !== 4 || !packet.extent.every(Number.isFinite)) throw new RangeError('Heatmap extent must contain four finite fractions');
    if (![packet.intensityRange.start, packet.intensityRange.end].every(value => Number.isFinite(value) && Math.abs(value) <= 3.4028234663852886e38)) throw new RangeError('Heatmap intensity range must fit finite float32 values');
    if (!(packet.palette instanceof Uint8Array) || packet.palette.length < 8 || packet.palette.length % 4 || packet.palette.length > this.maxTextureSize * 4) throw new RangeError('Heatmap palette must contain between 2 and MAX_TEXTURE_SIZE RGBA entries');
    if(packet.paletteStops&&(!(packet.paletteStops instanceof Float32Array)||packet.paletteStops.length*4!==packet.palette.length||!packet.paletteStops.every((v,i,values)=>Number.isFinite(v)&&(i===0||v>=values[i-1]!))))throw new RangeError('Heatmap palette stops must be finite, sorted, and match colors');
    if (packet.paletteFilter !== undefined && packet.paletteFilter !== 'linear' && packet.paletteFilter !== 'nearest') throw new TypeError('Heatmap palette filter must be nearest or linear');
    if(packet.intensityInterpolation!==undefined&&packet.intensityInterpolation!=='disabled'&&packet.intensityInterpolation!=='bilinear')throw new TypeError('Heatmap intensity interpolation must be disabled or bilinear');
    if(packet.wireframe&&(!Number.isFinite(packet.wireframe.thickness)||packet.wireframe.thickness<0||packet.wireframe.color.length!==4||!packet.wireframe.color.every(value=>Number.isFinite(value)&&value>=0&&value<=1)))throw new RangeError('Heatmap wireframe requires nonnegative CSS width and normalized RGBA');
    if (packet.scrollOffset && ![packet.scrollOffset.x, packet.scrollOffset.y].every(Number.isSafeInteger)) throw new RangeError('Heatmap scroll offsets must be integer cells');
    if(packet.polar){const {nodeSampling,...coordinates}=packet.polar;if(!Object.values(coordinates).every(Number.isFinite)||![1,-1].includes(packet.polar.direction)||(!nodeSampling&&packet.polar.innerRadius===packet.polar.outerRadius)||nodeSampling!==undefined&&typeof nodeSampling!=='boolean')throw new RangeError('Polar heatmap projection must have finite radial coordinates, a valid direction and sampling mode');}
    if(packet.update){const u=packet.update;if(![u.x,u.y,u.width,u.height,u.previousRevision].every(Number.isSafeInteger)||u.x<0||u.y<0||u.width<1||u.height<1||u.x+u.width>packet.columns||u.y+u.height>packet.rows)throw new RangeError('Heatmap upload region must address existing cells');}
  }

  private textureParameters(filter: number): void {
    const gl = this.gl;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  private upload(packet: DrawPacketHeatmap): TextureEntry {
    const gl = this.gl;
    let entry = this.entries.get(packet.id);
    if (!entry) {
      const intensity = gl.createTexture(), palette = gl.createTexture();
      if (!intensity || !palette) {if (intensity) gl.deleteTexture(intensity); if (palette) gl.deleteTexture(palette); throw new Error('Unable to allocate heatmap textures');}
      entry = {intensity, palette, columns: 0, rows: 0, paletteSize: 0}; this.entries.set(packet.id, entry);
    }
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, entry.intensity);
    const resized = entry.columns !== packet.columns || entry.rows !== packet.rows;
    if (resized || entry.revision !== packet.revision || entry.values !== packet.values) {
      const bits = new Uint32Array(packet.values.buffer, packet.values.byteOffset, packet.values.length);
      const region=!resized&&entry.values===packet.values&&entry.revision===packet.update?.previousRevision?packet.update:undefined;
      if (resized) {gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32UI, packet.columns, packet.rows, 0, gl.RED_INTEGER, gl.UNSIGNED_INT, bits); this.textureParameters(gl.NEAREST);}
      else if(region){
        gl.pixelStorei(gl.UNPACK_ROW_LENGTH,packet.columns);gl.pixelStorei(gl.UNPACK_SKIP_PIXELS,region.x);gl.pixelStorei(gl.UNPACK_SKIP_ROWS,region.y);
        try{gl.texSubImage2D(gl.TEXTURE_2D,0,region.x,region.y,region.width,region.height,gl.RED_INTEGER,gl.UNSIGNED_INT,bits);}finally{gl.pixelStorei(gl.UNPACK_ROW_LENGTH,0);gl.pixelStorei(gl.UNPACK_SKIP_PIXELS,0);gl.pixelStorei(gl.UNPACK_SKIP_ROWS,0);}
      }
      else gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, packet.columns, packet.rows, gl.RED_INTEGER, gl.UNSIGNED_INT, bits);
      entry.columns = packet.columns; entry.rows = packet.rows; entry.values = packet.values; entry.revision = packet.revision;
      this.stats.uploads++; this.stats.textureUploads++; this.stats.uploadedBytes += region?region.width*region.height*4:packet.values.byteLength;
    }
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, entry.palette);
    const paletteSize = packet.palette.length / 4, filter = packet.paletteFilter ?? 'linear';
    if (entry.paletteSize !== paletteSize || entry.paletteValues !== packet.palette || entry.paletteRevision !== packet.paletteRevision) {
      if (entry.paletteSize !== paletteSize) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, paletteSize, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, packet.palette);
      else gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, paletteSize, 1, gl.RGBA, gl.UNSIGNED_BYTE, packet.palette);
      entry.paletteSize = paletteSize; entry.paletteValues = packet.palette; entry.paletteRevision = packet.paletteRevision;
      this.stats.paletteUploads++; this.stats.textureUploads++; this.stats.uploadedBytes += packet.palette.byteLength;
    }
    if (entry.paletteFilter !== filter) {this.textureParameters(filter === 'linear' ? gl.LINEAR : gl.NEAREST); entry.paletteFilter = filter;}
    gl.activeTexture(gl.TEXTURE2);
    if(packet.paletteStops){
      if(!entry.stops){const texture=gl.createTexture();if(!texture)throw new Error('Unable to allocate palette stops');entry.stops=texture;}
      gl.bindTexture(gl.TEXTURE_2D,entry.stops);
      if(entry.stopsValues!==packet.paletteStops){gl.texImage2D(gl.TEXTURE_2D,0,gl.R32F,packet.paletteStops.length,1,0,gl.RED,gl.FLOAT,packet.paletteStops);this.textureParameters(gl.NEAREST);entry.stopsValues=packet.paletteStops;this.stats.textureUploads++;this.stats.uploadedBytes+=packet.paletteStops.byteLength;}
    }else{if(entry.stops){gl.deleteTexture(entry.stops);entry.stops=undefined;entry.stopsValues=undefined;}gl.bindTexture(gl.TEXTURE_2D,null);}
    return entry;
  }

  private deleteEntry(entry: TextureEntry): void {this.gl.deleteTexture(entry.intensity); this.gl.deleteTexture(entry.palette);if(entry.stops)this.gl.deleteTexture(entry.stops);}

  dispose(): void {
    if (this.disposed) return; this.disposed = true;
    this.entries.forEach(entry => this.deleteEntry(entry)); this.entries.clear();
    this.gl.bindVertexArray(null); this.gl.useProgram(null);
    if (this.vao) this.gl.deleteVertexArray(this.vao); if (this.program) this.gl.deleteProgram(this.program);
    this.vao = undefined; this.program = undefined; this.stats.cachedTextures = 0; this.stats.cacheBytes = 0;
    this.canvas.removeEventListener('webglcontextlost', this.contextLost); this.canvas.removeEventListener('webglcontextrestored', this.contextRestored);
  }
}
