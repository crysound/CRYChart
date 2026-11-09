import {ComponentHighlightState,highlightColor} from './component-highlight.js';
import {EventHub, type EventToken} from './core/events.js';
import {Color, ColorRGBA, SolidFill, SolidLine, PalettedFill, emptyFill, resolveValue, type FillStyle, type LineStyle, type ValueOrMutator} from './core/styles.js';
import {applyLine, fillCSS} from './ui.js';
import type {Interval, Rect, RenderHost} from './contracts.js';
import {xyCursorHit,validateSolveMode,type CoordinateClient,type SolveNearestMode} from './cursor-api.js';

export interface GeometryPoint {x: number; y: number; }
export interface GeometryOptions {axisX?: any; axisY?: any; fillStyle?: FillStyle; strokeStyle?: LineStyle; [key: string]: any; }
export interface RectangleDimensions {x?: number; y?: number; width?: number; height?: number; x1?: number; y1?: number; x2?: number; y2?: number; [key: string]: any; }
export interface SegmentDimensions {startX?: number; startY?: number; endX?: number; endY?: number; start?: GeometryPoint; end?: GeometryPoint; [key: string]: any; }
export interface RangePoint {x?: number; position?: number; low?: number; high?: number; yLow?: number; yHigh?: number; }
export interface OHLCPoint {x: number; open: number; high: number; low: number; close: number; }
export interface BoxDimensions {x?: number; width?: number; start?: number; end?: number; min?: number; max?: number; lowerExtreme?: number; upperExtreme?: number; lowerQuartile: number; upperQuartile: number; median: number; [key: string]: any; }

let nextGeometryId = 1_000_000;
const number = (value: unknown, fallback = NaN): number => typeof value === 'number' ? value : fallback;
const colorCSS = (fill: FillStyle, value = 0): string => fill instanceof PalettedFill ? fill.lut.getColor(value).toCSS() : fillCSS(fill);

/** Interleaved numeric storage; item handles are created only when explicitly returned. */
class PackedRows {
  values = new Float64Array(0); flags = new Uint8Array(0); length = 0; count = 0; epoch = 0;
  constructor(readonly stride: number) {}
  append(count: number): number {
    const start = this.length, needed = start + count;
    if (needed > this.flags.length) {
      const capacity = Math.max(256, needed, this.flags.length * 2), values = new Float64Array(capacity * this.stride), flags = new Uint8Array(capacity);
      values.set(this.values); flags.set(this.flags); this.values = values; this.flags = flags;
    }
    this.flags.fill(1, start, needed); this.length = needed; this.count += count; return start;
  }
  clear(): void { this.flags.fill(0, 0, this.length); this.length = 0; this.count = 0; this.epoch++; }
}

export class GeometryStyle {
  constructor(public fill: FillStyle, public stroke: LineStyle) {}
  setFillStyle(value: ValueOrMutator<FillStyle>): this { this.fill = resolveValue(value, this.fill); return this; }
  getFillStyle(): FillStyle { return this.fill; }
  setStrokeStyle(value: ValueOrMutator<LineStyle>): this { this.stroke = resolveValue(value, this.stroke); return this; }
  getStrokeStyle(): LineStyle { return this.stroke; }
}

export abstract class GeometrySeries {
  private readonly componentHighlight=new ComponentHighlightState();
  protected supportsHighlightRendering(){return false;}
  readonly id = nextGeometryId++; readonly events = new EventHub(); readonly axisX: any; readonly axisY: any;
  readonly xAxis: any; readonly yAxis: any; name = ''; visible = true; disposed = false; revision = 0;
  fill: FillStyle; stroke: LineStyle; mouseInteractions = true; cursorEnabled = true; highlight = 0; cursorFormatter: any;
  protected lastRect?: Rect; private cachedRevision = -1; private cachedBounds: {x?: Interval; y?: Interval} = {};
  private seriesDrawOrderIndex:number|undefined;
  constructor(readonly chart: RenderHost, readonly kind: string, options: GeometryOptions = {}) {
    this.axisX = this.xAxis = options.axisX ?? chart.getDefaultAxisX(); this.axisY = this.yAxis = options.axisY ?? chart.getDefaultAxisY();
    this.fill = options.fillStyle ?? new SolidFill({color: ColorRGBA(62, 204, 195, 170)});
    this.stroke = options.strokeStyle ?? new SolidLine({fillStyle: new SolidFill({color: ColorRGBA(62, 204, 195)}), thickness: 1});
  }
  changed(): void { this.revision++; this.chart.invalidate(); }
  protected assertAlive(): void { if (this.disposed) throw new Error('Geometry series is disposed'); }
  setName(value: string): this { this.name = String(value); this.chart.invalidate(); return this; }
  getName(): string { return this.name; }
  setDrawOrder(value:{seriesDrawOrderIndex:number}):this{
    this.assertAlive();
    if(!value||!Number.isFinite(value.seriesDrawOrderIndex))throw new RangeError('Series draw order requires a finite number');
    this.seriesDrawOrderIndex=value.seriesDrawOrderIndex;
    (this.chart as RenderHost&{onSeriesDrawOrderChanged?:()=>void}).onSeriesDrawOrderChanged?.();
    this.chart.invalidate();return this;
  }
  /** Internal ordering capability; default order belongs to the chart registration sequence. */
  getSeriesDrawOrderIndex(){return this.seriesDrawOrderIndex;}
  setVisible(value: boolean): this { this.visible = value;if(!value)this.componentHighlight.suspend(); this.changed(); return this; }
  getVisible(): boolean { return this.visible; }
  setFillStyle(value: ValueOrMutator<FillStyle>): this { this.fill = resolveValue(value, this.fill); this.changed(); return this; }
  getFillStyle(): FillStyle { return this.fill; }
  setStrokeStyle(value: ValueOrMutator<LineStyle>): this { this.stroke = resolveValue(value, this.stroke); this.changed(); return this; }
  getStrokeStyle(): LineStyle { return this.stroke; }
  setDefaultStyle(styler: (style: GeometryStyle) => GeometryStyle): this { const style = styler(new GeometryStyle(this.fill, this.stroke)); if (style) { this.fill = style.getFillStyle(); this.stroke = style.getStrokeStyle(); } this.changed(); return this; }
  setCursorResultTableFormatter(value: any): this { this.cursorFormatter = value; return this; }
  getCursorResultTableFormatter(): any { return this.cursorFormatter; }
  setCursorEnabled(value: boolean): this { this.cursorEnabled = value; return this; }
  setMouseInteractions(value: boolean): this { this.mouseInteractions = value; return this; }
  setMouseInteractionsEnabled(value: boolean): this { return this.setMouseInteractions(value); }
  setHighlight(value: boolean|number): this { this.assertAlive();this.highlight = this.componentHighlight.set(value); this.chart.invalidate(); return this; }
  getHighlight(): number { return this.highlight; }
  setAnimationHighlight(enabled:boolean):this{this.assertAlive();this.componentHighlight.setAnimation(enabled);this.chart.invalidate();return this;}
  getAnimationHighlight(){return this.componentHighlight.getAnimation();}
  advanceHighlight(timestamp:number){this.componentHighlight.advance(timestamp,this.supportsHighlightRendering()&&this.visible&&!this.disposed&&this.getSampleCount()>0);}
  hasPendingHighlight(){return this.componentHighlight.pending(this.supportsHighlightRendering()&&this.visible&&!this.disposed&&this.getSampleCount()>0);}
  getHighlightStrength(){return this.componentHighlight.strength();}
  cancelHighlightAnimation(){this.componentHighlight.cancel();}
  suspendHighlightAnimation(){this.componentHighlight.suspend();}

  protected renderColorCSS(fill:FillStyle,value=0):string{
    const strength=this.getHighlightStrength();if(!(strength>0))return colorCSS(fill,value);
    const color=fill instanceof PalettedFill?fill.lut.getColor(value):(fill as any).getColor?.();
    return color?highlightColor(color,strength,(this.chart as any).theme??{}).toCSS():colorCSS(fill,value);
  }
  setEffect(value: boolean): this { if (value) throw new Error('Geometry shadows are not implemented'); return this; }
  getAxisX(): any { return this.axisX; } getAxisY(): any { return this.axisY; }
  on(type: string, listener: (...args: any[]) => void): EventToken { return this.events.on(type, listener); }
  off(typeOrToken: string | EventToken, token?: EventToken): boolean { return token === undefined ? this.events.off(typeOrToken as EventToken) : this.events.off(typeOrToken, token); }
  onDispose(listener: (series: this) => void): EventToken { return this.on('dispose', listener); }
  dispose(): this { if (!this.disposed) { this.disposed = true;this.componentHighlight.cancel(); try{this.events.emit('dispose', this);}finally{this.events.clear();this.chart.removeSeries(this);} } return this; }
  isDisposed(): boolean { return this.disposed; }
  abstract clear(): this;
  abstract getSampleCount(): number;
  getPointCount(): number { return this.getSampleCount(); }
  getXMin(): number { return this.bounds('x')?.start ?? NaN; } getXMax(): number { return this.bounds('x')?.end ?? NaN; }
  getYMin(): number { return this.bounds('y')?.start ?? NaN; } getYMax(): number { return this.bounds('y')?.end ?? NaN; }
  bounds(dimension: 'x' | 'y' | 'z'): Interval | undefined {
    if (dimension === 'z') return undefined;
    if (this.cachedRevision !== this.revision) { this.cachedBounds = this.calculateBounds(); this.cachedRevision = this.revision; }
    return this.cachedBounds[dimension];
  }
  protected abstract calculateBounds(): {x?: Interval; y?: Interval};
  protected projectors(rect: Rect): {x: (value: number) => number; y: (value: number) => number} {
    const create = (axis: any, start: number, size: number) => {
      if (typeof axis.getInterval !== 'function') return (value: number) => start + axis.valueToFraction(value) * size;
      const interval = axis.getInterval(), log = axis.type === 'logarithmic';
      const a = log ? Math.log10(interval.start) : interval.start, b = log ? Math.log10(interval.end) : interval.end, span = b - a;
      return (value: number) => { const coordinate = log ? Math.log10(Math.max(value, Math.min(interval.start, interval.end))) : value; const ratio = (coordinate - a) / span; return start + (axis.inverted ? 1 - ratio : ratio) * size; };
    };
    return {x: create(this.axisX, rect.left, rect.width), y: create(this.axisY, rect.top + rect.height, -rect.height)};
  }
  draw(ctx: CanvasRenderingContext2D, rect: Rect): void {
    if (!this.visible || this.disposed || !this.getSampleCount()) return; this.lastRect = rect;
    ctx.save(); ctx.beginPath(); ctx.rect(rect.left, rect.top, rect.width, rect.height); ctx.clip(); this.drawGeometry(ctx, rect); ctx.restore();
  }
  protected abstract drawGeometry(ctx: CanvasRenderingContext2D, rect: Rect): void;
  solveNearestFromScreen(point: GeometryPoint): any { return this.lastRect ? this.hitTest(point, this.lastRect) : undefined; }
  hitTest(_point: GeometryPoint, _rect: Rect): any { return undefined; }
}

abstract class PackedSeries extends GeometrySeries {
  readonly rows: PackedRows; readonly itemStyles = new Map<number, {fill?: FillStyle; stroke?: LineStyle}>();
  readonly metadata = new Map<number, Record<string, any>>();
  constructor(chart: RenderHost, kind: string, stride: number, options: GeometryOptions = {}) { super(chart, kind, options); this.rows = new PackedRows(stride); }
  clear(): this { this.assertAlive(); this.rows.clear(); this.itemStyles.clear(); this.metadata.clear(); this.changed(); return this; }
  getSampleCount(): number { return this.rows.count; }
  override dispose():this{
    if(this.disposed)return this;
    this.rows.values=new Float64Array(0);this.rows.flags=new Uint8Array(0);this.rows.length=0;this.rows.count=0;this.rows.epoch++;
    this.itemStyles.clear();this.metadata.clear();return super.dispose();
  }
  protected remember(index: number, value: any): void {
    if (value.fillStyle || value.strokeStyle || value.color) this.itemStyles.set(index, {fill: value.fillStyle ?? (value.color instanceof Color ? new SolidFill({color: value.color}) : undefined), stroke: value.strokeStyle});
    if ('xValue' in value || 'yValue' in value || 'value' in value || 'name' in value) this.metadata.set(index, {...value});
  }
  protected scanBounds(xOffsets: number[], yOffsets: number[]): {x?: Interval; y?: Interval} {
    let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity; const {values, flags, length, stride} = this.rows;
    for (let i = 0; i < length; i++) { if (!flags[i]) continue; const offset = i * stride;
      for (const j of xOffsets) { const value = values[offset + j]; if (Number.isFinite(value) && (this.axisX.type !== 'logarithmic' || value > 0)) { xMin = Math.min(xMin, value); xMax = Math.max(xMax, value); } }
      for (const j of yOffsets) { const value = values[offset + j]; if (Number.isFinite(value) && (this.axisY.type !== 'logarithmic' || value > 0)) { yMin = Math.min(yMin, value); yMax = Math.max(yMax, value); } }
    }
    return {x: xMin === Infinity ? undefined : {start: xMin, end: xMax}, y: yMin === Infinity ? undefined : {start: yMin, end: yMax}};
  }
  removeItem(index: number, epoch: number): void { if (epoch === this.rows.epoch && this.rows.flags[index]) { this.rows.flags[index] = 0; this.rows.count--; this.itemStyles.delete(index); this.metadata.delete(index); this.changed(); } }
  itemAlive(index: number, epoch: number): boolean { return !this.disposed && this.rows.epoch === epoch && this.rows.flags[index] !== 0; }
}

class PackedFigure {
  readonly events = new EventHub(); readonly epoch: number;
  constructor(readonly series: PackedSeries, readonly index: number) { this.epoch = series.rows.epoch; }
  protected assertAlive(): void { if (this.isDisposed()) throw new Error('Figure was removed or its series was cleared'); }
  setFillStyle(value: ValueOrMutator<FillStyle>): this { this.assertAlive(); const style = this.series.itemStyles.get(this.index) ?? {}; style.fill = resolveValue(value, style.fill ?? this.series.fill); this.series.itemStyles.set(this.index, style); this.series.changed(); return this; }
  getFillStyle(): FillStyle { return this.series.itemStyles.get(this.index)?.fill ?? this.series.fill; }
  setStrokeStyle(value: ValueOrMutator<LineStyle>): this { this.assertAlive(); const style = this.series.itemStyles.get(this.index) ?? {}; style.stroke = resolveValue(value, style.stroke ?? this.series.stroke); this.series.itemStyles.set(this.index, style); this.series.changed(); return this; }
  getStrokeStyle(): LineStyle { return this.series.itemStyles.get(this.index)?.stroke ?? this.series.stroke; }
  getDominantStyle(): FillStyle { return this.getFillStyle(); }
  setVisible(value: boolean): this { this.assertAlive(); this.series.rows.flags[this.index] = value ? 1 : 2; this.series.changed(); return this; }
  getVisible(): boolean { return !this.isDisposed() && this.series.rows.flags[this.index] === 1; }
  mouseInteractions = true;
  setMouseInteractions(value: boolean): this { this.mouseInteractions = value; return this; }
  getMouseInteractions(): boolean { return this.mouseInteractions; }
  isDisposed(): boolean { return !this.series.itemAlive(this.index, this.epoch); }
  dispose(): this { if (!this.isDisposed()) { this.series.removeItem(this.index, this.epoch); this.events.emit('dispose', this); this.events.clear(); } return this; }
  onDispose(listener: (item: this) => void): EventToken { return this.events.on('dispose', listener); }
  offDispose(token: EventToken): boolean { return this.events.off(token); }
}

function writeRectangle(target: Float64Array, offset: number, input: RectangleDimensions): void {
  const x = number(input.x1, number(input.x, 0)), y = number(input.y1, number(input.y, 0));
  target[offset] = x; target[offset + 1] = y; target[offset + 2] = number(input.x2, x + number(input.width, 0)); target[offset + 3] = number(input.y2, y + number(input.height, 0));
}
export class RectangleFigure extends PackedFigure {
  setDimensions(value: RectangleDimensions): this { this.assertAlive(); writeRectangle(this.series.rows.values, this.index * 4, value); this.series.changed(); return this; }
  setBounds(value: RectangleDimensions): this { return this.setDimensions(value); }
  setPosition(value: GeometryPoint): this { const dimensions = this.getDimensionsPositionAndSize(); return this.setDimensions({...dimensions, ...value}); }
  getDimensionsTwoPoints(): {x1: number; y1: number; x2: number; y2: number} { const a = this.series.rows.values, i = this.index * 4; return {...this.series.metadata.get(this.index), x1: a[i], y1: a[i + 1], x2: a[i + 2], y2: a[i + 3]}; }
  getDimensionsPositionAndSize(): {x: number; y: number; width: number; height: number} { const d = this.getDimensionsTwoPoints(); return {x: d.x1, y: d.y1, width: d.x2 - d.x1, height: d.y2 - d.y1}; }
  getBoundaries(): {start: GeometryPoint; end: GeometryPoint} { const d = this.getDimensionsTwoPoints(); return {start: {x: Math.min(d.x1, d.x2), y: Math.min(d.y1, d.y2)}, end: {x: Math.max(d.x1, d.x2), y: Math.max(d.y1, d.y2)}}; }
}
export class RectangleSeries extends PackedSeries {
  protected override supportsHighlightRendering(){return true;}
  private readonly solvePlane:'x'|'y'|'xy'|undefined;
  constructor(chart: RenderHost, options: GeometryOptions = {}) { super(chart, 'rectangles', 4, options);if(options.solvePlane!==undefined&&!['x','y','xy'].includes(options.solvePlane))throw new RangeError('Rectangle solve plane must be x, y or xy');this.solvePlane=options.solvePlane; }
  add(value: RectangleDimensions): RectangleFigure;
  add(value: RectangleDimensions[]): this;
  add(value: RectangleDimensions | RectangleDimensions[]): RectangleFigure | this {
    this.assertAlive(); const batch = Array.isArray(value), list = batch ? value : [value], start = this.rows.append(list.length);
    for (let i = 0; i < list.length; i++) { writeRectangle(this.rows.values, (start + i) * 4, list[i]); this.remember(start + i, list[i]); }
    this.changed(); return batch ? this : new RectangleFigure(this, start);
  }
  addRectangle(value: RectangleDimensions): RectangleFigure { return this.add(value); }
  addRectangles(values: RectangleDimensions[]): this { return this.add(values); }
  solveNearest(from:CoordinateClient,mode:SolveNearestMode='show-nearest'):any{
    validateSolveMode(mode);if(this.disposed||!this.visible||!this.cursorEnabled)return undefined;
    const chart=this.chart as any;if(typeof chart.translatePoint!=='function')return undefined;
    const pixel=chart.translatePoint(from,chart.coordsClient,chart.coordsPixel),rect=chart.getSeriesScreenRect(this),project=this.projectors(rect);
    if(!Number.isFinite(pixel.x)||!Number.isFinite(pixel.y))return undefined;
    if(this.solvePlane==='x'&&(pixel.x<rect.left||pixel.x>rect.left+rect.width)||this.solvePlane==='y'&&(pixel.y<rect.top||pixel.y>rect.top+rect.height))return undefined;
    let best=-1,distance=Infinity;const values=this.rows.values;
    for(let index=0;index<this.rows.length;index++){
      if(this.rows.flags[index]!==1)continue;
      const j=index*4,x=(values[j]!+values[j+2]!)/2,y=(values[j+1]!+values[j+3]!)/2;
      const dx=this.solvePlane==='y'?0:project.x(x)-pixel.x,dy=this.solvePlane==='x'?0:project.y(y)-pixel.y,d=dx*dx+dy*dy;
      if(d<distance){best=index;distance=d;}
    }
    if(best<0)return undefined;
    const figure=new RectangleFigure(this,best),dimensions=figure.getDimensionsTwoPoints(),point={x:(dimensions.x1+dimensions.x2)/2,y:(dimensions.y1+dimensions.y2)/2};
    return xyCursorHit(this,point,from,{...(this.metadata.get(best)??{}),figure,...dimensions,positionAndSize:figure.getDimensionsPositionAndSize()});
  }
  getFigures(): RectangleFigure[] { const result: RectangleFigure[] = []; for (let i = 0; i < this.rows.length; i++) if (this.rows.flags[i]) result.push(new RectangleFigure(this, i)); return result; }
  protected calculateBounds(): {x?: Interval; y?: Interval} { return this.scanBounds([0, 2], [1, 3]); }
  protected drawGeometry(ctx: CanvasRenderingContext2D, rect: Rect): void {
    const p = this.projectors(rect), {values, flags, length} = this.rows, defaultColor = this.fill instanceof PalettedFill ? '' : this.renderColorCSS(this.fill); let fill: FillStyle | undefined, stroke: LineStyle | undefined, currentColor = '', pending = 0;
    // A single 100k-rectangle path caused an actual Chrome GPU-context reset.
    // Bound tessellation work while preserving all visible input rectangles.
    const flush = () => { if (!pending) return; if (fill !== emptyFill) { ctx.fillStyle = currentColor; ctx.fill(); } if (applyLine(ctx, stroke)) {if(this.getHighlightStrength()>0)ctx.strokeStyle=this.renderColorCSS(stroke!.getFillStyle());ctx.stroke();} pending = 0; };
    for (let i = 0; i < length; i++) {
      if (flags[i] !== 1) continue; const j = i * 4, x1 = p.x(values[j]), x2 = p.x(values[j + 2]), y1 = p.y(values[j + 1]), y2 = p.y(values[j + 3]);
      if (!Number.isFinite(x1) || !Number.isFinite(x2) || !Number.isFinite(y1) || !Number.isFinite(y2)) continue; const left = Math.min(x1, x2), top = Math.min(y1, y2), width = Math.abs(x2 - x1), height = Math.abs(y2 - y1);
      if (left + width < rect.left || left > rect.left + rect.width || top + height < rect.top || top > rect.top + rect.height) continue;
      const style = this.itemStyles.get(i), nextFill = style?.fill ?? this.fill, nextStroke = style?.stroke ?? this.stroke, nextColor = nextFill === this.fill && defaultColor ? defaultColor : this.renderColorCSS(nextFill, values[j + 3]);
      if (fill !== nextFill || stroke !== nextStroke || currentColor !== nextColor || pending>=256) { flush(); fill = nextFill; stroke = nextStroke; currentColor = nextColor; ctx.beginPath(); }
      ctx.rect(left, top, width, height); pending++;
    } flush();
  }
  override hitTest(point: GeometryPoint, rect: Rect): any {
    if (!this.mouseInteractions) return undefined; const p = this.projectors(rect), a = this.rows.values;
    for (let i = this.rows.length - 1; i >= 0; i--) if (this.rows.flags[i] === 1) {
      const j = i * 4, x1 = p.x(a[j]), x2 = p.x(a[j + 2]), y1 = p.y(a[j + 1]), y2 = p.y(a[j + 3]);
      if (point.x >= Math.min(x1, x2) && point.x <= Math.max(x1, x2) && point.y >= Math.min(y1, y2) && point.y <= Math.max(y1, y2)) {
        const figure=new RectangleFigure(this,i);
        return {...(this.metadata.get(i)??{}),series:this,figure,...figure.getDimensionsTwoPoints(),positionAndSize:figure.getDimensionsPositionAndSize(),x:(a[j]+a[j+2])/2,y:a[j+3]};
      }
    }
    return undefined;
  }
}

export class SegmentFigure extends PackedFigure {
  setDimensions(value: SegmentDimensions): this { this.assertAlive(); writeSegment(this.series.rows.values, this.index * 4, value); this.series.changed(); return this; }
  getDimensions(): {startX: number; startY: number; endX: number; endY: number} { const a = this.series.rows.values, i = this.index * 4; return {startX: a[i], startY: a[i + 1], endX: a[i + 2], endY: a[i + 3]}; }
  getBoundaries(): {start: GeometryPoint; end: GeometryPoint} { const d = this.getDimensions(); return {start: {x: Math.min(d.startX, d.endX), y: Math.min(d.startY, d.endY)}, end: {x: Math.max(d.startX, d.endX), y: Math.max(d.startY, d.endY)}}; }
}
function writeSegment(target: Float64Array, offset: number, value: SegmentDimensions): void { target[offset] = number(value.startX, value.start?.x); target[offset + 1] = number(value.startY, value.start?.y); target[offset + 2] = number(value.endX, value.end?.x); target[offset + 3] = number(value.endY, value.end?.y); }
export class SegmentSeries extends PackedSeries {
  constructor(chart: RenderHost, options: GeometryOptions = {}) { super(chart, 'segments', 4, options); }
  add(value: SegmentDimensions): SegmentFigure;
  add(value: SegmentDimensions[]): this;
  add(value: SegmentDimensions | SegmentDimensions[]): SegmentFigure | this { this.assertAlive(); const batch = Array.isArray(value), list = batch ? value : [value], start = this.rows.append(list.length); list.forEach((item, i) => { writeSegment(this.rows.values, (start + i) * 4, item); this.remember(start + i, item); }); this.changed(); return batch ? this : new SegmentFigure(this, start); }
  addSegment(value: SegmentDimensions): SegmentFigure { return this.add(value); }
  protected calculateBounds(): {x?: Interval; y?: Interval} { return this.scanBounds([0, 2], [1, 3]); }
  protected drawGeometry(ctx: CanvasRenderingContext2D, rect: Rect): void {
    const p = this.projectors(rect), a = this.rows.values; let previous: LineStyle | undefined, pending = false;
    for (let i = 0; i < this.rows.length; i++) if (this.rows.flags[i] === 1) {
      const stroke = this.itemStyles.get(i)?.stroke ?? this.stroke; if (previous !== stroke) { if (pending) ctx.stroke(); pending = false; previous = stroke; ctx.beginPath(); }
      if (!applyLine(ctx, stroke)) continue; const j = i * 4, x1 = p.x(a[j]), y1 = p.y(a[j + 1]), x2 = p.x(a[j + 2]), y2 = p.y(a[j + 3]); if (![x1, y1, x2, y2].every(Number.isFinite)) continue;
      ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); pending = true;
    } if (pending) ctx.stroke();
  }
  override hitTest(point: GeometryPoint, rect: Rect): any {
    const p = this.projectors(rect), a = this.rows.values; let best = 6, result: any;
    for (let i = 0; i < this.rows.length; i++) if (this.rows.flags[i] === 1) { const j = i * 4, x = p.x(a[j]), y = p.y(a[j + 1]), dx = p.x(a[j + 2]) - x, dy = p.y(a[j + 3]) - y, t = Math.max(0, Math.min(1, ((point.x - x) * dx + (point.y - y) * dy) / (dx * dx + dy * dy || 1))), distance = Math.hypot(point.x - x - t * dx, point.y - y - t * dy); if (distance < best) { best = distance; result = {series: this, figure: new SegmentFigure(this, i), x: a[j] + t * (a[j + 2] - a[j]), y: a[j + 1] + t * (a[j + 3] - a[j + 1])}; } }
    return result;
  }
}

export class PolygonFigure {
  points: Float64Array; fill?: FillStyle; stroke?: LineStyle; visible = true; disposed = false; readonly events = new EventHub();
  constructor(readonly series: PolygonSeries, points: GeometryPoint[]) { this.points = Float64Array.from(points.flatMap(p => [p.x, p.y])); }
  setDimensions(points: GeometryPoint[]): this { if (this.disposed) throw new Error('Polygon is disposed'); this.points = Float64Array.from(points.flatMap(p => [p.x, p.y])); this.series.changed(); return this; }
  getDimensions(): GeometryPoint[] { const result: GeometryPoint[] = []; for (let i = 0; i < this.points.length; i += 2) result.push({x: this.points[i], y: this.points[i + 1]}); return result; }
  setFillStyle(value: ValueOrMutator<FillStyle>): this { this.fill = resolveValue(value, this.fill ?? this.series.fill); this.series.changed(); return this; }
  getFillStyle(): FillStyle { return this.fill ?? this.series.fill; }
  setStrokeStyle(value: ValueOrMutator<LineStyle>): this { this.stroke = resolveValue(value, this.stroke ?? this.series.stroke); this.series.changed(); return this; }
  getStrokeStyle(): LineStyle { return this.stroke ?? this.series.stroke; }
  setVisible(value: boolean): this { this.visible = value; this.series.changed(); return this; }
  getVisible(): boolean { return this.visible; }
  dispose(): this { if (!this.disposed) { this.disposed = true; this.events.emit('dispose', this); this.events.clear(); this.series.changed(); } return this; }
  isDisposed(): boolean { return this.disposed || this.series.disposed; }
  onDispose(listener: (figure: this) => void): EventToken { return this.events.on('dispose', listener); }
}
export class PolygonSeries extends GeometrySeries {
  readonly figures: PolygonFigure[] = [];
  constructor(chart: RenderHost, options: GeometryOptions = {}) { super(chart, 'polygons', options); }
  add(points: GeometryPoint[] | {points: GeometryPoint[]; fillStyle?: FillStyle; strokeStyle?: LineStyle}): PolygonFigure { this.assertAlive(); const item = new PolygonFigure(this, Array.isArray(points) ? points : points.points); if (!Array.isArray(points)) { item.fill = points.fillStyle; item.stroke = points.strokeStyle; } this.figures.push(item); this.changed(); return item; }
  addPolygon(points: GeometryPoint[] | {points: GeometryPoint[]}): PolygonFigure { return this.add(points); }
  clear(): this { this.figures.forEach(item => item.dispose()); this.figures.length = 0; this.changed(); return this; }
  getSampleCount(): number { return this.figures.reduce((sum, item) => sum + (item.disposed ? 0 : 1), 0); }
  protected calculateBounds(): {x?: Interval; y?: Interval} { let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity; for (const item of this.figures) if (!item.disposed) for (let i = 0; i < item.points.length; i += 2) { const x = item.points[i], y = item.points[i + 1]; if (Number.isFinite(x)) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); } if (Number.isFinite(y)) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); } } return {x: minX === Infinity ? undefined : {start: minX, end: maxX}, y: minY === Infinity ? undefined : {start: minY, end: maxY}}; }
  protected drawGeometry(ctx: CanvasRenderingContext2D, rect: Rect): void { const p = this.projectors(rect); for (const item of this.figures) { if (!item.visible || item.disposed || item.points.length < 6) continue; ctx.beginPath(); let valid = true; for (let i = 0; i < item.points.length; i += 2) { const x = p.x(item.points[i]), y = p.y(item.points[i + 1]); if (!Number.isFinite(x) || !Number.isFinite(y)) { valid = false; break; } if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); } if (!valid) continue; ctx.closePath(); const fill = item.getFillStyle(); if (fill !== emptyFill) { ctx.fillStyle = colorCSS(fill); ctx.fill(); } if (applyLine(ctx, item.getStrokeStyle())) ctx.stroke(); } }
  override hitTest(point: GeometryPoint, rect: Rect): any { const p = this.projectors(rect); for (let n = this.figures.length - 1; n >= 0; n--) { const figure = this.figures[n]; if (!figure.visible || figure.disposed) continue; const a = figure.points; let inside = false; for (let i = 0, j = a.length - 2; i < a.length; j = i, i += 2) { const xi = p.x(a[i]), yi = p.y(a[i + 1]), xj = p.x(a[j]), yj = p.y(a[j + 1]); if (((yi > point.y) !== (yj > point.y)) && point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi) inside = !inside; } if (inside) return {series: this, figure}; } return undefined; }
}

export class RangeSeries extends PackedSeries {
  highStroke: LineStyle; lowStroke: LineStyle; lowFill: FillStyle;
  constructor(chart: RenderHost, options: GeometryOptions = {}) { super(chart, 'range', 3, options); this.highStroke = this.stroke; this.lowStroke = this.stroke; this.lowFill = this.fill; }
  add(value: RangePoint | RangePoint[]): this { this.assertAlive(); const list = Array.isArray(value) ? value : [value], start = this.rows.append(list.length); for (let i = 0; i < list.length; i++) { const item = list[i], offset = (start + i) * 3; this.rows.values[offset] = number(item.x, item.position); this.rows.values[offset + 1] = number(item.yLow, item.low); this.rows.values[offset + 2] = number(item.yHigh, item.high); } this.changed(); return this; }
  addArraysHighLow(high: ArrayLike<number>, low: ArrayLike<number>, step = 1, start?: number): this { if (high.length !== low.length) throw new RangeError('High and low arrays must have equal length'); const first = this.rows.length, origin = start ?? (first ? this.rows.values[(first - 1) * 3] + step : 0); this.rows.append(high.length); for (let i = 0; i < high.length; i++) { const offset = (first + i) * 3; this.rows.values[offset] = origin + i * step; this.rows.values[offset + 1] = low[i]; this.rows.values[offset + 2] = high[i]; } this.changed(); return this; }
  setHighFillStyle(value: ValueOrMutator<FillStyle>): this { return this.setFillStyle(value); }
  getHighFillStyle(): FillStyle { return this.fill; }
  setLowFillStyle(value: ValueOrMutator<FillStyle>): this { this.lowFill = resolveValue(value, this.lowFill); this.changed(); return this; }
  getLowFillStyle(): FillStyle { return this.lowFill; }
  setHighStrokeStyle(value: ValueOrMutator<LineStyle>): this { this.highStroke = resolveValue(value, this.highStroke); this.changed(); return this; }
  getHighStrokeStyle(): LineStyle { return this.highStroke; }
  setLowStrokeStyle(value: ValueOrMutator<LineStyle>): this { this.lowStroke = resolveValue(value, this.lowStroke); this.changed(); return this; }
  getLowStrokeStyle(): LineStyle { return this.lowStroke; }
  override setStrokeStyle(value: ValueOrMutator<LineStyle>): this { super.setStrokeStyle(value); this.highStroke = this.stroke; this.lowStroke = this.stroke; return this; }
  protected calculateBounds(): {x?: Interval; y?: Interval} { return this.scanBounds([0], [1, 2]); }
  protected drawGeometry(ctx: CanvasRenderingContext2D, rect: Rect): void {
    const p = this.projectors(rect), a = this.rows.values, n = this.rows.length;
    let start = 0;
    const drawRun = (first: number, end: number) => { if (end <= first) return; ctx.beginPath(); for (let i = first; i < end; i++) { const x = p.x(a[i * 3]), y = p.y(a[i * 3 + 2]); if (i === first) ctx.moveTo(x, y); else ctx.lineTo(x, y); } for (let i = end - 1; i >= first; i--) ctx.lineTo(p.x(a[i * 3]), p.y(a[i * 3 + 1])); ctx.closePath(); const fill = a[first * 3 + 2] >= a[first * 3 + 1] ? this.fill : this.lowFill; if (fill !== emptyFill) { ctx.fillStyle = colorCSS(fill); ctx.fill(); }
      for (const [column, stroke] of [[2, this.highStroke], [1, this.lowStroke]] as const) if (applyLine(ctx, stroke)) { ctx.beginPath(); for (let i = first; i < end; i++) { const x = p.x(a[i * 3]), y = p.y(a[i * 3 + column]); if (i === first) ctx.moveTo(x, y); else ctx.lineTo(x, y); } ctx.stroke(); }
    };
    for (let i = 0; i <= n; i++) { const offset = i * 3; if (i === n || !Number.isFinite(a[offset]) || !Number.isFinite(a[offset + 1]) || !Number.isFinite(a[offset + 2])) { drawRun(start, i); start = i + 1; } }
  }
}

export class OHLCSeries extends PackedSeries {
  figureWidth = 8; minimumGap = 2; pack = false; mode: string; positive: FillStyle = new SolidFill({color: ColorRGBA(51, 199, 150)}); negative: FillStyle = new SolidFill({color: ColorRGBA(240, 93, 114)});
  constructor(chart: RenderHost, options: GeometryOptions = {}) { super(chart, 'ohlc', 5, options); this.mode = String(options.type ?? 'candlestick').toLowerCase(); }
  add(value: OHLCPoint | OHLCPoint[]): this { this.assertAlive(); const list = Array.isArray(value) ? value : [value], start = this.rows.append(list.length); for (let i = 0; i < list.length; i++) { const item = list[i], j = (start + i) * 5; this.rows.values[j] = item.x; this.rows.values[j + 1] = item.open; this.rows.values[j + 2] = item.high; this.rows.values[j + 3] = item.low; this.rows.values[j + 4] = item.close; } this.changed(); return this; }
  setFigureWidth(value: number): this { if (!Number.isFinite(value) || value <= 0) throw new RangeError('Figure width must be positive'); this.figureWidth = value; this.changed(); return this; }
  getFigureWidth(): number { return this.figureWidth; }
  setFigureMinimumGap(value: number): this { this.minimumGap = Math.max(0, value); this.changed(); return this; }
  getFigureMinimumGap(): number { return this.minimumGap; }
  setPackData(value: boolean): this { this.pack = value; this.changed(); return this; }
  getPackData(): boolean { return this.pack; }
  setPositiveFillStyle(value: ValueOrMutator<FillStyle>): this { this.positive = resolveValue(value, this.positive); this.changed(); return this; }
  setNegativeFillStyle(value: ValueOrMutator<FillStyle>): this { this.negative = resolveValue(value, this.negative); this.changed(); return this; }
  protected calculateBounds(): {x?: Interval; y?: Interval} { return this.scanBounds([0], [1, 2, 3, 4]); }
  protected drawGeometry(ctx: CanvasRenderingContext2D, rect: Rect): void {
    const p = this.projectors(rect), a = this.rows.values, span = this.figureWidth + this.minimumGap;
    let bucket = NaN, current: OHLCPoint | undefined;
    const paint = (item: OHLCPoint) => { const x = p.x(item.x), high = p.y(item.high), low = p.y(item.low), open = p.y(item.open), close = p.y(item.close); if (![x, high, low, open, close].every(Number.isFinite) || x < rect.left - this.figureWidth || x > rect.left + rect.width + this.figureWidth) return; const fill = item.close >= item.open ? this.positive : this.negative; ctx.strokeStyle = colorCSS(fill); ctx.fillStyle = colorCSS(fill); ctx.lineWidth = 1; ctx.setLineDash([]); ctx.beginPath(); ctx.moveTo(x, high); ctx.lineTo(x, low); if (this.mode.includes('bar') || this.mode === 'ohlc') { ctx.moveTo(x - this.figureWidth / 2, open); ctx.lineTo(x, open); ctx.moveTo(x, close); ctx.lineTo(x + this.figureWidth / 2, close); ctx.stroke(); } else { ctx.stroke(); ctx.fillRect(x - this.figureWidth / 2, Math.min(open, close), this.figureWidth, Math.max(1, Math.abs(close - open))); } };
    for (let i = 0; i < this.rows.length; i++) if (this.rows.flags[i] === 1) { const j = i * 5, item = {x: a[j], open: a[j + 1], high: a[j + 2], low: a[j + 3], close: a[j + 4]}; if (!this.pack) { paint(item); continue; } const next = Math.floor(p.x(item.x) / span); if (current && next === bucket) { current.high = Math.max(current.high, item.high); current.low = Math.min(current.low, item.low); current.close = item.close; } else { if (current) paint(current); current = item; bucket = next; } } if (current) paint(current);
  }
}

function writeBox(a: Float64Array, j: number, value: BoxDimensions): void { const width = value.width ?? .7, x = value.x ?? 0; a[j] = value.start ?? x - width / 2; a[j + 1] = value.end ?? x + width / 2; a[j + 2] = value.lowerExtreme ?? value.min ?? value.lowerQuartile; a[j + 3] = value.lowerQuartile; a[j + 4] = value.median; a[j + 5] = value.upperQuartile; a[j + 6] = value.upperExtreme ?? value.max ?? value.upperQuartile; }
export class BoxFigure extends PackedFigure {
  setDimensions(value: BoxDimensions): this { this.assertAlive(); writeBox(this.series.rows.values, this.index * 7, value); this.series.changed(); return this; }
  getDimensions(): BoxDimensions { const a = this.series.rows.values, j = this.index * 7; return {start: a[j], end: a[j + 1], lowerExtreme: a[j + 2], lowerQuartile: a[j + 3], median: a[j + 4], upperQuartile: a[j + 5], upperExtreme: a[j + 6]}; }
}
export class BoxSeries extends PackedSeries {
  horizontal=false;
  constructor(chart: RenderHost, options: GeometryOptions = {}) { super(chart, 'boxes', 7, options); }
  setHorizontal(value:boolean):this{this.horizontal=value;this.changed();return this;}
  add(value: BoxDimensions): BoxFigure;
  add(value: BoxDimensions[]): this;
  add(value: BoxDimensions | BoxDimensions[]): BoxFigure | this { this.assertAlive(); const batch = Array.isArray(value), list = batch ? value : [value], start = this.rows.append(list.length); for (let i = 0; i < list.length; i++) { writeBox(this.rows.values, (start + i) * 7, list[i]); this.remember(start + i, list[i]); } this.changed(); return batch ? this : new BoxFigure(this, start); }
  protected calculateBounds(): {x?: Interval; y?: Interval} { return this.horizontal?this.scanBounds([2,3,4,5,6],[0,1]):this.scanBounds([0, 1], [2, 3, 4, 5, 6]); }
  protected drawGeometry(ctx: CanvasRenderingContext2D, rect: Rect): void {
    const original=this.projectors(rect),p=this.horizontal?{x:original.y,y:original.x}:original,a=this.rows.values;
    const box=(left:number,top:number,width:number,height:number,fill:boolean)=>{const args=this.horizontal?[top,left,height,width]:[left,top,width,height];if(fill)ctx.fillRect(args[0],args[1],args[2],args[3]);else ctx.strokeRect(args[0],args[1],args[2],args[3]);};
    const move=(x:number,y:number)=>this.horizontal?ctx.moveTo(y,x):ctx.moveTo(x,y),line=(x:number,y:number)=>this.horizontal?ctx.lineTo(y,x):ctx.lineTo(x,y);
    for (let i = 0; i < this.rows.length; i++) if (this.rows.flags[i] === 1) {
      const j = i * 7, left = p.x(a[j]), right = p.x(a[j + 1]), center = (left + right) / 2, low = p.y(a[j + 2]), q1 = p.y(a[j + 3]), median = p.y(a[j + 4]), q3 = p.y(a[j + 5]), high = p.y(a[j + 6]); if (![left, right, low, q1, median, q3, high].every(Number.isFinite)) continue;
      const style = this.itemStyles.get(i), fill = style?.fill ?? this.fill, stroke = style?.stroke ?? this.stroke;
      if (fill !== emptyFill) { ctx.fillStyle = colorCSS(fill, a[j + 4]); box(Math.min(left, right), Math.min(q1, q3), Math.abs(right - left), Math.abs(q1 - q3),true); }
      if (applyLine(ctx, stroke)) { box(Math.min(left, right), Math.min(q1, q3), Math.abs(right - left), Math.abs(q1 - q3),false); ctx.beginPath(); move(center, low); line(center, q1); move(center, q3); line(center, high); const half = Math.abs(right - left) * .3; for (const y of [low, high]) { move(center - half, y); line(center + half, y); } move(left, median); line(right, median); ctx.stroke(); }
    }
  }
}

export {RangeSeries as AreaRangeSeries};
