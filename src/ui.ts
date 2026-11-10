import {EventHub, type EventToken} from './core/events.js';
import {Icon} from './custom-icon.js';
import {ColorRGBA, DashedLine, FontSettings, SolidFill, SolidLine, UIOrigins, emptyFill, emptyLine, resolveValue, type FillStyle, type LineStyle, type Theme, type ValueOrMutator} from './core/styles.js';
import type {Rect} from './contracts.js';
import {prepareResultTableLayout,drawResultTableCells,type ResultTableLayout} from './result-table-layout.js';

export interface UIPoint {x: number; y: number; [key: string]: any; }
export interface UIHost {invalidate?(): void; readonly theme?: Partial<Theme>; readonly overlay?: HTMLCanvasElement; readonly resolveTextFont?:(font:FontSettings)=>FontSettings; }
const renderFont=(owner:UIHost,font:FontSettings)=>owner.resolveTextFont?.(font)??font;
export type UIProject = (position: UIPoint, coordinates?: any) => UIPoint;
type TextMeasurementContext = Pick<CanvasRenderingContext2D, 'font' | 'save' | 'restore' | 'measureText'>;
const documentTextContexts = new WeakMap<Document, TextMeasurementContext>();
let offscreenTextContext: TextMeasurementContext | undefined;
export const fillCSS = (fill: any, fallback = 'transparent'): string => fill?.kind === 'empty' ? 'rgba(0, 0, 0, 0)' : fill?.getColor?.().toCSS?.() ?? fill?.color?.toCSS?.() ?? (typeof fill === 'string' ? fill : fallback);
export function applyLine(ctx: CanvasRenderingContext2D, style: any): boolean {
  if (!style || style === emptyLine || style.getThickness?.() === 0 || style.getFillStyle?.() === emptyFill) return false;
  ctx.strokeStyle = fillCSS(style.getFillStyle?.() ?? style.fillStyle, '#8a9aad');
  ctx.lineWidth = Math.max(.5, style.getThickness?.() ?? style.thickness ?? 1);
  ctx.setLineDash(style instanceof DashedLine ? style.pattern.map(x => x * style.patternScale) : []);
  return true;
}

export class UIBackground {
  fill: FillStyle = new SolidFill({color: ColorRGBA(18, 29, 42, 230)});
  stroke: LineStyle = new SolidLine({fillStyle: new SolidFill({color: ColorRGBA(110, 135, 155, 130)})});
  constructor(private readonly change: () => void = () => {}) {}
  setFillStyle(value: ValueOrMutator<FillStyle>): this { this.fill = resolveValue(value, this.fill); this.change(); return this; }
  getFillStyle(): FillStyle { return this.fill; }
  setStrokeStyle(value: ValueOrMutator<LineStyle>): this { this.stroke = resolveValue(value, this.stroke); this.change(); return this; }
  getStrokeStyle(): LineStyle { return this.stroke; }
}

export class UIElement {
  readonly events = new EventHub(); readonly owner: UIHost; readonly kind: string; readonly coordinates: any;
  position: UIPoint = {x: 0, y: 0}; origin: UIPoint = UIOrigins.LeftTop; visible = true; disposed = false;
  text = ''; font = new FontSettings(); fill: FillStyle = new SolidFill({color: ColorRGBA(235, 242, 250)});
  background: UIBackground; padding = 6; margin = 0; pointerEvents = true; checked = false; effect = false;
  bounds: Rect = {left: 0, top: 0, width: 0, height: 0}; rotation = 0;
  private lastDrawingContext?: TextMeasurementContext;
  constructor(owner: UIHost = {}, builder: any = 'TextBox', coordinates?: any) {
    this.owner = owner; this.kind = typeof builder === 'string' ? builder : builder?.kind ?? builder?.type ?? 'TextBox'; this.coordinates = coordinates;
    this.background = new UIBackground(() => this.changed());
    // Theme defaults are captured when the element is created. Later builder or
    // element setters remain authoritative; drawing never overwrites them.
    const theme = owner.theme;
    if (theme) {
      this.background.fill = theme.uiBackgroundFillStyle ?? theme.panelBackgroundFillStyle ?? this.background.fill;
      this.background.stroke = theme.uiBorderStrokeStyle ?? theme.axisStrokeStyle ?? this.background.stroke;
      this.fill = theme.textColor ? new SolidFill({color: theme.textColor}) : theme.chartTitleFillStyle ?? this.fill;
      this.font = theme.font ?? this.font;
    }
    if (builder?.options?.font) this.font = builder.options.font;
    if (builder?.options?.textFillStyle) this.fill = builder.options.textFillStyle;
    if (builder?.options?.background) this.background.fill = builder.options.background;
  }
  protected changed(): void { this.owner.invalidate?.(); }
  setText(value: string): this { this.text = String(value); this.changed(); return this; }
  getText(): string { return this.text; }
  setTextFont(value: ValueOrMutator<FontSettings>): this { this.font = resolveValue(value, this.font); this.changed(); return this; }
  getTextFont(): FontSettings { return this.font; }
  private textMeasurementContext(): TextMeasurementContext {
    const attached = this.owner.overlay?.getContext('2d');
    if (attached) return attached;
    if (this.lastDrawingContext) return this.lastDrawingContext;
    if (typeof document !== 'undefined') {
      const previous = documentTextContexts.get(document);
      if (previous) return previous;
      const context = document.createElement('canvas').getContext('2d');
      if (context) { documentTextContexts.set(document, context); return context; }
    }
    if (typeof OffscreenCanvas !== 'undefined') {
      if (!offscreenTextContext) offscreenTextContext = new OffscreenCanvas(1, 1).getContext('2d') ?? undefined;
      if (offscreenTextContext) return offscreenTextContext;
    }
    throw new Error('Canvas2D text measurement is unavailable before the first UI draw');
  }
  private measureTextBox(ctx: TextMeasurementContext) {
    ctx.font = renderFont(this.owner,this.font).toCSS();
    const lines = this.text.split('\n'), lineHeight = renderFont(this.owner,this.font).size * 1.35;
    const control = this.kind === 'CheckBox' ? lineHeight : 0;
    const contentWidth = Math.max(1, ...lines.map(line => ctx.measureText(line).width)) + control;
    const contentHeight = lines.length * lineHeight;
    return {lines, lineHeight, control, contentWidth, contentHeight,
      width: contentWidth + this.padding * 2, height: contentHeight + this.padding * 2};
  }
  /** Pixel size in public UISpace: content(0), padded content/background(1/2), or everything(3). */
  getSize(spaceOfInterest = 3): UIPoint {
    if (![0, 1, 2, 3].includes(spaceOfInterest)) throw new RangeError('Unknown UI size space');
    const context = this.textMeasurementContext();
    context.save();
    try {
      const layout = this.measureTextBox(context);
      const padding = spaceOfInterest === 0 ? 0 : this.padding * 2;
      const margin = spaceOfInterest === 3 ? this.margin * 2 : 0;
      return {x: layout.contentWidth + padding + margin, y: layout.contentHeight + padding + margin};
    } finally { context.restore(); }
  }
  setFont(value: ValueOrMutator<FontSettings>): this { return this.setTextFont(value); }
  setTextFillStyle(value: ValueOrMutator<FillStyle>): this { this.fill = resolveValue(value, this.fill); this.changed(); return this; }
  getTextFillStyle(): FillStyle { return this.fill; }
  setPosition(value: UIPoint): this { this.position = {...value}; this.events.emit('positionchange', this, this.position); this.changed(); return this; }
  getPosition(): UIPoint { return {...this.position}; }
  setOrigin(value: UIPoint): this { this.origin = {...value}; this.changed(); return this; }
  getOrigin(): UIPoint { return {...this.origin}; }
  setVisible(value: boolean): this { this.visible = value; this.changed(); return this; }
  getVisible(): boolean { return this.visible; }
  setBackground(value: ValueOrMutator<UIBackground>): this { this.background = resolveValue(value, this.background); this.changed(); return this; }
  getBackground(): UIBackground { return this.background; }
  setPadding(value: number | {left?: number; right?: number; top?: number; bottom?: number}): this { this.padding = typeof value === 'number' ? value : Math.max(...Object.values(value), 0); this.changed(); return this; }
  setMargin(value: number): this { this.margin = value; this.changed(); return this; }
  setPointerEvents(value: boolean): this { this.pointerEvents = value; return this; }
  setMouseInteractions(value: boolean): this { return this.setPointerEvents(value); }
  setEffect(value: boolean): this { this.effect = value; this.changed(); return this; }
  setRotation(value: number): this { this.rotation = value; this.changed(); return this; }
  setTextRotation(value: number): this { return this.setRotation(value); }
  setChecked(value: boolean): this { this.checked = value; this.events.emit('checkedchange', this, value); this.changed(); return this; }
  getChecked(): boolean { return this.checked; }
  on(type: string, listener: (...args: any[]) => void): EventToken { return this.events.on(type, listener); }
  off(token: EventToken): boolean;
  off(type: string, token: EventToken): boolean;
  off(typeOrToken: string | EventToken, token?: EventToken): boolean { return token === undefined ? this.events.off(typeOrToken as EventToken) : this.events.off(typeOrToken, token); }
  onDispose(listener: (element: this) => void): EventToken { return this.on('dispose', listener); }
  offDispose(token: EventToken): boolean { return this.off('dispose', token); }
  onMouseClick(listener: (...args: any[]) => void): EventToken { return this.on('click', listener); }
  onCheckedChange(listener: (...args: any[]) => void): EventToken { return this.on('checkedchange', listener); }
  onPositionChange(listener: (...args: any[]) => void): EventToken { return this.on('positionchange', listener); }
  isDisposed(): boolean { return this.disposed; }
  dispose(): this { if (!this.disposed) { this.disposed = true; this.lastDrawingContext = undefined; this.events.emit('dispose', this); this.events.clear(); this.changed(); } return this; }
  hitTest(point: UIPoint): boolean { const b = this.bounds; return this.visible && !this.disposed && this.pointerEvents && point.x >= b.left && point.x <= b.left + b.width && point.y >= b.top && point.y <= b.top + b.height; }
  handlePointer(type: string, point: UIPoint, event?: unknown): boolean {
    if (!this.hitTest(point)) return false;
    if (type === 'click' && this.kind === 'CheckBox') this.setChecked(!this.checked);
    this.events.emit(type, this, point, event); return true;
  }
  protected pixelPosition(rect: Rect, project?: UIProject): UIPoint {
    return project ? project(this.position, this.coordinates) : {x: rect.left + this.position.x / 100 * rect.width, y: rect.top + (1 - this.position.y / 100) * rect.height};
  }
  protected drawBox(ctx: CanvasRenderingContext2D, bounds: Rect): void {
    ctx.fillStyle = fillCSS(this.background.fill);
    if (this.background.fill !== emptyFill) ctx.fillRect(bounds.left, bounds.top, bounds.width, bounds.height);
    if (applyLine(ctx, this.background.stroke)) ctx.strokeRect(bounds.left, bounds.top, bounds.width, bounds.height);
  }
  draw(ctx: CanvasRenderingContext2D, rect: Rect, project?: UIProject): void {
    if (!this.visible || this.disposed) return;
    this.lastDrawingContext = ctx;
    ctx.save();
    try {
    ctx.font = renderFont(this.owner,this.font).toCSS(); ctx.textAlign = 'left';
    const {lines, lineHeight, control, width, height} = this.measureTextBox(ctx), p = this.pixelPosition(rect, project);
    this.bounds = {left: p.x - width * this.origin.x + this.margin, top: p.y - height * (1 - this.origin.y) + this.margin, width, height};
    const b = this.bounds; this.drawBox(ctx, b); ctx.fillStyle = fillCSS(this.fill, '#eaf2ff'); ctx.textBaseline = 'top';
    if (this.rotation) { ctx.translate(p.x, p.y); ctx.rotate(this.rotation * Math.PI / 180); ctx.translate(-p.x, -p.y); }
    lines.forEach((line, i) => ctx.fillText(line, b.left + this.padding + control, b.top + this.padding + i * lineHeight));
    if (control) { const x = b.left + this.padding, y = b.top + this.padding; ctx.strokeStyle = fillCSS(this.fill); ctx.strokeRect(x, y, control * .7, control * .7); if (this.checked) { ctx.beginPath(); ctx.moveTo(x + 2, y + control * .3); ctx.lineTo(x + control * .3, y + control * .6); ctx.lineTo(x + control * .65, y + 2); ctx.stroke(); } }
    } finally { ctx.restore(); }
  }
}

export class ResultTable extends UIElement {
  content: any[][] = [];
  setContent(value: any[][]): this { this.content = value.map(row => [...row]); this.changed(); return this; }
  getContent(): any[][] { return this.content.map(row => [...row]); }
  clear(): this { return this.setContent([]); }
  addRow(...cells: any[]): this { this.content.push(cells); this.changed(); return this; }
  prepareLayout(ctx:CanvasRenderingContext2D):ResultTableLayout {
    return prepareResultTableLayout(ctx,this.content,renderFont(this.owner,this.font),this.fill,this.padding);
  }
  override draw(ctx: CanvasRenderingContext2D, rect: Rect, project?: UIProject, prepared?:ResultTableLayout): void {
    if(!this.visible||this.disposed)return;
    const layout=prepared??this.prepareLayout(ctx);
    if(!layout.rich){
      const text=this.text;this.text=layout.plainText;
      try{super.draw(ctx,rect,project);}finally{this.text=text;}
      return;
    }
    ctx.save();
    try{
      const p=this.pixelPosition(rect,project);
      this.bounds={left:p.x-layout.width*this.origin.x+this.margin,top:p.y-layout.height*(1-this.origin.y)+this.margin,width:layout.width,height:layout.height};
      this.drawBox(ctx,this.bounds);
      if(this.rotation){ctx.translate(p.x,p.y);ctx.rotate(this.rotation*Math.PI/180);ctx.translate(-p.x,-p.y);}
      drawResultTableCells(ctx,layout,this.bounds.left,this.bounds.top);
    }finally{ctx.restore();}
  }
}

/** Public XY cursor coordinates. Point and result table scales are independent. */
export interface CursorPositionXY {
  pointMarker: UIPoint;
  pointMarkerScale?: any;
  resultTable?: UIPoint;
  resultTableScale?: any;
  pointMarkerFillStyle?: FillStyle;
  pointMarkerStrokeStyle?: LineStyle;
  pointMarkerShape?: number | string | Icon;
  pointMarkerSize?: UIPoint;
}
export type CursorPosition2D = CursorPositionXY;
export type CursorPositionInput = UIPoint | CursorPositionXY;

/** Mutable cursor marker styling, matching the consumer's mutator contract. */
export class CursorPointMarker {
  private shape: number | string | Icon = 1;
  private size: UIPoint = {x: 6, y: 6};
  private fill: FillStyle = new SolidFill({color: ColorRGBA(255, 255, 255)});
  private stroke: LineStyle = emptyLine;
  constructor(private readonly change: () => void = () => {}) {}
  setShape(shape: number | string | Icon): this {this.shape = shape; this.change(); return this;}
  getShape(): number | string | Icon {return this.shape;}
  setSize(size: number | UIPoint): this {
    const next = typeof size === 'number' ? {x: size, y: size} : {x: size.x, y: size.y};
    if (!Number.isFinite(next.x) || !Number.isFinite(next.y) || next.x < 0 || next.y < 0) throw new RangeError('Point marker size must be finite and nonnegative');
    this.size = next; this.change(); return this;
  }
  getSize(): UIPoint {return {...this.size};}
  setFillStyle(style: ValueOrMutator<FillStyle>): this {this.fill = resolveValue(style, this.fill); this.change(); return this;}
  getFillStyle(): FillStyle {return this.fill;}
  setStrokeStyle(style: ValueOrMutator<LineStyle>): this {this.stroke = resolveValue(style, this.stroke); this.change(); return this;}
  getStrokeStyle(): LineStyle {return this.stroke;}
}

function cloneCursorScale(scale: any): any {
  // Named axis dictionaries are value containers. Opaque chart scales are
  // identity tokens (including Polar's empty frozen objects) and must survive.
  return scale && typeof scale === 'object' && !scale.kind && ('x' in scale || 'y' in scale) ? {...scale} : scale;
}
function cloneCursorPosition(value: CursorPositionInput): CursorPositionXY {
  const source = {...value};
  if ('pointMarker' in source || 'resultTable' in source) {
    const p = source as unknown as CursorPositionXY;
    return {...p, pointMarker: {...p.pointMarker}, ...(p.resultTable ? {resultTable: {...p.resultTable}} : {}),
      ...(p.pointMarkerSize ? {pointMarkerSize: {...p.pointMarkerSize}} : {}),
      pointMarkerScale: cloneCursorScale(p.pointMarkerScale), resultTableScale: cloneCursorScale(p.resultTableScale)};
  }
  return {pointMarker: source as UIPoint};
}
function cursorPane(rect: Rect, coordinates: any): Rect {
  const range = (axis: any) => {
    const r = axis?.getScreenRange?.();
    return r && Number.isFinite(r.start) && Number.isFinite(r.end) ? {start: Math.max(0, Math.min(r.start, r.end)), end: Math.min(1, Math.max(r.start, r.end))} : {start: 0, end: 1};
  };
  const x = range(coordinates?.x), y = range(coordinates?.y);
  return {left: rect.left + x.start * rect.width, top: rect.top + (1 - y.end) * rect.height,
    width: Math.max(0, x.end - x.start) * rect.width, height: Math.max(0, y.end - y.start) * rect.height};
}

export class Cursor extends UIElement {
  gridX: LineStyle = new DashedLine({pattern: [3, 3], fillStyle: new SolidFill({color: ColorRGBA(160, 190, 220, 180)})});
  gridY: LineStyle = this.gridX; tickX = true; tickY = true; pointMarker = true; resultVisible = true; positioned = false;
  resultTable: ResultTable; points: UIPoint[] = []; solveMode: any; autoTextStyle = true;
  private positions: CursorPositionXY[] = [];
  private markerStyle = new CursorPointMarker(() => this.changed());
  private autoFit = true;
  private withinAxisBounds = false;
  constructor(owner: UIHost = {}, private readonly visibilityFollowsPosition=false) { super(owner, 'Cursor'); this.resultTable = new ResultTable(owner, 'ResultTable'); }
  override getVisible():boolean { return this.visible&&!this.disposed&&(!this.visibilityFollowsPosition||this.positioned); }
  override setPosition(...positions: CursorPositionInput[]): this {
    if (this.disposed) return this;
    // Complete all caller-controlled reads before replacing the previous positions.
    const next = positions.filter(Boolean).map(cloneCursorPosition), points = next.map(item => ({...item.pointMarker}));
    this.positions = next; this.points = points; this.positioned = next.length > 0;
    this.position = points[0] ? {...points[0]} : {x: 0, y: 0};
    if (!this.positioned) {this.resultTable.position = {x: 0, y: 0}; this.resultTable.bounds = {left: 0, top: 0, width: 0, height: 0};}
    this.events.emit('positionchange', this, this.getPosition()); this.changed(); return this;
  }
  /** CRY extension: immutable-by-copy position metadata; axis instances retain identity. */
  getPositions(): CursorPositionXY[] {return this.positions.map(cloneCursorPosition);}
  clearPosition(): this {return this.setPosition();}
  setGridStrokeXStyle(value: ValueOrMutator<LineStyle>): this { this.gridX = resolveValue(value, this.gridX); this.changed(); return this; }
  getGridStrokeXStyle(): LineStyle { return this.gridX; }
  setGridStrokeYStyle(value: ValueOrMutator<LineStyle>): this { this.gridY = resolveValue(value, this.gridY); this.changed(); return this; }
  getGridStrokeYStyle(): LineStyle { return this.gridY; }
  setTickMarkerXVisible(value: boolean): this { this.tickX = value; this.changed(); return this; }
  getTickMarkerXVisible(): boolean { return this.tickX; }
  setTickMarkerYVisible(value: boolean): this { this.tickY = value; this.changed(); return this; }
  getTickMarkerYVisible(): boolean { return this.tickY; }
  setPointMarkerVisible(value: boolean): this { this.pointMarker = value; this.changed(); return this; }
  getPointMarkerVisible(): boolean {return this.pointMarker;}
  setPointMarker(value: ValueOrMutator<CursorPointMarker>): this {
    if (!this.disposed) {this.markerStyle = resolveValue(value, this.markerStyle); this.changed();}
    return this;
  }
  getPointMarker(): CursorPointMarker {return this.markerStyle;}
  setResultTableVisible(value: boolean): this { this.resultVisible = value; this.changed(); return this; }
  getResultTableVisible(): boolean { return this.resultVisible; }
  setResultTable(value: ValueOrMutator<ResultTable>): this { this.resultTable = resolveValue(value, this.resultTable); this.changed(); return this; }
  getResultTable(): ResultTable { return this.resultTable; }
  setSolveMode(value: any): this { this.solveMode = value; return this; }
  setResultTableAutoTextStyle(value: boolean): this { this.autoTextStyle = value; return this; }
  setAutoFit(value: boolean): this {this.autoFit = value; this.changed(); return this;}
  getAutoFit(): boolean {return this.autoFit;}
  setKeepWithinAxisBoundaries(value: boolean): this {this.withinAxisBounds = value; this.changed(); return this;}
  getKeepWithinAxisBoundaries(): boolean {return this.withinAxisBounds;}
  override dispose(): this {
    if (this.disposed) return this;
    this.positions = []; this.points = []; this.position = {x: 0, y: 0}; this.positioned = false; this.solveMode = undefined;
    this.resultTable.content = []; this.resultTable.position = {x: 0, y: 0}; this.resultTable.bounds = {left: 0, top: 0, width: 0, height: 0};
    try {this.resultTable.dispose();} finally {
      try {super.dispose();} finally {this.events.clear(); this.resultTable.events.clear(); this.markerStyle = new CursorPointMarker();}
    }
    return this;
  }
  private drawPointMarker(ctx: CanvasRenderingContext2D, point: UIPoint, position: CursorPositionXY): void {
    const fill = position.pointMarkerFillStyle ?? this.markerStyle.getFillStyle(), stroke = position.pointMarkerStrokeStyle ?? this.markerStyle.getStrokeStyle();
    const size = position.pointMarkerSize ?? this.markerStyle.getSize(), width = size.x, height = size.y;
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
    const shape = position.pointMarkerShape ?? this.markerStyle.getShape(), x = point.x, y = point.y;
    ctx.save();
    try {
      if(shape instanceof Icon){
        const source=shape.getCanvasSource();
        if(source)ctx.drawImage(source,x-width/2,y-height/2,width,height);
        return;
      }
      ctx.beginPath();
      if (shape === 1 || shape === 'circle') {
        if (width === height) ctx.arc(x, y, width / 2, 0, Math.PI * 2);
        else ctx.ellipse(x, y, width / 2, height / 2, 0, 0, Math.PI * 2);
      } else if (shape === 2 || shape === 'triangle') {ctx.moveTo(x, y - height / 2); ctx.lineTo(x + width / 2, y + height / 2); ctx.lineTo(x - width / 2, y + height / 2); ctx.closePath();}
      else if (shape === 4 || shape === 'diamond') {ctx.moveTo(x, y - height / 2); ctx.lineTo(x + width / 2, y); ctx.lineTo(x, y + height / 2); ctx.lineTo(x - width / 2, y); ctx.closePath();}
      else if (shape === 3 || shape === 5 || shape === 'cross' || shape === 'plus') {
        ctx.translate(x, y); if (shape === 3 || shape === 'cross') ctx.rotate(Math.PI / 4);
        ctx.rect(-width / 6, -height / 2, width / 3, height); ctx.rect(-width / 2, -height / 6, width, height / 3);
      } else if (shape === 6 || shape === 'minus') ctx.rect(x - width / 2, y - height / 6, width, height / 3);
      else if (shape === 7 || shape === 'arrow') {ctx.moveTo(x, y - height / 2); ctx.lineTo(x + width / 2, y); ctx.lineTo(x + width / 6, y); ctx.lineTo(x + width / 6, y + height / 2); ctx.lineTo(x - width / 6, y + height / 2); ctx.lineTo(x - width / 6, y); ctx.lineTo(x - width / 2, y); ctx.closePath();}
      else if (shape === 8 || shape === 'star') {
        for (let i = 0; i < 10; i++) {const a = i * Math.PI / 5 - Math.PI / 2, scale = i % 2 ? .22 : .5, px = x + Math.cos(a) * width * scale, py = y + Math.sin(a) * height * scale; if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);} ctx.closePath();
      } else ctx.rect(x - width / 2, y - height / 2, width, height);
      if (fill !== emptyFill && fill.kind !== 'empty') {ctx.fillStyle = fillCSS(fill, '#ffffff'); ctx.fill();}
      if (applyLine(ctx, stroke)) ctx.stroke();
    } finally {ctx.restore();}
  }
  /** @internal Shared measured table placement for native XY and Polar cursors. */
  drawResultTable(ctx: CanvasRenderingContext2D, rect: Rect, anchor: UIPoint, prepared?:ResultTableLayout): void {
    const table = this.resultTable;
    const layout=prepared??table.prepareLayout(ctx);
    let position = {x: anchor.x + 12, y: anchor.y - 35};
    if (this.autoFit) {
      ctx.save();
      try {
        let {width,height}=layout;
        if(!layout.rich){
          // Retain the pre-existing plain-string placement path, including its
          // row-based measurements. Rich rows use the prepared cell geometry.
          ctx.font=renderFont(table.owner,table.font).toCSS();
          const lines=table.content.map(row=>row.map(cell=>String(cell??'')).join('    '));
          width=Math.max(1,...lines.map(line=>ctx.measureText(line).width))+table.padding*2;
          height=Math.max(1,lines.length)*renderFont(table.owner,table.font).size*1.35+table.padding*2;
        }
        const left = position.x - width * table.origin.x + table.margin, top = position.y - height * (1 - table.origin.y) + table.margin;
        const fitLeft = Math.max(rect.left, Math.min(left, rect.left + rect.width - width));
        const fitTop = Math.max(rect.top, Math.min(top, rect.top + rect.height - height));
        position = {x: position.x + fitLeft - left, y: position.y + fitTop - top};
      } finally {ctx.restore();}
    }
    table.position = position; table.draw(ctx, rect, point => point,layout);
  }
  override draw(ctx: CanvasRenderingContext2D, rect: Rect, project?: UIProject,formats?:{x:(value:number,position:CursorPositionXY)=>string;y:(value:number,position:CursorPositionXY)=>string}): void {
    if (!this.visible || this.disposed || !this.positioned) return;
    // The chart's auto cursor can still provide its legacy direct position field.
    const positions: CursorPositionXY[] = this.positions.length ? this.positions : [{pointMarker: this.position}];
    const projected: Array<{position: CursorPositionXY; pixel: UIPoint; pane: Rect}> = [];
    let tableAnchor: {pixel: UIPoint; pane: Rect} | undefined;
    const transform = (point: UIPoint, scale?: any) => project ? project(point, scale) : point;
    for (const position of positions) {
      const pixel = transform(position.pointMarker, position.pointMarkerScale), pane = cursorPane(rect, position.pointMarkerScale);
      if (pixel && Number.isFinite(pixel.x) && Number.isFinite(pixel.y)) projected.push({position, pixel, pane});
      if (!tableAnchor && position.resultTable) {
        const location = transform(position.resultTable, position.resultTableScale);
        if (location && Number.isFinite(location.x) && Number.isFinite(location.y)) tableAnchor = {pixel: location, pane};
      }
    }
    const strokes = new Set<string>();
    for (const {position, pixel: p, pane} of projected) {
      ctx.save();
      try {
        ctx.beginPath(); ctx.rect(pane.left, pane.top, pane.width, pane.height); ctx.clip();
        const xKey = `x:${p.x}:${pane.top}:${pane.height}`, yKey = `y:${p.y}:${pane.left}:${pane.width}`;
        if (!strokes.has(xKey) && applyLine(ctx, this.gridX)) {ctx.beginPath(); ctx.moveTo(p.x, pane.top); ctx.lineTo(p.x, pane.top + pane.height); ctx.stroke(); strokes.add(xKey);}
        if (!strokes.has(yKey) && applyLine(ctx, this.gridY)) {ctx.beginPath(); ctx.moveTo(pane.left, p.y); ctx.lineTo(pane.left + pane.width, p.y); ctx.stroke(); strokes.add(yKey);}
        if (this.pointMarker) this.drawPointMarker(ctx, p, position);
      } finally {ctx.restore();}
    }
    ctx.save();
    try {
    ctx.font = renderFont(this.owner,this.font).toCSS(); ctx.fillStyle = fillCSS(this.fill, '#ffffff');
    const format = (value: number) => Number.isFinite(value) ? Number(value.toPrecision(6)).toString() : '';
    const marker=(text:string,x:number,y:number,horizontal:boolean)=>{
      const width=ctx.measureText(text).width+8,height=renderFont(this.owner,this.font).size*1.35+6,left=horizontal?x-width/2:x-width,top=horizontal?y:y-height/2;
      this.drawBox(ctx,{left,top,width,height});ctx.fillStyle=fillCSS(this.fill,'#ffffff');ctx.textAlign=horizontal?'center':'right';ctx.textBaseline=horizontal?'top':'middle';ctx.fillText(text,horizontal?x:x-4,horizontal?y+3:y);
    };
    const ticks = new Set<string>();
    for (const {position, pixel: p, pane} of projected) {
      const x = position.pointMarker.x, y = position.pointMarker.y;
      const textX = this.tickX ? String(formats?.x(x,position) ?? position.pointMarkerScale?.x?.formatValue?.(x) ?? format(x)) : '';
      const textY = this.tickY ? String(formats?.y(y,position) ?? position.pointMarkerScale?.y?.formatValue?.(y) ?? format(y)) : '';
      const xKey = `${p.x}:${pane.top + pane.height}:${textX}`, yKey = `${pane.left}:${p.y}:${textY}`;
      if (this.tickX && p.x >= pane.left && p.x <= pane.left + pane.width && !ticks.has(`x:${xKey}`)) {marker(textX, p.x, pane.top + pane.height + 1, true); ticks.add(`x:${xKey}`);}
      if (this.tickY && p.y >= pane.top && p.y <= pane.top + pane.height && !ticks.has(`y:${yKey}`)) {marker(textY, pane.left - 2, p.y, false); ticks.add(`y:${yKey}`);}
    }
    } finally {ctx.restore();}
    if (!tableAnchor && projected.length) tableAnchor = {pixel: projected[0].pixel, pane: projected[0].pane};
    if (this.resultVisible && this.resultTable.content.length && tableAnchor) this.drawResultTable(ctx, this.withinAxisBounds ? tableAnchor.pane : rect, tableAnchor.pixel);
  }
}

export class LegendBox extends UIElement {
  private entries: any[] = []; private entryRects: Rect[] = []; title = ''; rowHeight = 22;
  constructor(owner: UIHost = {}, options: any = {}) { super(owner, 'LegendBox'); this.position = options.position ?? {x: 100, y: 100}; this.origin = UIOrigins.RightTop; }
  add(target: any): this { const items = typeof target?.getSeries === 'function' ? target.getSeries() : [target]; for (const item of items) if (item && !this.entries.includes(item)) this.entries.push(item); this.changed(); return this; }
  remove(target: any): this { this.entries = this.entries.filter(x => x !== target); this.changed(); return this; }
  getEntries(): any[] { return [...this.entries]; }
  setTitle(title: string): this { this.title = title; this.changed(); return this; }
  override draw(ctx: CanvasRenderingContext2D, rect: Rect, project?: UIProject): void {
    if (!this.visible || this.disposed) return;
    this.entries = this.entries.filter(entry => !entry.isDisposed?.());
    ctx.save(); ctx.font = renderFont(this.owner,this.font).toCSS();
    const labels = this.entries.map((entry, i) => entry.getName?.() || entry.name || `Series ${i + 1}`);
    const width = Math.max(90, ...labels.map(label => ctx.measureText(label).width + 42), ctx.measureText(this.title).width + 20);
    const titleHeight = this.title ? this.rowHeight : 0, height = this.entries.length * this.rowHeight + this.padding * 2 + titleHeight;
    const p = this.pixelPosition(rect, project); this.bounds = {left: p.x - width * this.origin.x, top: p.y - height * (1 - this.origin.y), width, height};
    this.drawBox(ctx, this.bounds); this.entryRects = [];
    if (this.title) { ctx.fillStyle = fillCSS(this.fill); ctx.textBaseline = 'middle'; ctx.fillText(this.title, this.bounds.left + 10, this.bounds.top + this.padding + this.rowHeight / 2); }
    this.entries.forEach((entry, i) => {
      const top = this.bounds.top + this.padding + titleHeight + i * this.rowHeight;
      this.entryRects.push({left: this.bounds.left, top, width, height: this.rowHeight});
      ctx.globalAlpha = entry.getVisible?.() === false ? .35 : 1;
      const style = entry.getStrokeStyle?.(); ctx.fillStyle = fillCSS(entry.getFillStyle?.() ?? style?.getFillStyle?.() ?? entry.getPointFillStyle?.(), '#38bdf8');
      ctx.fillRect(this.bounds.left + 9, top + 6, 14, 10); ctx.fillStyle = fillCSS(this.fill, '#eaf2ff'); ctx.textBaseline = 'middle'; ctx.fillText(labels[i], this.bounds.left + 30, top + this.rowHeight / 2);
    }); ctx.restore();
  }
  override handlePointer(type: string, point: UIPoint, event?: unknown): boolean {
    if (!this.hitTest(point)) return false;
    if (type === 'click') {
      const index = this.entryRects.findIndex(b => point.y >= b.top && point.y < b.top + b.height);
      const entry = this.entries[index]; if (entry?.setVisible) { entry.setVisible(entry.getVisible?.() === false); this.events.emit('entryclick', this, entry); this.changed(); }
    }
    this.events.emit(type, this, point, event); return true;
  }
}
