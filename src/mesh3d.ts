import {Color, ColorRGBA, SolidFill, SolidLine, PalettedFill, emptyLine, resolveValue, assertColorShadingStyle, type ColorShadingStyle, type FillStyle, type LineStyle, type ValueOrMutator} from './core/styles.js';
import {DataSetXY} from './core/data.js';
import {EventHub, type EventToken} from './core/events.js';
import type {RenderHost, Interval} from './contracts.js';
import type {DrawPacket3D} from './render3d.js';
import {worldToNormalized3D, type Vec3} from './world-camera.js';

export type Normalize3D = (value: number, dimension: 0 | 1 | 2) => number;
export interface MeshOptions3D {axisX?: any; axisY?: any; axisZ?: any; fillStyle?: FillStyle; wireframeStyle?: LineStyle; lighting?: boolean; [key: string]: unknown;}
export interface MeshGeometry3D {positions: ArrayLike<number>; indices?: ArrayLike<number>; colors?: ArrayLike<number>; values?: ArrayLike<number>;}
export interface MeshVertex3D {x: number; y: number; z: number; value?: number; color?: Color;}
export interface ModelGeometry3D {vertices: ArrayLike<number>; indices?: ArrayLike<number>; normals?: ArrayLike<number>;}
export type CullMode3D = 'disabled' | 'cull-back' | 'cull-front';
type DirtyRange = {start: number; count: number};
let nextId3D = 30_000_000;
const integer = (value: number, minimum = 0): number => {if (!Number.isSafeInteger(value) || value < minimum) throw new RangeError(`Expected an integer at least ${minimum}`); return value;};
const rgba = (color: Color): [number, number, number, number] => [color.r, color.g, color.b, color.a];
const meshFillColor = (fill: FillStyle, fallback: Color): Color => fill.kind === 'empty' ? ColorRGBA(0, 0, 0, 0) : fill.getColor?.() ?? fallback;
const finiteVertex = (values: ArrayLike<number>, index: number) => Number.isFinite(values[index * 3]) && Number.isFinite(values[index * 3 + 1]) && Number.isFinite(values[index * 3 + 2]);
function mergedRanges(ranges: readonly DirtyRange[], width = 1): DirtyRange[] {
  const sorted = ranges.filter(range => range.count > 0).map(range => ({start: range.start, count: range.count})).sort((a, b) => a.start - b.start), out: DirtyRange[] = [];
  for (const range of sorted) {const previous = out.at(-1); if (previous && range.start <= previous.start + previous.count) previous.count = Math.max(previous.start + previous.count, range.start + range.count) - previous.start; else out.push({...range});}
  return out.map(range => ({start: range.start * width, count: range.count * width}));
}

/** Area-weighted vertex normals. Invalid and degenerate triangles contribute nothing. */
export function meshNormals(positions: Float32Array, indices: Uint32Array): Float32Array {
  const normals = new Float32Array(positions.length);
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const a = indices[i], b = indices[i + 1], c = indices[i + 2]; if (!finiteVertex(positions, a) || !finiteVertex(positions, b) || !finiteVertex(positions, c)) continue;
    const ax = positions[b * 3] - positions[a * 3], ay = positions[b * 3 + 1] - positions[a * 3 + 1], az = positions[b * 3 + 2] - positions[a * 3 + 2], bx = positions[c * 3] - positions[a * 3], by = positions[c * 3 + 1] - positions[a * 3 + 1], bz = positions[c * 3 + 2] - positions[a * 3 + 2];
    const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    for (const vertex of [a, b, c]) {normals[vertex * 3] += nx; normals[vertex * 3 + 1] += ny; normals[vertex * 3 + 2] += nz;}
  }
  for (let i = 0; i < normals.length; i += 3) {const length = Math.hypot(normals[i], normals[i + 1], normals[i + 2]); if (length > 1e-20) {normals[i] /= length; normals[i + 1] /= length; normals[i + 2] /= length;} else normals[i + 1] = 1;}
  return normals;
}

export abstract class Series3DBase {
  readonly id = nextId3D++; readonly events = new EventHub(); readonly axisX: any; readonly axisY: any; readonly axisZ: any;
  visible = true; disposed = false; revision = 0; name = ''; lighting = true; fill: FillStyle; wireframe: LineStyle; mouseInteractions = true; cursorEnabled = true;
  protected packetRevision = 0;
  private colorShadingStyle?: ColorShadingStyle;
  private depthTestEnabled = true;
  private backfaceCullingMode: CullMode3D = 'disabled';
  private highlightOnHover = true;
  constructor(readonly chart: RenderHost, options: MeshOptions3D = {}) {
    this.axisX = options.axisX ?? chart.getDefaultAxisX(); this.axisY = options.axisY ?? chart.getDefaultAxisY(); this.axisZ = options.axisZ ?? chart.getDefaultAxisZ?.();
    if (!this.axisZ) throw new Error('3D geometry requires an axis Z');
    this.fill = options.fillStyle ?? new SolidFill({color: ColorRGBA(232, 214, 85)}); this.wireframe = options.wireframeStyle ?? emptyLine; this.lighting = options.lighting ?? true;
  }
  protected assertAlive() {if (this.disposed) throw new Error('3D series is disposed');}
  protected changed(): void {this.assertAlive(); this.revision++; this.chart.invalidate(); this.events.emit('change', this);}
  setName(value: string): this {this.name = String(value); this.chart.invalidate(); return this;} getName(): string {return this.name;}
  setVisible(value: boolean): this {this.visible = Boolean(value); this.chart.invalidate(); return this;} getVisible(): boolean {return this.visible;}
  setFillStyle(value: ValueOrMutator<FillStyle>): this {this.fill = resolveValue(value, this.fill); this.invalidateStyle(); return this;} getFillStyle(): FillStyle {return this.fill;}
  setWireframeStyle(value: ValueOrMutator<LineStyle>): this {this.wireframe = resolveValue(value, this.wireframe); this.invalidateStyle(); return this;} getWireframeStyle(): LineStyle {return this.wireframe;}
  setLighting(value: boolean): this {this.lighting = Boolean(value); this.invalidateStyle(); return this;}
  setColorShadingStyle(value: ColorShadingStyle): this {assertColorShadingStyle(value); this.assertAlive(); this.colorShadingStyle = value; this.invalidateStyle(); return this;}
  getColorShadingStyle(): ColorShadingStyle | undefined {return this.colorShadingStyle;}
  setDepthTestEnabled(value: boolean): this {if (typeof value !== 'boolean') throw new TypeError('Depth test requires a boolean'); this.assertAlive(); this.depthTestEnabled = value; this.invalidateStyle(); return this;}
  getDepthTestEnabled(): boolean {return this.depthTestEnabled;}
  setBackfaceCullingMode(value: CullMode3D): this {if (value !== 'disabled' && value !== 'cull-back' && value !== 'cull-front') throw new TypeError('Unsupported backface culling mode'); this.assertAlive(); this.backfaceCullingMode = value; this.invalidateStyle(); return this;}
  getBackfaceCullingMode(): CullMode3D {return this.backfaceCullingMode;}
  setHighlightOnHover(value: boolean): this {
    if (value !== false) throw new TypeError('Mesh hover highlighting is not implemented; only false is supported');
    this.assertAlive(); this.highlightOnHover = false; this.chart.invalidate(); return this;
  }
  getHighlightOnHover(): boolean {return this.highlightOnHover;}
  protected renderingState(): Pick<DrawPacket3D, 'unshaded' | 'depthTestEnabled' | 'backfaceCullingMode'> {
    return {unshaded: this.colorShadingStyle?.type === 'simple' ? true : undefined, depthTestEnabled: this.depthTestEnabled, backfaceCullingMode: this.backfaceCullingMode};
  }
  setMouseInteractions(value: boolean): this {this.mouseInteractions = Boolean(value); return this;} setMouseInteractionsEnabled(value: boolean): this {return this.setMouseInteractions(value);}
  getAxisX() {return this.axisX;} getAxisY() {return this.axisY;} getAxisZ() {return this.axisZ;}
  getXMin() {return this.bounds('x')?.start;} getXMax() {return this.bounds('x')?.end;}
  getYMin() {return this.bounds('y')?.start;} getYMax() {return this.bounds('y')?.end;}
  getZMin() {return this.bounds('z')?.start;} getZMax() {return this.bounds('z')?.end;}
  setCursorEnabled(value:boolean):this {this.cursorEnabled=Boolean(value);this.chart.invalidate();return this;}
  getCursorEnabled(){return this.cursorEnabled;}
  on(type: string, listener: (...args: any[]) => void): EventToken {return this.events.on(type, listener);} off(token: EventToken): boolean {return this.events.off(token);}
  protected invalidateStyle(): void {this.changed();}
  abstract readonly kind: string;
  abstract getSampleCount(): number;
  abstract bounds(dimension: 'x' | 'y' | 'z'): Interval | undefined;
  abstract getDrawPackets(normalize: Normalize3D, axisKey: string): DrawPacket3D[];
  dispose(): this {if (!this.disposed) {this.disposed = true; this.chart.removeSeries(this); this.events.emit('dispose', this); this.events.clear();} return this;} isDisposed(): boolean {return this.disposed;}
}

/** Indexed geometry retains source coordinates; only renderer packets are normalized. */
export class MeshSeries3D extends Series3DBase {
  readonly kind: string = 'mesh3d';
  protected vertices = new Float64Array(0); protected indices = new Uint32Array(0); protected scalarValues?: Float32Array; protected vertexColors?: Float32Array;
  protected topologyRevision = 0; protected geometryRevision = 0; protected dirty: DirtyRange[] = []; protected styleDirty = true;
  private compiled?: {key: string; revision: number; packet: DrawPacket3D; wire?: DrawPacket3D; packets: DrawPacket3D[]; invalidVertices: number};
  private boundsCache?: {revision: number; values: Array<Interval | undefined>};
  setGeometry(input: MeshGeometry3D): this {
    this.assertAlive(); if (!input?.positions || input.positions.length % 3) throw new RangeError('Mesh positions require complete XYZ vertices');
    const positions = Float64Array.from(input.positions), count = positions.length / 3;
    const indices = input.indices ? Uint32Array.from(input.indices, index => {if (!Number.isSafeInteger(index) || index < 0 || index >= count) throw new RangeError('Mesh index outside vertex range'); return index;}) : Uint32Array.from({length: Math.floor(count / 3) * 3}, (_, index) => index);
    if (indices.length % 3) throw new RangeError('Mesh indices require complete triangles');
    if (input.values && input.values.length !== count || input.colors && input.colors.length !== count * 4) throw new RangeError('Mesh values/colors do not match vertex count');
    const colors = input.colors ? Float32Array.from(input.colors) : undefined; if (colors && !colors.every(value => Number.isFinite(value) && value >= 0 && value <= 1)) throw new RangeError('Mesh colors require normalized finite RGBA');
    this.vertices = positions; this.indices = indices; this.scalarValues = input.values ? Float32Array.from(input.values) : undefined; this.vertexColors = colors; this.topologyRevision++; this.geometryRevision++; this.dirty = [{start: 0, count}]; this.styleDirty = true; this.compiled = undefined; this.changed(); return this;
  }
  setData(input: MeshGeometry3D | readonly MeshVertex3D[]): this {if (!Array.isArray(input)) return this.setGeometry(input as MeshGeometry3D); const rows = input as readonly MeshVertex3D[]; return this.setGeometry({positions: rows.flatMap(row => [row.x, row.y, row.z]), values: rows.map(row => row.value ?? NaN), colors: rows.some(row => row.color) ? rows.flatMap(row => rgba(row.color ?? ColorRGBA(255, 255, 255))) : undefined});}
  getGeometry(): {positions: Float64Array; indices: Uint32Array; values?: Float32Array; colors?: Float32Array} {return {positions: this.vertices.slice(), indices: this.indices.slice(), values: this.scalarValues?.slice(), colors: this.vertexColors?.slice()};}
  invalidateVertexPositions(values: ArrayLike<number>): this {if (values.length !== this.vertices.length) throw new RangeError('Replacement mesh positions have a different length'); this.vertices.set(values); this.markGeometry([{start: 0, count: this.getSampleCount()}]); return this;}
  invalidateValues(values: ArrayLike<number>): this {if (values.length !== this.getSampleCount()) throw new RangeError('Replacement mesh values have a different length'); this.scalarValues = Float32Array.from(values); this.styleDirty = true; this.changed(); return this;}
  invalidateVertexColors(values: ArrayLike<number> | undefined): this {if (values && (values.length !== this.getSampleCount() * 4 || Array.from(values).some(value => !Number.isFinite(value) || value < 0 || value > 1))) throw new RangeError('Replacement colors require normalized RGBA per vertex'); this.vertexColors = values ? Float32Array.from(values) : undefined; this.styleDirty = true; this.changed(); return this;}
  clear(): this {return this.setGeometry({positions: []});}
  getSampleCount(): number {return this.vertices.length / 3;}
  getTriangleCount(): number {return this.indices.length / 3;}
  protected override invalidateStyle(): void {this.styleDirty = true; super.invalidateStyle();}
  protected markGeometry(ranges: DirtyRange[]): void {this.geometryRevision++; this.dirty.push(...ranges); this.changed();}
  protected updateNormals(positions: Float32Array, _previous: Float32Array | undefined, _ranges: readonly DirtyRange[]): {values: Float32Array; ranges?: DirtyRange[]} {return {values: meshNormals(positions, this.indices)};}
  protected colorAt(index: number): Color {
    if (this.vertexColors) return new Color(this.vertexColors[index * 4], this.vertexColors[index * 4 + 1], this.vertexColors[index * 4 + 2], this.vertexColors[index * 4 + 3]);
    if (this.fill instanceof PalettedFill) {const property = this.fill.getLookUpProperty(), value = property === 'x' ? this.vertices[index * 3] : property === 'y' ? this.vertices[index * 3 + 1] : property === 'z' ? this.vertices[index * 3 + 2] : this.scalarValues?.[index] ?? this.vertices[index * 3 + 1]; return this.fill.lut.getColor(value);}
    return meshFillColor(this.fill, ColorRGBA(255, 255, 255));
  }
  protected normalizedVertex(index: number, normalize: Normalize3D): Vec3 {return {x: normalize(this.vertices[index * 3], 0), y: normalize(this.vertices[index * 3 + 1], 1), z: normalize(this.vertices[index * 3 + 2], 2)};}
  bounds(dimension: 'x' | 'y' | 'z'): Interval | undefined {
    if (!this.boundsCache || this.boundsCache.revision !== this.geometryRevision) {const values: Array<Interval | undefined> = []; for (let dim = 0; dim < 3; dim++) {let min = Infinity, max = -Infinity; for (let i = dim; i < this.vertices.length; i += 3) if (Number.isFinite(this.vertices[i])) {min = Math.min(min, this.vertices[i]); max = Math.max(max, this.vertices[i]);} values.push(min === Infinity ? undefined : {start: min, end: max});} this.boundsCache = {revision: this.geometryRevision, values};} return this.boundsCache.values[dimension === 'x' ? 0 : dimension === 'y' ? 1 : 2];
  }
  getDrawPackets(normalize: Normalize3D, axisKey: string): DrawPacket3D[] {
    this.assertAlive(); const count = this.getSampleCount(); if (this.compiled?.revision === this.revision && this.compiled.key === axisKey) return this.compiled.packets;
    const previous = this.compiled, all = !previous || previous.key !== axisKey || previous.packet.count !== count;
    const ranges = all ? [{start: 0, count}] : mergedRanges(this.dirty), positions = all ? new Float32Array(count * 3) : previous.packet.positions, colors = all ? new Float32Array(count * 4) : previous.packet.colors!;
    let invalidVertices = all ? 0 : previous.invalidVertices;
    for (const range of ranges) for (let i = range.start; i < range.start + range.count; i++) {if (!all && !finiteVertex(positions, i)) invalidVertices--; const point = this.normalizedVertex(i, normalize); positions.set([point.x, point.y, point.z], i * 3); if (!finiteVertex(positions, i)) invalidVertices++;}
    const colorRanges = all || this.styleDirty ? [{start: 0, count}] : ranges; for (const range of colorRanges) for (let i = range.start; i < range.start + range.count; i++) colors.set(rgba(this.colorAt(i)), i * 4);
    const normal = ranges.length ? this.updateNormals(positions, all ? undefined : previous?.packet.normals, ranges) : {values: previous?.packet.normals ?? meshNormals(positions, this.indices), ranges: []};
    const packet: DrawPacket3D = {id: this.id, revision: ++this.packetRevision, previousRevision: previous?.packet.revision, count, mode: 'triangles', positions, colors, normals: normal.values, indices: this.indices, indexRevision: this.topologyRevision, allFinite: invalidVertices === 0, lighting: this.lighting, ...this.renderingState(), color: [1, 1, 1, 1], thickness: 0, pointSize: 0, positionUpdateRanges: all ? undefined : mergedRanges(ranges, 3), colorUpdateRanges: all ? undefined : mergedRanges(colorRanges, 4), normalUpdateRanges: all ? undefined : normal.ranges};
    const packets = [packet]; let wire: DrawPacket3D | undefined;
    if (this.wireframe.getThickness() > 0 && meshFillColor(this.wireframe.getFillStyle(), ColorRGBA(0, 0, 0)).a > 0) {
      const edges = new Set<string>(), values: number[] = []; for (let i = 0; i < this.indices.length; i += 3) {const triangle = [this.indices[i], this.indices[i + 1], this.indices[i + 2]]; if (!triangle.every(index => finiteVertex(positions, index))) continue; for (let j = 0; j < 3; j++) {const a = triangle[j], b = triangle[(j + 1) % 3], key = a < b ? `${a}:${b}` : `${b}:${a}`; if (edges.has(key)) continue; edges.add(key); values.push(positions[a * 3], positions[a * 3 + 1], positions[a * 3 + 2], positions[b * 3], positions[b * 3 + 1], positions[b * 3 + 2], NaN, NaN, NaN);}}
      wire = {id: -this.id, revision: packet.revision, count: values.length / 3, mode: 'line', positions: Float32Array.from(values), ...this.renderingState(), color: rgba(meshFillColor(this.wireframe.getFillStyle(), ColorRGBA(0, 0, 0))), thickness: this.wireframe.getThickness(), pointSize: 0}; packets.push(wire);
    }
    this.compiled = {key: axisKey, revision: this.revision, packet, wire, packets, invalidVertices}; this.dirty = []; this.styleDirty = false; return packets;
  }
  override dispose(): this {this.compiled = undefined; this.vertices = new Float64Array(0); this.indices = new Uint32Array(0); this.scalarValues = undefined; this.vertexColors = undefined; return super.dispose();}
}

export interface SurfaceGridOptions3D extends MeshOptions3D {columns?: number; rows?: number; start?: {x: number; z: number}; step?: {x: number; z: number}; transposeXZ?: boolean;}
export type GridPatch3D = {iColumn?: number; iRow?: number; values: readonly ArrayLike<number>[]};
export class SurfaceGrid3D extends MeshSeries3D {
  override readonly kind: string = 'surface-grid3d'; readonly columns: number; readonly rows: number; readonly values: Float32Array; readonly transposeXZ: boolean;
  start: {x: number; z: number}; step: {x: number; z: number};
  private requestedStep:{x:number;z:number};
  private explicitEnd?:{x:number;z:number};
  constructor(chart: RenderHost, options: SurfaceGridOptions3D = {}) {
    super(chart, options); this.transposeXZ = Boolean(options.transposeXZ); this.columns = integer(options.columns ?? 50, 2); this.rows = integer(options.rows ?? 50, 2); this.start = {...(options.start ?? {x: 0, z: 0})}; this.step = {...(options.step ?? {x: 1, z: 1})}; this.requestedStep={...this.step}; this.validateGridTransform(this.start, this.step);
    this.values = new Float32Array(this.columns * this.rows); this.values.fill(NaN); const positions = new Float64Array(this.values.length * 3), indices = new Uint32Array((this.columns - 1) * (this.rows - 1) * 6);
    for (let row = 0; row < this.rows; row++) for (let col = 0; col < this.columns; col++) {const i = row * this.columns + col; const x = this.start.x + col * this.step.x, z = this.start.z + row * this.step.z; positions.set(this.transposeXZ ? [z, NaN, x] : [x, NaN, z], i * 3); if (row + 1 < this.rows && col + 1 < this.columns) indices.set([i, i + this.columns, i + 1, i + 1, i + this.columns, i + this.columns + 1], (row * (this.columns - 1) + col) * 6);}
    this.setGeometry({positions, indices});
  }
  private validateGridTransform(start: {x: number; z: number}, step: {x: number; z: number}): void {if (![start.x, start.z, step.x, step.z].every(Number.isFinite) || !step.x || !step.z) throw new RangeError('Surface start/step require finite coordinates and nonzero steps');}
  private updateGrid(target: Float32Array, input: ArrayLike<number> | readonly ArrayLike<number>[] | GridPatch3D): DirtyRange[] {
    if (input && 'values' in input && !ArrayBuffer.isView(input) && !Array.isArray(input)) {const patch = input as GridPatch3D, row = integer(patch.iRow ?? 0), col = integer(patch.iColumn ?? 0); if (!Array.isArray(patch.values) || row + patch.values.length > this.rows || patch.values.some(values => col + values.length > this.columns)) throw new RangeError('Surface patch lies outside grid'); const ranges: DirtyRange[] = []; patch.values.forEach((values, offset) => {const start = (row + offset) * this.columns + col; target.set(values, start); ranges.push({start, count: values.length});}); return ranges;}
    if (Array.isArray(input) && input.length && typeof input[0] === 'object') {const rows = input as readonly ArrayLike<number>[]; if (rows.length !== this.rows || rows.some(row => row.length !== this.columns)) throw new RangeError('Surface height rows do not match grid'); rows.forEach((row, index) => target.set(row, index * this.columns));}
    else {const values = input as ArrayLike<number>; if (!values || values.length !== target.length) throw new RangeError('Surface values do not match grid'); target.set(values);}
    return [{start: 0, count: target.length}];
  }
  invalidateHeightMap(input: ArrayLike<number> | readonly ArrayLike<number>[] | GridPatch3D): this {const ranges = this.updateGrid(this.values, input); for (const range of ranges) for (let i = range.start; i < range.start + range.count; i++) this.vertices[i * 3 + 1] = this.values[i]; this.markGeometry(ranges); return this;}
  invalidateIntensityValues(input: ArrayLike<number> | readonly ArrayLike<number>[] | GridPatch3D): this {const values = this.scalarValues ?? new Float32Array(this.values.length).fill(NaN); this.updateGrid(values, input); this.scalarValues = values; this.styleDirty = true; this.changed(); return this;}
  override clear(): this {this.assertAlive(); this.values.fill(NaN); this.scalarValues?.fill(NaN); for (let i = 0; i < this.values.length; i++) this.vertices[i * 3 + 1] = NaN; this.markGeometry([{start: 0, count: this.values.length}]); return this;}
  setStart(value: {x: number; z: number}|undefined): this {const next=value??{x:0,z:0};this.validateGridTransform(next,this.step);this.start={...next};return this.resolveTransform();}
  getStart(){return{...this.start};}
  setStep(value: {x: number; z: number}|undefined): this {const next=value??{x:1,z:1};this.validateGridTransform(this.start,next);this.requestedStep={...next};return this.resolveTransform();}
  getStep(){return{...this.step};}
  setEnd(value:{x:number;z:number}|undefined):this {
    if(value&&![value.x,value.z].every(Number.isFinite))throw new RangeError('Surface end must be finite');
    this.explicitEnd=value?{...value}:undefined;return this.resolveTransform();
  }
  getEnd(){return this.explicitEnd?{...this.explicitEnd}:{x:this.start.x+this.columns*this.step.x,z:this.start.z+this.rows*this.step.z};}
  private resolveTransform():this {
    this.step=this.explicitEnd?{x:(this.explicitEnd.x-this.start.x)/this.columns,z:(this.explicitEnd.z-this.start.z)/this.rows}:{...this.requestedStep};
    return this.updateCoordinates();
  }
  /** @internal Native chart cursor queries retained nodes without copying the mesh. */
  solveNearest3D(from:{clientX:number;clientY:number}):any {
    if(this.disposed||!this.visible||!this.cursorEnabled)return undefined;
    const chart=this.chart as any,scale={x:this.axisX,y:this.axisY,z:this.axisZ};let nearest:any;
    for(let index=0;index<this.values.length;index++){
      const x=this.vertices[index*3],y=this.vertices[index*3+1],z=this.vertices[index*3+2];
      if(![x,y,z].every(Number.isFinite))continue;
      const projected=chart.translateCoordinate({x,y,z},scale,chart.coordsClient),distanceSquared=(from.clientX-projected.clientX)**2+(from.clientY-projected.clientY)**2;
      if(!Number.isFinite(distanceSquared)||nearest&&distanceSquared>=nearest.distanceSquared)continue;
      nearest={x,y,z,column:index%this.columns,row:Math.floor(index/this.columns),intensity:this.scalarValues?.[index],lut:this.fill instanceof PalettedFill?this.fill.lut:undefined,series:this,axisX:this.axisX,axisY:this.axisY,axisZ:this.axisZ,distanceSquared,cursorPosition:{pointMarker:{x,y,z},pointMarkerScale:scale,resultTable:{x,y,z},resultTableScale:scale}};
    }
    return nearest;
  }
  private updateCoordinates(): this {for (let row = 0; row < this.rows; row++) for (let col = 0; col < this.columns; col++) {const i = row * this.columns + col; const x = this.start.x + col * this.step.x, z = this.start.z + row * this.step.z; this.vertices[i * 3] = this.transposeXZ ? z : x; this.vertices[i * 3 + 2] = this.transposeXZ ? x : z;} this.markGeometry([{start: 0, count: this.values.length}]); return this;}
  /** Append complete rows while preserving a bounded, chronologically ordered surface. */
  addRows(input: readonly ArrayLike<number>[]): this {if (input.some(row => row.length !== this.columns)) throw new RangeError('Appended surface rows have the wrong width'); if (!input.length) return this; const retained = input.slice(-this.rows), added = retained.length; this.values.copyWithin(0, added * this.columns); retained.forEach((row, index) => this.values.set(row, (this.rows - added + index) * this.columns)); this.start.z += input.length * this.step.z; for (let i = 0; i < this.values.length; i++) this.vertices[i * 3 + 1] = this.values[i]; if (this.scalarValues) {this.scalarValues.copyWithin(0, added * this.columns); this.scalarValues.fill(NaN, (this.rows - added) * this.columns);} return this.updateCoordinates();}
  protected override updateNormals(positions: Float32Array, previous: Float32Array | undefined, ranges: readonly DirtyRange[]): {values: Float32Array; ranges?: DirtyRange[]} {
    const normals = previous ?? new Float32Array(positions.length), expanded: DirtyRange[] = [];
    for (const range of ranges) {const firstRow = Math.floor(range.start / this.columns), lastRow = Math.floor((range.start + Math.max(0, range.count - 1)) / this.columns); for (let row = Math.max(0, firstRow - 1); row <= Math.min(this.rows - 1, lastRow + 1); row++) expanded.push({start: row * this.columns, count: this.columns});}
    const updated = mergedRanges(expanded);
    for (const range of updated) for (let i = range.start; i < range.start + range.count; i++) {const row = Math.floor(i / this.columns), col = i % this.columns, left = row * this.columns + Math.max(0, col - 1), right = row * this.columns + Math.min(this.columns - 1, col + 1), back = Math.max(0, row - 1) * this.columns + col, front = Math.min(this.rows - 1, row + 1) * this.columns + col; const ax = positions[right * 3] - positions[left * 3], ay = positions[right * 3 + 1] - positions[left * 3 + 1], az = positions[right * 3 + 2] - positions[left * 3 + 2], bx = positions[front * 3] - positions[back * 3], by = positions[front * 3 + 1] - positions[back * 3 + 1], bz = positions[front * 3 + 2] - positions[back * 3 + 2], direction = this.transposeXZ ? -1 : 1, nx = (by * az - bz * ay) * direction, ny = (bz * ax - bx * az) * direction, nz = (bx * ay - by * ax) * direction, length = Math.hypot(nx, ny, nz); if (Number.isFinite(length) && length > 1e-20) normals.set([nx / length, ny / length, nz / length], i * 3); else normals.set([0, 1, 0], i * 3);}
    return {values: normals, ranges: previous ? mergedRanges(updated, 3) : undefined};
  }
}

export interface BoxInput3D {x?: number; y?: number; z?: number; width?: number; height?: number; depth?: number; xCenter?: number; yCenter?: number; zCenter?: number; xSize?: number; ySize?: number; zSize?: number; value?: number; color?: Color;}
export interface BoxOptions3D extends MeshOptions3D {roundedEdges?: boolean | number; maxSampleCount?: number;}
export class BoxSeries3D extends Series3DBase {
  readonly kind = 'boxes3d'; private readonly data = new DataSetXY({schema: Object.fromEntries(['x', 'y', 'z', 'width', 'height', 'depth', 'value', 'r', 'g', 'b', 'a'].map(key => [key, {storage: Float64Array}]))});
  private roundness = 0; private compiled?: {revision: number; key: string; packets: DrawPacket3D[]};
  constructor(chart: RenderHost, options: BoxOptions3D = {}) {super(chart, options); if (options.maxSampleCount !== undefined) this.data.setMaxSampleCount(options.maxSampleCount); this.data.onChange(() => this.changed()); if (options.roundedEdges) this.setRoundedEdges(options.roundedEdges);}
  private prepare(input: readonly BoxInput3D[]): Record<string, Float64Array> {
    this.assertAlive(); const columns: Record<string, Float64Array> = Object.fromEntries(Object.keys(this.data.schema).map(key => [key, new Float64Array(input.length)]));
    input.forEach((box, index) => {const width = box.xSize ?? box.width ?? 1, height = box.ySize ?? box.height ?? 1, depth = box.zSize ?? box.depth ?? 1; const x = box.xCenter ?? (box.x ?? 0) + width / 2, y = box.yCenter ?? (box.y ?? 0) + height / 2, z = box.zCenter ?? (box.z ?? 0) + depth / 2; if (![x, y, z, width, height, depth].every(Number.isFinite) || width < 0 || height < 0 || depth < 0) throw new RangeError('3D boxes need finite coordinates and nonnegative dimensions'); const values = {x, y, z, width, height, depth, value: box.value ?? height, r: box.color?.r ?? NaN, g: box.color?.g ?? NaN, b: box.color?.b ?? NaN, a: box.color?.a ?? NaN}; for (const key of Object.keys(columns)) columns[key][index] = values[key as keyof typeof values];}); return columns;
  }
  add(input: readonly BoxInput3D[]): this {this.data.appendSamples(this.prepare(input)); return this;}
  addBoxes(input: readonly BoxInput3D[]): this {return this.add(input);}
  setData(input: readonly BoxInput3D[]): this {const columns = this.prepare(input); this.clear(); this.data.appendSamples(columns); return this;}
  clear(): this {this.data.clear(); return this;}
  setMaxSampleCount(value: number | undefined): this {this.data.setMaxSampleCount(value); return this;}
  getMaxSampleCount(): number | undefined {return this.data.getMaxSampleCount();}
  getSampleCount(): number {return this.data.getSampleCount();}
  setRoundedEdges(value: boolean | number): this {const radius = typeof value === 'boolean' ? value ? .12 : 0 : value; if (!Number.isFinite(radius) || radius < 0 || radius > .5) throw new RangeError('Rounded edge fraction must be in [0, .5]'); this.roundness = radius; this.changed(); return this;}
  getRoundedEdges(): number {return this.roundness;}
  bounds(dimension: 'x' | 'y' | 'z'): Interval | undefined {const values = this.data.getColumn(dimension), sizes = this.data.getColumn(dimension === 'x' ? 'width' : dimension === 'y' ? 'height' : 'depth'); let min = Infinity, max = -Infinity; for (let i = 0; i < values.length; i++) {min = Math.min(min, values[i] - sizes[i] / 2); max = Math.max(max, values[i] + sizes[i] / 2);} return min === Infinity ? undefined : {start: min, end: max};}
  getDrawPackets(normalize: Normalize3D, axisKey: string): DrawPacket3D[] {
    this.assertAlive(); if (this.compiled?.revision === this.revision && this.compiled.key === axisKey) return this.compiled.packets;
    const count = this.getSampleCount(), columns = Object.fromEntries(Object.keys(this.data.schema).map(key => [key, this.data.getColumn(key)])), positions = new Float32Array(count * 3), boxSizes = new Float32Array(count * 3), colors = new Float32Array(count * 4), tops = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {for (let dim = 0; dim < 3; dim++) {const center = columns[['x', 'y', 'z'][dim]][i], size = columns[['width', 'height', 'depth'][dim]][i], first = normalize(center - size / 2, dim as 0 | 1 | 2), last = normalize(center + size / 2, dim as 0 | 1 | 2); positions[i * 3 + dim] = (first + last) / 2; boxSizes[i * 3 + dim] = Math.abs(last - first);}
      let bottom: Color, top: Color;
      if (Number.isFinite(columns.a[i])) bottom = top = new Color(columns.r[i], columns.g[i], columns.b[i], columns.a[i]);
      else if (this.fill instanceof PalettedFill) {const lookup = this.fill.getLookUpProperty(); if (lookup === 'y') {bottom = this.fill.lut.getColor(columns.y[i] - columns.height[i] / 2); top = this.fill.lut.getColor(columns.y[i] + columns.height[i] / 2);} else bottom = top = this.fill.lut.getColor(columns[lookup]?.[i] ?? columns.value[i]);}
      else bottom = top = meshFillColor(this.fill, ColorRGBA(255, 255, 255)); colors.set(rgba(bottom), i * 4); tops.set(rgba(top), i * 4);
    }
    const packet: DrawPacket3D = {id: this.id, revision: ++this.packetRevision, positions, boxSizes, colors, boxTopColors: tops, count, mode: 'boxes', color: [1, 1, 1, 1], thickness: 0, pointSize: 0, roundness: this.roundness, lighting: this.lighting, ...this.renderingState()}; this.compiled = {revision: this.revision, key: axisKey, packets: [packet]}; return this.compiled.packets;
  }
  override dispose(): this {this.compiled = undefined; this.data.dispose(); return super.dispose();}
}

/** Irregular structured meshes and arbitrary indexed models share the original mesh model. */
export class SurfaceMesh3D extends MeshSeries3D {override readonly kind: string = 'surface-mesh3d';}
interface ModelHost3D extends RenderHost {
  coordsWorld: unknown;
  getBoundingBox(): Vec3;
  translateCoordinate(point: Vec3, source: unknown, target: unknown): Vec3;
}
const coord3D = (value: Vec3, label: string): Vec3 => {
  if (!value || ![value.x, value.y, value.z].every(Number.isFinite)) throw new RangeError(`${label} coordinates must be finite`);
  return {x: value.x, y: value.y, z: value.z};
};
export class MeshModel3D extends MeshSeries3D {
  override readonly kind: string = 'mesh-model3d';
  private modelCoordinates = false;
  private modelScale: Vec3 = {x: 1, y: 1, z: 1};
  private modelLocation: Vec3 = {x: 0, y: 0, z: 0};
  private modelAlignment: Vec3 = {x: 0, y: 0, z: 0};
  private modelContext?: {box: Vec3; origin: Vec3; anchor: Vec3};
  setModelGeometry(input: ModelGeometry3D): this {
    this.assertAlive();
    if (!input?.vertices || input.vertices.length % 3 || !Array.from(input.vertices).every(Number.isFinite)) throw new RangeError('Model vertices require finite complete XYZ coordinates');
    if (input.normals !== undefined) throw new TypeError('Explicit model normals are not implemented; omit normals to generate them from geometry');
    super.setGeometry({positions: input.vertices, indices: input.indices}); this.modelCoordinates = true; return this;
  }
  setScale(value: number | Partial<Vec3>): this {
    this.assertAlive();
    const scale = coord3D(typeof value === 'number' ? {x: value, y: value, z: value} : {...this.modelScale, ...value}, 'Model scale');
    if (this.modelCoordinates && scale.x === this.modelScale.x && scale.y === this.modelScale.y && scale.z === this.modelScale.z) return this;
    this.modelScale = scale; this.modelCoordinates = true; this.transformChanged(); return this;
  }
  getScale(): Vec3 {return {...this.modelScale};}
  setModelLocation(value: Vec3): this {this.assertAlive(); this.modelLocation = coord3D(value, 'Model location'); this.modelCoordinates = true; this.transformChanged(); return this;}
  getModelLocation(): Vec3 {return {...this.modelLocation};}
  setModelAlignment(value: Vec3): this {
    this.assertAlive(); const alignment = coord3D(value, 'Model alignment');
    if (Object.values(alignment).some(component => component < -1 || component > 1)) throw new RangeError('Model alignment must be within [-1, 1]');
    this.modelAlignment = alignment; this.modelCoordinates = true; this.transformChanged(); return this;
  }
  getModelAlignment(): Vec3 {return {...this.modelAlignment};}
  private transformChanged(): void {this.modelContext = undefined; this.markGeometry([{start: 0, count: this.getSampleCount()}]);}
  private prepareModelContext(): {box: Vec3; origin: Vec3; anchor: Vec3} {
    const host = this.chart as ModelHost3D;
    if (typeof host.getBoundingBox !== 'function' || typeof host.translateCoordinate !== 'function' || !host.coordsWorld) throw new TypeError('Model geometry requires a Chart3D world coordinate host');
    const anchor: Vec3 = {x: 0, y: 0, z: 0};
    for (const dim of ['x', 'y', 'z'] as const) {
      const bounds = super.bounds(dim);
      if (bounds) anchor[dim] = bounds.start + (bounds.end - bounds.start) * (this.modelAlignment[dim] + 1) / 2;
    }
    return {box: host.getBoundingBox(), origin: host.translateCoordinate(this.modelLocation, {x: this.axisX, y: this.axisY, z: this.axisZ}, host.coordsWorld), anchor};
  }
  private worldVertex(index: number, context: {origin: Vec3; anchor: Vec3}): Vec3 {
    return {x: context.origin.x + (this.vertices[index * 3] - context.anchor.x) * this.modelScale.x,
      y: context.origin.y + (this.vertices[index * 3 + 1] - context.anchor.y) * this.modelScale.y,
      z: context.origin.z + (this.vertices[index * 3 + 2] - context.anchor.z) * this.modelScale.z};
  }
  protected override normalizedVertex(index: number, normalize: Normalize3D): Vec3 {
    if (!this.modelCoordinates) return super.normalizedVertex(index, normalize);
    const context = this.modelContext!;
    return worldToNormalized3D(this.worldVertex(index, context), context.box);
  }
  override getDrawPackets(normalize: Normalize3D, axisKey: string): DrawPacket3D[] {
    if (!this.modelCoordinates) return super.getDrawPackets(normalize, axisKey);
    this.modelContext = this.prepareModelContext();
    return super.getDrawPackets(normalize, `${axisKey}/${JSON.stringify(this.modelContext)}`);
  }
  override bounds(dimension: 'x' | 'y' | 'z'): Interval | undefined {
    if (!this.modelCoordinates) return super.bounds(dimension);
    const context = this.prepareModelContext(), host = this.chart as ModelHost3D;
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < this.getSampleCount(); i++) {
      const point = host.translateCoordinate(this.worldVertex(i, context), host.coordsWorld, {x: this.axisX, y: this.axisY, z: this.axisZ});
      if (Number.isFinite(point[dimension])) {min = Math.min(min, point[dimension]); max = Math.max(max, point[dimension]);}
    }
    return min === Infinity ? undefined : {start: min, end: max};
  }
  override dispose(): this {this.modelContext = undefined; return super.dispose();}
}

/** Original incremental triangulation on XZ. Coincident locations retain the first finite sample. */
export function triangulateScatter3D(input: readonly MeshVertex3D[]): MeshGeometry3D {
  const seen = new Set<string>(), points: MeshVertex3D[] = [];
  for (const point of input) {if (![point.x, point.y, point.z].every(Number.isFinite)) continue; const key = `${point.x}|${point.z}`; if (!seen.has(key)) {seen.add(key); points.push({...point});}}
  const positions = Float64Array.from(points.flatMap(point => [point.x, point.y, point.z])), values = Float32Array.from(points.map(point => point.value ?? point.y));
  if (points.length < 3) return {positions, indices: new Uint32Array(), values};
  // A finite synthetic supertriangle can remove real, very flat hull faces
  // when its vertices are discarded. Grow the actual hull instead: sorted
  // insertion adds only visible outside faces, then legalizes shared edges.
  // Predicate signs use exact input doubles throughout: global normalization
  // can collapse local coordinates beside a distant outlier, even when the
  // resulting rounded determinant appears far from zero.
  let exact: Array<{x: bigint; z: bigint}> | undefined;
  const sign = (value: bigint) => value < 0n ? -1 : value > 0n ? 1 : 0;
  const exactPoints = () => {
    if (exact) return exact;
    const view = new DataView(new ArrayBuffer(8));
    const dyadic = (value: number) => {
      view.setFloat64(0, value); const bits = view.getBigUint64(0), exponent = Number((bits >> 52n) & 2047n), fraction = bits & ((1n << 52n) - 1n);
      return {mantissa: ((bits >> 63n) ? -1n : 1n) * (exponent ? (1n << 52n) | fraction : fraction), exponent: exponent ? exponent - 1075 : -1074};
    };
    const parts = points.map(point => ({x: dyadic(point.x), z: dyadic(point.z)}));
    let exponent = Infinity; for (const point of parts) for (const value of [point.x, point.z]) if (value.mantissa) exponent = Math.min(exponent, value.exponent);
    if (!Number.isFinite(exponent)) exponent = 0;
    const integer = (value: ReturnType<typeof dyadic>) => value.mantissa ? value.mantissa << BigInt(value.exponent - exponent) : 0n;
    exact = parts.map(point => ({x: integer(point.x), z: integer(point.z)})); return exact;
  };
  const orient = (a: number, b: number, c: number) => {
    const e = exactPoints(), u = e[a], v = e[b], w = e[c]; return sign((v.x - u.x) * (w.z - u.z) - (v.z - u.z) * (w.x - u.x));
  };
  const inCircle = (a: number, b: number, c: number, d: number) => {
    const e = exactPoints(), origin = e[d], x = e[a].x - origin.x, z = e[a].z - origin.z, xx = e[b].x - origin.x, zz = e[b].z - origin.z, xxx = e[c].x - origin.x, zzz = e[c].z - origin.z;
    return sign((x * x + z * z) * (xx * zzz - zz * xxx) - (xx * xx + zz * zz) * (x * zzz - z * xxx) + (xxx * xxx + zzz * zzz) * (x * zz - z * xx));
  };
  const order = points.map((_, i) => i).sort((a, b) => points[a].x - points[b].x || points[a].z - points[b].z);
  const first = order[0], second = order[1], third = order.find(index => orient(first, second, index) !== 0);
  if (third === undefined) return {positions, indices: new Uint32Array(), values};
  type Face = {vertices: [number, number, number]};
  type Edge = {a: number; b: number; faces: Set<Face>};
  const faces = new Set<Face>(), edges = new Map<string, Edge>(), key = (a: number, b: number) => a < b ? `${a}:${b}` : `${b}:${a}`;
  const addFace = (a: number, b: number, c: number, queue: string[]) => {
    const direction = orient(a, b, c); if (!direction) throw new Error('Degenerate scatter triangle');
    const face: Face = {vertices: direction > 0 ? [a, b, c] : [a, c, b]}; faces.add(face);
    for (let i = 0; i < 3; i++) {const a = face.vertices[i], b = face.vertices[(i + 1) % 3], id = key(a, b), edge = edges.get(id) ?? {a, b, faces: new Set<Face>()}; edge.faces.add(face); edges.set(id, edge); queue.push(id);}
    return face;
  };
  const removeFace = (face: Face) => {
    faces.delete(face); for (let i = 0; i < 3; i++) {const id = key(face.vertices[i], face.vertices[(i + 1) % 3]), edge = edges.get(id)!; edge.faces.delete(face); if (!edge.faces.size) edges.delete(id);}
  };
  const legalize = (queue: string[]) => {
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const edge = edges.get(queue[cursor]); if (!edge || edge.faces.size !== 2) continue;
      const [left, right] = [...edge.faces], a = edge.a, b = edge.b, c = left.vertices.find(i => i !== a && i !== b)!, d = right.vertices.find(i => i !== a && i !== b)!;
      // Only convex quadrilaterals can exchange diagonals. A cocircular edge
      // remains in its deterministic insertion order; no tolerance drops it.
      if (orient(c, d, a) * orient(c, d, b) >= 0 || inCircle(...left.vertices, d) <= 0) continue;
      removeFace(left); removeFace(right); addFace(c, d, a, queue); addFace(d, c, b, queue);
    }
  };
  let hull = addFace(first, second, third, []).vertices.slice();
  for (const index of order) {
    if (index === first || index === second || index === third) continue;
    const visible = hull.map((a, i) => orient(a, hull[(i + 1) % hull.length], index) < 0), start = visible.findIndex((value, i) => value && !visible[(i + visible.length - 1) % visible.length]);
    if (start < 0) throw new Error('Scatter insertion lies outside the monotone hull contract');
    const queue: string[] = []; let end = start;
    do {addFace(hull[end], hull[(end + 1) % hull.length], index, queue); end = (end + 1) % hull.length;} while (visible[end]);
    const nextHull = [hull[start], index, hull[end]];
    for (let i = (end + 1) % hull.length; i !== start; i = (i + 1) % hull.length) nextHull.push(hull[i]);
    hull = nextHull; legalize(queue);
  }
  return {positions, indices: Uint32Array.from([...faces].flatMap(face => face.vertices)), values};
}

export interface EllipsoidFit3D {center: [number, number, number]; covariance: Float64Array; eigenvalues: [number, number, number]; /** Column-major orthonormal basis. */ basis: Float64Array; radii: [number, number, number]; sampleCount: number; geometry: MeshGeometry3D;}
/** Sample covariance and an original symmetric Jacobi eigensolver; the scale has no implicit probability claim. */
export function fitEllipsoid3D(input: readonly Pick<MeshVertex3D, 'x' | 'y' | 'z'>[], options: {standardDeviations?: number; longitudeSegments?: number; latitudeSegments?: number} = {}): EllipsoidFit3D {
  const scale = options.standardDeviations ?? 2, longitude = integer(options.longitudeSegments ?? 48, 3), latitude = integer(options.latitudeSegments ?? 24, 2);
  if (!Number.isFinite(scale) || scale <= 0) throw new RangeError('Ellipsoid scale must be positive');
  const center: [number, number, number] = [0, 0, 0], covariance = new Float64Array(9); let count = 0;
  for (const point of input) {const value = [point.x, point.y, point.z]; if (!value.every(Number.isFinite)) continue; count++; const delta = value.map((v, i) => v - center[i]); for (let i = 0; i < 3; i++) center[i] += delta[i] / count; for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) covariance[row * 3 + col] += delta[row] * (value[col] - center[col]);}
  if (count < 2) throw new RangeError('An ellipsoid fit needs at least two finite samples');
  for (let row = 0; row < 3; row++) for (let col = row; col < 3; col++) {const value = (covariance[row * 3 + col] + covariance[col * 3 + row]) / (2 * (count - 1)); covariance[row * 3 + col] = covariance[col * 3 + row] = value;}
  const matrix = covariance.slice(), basis = Float64Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  for (let iteration = 0; iteration < 32; iteration++) {
    let p = 0, q = 1; for (const [a, b] of [[0, 2], [1, 2]]) if (Math.abs(matrix[a * 3 + b]) > Math.abs(matrix[p * 3 + q])) {p = a; q = b;}
    const apq = matrix[p * 3 + q], magnitude = Math.max(Math.abs(matrix[0]), Math.abs(matrix[4]), Math.abs(matrix[8]), Number.MIN_VALUE); if (Math.abs(apq) <= magnitude * 1e-14) break;
    const tau = (matrix[q * 3 + q] - matrix[p * 3 + p]) / (2 * apq), t = (tau >= 0 ? 1 : -1) / (Math.abs(tau) + Math.hypot(1, tau)), cosine = 1 / Math.hypot(1, t), sine = t * cosine;
    const app = matrix[p * 3 + p], aqq = matrix[q * 3 + q]; matrix[p * 3 + p] = app - t * apq; matrix[q * 3 + q] = aqq + t * apq; matrix[p * 3 + q] = matrix[q * 3 + p] = 0;
    for (let k = 0; k < 3; k++) {if (k !== p && k !== q) {const akp = matrix[k * 3 + p], akq = matrix[k * 3 + q]; matrix[k * 3 + p] = matrix[p * 3 + k] = cosine * akp - sine * akq; matrix[k * 3 + q] = matrix[q * 3 + k] = sine * akp + cosine * akq;} const vkp = basis[p * 3 + k], vkq = basis[q * 3 + k]; basis[p * 3 + k] = cosine * vkp - sine * vkq; basis[q * 3 + k] = sine * vkp + cosine * vkq;}
  }
  const order = [0, 1, 2].sort((a, b) => matrix[b * 3 + b] - matrix[a * 3 + a]), vectors = Float64Array.from(order.flatMap(index => Array.from(basis.subarray(index * 3, index * 3 + 3)))), eigenvalues = order.map(index => Math.max(0, matrix[index * 3 + index])) as [number, number, number], radii = eigenvalues.map(value => scale * Math.sqrt(value)) as [number, number, number];
  const positions = new Float64Array((longitude + 1) * (latitude + 1) * 3), indices: number[] = [];
  for (let row = 0; row <= latitude; row++) {const theta = Math.PI * row / latitude; for (let col = 0; col <= longitude; col++) {const phi = 2 * Math.PI * col / longitude, local = [radii[0] * Math.sin(theta) * Math.cos(phi), radii[1] * Math.cos(theta), radii[2] * Math.sin(theta) * Math.sin(phi)], index = row * (longitude + 1) + col; for (let dimension = 0; dimension < 3; dimension++) positions[index * 3 + dimension] = center[dimension] + local.reduce((sum, value, axis) => sum + vectors[axis * 3 + dimension] * value, 0); if (row < latitude && col < longitude) {const next = index + longitude + 1; if (row > 0) indices.push(index, next, index + 1); if (row < latitude - 1) indices.push(index + 1, next, next + 1);}}}
  return {center, covariance, basis: vectors, eigenvalues, radii, sampleCount: count, geometry: {positions, indices: Uint32Array.from(indices)}};
}
