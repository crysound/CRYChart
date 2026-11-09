import {highlightColor as componentHighlightColor} from './component-highlight.js';
import {EventHub, type EventToken} from './core/events.js';
import {Color, ColorHEX, ColorRGBA, FontSettings, LUT, SolidFill, SolidLine, Themes, resolveValue, type FillStyle, type Theme, type ValueOrMutator} from './core/styles.js';
import {Cursor, LegendBox, UIElement, applyLine, fillCSS, type UIPoint} from './ui.js';
import {validateSolveMode, type SolveNearestMode} from './cursor-api.js';
import type {Rect} from './contracts.js';

export interface SpecialtyOptions {container?: string | HTMLElement; theme?: Theme; width?: number; height?: number; headless?: boolean; [key: string]: unknown; }
interface Hit {contains(point: UIPoint): boolean; data: any; label: string; activate?: () => void; }
const TAU = Math.PI * 2;
const finite = (value: unknown, fallback = 0): number => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const inside = (rect: Rect, p: UIPoint) => p.x >= rect.left && p.x <= rect.left + rect.width && p.y >= rect.top && p.y <= rect.top + rect.height;
const lastHit = (hits: readonly Hit[], point: UIPoint): Hit | undefined => { for (let i = hits.length - 1; i >= 0; i--) if (hits[i].contains(point)) return hits[i]; return undefined; };
const compact = (value: number) => Math.abs(value) >= 1e6 ? `${Number((value / 1e6).toPrecision(3))}M` : Math.abs(value) >= 1e3 ? `${Number((value / 1e3).toPrecision(3))}k` : Number(value.toPrecision(4)).toString();
function fittedText(ctx: CanvasRenderingContext2D, value: string, width: number): string {if (ctx.measureText(value).width <= width) return value; let end = value.length; while (end && ctx.measureText(value.slice(0, end) + '…').width > width) end--; return end ? value.slice(0, end) + '…' : '';}
function roundedPath(ctx: CanvasRenderingContext2D, rect: Rect, radius: number | number[]): void {ctx.beginPath(); if (typeof ctx.roundRect === 'function') ctx.roundRect(rect.left, rect.top, rect.width, rect.height, radius); else ctx.rect(rect.left, rect.top, rect.width, rect.height);}

/** Independent panel lifecycle shared by categorical and tabular charts. */
export abstract class SpecialtyChart {
  readonly events = new EventHub(); readonly theme: Theme; readonly canvas?: HTMLCanvasElement; readonly container?: HTMLElement;
  readonly ui: UIElement[] = []; readonly engine: {captureFrame: (type?: string) => Blob; layout: () => void};
  title = ''; titleFont = new FontSettings({size: 17, weight: 600}); titleAlignment: 'left' | 'center' | 'right' = 'left'; background: FillStyle; visible = true; disposed = false;
  width: number; height: number; padding = 18; protected hits: Hit[] = []; protected hovered?: Hit; protected selected: any;
  protected pointer: UIPoint = {x: 0, y: 0}; protected dragging = false;
  private context?: CanvasRenderingContext2D; private frame?: number; private resizeObserver?: ResizeObserver;
  private readonly cleanup: Array<() => void> = [];
  constructor(options: SpecialtyOptions = {}) {
    this.theme = options.theme ?? Themes.dark; this.background = this.theme.backgroundFillStyle; this.width = options.width ?? 640; this.height = options.height ?? 360;
    this.engine = {captureFrame: (type = 'image/png') => this.captureFrame(type), layout: () => this.layout()};
    if (typeof document !== 'undefined' && !options.headless) {
      const host = typeof options.container === 'string' ? document.getElementById(options.container) : options.container;
      if (options.container && !host) throw new Error(`Chart container does not exist: ${options.container}`);
      this.container = host ?? document.body; this.canvas = document.createElement('canvas'); this.canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;outline:none';
      this.canvas.tabIndex = 0; this.canvas.setAttribute('role', 'img'); this.container.appendChild(this.canvas);
      this.context = this.canvas.getContext('2d') ?? undefined;
      const bind = (name: string, listener: EventListener) => { this.canvas!.addEventListener(name, listener); this.cleanup.push(() => this.canvas!.removeEventListener(name, listener)); };
      const point = (event: Pick<MouseEvent, 'clientX' | 'clientY'>) => { const b = this.canvas!.getBoundingClientRect(); return {x: event.clientX - b.left, y: event.clientY - b.top}; };
      bind('pointermove', ((event: PointerEvent) => { this.pointer = point(event); if (this.dragging) this.dragAt(this.pointer); const hit = lastHit(this.hits, this.pointer); this.hovered = hit ? {...hit} : undefined; this.canvas!.style.cursor = this.hovered ? 'pointer' : 'default'; this.events.emit('pointermove', {chart: this, position: this.pointer, item: this.hovered?.data}); this.invalidate(); }) as EventListener);
      bind('pointerleave', (() => { this.hovered = undefined; this.invalidate(); }) as EventListener);
      bind('pointerdown', ((event: PointerEvent) => { this.pointer = point(event); this.dragging = true; this.canvas!.setPointerCapture?.(event.pointerId); this.dragAt(this.pointer); }) as EventListener);
      bind('pointerup', ((event: PointerEvent) => { this.pointer = point(event); this.endDragAt(this.pointer); this.dragging = false; this.canvas!.releasePointerCapture?.(event.pointerId); }) as EventListener);
      bind('pointercancel', (() => { this.endDragAt(this.pointer); this.dragging = false; }) as EventListener);
      bind('click', ((event: PointerEvent) => { const p = point(event); if (this.ui.some(ui => ui.handlePointer('click', p, event))) return; this.activateAt(p); }) as EventListener);
      bind('dblclick', ((event: MouseEvent) => { this.doubleClickAt(point(event)); }) as EventListener);
      bind('wheel', ((event: WheelEvent) => { this.pointer = point(event); if (this.wheel(event.deltaY)) { event.preventDefault(); this.invalidate(); } }) as EventListener);
      bind('keydown', ((event: KeyboardEvent) => { if (this.key(event.key)) { event.preventDefault(); this.invalidate(); } }) as EventListener);
      if (typeof ResizeObserver !== 'undefined') { this.resizeObserver = new ResizeObserver(() => this.layout()); this.resizeObserver.observe(this.container); }
      this.layout();
    }
  }
  invalidate(): void { if (!this.disposed && this.context && this.frame === undefined) this.frame = requestAnimationFrame(() => { this.frame = undefined; this.render(); }); }
  layout(): this {
    if (this.canvas && this.container) {
      this.width = Math.max(1, this.container.clientWidth || this.width); this.height = Math.max(1, this.container.clientHeight || this.height);
      const dpr = Math.max(1, globalThis.devicePixelRatio || 1); const w = Math.round(this.width * dpr), h = Math.round(this.height * dpr);
      if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
      this.invalidate();
    } return this;
  }
  render(context = this.context): void {
    if (!context || this.disposed || !this.visible) return;
    const ctx = context, dpr = this.canvas ? this.canvas.width / this.width : 1;
    ctx.save(); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, this.width, this.height);
    ctx.fillStyle = fillCSS(this.background, '#101923'); ctx.fillRect(0, 0, this.width, this.height);
    const foreground = this.theme.textColor?.toCSS?.() ?? fillCSS(this.theme.chartTitleFillStyle, '#e7edf4');
    ctx.fillStyle = foreground; ctx.font = this.titleFont.toCSS(); ctx.textBaseline = 'top'; ctx.textAlign = this.titleAlignment;
    if (this.title) ctx.fillText(this.title, this.titleAlignment === 'center' ? this.width / 2 : this.titleAlignment === 'right' ? this.width - this.padding : this.padding, 15, this.width - this.padding * 2);
    this.hits = []; this.renderPlot(ctx, this.plotRect());
    this.ui.forEach(ui => ui.draw(ctx, this.plotRect()));
    if (this.hovered) {
      // A dynamic hit may reuse its object when a later click resolves another row.
      // Keep the last pointer's resolved value independent from that lookup.
      const hoveredData = this.hovered.data, matching = this.hits.find(hit => hit.contains(this.pointer) && hit.data === hoveredData); this.hovered = matching ? {...matching} : undefined;
      if (matching) this.drawTooltip(ctx, matching.label);
    }
    this.onHoverResolved(this.hovered);
    ctx.restore();
  }
  protected plotRect(): Rect { const top = this.title ? 48 : 18; return {left: this.padding, top, width: Math.max(1, this.width - this.padding * 2), height: Math.max(1, this.height - top - this.padding)}; }
  protected abstract renderPlot(ctx: CanvasRenderingContext2D, rect: Rect): void;
  protected onHoverResolved(_hit:Hit|undefined):void {}
  protected color(index: number, datum?: any): string { const color = datum?.color; return color instanceof Color ? color.toCSS() : typeof color === 'string' ? color : fillCSS(datum?.fillStyle, this.theme.dataColors[index % this.theme.dataColors.length]?.toCSS() ?? '#20b8f0'); }
  protected textColor(): string { return this.theme.textColor?.toCSS?.() ?? '#cbd5e1'; }
  protected hitRect(rect: Rect, data: any, label: string, activate?: () => void): void { this.hits.push({contains: p => inside(rect, p), data, label, activate}); }
  protected dragAt(_point: UIPoint): void {}
  protected endDragAt(_point: UIPoint): void {}
  doubleClickAt(_point: UIPoint): void {}
  protected wheel(_delta: number): boolean { return false; }
  protected key(_key: string): boolean { return false; }
  activateAt(point: UIPoint): any {
    const hit = lastHit(this.hits, point);
    if (hit) { this.selected = this.selected === hit.data ? undefined : hit.data; hit.activate?.(); this.events.emit('select', {chart: this, item: hit.data}); this.invalidate(); }
    return hit?.data;
  }
  protected drawTooltip(ctx: CanvasRenderingContext2D, label: string): void {
    const lines = label.split('\n'); ctx.font = '12px sans-serif'; const width = Math.min(this.width - 16, Math.max(...lines.map(line => ctx.measureText(line).width)) + 18), height = lines.length * 18 + 12;
    const left = Math.max(4, Math.min(this.pointer.x + 12, this.width - width - 4)), top = Math.max(4, Math.min(this.pointer.y + 12, this.height - height - 4));
    ctx.fillStyle = 'rgba(10,18,28,.94)'; ctx.fillRect(left, top, width, height); ctx.fillStyle = '#f8fafc'; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; lines.forEach((line, i) => ctx.fillText(line, left + 9, top + 6 + i * 18, width - 18));
  }
  setTitle(title: string): this { this.title = String(title); this.canvas?.setAttribute('aria-label', this.title); this.invalidate(); return this; }
  getTitle(): string { return this.title; }
  setTitleAlignment(value: 'left' | 'center' | 'right'): this {this.titleAlignment = value; this.invalidate(); return this;}
  getSelectedItem(): any {return this.selected;}
  setTitleFont(value: ValueOrMutator<FontSettings>): this { this.titleFont = resolveValue(value, this.titleFont); this.invalidate(); return this; }
  setBackgroundFillStyle(value: ValueOrMutator<FillStyle>): this { this.background = resolveValue(value, this.background); this.invalidate(); return this; }
  getBackgroundFillStyle(): FillStyle { return this.background; }
  setPadding(value: number | {left?: number; top?: number; right?: number; bottom?: number}): this { this.padding = typeof value === 'number' ? value : Math.max(0, ...Object.values(value)); this.invalidate(); return this; }
  setVisible(value: boolean): this { this.visible = value; if (this.canvas) this.canvas.style.visibility = value ? 'visible' : 'hidden'; this.invalidate(); return this; }
  getVisible(): boolean { return this.visible; }
  addUIElement(builder: any, coordinates?: any): UIElement { const item = new UIElement(this, builder, coordinates); this.ui.push(item); return item; }
  addLegendBox(options?: any): LegendBox { const legend = new LegendBox(this, options); this.ui.push(legend); return legend; }
  on(type: string, listener: (...args: any[]) => void): EventToken { return this.events.on(type, listener); }
  off(typeOrToken: string | EventToken, token?: EventToken): boolean { return token === undefined ? this.events.off(typeOrToken as EventToken) : this.events.off(typeOrToken, token); }
  onDispose(listener: (chart: this) => void): EventToken { return this.on('dispose', listener); }
  getSeries(): any[] { return []; }
  isDisposed(): boolean { return this.disposed; }
  dispose(): this { if (!this.disposed) { this.disposed = true; if (this.frame !== undefined) cancelAnimationFrame(this.frame); this.resizeObserver?.disconnect(); this.cleanup.forEach(fn => fn()); this.ui.forEach(ui => ui.dispose()); this.canvas?.remove(); this.events.emit('dispose', this); this.events.clear(); } return this; }
  captureFrame(type = 'image/png'): Blob {
    if (!this.canvas) throw new Error('Image export requires a browser canvas');
    this.render(); const url = this.canvas.toDataURL(type), bytes = atob(url.slice(url.indexOf(',') + 1));
    return new Blob([Uint8Array.from(bytes, c => c.charCodeAt(0))], {type: url.slice(5, url.indexOf(';'))});
  }
}

export class PieSlice {
  visible = true; disposed = false; fillStyle?: FillStyle; strokeStyle = new SolidLine({fillStyle: new SolidFill({color: ColorRGBA(255, 255, 255, 90)})});
  private exploded=false;
  constructor(readonly chart: Pie, public name: string, public value: number) {}
  setValue(value: number): this { if (!Number.isFinite(value) || value < 0) throw new RangeError('Slice value must be finite and nonnegative'); this.value = value; this.chart.invalidate(); return this; }
  getValue(): number { return this.value; }
  setName(name: string): this { this.name = name; this.chart.invalidate(); return this; }
  getName(): string { return this.name; }
  setFillStyle(value: FillStyle): this { this.fillStyle = value; this.chart.invalidate(); return this; }
  getFillStyle(): FillStyle | undefined { return this.fillStyle; }
  setStrokeStyle(value: ValueOrMutator<SolidLine>): this { this.strokeStyle = resolveValue(value, this.strokeStyle); this.chart.invalidate(); return this; }
  setVisible(value: boolean): this { this.visible = value; this.chart.invalidate(); return this; }
  getVisible(): boolean { return this.visible; }
  setExploded(value:boolean):this {this.chart.setSliceExploded(this,Boolean(value));return this;}
  getExploded():boolean {return this.exploded;}
  /** @internal The chart owns mutual exclusion between live slices. */
  applyExploded(value:boolean):void {this.exploded=value;}
  dispose(): this { this.disposed = true; this.chart.invalidate(); return this; }
  isDisposed(): boolean { return this.disposed; }
}
export function pieAngles(values: readonly number[], start = -Math.PI / 2): Array<{start: number; end: number}> {
  const sum = values.reduce((total, value) => total + Math.max(0, finite(value)), 0);
  let angle = start; return values.map(value => { const first = angle; angle += sum ? Math.max(0, finite(value)) / sum * TAU : 0; return {start: first, end: angle}; });
}
export class Pie extends SpecialtyChart {
  readonly slices: PieSlice[] = []; innerRadius = 0;
  private labelPosition: 'inside' | 'outside' = 'outside'; private labelEffect = false; private radiusFactor = .39; private selectionOffset = 20;
  private multipleExplosion=false;
  private cursorMode:SolveNearestMode|undefined='show-nearest';
  private readonly nativeCursor=new Cursor(this);
  private customCursor?:((event:any)=>unknown);
  private sorter?: (a: PieSlice, b: PieSlice) => number; private labelFormatter = (slice: PieSlice, _relativeValue: number) => slice.name;
  private centerLabel: string | ((total: number) => string) = ''; private labelFont = new FontSettings({size: 12});
  addSlice(name: string | {name?: string; value?: number}, value = 0): PieSlice { const slice = new PieSlice(this, typeof name === 'string' ? name : name.name ?? '', typeof name === 'string' ? value : name.value ?? 0); slice.setValue(slice.value); this.slices.push(slice); this.invalidate(); return slice; }
  addSlices(data: Array<{name: string; value: number}>): this { data.forEach(item => this.addSlice(item)); return this; }
  setInnerRadius(value: number): this {if(!Number.isFinite(value)||value<0||value>100)throw new RangeError('Pie inner radius must be a percentage in [0, 100]');this.innerRadius=value/100;this.invalidate();return this;}
  getInnerRadius():number {return this.innerRadius*100;}
  getSlices():PieSlice[] {return this.slices.filter(slice=>!slice.disposed);}
  setMultipleSliceExplosion(value:boolean):this {this.multipleExplosion=Boolean(value);return this;}
  getMultipleSliceExplosion(){return this.multipleExplosion;}
  setSliceExplosionOffset(value:number):this {return this.setSelectionOffset(value);}
  getSliceExplosionOffset(){return this.selectionOffset;}
  /** @internal Shared by explicit state changes and actual slice activation. */
  setSliceExploded(slice:PieSlice,value:boolean):void {
    if(slice.disposed||this.disposed)return;
    if(value&&!this.multipleExplosion)for(const other of this.slices)if(other!==slice)other.applyExploded(false);
    slice.applyExploded(value);if(value)this.selected=slice;else if(this.selected===slice)this.selected=undefined;this.invalidate();
  }
  setCursorMode(value:SolveNearestMode|undefined):this {if(value!==undefined)validateSolveMode(value);this.cursorMode=value;this.invalidate();return this;}
  getCursorMode(){return this.cursorMode;}
  setCursor(mutator:(cursor:Cursor)=>Cursor):this {mutator(this.nativeCursor);return this;}
  getCursor(){return this.nativeCursor;}
  setCustomCursor(value:((event:any)=>unknown)|undefined):this {
    if(value!==undefined&&typeof value!=='function')throw new TypeError('Custom cursor must be a function');
    this.customCursor=value;this.nativeCursor.visible=!value;this.invalidate();return this;
  }
  protected override onHoverResolved(hit:Hit|undefined):void {
    if(!this.customCursor)return;
    const slice=hit?.data as PieSlice|undefined,valid=this.cursorMode!==undefined&&slice&&!slice.disposed&&slice.visible;
    const total=this.slices.reduce((sum,item)=>sum+(item.visible&&!item.disposed?item.value:0),0),box=this.canvas?.getBoundingClientRect()??{left:0,top:0};
    const point={x:this.pointer.x,y:this.pointer.y},resolved=valid?{category:slice.name,value:slice.value,relativeValue:total?slice.value/total:0,slice,cursorPosition:{pointMarker:point,resultTable:point}}:undefined;
    this.customCursor({hit:resolved,hits:resolved?[resolved]:[],mouseLocation:{clientX:box.left+point.x,clientY:box.top+point.y}});
  }
  protected override drawTooltip(ctx:CanvasRenderingContext2D,label:string):void {if(!this.customCursor&&this.cursorMode!==undefined&&this.nativeCursor.visible)super.drawTooltip(ctx,label);}
  override dispose():this {if(!this.disposed){for(const slice of this.slices)slice.dispose();this.nativeCursor.dispose();this.customCursor=undefined;this.slices.length=0;}return super.dispose();}
  setLabelPosition(value: 'inside' | 'outside'): this {this.labelPosition = value; this.invalidate(); return this;}
  setLabelFormatter(value: (slice: PieSlice, relativeValue: number) => string): this {this.labelFormatter = value; this.invalidate(); return this;}
  setLabelFont(value: ValueOrMutator<FontSettings>): this {this.labelFont = resolveValue(value, this.labelFont); this.invalidate(); return this;}
  setLabelEffect(value: boolean): this {this.labelEffect = value; this.invalidate(); return this;}
  setCenterLabel(value: string | ((total: number) => string)): this {this.centerLabel = value; this.invalidate(); return this;}
  setSliceSorter(value: (a: PieSlice, b: PieSlice) => number): this {this.sorter = value; this.invalidate(); return this;}
  setRadiusFactor(value: number): this {if (!Number.isFinite(value) || value <= 0 || value > .5) throw new RangeError('Pie radius factor must be in (0, .5]'); this.radiusFactor = value; this.invalidate(); return this;}
  setSelectionOffset(value: number): this {if (!Number.isFinite(value) || value < 0) throw new RangeError('Pie selection offset must be nonnegative'); this.selectionOffset = value; this.invalidate(); return this;}
  override getSeries(): PieSlice[] { return this.slices.filter(x => !x.disposed); }
  protected renderPlot(ctx: CanvasRenderingContext2D, rect: Rect): void {
    const items = this.slices.filter(x => x.visible && !x.disposed); if (this.sorter) items.sort(this.sorter);
    const total = items.reduce((sum, x) => sum + x.value, 0), angles = pieAngles(items.map(x => x.value));
    const radius = Math.max(1, Math.min(rect.width, rect.height) * this.radiusFactor), cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    items.forEach((slice, i) => {
      const a = angles[i], middle = (a.start + a.end) / 2, offset = slice.getExploded() ? this.selectionOffset : 0, x = cx + Math.cos(middle) * offset, y = cy + Math.sin(middle) * offset;
      ctx.beginPath(); ctx.arc(x, y, radius, a.start, a.end); if (this.innerRadius) ctx.arc(x, y, radius * this.innerRadius, a.end, a.start, true); else ctx.lineTo(x, y); ctx.closePath(); ctx.fillStyle = this.color(i, slice); ctx.fill(); if (applyLine(ctx, slice.strokeStyle)) ctx.stroke();
      if (slice.value > 0 && this.innerRadius<1) this.hits.push({data: slice, label: `${slice.name}: ${compact(slice.value)} (${(slice.value / total * 100).toFixed(1)}%)`, contains: p => { const dx = p.x - x, dy = p.y - y, r = Math.hypot(dx, dy), angle = ((Math.atan2(dy, dx) + Math.PI / 2 + TAU) % TAU) - Math.PI / 2; return r >= radius * this.innerRadius && r <= radius && angle >= a.start && angle <= a.end; },activate:()=>slice.setExploded(!slice.getExploded())});
      if (a.end - a.start > .06) {
        const inner = this.labelPosition === 'inside', labelRadius = inner ? radius * (this.innerRadius ? (1 + this.innerRadius) / 2 : .59) : radius + 34;
        const lx = x + Math.cos(middle) * labelRadius, ly = y + Math.sin(middle) * labelRadius, text = this.labelFormatter(slice, total ? slice.value / total : 0);
        ctx.save(); ctx.fillStyle = this.textColor(); ctx.font = this.labelFont.toCSS(); ctx.textBaseline = 'middle'; ctx.textAlign = inner ? 'center' : Math.cos(middle) >= 0 ? 'left' : 'right';
        if (!inner) {ctx.strokeStyle = 'rgba(220,220,200,.65)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x + Math.cos(middle) * (radius + 4), y + Math.sin(middle) * (radius + 4)); ctx.lineTo(lx, ly); ctx.lineTo(lx + (Math.cos(middle) >= 0 ? 9 : -9), ly); ctx.stroke();}
        const tx = lx + (inner ? 0 : Math.cos(middle) >= 0 ? 13 : -13);
        if (this.labelEffect) {ctx.strokeStyle = 'rgba(0,0,0,.95)'; ctx.lineWidth = 2.5; ctx.lineJoin = 'round'; ctx.strokeText(text, tx, ly);}
        ctx.fillText(text, tx, ly, Math.max(1, inner ? radius * .85 : rect.width * .27)); ctx.restore();
      }
    });
    if (this.centerLabel) {ctx.fillStyle = this.textColor(); ctx.font = '24px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(typeof this.centerLabel === 'function' ? this.centerLabel(total) : this.centerLabel, cx, cy, Math.max(1, radius * this.innerRadius * 1.9));}
    if (!total) { ctx.fillStyle = this.textColor(); ctx.textAlign = 'center'; ctx.fillText('No positive values', cx, cy); }
  }
}

export class Gauge extends SpecialtyChart {
  value = 0; interval = {start: 0, end: 100}; unit = ''; valueFormatter: (value: number) => string = compact;
  private arc = {start: -180, sweep: 180}; private cursorStyle: 'needle' | 'arc' = 'needle'; private labelPosition: 'below' | 'center' = 'below';
  private bands: Array<{start: number; end: number; color: Color}> = []; private arcColor?: Color; private arcThickness = .13; private progressVisible = true; private interactive = true;
  private tickValues: number[] = []; private valueFontSize?: number;
  private orientation: 'radial' | 'vertical' | 'horizontal' = 'radial'; private linearLUT?: LUT;
  /** Explicit linear mode; the default radial drawing and interaction remain unchanged. */
  setOrientation(value: 'radial' | 'vertical' | 'horizontal'): this {if (!['radial', 'vertical', 'horizontal'].includes(value)) throw new RangeError('Invalid gauge orientation'); this.orientation = value; this.invalidate(); return this;}
  getOrientation(): 'radial' | 'vertical' | 'horizontal' {return this.orientation;}
  setLinearLUT(value: LUT | undefined): this {this.linearLUT = value; this.invalidate(); return this;}
  getLinearLUT(): LUT | undefined {return this.linearLUT;}
  setValue(value: number): this { if (!Number.isFinite(value)) throw new RangeError('Gauge value must be finite'); this.value = value; this.events.emit('valuechange', this, value); this.invalidate(); return this; }
  getValue(): number { return this.value; }
  setInterval(value: {start: number; end: number}): this { if (!Number.isFinite(value.start) || !Number.isFinite(value.end) || value.end <= value.start) throw new RangeError('Gauge interval must increase'); this.interval = {...value}; this.invalidate(); return this; }
  setUnitLabel(unit: string): this { this.unit = unit; this.invalidate(); return this; }
  setValueFormatter(formatter: (value: number) => string): this { this.valueFormatter = formatter; this.invalidate(); return this; }
  setArc(start: number, sweep: number): this {if (!Number.isFinite(start) || !Number.isFinite(sweep) || sweep <= 0 || sweep > 360) throw new RangeError('Gauge arc sweep must be in (0, 360]'); this.arc = {start, sweep}; this.invalidate(); return this;}
  setCursorStyle(value: 'needle' | 'arc'): this {this.cursorStyle = value; this.invalidate(); return this;}
  setValueLabelPosition(value: 'below' | 'center'): this {this.labelPosition = value; this.invalidate(); return this;}
  setBands(value: Array<{start: number; end: number; color: Color}>): this {if (value.some(band => !Number.isFinite(band.start) || !Number.isFinite(band.end) || band.end < band.start)) throw new RangeError('Gauge bands must have finite increasing ranges'); this.bands = value.map(band => ({...band})); this.invalidate(); return this;}
  setArcColor(value: Color): this {this.arcColor = value; this.invalidate(); return this;}
  setArcThickness(value: number): this {if (!Number.isFinite(value) || value <= 0 || value > .5) throw new RangeError('Gauge arc thickness must be in (0,.5]'); this.arcThickness = value; this.invalidate(); return this;}
  setProgressVisible(value: boolean): this {this.progressVisible = value; this.invalidate(); return this;}
  setInteractive(value: boolean): this {this.interactive = value; return this;}
  setTickValues(value: number[]): this {if (!value.every(Number.isFinite)) throw new RangeError('Gauge ticks must be finite'); this.tickValues = [...value]; this.invalidate(); return this;}
  setValueFontSize(value: number): this {if (!Number.isFinite(value) || value <= 0) throw new RangeError('Gauge value font size must be positive'); this.valueFontSize = value; this.invalidate(); return this;}
  private geometry(rect: Rect) {
    const wide = this.arc.sweep > 200, nominal = Math.min(rect.width * .39, rect.height * (wide ? .42 : .57));
    const ticks = this.tickValues.length ? this.tickValues : [this.interval.start, this.interval.end], font = Math.max(12, Math.min(25, nominal * .10));
    const halfLabelWidth = Math.max(...ticks.map(value => compact(value).length), 1) * font * .34, available = rect.width / 2 - halfLabelWidth - 4;
    // Labels sit outside the painted arc: reserving only the arc radius clipped 100 in narrow dashboards.
    const radius = Math.max(1, Math.min(nominal, available / (1 + this.arcThickness * 1.55), available - 6 * 1.55));
    return {cx: rect.left + rect.width / 2, cy: rect.top + rect.height * (wide ? .55 : .65), radius};
  }
  protected override dragAt(p: UIPoint): void {
    if (this.orientation !== 'radial') {if (!this.interactive) return; const track = this.linearTrack(this.plotRect()), t = this.orientation === 'vertical' ? 1 - (p.y - track.top) / track.height : (p.x - track.left) / track.width; this.setValue(this.interval.start + Math.max(0, Math.min(1, t)) * (this.interval.end - this.interval.start)); return;}
    if (!this.interactive) return; const {cx, cy} = this.geometry(this.plotRect()), start = this.arc.start * Math.PI / 180, sweep = this.arc.sweep * Math.PI / 180;
    let delta = ((Math.atan2(p.y - cy, p.x - cx) - start) % TAU + TAU) % TAU;
    if (delta > sweep) delta = delta - sweep < TAU - delta ? sweep : 0;
    this.setValue(this.interval.start + Math.max(0, Math.min(1, delta / sweep)) * (this.interval.end - this.interval.start));
  }
  protected override key(key: string): boolean { if (!this.interactive || key !== 'ArrowLeft' && key !== 'ArrowRight') return false; this.setValue(Math.max(this.interval.start, Math.min(this.interval.end, this.value + (key === 'ArrowRight' ? 1 : -1) * (this.interval.end - this.interval.start) / 100))); return true; }
  protected renderPlot(ctx: CanvasRenderingContext2D, rect: Rect): void {
    if (this.orientation !== 'radial') {this.renderLinear(ctx, rect); return;}
    const {cx, cy, radius} = this.geometry(rect), thickness = Math.max(6, radius * this.arcThickness), start = this.arc.start * Math.PI / 180, sweep = this.arc.sweep * Math.PI / 180;
    const ratio = Math.max(0, Math.min(1, (this.value - this.interval.start) / (this.interval.end - this.interval.start)));
    ctx.lineWidth = thickness; ctx.lineCap = 'round'; ctx.strokeStyle = this.arcColor?.toCSS() ?? 'rgba(135,156,178,.23)'; ctx.beginPath(); ctx.arc(cx, cy, radius, start, start + sweep); ctx.stroke();
    for (const band of this.bands) {const a = Math.max(0, Math.min(1, (band.start - this.interval.start) / (this.interval.end - this.interval.start))), b = Math.max(0, Math.min(1, (band.end - this.interval.start) / (this.interval.end - this.interval.start))); ctx.strokeStyle = band.color.toCSS(); ctx.lineCap = 'butt'; ctx.beginPath(); ctx.arc(cx, cy, radius + thickness * .75, start + a * sweep, start + b * sweep); ctx.lineWidth = thickness * .35; ctx.stroke();}
    if (this.progressVisible) {ctx.lineWidth = thickness; ctx.strokeStyle = this.color(0); ctx.lineCap = 'round'; ctx.beginPath(); ctx.arc(cx, cy, radius, start, start + ratio * sweep); ctx.stroke();}
    const angle = start + ratio * sweep;
    ctx.lineCap = 'round'; ctx.lineWidth = this.cursorStyle === 'arc' ? Math.max(4, thickness * .2) : 2;
    const inner = this.cursorStyle === 'arc' ? radius - thickness * .65 : 0, outer = this.cursorStyle === 'arc' ? radius + thickness * .65 : radius * .82;
    ctx.strokeStyle = '#080909'; ctx.lineWidth += 3; ctx.beginPath(); ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner); ctx.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer); ctx.stroke(); ctx.lineWidth -= 3; ctx.strokeStyle = '#ffffff'; ctx.stroke();
    const ticks = this.tickValues.length ? this.tickValues : [this.interval.start, this.interval.end]; ctx.fillStyle = this.textColor(); ctx.font = `${Math.max(12, Math.min(25, radius * .10))}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const tick of ticks) {const theta = start + (tick - this.interval.start) / (this.interval.end - this.interval.start) * sweep, distance = radius + thickness * 1.55; ctx.fillText(compact(tick), cx + Math.cos(theta) * distance, cy + Math.sin(theta) * distance);}
    const valueY = this.labelPosition === 'center' ? cy : cy + 32; ctx.font = `${this.valueFontSize ?? Math.max(22, Math.min(58, radius * .24))}px sans-serif`; ctx.fillText(this.valueFormatter(this.value) + (this.labelPosition === 'below' && this.unit ? ' ' + this.unit : ''), cx, valueY);
    if (this.unit && this.labelPosition === 'center') {ctx.font = `${Math.max(13, Math.min(34, radius * .16))}px sans-serif`; ctx.fillText(this.unit, cx, valueY + Math.max(28, radius * .27));}
    this.hitRect(rect, this, `${this.valueFormatter(this.value)} ${this.unit}${this.interactive ? '\nDrag the dial or use arrow keys' : ''}`);
  }
  private linearTrack(rect: Rect): Rect {
    return this.orientation === 'vertical'
      ? {left: rect.left + rect.width * .46, top: rect.top + 10, width: Math.max(4, Math.min(28, rect.width * .1)), height: Math.max(1, rect.height - 30)}
      : {left: rect.left + 22, top: rect.top + rect.height * .36, width: Math.max(1, rect.width - 44), height: Math.max(4, Math.min(28, rect.height * .13))};
  }
  private renderLinear(ctx: CanvasRenderingContext2D, rect: Rect): void {
    const track = this.linearTrack(rect), vertical = this.orientation === 'vertical', span = this.interval.end - this.interval.start;
    const fraction = (v: number) => Math.max(0, Math.min(1, (v - this.interval.start) / span));
    const coordinate = (v: number) => vertical ? track.top + (1 - fraction(v)) * track.height : track.left + fraction(v) * track.width;
    ctx.save(); roundedPath(ctx, track, Math.min(track.width, track.height) / 2); ctx.clip();
    ctx.fillStyle = this.arcColor?.toCSS() ?? 'rgba(135,156,178,.23)'; ctx.fillRect(track.left, track.top, track.width, track.height);
    if (this.linearLUT) {
      // A bounded set of palette samples also preserves nonuniform LUT step spacing.
      const gradient = ctx.createLinearGradient(track.left, vertical ? track.top + track.height : track.top, vertical ? track.left : track.left + track.width, track.top);
      for (let i = 0; i <= 128; i++) gradient.addColorStop(i / 128, this.linearLUT.getColor(this.interval.start + span * i / 128).toCSS());
      ctx.fillStyle = gradient; ctx.fillRect(track.left, track.top, track.width, track.height);
    } else for (const band of this.bands) {const a = coordinate(band.start), b = coordinate(band.end); ctx.fillStyle = band.color.toCSS(); if (vertical) ctx.fillRect(track.left, Math.min(a, b), track.width, Math.abs(b - a)); else ctx.fillRect(Math.min(a, b), track.top, Math.abs(b - a), track.height);}
    if (this.progressVisible) {ctx.fillStyle = this.color(0); const p = coordinate(this.value); if (vertical) ctx.fillRect(track.left, p, track.width, track.top + track.height - p); else ctx.fillRect(track.left, track.top, p - track.left, track.height);}
    ctx.restore();
    const marker = coordinate(this.value); ctx.lineCap = 'butt'; ctx.strokeStyle = '#080909'; ctx.lineWidth = 5; ctx.beginPath();
    if (vertical) {ctx.moveTo(track.left - 7, marker); ctx.lineTo(track.left + track.width + 7, marker);} else {ctx.moveTo(marker, track.top - 7); ctx.lineTo(marker, track.top + track.height + 7);} ctx.stroke(); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.stroke();
    const ticks = this.tickValues.length ? this.tickValues : [this.interval.start, this.interval.end]; ctx.fillStyle = this.textColor(); ctx.font = '12px sans-serif'; ctx.textBaseline = vertical ? 'middle' : 'top'; ctx.textAlign = vertical ? 'right' : 'center';
    for (const tick of ticks) {if (tick < this.interval.start || tick > this.interval.end) continue; ctx.fillText(compact(tick), vertical ? track.left - 10 : coordinate(tick), vertical ? coordinate(tick) : track.top + track.height + 10);}
    ctx.font = `${this.valueFontSize ?? 16}px sans-serif`; ctx.textAlign = vertical ? 'left' : 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(this.valueFormatter(this.value) + (this.unit ? ` ${this.unit}` : ''), vertical ? track.left + track.width + 12 : marker, vertical ? marker : track.top - 18);
    this.hitRect(rect, this, `${this.valueFormatter(this.value)} ${this.unit}${this.interactive ? '\nDrag the marker or use arrow keys' : ''}`);
  }
}

export interface SpiderPoint {name: string; value: number; }
export class SpiderSeries {
  points: SpiderPoint[] = []; name = ''; visible = true; disposed = false; fillStyle?: FillStyle; strokeStyle?: SolidLine;
  fillOpacity = .2;
  constructor(readonly chart: Spider) {}
  setName(name: string): this { this.name = name; this.chart.invalidate(); return this; }
  getName(): string { return this.name; }
  addPoints(points: SpiderPoint[]): this { this.points.push(...points.map(point => ({...point}))); this.chart.invalidate(); return this; }
  setData(points: SpiderPoint[]): this { this.points = points.map(point => ({...point})); this.chart.invalidate(); return this; }
  setFillStyle(fill: FillStyle): this { this.fillStyle = fill; this.chart.invalidate(); return this; }
  setFillOpacity(value: number): this {if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError('Spider fill opacity must be in [0,1]'); this.fillOpacity = value; this.chart.invalidate(); return this;}
  getFillStyle(): FillStyle | undefined { return this.fillStyle; }
  setStrokeStyle(stroke: SolidLine): this { this.strokeStyle = stroke; this.chart.invalidate(); return this; }
  setVisible(value: boolean): this { this.visible = value; this.chart.invalidate(); return this; }
  getVisible(): boolean { return this.visible; }
  clear(): this { this.points = []; this.chart.invalidate(); return this; }
  dispose(): this { this.disposed = true; this.chart.invalidate(); return this; }
  isDisposed(): boolean { return this.disposed; }
}
export class Spider extends SpecialtyChart {
  readonly series: SpiderSeries[] = [];
  private axisRanges = new Map<string, {start: number; end: number}>(); private gridShape: 'polygon' | 'circle' = 'polygon'; private radiusFactor = .36; private tickCount = 5; private tickLabels: 'none' | 'first' | 'all' = 'none'; private labelEffect = false;
  setAxisRange(name: string, value: {start: number; end: number}): this {if (!Number.isFinite(value.start) || !Number.isFinite(value.end) || value.end <= value.start) throw new RangeError('Spider axis range must increase'); this.axisRanges.set(name, {...value}); this.invalidate(); return this;}
  getAxisRange(name: string): {start: number; end: number} | undefined {const range = this.axisRanges.get(name); return range ? {...range} : undefined;}
  setGridShape(value: 'polygon' | 'circle'): this {this.gridShape = value; this.invalidate(); return this;}
  setRadiusFactor(value: number): this {if (!Number.isFinite(value) || value <= 0 || value > .5) throw new RangeError('Spider radius factor must be in (0,.5]'); this.radiusFactor = value; this.invalidate(); return this;}
  setTickCount(value: number): this {if (!Number.isInteger(value) || value < 1 || value > 20) throw new RangeError('Spider tick count must be between 1 and 20'); this.tickCount = value; this.invalidate(); return this;}
  setTickLabels(value: 'none' | 'first' | 'all'): this {this.tickLabels = value; this.invalidate(); return this;}
  setLabelEffect(value: boolean): this {this.labelEffect = value; this.invalidate(); return this;}
  addSeries(): SpiderSeries { const item = new SpiderSeries(this); this.series.push(item); this.invalidate(); return item; }
  override getSeries(): SpiderSeries[] { return this.series.filter(item => !item.disposed); }
  protected renderPlot(ctx: CanvasRenderingContext2D, rect: Rect): void {
    const series = this.series.filter(item => !item.disposed && item.visible), names = [...new Set(series.flatMap(item => item.points.map(point => point.name)))]; if (!names.length) return;
    const maximum = Math.max(1, ...series.flatMap(item => item.points.map(point => finite(point.value))));
    const radius = Math.min(rect.width, rect.height) * this.radiusFactor, cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    const position = (index: number, ratio: number) => ({x: cx + Math.sin(index / names.length * TAU) * radius * ratio, y: cy - Math.cos(index / names.length * TAU) * radius * ratio});
    ctx.strokeStyle = 'rgba(150,170,190,.3)'; ctx.lineWidth = 1;
    for (let ring = 1; ring <= this.tickCount; ring++) {ctx.beginPath(); if (this.gridShape === 'circle') ctx.arc(cx, cy, radius * ring / this.tickCount, 0, TAU); else {names.forEach((_, i) => {const p = position(i, ring / this.tickCount); if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y);}); ctx.closePath();} ctx.stroke();}
    names.forEach((name, i) => { const p = position(i, 1), label = position(i, 1.1); ctx.strokeStyle = 'rgba(150,170,190,.4)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(p.x, p.y); ctx.stroke(); ctx.fillStyle = this.textColor(); ctx.font = '14px sans-serif'; ctx.textAlign = i === 0 ? 'left' : label.x < cx ? 'right' : 'left'; ctx.textBaseline = 'middle'; ctx.fillText(name, label.x, label.y);
      if (this.tickLabels === 'all' || this.tickLabels === 'first' && i === 0) {const range = this.axisRanges.get(name) ?? {start: 0, end: maximum}; ctx.font = '12px sans-serif'; ctx.textAlign = 'left'; for (let tick = 1; tick <= this.tickCount; tick++) {const location = position(i, tick / this.tickCount), value = compact(range.start + (range.end - range.start) * tick / this.tickCount); if (this.labelEffect) {ctx.strokeStyle = '#090909'; ctx.lineWidth = 2.5; ctx.strokeText(value, location.x + 7, location.y);} ctx.fillText(value, location.x + 7, location.y);}}
    });
    series.forEach((item, index) => {
      const values = new Map(item.points.map(point => [point.name, point.value])); ctx.beginPath();
      const points = names.map((name, i) => {const range = this.axisRanges.get(name) ?? {start: 0, end: maximum}; return position(i, Math.max(0, Math.min(1, (finite(values.get(name)) - range.start) / (range.end - range.start))));});
      points.forEach((p, i) => { if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); }); ctx.closePath();
      ctx.fillStyle = this.color(index, item); ctx.globalAlpha = this.selected === item ? Math.min(1, item.fillOpacity * 1.4) : item.fillOpacity; ctx.fill(); ctx.globalAlpha = 1; ctx.strokeStyle = this.color(index, item); ctx.lineWidth = this.selected === item ? 3 : 2; if (item.strokeStyle) applyLine(ctx, item.strokeStyle); ctx.stroke();
      points.forEach((p, i) => { ctx.fillStyle = this.color(index, item); ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, TAU); ctx.fill(); this.hits.push({contains: q => Math.hypot(q.x - p.x, q.y - p.y) <= 9, data: item, label: `${item.name || 'Series'}\n${names[i]}: ${compact(finite(values.get(names[i])))}`}); });
    });
  }
}

export interface BarDatum {category?: string; name?: string; value: number; start?: number; row?: number; barSize?: number; label?: string; color?: string | Color; [key: string]: unknown; }
/** Resolve the Canvas-normalized solid paint without changing caller data. */
function barPaintColor(value:string|CanvasGradient|CanvasPattern):Color|undefined {
  if(typeof value!=='string')return undefined;
  if(value.startsWith('#')){try{return ColorHEX(value);}catch{return undefined;}}
  const match=/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/.exec(value);
  return match?ColorRGBA(Number(match[1]),Number(match[2]),Number(match[3]),match[4]===undefined?255:Number(match[4])*255):undefined;
}
export class BarChart extends SpecialtyChart {
  data: BarDatum[] = []; horizontal = false;
  private renderedBars = new Map<number, Rect>();
  private interval?: {start: number; end: number}; private valueAxisTitle = ''; private categoryAxisTitle = ''; private numericPlacement: 'start' | 'end' = 'start'; private categories?: string[];
  private numericFormatter = compact; private barFormatter = (datum: BarDatum) => compact(datum.value); private labels: 'inside' | 'inside-end' | 'outside' | 'none' = 'none'; private categoryLabelsAtBars=false;
  private grid = true; private tickCount = 4; private cornerRadius = 0; private gradient = false; private effect = false; private labelEffect = false;
  addData(data: BarDatum[]): this { this.data.push(...data.map(item => ({...item}))); this.invalidate(); return this; }
  setData(data: BarDatum[]): this { this.data = data.map(item => ({...item})); this.invalidate(); return this; }
  setHorizontal(value: boolean): this { this.horizontal = value; this.invalidate(); return this; }
  setValueInterval(value: {start: number; end: number}): this {if (!Number.isFinite(value.start) || !Number.isFinite(value.end) || value.end <= value.start) throw new RangeError('Bar value interval must increase'); this.interval = {...value}; this.invalidate(); return this;}
  setValueAxisTitle(value: string): this {this.valueAxisTitle = value; this.invalidate(); return this;}
  setCategoryAxisTitle(value: string): this {this.categoryAxisTitle = value; this.invalidate(); return this;}
  setValueAxisPlacement(value: 'start' | 'end'): this {this.numericPlacement = value; this.invalidate(); return this;}
  setCategories(value: string[]): this {this.categories = [...value]; this.invalidate(); return this;}
  setValueFormatter(value: (value: number) => string): this {this.numericFormatter = value; this.invalidate(); return this;}
  setBarLabelFormatter(value: (datum: BarDatum) => string): this {this.barFormatter = value; this.invalidate(); return this;}
  setLabelPosition(value: 'inside' | 'inside-end' | 'outside' | 'none'): this {this.labels = value; this.invalidate(); return this;}
  setCategoryLabelsAtBars(value:boolean):this{this.categoryLabelsAtBars=value;this.invalidate();return this;}
  setGridVisible(value: boolean): this {this.grid = value; this.invalidate(); return this;}
  setTickCount(value: number): this {if (!Number.isInteger(value) || value < 1 || value > 30) throw new RangeError('Bar tick count must be between 1 and 30'); this.tickCount = value; this.invalidate(); return this;}
  setCornerRadius(value: number): this {this.cornerRadius = Math.max(0, finite(value)); this.invalidate(); return this;}
  setGradientFill(value: boolean): this {this.gradient = value; this.invalidate(); return this;}
  setBarEffect(value: boolean): this {this.effect = value; this.invalidate(); return this;}
  setLabelEffect(value: boolean): this {this.labelEffect = value; this.invalidate(); return this;}
  getData(): BarDatum[] {return this.data.map(item => ({...item}));}
  /** Rectangle from the latest completed draw, in chart-local CSS pixels. */
  getBarScreenRect(index: number): Rect | undefined {const rect = this.renderedBars.get(index); return rect ? {...rect} : undefined;}
  clear(): this { this.data = []; this.invalidate(); return this; }
  protected renderPlot(ctx: CanvasRenderingContext2D, rect: Rect): void {
    this.renderedBars.clear(); if (!this.data.length) return;
    const min = this.interval?.start ?? Math.min(0, ...this.data.map(x => finite(x.start) + Math.min(0, finite(x.value)))) , max = this.interval?.end ?? Math.max(0, ...this.data.map(x => finite(x.start) + Math.max(0, finite(x.value)))), span = max - min || 1;
    const count = this.categories?.length ?? (this.data.some(item => item.row !== undefined) ? Math.max(...this.data.map(item => item.row ?? 0)) + 1 : this.data.length), names = this.categories ?? Array.from({length: count}, (_, i) => {const item = this.data.find((item, j) => (item.row ?? j) === i); return item?.category ?? item?.name ?? String(i + 1);});
    ctx.font = '12px sans-serif'; const left = this.horizontal ? Math.max(58, ...names.map(name => ctx.measureText(name).width + 12)) + (this.categoryAxisTitle ? 27 : 0) : this.valueAxisTitle ? 62 : 42;
    const top = this.horizontal && this.numericPlacement === 'start' ? this.valueAxisTitle ? 44 : 26 : 5;
    const plot = {left: rect.left + left, top: rect.top + top, width: Math.max(1, rect.width - left - 12), height: Math.max(1, rect.height - top - (this.horizontal && this.numericPlacement === 'start' ? 4 : 29))};
    const coordinate = (value: number) => this.horizontal ? plot.left + (value - min) / span * plot.width : plot.top + (1 - (value - min) / span) * plot.height;
    ctx.fillStyle = this.textColor(); ctx.strokeStyle = 'rgba(190,190,175,.7)'; ctx.lineWidth = 1;
    for (let i = 0; i <= this.tickCount; i++) {
      const value = min + span * i / this.tickCount, p = coordinate(value);
      if (this.grid) {ctx.strokeStyle = 'rgba(150,170,190,.2)'; ctx.beginPath(); if (this.horizontal) {ctx.moveTo(p, plot.top); ctx.lineTo(p, plot.top + plot.height);} else {ctx.moveTo(plot.left, p); ctx.lineTo(plot.left + plot.width, p);} ctx.stroke();}
      ctx.textAlign = this.horizontal ? 'center' : 'right'; ctx.textBaseline = this.horizontal ? this.numericPlacement === 'start' ? 'bottom' : 'top' : 'middle';
      ctx.fillText(this.numericFormatter(value), this.horizontal ? p : plot.left - 8, this.horizontal ? this.numericPlacement === 'start' ? plot.top - 8 : plot.top + plot.height + 8 : p);
    }
    ctx.strokeStyle = 'rgba(195,195,180,.75)'; ctx.beginPath(); ctx.moveTo(plot.left, plot.top); ctx.lineTo(plot.left, plot.top + plot.height); ctx.moveTo(plot.left, this.horizontal && this.numericPlacement === 'start' ? plot.top : plot.top + plot.height); ctx.lineTo(plot.left + plot.width, this.horizontal && this.numericPlacement === 'start' ? plot.top : plot.top + plot.height); ctx.stroke();
    if(!this.categoryLabelsAtBars)names.forEach((name, i) => {ctx.textAlign = this.horizontal ? 'right' : 'center'; ctx.textBaseline = this.horizontal ? 'middle' : 'top'; ctx.fillText(name, this.horizontal ? plot.left - 8 : plot.left + (i + .5) / count * plot.width, this.horizontal ? plot.top + (i + .5) / count * plot.height : plot.top + plot.height + 8, this.horizontal ? left - 8 : plot.width / count - 3);});
    else this.data.forEach((item,i)=>{const row=item.row??i;ctx.textAlign=this.horizontal?'right':'center';ctx.textBaseline=this.horizontal?'middle':'top';ctx.fillText(item.category??item.name??String(i+1),this.horizontal?plot.left-8:plot.left+(row+.5)/count*plot.width,this.horizontal?plot.top+(row+.5)/count*plot.height:plot.top+plot.height+8,this.horizontal?left-8:plot.width/count-3);});
    if (this.valueAxisTitle) {ctx.save(); ctx.font = '14px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; if (this.horizontal) ctx.fillText(this.valueAxisTitle, plot.left + plot.width / 2, rect.top + 8); else {ctx.translate(rect.left + 8, plot.top + plot.height / 2); ctx.rotate(-Math.PI / 2); ctx.fillText(this.valueAxisTitle, 0, 0);} ctx.restore();}
    if (this.categoryAxisTitle && this.horizontal) {ctx.save(); ctx.font = '14px sans-serif'; ctx.textAlign = 'center'; ctx.translate(rect.left + 8, plot.top + plot.height / 2); ctx.rotate(-Math.PI / 2); ctx.fillText(this.categoryAxisTitle, 0, 0); ctx.restore();}
    ctx.save(); ctx.beginPath(); ctx.rect(plot.left, plot.top, plot.width, plot.height); ctx.clip();
    this.data.forEach((item, i) => {
      const unit = (this.horizontal ? plot.height : plot.width) / count, value = finite(item.value), start = finite(item.start), a = coordinate(start), b = coordinate(start + value), row = item.row ?? i,barSize=item.barSize===undefined?1:Math.max(0,Math.min(1,finite(item.barSize)));
      const bar: Rect = this.horizontal ? {left: Math.min(a, b), top: plot.top + row * unit + unit * barSize * .10, width: Math.abs(b - a), height: unit * barSize * .80} : {left: plot.left + row * unit + unit * barSize * .08, top: Math.min(a, b), width: unit * barSize * .84, height: Math.abs(b - a)};
      this.renderedBars.set(i, {...bar});
      ctx.save(); ctx.fillStyle = this.color(i, item); ctx.globalAlpha = 1;
      if (this.gradient) {let color = item.color instanceof Color ? item.color : typeof item.color === 'string' ? ColorHEX(item.color) : this.theme.dataColors[i % this.theme.dataColors.length]; if(this.hovered?.data===item)color=componentHighlightColor(color,1,this.theme); const gradient = ctx.createLinearGradient(bar.left, 0, bar.left + Math.max(1, bar.width), 0); gradient.addColorStop(0, color.getLighter().toCSS()); gradient.addColorStop(.25, color.toCSS()); gradient.addColorStop(1, new Color(color.r * .55, color.g * .55, color.b * .55, color.a).toCSS()); ctx.fillStyle = gradient;}
      if(!this.gradient&&this.hovered?.data===item){const paint=barPaintColor(ctx.fillStyle);if(paint)ctx.fillStyle=componentHighlightColor(paint,1,this.theme).toCSS();}
      if (this.effect) {ctx.shadowColor = '#000'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 2;}
      if (this.cornerRadius) {const radius = Math.min(this.cornerRadius, bar.width / 2, bar.height / 2); roundedPath(ctx, bar, item.start !== undefined ? radius : this.horizontal ? value >= 0 ? [0, radius, radius, 0] : [radius, 0, 0, radius] : value >= 0 ? [radius, radius, 0, 0] : [0, 0, radius, radius]); ctx.fill();} else ctx.fillRect(bar.left, bar.top, bar.width, bar.height); ctx.restore();
      const label = item.category ?? item.name ?? String(i + 1);
      if (this.labels !== 'none') {
        const text=this.barFormatter(item),inner=this.labels==='inside'||this.labels==='inside-end',endLabel=this.labels==='inside-end';ctx.save();ctx.font='12px sans-serif';
        const outsideEnd=this.horizontal&&endLabel&&ctx.measureText(text).width+16>bar.width;
        const x=this.horizontal?endLabel?b+(value>=0?(outsideEnd?8:-8):(outsideEnd?-8:8)):inner?bar.left+bar.width/2:b+8:bar.left+bar.width/2;
        const y=this.horizontal?bar.top+bar.height/2:value>=0?bar.top+(inner?13:-9):bar.top+bar.height+(inner?-13:9);
        ctx.fillStyle=this.textColor();ctx.textAlign=this.horizontal&&endLabel?(value>=0?!outsideEnd:outsideEnd)?'right':'left':this.horizontal&&!inner?'left':'center';ctx.textBaseline='middle';
        if(this.labelEffect){ctx.strokeStyle='#050505';ctx.lineWidth=2.5;ctx.strokeText(text,x,y);}
        if(this.horizontal&&inner&&!endLabel)ctx.fillText(text,x,y,Math.max(1,bar.width-12));else ctx.fillText(text,x,y);ctx.restore();
      }
      this.hits.push({data: item, label: `${item.label ?? label}: ${item.start === undefined ? this.numericFormatter(value) : this.numericFormatter(start) + ' – ' + this.numericFormatter(start + value)}`, contains: p => inside(plot, p) && inside(bar, p)});
    });
    ctx.restore();
  }
}

export interface TreeMapNode {name: string; value?: number; children?: TreeMapNode[]; color?: string | Color; [key: string]: unknown; }
export interface TreeMapTile extends Rect {node: TreeMapNode; weight: number; }
function weight(node: TreeMapNode): number { return node.children?.length ? node.children.reduce((sum, child) => sum + weight(child), 0) : Math.max(0, finite(node.value)); }
/** Balanced recursive partition preserves area and avoids tiny sequential remainder strips. */
export function layoutTreemap(data: readonly TreeMapNode[], rect: Rect): TreeMapTile[] {
  const items = data.map(node => ({node, weight: weight(node)})).filter(item => item.weight > 0), output: TreeMapTile[] = [];
  const split = (items: Array<{node: TreeMapNode; weight: number}>, box: Rect): void => {
    if (!items.length) return;
    if (items.length === 1) { output.push({...box, ...items[0]}); return; }
    const sum = items.reduce((total, item) => total + item.weight, 0); let running = 0, best = Infinity, cut = 1, fraction = items[0].weight / sum;
    for (let i = 1; i < items.length; i++) { running += items[i - 1].weight; const error = Math.abs(sum / 2 - running); if (error < best) { best = error; cut = i; fraction = running / sum; } }
    if (box.width >= box.height) { const width = box.width * fraction; split(items.slice(0, cut), {...box, width}); split(items.slice(cut), {...box, left: box.left + width, width: box.width - width}); }
    else { const height = box.height * fraction; split(items.slice(0, cut), {...box, height}); split(items.slice(cut), {...box, top: box.top + height, height: box.height - height}); }
  };
  split(items, rect); return output;
}
export class TreeMapChart extends SpecialtyChart {
  data: TreeMapNode[] = []; private path: TreeMapNode[] = [];
  private hierarchyDepth = 1; private labelEffect = false; private valueLabels = true; private cornerRadius = 0; private tilePadding = 2; private labelFont = new FontSettings({size: 13});
  setData(data: TreeMapNode[] | TreeMapNode, options: {preservePath?: boolean} = {}): this {
    const visiting = new WeakSet<object>(), oldPath = options.preservePath ? this.getPath() : [];
    const copy = (node: TreeMapNode, depth = 0): TreeMapNode => {if (!node || typeof node !== 'object' || visiting.has(node) || depth > 128) throw new TypeError('TreeMap data contains a cycle or invalid node'); if (node.value !== undefined && (!Number.isFinite(node.value) || node.value < 0)) throw new RangeError('TreeMap values must be nonnegative and finite'); visiting.add(node); const result = {...node, name: String(node.name), ...(node.children ? {children: node.children.map(child => copy(child, depth + 1))} : {})}; visiting.delete(node); return result;};
    const next = (Array.isArray(data) ? data : [data]).map(node => copy(node));
    this.data = next; this.path = []; this.selected = undefined; this.hovered = undefined;
    let children = this.data; for (const name of oldPath) {const node = children.find(node => node.name === name); if (!node?.children?.length) break; this.path.push(node); children = node.children;}
    this.invalidate(); return this;
  }
  getData(): TreeMapNode[] {const copy = (node: TreeMapNode): TreeMapNode => ({...node, ...(node.children ? {children: node.children.map(copy)} : {})}); return this.data.map(copy);}
  getPath(): string[] {return this.path.map(node => node.name);}
  drillDown(target: TreeMapNode | string): this {const find = (nodes: TreeMapNode[]): TreeMapNode[] | undefined => {for (const node of nodes) {if (node === target || typeof target === 'string' && node.name === target) return [node]; const children = node.children && find(node.children); if (children) return [node, ...children];}}; const path = find(this.data); if (path?.at(-1)?.children?.length) {this.path = path; this.selected = undefined; this.events.emit('focuschange', {chart: this, path: this.getPath()}); this.invalidate();} return this;}
  drillUp(): this {if (this.path.length) {this.path.pop(); this.selected = undefined; this.events.emit('focuschange', {chart: this, path: this.getPath()}); this.invalidate();} return this;}
  resetView(): this {this.path = []; this.selected = undefined; this.events.emit('focuschange', {chart: this, path: []}); this.invalidate(); return this;}
  setHierarchyDepth(value: number): this {if (!Number.isInteger(value) || value < 1 || value > 16) throw new RangeError('TreeMap visible depth must be between 1 and 16'); this.hierarchyDepth = value; this.invalidate(); return this;}
  setValueLabelsVisible(value: boolean): this {this.valueLabels = value; this.invalidate(); return this;}
  setLabelFont(value: ValueOrMutator<FontSettings>): this {this.labelFont = resolveValue(value, this.labelFont); this.invalidate(); return this;}
  setLabelEffect(value: boolean): this {this.labelEffect = value; this.invalidate(); return this;}
  setCornerRadius(value: number): this {this.cornerRadius = Math.max(0, finite(value)); this.invalidate(); return this;}
  setTilePadding(value: number): this {this.tilePadding = Math.max(0, Math.min(10, finite(value))); this.invalidate(); return this;}
  protected override key(key: string): boolean { if (key === 'Escape' || key === 'Backspace') { this.drillUp(); return true; } return false; }
  protected renderPlot(ctx: CanvasRenderingContext2D, rect: Rect): void {
    let area = rect;
    if (this.path.length) {ctx.font = '12px sans-serif'; ctx.fillStyle = this.textColor(); ctx.textAlign = 'left'; ctx.textBaseline = 'top'; const text = '← Go Back' + (this.path.length > 1 ? ' ← ' + this.path.slice(0, -1).map(node => node.name).join(' / ') : ''); ctx.fillText(text, 12, 11, this.width * .45); this.hitRect({left: 8, top: 6, width: Math.min(this.width * .45, ctx.measureText(text).width + 18), height: 26}, this.path, 'Go back', () => this.drillUp()); if (!this.title) area = {...rect, top: rect.top + 24, height: Math.max(1, rect.height - 24)};}
    const focus = this.path.at(-1), data = focus ? this.hierarchyDepth > 1 ? [focus] : focus.children! : this.data;
    const draw = (nodes: TreeMapNode[], bounds: Rect, depth: number, inherited?: string): void => {
      layoutTreemap(nodes, bounds).forEach((tile, i) => {
        const gap = this.tilePadding, box = {left: tile.left + gap, top: tile.top + gap, width: Math.max(0, tile.width - gap * 2), height: Math.max(0, tile.height - gap * 2)};
        if (box.width < .5 || box.height < .5) return;
        const color = tile.node.color ? this.color(i, tile.node) : inherited ?? this.color(i), nested = !!tile.node.children?.length && depth + 1 < this.hierarchyDepth && box.width > 4 && box.height > 6;
        ctx.fillStyle = color; ctx.globalAlpha = this.hovered?.data === tile.node || this.selected === tile.node ? 1 : .9;
        if (this.cornerRadius) {roundedPath(ctx, box, Math.min(this.cornerRadius, box.width / 2, box.height / 2)); ctx.fill(); ctx.strokeStyle = 'rgba(20,21,12,.65)'; ctx.lineWidth = 1.5; ctx.stroke();} else ctx.fillRect(box.left, box.top, box.width, box.height); ctx.globalAlpha = 1;
        const fontSize = this.labelFont.getSize() + (nested && depth === 0 ? 4 : 0), header = nested ? Math.min(fontSize + 8, box.height * .3) : 0;
        if (box.width > 20 && box.height > 16) {ctx.save(); ctx.beginPath(); ctx.rect(box.left, box.top, box.width, box.height); ctx.clip(); ctx.fillStyle = this.textColor(); ctx.font = `${fontSize}px ${this.labelFont.getFamily()}`; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; const label = fittedText(ctx, tile.node.name, box.width - 12); if (this.labelEffect) {ctx.strokeStyle = '#15160f'; ctx.lineWidth = 2.6; ctx.lineJoin = 'round'; ctx.strokeText(label, box.left + 6, box.top + 5);} ctx.fillText(label, box.left + 6, box.top + 5); if (!nested && this.valueLabels && box.height > 46) {ctx.font = '12px sans-serif'; ctx.fillText(compact(tile.weight), box.left + 6, box.top + 26);} ctx.restore();}
        this.hitRect(box, tile.node, `${tile.node.name}: ${compact(tile.weight)}${tile.node.children?.length ? '\nClick heading to explore' : ''}`, tile.node.children?.length ? () => this.drillDown(tile.node) : undefined);
        if (nested) draw(tile.node.children!, {left: box.left + 3, top: box.top + header, width: Math.max(1, box.width - 6), height: Math.max(1, box.height - header - 3)}, depth + 1, color);
      });
    };
    draw(data, area, 0);
  }
}

export type ParallelValue = number | string | Date;
export interface ParallelAxisOptions {
  title?: string; type?: 'numeric' | 'category' | 'datetime' | 'duration';
  range?: {start: number; end: number}; categories?: string[]; inverted?: boolean;
  ticks?: Array<{value: ParallelValue; label?: string}>; tickCount?: number;
  format?: (value: number | string) => string;
}
export interface ParallelThreshold {start: number; end: number; color?: Color | string;}
export interface ParallelAxisDomain {key: string; type: NonNullable<ParallelAxisOptions['type']>; start: number; end: number; categories: string[];}
interface PreparedParallelAxis extends ParallelAxisDomain {options: ParallelAxisOptions; values: Float64Array; categoryMap: Map<string, number>;}
const copyRecord = (row: Record<string, any>): Record<string, any> => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value instanceof Date ? new Date(value.getTime()) : value]));
const numericTicks = (start: number, end: number, count: number): number[] => {
  const rough = (end - start) / Math.max(1, count), power = 10 ** Math.floor(Math.log10(rough)), fraction = rough / power, step = (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * power;
  if (!Number.isFinite(step) || step <= 0) return [start, end];
  const output: number[] = []; for (let value = Math.ceil(start / step - 1e-10) * step; value <= end + step * 1e-10 && output.length < 100; value += step) output.push(Number(value.toPrecision(14))); return output;
};
export function formatParallelDuration(milliseconds: number): string {
  const sign = milliseconds < 0 ? '-' : '', seconds = Math.floor(Math.abs(milliseconds) / 1000);
  return `${sign}${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

/** Mixed-type axes retain raw records; numeric projection and Path2D geometry are revision caches. */
export class ParallelCoordinateChart extends SpecialtyChart {
  data: Record<string, any>[] = []; dimensions: string[] = [];
  private axisOptions = new Map<string, ParallelAxisOptions>(); private thresholds = new Map<string, ParallelThreshold[]>();
  private filters = new Map<string, {start: number; end: number}>(); private prepared: PreparedParallelAxis[] = []; private matching = new Uint8Array();
  private dirty = true; private geometryRevision = 0; private pathKey = ''; private paths?: Path2D[]; private maxRows = Infinity; private nextRowIndex = 0;
  private smooth = false; private strokeWidth = 1.5; private opacity = .65; private uniformColor?: Color | string; private labelAngle = 0;
  private mapping?: {key: string; lut: LUT; range: {start: number; end: number}; legend: boolean; title: string}; private rowColors: string[] = [];
  private rangeSelectors = false; private hoverMode: 'row' | 'axis' = 'row'; private filterDrag?: {key: string; anchor: number; initial: {start: number; end: number}; mode: 'start' | 'end' | 'move' | 'new'}; private suppressClick = false;
  private selectedKey = 'id'; private graph?: Rect; private xs: number[] = []; private axisItems = new Map<string, {axis: string}>();
  readonly renderStats = {projectionBuilds: 0, pathBuilds: 0, retainedRows: 0, renderedSegments: 0};

  setData(data: Record<string, any>[], dimensions?: string[]): this {
    const next = data.map(copyRecord); this.data = next.slice(Math.max(0, next.length - this.maxRows));
    this.dimensions = dimensions ? [...dimensions] : Object.keys(data[0] ?? {}).filter(key => data.some(row => typeof row[key] === 'number' || row[key] instanceof Date));
    for (const key of this.filters.keys()) if (!this.dimensions.includes(key)) this.filters.delete(key);
    this.nextRowIndex = data.length; this.selected = undefined; this.hovered = undefined; this.markData(); return this;
  }
  addData(data: Record<string, any>[]): this {
    if (!data.length) return this; const skip = Math.max(0, data.length - this.maxRows);
    if (data.length >= this.maxRows) this.data = []; else if (this.data.length + data.length > this.maxRows) this.data.splice(0, this.data.length + data.length - this.maxRows);
    for (let i = skip; i < data.length; i++) this.data.push(copyRecord(data[i])); this.nextRowIndex += data.length;
    if (!this.dimensions.length) this.dimensions = Object.keys(data[0]).filter(key => typeof data[0][key] === 'number' || data[0][key] instanceof Date);
    if (this.selected && !this.data.includes(this.selected)) this.selected = undefined; this.hovered = undefined; this.markData(); return this;
  }
  clear(): this {this.data = []; this.nextRowIndex = 0; this.selected = undefined; this.hovered = undefined; this.markData(); return this;}
  getData(): Record<string, any>[] {return this.data.map(copyRecord);}
  getSampleCount(): number {return this.data.length;}
  getNextSampleIndex(): number {return this.nextRowIndex;}
  setMaxSampleCount(value: number | undefined): this {if (value !== undefined && value !== Infinity && (!Number.isSafeInteger(value) || value < 1)) throw new RangeError('Parallel maximum sample count must be positive'); this.maxRows = value ?? Infinity; if (this.data.length > this.maxRows) this.data = this.data.slice(-this.maxRows); if (this.selected && !this.data.includes(this.selected)) this.selected = undefined; this.hovered = undefined; this.markData(); return this;}
  getMaxSampleCount(): number | undefined {return this.maxRows === Infinity ? undefined : this.maxRows;}
  setAxisOptions(key: string, options: ParallelAxisOptions): this {
    if (options.range && (!Number.isFinite(options.range.start) || !Number.isFinite(options.range.end) || options.range.end <= options.range.start)) throw new RangeError('Parallel axis range must increase');
    if (options.tickCount !== undefined && (!Number.isInteger(options.tickCount) || options.tickCount < 1 || options.tickCount > 40)) throw new RangeError('Parallel axis tick count must be between 1 and 40');
    this.axisOptions.set(key, {...options, ...(options.range ? {range: {...options.range}} : {}), ...(options.categories ? {categories: [...options.categories]} : {}), ...(options.ticks ? {ticks: options.ticks.map(tick => ({...tick, value: tick.value instanceof Date ? new Date(tick.value) : tick.value}))} : {})});
    this.dirty = true; this.geometryRevision++; this.invalidate(); return this;
  }
  getAxisDomain(key: string): ParallelAxisDomain | undefined {this.prepare(); const axis = this.prepared.find(axis => axis.key === key); return axis ? {key, type: axis.type, start: axis.start, end: axis.end, categories: [...axis.categories]} : undefined;}
  setInterpolation(value: 'linear' | 'smooth'): this {this.smooth = value === 'smooth'; this.geometryRevision++; this.invalidate(); return this;}
  setStrokeThickness(value: number): this {if (!Number.isFinite(value) || value <= 0) throw new RangeError('Parallel line width must be positive'); this.strokeWidth = value; this.invalidate(); return this;}
  setLineOpacity(value: number): this {if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError('Parallel opacity must be in [0,1]'); this.opacity = value; this.invalidate(); return this;}
  setLineColor(value: Color | string): this {this.uniformColor = value; this.dirty = true; this.invalidate(); return this;}
  setAxisLabelAngle(degrees: number): this {if (!Number.isFinite(degrees)) throw new RangeError('Axis label angle must be finite'); this.labelAngle = degrees; this.invalidate(); return this;}
  setHoverMode(value: 'row' | 'axis'): this {this.hoverMode = value; this.hovered = undefined; this.invalidate(); return this;}
  setColorMapping(key: string, lut: LUT, options: {range?: {start: number; end: number}; legend?: boolean; title?: string} = {}): this {
    const range = options.range ?? {start: 0, end: 1}; if (!Number.isFinite(range.start) || !Number.isFinite(range.end) || range.end <= range.start) throw new RangeError('Color scale range must increase');
    this.mapping = {key, lut, range: {...range}, legend: options.legend ?? true, title: options.title ?? key}; this.dirty = true; this.geometryRevision++; this.invalidate(); return this;
  }
  setThresholds(key: string, values: ParallelThreshold[]): this {if (values.some(value => !Number.isFinite(value.start) || !Number.isFinite(value.end) || value.end < value.start)) throw new RangeError('Threshold ranges must be finite and increasing'); this.thresholds.set(key, values.map(value => ({...value}))); this.invalidate(); return this;}
  getThresholds(key: string): ParallelThreshold[] {return (this.thresholds.get(key) ?? []).map(value => ({...value}));}
  setRangeSelectorsEnabled(value: boolean): this {this.rangeSelectors = value; this.invalidate(); return this;}
  setRangeFilter(key: string, value: {start: ParallelValue; end: ParallelValue} | undefined): this {
    this.prepare(); const axis = this.prepared.find(axis => axis.key === key); if (!axis) throw new RangeError(`Unknown parallel dimension ${key}`);
    if (!value) this.filters.delete(key); else {const a = this.encode(value.start, axis), b = this.encode(value.end, axis); if (!Number.isFinite(a) || !Number.isFinite(b)) throw new RangeError('Filter limits must map to finite axis values'); this.filters.set(key, {start: Math.min(a, b), end: Math.max(a, b)});}
    this.updateMatches(); this.emitFilterChange(); this.invalidate(); return this;
  }
  clearRangeFilters(): this {this.filters.clear(); this.updateMatches(); this.emitFilterChange(); this.invalidate(); return this;}
  getRangeFilters(): Record<string, {start: number; end: number}> {return Object.fromEntries([...this.filters].map(([key, range]) => [key, {...range}]));}
  getFilteredData(): Record<string, any>[] {this.prepare(); return this.data.filter((_, i) => this.matching[i]).map(copyRecord);}
  getFilteredCount(): number {this.prepare(); return this.matching.reduce((sum, value) => sum + value, 0);}
  setRowId(key: string): this {this.selectedKey = key; return this;}
  setSelectedRow(value?: Record<string, any> | string | number): this {this.selected = value === undefined ? undefined : this.data.find(row => row === value || row[this.selectedKey] === (typeof value === 'object' ? value[this.selectedKey] : value)); this.invalidate(); return this;}
  getSelectedRow(): Record<string, any> | undefined {return this.selected ? copyRecord(this.selected) : undefined;}
  getAxisScreenPosition(key: string, value: ParallelValue): UIPoint | undefined {this.prepare(); const i = this.prepared.findIndex(axis => axis.key === key); if (i < 0) return undefined; this.layoutGraph(this.plotRect()); return {x: this.xs[i], y: this.valueY(this.encode(value, this.prepared[i]), this.prepared[i])};}
  private markData(): void {this.dirty = true; this.geometryRevision++; this.events.emit('datachange', {chart: this, count: this.data.length}); this.emitFilterChange(); this.invalidate();}
  private emitFilterChange(): void {this.events.emit('filterchange', {chart: this, filters: this.getRangeFilters(), getData: () => this.getFilteredData()});}
  private encode(value: unknown, axis: PreparedParallelAxis): number {return axis.type === 'category' ? typeof value === 'number' ? value : axis.categoryMap.get(String(value)) ?? NaN : value instanceof Date ? value.getTime() : typeof value === 'number' ? value : axis.type === 'datetime' && typeof value === 'string' ? Date.parse(value) : NaN;}
  private prepare(): void {
    if (!this.dirty) return; this.dirty = false; this.renderStats.projectionBuilds++; this.renderStats.retainedRows = this.data.length;
    this.prepared = this.dimensions.map(key => {
      const options = this.axisOptions.get(key) ?? {}, type = options.type ?? 'numeric', categories = type === 'category' ? [...(options.categories ?? [...new Set(this.data.map(row => row[key]).filter(value => value !== undefined && value !== null).map(String))])] : [];
      const axis: PreparedParallelAxis = {key, options, type, categories, categoryMap: new Map(categories.map((name, i) => [name, i])), start: 0, end: 1, values: new Float64Array(this.data.length)};
      let min = Infinity, max = -Infinity; this.data.forEach((row, i) => {const value = this.encode(row[key], axis); axis.values[i] = value; if (Number.isFinite(value)) {min = Math.min(min, value); max = Math.max(max, value);}});
      if (type === 'category') {min = 0; max = Math.max(1, categories.length - 1);} else if (min === Infinity) {min = 0; max = 1;} else if (max === min) {const padding = Math.max(1, Math.abs(min) * .05); min -= padding; max += padding;}
      axis.start = options.range?.start ?? min; axis.end = options.range?.end ?? max; return axis;
    });
    this.rowColors = this.data.map((row, i) => this.mapping && Number.isFinite(row[this.mapping.key]) ? this.mapping.lut.getColor(row[this.mapping.key]).toCSS() : this.uniformColor instanceof Color ? this.uniformColor.toCSS() : this.uniformColor ?? this.color(i, row));
    this.updateMatches(); this.pathKey = ''; this.paths = undefined;
  }
  private updateMatches(): void {this.matching = new Uint8Array(this.data.length).fill(1); for (const axis of this.prepared) {const range = this.filters.get(axis.key); if (!range) continue; for (let i = 0; i < this.data.length; i++) if (!(axis.values[i] >= range.start && axis.values[i] <= range.end)) this.matching[i] = 0;}}
  private layoutGraph(rect: Rect): void {this.graph = {left: rect.left + 42, top: rect.top + 5, width: Math.max(1, rect.width - 64 - (this.mapping?.legend ? 90 : 0)), height: Math.max(1, rect.height - 36)}; this.xs = this.prepared.map((_, i) => this.graph!.left + (this.prepared.length === 1 ? .5 : i / (this.prepared.length - 1)) * this.graph!.width);}
  private valueY(value: number, axis: PreparedParallelAxis): number {const ratio = (value - axis.start) / (axis.end - axis.start); return this.graph!.top + (axis.options.inverted ? ratio : 1 - ratio) * this.graph!.height;}
  private atY(y: number, axis: PreparedParallelAxis): number {const ratio = Math.max(0, Math.min(1, (y - this.graph!.top) / this.graph!.height)); return axis.start + (axis.options.inverted ? ratio : 1 - ratio) * (axis.end - axis.start);}
  private axisNear(point: UIPoint): PreparedParallelAxis | undefined {if (!this.graph || point.y < this.graph.top - 10 || point.y > this.graph.top + this.graph.height + 10) return undefined; let best = -1, distance = 14; this.xs.forEach((x, i) => {if (Math.abs(x - point.x) <= distance) {best = i; distance = Math.abs(x - point.x);}}); return this.prepared[best];}
  override doubleClickAt(point: UIPoint): void {if (!this.rangeSelectors) return; this.prepare(); this.layoutGraph(this.plotRect()); const axis = this.axisNear(point); if (!axis) return; if (this.filters.has(axis.key)) this.setRangeFilter(axis.key, undefined); else {const value = this.atY(point.y, axis), half = (axis.end - axis.start) * .1; this.setRangeFilter(axis.key, {start: Math.max(axis.start, value - half), end: Math.min(axis.end, value + half)});}}
  protected override dragAt(point: UIPoint): void {
    if (!this.rangeSelectors) return; this.prepare(); this.layoutGraph(this.plotRect());
    if (!this.filterDrag) {const axis = this.axisNear(point); if (!axis) return; const value = this.atY(point.y, axis), range = this.filters.get(axis.key), initial = range ?? {start: value, end: value};
      const mode = !range ? 'new' : Math.abs(point.y - this.valueY(range.start, axis)) < 9 ? 'start' : Math.abs(point.y - this.valueY(range.end, axis)) < 9 ? 'end' : value >= range.start && value <= range.end ? 'move' : 'new';
      this.filterDrag = {key: axis.key, anchor: value, initial: {...initial}, mode}; this.suppressClick = true; return;
    }
    const drag = this.filterDrag, axis = this.prepared.find(axis => axis.key === drag.key)!; let value = this.atY(point.y, axis), start = drag.initial.start, end = drag.initial.end;
    if (drag.mode === 'new') {start = drag.anchor; end = value;} else if (drag.mode === 'start') start = value; else if (drag.mode === 'end') end = value; else {const delta = Math.max(axis.start - start, Math.min(axis.end - end, value - drag.anchor)); start += delta; end += delta;}
    this.setRangeFilter(axis.key, {start, end});
  }
  protected override endDragAt(_point: UIPoint): void {this.filterDrag = undefined;}
  override activateAt(point: UIPoint): any {if (this.suppressClick) {this.suppressClick = false; return undefined;} return super.activateAt(point);}
  protected override key(key: string): boolean {if (key === 'Escape') {this.clearRangeFilters(); this.selected = undefined; return true;} return false;}
  private label(axis: PreparedParallelAxis, value: number): string {const display = axis.type === 'category' ? axis.categories[Math.round(value)] ?? '' : value; return axis.options.format ? axis.options.format(display) : axis.type === 'category' ? String(display) : axis.type === 'datetime' ? new Date(value).toLocaleDateString('en-GB', {year: 'numeric', month: 'short'}) : axis.type === 'duration' ? formatParallelDuration(value) : compact(value);}
  private rowLabel(index: number): string {return [this.data[index].name ?? `Sample ${index + 1}`, ...this.prepared.map(axis => `${axis.options.title ?? axis.key}: ${this.label(axis, axis.values[index])}`)].join('\n');}
  private nearestRow(point: UIPoint): number {
    if (!this.graph || !inside(this.graph, point) || this.prepared.length < 1) return -1;
    const position = this.prepared.length === 1 ? 0 : (point.x - this.graph.left) / this.graph.width * (this.prepared.length - 1), left = Math.max(0, Math.min(this.prepared.length - 2, Math.floor(position))), right = Math.min(this.prepared.length - 1, left + 1);
    let t = this.prepared.length === 1 ? 0 : Math.max(0, Math.min(1, position - left));
    if (this.smooth) {let lo = 0, hi = 1; for (let i = 0; i < 14; i++) {const u = (lo + hi) / 2, x = 1.5 * u - 1.5 * u * u + u * u * u; if (x < t) lo = u; else hi = u;} const u = (lo + hi) / 2; t = u * u * (3 - 2 * u);}
    let selected = -1, distance = 7;
    for (let i = 0; i < this.data.length; i++) {if (!this.matching[i]) continue; const a = this.prepared[left].values[i], b = this.prepared[right].values[i]; if (!Number.isFinite(a) || !Number.isFinite(b)) continue; const y = this.valueY(a, this.prepared[left]) * (1 - t) + this.valueY(b, this.prepared[right]) * t, d = Math.abs(point.y - y); if (d <= distance) {selected = i; distance = d;}}
    return selected;
  }
  private trace(path: CanvasRenderingContext2D | Path2D, index: number): number {let previous: UIPoint | undefined, count = 0; this.prepared.forEach((axis, i) => {const value = axis.values[index]; if (!Number.isFinite(value)) {previous = undefined; return;} const x = this.xs[i], y = this.valueY(value, axis); if (previous) {if (this.smooth) path.bezierCurveTo((previous.x + x) / 2, previous.y, (previous.x + x) / 2, y, x, y); else path.lineTo(x, y); count++;} else path.moveTo(x, y); previous = {x, y};}); return count;}
  protected renderPlot(ctx: CanvasRenderingContext2D, rect: Rect): void {
    this.prepare(); if (!this.prepared.length) return; this.layoutGraph(rect); const graph = this.graph!;
    const key = [this.geometryRevision, graph.left, graph.top, graph.width, graph.height].join(':');
    if (this.pathKey !== key) {this.paths = typeof Path2D === 'undefined' ? undefined : this.data.map((_, i) => {const path = new Path2D(); this.trace(path, i); return path;}); this.pathKey = key; this.renderStats.pathBuilds++;}
    const focus = this.data.indexOf(this.hovered?.data ?? this.selected), axisHover = this.hoverMode === 'axis' ? this.axisNear(this.pointer) : undefined;
    ctx.save(); ctx.beginPath(); ctx.rect(graph.left, graph.top, graph.width, graph.height); ctx.clip(); this.renderStats.renderedSegments = 0;
    for (let i = 0; i < this.data.length; i++) {ctx.strokeStyle = focus >= 0 && focus !== i || !this.matching[i] ? '#737373' : focus === i ? '#ffff72' : this.rowColors[i]; ctx.globalAlpha = !this.matching[i] ? .16 : focus >= 0 && focus !== i ? Math.min(this.opacity, .16) : this.opacity; ctx.lineWidth = focus === i ? this.strokeWidth + .7 : this.strokeWidth; if (this.paths) {ctx.stroke(this.paths[i]); this.renderStats.renderedSegments += this.prepared.length - 1;} else {ctx.beginPath(); this.renderStats.renderedSegments += this.trace(ctx, i); ctx.stroke();}}
    ctx.restore(); ctx.globalAlpha = 1; ctx.strokeStyle = 'rgba(190,190,170,.27)'; ctx.lineWidth = 1; ctx.strokeRect(graph.left, graph.top, graph.width, graph.height);
    this.prepared.forEach((axis, i) => {
      const x = this.xs[i]; ctx.strokeStyle = 'rgba(205,205,190,.6)'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(x, graph.top); ctx.lineTo(x, graph.top + graph.height); ctx.stroke();
      const ticks = axis.options.ticks?.map(tick => ({value: this.encode(tick.value, axis), label: tick.label})) ?? (axis.type === 'category' ? axis.categories.map((_, index) => ({value: index, label: undefined})) : numericTicks(axis.start, axis.end, axis.options.tickCount ?? 6).map(value => ({value, label: undefined})));
      ctx.font = '12px sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillStyle = this.textColor();
      for (const tick of ticks) {if (!Number.isFinite(tick.value) || tick.value < axis.start || tick.value > axis.end) continue; const y = this.valueY(tick.value, axis); ctx.beginPath(); ctx.moveTo(x - 6, y); ctx.lineTo(x, y); ctx.stroke(); ctx.fillText(tick.label ?? this.label(axis, tick.value), x - 10, Math.max(graph.top + 6, Math.min(graph.top + graph.height - 6, y)));}
      ctx.save(); ctx.font = '14px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      const title = axis.options.title ?? axis.key, halfWidth = ctx.measureText(title).width / 2, radians = this.labelAngle * Math.PI / 180, cosine = Math.cos(radians), sine = Math.sin(radians);
      const corners = [-halfWidth * cosine, halfWidth * cosine, -halfWidth * cosine - 16 * sine, halfWidth * cosine - 16 * sine];
      const titleX = Math.max(4 - Math.min(...corners), Math.min(this.width - 4 - Math.max(...corners), x));
      if (this.labelAngle) {ctx.translate(titleX, graph.top + graph.height + 8); ctx.rotate(radians); ctx.fillText(title, 0, 0);} else ctx.fillText(title, titleX, graph.top + graph.height + 8); ctx.restore();
      for (const threshold of this.thresholds.get(axis.key) ?? []) {const a = Math.max(axis.start, threshold.start), b = Math.min(axis.end, threshold.end); if (b < a) continue; ctx.strokeStyle = threshold.color instanceof Color ? threshold.color.toCSS() : threshold.color ?? '#ff0000'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(x, this.valueY(a, axis)); ctx.lineTo(x, this.valueY(b, axis)); ctx.stroke();}
      const filter = this.filters.get(axis.key); if (filter) {const a = this.valueY(Math.max(axis.start, Math.min(axis.end, filter.start)), axis), b = this.valueY(Math.max(axis.start, Math.min(axis.end, filter.end)), axis); ctx.fillStyle = 'rgba(255,255,220,.12)'; ctx.fillRect(x - 5, Math.min(a, b), 10, Math.max(1, Math.abs(b - a))); ctx.strokeStyle = '#ffffdd'; ctx.lineWidth = 1.2; ctx.strokeRect(x - 5, Math.min(a, b), 10, Math.max(1, Math.abs(b - a)));}
      if (axisHover === axis && this.hoverMode === 'axis' && this.data.length <= 20) {for (let r = 0; r < this.data.length; r++) {if (!Number.isFinite(axis.values[r])) continue; ctx.fillStyle = this.rowColors[r]; ctx.strokeStyle = '#eeeece'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, this.valueY(axis.values[r], axis), 4, 0, TAU); ctx.fill(); ctx.stroke();}}
    });
    const rowHit: Hit = {data: undefined, label: '', contains: point => {const index = this.nearestRow(point); if (index < 0) return false; rowHit.data = this.data[index]; rowHit.label = this.rowLabel(index); return true;}}; this.hits.push(rowHit);
    if (this.hoverMode === 'axis') this.prepared.forEach((axis, i) => {let item = this.axisItems.get(axis.key); if (!item) {item = {axis: axis.key}; this.axisItems.set(axis.key, item);} this.hits.push({data: item, label: [axis.options.title ?? axis.key, ...this.data.slice(0, 20).map((row, r) => `${row.name ?? `Sample ${r + 1}`}: ${this.label(axis, axis.values[r])}`)].join('\n'), contains: p => Math.abs(p.x - this.xs[i]) < 24 && p.y >= graph.top && p.y <= graph.top + graph.height});});
    if (this.mapping?.legend) {const mapping = this.mapping, height = Math.min(135, graph.height * .4), x = graph.left + graph.width + 34, y = graph.top + (graph.height - height) / 2;
      const gradient = ctx.createLinearGradient(0, y + height, 0, y); for (let i = 0; i <= 32; i++) gradient.addColorStop(i / 32, mapping.lut.getColor(mapping.range.start + (mapping.range.end - mapping.range.start) * i / 32).toCSS()); ctx.fillStyle = gradient; roundedPath(ctx, {left: x, top: y, width: 20, height}, 4); ctx.fill();
      ctx.fillStyle = this.textColor(); ctx.font = '11px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; [0, .5, 1].forEach(ratio => ctx.fillText(compact(mapping.range.start + (mapping.range.end - mapping.range.start) * ratio), x + 28, y + height * (1 - ratio))); ctx.textBaseline = 'top'; ctx.fillText(mapping.title, x, y + height + 14, 75);
    }
  }
}

export interface DataGridCellStyle {background?: string; color?: string;}
export type DataGridCellRenderer = (context: CanvasRenderingContext2D, rect: Rect, value: any, row: Readonly<Record<string, any>>) => void;
export class DataGrid extends SpecialtyChart {
  data: Record<string, any>[] = []; columns: string[] = []; rowHeight = 29; scrollOffset = 0; sortKey?: string; ascending = true;
  private formatters = new Map<string, (value: any, row: Record<string, any>) => string>(); private columnTitles = new Map<string, string>(); private rowKey = 'id'; private scrollbar = false; private scrollDrag?: {y: number; offset: number};
  private cellStyle?: (value: any, key: string, row: Readonly<Record<string, any>>) => DataGridCellStyle; private renderers = new Map<string, DataGridCellRenderer>();
  setData(data: Record<string, any>[], columns?: string[], options: {preserveScroll?: boolean; preserveSelection?: boolean} = {}): this {const selectedId = options.preserveSelection ? this.selected?.[this.rowKey] : undefined; this.data = data.map(copyRecord); this.columns = columns ? [...columns] : Object.keys(data[0] ?? {}); if (!options.preserveScroll) this.scrollOffset = 0; this.selected = selectedId === undefined ? undefined : this.data.find(row => row[this.rowKey] === selectedId); this.hovered = undefined; if (this.sortKey) this.sortBy(this.sortKey, this.ascending); this.invalidate(); return this; }
  getData(): Record<string, any>[] {return this.data.map(copyRecord);}
  getRowCount(): number {return this.data.length;}
  getRowScreenPosition(id: string | number): UIPoint | undefined {const index = this.data.findIndex(row => row[this.rowKey] === id), rect = this.plotRect(), visible = Math.max(0, Math.floor((rect.height - this.rowHeight) / this.rowHeight)); if (index < this.scrollOffset || index >= this.scrollOffset + visible) return undefined; return {x: rect.left + (rect.width - (this.scrollbar ? 18 : 0)) / 2, y: rect.top + (index - this.scrollOffset + 1.5) * this.rowHeight};}
  setRowId(key: string): this {this.rowKey = key; return this;}
  setSelectedRow(value?: Record<string, any> | string | number): this {this.selected = value === undefined ? undefined : this.data.find(row => row === value || row[this.rowKey] === (typeof value === 'object' ? value[this.rowKey] : value)); this.invalidate(); return this;}
  getSelectedRow(): Record<string, any> | undefined {return this.selected && typeof this.selected === 'object' ? copyRecord(this.selected) : undefined;}
  override activateAt(point: UIPoint): any {const hit = lastHit(this.hits, point); if (hit && typeof hit.data === 'string') {hit.activate?.(); this.invalidate(); return hit.data;} return super.activateAt(point);}
  setColumnFormatter(key: string, formatter: (value: any, row: Record<string, any>) => string): this {this.formatters.set(key, formatter); this.invalidate(); return this;}
  setColumnTitle(key: string, title: string): this {this.columnTitles.set(key, title); this.invalidate(); return this;}
  /** Original extension: apply conditional formatting without changing underlying values or sort order. */
  setCellStyle(style?: (value: any, key: string, row: Readonly<Record<string, any>>) => DataGridCellStyle): this {if (style !== undefined && typeof style !== 'function') throw new TypeError('Cell style must be a function'); this.cellStyle = style; this.invalidate(); return this;}
  getCellStyle(id: string | number, key: string): DataGridCellStyle | undefined {const row = this.data.find(row => row[this.rowKey] === id); return row && this.cellStyle ? {...this.cellStyle(row[key], key, row)} : undefined;}
  setColumnRenderer(key: string, renderer?: DataGridCellRenderer): this {if (renderer !== undefined && typeof renderer !== 'function') throw new TypeError('Cell renderer must be a function'); if (renderer) this.renderers.set(key, renderer); else this.renderers.delete(key); this.invalidate(); return this;}
  getCellScreenRect(id: string | number, key: string): Rect | undefined {const row = this.data.findIndex(row => row[this.rowKey] === id), column = this.columns.indexOf(key), rect = this.plotRect(), visible = Math.max(0, Math.floor((rect.height - this.rowHeight) / this.rowHeight)), width = Math.max(1, rect.width - (this.scrollbar ? 18 : 0)) / Math.max(1, this.columns.length); if (column < 0 || row < this.scrollOffset || row >= this.scrollOffset + visible) return undefined; return {left: rect.left + column * width, top: rect.top + (row - this.scrollOffset + 1) * this.rowHeight, width, height: this.rowHeight};}
  setScrollbarVisible(value: boolean): this {this.scrollbar = value; this.invalidate(); return this;}
  setRowHeight(value: number): this {if (!Number.isFinite(value) || value < 12) throw new RangeError('Grid row height must be at least 12'); this.rowHeight = value; this.invalidate(); return this;}
  scrollTo(row: number): this {if (!Number.isFinite(row)) throw new RangeError('Grid scroll index must be finite'); const rect = this.plotRect(), count = Math.max(0, Math.floor((rect.height - this.rowHeight) / this.rowHeight)); this.scrollOffset = Math.max(0, Math.min(Math.max(0, this.data.length - count), Math.floor(row))); this.invalidate(); return this;}
  sortBy(key: string, ascending = this.sortKey === key ? !this.ascending : true): this {
    this.sortKey = key; this.ascending = ascending; const direction = ascending ? 1 : -1;
    this.data = [...this.data].sort((a, b) => {const av = a[key] instanceof Date ? a[key].getTime() : a[key], bv = b[key] instanceof Date ? b[key].getTime() : b[key]; if (av == null || typeof av === 'number' && !Number.isFinite(av)) return bv == null || typeof bv === 'number' && !Number.isFinite(bv) ? 0 : 1; if (bv == null || typeof bv === 'number' && !Number.isFinite(bv)) return -1; return direction * (typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv)));}); this.invalidate(); return this;
  }
  protected override wheel(delta: number): boolean {this.scrollTo(this.scrollOffset + Math.sign(delta) * 3); return this.data.length > 0;}
  protected override key(key: string): boolean {const page = Math.max(1, Math.floor(this.plotRect().height / this.rowHeight) - 1), delta = key === 'ArrowDown' ? 1 : key === 'ArrowUp' ? -1 : key === 'PageDown' ? page : key === 'PageUp' ? -page : key === 'Home' ? -this.data.length : key === 'End' ? this.data.length : 0; if (!delta) return false; this.scrollTo(this.scrollOffset + delta); return true;}
  protected override dragAt(point: UIPoint): void {if (!this.scrollbar) return; const rect = this.plotRect(), visible = Math.max(1, Math.floor((rect.height - this.rowHeight) / this.rowHeight)), range = Math.max(0, this.data.length - visible), trackHeight = Math.max(1, rect.height - 36), thumbHeight = Math.max(22, trackHeight * Math.min(1, visible / Math.max(1, this.data.length))), travel = Math.max(1, trackHeight - thumbHeight); if (!this.scrollDrag) {if (point.x < rect.left + rect.width - 18 || point.x > rect.left + rect.width || point.y < rect.top + 18 || point.y > rect.top + rect.height - 18) return; this.scrollDrag = {y: point.y, offset: this.scrollOffset};} else this.scrollTo(this.scrollDrag.offset + (point.y - this.scrollDrag.y) / travel * range);}
  protected override endDragAt(_point: UIPoint): void {this.scrollDrag = undefined;}
  private format(key: string, row: Record<string, any>): string {return this.formatters.get(key)?.(row[key], row) ?? (row[key] instanceof Date ? row[key].toISOString() : String(row[key] ?? ''));}
  protected renderPlot(ctx: CanvasRenderingContext2D, rect: Rect): void {
    if (!this.columns.length) return; const bodyWidth = Math.max(1, rect.width - (this.scrollbar ? 18 : 0)), width = bodyWidth / this.columns.length, visibleCount = Math.max(0, Math.floor((rect.height - this.rowHeight) / this.rowHeight));
    this.scrollOffset = Math.min(this.scrollOffset, Math.max(0, this.data.length - visibleCount));
    ctx.save(); ctx.beginPath(); ctx.rect(rect.left, rect.top, rect.width, rect.height); ctx.clip();
    ctx.fillStyle = 'rgba(110,140,170,.18)'; ctx.fillRect(rect.left, rect.top, rect.width, this.rowHeight); ctx.font = '600 12px sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    this.columns.forEach((key, index) => { ctx.fillStyle = this.textColor(); ctx.fillText((this.columnTitles.get(key) ?? key) + (this.sortKey === key ? this.ascending ? ' ↑' : ' ↓' : ''), rect.left + index * width + 9, rect.top + this.rowHeight / 2, Math.max(1, width - 18)); this.hitRect({left: rect.left + index * width, top: rect.top, width, height: this.rowHeight}, key, `Sort ${key}`, () => this.sortBy(key)); });
    ctx.font = '12px sans-serif';
    this.data.slice(this.scrollOffset, this.scrollOffset + visibleCount).forEach((row, index) => {
      const top = rect.top + (index + 1) * this.rowHeight; ctx.fillStyle = this.selected === row ? 'rgba(32,184,240,.23)' : index % 2 ? 'rgba(135,155,175,.06)' : 'transparent'; ctx.fillRect(rect.left, top, rect.width, this.rowHeight);
      this.columns.forEach((key, i) => {const cell = {left: rect.left + i * width, top, width, height: this.rowHeight}, style = this.cellStyle?.(row[key], key, row), renderer = this.renderers.get(key); ctx.save(); ctx.beginPath(); ctx.rect(cell.left, cell.top, cell.width, cell.height); ctx.clip(); if (style?.background) {ctx.fillStyle = style.background; ctx.fillRect(cell.left, cell.top, cell.width, cell.height);} ctx.fillStyle = style?.color ?? this.textColor(); if (renderer) renderer(ctx, cell, row[key], row); else ctx.fillText(this.format(key, row), cell.left + 9, top + this.rowHeight / 2, Math.max(1, width - 18)); ctx.restore();});
      if (this.selected === row) {ctx.strokeStyle = '#65bfe6'; ctx.lineWidth = 1.5; ctx.strokeRect(rect.left + 1, top + 1, bodyWidth - 2, this.rowHeight - 2);}
      ctx.strokeStyle = 'rgba(135,155,175,.17)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(rect.left, top + this.rowHeight); ctx.lineTo(rect.left + rect.width, top + this.rowHeight); ctx.stroke();
      this.hitRect({left: rect.left, top, width: bodyWidth, height: this.rowHeight}, row, this.columns.map(key => `${key}: ${this.format(key, row)}`).join('\n'));
    });
    if (this.scrollbar) {const x = rect.left + rect.width - 17, trackTop = rect.top + 18, trackHeight = Math.max(1, rect.height - 36), thumbHeight = Math.max(22, trackHeight * Math.min(1, visibleCount / Math.max(1, this.data.length))), travel = Math.max(0, trackHeight - thumbHeight), offset = this.scrollOffset / Math.max(1, this.data.length - visibleCount) * travel; ctx.strokeStyle = '#d7d7b3'; ctx.lineWidth = 1; ctx.strokeRect(x, rect.top, 16, rect.height); ctx.fillStyle = 'rgba(190,190,170,.2)'; ctx.fillRect(x + 1, trackTop + offset, 14, Math.min(trackHeight, thumbHeight)); ctx.strokeRect(x, trackTop + offset, 16, Math.min(trackHeight, thumbHeight)); ctx.fillStyle = this.textColor(); ctx.font = '13px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('▲', x + 8, rect.top + 8); ctx.fillText('▼', x + 8, rect.top + rect.height - 8); this.hitRect({left: x, top: rect.top, width: 16, height: 18}, 'scroll-up', 'Scroll up', () => this.scrollTo(this.scrollOffset - 1)); this.hitRect({left: x, top: rect.top + rect.height - 18, width: 16, height: 18}, 'scroll-down', 'Scroll down', () => this.scrollTo(this.scrollOffset + 1));}
    ctx.restore();
  }
}
