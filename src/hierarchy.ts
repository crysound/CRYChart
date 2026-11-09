import {SpecialtyChart, type SpecialtyOptions} from './specialty.js';
import {Color, ColorHEX, ColorRGBA, FontSettings, LUT, SolidFill, SolidLine, resolveValue, type FillStyle, type LineStyle, type ValueOrMutator} from './core/styles.js';
import {applyLine, fillCSS, type UIPoint} from './ui.js';
import type {Rect} from './contracts.js';

export interface HierarchyNode {name: string; value?: number; children?: HierarchyNode[]; color?: string | Color; id?: string | number; [key: string]: unknown; }
export interface SunburstArc {node: HierarchyNode; path: HierarchyNode[]; depth: number; branch: number; start: number; end: number; value: number; }
export enum FunnelSliceModes {VariableHeight = 0, VariableWidth = 1}
export enum PyramidSliceModes {VariableHeight = 0, VariableWidth = 1}
export interface StageGeometry {index: number; points: UIPoint[]; value: number; fraction: number; center: UIPoint; }
const TAU = Math.PI * 2;
const compact = (value: number) => Number(value.toPrecision(4)).toLocaleString('en-US');
const clampPercent = (value: number) => { if (!Number.isFinite(value)) throw new RangeError('Width must be finite'); return Math.max(0, Math.min(100, value)); };
function centeredTitle(chart: SpecialtyChart, ctx: CanvasRenderingContext2D, rect: Rect): void {
  if (!chart.title) return;
  ctx.clearRect(0, 0, chart.width, rect.top - 3); ctx.fillStyle = fillCSS(chart.background); ctx.fillRect(0, 0, chart.width, rect.top - 3);
  ctx.font = chart.titleFont.toCSS(); ctx.fillStyle = chart.theme.textColor?.toCSS?.() ?? '#f3f3d2'; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillText(chart.title, chart.width / 2, 17, chart.width - 20);
}
function ellipsis(ctx: CanvasRenderingContext2D, text: string, width: number): string { if (ctx.measureText(text).width <= width) return text; let low = 0, high = text.length; while (low < high) { const mid = Math.ceil((low + high) / 2); if (ctx.measureText(text.slice(0, mid) + '…').width <= width) low = mid; else high = mid - 1; } return text.slice(0, low) + '…'; }

function cloneNodes(input: HierarchyNode | readonly HierarchyNode[]): HierarchyNode[] {
  const visiting = new WeakSet<object>();
  const copy = (node: HierarchyNode, depth: number): HierarchyNode => {
    if (!node || typeof node !== 'object') throw new TypeError('Hierarchy nodes must be objects');
    if (depth > 128) throw new RangeError('Hierarchy depth exceeds 128 levels');
    if (visiting.has(node)) throw new TypeError('Hierarchy data contains a cycle');
    if (node.value !== undefined && (!Number.isFinite(node.value) || node.value < 0)) throw new RangeError('Hierarchy values must be finite and nonnegative');
    visiting.add(node);
    const result = {...node, name: String(node.name ?? ''), ...(node.children ? {children: node.children.map(child => copy(child, depth + 1))} : {})};
    visiting.delete(node); return result;
  };
  return (Array.isArray(input) ? input : [input]).map(node => copy(node, 0));
}

export function hierarchyWeight(node: HierarchyNode, cache = new Map<HierarchyNode, number>()): number {
  const known = cache.get(node); if (known !== undefined) return known;
  const value = node.children?.length ? node.children.reduce((total, child) => total + hierarchyWeight(child, cache), 0) : Math.max(0, node.value ?? 0);
  if (!Number.isFinite(value)) throw new RangeError('Hierarchy aggregate value must be finite');
  cache.set(node, value); return value;
}

/** Allocate each child's angle from its share of its parent's value. */
export function layoutSunburst(nodes: readonly HierarchyNode[], options: {startAngle?: number; endAngle?: number; maxDepth?: number} = {}): SunburstArc[] {
  const output: SunburstArc[] = [], weights = new Map<HierarchyNode, number>(), maxDepth = options.maxDepth ?? 32;
  const descend = (items: readonly HierarchyNode[], start: number, end: number, depth: number, path: HierarchyNode[], branch?: number) => {
    if (depth >= maxDepth) return;
    const positive = items.filter(node => hierarchyWeight(node, weights) > 0), total = positive.reduce((sum, node) => sum + hierarchyWeight(node, weights), 0);
    if (!total) return;
    let angle = start;
    positive.forEach((node, i) => {
      const value = hierarchyWeight(node, weights), next = i === positive.length - 1 ? end : angle + (end - start) * value / total, route = [...path, node], rootBranch = branch ?? i;
      output.push({node, path: route, depth, branch: rootBranch, start: angle, end: next, value});
      if (node.children?.length) descend(node.children, angle, next, depth + 1, route, rootBranch);
      angle = next;
    });
  };
  descend(nodes, options.startAngle ?? -Math.PI / 2, options.endAngle ?? Math.PI * 1.5, 0, []); return output;
}

function findPath(nodes: readonly HierarchyNode[], match: HierarchyNode | string | number): HierarchyNode[] | undefined {
  for (const node of nodes) {
    if (node === match || (typeof match !== 'object' && (node.id === match || node.name === match))) return [node];
    const child = node.children && findPath(node.children, match); if (child) return [node, ...child];
  }
  return undefined;
}

export class SunBurstChart extends SpecialtyChart {
  private data: HierarchyNode[] = []; private route: HierarchyNode[] = []; private maxDepth = 6; private innerRadius = .2; private startAngle = -90;
  private radiusFactor = .46; private radialLabels = false; private centerLabels = true; private holeFill?: FillStyle; private labelEffect = false;
  labelFont = new FontSettings({size: 12}); labelFill: FillStyle = new SolidFill({color: ColorRGBA(245, 248, 255)});
  labelFormatter: (node: HierarchyNode, value: number) => string = node => node.name;
  valueFormatter: (value: number) => string = compact;
  constructor(options: SpecialtyOptions = {}) { super(options); }
  setData(data: HierarchyNode | HierarchyNode[]): this { this.data = cloneNodes(data); this.route = []; this.selected = undefined; this.invalidate(); return this; }
  getData(): HierarchyNode[] { return cloneNodes(this.data); }
  getFocus(): HierarchyNode | undefined { return this.route.at(-1); }
  getPath(): string[] { return this.route.map(node => node.name); }
  drillDown(target: HierarchyNode | string | number): this {
    const path = findPath(this.data, target); if (!path?.at(-1)?.children?.length) return this;
    this.route = path; this.selected = undefined; this.events.emit('focuschange', {chart: this, path: this.getPath(), node: this.getFocus()}); this.invalidate(); return this;
  }
  drillUp(): this { if (this.route.length) { this.route.pop(); this.selected = undefined; this.events.emit('focuschange', {chart: this, path: this.getPath(), node: this.getFocus()}); this.invalidate(); } return this; }
  resetView(): this { this.route = []; this.selected = undefined; this.events.emit('focuschange', {chart: this, path: [], node: undefined}); this.invalidate(); return this; }
  setMaxDepth(value: number): this { if (!Number.isInteger(value) || value < 1 || value > 32) throw new RangeError('Visible hierarchy depth must be between 1 and 32'); this.maxDepth = value; this.invalidate(); return this; }
  setInnerRadius(value: number): this { if (!Number.isFinite(value)) throw new RangeError('Inner radius must be finite'); this.innerRadius = Math.max(.05, Math.min(.7, value > 1 ? value / 100 : value)); this.invalidate(); return this; }
  setStartAngle(degrees: number): this { if (!Number.isFinite(degrees)) throw new RangeError('Start angle must be finite'); this.startAngle = degrees; this.invalidate(); return this; }
  setRadiusFactor(value: number): this { if (!Number.isFinite(value) || value <= 0 || value > .5) throw new RangeError('Radius factor must be in (0, .5]'); this.radiusFactor = value; this.invalidate(); return this; }
  setLabelOrientation(value: 'radial' | 'tangential'): this { this.radialLabels = value === 'radial'; this.invalidate(); return this; }
  setCenterLabelVisible(value: boolean): this { this.centerLabels = value; this.invalidate(); return this; }
  setHoleFillStyle(value: FillStyle): this { this.holeFill = value; this.invalidate(); return this; }
  setLabelEffect(value: boolean): this { this.labelEffect = value; this.invalidate(); return this; }
  setLabelFont(value: ValueOrMutator<FontSettings>): this { this.labelFont = resolveValue(value, this.labelFont); this.invalidate(); return this; }
  setLabelFillStyle(value: ValueOrMutator<FillStyle>): this { this.labelFill = resolveValue(value, this.labelFill); this.invalidate(); return this; }
  setLabelFormatter(value: (node: HierarchyNode, weight: number) => string): this { this.labelFormatter = value; this.invalidate(); return this; }
  setValueFormatter(value: (value: number) => string): this { this.valueFormatter = value; this.invalidate(); return this; }
  protected override key(key: string): boolean { if (key === 'Escape' || key === 'Backspace') { this.drillUp(); return true; } if (key === 'Home') { this.resetView(); return true; } return false; }
  protected renderPlot(ctx: CanvasRenderingContext2D, rect: Rect): void {
    centeredTitle(this, ctx, rect);
    const focus = this.getFocus(), nodes = focus ? [focus] : this.data, start = this.startAngle * Math.PI / 180, arcs = layoutSunburst(nodes, {startAngle: start, endAngle: start + TAU, maxDepth: this.maxDepth});
    const depthCount = arcs.reduce((max, arc) => Math.max(max, arc.depth + 1), 1), radius = Math.max(1, Math.min(rect.width, rect.height) * this.radiusFactor), hole = radius * this.innerRadius, ring = (radius - hole) / depthCount;
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2, total = nodes.reduce((sum, node) => sum + hierarchyWeight(node), 0);
    if (this.holeFill) { ctx.fillStyle = fillCSS(this.holeFill); ctx.beginPath(); ctx.arc(cx, cy, hole, 0, TAU); ctx.fill(); }
    for (const arc of arcs) {
      const inner = hole + arc.depth * ring, outer = inner + ring - 1, middle = (arc.start + arc.end) / 2, selected = this.selected === arc.node, hovered = arc.path.includes(this.hovered?.data);
      ctx.beginPath(); ctx.arc(cx, cy, outer, arc.start, arc.end); ctx.arc(cx, cy, inner, arc.end, arc.start, true); ctx.closePath();
      ctx.fillStyle = this.color(arc.branch, arc.node); ctx.globalAlpha = hovered || selected ? 1 : Math.max(.55, .9 - arc.depth * .08); ctx.fill(); ctx.globalAlpha = 1;
      ctx.strokeStyle = selected ? '#ffffff' : 'rgba(15,24,35,.55)'; ctx.lineWidth = selected ? 2 : 1; ctx.stroke();
      const middleRadius = (inner + outer) / 2, arcLength = (arc.end - arc.start) * middleRadius;
      if (arcLength > 28 && ring > 16) {
        ctx.save(); ctx.translate(cx + Math.cos(middle) * middleRadius, cy + Math.sin(middle) * middleRadius);
        let rotation = middle + (this.radialLabels ? 0 : Math.PI / 2); if (Math.cos(rotation) < 0) rotation += Math.PI;
        ctx.rotate(rotation); ctx.font = this.labelFont.toCSS(); ctx.fillStyle = fillCSS(this.labelFill, '#ffffff'); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const width = Math.max(1, this.radialLabels ? ring - 9 : arcLength - 8), text = ellipsis(ctx, this.labelFormatter(arc.node, arc.value), width);
        if (this.labelEffect) { ctx.strokeStyle = 'rgba(0,0,0,.88)'; ctx.lineWidth = 2.5; ctx.lineJoin = 'round'; ctx.strokeText(text, 0, 0); }
        ctx.fillText(text, 0, 0); ctx.restore();
      }
      this.hits.push({data: arc.node, label: `${[...this.route.slice(0, -1).map(node => node.name), ...arc.path.map(node => node.name)].join(' / ')}\n${this.valueFormatter(arc.value)} (${total ? (arc.value / total * 100).toFixed(1) : '0'}%)${arc.node.children?.length ? '\nClick to explore' : ''}`, contains: point => { const dx = point.x - cx, dy = point.y - cy, distance = Math.hypot(dx, dy), angle = start + ((Math.atan2(dy, dx) - start) % TAU + TAU) % TAU; return distance >= inner && distance <= outer && angle >= arc.start && angle <= arc.end; }, activate: arc.node.children?.length && arc.node !== focus ? () => this.drillDown(arc.node) : undefined});
    }
    ctx.fillStyle = this.textColor(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '600 13px sans-serif';
    if (this.centerLabels) { ctx.fillText(focus?.name ?? 'Total', cx, cy - 9, Math.max(1, hole * 1.8)); ctx.font = '12px sans-serif'; ctx.fillText(this.valueFormatter(total), cx, cy + 10, Math.max(1, hole * 1.8)); }
    if (focus) {
      ctx.font = '12px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; const label = `← Go Back${this.route.length > 1 ? ' ← ' + this.route[this.route.length - 2].name : ''}`; ctx.fillText(label, 12, 14, this.width * .42);
      this.hitRect({left: 8, top: 9, width: Math.min(this.width * .42, ctx.measureText(label).width + 12), height: 22}, focus, 'Return to parent', () => this.drillUp());
      this.hits.push({data: focus, label: 'Return to parent', contains: p => Math.hypot(p.x - cx, p.y - cy) < hole, activate: () => this.drillUp()});
    }
    if (!arcs.length) { ctx.strokeStyle = 'rgba(150,170,190,.3)'; ctx.beginPath(); ctx.arc(cx, cy, radius, 0, TAU); ctx.stroke(); }
  }
}

/** Both modes place width boundaries by cumulative value; width mode keeps stage heights equal. */
export function layoutStages(values: readonly number[], rect: Rect, options: {kind: 'funnel' | 'pyramid'; mode?: number; headWidth?: number; neckWidth?: number}): StageGeometry[] {
  const clean = values.map(value => Number.isFinite(value) ? Math.max(0, value) : 0), total = clean.reduce((sum, value) => sum + value, 0);
  if (!total || rect.width <= 0 || rect.height <= 0) return [];
  const center = rect.left + rect.width / 2, head = clampPercent(options.headWidth ?? 100) / 100, neck = clampPercent(options.neckWidth ?? (options.kind === 'funnel' ? 20 : 0)) / 100;
  let cumulative = 0;
  return clean.map((value, index) => {
    const fraction = value / total, valueStart = cumulative / total, a = options.mode === 1 ? index / clean.length : valueStart;
    cumulative += value;
    const valueEnd = cumulative / total, b = options.mode === 1 ? (index + 1) / clean.length : valueEnd;
    let topWidth: number, bottomWidth: number;
    if (options.kind === 'funnel') { topWidth = head + (neck - head) * valueStart; bottomWidth = head + (neck - head) * valueEnd; }
    else { topWidth = neck + (1 - neck) * valueStart; bottomWidth = neck + (1 - neck) * valueEnd; }
    const top = rect.top + a * rect.height, bottom = rect.top + b * rect.height;
    return {index, value, fraction, center: {x: center, y: (top + bottom) / 2}, points: [{x: center - topWidth * rect.width / 2, y: top}, {x: center + topWidth * rect.width / 2, y: top}, {x: center + bottomWidth * rect.width / 2, y: bottom}, {x: center - bottomWidth * rect.width / 2, y: bottom}]};
  }).filter(stage => stage.value > 0);
}

function insidePolygon(point: UIPoint, points: UIPoint[]): boolean {
  let inside = false;
  for (let i = 0, previous = points.length - 1; i < points.length; previous = i++) { const a = points[i], b = points[previous]; if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside; }
  return inside;
}

export class StageSlice {
  visible = true; disposed = false; fillStyle?: FillStyle; strokeStyle?: LineStyle;
  private readonly generation: number;
  constructor(readonly chart: SlicedHierarchyChart, readonly node: HierarchyNode) { this.generation = chart.dataGeneration; }
  private assertAlive(): void { if (this.isDisposed()) throw new Error('Slice was removed or its chart data was replaced'); }
  getName(): string { return this.node.name; }
  setName(name: string): this { this.assertAlive(); this.node.name = name; this.chart.invalidate(); return this; }
  getValue(): number { return hierarchyWeight(this.node); }
  setValue(value: number): this { this.assertAlive(); if (!Number.isFinite(value) || value < 0) throw new RangeError('Slice values must be finite and nonnegative'); if (this.node.children?.length) throw new Error('Aggregate slice values are derived from child values'); this.node.value = value; this.chart.invalidate(); return this; }
  getFillStyle(): FillStyle | undefined { return this.fillStyle; }
  setFillStyle(value: ValueOrMutator<FillStyle>): this { this.assertAlive(); this.fillStyle = resolveValue(value, this.fillStyle ?? new SolidFill({color: ColorRGBA(32, 184, 240)})); this.chart.invalidate(); return this; }
  getStrokeStyle(): LineStyle | undefined { return this.strokeStyle; }
  setStrokeStyle(value: ValueOrMutator<LineStyle>): this { this.assertAlive(); this.strokeStyle = resolveValue(value, this.strokeStyle ?? this.chart.getSliceStrokeStyle()); this.chart.invalidate(); return this; }
  getVisible(): boolean { return this.visible; }
  setVisible(value: boolean): this { this.assertAlive(); this.visible = value; this.chart.invalidate(); return this; }
  dispose(): this { if (!this.isDisposed()) { this.disposed = true; this.chart.invalidate(); } return this; }
  isDisposed(): boolean { return this.disposed || this.chart.disposed || this.generation !== this.chart.dataGeneration; }
}

export abstract class SlicedHierarchyChart extends SpecialtyChart {
  dataGeneration = 0;
  private roots: HierarchyNode[] = []; private route: HierarchyNode[] = []; private handles = new Map<HierarchyNode, StageSlice>();
  protected abstract readonly shape: 'funnel' | 'pyramid';
  protected headWidth = 100; protected neckWidth = 20; protected sliceMode = 0; protected gap = 4;
  private palette?: LUT; private style?: (index: number, slice: StageSlice) => FillStyle; private sorter?: (a: StageSlice, b: StageSlice) => number;
  private stroke: LineStyle = new SolidLine({fillStyle: new SolidFill({color: ColorRGBA(255, 255, 255, 130)}), thickness: 1});
  private labelFill: FillStyle = new SolidFill({color: ColorRGBA(235, 242, 250)}); private labelFont = new FontSettings({size: 13});
  private labelFormatter: (slice: StageSlice, relativeValue: number) => string = (slice, relativeValue) => `${slice.getName()}: ${compact(slice.getValue())} (${(relativeValue * 100).toFixed(1)}%)`;
  private highlightOnHover = true; private sliceEffect = false; private labelEffect = false;
  private labelPosition: 'left' | 'right' | 'inside' = 'right'; private spacing = 0; private gradient = false;
  private handle(node: HierarchyNode): StageSlice { let result = this.handles.get(node); if (!result) { result = new StageSlice(this, node); this.handles.set(node, result); } return result; }
  setData(data: HierarchyNode | HierarchyNode[]): this { this.roots = cloneNodes(data); this.dataGeneration++; this.route = []; this.handles.clear(); this.selected = undefined; this.invalidate(); return this; }
  getData(): HierarchyNode[] { return cloneNodes(this.roots); }
  addSlice(name: string, value: number): StageSlice { const node = cloneNodes({name, value})[0]; this.roots.push(node); this.invalidate(); return this.handle(node); }
  addSlices(data: Array<{name: string; value: number}>): StageSlice[] { return data.map(item => this.addSlice(item.name, item.value)); }
  addData(data: HierarchyNode[]): this { this.roots.push(...cloneNodes(data)); this.invalidate(); return this; }
  getSlices(): StageSlice[] { return this.roots.map(node => this.handle(node)).filter(slice => !slice.disposed); }
  override getSeries(): StageSlice[] { return this.getSlices(); }
  getFocus(): HierarchyNode | undefined { return this.route.at(-1); }
  getPath(): string[] { return this.route.map(node => node.name); }
  drillDown(target: HierarchyNode | StageSlice | string | number): this { const path = findPath(this.roots, target instanceof StageSlice ? target.node : target); if (path?.at(-1)?.children?.length) { this.route = path; this.selected = undefined; this.events.emit('focuschange', {chart: this, path: this.getPath()}); this.invalidate(); } return this; }
  drillUp(): this { if (this.route.length) { this.route.pop(); this.selected = undefined; this.events.emit('focuschange', {chart: this, path: this.getPath()}); this.invalidate(); } return this; }
  resetView(): this { this.route = []; this.selected = undefined; this.events.emit('focuschange', {chart: this, path: []}); this.invalidate(); return this; }
  setNeckWidth(value: number): this { this.neckWidth = clampPercent(value); this.invalidate(); return this; }
  getNeckWidth(): number { return this.neckWidth; }
  setSliceGap(value: number): this { this.gap = Math.max(0, Math.min(20, value)); this.invalidate(); return this; }
  setSliceMode(value: number | 'VariableHeight' | 'VariableWidth'): this { this.sliceMode = value === 1 || value === 'VariableWidth' ? 1 : 0; this.invalidate(); return this; }
  setLUT(value: LUT): this { this.palette = value; this.invalidate(); return this; }
  setSliceFillStyle(value: (index: number, slice: StageSlice) => FillStyle): this { this.style = value; this.invalidate(); return this; }
  getSliceFillStyle(): ((index: number, slice: StageSlice) => FillStyle) | undefined { return this.style; }
  setSliceStrokeStyle(value: ValueOrMutator<LineStyle>): this { this.stroke = resolveValue(value, this.stroke); this.invalidate(); return this; }
  getSliceStrokeStyle(): LineStyle { return this.stroke; }
  setSliceSorter(value: (a: StageSlice, b: StageSlice) => number): this { this.sorter = value; this.invalidate(); return this; }
  getSliceSorter(): ((a: StageSlice, b: StageSlice) => number) | undefined { return this.sorter; }
  setLabelFillStyle(value: ValueOrMutator<FillStyle>): this { this.labelFill = resolveValue(value, this.labelFill); this.invalidate(); return this; }
  getLabelFillStyle(): FillStyle { return this.labelFill; }
  setLabelFont(value: ValueOrMutator<FontSettings>): this { this.labelFont = resolveValue(value, this.labelFont); this.invalidate(); return this; }
  getLabelFont(): FontSettings { return this.labelFont; }
  setLabelFormatter(value: (slice: StageSlice, relativeValue: number) => string): this { this.labelFormatter = value; this.invalidate(); return this; }
  setLabelPosition(value: 'left' | 'right' | 'inside'): this { this.labelPosition = value; this.invalidate(); return this; }
  setSliceSpacing(value: number): this { if (!Number.isFinite(value)) throw new RangeError('Slice spacing must be finite'); this.spacing = Math.max(0, Math.min(20, value)); this.invalidate(); return this; }
  setSliceGradient(value: boolean): this { this.gradient = value; this.invalidate(); return this; }
  getLabelFormatter(): (slice: StageSlice, relativeValue: number) => string { return this.labelFormatter; }
  setSliceHighlightOnHover(value: boolean): this { this.highlightOnHover = value; this.invalidate(); return this; }
  setSliceEffect(value: boolean): this { this.sliceEffect = value; this.invalidate(); return this; }
  getSliceEffect(): boolean { return this.sliceEffect; }
  setLabelEffect(value: boolean): this { this.labelEffect = value; this.invalidate(); return this; }
  getLabelEffect(): boolean { return this.labelEffect; }
  protected override key(key: string): boolean { if (key === 'Escape' || key === 'Backspace') { this.drillUp(); return true; } if (key === 'Home') { this.resetView(); return true; } return false; }
  protected renderPlot(ctx: CanvasRenderingContext2D, rect: Rect): void {
    centeredTitle(this, ctx, rect);
    const focus = this.getFocus();
    if (focus) { ctx.fillStyle = this.textColor(); ctx.font = '12px sans-serif'; ctx.textBaseline = 'top'; ctx.textAlign = 'left'; ctx.fillText(`‹ Back / ${this.getPath().join(' / ')}`, rect.left, rect.top); this.hitRect({...rect, height: 24}, focus, 'Return to parent', () => this.drillUp()); }
    const top = rect.top + (focus ? 30 : 5), height = Math.max(1, rect.height - (focus ? 35 : 10)), narrow = rect.width < 300, inside = this.labelPosition === 'inside' || narrow;
    const plot = {left: rect.left + (inside ? rect.width * .02 : this.labelPosition === 'left' ? rect.width * .34 : rect.width * .02), top, width: rect.width * (inside ? .96 : .64), height};
    const nodes = focus?.children ?? this.roots, slices = nodes.map(node => this.handle(node)).filter(slice => !slice.disposed && slice.visible);
    if (this.sorter) slices.sort(this.sorter);
    const stages = layoutStages(slices.map(slice => slice.getValue()), plot, {kind: this.shape, mode: this.sliceMode, headWidth: this.headWidth, neckWidth: this.neckWidth});
    for (const stage of stages) {
      const slice = slices[stage.index], node = slice.node, highlighted = this.selected === slice || this.highlightOnHover && this.hovered?.data === slice;
      const fill = slice.fillStyle ?? this.style?.(stage.index, slice) ?? (this.palette ? new SolidFill({color: this.palette.getColor(stage.value)}) : undefined);
      if (this.spacing && stage.points[2].y > stage.points[0].y) { const original = stage.points.map(point => ({...point})), t = Math.min(.3, this.spacing / 2 / (original[2].y - original[0].y)); stage.points = [
        {x: original[0].x + (original[3].x - original[0].x) * t, y: original[0].y + (original[3].y - original[0].y) * t},
        {x: original[1].x + (original[2].x - original[1].x) * t, y: original[1].y + (original[2].y - original[1].y) * t},
        {x: original[2].x + (original[1].x - original[2].x) * t, y: original[2].y + (original[1].y - original[2].y) * t},
        {x: original[3].x + (original[0].x - original[3].x) * t, y: original[3].y + (original[0].y - original[3].y) * t},
      ]; }
      ctx.save(); ctx.beginPath(); stage.points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y)); ctx.closePath();
      ctx.fillStyle = fill ? fillCSS(fill) : this.color(stage.index, node); ctx.globalAlpha = highlighted ? 1 : .94;
      if (this.gradient) { let color = fill?.kind === 'empty' ? ColorRGBA(0, 0, 0, 0) : fill?.getColor?.() ?? this.theme.dataColors[stage.index % this.theme.dataColors.length]; if (node.color instanceof Color) color = node.color; else if (typeof node.color === 'string') { try { color = ColorHEX(node.color); } catch {} } if (color) { const left = Math.min(...stage.points.map(point => point.x)), right = Math.max(...stage.points.map(point => point.x)), gradient = ctx.createLinearGradient(left, 0, right, 0); gradient.addColorStop(0, color.getLighter().toCSS()); gradient.addColorStop(.32, color.toCSS()); gradient.addColorStop(1, new Color(color.r * .56, color.g * .56, color.b * .56, color.a).toCSS()); ctx.fillStyle = gradient; } }
      if (this.sliceEffect) { ctx.shadowBlur = highlighted ? 12 : 5; ctx.shadowColor = fill ? fillCSS(fill) : this.color(stage.index, node); ctx.shadowOffsetY = 2; }
      ctx.fill(); ctx.globalAlpha = 1; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
      if (applyLine(ctx, slice.strokeStyle ?? this.stroke)) { if (highlighted) ctx.lineWidth = Math.max(2, ctx.lineWidth); ctx.stroke(); } ctx.restore();
      const text = this.labelFormatter(slice, stage.fraction), right = (stage.points[1].x + stage.points[2].x) / 2;
      ctx.save(); ctx.fillStyle = fillCSS(this.labelFill, this.textColor()); ctx.font = this.labelFont.toCSS(); ctx.textBaseline = 'middle';
      if (this.labelEffect) { ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 3; ctx.shadowOffsetY = 1; }
      if (inside) { ctx.textAlign = 'center'; ctx.fillText(text, stage.center.x, stage.center.y, Math.max(1, plot.width * .8)); }
      else if (this.labelPosition === 'left') { const labelX = rect.left + 4, left = (stage.points[0].x + stage.points[3].x) / 2, textWidth = Math.min(plot.left - labelX - 12, ctx.measureText(text).width); ctx.strokeStyle = 'rgba(210,210,190,.65)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(labelX + textWidth + this.gap, stage.center.y); ctx.lineTo(left - this.gap, stage.center.y); ctx.stroke(); ctx.textAlign = 'left'; ctx.fillText(text, labelX, stage.center.y, Math.max(1, plot.left - labelX - 12)); }
      else { const labelX = plot.left + plot.width + 18, connectorStart = right + this.gap; ctx.strokeStyle = fillCSS(this.labelFill, '#cbd5e1'); ctx.lineWidth = 1; ctx.setLineDash([]); ctx.beginPath(); ctx.moveTo(connectorStart, stage.center.y); ctx.lineTo(labelX - this.gap, stage.center.y); ctx.stroke(); ctx.textAlign = 'left'; ctx.fillText(text, labelX, stage.center.y, Math.max(1, rect.left + rect.width - labelX)); }
      ctx.restore();
      this.hits.push({data: slice, label: `${[...this.route.map(item => item.name), node.name].join(' / ')}\n${compact(stage.value)} (${(stage.fraction * 100).toFixed(1)}%)${node.children?.length ? '\nClick to explore' : ''}`, contains: p => insidePolygon(p, stage.points), activate: node.children?.length ? () => this.drillDown(node) : undefined});
    }
    if (!stages.length) { ctx.fillStyle = this.textColor(); ctx.textAlign = 'center'; ctx.font = '13px sans-serif'; ctx.fillText('No positive values', rect.left + rect.width / 2, rect.top + rect.height / 2); }
  }
}

export class Funnel extends SlicedHierarchyChart {
  protected readonly shape = 'funnel' as const;
  constructor(options: SpecialtyOptions = {}) { super(options); }
  setHeadWidth(value: number): this { this.headWidth = clampPercent(value); this.invalidate(); return this; }
  getHeadWidth(): number { return this.headWidth; }
  getFunnelSliceMode(): number { return this.sliceMode; }
}
export class Pyramid extends SlicedHierarchyChart {
  protected readonly shape = 'pyramid' as const;
  constructor(options: SpecialtyOptions = {}) { super(options); this.neckWidth = 0; }
  getPyramidSliceMode(): number { return this.sliceMode; }
}
export {Funnel as FunnelChart, Pyramid as PyramidChart};
